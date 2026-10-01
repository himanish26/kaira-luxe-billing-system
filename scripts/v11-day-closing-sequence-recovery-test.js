const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const sqlite3 = require("sqlite3").verbose();
const { migrateConsolidatedReportingJobs } = require("../src/database/dayClosingMigration");
const { buildConsolidatedPayload, canonicalizeSemanticPayload } = require("../src/shared/consolidatedDsrBuilder");
const { sha256Utf8 } = require("../src/services/consolidatedReportingTransport");
const { createConsolidatedSheetDeliveryWorker } = require("../src/services/consolidatedSheetDeliveryWorker");
const { createConsolidatedReportingEmailWorker } = require("../src/services/consolidatedReportingEmailWorker");
const { createDayClosingDeliveryCoordinator } = require("../src/main/dayClosingDeliveryCoordinator");

const mainSource = fs.readFileSync("src/main/main.js", "utf8").replace(/\r\n/g, "\n");
const uiSource = fs.readFileSync("src/renderer/modules/system/dayClosing.js", "utf8");
const run = (db, sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, error => error ? reject(error) : resolve()));
const get = (db, sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row)));
const all = (db, sql) => new Promise((resolve, reject) => db.all(sql, (error, rows) => error ? reject(error) : resolve(rows)));

function captureHandler(source, start, end, dependencies) {
    let handler;
    vm.runInNewContext(source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))), {
        ...dependencies, ipcMain: { handle: (_channel, fn) => { handler = fn; } }, console
    });
    assert.strictEqual(typeof handler, "function");
    return handler;
}

async function fixture() {
    const db = new sqlite3.Database(":memory:");
    await migrateConsolidatedReportingJobs(db);
    await run(db, `CREATE TABLE day_closing_snapshots (id INTEGER PRIMARY KEY,
        business_date TEXT, close_sequence INTEGER, close_status TEXT, backup_status TEXT,
        backup_reference TEXT, email_status TEXT, updated_at TEXT)`);
    await run(db, "INSERT INTO day_closing_snapshots VALUES (1,'2026-10-01',1,'CLOSED','SUCCESS','fixture.zip','PENDING',NULL)");
    const payload = buildConsolidatedPayload({
        metadata: { businessDate: "2026-10-01", closingId: "1", closeSequence: "1", closedAt: "2026-10-01T06:00:00.000Z", klbsVersion: "2.0.0" },
        overall: { cashPaise: "0", upiPaise: "0", cardPaise: "0", storeCreditRedeemedPaise: "0",
            giftVoucherRedeemedPaise: "0", backupStatus: "SUCCESS", emailStatus: "PENDING" }, bills: []
    });
    const json = canonicalizeSemanticPayload(payload);
    await run(db, `INSERT INTO consolidated_reporting_jobs (id,closing_id,business_date,close_sequence,
        contract_version,snapshot_version,payload_json,payload_hash,report_status,data_quality_status,created_at)
        VALUES (1,1,'2026-10-01',1,2,2,?,?,'FINAL','COMPLETE','2026-10-01T06:00:00.000Z')`, [json, sha256Utf8(json)]);
    return { db, payload, schema: await all(db, "SELECT type,name,sql FROM sqlite_master ORDER BY type,name") };
}

