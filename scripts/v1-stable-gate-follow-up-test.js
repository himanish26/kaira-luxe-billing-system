const assert = require("assert");
const fs = require("fs");
const vm = require("vm");
const sqlite3 = require("sqlite3").verbose();
const { createIntegrationOutboxService } = require("../src/services/integrationOutboxService");
const { buildDayClosingEmailText } = require("../src/services/dayClosingEmail");
const { migrateDayClosingSnapshots, CREATE_DAY_CLOSING_SNAPSHOTS_SQL } = require("../src/database/dayClosingMigration");
const { createDayClosingService } = require("../src/database/dayClosingService");

const run = (db, sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, e => e ? reject(e) : resolve()));
const all = (db, sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (e, rows) => e ? reject(e) : resolve(rows || [])));
const close = db => new Promise(resolve => db.close(resolve));

function dsrNormalizationTests() {
    const source = fs.readFileSync("deployment/google-apps-script/KLBS_DSR_WebApp.gs", "utf8");
    const start = source.indexOf("function normalizeBusinessDate_");
    const end = source.indexOf("function businessDateCell_", start);
    const context = { Utilities: { formatDate: date => "2026-09-02" }, Session: { getScriptTimeZone: () => "Asia/Kolkata" } };
    vm.runInNewContext(`${source.slice(start, end)}; this.normalize = normalizeBusinessDate_;`, context);
    assert.strictEqual(context.normalize("2026-09-02"), "2026-09-02");
    assert.strictEqual(context.normalize(" 2026-09-02 "), "2026-09-02");
    assert.strictEqual(context.normalize("02/09/2026"), "2026-09-02");
    assert.strictEqual(context.normalize("02 Sep, 2026"), "2026-09-02");
    assert.strictEqual(context.normalize(new Date("2026-09-02T12:00:00Z"), "Asia/Kolkata"), "2026-09-02");
    assert(source.includes("getRange(2, 2, sheet.getLastRow() - 1, 1).getValues()"));
    assert(source.includes("var businessDateFormat = sheet.getRange('B3').getNumberFormat();"));
    assert(!source.includes("getDisplayValues()"));
}

dsrNormalizationTests();

