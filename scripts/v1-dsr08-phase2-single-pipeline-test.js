const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const { createDayClosingService } = require("../src/database/dayClosingService");
const { migrateConsolidatedReportingJobs } = require("../src/database/dayClosingMigration");
const { sha256Utf8 } = require("../src/services/consolidatedReportingTransport");
const { canonicalizeSemanticPayload } = require("../src/shared/consolidatedDsrBuilder");
const { createConsolidatedSheetDeliveryWorker, resolveConsolidatedDsrConfiguration } = require("../src/services/consolidatedSheetDeliveryWorker");
const {
    createConsolidatedReportingEmailWorker,
    formatBusinessDateForEmail,
    formatClosedAtForEmail,
    buildConsolidatedEmailSubject,
    BUSINESS_TIME_ZONE
} = require("../src/services/consolidatedReportingEmailWorker");
const { REPORTING_MODES, resolveReportingMode } = require("../src/services/reportingMode");

const MODES = ["cash", "upi", "card", "storeCreditRedeemed", "giftVoucherRedeemed"];
const NOW = "2026-09-24T12:00:00.000Z";
const FIXTURE_DSR_RUNTIME = Object.freeze({ endpoint: "https://fixture.invalid/dsr", secret: "fixture-runtime-secret" });

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => db.run(sql, params, function(error) {
        if (error) reject(error); else resolve({ changes: this.changes, lastID: this.lastID });
    }));
}
function get(db, sql, params = []) {
    return new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
}
function all(db, sql, params = []) {
    return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
}
function close(db) {
    return new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
}

async function testDsrConnectionAuthority() {
    const runtimeProvider = () => ({ ...FIXTURE_DSR_RUNTIME });
    const legacyRuntime = await resolveConsolidatedDsrConfiguration({ integrationConfigProvider: runtimeProvider });
    const consolidatedRuntime = await resolveConsolidatedDsrConfiguration({
        environment: { KLBS_CONSOLIDATED_DSR_WEB_APP_URL: "https://wrong.invalid", KLBS_CONSOLIDATED_DSR_SYNC_SECRET: "wrong-fixture-secret" },
        integrationConfigProvider: runtimeProvider
    });
    assert.deepStrictEqual(legacyRuntime, FIXTURE_DSR_RUNTIME);
    assert.deepStrictEqual(consolidatedRuntime, FIXTURE_DSR_RUNTIME);
    assert.deepStrictEqual(await resolveConsolidatedDsrConfiguration({ integrationConfigProvider: () => ({ endpoint: FIXTURE_DSR_RUNTIME.endpoint }) }), { endpoint: FIXTURE_DSR_RUNTIME.endpoint, secret: "" });
    assert.deepStrictEqual(await resolveConsolidatedDsrConfiguration({ integrationConfigProvider: () => ({ secret: FIXTURE_DSR_RUNTIME.secret }) }), { endpoint: "", secret: FIXTURE_DSR_RUNTIME.secret });
}