async function testClosing(emailOutcome, online) {
    const { db, payload, schema } = await fixture();
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "klbs-close-sequence-"));
    const backup = path.join(temp, "fixture.zip");
    fs.writeFileSync(backup, "isolated fixture only");
    const calls = [];
    const progress = [];
    let clock = new Date("2026-10-01T06:01:00.000Z");
    let currentEmailOutcome = emailOutcome;
    let envelope;
    try {
        const email = createConsolidatedReportingEmailWorker({ database: db, now: () => clock,
            getEmailConfiguration: async () => currentEmailOutcome === "FAILED" ? {} :
                { automaticEmailBackup: true, recipients: ["fixture@example.invalid"] },
            getBackupPath: async () => backup, validateBackup: async () => ({ success: true }),
            sendEmail: async () => {
                calls.push("email");
                if (currentEmailOutcome === "PENDING") throw Object.assign(new Error("fixture network failure"), { code: "ECONNRESET" });
            }
        });
        const sheet = createConsolidatedSheetDeliveryWorker({ database: db, now: () => clock,
            configProvider: () => ({ endpoint: "https://fixture.invalid/dsr", secret: "test-only" }),
            httpClient: { post: async (_url, value) => {
                calls.push("sheet"); envelope = value;
                return { status: 200, data: { ok: true, transportVersion: 1, action: "INSERTED",
                    businessDate: value.payload.businessDate, closingId: value.payload.closingId,
                    closeSequence: value.payload.closeSequence, payloadHash: value.payloadHash,
                    receivedAt: clock.toISOString() } };
            } }
        });
        // Even a competing poll must not claim Sheet before unattempted Email.
        assert.strictEqual((await sheet.processForJob(1)).processed, false);
        assert.strictEqual(calls.length, 0);
        const coordinator = createDayClosingDeliveryCoordinator({ database: db, sheetWorker: sheet, emailWorker: email });
        const handler = captureHandler(mainSource, 'ipcMain.handle(\n\n    "close-business-day"',
            'ipcMain.handle("app:close-after-day-closing"', {
                dayClosingCriticalInProgress: false, dayClosingPrintPending: null,
                activeDayClosingUiAttemptId: null, dayClosingFeedback: null,
                mainWindow: { isDestroyed: () => false, webContents: { send: (_event, value) => progress.push(value.stage) } },
                closeBusinessDay: async () => {
                    calls.push("close+verified-backup");
                    return { success: true, snapshotId: 1, backupStatus: "SUCCESS", consolidatedReportingJob: { jobId: 1 } };
                }, remoteDashboard: { queueDayClosed: async () => {} },
                technicalLogger: { warn: () => {} }, getInternetStatus: async options => {
                    assert.strictEqual(options.timeoutMs, 3000); calls.push("precheck"); return { online };
                }, dayClosingDeliveryCoordinator: coordinator,
                getBusinessDayState: async () => ({ closed: true })
            });
        const result = await handler({}, 1001);
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.onlineDelivery.emailStatus, online ? emailOutcome : "PENDING");
        assert.strictEqual(result.onlineDelivery.dsrStatus, online ? "DELIVERED" : "PENDING");
        assert.deepStrictEqual(progress, ["SENDING_EMAIL", "EMAIL_RESULT", "UPDATING_DSR", "DSR_RESULT",
            "COMPLETING_DAY_CLOSING", "DAY_CLOSING_COMPLETE"]);
        if (online) {
            assert.strictEqual(envelope.payload.overall.emailStatus, emailOutcome === "DELIVERED" ? "SUCCESS" : emailOutcome);
            const withoutStatus = value => ({ ...value, overall: { ...value.overall, emailStatus: "PENDING" } });
            assert.deepStrictEqual(withoutStatus(envelope.payload), withoutStatus(payload), "only operational Email Status changes");
            assert.strictEqual(sha256Utf8(canonicalizeSemanticPayload(envelope.payload)), envelope.payloadHash);
            if (emailOutcome !== "FAILED") assert(calls.indexOf("email") < calls.indexOf("sheet"));
        } else {
            assert.deepStrictEqual(calls, ["close+verified-backup", "precheck"]);
            const row = await coordinator.readJob(1);
            assert.strictEqual(row.email_attempt_count, 0); assert.strictEqual(row.sheet_attempt_count, 0);
        }
        const print = captureHandler(mainSource, 'ipcMain.handle(\n\n    "print-day-closing"',
            'ipcMain.handle(\n\n    "printer:test"', {
                dayClosingPrintPending: { snapshotId: 1, jobId: 1, printStarted: false },
                dayClosingDeliveryCoordinator: coordinator,
                getDayClosingSnapshot: async () => ({ closeStatus: "CLOSED", backupStatus: "SUCCESS" }),
                dayClosingReceiptWithDelivery: (snapshot, delivery) => ({ ...snapshot, ...delivery }),
                printDayClosingReceipt: async data => {
                    calls.push("print");
                    assert.strictEqual(data.emailStatus, result.onlineDelivery.emailStatus);
                    assert.strictEqual(data.dsrStatus, result.onlineDelivery.dsrStatus);
                }
            });
        assert.strictEqual((await print({}, 1)).success, true);
        assert.strictEqual(calls[calls.length - 1], "print");
        assert.deepStrictEqual(await all(db, "SELECT type,name,sql FROM sqlite_master ORDER BY type,name"), schema);
        assert.strictEqual((await get(db, "PRAGMA integrity_check")).integrity_check, "ok");
        assert.deepStrictEqual(await all(db, "PRAGMA foreign_key_check"), []);
        // Existing retry route only requeues channels; no closing or print operation.
        if (online) {
            const retry = captureHandler(mainSource, 'ipcMain.handle("day-closing:retry-dsr-sync"', '\n}\n', {
                requireSecurityGrant: (_grant, purpose) => assert.strictEqual(purpose, "DSR_SYNC_RETRY"),
                reportingMode: "CONSOLIDATED_V2", REPORTING_MODES: { CONSOLIDATED_V2: "CONSOLIDATED_V2" },
                consolidatedSheetDeliveryWorker: sheet, consolidatedReportingEmailWorker: email,
                consolidatedReportingPersistence: { getByClosingId: id => get(db, "SELECT * FROM consolidated_reporting_jobs WHERE closing_id=?", [id]) }
            });
            const before = await get(db, "SELECT * FROM consolidated_reporting_jobs WHERE id=1");
            const beforeCalls = calls.slice();
            const retried = await retry({}, "fixture-grant", 1);
            assert.strictEqual(retried.success, emailOutcome === "FAILED");
            assert.deepStrictEqual(calls, beforeCalls, "requeue never repeats close/backup/completion/print or sends synchronously");
            const after = await get(db, "SELECT * FROM consolidated_reporting_jobs WHERE id=1");
            for (const key of ["payload_json", "payload_hash", "sheet_delivered_at", "sheet_status", "sheet_attempt_count", "closing_id", "close_sequence"])
                assert.strictEqual(after[key], before[key], `retry changed ${key}`);
            if (emailOutcome === "FAILED") {
                assert.strictEqual(after.email_status, "PENDING");
                currentEmailOutcome = "DELIVERED";
                clock = new Date(clock.getTime() + 61000);
                assert.strictEqual((await email.processForJob(1)).status, "DELIVERED");
                assert.strictEqual((await sheet.processForJob(1)).processed, false, "successful Sheet is never resent");
                assert.strictEqual((await get(db, "SELECT payload_hash FROM consolidated_reporting_jobs WHERE id=1")).payload_hash, before.payload_hash);
            }
            await run(db, "UPDATE consolidated_reporting_jobs SET email_status='FAILED',email_delivered_at=NULL,email_last_error='STALE_SUPERSEDED: fixture' WHERE id=1");
            assert.strictEqual((await email.retryForClosing(1)).requeued, false);
            await run(db, "UPDATE consolidated_reporting_jobs SET sheet_status='FAILED',sheet_delivered_at=NULL,sheet_last_error='STALE_SUPERSEDED: fixture' WHERE id=1");
            assert.strictEqual((await sheet.retryForClosing(1)).requeued, false);
            await run(db, "UPDATE consolidated_reporting_jobs SET sheet_last_error='REJECTED: fixture',email_status='DELIVERED',email_delivered_at=? WHERE id=1", [clock.toISOString()]);
            const successfulEmail = await get(db, "SELECT email_status,email_delivered_at,email_attempt_count FROM consolidated_reporting_jobs WHERE id=1");
            assert.strictEqual((await retry({}, "fixture-grant", 1)).success, true);
            assert.strictEqual((await get(db, "SELECT sheet_status FROM consolidated_reporting_jobs WHERE id=1")).sheet_status, "PENDING");
            assert.deepStrictEqual(await get(db, "SELECT email_status,email_delivered_at,email_attempt_count FROM consolidated_reporting_jobs WHERE id=1"), successfulEmail);
        }
    } finally {
        await new Promise(resolve => db.close(resolve));
        fs.rmSync(temp, { recursive: true, force: true });
    }
}

