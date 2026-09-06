const assert = require("assert");
const sqlite3 = require("sqlite3").verbose();
const { createIntegrationOutboxService } = require("../src/services/integrationOutboxService");
const { formatActivityBusinessDate, formatActivityTime, formatActivityValue } = require("../src/renderer/modules/system/activitylog");

const run = (db, sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function(error) {
    error ? reject(error) : resolve({ changes: this.changes, lastID: this.lastID });
}));
const all = (db, sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
const close = db => new Promise(resolve => db.close(resolve));

async function main() {
    const db = new sqlite3.Database(":memory:");
    await run(db, `CREATE TABLE day_closing_snapshots (
        id INTEGER PRIMARY KEY, business_date TEXT, close_status TEXT, backup_reference TEXT,
        backup_status TEXT, email_status TEXT, dsr_sync_status TEXT, dsr_synced_at TEXT,
        dsr_sync_error TEXT, total_bills INTEGER, qty_sold INTEGER, net_billing_paise INTEGER,
        updated_at TEXT
    )`);
    await run(db, `CREATE TABLE integration_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT, business_date TEXT, closing_id INTEGER,
        close_sequence INTEGER, delivery_type TEXT, status TEXT DEFAULT 'PENDING',
        attempt_count INTEGER DEFAULT 0, created_at TEXT, last_attempt_at TEXT,
        completed_at TEXT, last_error TEXT, UNIQUE(closing_id, delivery_type)
    )`);
    await run(db, `CREATE TABLE activities (
        id INTEGER PRIMARY KEY AUTOINCREMENT, activity_date TEXT, activity_time TEXT,
        category TEXT, action TEXT, details TEXT, user_name TEXT, status TEXT,
        entity_type TEXT, reference_no TEXT, change_data TEXT, created_at TEXT
    )`);
    await run(db, `INSERT INTO day_closing_snapshots
        (id,business_date,close_status,backup_reference,backup_status,email_status,dsr_sync_status,total_bills,qty_sold,net_billing_paise)
        VALUES (1,'2026-09-05','CLOSED','backup.zip','SUCCESS','PENDING','NOT_ATTEMPTED',0,0,0)`);

    const logActivity = async event => run(db, `INSERT INTO activities
        (category,action,details,user_name,status,entity_type,reference_no) VALUES (?,?,?,?,?,?,?)`,
        [event.category, event.action, event.details, event.user_name, event.status, event.entity_type, event.reference_no]);
    const activityExists = async event => (await all(db, `SELECT 1 FROM activities
        WHERE category=? AND action=? AND status=? AND reference_no=? AND details=?`,
        [event.category, event.action, event.status, event.reference_no, event.details])).length > 0;
    let emailAttempts = 0;
    let dsrAttempts = 0;
    const service = createIntegrationOutboxService({
        database: db,
        now: () => new Date("2026-09-06T02:50:00.000Z"),
        logActivity,
        activityExists,
        sendEmail: async () => { emailAttempts += 1; },
        syncDsr: async () => { dsrAttempts += 1; return { success: true, action: "UPDATED" }; },
        readDsrPayload: async () => ({ businessDate: "2026-09-05" }),
        getEmailConfiguration: async () => ({ automaticEmailBackup: true, recipients: ["hidden@example.invalid"] }),
        getBackupPath: async () => "backup.zip"
    });

    await service.enqueue(1, "2026-09-05", 1);
    let events = await all(db, "SELECT action,status,reference_no,details FROM activities ORDER BY id");
    assert.deepStrictEqual(events.map(event => event.action), ["EMAIL_SYNC_PENDING", "DSR_SYNC_PENDING"]);
    assert(events.every(event => event.status === "WARNING" && event.reference_no === "05 Sep, 2026"));
    assert(events[0].details === "Email queued for Business Date: 05 Sep, 2026");
    assert(events[1].details === "DSR queued for Business Date: 05 Sep, 2026");

    await service.drain();
    events = await all(db, "SELECT action,status,reference_no,details FROM activities ORDER BY id");
    assert.deepStrictEqual(events.map(event => event.action), [
        "EMAIL_SYNC_PENDING", "DSR_SYNC_PENDING", "EMAIL_SYNC_SUCCEEDED", "DSR_SYNC_SUCCEEDED"
    ]);
    assert(events.slice(2).every(event => event.status === "SUCCESS" && event.reference_no === "05 Sep, 2026"));
    assert.strictEqual(emailAttempts, 1);
    assert.strictEqual(dsrAttempts, 1);

    await service.enqueue(1, "2026-09-05", 1);
    await service.drain();
    assert.strictEqual((await all(db, "SELECT action FROM activities WHERE action LIKE '%SUCCEEDED'")).length, 2);
    const auditText = JSON.stringify(await all(db, "SELECT details FROM activities"));
    assert(!/recipient|password|secret|token|grant|hmac|signature|smtp|web.?app.?url/i.test(auditText));

    assert.strictEqual(formatActivityBusinessDate("2026-09-05"), "05 Sep, 2026");
    assert.strictEqual(formatActivityTime("08:20:00 AM"), "08:20 AM");
    assert.strictEqual(formatActivityValue("Business Date: 2026-09-05"), "Business Date: 05 Sep, 2026");

    await close(db);
    console.log("PASS stable-gate Activity Log outbox lifecycle, idempotency, original date, secret safety, and display formatting");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
