const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const sqlite3 = require("sqlite3").verbose();
const { CURRENT_DB_SCHEMA_VERSION } = require("../src/database/schemaVersion");

const RESULT_PREFIX = "REG02_RESULT=";
const LEGACY_SCHEMA_VERSION = 3;
const CHILD_PHASE_TIMEOUT_MS = 5 * 60 * 1000;
const CHILD_TERM_GRACE_MS = 5000;
const CHILD_KILL_GRACE_MS = 5000;

function childProgress(phase, step) {
    process.stdout.write(`REG02_CHILD phase=${phase} step=${step} pid=${process.pid}\n`);
}

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => db.run(sql, params, function(error) {
        error ? reject(error) : resolve(this);
    }));
}

function get(db, sql, params = []) {
    return new Promise((resolve, reject) => db.get(sql, params, (error, row) => {
        error ? reject(error) : resolve(row || null);
    }));
}

function all(db, sql, params = []) {
    return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => {
        error ? reject(error) : resolve(rows || []);
    }));
}

function exec(db, sql) {
    return new Promise((resolve, reject) => db.exec(sql, error => error ? reject(error) : resolve()));
}

function close(db) {
    return new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
}

async function createLegacyFixture(databasePath) {
    const db = new sqlite3.Database(databasePath);
    await exec(db, fs.readFileSync(path.join(__dirname, "..", "database_schema.sql"), "utf8"));
    await run(db, "INSERT INTO klbs_schema_metadata (id, schema_version) VALUES (1, ?)", [LEGACY_SCHEMA_VERSION]);
    await run(db, `INSERT INTO products
        (barcode, sku, brand, segment, category, product_name, mrp, selling_price, gst_rate, active, business_segment)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ["REG02-LEGACY", "KL-LEGACY-001", "Legacy Brand", "L'Oréal Men", "Legacy", "Legacy Product", 100, 100, 5, 1, "KL"]);
    await run(db, "INSERT INTO business_day_state (business_date, state, opened_at, updated_at) VALUES (?, 'OPEN', ?, ?)", [
        "2026-09-21", "2026-09-21T09:00:00.000Z", "2026-09-21T09:00:00.000Z"
    ]);
    await close(db);
}

async function childMain(tempRoot, phase) {
    childProgress(phase, "started");
    const { app } = require("electron");
    app.setPath("userData", path.join(tempRoot, "user data"));
    childProgress(phase, "user-data-configured");
    const database = require("../src/database/database");
    childProgress(phase, "database-module-loaded-waiting-ready");
    await database.databaseReady;
    childProgress(phase, "database-ready-migrations-complete");

    const db = database;
    childProgress(phase, "migration-table-inspection-started");
    const table = await get(db, "SELECT name, sql FROM sqlite_master WHERE type='table' AND name='consolidated_reporting_jobs'");
    assert(table, "startup migration did not create consolidated_reporting_jobs");
    childProgress(phase, "migration-column-checks-started");
    for (const column of [
        "id", "closing_id", "business_date", "close_sequence", "contract_version", "snapshot_version",
        "payload_json", "payload_hash", "report_status", "data_quality_status", "created_at",
        "sheet_status", "sheet_attempt_count", "sheet_last_error", "sheet_delivered_at",
        "email_status", "email_attempt_count", "email_last_error", "email_delivered_at"
    ]) {
        assert((await all(db, "PRAGMA table_info(consolidated_reporting_jobs)")).some(value => value.name === column), column);
    }
    childProgress(phase, "migration-column-checks-complete");
    assert(/UNIQUE\s*\(closing_id\)/i.test(table.sql));
    assert(/UNIQUE\s*\(business_date,\s*close_sequence\)/i.test(table.sql));
    assert(await get(db, "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_consolidated_reporting_jobs_pending'"));
    assert.strictEqual((await get(db, "SELECT product_name FROM products WHERE barcode='REG02-LEGACY'")).product_name, "Legacy Product");
    assert(CURRENT_DB_SCHEMA_VERSION > LEGACY_SCHEMA_VERSION, "REG-02 fixture must predate the current database schema");
    assert.strictEqual((await get(db, "SELECT schema_version FROM klbs_schema_metadata WHERE id=1")).schema_version, CURRENT_DB_SCHEMA_VERSION);
    childProgress(phase, "migration-assertions-complete");

    if (phase === "verify-only") {
        assert.strictEqual((await get(db, "SELECT state FROM business_day_state WHERE business_date='2026-09-21'")).state, "CLOSED",
            "startup migration re-verification must preserve the authoritative closed business day");
        const latestSnapshot = await get(db, `SELECT close_sequence, close_status, backup_status, backup_reference
            FROM day_closing_snapshots WHERE business_date='2026-09-21' ORDER BY close_sequence DESC LIMIT 1`);
        assert.deepStrictEqual(latestSnapshot, {
            close_sequence: 2,
            close_status: "CLOSED",
            backup_status: "PENDING",
            backup_reference: null
        }, "startup migration re-verification must preserve the post-close persistence failure state");
        assert.strictEqual((await get(db, "SELECT COUNT(*) AS count FROM consolidated_reporting_jobs WHERE business_date='2026-09-21'")).count, 1,
            "startup migration re-verification must not duplicate or discard the prior reporting job");
        childProgress(phase, "database-close-started");
        await database.closeDatabase();
        childProgress(phase, "database-close-complete");
        process.stdout.write(`${RESULT_PREFIX}${JSON.stringify({ table: true, idempotent: true })}\n`);
        childProgress(phase, "electron-app-exit-requested");
        app.exit(0);
        return;
    }

    const { createConsolidatedReportingPersistenceService } = require("../src/services/consolidatedReportingPersistenceService");
    const { createDayClosingService } = require("../src/database/dayClosingService");
    const persistence = createConsolidatedReportingPersistenceService({ database: db });
    const service = createDayClosingService({
        database: db,
        consolidatedReportingPersistence: persistence,
        now: () => new Date("2026-09-21T18:00:00.000Z"),
        getBusinessDate: () => "2026-09-21",
        createBackup: async () => ({ backupFileName: "reg02-backup.zip", backupFilePath: "reg02-backup.zip" }),
        validateBackup: async () => ({ success: true }),
        integrationOutbox: { enqueue: async () => {} },
        segmentDsrOutbox: { enqueue: async () => {} },
        logBusinessDayClosed: async () => {},
        logBusinessDayReopened: async () => {},
        klbsVersion: "1.1.0"
    });
    childProgress(phase, "business-day-close-started");
    const closeResult = await service.closeBusinessDay("2026-09-21");
    childProgress(phase, "business-day-close-complete");
    assert.strictEqual(closeResult.success, true);
    assert.strictEqual(closeResult.snapshot.closeStatus, "CLOSED");
    const job = await get(db, "SELECT * FROM consolidated_reporting_jobs WHERE closing_id=?", [closeResult.snapshotId]);
    assert(job);
    assert.strictEqual(job.business_date, "2026-09-21");
    assert(Number.isInteger(job.close_sequence));
    assert(job.close_sequence >= 1);
    assert.strictEqual(job.payload_hash.length, 64);
    assert.strictEqual((await get(db, "SELECT state FROM business_day_state WHERE business_date='2026-09-21'")).state, "CLOSED");

    childProgress(phase, "business-day-reopen-started");
    await service.reopenBusinessDay("REG02 migration regression");
    childProgress(phase, "business-day-reopen-complete");
    const oldPayload = await get(db, "SELECT payload_json, payload_hash FROM consolidated_reporting_jobs WHERE closing_id=?", [closeResult.snapshotId]);
    assert(oldPayload);

    const failingPersistence = { createFrozenJobWithinTransaction: async () => { throw new Error("REG02 injected persistence failure"); } };
    const failingService = createDayClosingService({
        database: db,
        consolidatedReportingPersistence: failingPersistence,
        now: () => new Date("2026-09-21T18:00:00.000Z"),
        getBusinessDate: () => "2026-09-21",
        createBackup: async () => ({ backupFileName: "reg02-failure.zip", backupFilePath: "reg02-failure.zip" }),
        validateBackup: async () => ({ success: true }),
        integrationOutbox: { enqueue: async () => {} },
        segmentDsrOutbox: { enqueue: async () => {} }
    });
    childProgress(phase, "rollback-close-started");
    await assert.rejects(() => failingService.closeBusinessDay("2026-09-21"), /REG02 injected persistence failure/);
    childProgress(phase, "rollback-close-assertion-complete");
    assert.strictEqual((await get(db, "SELECT state FROM business_day_state WHERE business_date='2026-09-21'")).state, "CLOSED",
        "post-close reporting persistence failure must not reopen the authoritative business day");
    const reopenedSnapshot = await get(db, "SELECT close_status, backup_status, backup_reference FROM day_closing_snapshots WHERE id=?", [closeResult.snapshotId]);
    assert.deepStrictEqual(reopenedSnapshot, { close_status: "REOPENED", backup_status: "SUCCESS", backup_reference: "reg02-backup.zip" },
        "the previously completed and reopened close must remain unchanged");
    const failedSnapshot = await get(db, `SELECT id, close_sequence, close_status, backup_status, backup_reference
        FROM day_closing_snapshots WHERE business_date='2026-09-21' ORDER BY close_sequence DESC LIMIT 1`);
    assert(failedSnapshot);
    assert.notStrictEqual(failedSnapshot.id, closeResult.snapshotId);
    assert.strictEqual(failedSnapshot.close_sequence, 2);
    assert.strictEqual(failedSnapshot.close_status, "CLOSED",
        "the authoritative close transaction commits before reporting persistence");
    assert.strictEqual(failedSnapshot.backup_status, "PENDING",
        "the later backup/reporting transaction must roll back as a unit");
    assert.strictEqual(failedSnapshot.backup_reference, null,
        "the rolled-back backup finalization must not persist its reference");
    const jobRowsAfterFailure = await all(db, "SELECT closing_id, close_sequence FROM consolidated_reporting_jobs ORDER BY id");
    assert.strictEqual(jobRowsAfterFailure.length, 1);
    assert.deepStrictEqual(jobRowsAfterFailure, [{ closing_id: closeResult.snapshotId, close_sequence: 1 }],
        "the failed re-close must not create a consolidated reporting job");
    const unchangedPayload = await get(db, "SELECT payload_json, payload_hash FROM consolidated_reporting_jobs WHERE closing_id=?", [closeResult.snapshotId]);
    assert.deepStrictEqual(unchangedPayload, oldPayload);

    childProgress(phase, "database-close-started");
    await database.closeDatabase();
    childProgress(phase, "database-close-complete");
    process.stdout.write(`${RESULT_PREFIX}${JSON.stringify({ table: true, close: true, rollback: true })}\n`);
    childProgress(phase, "electron-app-exit-requested");
    app.exit(0);
}

function signalChild(child, signal) {
    if (!child.pid) return false;
    if (process.platform !== "win32") {
        try {
            process.kill(-child.pid, signal);
            return true;
        }
        catch (error) {
            if (error.code === "ESRCH") return false;
        }
    }
    try {
        return child.kill(signal);
    }
    catch (_) {
        return false;
    }
}

function runChild(tempRoot, phase) {
    const electronBinary = require("electron");
    const phaseLabel = phase === "verify-only" ? "verification/idempotency" : "migration/close/reopen/rollback";
    const args = ["--disable-gpu", "--in-process-gpu", __filename, "--child", tempRoot, phase];

    process.stdout.write(`REG02_PARENT phase=${phase} label=${phaseLabel} event=starting timeoutMs=${CHILD_PHASE_TIMEOUT_MS}\n`);
    return new Promise((resolve, reject) => {
        let stdout = "";
        let stderr = "";
        let timeoutTriggered = false;
        let settled = false;
        let termTimer;
        let killTimer;
        let child;

        const finish = error => {
            if (settled) return;
            settled = true;
            clearTimeout(phaseTimer);
            clearTimeout(termTimer);
            clearTimeout(killTimer);
            if (error) reject(error);
            else resolve();
        };

        const reportCapturedOutput = () => {
            process.stderr.write(`\nREG02_PARENT phase=${phase} label=${phaseLabel} captured-child-stdout-begin\n`);
            process.stderr.write(stdout || "<empty>\n");
            if (!stdout.endsWith("\n")) process.stderr.write("\n");
            process.stderr.write(`REG02_PARENT phase=${phase} label=${phaseLabel} captured-child-stdout-end\n`);
            process.stderr.write(`REG02_PARENT phase=${phase} label=${phaseLabel} captured-child-stderr-begin\n`);
            process.stderr.write(stderr || "<empty>\n");
            if (!stderr.endsWith("\n")) process.stderr.write("\n");
            process.stderr.write(`REG02_PARENT phase=${phase} label=${phaseLabel} captured-child-stderr-end\n`);
        };

        const phaseTimer = setTimeout(() => {
            timeoutTriggered = true;
            process.stderr.write(`REG02_PARENT phase=${phase} label=${phaseLabel} event=timeout pid=${child && child.pid || "unavailable"} timeoutMs=${CHILD_PHASE_TIMEOUT_MS}\n`);
            reportCapturedOutput();
            signalChild(child, "SIGTERM");
            termTimer = setTimeout(() => {
                process.stderr.write(`REG02_PARENT phase=${phase} label=${phaseLabel} event=term-grace-expired action=sigkill pid=${child && child.pid || "unavailable"}\n`);
                signalChild(child, "SIGKILL");
                killTimer = setTimeout(() => {
                    process.stderr.write(`REG02_PARENT phase=${phase} label=${phaseLabel} event=kill-grace-expired; closing captured pipes\n`);
                    if (child && child.stdout) child.stdout.destroy();
                    if (child && child.stderr) child.stderr.destroy();
                    if (child) child.unref();
                    finish(new Error(`REG02 phase timed out: ${phaseLabel} after ${CHILD_PHASE_TIMEOUT_MS}ms; termination was requested.`));
                }, CHILD_KILL_GRACE_MS);
            }, CHILD_TERM_GRACE_MS);
        }, CHILD_PHASE_TIMEOUT_MS);

        try {
            child = spawn(electronBinary, args, {
                cwd: path.resolve(__dirname, ".."),
                env: { ...process.env, KLBS_DEV_DATABASE_PATH: path.join(tempRoot, "billing.db") },
                stdio: ["ignore", "pipe", "pipe"],
                windowsHide: true,
                detached: process.platform !== "win32"
            });
        }
        catch (error) {
            finish(new Error(`REG02 phase failed to spawn (${phaseLabel}): ${error.stack || error.message}`));
            return;
        }

        process.stdout.write(`REG02_PARENT phase=${phase} label=${phaseLabel} event=spawned pid=${child.pid || "unavailable"}\n`);
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", chunk => {
            stdout += chunk;
            process.stdout.write(chunk);
        });
        child.stderr.on("data", chunk => {
            stderr += chunk;
            process.stderr.write(chunk);
        });
        child.on("error", error => {
            process.stderr.write(`REG02_PARENT phase=${phase} label=${phaseLabel} event=child-error pid=${child.pid || "unavailable"} error=${error.stack || error.message}\n`);
            finish(new Error(`REG02 phase could not run (${phaseLabel}): ${error.stack || error.message}\nstdout:\n${stdout}\nstderr:\n${stderr}`));
        });
        child.on("exit", (code, signal) => {
            process.stdout.write(`REG02_PARENT phase=${phase} label=${phaseLabel} event=exit pid=${child.pid} code=${code} signal=${signal}\n`);
        });
        child.on("close", (code, signal) => {
            process.stdout.write(`REG02_PARENT phase=${phase} label=${phaseLabel} event=close pid=${child.pid} code=${code} signal=${signal}\n`);
            if (timeoutTriggered) {
                finish(new Error(`REG02 phase timed out: ${phaseLabel} after ${CHILD_PHASE_TIMEOUT_MS}ms; child closed with code=${code} signal=${signal}.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
                return;
            }
            if (code !== 0 || signal) {
                finish(new Error(`REG02 phase failed (${phaseLabel}); child closed with code=${code} signal=${signal}.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
                return;
            }
            const resultLine = stdout.split(/\r?\n/).find(value => value.startsWith(RESULT_PREFIX));
            if (!resultLine) {
                finish(new Error(`REG02 phase exited without its result marker (${phaseLabel}).\nstdout:\n${stdout}\nstderr:\n${stderr}`));
                return;
            }
            process.stdout.write(`REG02_PARENT phase=${phase} label=${phaseLabel} event=completed pid=${child.pid}\n`);
            finish();
        });
    });
}

(async () => {
    if (process.argv.includes("--child")) {
        const childIndex = process.argv.indexOf("--child");
        const phase = process.argv[childIndex + 2] || "full";
        try {
            await childMain(process.argv[childIndex + 1], phase);
        }
        catch (error) {
            process.stderr.write(`REG02_CHILD phase=${phase} event=error pid=${process.pid}\n${error.stack || error.message}\n`);
            throw error;
        }
        return;
    }
    // Match SQLite's canonical path when the OS temporary directory is a symlink.
    const tempRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "klbs-reg02-upgrade-"));
    process.stdout.write(`REG02_PARENT event=fixture-creation-start pid=${process.pid} tempRoot=${tempRoot}\n`);
    try {
        await createLegacyFixture(path.join(tempRoot, "billing.db"));
        process.stdout.write(`REG02_PARENT event=fixture-creation-complete pid=${process.pid}\n`);
        await runChild(tempRoot, "full");
        await runChild(tempRoot, "verify-only");
        console.log("REG-02 V1.0-to-V1.1 production bootstrap migration test: PASS (upgrade, idempotency, preservation, close, rollback)");
    }
    finally {
        process.stdout.write(`REG02_PARENT event=temporary-cleanup-start pid=${process.pid}\n`);
        fs.rmSync(tempRoot, { recursive: true, force: true });
        process.stdout.write(`REG02_PARENT event=temporary-cleanup-complete pid=${process.pid}\n`);
    }
})().catch(error => {
    process.stderr.write(`REG02_PARENT event=error pid=${process.pid}\n${error.stack || error.message}\n`);
    process.exitCode = 1;
    if (process.versions.electron) {
        try { require("electron").app.exit(1); } catch (_) {}
    }
});