async function testConnectivity() {
    const source = fs.readFileSync("src/main/statusService.js", "utf8");
    const start = source.indexOf("function getInternetStatus(");
    const end = source.indexOf("/*", start);
    let destroyed = false;
    const check = vm.runInNewContext(source.slice(start, end) + "\ngetInternetStatus", {
        setTimeout, clearTimeout, https: { get: () => ({ on: () => {}, setTimeout: () => {}, destroy: () => { destroyed = true; } }) }
    });
    const state = await check({ timeoutMs: 10 });
    assert.strictEqual(state.online, false); assert.strictEqual(destroyed, true);
}

async function testSheetRetryHash() {
    const { db } = await fixture();
    let clock = new Date("2026-10-01T06:01:00.000Z");
    const submissions = [];
    try {
        await run(db, "UPDATE consolidated_reporting_jobs SET email_attempt_count=1,email_last_error='RETRYABLE_EMAIL_FAILURE: fixture' WHERE id=1");
        const worker = createConsolidatedSheetDeliveryWorker({ database: db, now: () => clock,
            configProvider: () => ({ endpoint: "https://fixture.invalid", secret: "test-only" }),
            httpClient: { post: async (_url, envelope) => { submissions.push(envelope); return { status: 500 }; } }
        });
        assert.strictEqual((await worker.processForJob(1)).status, "PENDING");
        await run(db, "UPDATE consolidated_reporting_jobs SET email_status='DELIVERED' WHERE id=1");
        clock = new Date(clock.getTime() + 61000);
        assert.strictEqual((await worker.processForJob(1)).status, "PENDING");
        assert.strictEqual(submissions.length, 2);
        assert.strictEqual(submissions[0].payloadHash, submissions[1].payloadHash,
            "an already attempted Sheet payload stays identical even after later Email delivery");
        assert.deepStrictEqual(submissions[0].payload, submissions[1].payload);
    } finally { await new Promise(resolve => db.close(resolve)); }
}