async function migrationTests() {
    const db = new sqlite3.Database(":memory:");
    await run(db, "CREATE TABLE bills (bill_date TEXT)");
    await run(db, "CREATE TABLE returns (business_date TEXT)");
    await run(db, CREATE_DAY_CLOSING_SNAPSHOTS_SQL);
    const rows = [
        [1, "2026-09-01", 1, "CLOSED", "SUCCESS", "SUCCESS", "SYNCED"],
        [2, "2026-09-02", 1, "CLOSED", "SUCCESS", "PENDING", "NOT_ATTEMPTED"],
        [3, "2026-09-03", 1, "CLOSED", "SUCCESS", "FAILED", "FAILED"],
        [4, "2026-09-04", 1, "CLOSED", "FAILED", "PENDING", "NOT_ATTEMPTED"]
    ];
    for (const [id, date, sequence, closeStatus, backup, email, dsr] of rows) await run(db, `INSERT INTO day_closing_snapshots (id,business_date,close_sequence,snapshot_version,close_status,backup_status,email_status,dsr_sync_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`, [id,date,sequence,1,closeStatus,backup,email,dsr,"2026-09-05T00:00:00.000Z","2026-09-05T00:00:00.000Z"]);
    await migrateDayClosingSnapshots(db); await migrateDayClosingSnapshots(db);
    assert((await all(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='business_day_state'")).length === 1);
    const outbox = await all(db, "SELECT closing_id,delivery_type FROM integration_outbox ORDER BY closing_id,delivery_type");
    assert.deepStrictEqual(outbox, [{ closing_id: 2, delivery_type: "DSR_DAY_CLOSING" }, { closing_id: 2, delivery_type: "EMAIL_DAY_CLOSING" }, { closing_id: 3, delivery_type: "DSR_DAY_CLOSING" }]);
    await close(db);
}

async function previousDayTests() {
    async function state(setup) {
        const db = new sqlite3.Database(":memory:"); await run(db, "CREATE TABLE bills (bill_date TEXT)"); await run(db, "CREATE TABLE returns (business_date TEXT)"); await run(db, "CREATE TABLE day_closing_snapshots (id INTEGER, business_date TEXT, close_sequence INTEGER, close_status TEXT)"); await setup(db);
        const service = createDayClosingService({ database: db, now: () => new Date("2026-09-03T00:00:00Z"), getBusinessDate: () => "2026-09-03", createBackup: async () => ({}), validateBackup: async () => ({ success: true }) });
        const result = await service.getBusinessDayState(); await close(db); return result.pendingPreviousBusinessDate;
    }
    assert.strictEqual(await state(async db => { await run(db, "INSERT INTO bills VALUES ('2026-09-01')"); await run(db, "INSERT INTO day_closing_snapshots VALUES (1,'2026-09-01',1,'CLOSED')"); }), null);
    assert.strictEqual(await state(async db => run(db, "INSERT INTO bills VALUES ('2026-09-01')")), "2026-09-01");
    assert.strictEqual(await state(async db => { await run(db, "INSERT INTO bills VALUES ('2026-09-01')"); await run(db, "INSERT INTO day_closing_snapshots VALUES (1,'2026-09-01',1,'PREPARING')"); await run(db, "INSERT INTO day_closing_snapshots VALUES (2,'2026-09-01',2,'CLOSED')"); }), null);
    assert.strictEqual(await state(async db => { await run(db, "INSERT INTO bills VALUES ('2026-08-30')"); await run(db, "INSERT INTO day_closing_snapshots VALUES (1,'2026-08-30',1,'CLOSED')"); await run(db, "INSERT INTO bills VALUES ('2026-08-31')"); await run(db, "INSERT INTO bills VALUES ('2026-09-01')"); }), "2026-08-31");
}

async function outboxTests() {
    const db = new sqlite3.Database(":memory:");
    await run(db, "CREATE TABLE day_closing_snapshots (id INTEGER PRIMARY KEY, business_date TEXT, close_status TEXT, backup_reference TEXT, backup_status TEXT, email_status TEXT, dsr_sync_status TEXT, total_bills INTEGER, qty_sold INTEGER, net_billing_paise INTEGER, updated_at TEXT, dsr_synced_at TEXT, dsr_sync_error TEXT)");
    await run(db, "CREATE TABLE integration_outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, business_date TEXT, closing_id INTEGER, close_sequence INTEGER, delivery_type TEXT, status TEXT DEFAULT 'PENDING', attempt_count INTEGER DEFAULT 0, created_at TEXT, last_attempt_at TEXT, completed_at TEXT, last_error TEXT, UNIQUE(closing_id,delivery_type))");
    await run(db, "INSERT INTO day_closing_snapshots VALUES (1,'2026-09-01','CLOSED','backup.zip','SUCCESS','PENDING','NOT_ATTEMPTED',2,3,1000,NULL,NULL,NULL)");
    let email = 0; let dsr = 0; let failEmail = false; let failDsr = true; let outboxNow = new Date("2026-09-05T00:00:00Z");
    const service = createIntegrationOutboxService({ database: db, now: () => new Date("2026-09-05T00:00:00Z"), sendEmail: async m => { email++; assert(m.text.includes("₹10.00")); assert(m.text.includes("Gross Sales")); if (failEmail) throw new Error("email"); }, syncDsr: async () => { dsr++; if (failDsr) return { success: false, error: "dsr" }; return { success: true }; }, readDsrPayload: async () => ({ businessDate: "2026-09-01" }), getEmailConfiguration: async () => ({ automaticEmailBackup: true, recipients: ["redacted@example.invalid"] }), getBackupPath: async () => "backup.zip" });
    await service.enqueue(1, "2026-09-01", 1); await service.drain(); assert.strictEqual(email, 1); assert.strictEqual(dsr, 1);
    failDsr = false; await service.drain(); assert.strictEqual(dsr, 1, `DSR must respect retry cooldown: ${dsr}`); await run(db, "UPDATE integration_outbox SET last_attempt_at='2026-09-04T23:58:00.000Z' WHERE delivery_type='DSR_DAY_CLOSING'"); await service.drain(); assert.strictEqual(email, 1, `email after DSR retry: ${email}`); assert.strictEqual(dsr, 2, `dsr after DSR retry: ${dsr}`);
    failEmail = true; await run(db, "UPDATE integration_outbox SET status='PENDING', last_attempt_at='2026-09-04T23:58:00.000Z' WHERE delivery_type='EMAIL_DAY_CLOSING'"); await service.drain(); assert.strictEqual(email, 2); assert.strictEqual(dsr, 2);
    const view = await service.getStatusView(); assert.strictEqual(view.pendingCount, 1); assert.strictEqual(view.deliveries[0].emailStatus, "PENDING"); assert.strictEqual(view.deliveries[0].dsrStatus, "SUCCESS"); await run(db, "UPDATE integration_outbox SET status='SUCCESS'"); const emptyView = await service.getStatusView(); assert.strictEqual(emptyView.pendingCount, 0); assert.deepStrictEqual(emptyView.deliveries, []); await close(db);
}

(async () => { const sample = buildDayClosingEmailText({ businessDate: "03 Sep 2026", totalBills: 1, qtySold: 2, grossSales: 3, totalDiscount: 0, netBilling: 10, creditNoteCount: 0, qtyReturned: 0, returnCnValue: 0, netSalesAfterReturns: 10, cash: 10, upi: 0, card: 0, storeCreditRedeemed: 0, giftVoucherRedeemed: 0, actualMoneyCollection: 10, storeCreditIssued: 0, settlementDifference: 0, backupStatus: "SUCCESS", backupReference: "backup.zip" }); assert(sample.includes("₹10.00") && sample.includes("Return / CN Value") && sample.includes("Backup: SUCCESS")); await migrationTests(); await previousDayTests(); await outboxTests(); console.log("PASS follow-up migration, previous-day safety, full email content/currency, read-only view, and independent delivery tests"); })().catch(error => { console.error(error); process.exitCode = 1; });
