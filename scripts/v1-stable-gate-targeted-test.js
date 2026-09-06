const assert = require("assert");
const sqlite3 = require("sqlite3").verbose();
const { createIntegrationOutboxService } = require("../src/services/integrationOutboxService");
const { formatBusinessDateDisplay } = require("../src/database/businessDate");

function run(db, sql, params = []) { return new Promise((resolve, reject) => db.run(sql, params, e => e ? reject(e) : resolve())); }
function all(db, sql, params = []) { return new Promise((resolve, reject) => db.all(sql, params, (e, rows) => e ? reject(e) : resolve(rows))); }

(async () => {
    const db = new sqlite3.Database(":memory:");
    await run(db, `CREATE TABLE day_closing_snapshots (id INTEGER PRIMARY KEY, business_date TEXT, close_sequence INTEGER, close_status TEXT, backup_reference TEXT, backup_status TEXT, email_status TEXT, dsr_sync_status TEXT, dsr_synced_at TEXT, dsr_sync_error TEXT, total_bills INTEGER, qty_sold INTEGER, net_billing_paise INTEGER, updated_at TEXT)`);
    await run(db, `CREATE TABLE integration_outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, business_date TEXT, closing_id INTEGER, close_sequence INTEGER, delivery_type TEXT, status TEXT DEFAULT 'PENDING', attempt_count INTEGER DEFAULT 0, created_at TEXT, last_attempt_at TEXT, completed_at TEXT, last_error TEXT, UNIQUE(closing_id, delivery_type))`);
    await run(db, "INSERT INTO day_closing_snapshots VALUES (1,'2026-09-01',1,'CLOSED','backup.zip','SUCCESS','PENDING','NOT_ATTEMPTED',NULL,NULL,2,3,1000,NULL)");
    let nowValue = new Date("2026-09-04T10:00:00Z");
    let emailCalls = 0; let dsrCalls = 0;
    const service = createIntegrationOutboxService({ database: db, now: () => nowValue,
        sendEmail: async message => { emailCalls++; assert(message.subject.endsWith("01 Sep, 2026")); assert(message.text.includes("Business Date: 01 Sep, 2026")); },
        syncDsr: async payload => { dsrCalls++; assert.strictEqual(payload.businessDate, "2026-09-01"); return { success: true }; },
        readDsrPayload: async () => ({ businessDate: "2026-09-01" }),
        getEmailConfiguration: async () => ({ automaticEmailBackup: true, recipients: ["redacted@example.invalid"] }),
        getBackupPath: async () => "backup.zip"
    });
    await service.enqueue(1, "2026-09-01", 1);
    await service.drain();
    assert.strictEqual(emailCalls, 1); assert.strictEqual(dsrCalls, 1);
    await service.drain();
    assert.strictEqual(emailCalls, 1); assert.strictEqual(dsrCalls, 1);
    assert.strictEqual(formatBusinessDateDisplay("2026-09-03"), "03 Sep, 2026");
    const rows = await all(db, "SELECT delivery_type,status FROM integration_outbox ORDER BY id");
    assert.deepStrictEqual(rows, [{ delivery_type: "EMAIL_DAY_CLOSING", status: "SUCCESS" }, { delivery_type: "DSR_DAY_CLOSING", status: "SUCCESS" }]);
    db.close();
    console.log("PASS stable-gate outbox persistence, independent terminal delivery, delayed-date preservation, and format checks");
})().catch(error => { console.error(error); process.exitCode = 1; });