async function testRetryAuthorization() {
    let click;
    let resolveGrant;
    let visible = true;
    let retries = 0;
    const button = { disabled: false, textContent: "RETRY FAILED TASKS", addEventListener: (_event, fn) => { click = fn; } };
    const state = { attemptId: 5, finalContext: [{ snapshotId: 1 }] };
    const context = {
        document: { getElementById: () => button },
        overlay: { classList: { remove: () => { visible = false; } } },
        dayClosingRetryAuthorizing: false,
        dayClosingLifecycleState: { getCurrent: () => state, isCurrent: id => id === state.attemptId },
        requestAdminAuthorization: purpose => {
            assert.strictEqual(purpose, "DSR_SYNC_RETRY");
            return new Promise(resolve => { resolveGrant = resolve; });
        },
        renderDayClosingLifecycleState: () => { assert.strictEqual(context.dayClosingRetryAuthorizing, false); visible = true; },
        updateDayClosingLifecycleStage: () => {},
        window: { electronAPI: {
            retryDayClosingDsrSync: async (grant, id) => { assert.strictEqual(grant, "authorized"); assert.strictEqual(id, 1); retries += 1; return { success: true }; },
            showMessageBox: async () => {}
        } }
    };
    const start = uiSource.indexOf('document.getElementById("dcLifecycleRetryBtn").addEventListener');
    vm.runInNewContext(uiSource.slice(start, uiSource.indexOf("if (!dayClosingLifecycleListenerBound)", start)), context);
    const cancelled = click({ currentTarget: button });
    assert.strictEqual(visible, false, "lifecycle yields to the existing Administrator modal");
    assert.strictEqual(context.dayClosingRetryAuthorizing, true);
    await click({ currentTarget: button }); // Duplicate click is ignored.
    resolveGrant(null);
    await cancelled;
    assert.strictEqual(retries, 0, "cancelled Administrator authorization does not requeue anything");
    assert.strictEqual(visible, true); assert.strictEqual(button.disabled, false);
    const authorized = click({ currentTarget: button });
    resolveGrant("authorized");
    await authorized;
    assert.strictEqual(retries, 1); assert.strictEqual(button.disabled, false);
    assert.strictEqual(button.textContent, "RETRY FAILED TASKS");
    assert(uiSource.includes("if (!dayClosingRetryAuthorizing)"), "background render cannot cover authorization or steal PIN focus");
}

(async () => {
    await testClosing("DELIVERED", true);
    await testClosing("PENDING", true);
    await testClosing("FAILED", true);
    await testClosing("PENDING", false);
    await testConnectivity();
    await testSheetRetryHash();
    await testRetryAuthorization();
    const retryUI = uiSource.slice(uiSource.indexOf('document.getElementById("dcLifecycleRetryBtn").addEventListener'),
        uiSource.indexOf("if (!dayClosingLifecycleListenerBound)"));
    assert(retryUI.includes('requestAdminAuthorization("DSR_SYNC_RETRY")'));
    assert(retryUI.includes("retryDayClosingDsrSync(grant, snapshotId)"));
    assert(!/closeBusinessDay|printDayClosing|startDayClosing|createBackup/.test(retryUI));
    assert(uiSource.indexOf('updateDayClosingLifecycleStage("EMAIL_RESULT", attemptId') <
        uiSource.indexOf('updateDayClosingLifecycleStage("UPDATING_DSR", attemptId'));
    console.log("Day Closing sequence/status/offline/selective-retry tests: PASS (7 scenarios)");
})().catch(error => { console.error(error); process.exitCode = 1; });
