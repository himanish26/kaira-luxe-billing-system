const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const sqlite3 = require("sqlite3").verbose();
const { createIntegrationOutboxService } = require("../src/services/integrationOutboxService");

const run = (db, sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, error => error ? reject(error) : resolve()));
const all = (db, sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
const close = db => new Promise(resolve => db.close(resolve));

function loadAppsScriptValidator() {
    const source = fs.readFileSync(path.join(__dirname, "../deployment/google-apps-script/KLBS_DSR_WebApp.gs"), "utf8");
    const context = {};
    vm.createContext(context);
    vm.runInContext(`${source}; this.validatePayload = validatePayload_;`, context);
    return context.validatePayload;
}

function validPayload() {
    return {
        contractVersion: 1, businessDate: "2026-09-11", closingId: 5, closeSequence: 5,
        snapshotVersion: 1, closedAt: "2026-09-11T12:00:00.000Z", totalBills: 11, qtySold: 12,
        grossSalesPaise: 788800, totalDiscountPaise: 46700, netBillingPaise: 742144,
        creditNoteCount: 1, qtyReturned: 1, returnCnValuePaise: 341494,
        netSalesAfterReturnsPaise: 400650, cashPaise: 247500, upiPaise: 33260,
        cardPaise: 298600, storeCreditRedeemedPaise: 102784,
        giftVoucherRedeemedPaise: 60000, settlementTotalPaise: 742144,
        actualMoneyCollectionPaise: 579360, storeCreditIssuedPaise: 341494,
        settlementDifferencePaise: 0, backupStatus: "SUCCESS", emailStatus: "SUCCESS",
        klbsVersion: "1.0.0"
    };
}

function dsrValidationTests() {
    const validatePayload = loadAppsScriptValidator();
    assert.doesNotThrow(() => validatePayload(validPayload()), "mixed gross/discount/net precision must be accepted");
    for (const [field, value, message] of [
        ["netSalesAfterReturnsPaise", 400649, "net less returns"],
        ["settlementTotalPaise", 742143, "settlement total"],
        ["actualMoneyCollectionPaise", 579359, "actual collection"],
        ["settlementDifferencePaise", 1, "settlement difference"]
    ]) {
        const payload = validPayload();
        payload[field] = value;
        assert.throws(() => validatePayload(payload), /Accounting integrity validation failed/, `${message} must remain enforced`);
    }
}

async function outboxStarvationTests() {
    const db = new sqlite3.Database(":memory:");
    await run(db, `CREATE TABLE day_closing_snapshots (
        id INTEGER PRIMARY KEY, business_date TEXT, close_sequence INTEGER,
        close_status TEXT, backup_reference TEXT, backup_status TEXT,
        email_status TEXT, dsr_sync_status TEXT, dsr_synced_at TEXT,
        dsr_sync_error TEXT, updated_at TEXT
    )`);
    await run(db, `CREATE TABLE integration_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT, business_date TEXT, closing_id INTEGER,
        close_sequence INTEGER, delivery_type TEXT, status TEXT DEFAULT 'PENDING',
        attempt_count INTEGER DEFAULT 0, created_at TEXT, last_attempt_at TEXT,
        completed_at TEXT, last_error TEXT, UNIQUE(closing_id, delivery_type)
    )`);
    for (const [id, date, sequence] of [[1, "2026-09-11", 5], [2, "2026-09-12", 1], [3, "2026-09-12", 1]]) {
        await run(db, "INSERT INTO day_closing_snapshots (id,business_date,close_sequence,close_status,backup_reference,backup_status,email_status,dsr_sync_status,updated_at) VALUES (?,?,?,?,?,?,?,?,?)", [id, date, sequence, "CLOSED", "backup.zip", "SUCCESS", "PENDING", "NOT_ATTEMPTED", "2026-09-12T00:00:00.000Z"]);
    }
    await run(db, "INSERT INTO integration_outbox (id,business_date,closing_id,close_sequence,delivery_type,created_at) VALUES (1,'2026-09-11',1,5,'DSR_DAY_CLOSING','2026-09-11T00:00:00.000Z'),(2,'2026-09-12',2,1,'EMAIL_DAY_CLOSING','2026-09-12T00:00:00.000Z'),(3,'2026-09-12',2,1,'DSR_DAY_CLOSING','2026-09-12T00:00:00.000Z')");

    let clock = new Date("2026-09-12T12:00:00.000Z");
    const attempts = [];
    const service = createIntegrationOutboxService({
        database: db, now: () => clock,
        sendEmail: async () => { attempts.push("EMAIL"); },
        syncDsr: async payload => { attempts.push(`DSR:${payload.closingId}`); return payload.closingId === 1 ? { success: false, error: "endpoint rejected" } : { success: true }; },
        readDsrPayload: async id => ({ closingId: id, businessDate: id === 1 ? "2026-09-11" : "2026-09-12", closeSequence: id === 1 ? 5 : 1 }),
        getEmailConfiguration: async () => ({ automaticEmailBackup: true, recipients: ["test@example.invalid"] }),
        getBackupPath: async () => "backup.zip"
    });

    await service.drain();
    assert.deepStrictEqual(attempts, ["DSR:1", "EMAIL", "DSR:2"]);
    let rows = await all(db, "SELECT id,status,attempt_count,last_attempt_at,last_error FROM integration_outbox ORDER BY id");
    assert.strictEqual(rows[0].status, "PENDING");
    assert.strictEqual(rows[0].attempt_count, 1);
    assert(rows[0].last_attempt_at);
    assert.strictEqual(rows[0].last_error, "endpoint rejected");
    assert.strictEqual(rows[1].status, "SUCCESS");
    assert.strictEqual(rows[2].status, "SUCCESS");

    await service.drain();
    assert.deepStrictEqual(attempts, ["DSR:1", "EMAIL", "DSR:2"], "cooldown and SUCCESS rows prevent immediate resend");
    clock = new Date(clock.getTime() + 60000);
    await service.drain();
    rows = await all(db, "SELECT status,attempt_count FROM integration_outbox ORDER BY id");
    assert.strictEqual(rows[0].status, "PENDING");
    assert.strictEqual(rows[0].attempt_count, 2);
    assert.strictEqual(rows[1].status, "SUCCESS");
    assert.strictEqual(rows[2].status, "SUCCESS");
    await close(db);
}

async function staleOutboxTests() {
    const db = new sqlite3.Database(":memory:");
    await run(db, `CREATE TABLE day_closing_snapshots (id INTEGER PRIMARY KEY, business_date TEXT, close_sequence INTEGER, close_status TEXT, backup_reference TEXT, backup_status TEXT, email_status TEXT, dsr_sync_status TEXT, dsr_synced_at TEXT, dsr_sync_error TEXT, updated_at TEXT)`);
    await run(db, `CREATE TABLE integration_outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, business_date TEXT, closing_id INTEGER, close_sequence INTEGER, delivery_type TEXT, status TEXT DEFAULT 'PENDING', attempt_count INTEGER DEFAULT 0, created_at TEXT, last_attempt_at TEXT, completed_at TEXT, last_error TEXT, UNIQUE(closing_id, delivery_type))`);
    await run(db, "INSERT INTO day_closing_snapshots (id,business_date,close_sequence,close_status,backup_status,email_status,dsr_sync_status,updated_at) VALUES (1,'2026-09-12',1,'CLOSED','SUCCESS','SUCCESS','FAILED','2026-09-12T01:00:00.000Z'),(2,'2026-09-12',2,'CLOSED','SUCCESS','PENDING','NOT_ATTEMPTED','2026-09-12T02:00:00.000Z'),(3,'2026-09-13',1,'CLOSED','SUCCESS','PENDING','NOT_ATTEMPTED','2026-09-13T02:00:00.000Z')");
    await run(db, "INSERT INTO integration_outbox (id,business_date,closing_id,close_sequence,delivery_type,created_at) VALUES (1,'2026-09-12',1,1,'DSR_DAY_CLOSING','2026-09-12T01:00:00.000Z'),(2,'2026-09-12',2,2,'EMAIL_DAY_CLOSING','2026-09-12T02:00:00.000Z'),(3,'2026-09-12',2,2,'DSR_DAY_CLOSING','2026-09-12T02:00:00.000Z'),(4,'2026-09-13',3,1,'DSR_DAY_CLOSING','2026-09-13T02:00:00.000Z')");
    await run(db, "UPDATE day_closing_snapshots SET close_status='REOPENED' WHERE id=1");
    let external = 0;
    const staleActivities = [];
    const service = createIntegrationOutboxService({
        database: db, now: () => new Date("2026-09-13T12:00:00.000Z"),
        logActivity: async event => staleActivities.push(event),
        sendEmail: async () => { external += 1; },
        syncDsr: async () => { external += 1; return { success: true }; },
        readDsrPayload: async id => ({ closingId: id, businessDate: id === 3 ? "2026-09-13" : "2026-09-12", closeSequence: id === 3 ? 1 : 2 }),
        getEmailConfiguration: async () => ({ automaticEmailBackup: true, recipients: ["test@example.invalid"] }),
        getBackupPath: async () => "backup.zip"
    });
    await service.drain();
    let rows = await all(db, "SELECT id,status,attempt_count,last_attempt_at,last_error FROM integration_outbox ORDER BY id");
    assert.strictEqual(rows[0].status, "SUCCESS");
    assert.strictEqual(rows[0].attempt_count, 0, "stale row must not count as an external attempt");
    assert.strictEqual(rows[0].last_attempt_at, null);
    assert.match(rows[0].last_error, /reopened/);
    assert.deepStrictEqual(staleActivities.filter(event => event.action === "OUTBOX_DELIVERY_SUPERSEDED").map(event => event.action), ["OUTBOX_DELIVERY_SUPERSEDED"]);
    assert.strictEqual(rows[1].status, "SUCCESS");
    assert.strictEqual(rows[2].status, "SUCCESS");
    assert.strictEqual(rows[3].status, "SUCCESS");
    assert.strictEqual(external, 3);
    assert.strictEqual((await service.getStatusView()).pendingCount, 0);
    assert.strictEqual((await all(db, "SELECT COUNT(*) AS count FROM integration_outbox"))[0].count, 4, "stale history must remain");

    await run(db, "INSERT INTO day_closing_snapshots (id,business_date,close_sequence,close_status,backup_status,email_status,dsr_sync_status,updated_at) VALUES (5,'2026-09-14',1,'CLOSED','SUCCESS','PENDING','NOT_ATTEMPTED','2026-09-14T00:00:00.000Z')");
    await run(db, "INSERT INTO integration_outbox (id,business_date,closing_id,close_sequence,delivery_type,created_at) VALUES (5,'2026-09-14',5,1,'DSR_DAY_CLOSING','2026-09-14T00:00:00.000Z')");
    const failing = createIntegrationOutboxService({
        database: db, now: () => new Date("2026-09-14T00:00:00.000Z"),
        syncDsr: async () => ({ success: false, error: "temporary" }),
        readDsrPayload: async () => ({ closingId: 5, businessDate: "2026-09-14", closeSequence: 1 })
    });
    await failing.drain();
    rows = await all(db, "SELECT status,attempt_count,last_attempt_at,last_error FROM integration_outbox WHERE id=5");
    assert.strictEqual(rows[0].status, "PENDING");
    assert.strictEqual(rows[0].attempt_count, 1);
    assert(rows[0].last_attempt_at);
    assert.strictEqual(rows[0].last_error, "temporary");
    await close(db);
}

(async () => {
    dsrValidationTests();
    await outboxStarvationTests();
    await staleOutboxTests();
    console.log("PASS DSR validator and outbox starvation repair tests");
})().catch(error => { console.error(error); process.exitCode = 1; });