async function testEmailDatePresentation() {
    const payload = payloadFor({ closingId: 8, businessDate: "2026-09-22", closeSequence: "1" });
    payload.closedAt = "2026-09-24T05:22:49.219Z";
    const canonicalPayloadJson = canonicalizeSemanticPayload(payload);
    const canonicalPayloadHash = sha256Utf8(canonicalPayloadJson);
    const canonicalBusinessDate = payload.businessDate;
    const canonicalClosedAt = payload.closedAt;
    const email = createConsolidatedReportingEmailWorker({
        database: {},
        sendEmail: async () => {},
        getBackupPath: async () => "fixture",
        validateBackup: async () => ({ success: true })
    });
    const text = email.buildEmailText(payload);
    assert.strictEqual(formatBusinessDateForEmail(payload.businessDate), "22 Sep 2026");
    assert.strictEqual(formatClosedAtForEmail(payload.closedAt), "24 Sep 2026, 10:52:49 AM");
    assert.strictEqual(BUSINESS_TIME_ZONE, "Asia/Kolkata");
    assert.strictEqual(buildConsolidatedEmailSubject(payload.businessDate, payload.closeSequence), "KAIRA LUXE - Daily DSR - 22 Sep 2026 - Close 1");
    assert.match(text, /Business Date: 22 Sep 2026/);
    assert.match(text, /Closed At: 24 Sep 2026, 10:52:49 AM/);
    assert.doesNotMatch(text, /2026-09-24T05:22:49\.219Z|Asia\/Kolkata|\bIST\b|\+05:30/);
    assert.strictEqual(payload.businessDate, canonicalBusinessDate);
    assert.strictEqual(payload.closedAt, canonicalClosedAt);
    assert.strictEqual(canonicalizeSemanticPayload(payload), canonicalPayloadJson);
    assert.strictEqual(sha256Utf8(canonicalizeSemanticPayload(payload)), canonicalPayloadHash);
}
function payloadFor({ closingId, businessDate = "2026-09-24", closeSequence = "1" }) {
    const segment = () => ({ bills: 1, qtySold: 2, netContributionPaise: "1000", cashPaise: "500", upiPaise: "200", cardPaise: "100", storeCreditRedeemedPaise: "100", giftVoucherRedeemedPaise: "100" });
    return {
        contractVersion: 2, snapshotVersion: 2, businessDate, closingId: String(closingId), closeSequence: String(closeSequence),
        closedAt: NOW, klbsVersion: "1.1.0", reportStatus: "FINAL",
        dataQuality: { status: "COMPLETE", diagnostics: [], affectedBills: [] },
        overall: {
            totalBills: 3, qtySold: 6, grossSalesPaise: "3000", totalDiscountPaise: "0", netBillingPaise: "3000",
            creditNoteCount: 0, qtyReturned: 0, returnCnValuePaise: "0", netSalesAfterReturnsPaise: "3000",
            cashPaise: "1500", upiPaise: "600", cardPaise: "300", storeCreditRedeemedPaise: "300", giftVoucherRedeemedPaise: "300",
            settlementTotalPaise: "3000", actualMoneyCollectionPaise: "2400", storeCreditIssuedPaise: "0", settlementDifferencePaise: "0",
            storeCreditLedgerRedeemedPaise: "300", storeCreditLedgerDifferencePaise: "0", backupStatus: "SUCCESS", backupReference: `backup-${closingId}.zip`, emailStatus: "PENDING"
        },
        segments: { KL: segment(), MENS: segment(), KIDS: segment() },
        paymentReconciliation: Object.fromEntries(MODES.map(mode => [mode, { overallPaise: "0", segmentSumPaise: "0", deltaPaise: "0", status: "PASS" }])),
        sourceAudit: { billPopulation: "fixture" }
    };
}
async function setupJobsDb() {
    const db = new sqlite3.Database(":memory:");
    await migrateConsolidatedReportingJobs(db);
    await run(db, `CREATE TABLE day_closing_snapshots (
        id INTEGER PRIMARY KEY, business_date TEXT, close_sequence INTEGER, close_status TEXT,
        closed_at TEXT, backup_status TEXT, backup_reference TEXT, email_status TEXT, updated_at TEXT
    )`);
    return db;
}
async function insertJob(db, { id, sequence = 1, businessDate = "2026-09-24", status = "PENDING", emailStatus = "PENDING", backupReference = `backup-${id}.zip` }) {
    const payload = payloadFor({ closingId: id, businessDate, closeSequence: String(sequence) });
    const payloadJson = JSON.stringify(payload);
    await run(db, `INSERT INTO day_closing_snapshots (id,business_date,close_sequence,close_status,closed_at,backup_status,backup_reference,email_status,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?)`, [id, payload.businessDate, sequence, "CLOSED", NOW, "SUCCESS", backupReference, "PENDING", NOW]);
    await run(db, `INSERT INTO consolidated_reporting_jobs
        (closing_id,business_date,close_sequence,contract_version,snapshot_version,payload_json,payload_hash,report_status,data_quality_status,created_at,
         sheet_status,sheet_attempt_count,email_status,email_attempt_count)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [id, payload.businessDate, sequence, 2, 2, payloadJson, sha256Utf8(payloadJson), "FINAL", "COMPLETE", NOW, status, 0, emailStatus, 0]);
}
function response(action, envelope) {
    return { status: action === "INSERTED" ? 201 : 200, data: {
        ok: true, transportVersion: 1, action, businessDate: envelope.payload.businessDate,
        closingId: envelope.payload.closingId, closeSequence: envelope.payload.closeSequence,
        payloadHash: envelope.payloadHash, receivedAt: NOW
    }};
}

async function testModeAndDayCloseGate() {
    assert.strictEqual(resolveReportingMode({}), REPORTING_MODES.CONSOLIDATED_V2);
    assert.strictEqual(resolveReportingMode({ KLBS_REPORTING_MODE: "LEGACY" }), REPORTING_MODES.LEGACY);
    const db = new sqlite3.Database(":memory:");
    await run(db, `CREATE TABLE day_closing_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT, business_date TEXT NOT NULL, close_sequence INTEGER NOT NULL,
        snapshot_version INTEGER NOT NULL, close_status TEXT NOT NULL, closed_at TEXT, closed_by TEXT,
        total_bills INTEGER, qty_sold INTEGER, gross_sales_paise INTEGER, total_discount_paise INTEGER, net_billing_paise INTEGER,
        credit_note_count INTEGER, qty_returned INTEGER, return_cn_value_paise INTEGER, net_sales_after_returns_paise INTEGER,
        cash_paise INTEGER, upi_paise INTEGER, card_paise INTEGER, store_credit_redeemed_paise INTEGER, gift_voucher_redeemed_paise INTEGER,
        settlement_total_paise INTEGER, actual_money_collection_paise INTEGER, store_credit_issued_paise INTEGER, settlement_difference_paise INTEGER,
        store_credit_ledger_redeemed_paise INTEGER, store_credit_ledger_difference_paise INTEGER, backup_status TEXT, backup_reference TEXT,
        email_status TEXT, dsr_sync_status TEXT, created_at TEXT, updated_at TEXT, UNIQUE(business_date, close_sequence))`);
    await run(db, `CREATE TABLE business_day_state (business_date TEXT PRIMARY KEY, state TEXT, opened_at TEXT, closed_at TEXT, updated_at TEXT)`);
    await run(db, `CREATE TABLE bills (id INTEGER PRIMARY KEY, bill_date TEXT, total_qty INTEGER, gross_amount REAL, discount_amount REAL, net_amount REAL, cash_amount REAL, upi_amount REAL, card_amount REAL, store_credit_amount REAL, gift_voucher_amount REAL)`);
    await run(db, `CREATE TABLE returns (id INTEGER, net_reversal REAL, accounting_status TEXT, credit_note_no TEXT, accounting_snapshot_version INTEGER, business_date TEXT)`);
    await run(db, `CREATE TABLE return_items (return_id INTEGER, quantity INTEGER)`);
    await run(db, `CREATE TABLE customer_credit_transactions (id INTEGER, transaction_type TEXT, amount REAL, created_at TEXT)`);
    await run(db, "INSERT INTO business_day_state VALUES ('2026-09-24','OPEN','2026-09-24T00:00:00.000Z',NULL,?)", [NOW]);
    let backups = 0; let verified = 0; let legacyEnqueues = 0;
    const service = createDayClosingService({
        database: db, now: () => new Date(NOW), getBusinessDate: () => "2026-09-24", klbsVersion: "1.1.0", reportingMode: REPORTING_MODES.CONSOLIDATED_V2,
        createBackup: async () => { backups += 1; return { backupFileName: "backup-close-1.zip", backupFilePath: "C:\\fixture\\backup-close-1.zip" }; },
        validateBackup: async filePath => { verified += 1; assert.strictEqual(filePath, "C:\\fixture\\backup-close-1.zip"); return { success: true }; },
        consolidatedReportingPersistence: { createFrozenJobWithinTransaction: async snapshot => ({ jobId: 1, payloadHash: "fixture", payload: { dataQuality: { status: "COMPLETE" } } }) },
        integrationOutbox: { enqueue: async () => { legacyEnqueues += 1; } },
        segmentDsrOutbox: { enqueue: async () => { legacyEnqueues += 1; } }
    });
    const result = await service.closeBusinessDay("2026-09-24");
    const snapshot = await get(db, "SELECT backup_status,backup_reference,close_status FROM day_closing_snapshots WHERE id=?", [result.snapshotId]);
    assert.strictEqual(result.success, true); assert.strictEqual(backups, 1); assert.strictEqual(verified, 1); assert.strictEqual(legacyEnqueues, 0);
    assert.deepStrictEqual(snapshot, { backup_status: "SUCCESS", backup_reference: "backup-close-1.zip", close_status: "CLOSED" });
    await close(db);
}

async function testSheetAndEmailUseFrozenJobAndExactBackup() {
    const db = await setupJobsDb();
    await insertJob(db, { id: 11, backupReference: "backup-11.zip" });
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "klbs-dsr08-"));
    const exact = path.join(temp, "backup-11.zip");
    fs.writeFileSync(exact, "fixture backup");
    fs.writeFileSync(path.join(temp, "older.zip"), "older");
    fs.writeFileSync(path.join(temp, "newer-unrelated.zip"), "newer");
    let sent = {}; let backupValidation = 0;
    const sheet = createConsolidatedSheetDeliveryWorker({
        database: db, now: () => new Date(NOW), configProvider: () => ({ endpoint: "https://fixture.invalid/c4d", secret: "fixture-secret" }),
        httpClient: { post: async (url, envelope) => { Object.assign(sent, { url, envelope }); return response("INSERTED", envelope); } }
    });
    const email = createConsolidatedReportingEmailWorker({
        database: db, now: () => new Date(NOW), sendEmail: async value => { sent.email = value; },
        getEmailConfiguration: async () => ({ automaticEmailBackup: true, recipients: ["fixture@example.invalid"] }),
        getBackupPath: async reference => path.join(temp, reference), validateBackup: async value => { backupValidation += 1; assert.strictEqual(value, exact); return { success: true }; }
    });
    assert.strictEqual((await sheet.processNext()).processed, false, "Sheet cannot overtake unattempted Email");
    assert.strictEqual((await email.processNext()).status, "DELIVERED");
    assert.strictEqual((await sheet.processNext()).status, "DELIVERED");
    assert.strictEqual(sent.envelope.payload.overall.emailStatus, "SUCCESS");
    assert.strictEqual(sent.envelope.payload.contractVersion, 2);
    const storedJob = await get(db, "SELECT payload_hash FROM consolidated_reporting_jobs WHERE closing_id=11");
    assert.strictEqual(sent.envelope.payloadHash, storedJob.payload_hash);
    assert.strictEqual(sent.email.attachments[0].path, exact);
    assert.strictEqual(backupValidation, 1);
    assert.match(sent.email.text, /KL\n/); assert.match(sent.email.text, /MENS\n/); assert.match(sent.email.text, /KIDS\n/); assert.doesNotMatch(sent.email.text, /MTD/i);
    const after = await get(db, "SELECT sheet_status,email_status FROM consolidated_reporting_jobs WHERE closing_id=11");
    assert.deepStrictEqual(after, { sheet_status: "DELIVERED", email_status: "DELIVERED" });
    fs.rmSync(temp, { recursive: true, force: true });
    await close(db);
}

async function testPendingOldSequenceIsSupersededAndNewBackupUsed() {
    const db = await setupJobsDb();
    await insertJob(db, { id: 21, sequence: 1, backupReference: "backup-21.zip" });
    await run(db, "UPDATE day_closing_snapshots SET close_status='REOPENED' WHERE id=21");
    await insertJob(db, { id: 22, sequence: 2, backupReference: "backup-22.zip" });
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "klbs-dsr08-reclose-"));
    const backup22 = path.join(temp, "backup-22.zip"); fs.writeFileSync(backup22, "new backup"); fs.writeFileSync(path.join(temp, "backup-21.zip"), "old backup");
    const sent = [];
    const email = createConsolidatedReportingEmailWorker({
        database: db, now: () => new Date(NOW), sendEmail: async value => sent.push(value),
        getEmailConfiguration: async () => ({ automaticEmailBackup: true, recipients: ["fixture@example.invalid"] }),
        getBackupPath: async reference => path.join(temp, reference), validateBackup: async () => ({ success: true })
    });
    const first = await email.processNext();
    const oldRow = await get(db, "SELECT email_status,email_last_error FROM consolidated_reporting_jobs WHERE closing_id=21");
    assert.strictEqual(oldRow.email_status, "FAILED"); assert.match(oldRow.email_last_error, /STALE_SUPERSEDED/);
    assert.strictEqual(first.status, "DELIVERED"); assert.strictEqual(sent.length, 1); assert.strictEqual(sent[0].attachments[0].path, backup22);
    fs.rmSync(temp, { recursive: true, force: true });
    await close(db);
}

async function testCurrentClosingJobIsTargeted() {
    const db = await setupJobsDb();
    await insertJob(db, { id: 41, businessDate: "2026-09-23" });
    await insertJob(db, { id: 42, businessDate: "2026-09-24" });
    const current = await get(db, "SELECT id FROM consolidated_reporting_jobs WHERE closing_id=42");
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "klbs-dsr08-current-"));
    fs.writeFileSync(path.join(temp, "backup-42.zip"), "current verified backup");
    let sheetSends = 0;
    let emailSends = 0;
    const outcomes = [];
    const sheet = createConsolidatedSheetDeliveryWorker({
        database: db, now: () => new Date(NOW),
        onOutcome: outcome => outcomes.push({ channel: "sheet", ...outcome }),
        configProvider: () => ({ endpoint: "https://fixture.invalid/c4d", secret: "fixture-secret" }),
        httpClient: { post: async (_, envelope) => { sheetSends += 1; return response("INSERTED", envelope); } }
    });
    const email = createConsolidatedReportingEmailWorker({
        database: db, now: () => new Date(NOW),
        onOutcome: outcome => outcomes.push({ channel: "email", ...outcome }),
        sendEmail: async () => { emailSends += 1; },
        getEmailConfiguration: async () => ({ automaticEmailBackup: true, recipients: ["fixture@example.invalid"] }),
        getBackupPath: async reference => path.join(temp, reference),
        validateBackup: async () => ({ success: true })
    });
    assert.strictEqual((await email.processForJob(current.id)).status, "DELIVERED");
    assert.strictEqual((await sheet.processForJob(current.id)).status, "DELIVERED");
    assert.deepStrictEqual([sheetSends, emailSends], [1, 1]);
    assert.deepStrictEqual(outcomes, [
        { channel: "email", jobId: current.id, status: "DELIVERED" },
        { channel: "sheet", jobId: current.id, status: "DELIVERED" }
    ]);
    const old = await get(db, "SELECT sheet_status,email_status FROM consolidated_reporting_jobs WHERE closing_id=41");
    const now = await get(db, "SELECT sheet_status,email_status FROM consolidated_reporting_jobs WHERE closing_id=42");
    assert.deepStrictEqual(old, { sheet_status: "PENDING", email_status: "PENDING" });
    assert.deepStrictEqual(now, { sheet_status: "DELIVERED", email_status: "DELIVERED" });
    fs.rmSync(temp, { recursive: true, force: true });
    await close(db);
}

async function testMissingExactBackupDoesNotFallback() {
    const db = await setupJobsDb();
    await insertJob(db, { id: 31, backupReference: "missing-exact.zip" });
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "klbs-dsr08-missing-"));
    fs.writeFileSync(path.join(temp, "newer-unrelated.zip"), "unrelated");
    let sends = 0;
    const email = createConsolidatedReportingEmailWorker({
        database: db, now: () => new Date(NOW), sendEmail: async () => { sends += 1; },
        getEmailConfiguration: async () => ({ automaticEmailBackup: true, recipients: ["fixture@example.invalid"] }),
        getBackupPath: async reference => path.join(temp, reference), validateBackup: async () => ({ success: true })
    });
    const result = await email.processNext();
    const row = await get(db, "SELECT email_status,email_last_error FROM consolidated_reporting_jobs WHERE closing_id=31");
    assert.strictEqual(result.status, "FAILED"); assert.strictEqual(row.email_status, "FAILED"); assert.match(row.email_last_error, /backup/i); assert.strictEqual(sends, 0);
    fs.rmSync(temp, { recursive: true, force: true });
    await close(db);
}

async function main() {
    await testDsrConnectionAuthority();
    await testEmailDatePresentation();
    await testModeAndDayCloseGate();
    await testSheetAndEmailUseFrozenJobAndExactBackup();
    await testPendingOldSequenceIsSupersededAndNewBackupUsed();
    await testCurrentClosingJobIsTargeted();
    await testMissingExactBackupDoesNotFallback();
    console.log("DSR-08 Phase 2 single-pipeline fixture tests: PASS");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
