const assert = require("assert");
const sqlite3 = require("sqlite3").verbose();
const {
    CREATE_CONSOLIDATED_REPORTING_JOBS_SQL,
    migrateConsolidatedReportingJobs,
    CREATE_DAY_CLOSING_SNAPSHOTS_SQL
} = require("../src/database/dayClosingMigration");
const { createConsolidatedReportingPersistenceService } = require("../src/services/consolidatedReportingPersistenceService");
const { createDayClosingService } = require("../src/database/dayClosingService");

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => db.run(sql, params, function(error) {
        if (error) reject(error); else resolve({ lastID: this.lastID, changes: this.changes });
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

async function setupPersistenceDb() {
    const db = new sqlite3.Database(":memory:");
    await migrateConsolidatedReportingJobs(db);
    return db;
}

async function testC2Persistence() {
    const db = await setupPersistenceDb();
    await migrateConsolidatedReportingJobs(db);
    const columns = await all(db, "PRAGMA table_info(consolidated_reporting_jobs)");
    for (const column of ["closing_id", "business_date", "close_sequence", "payload_json", "payload_hash", "report_status", "data_quality_status", "sheet_status", "email_status"]) {
        assert(columns.some(value => value.name === column), column);
    }
    await run(db, `INSERT INTO integration_outbox (id) VALUES (1)`).catch(async error => {
        if (!/no such table/.test(error.message)) throw error;
        await run(db, "CREATE TABLE integration_outbox (id INTEGER PRIMARY KEY)");
        await run(db, "INSERT INTO integration_outbox (id) VALUES (1)");
    });
    await run(db, "CREATE TABLE IF NOT EXISTS segment_dsr_outbox (id INTEGER PRIMARY KEY)");
    await run(db, "INSERT INTO segment_dsr_outbox (id) VALUES (1)");
    const payload = JSON.stringify({ semantic: "complete" });
    await run(db, `INSERT INTO consolidated_reporting_jobs (closing_id,business_date,close_sequence,contract_version,snapshot_version,payload_json,payload_hash,report_status,data_quality_status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`, [1, "2026-09-21", 1, 2, 2, payload, "abc", "FINAL", "COMPLETE", "2026-09-21T18:00:00.000Z"]);
    await run(db, "UPDATE consolidated_reporting_jobs SET sheet_status='DELIVERED', email_status='FAILED', sheet_delivered_at='2026-09-21T18:01:00.000Z', email_last_error='offline' WHERE closing_id=1");
    const stored = await get(db, "SELECT * FROM consolidated_reporting_jobs WHERE closing_id=1");
    assert.strictEqual(stored.payload_json, payload);
    assert.strictEqual(stored.payload_hash, "abc");
    await assert.rejects(() => run(db, `INSERT INTO consolidated_reporting_jobs (closing_id,business_date,close_sequence,contract_version,snapshot_version,payload_json,payload_hash,report_status,data_quality_status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`, [1, "2026-09-22", 1, 2, 2, payload, "def", "FINAL", "COMPLETE", "now"]));
    await assert.rejects(() => run(db, `INSERT INTO consolidated_reporting_jobs (closing_id,business_date,close_sequence,contract_version,snapshot_version,payload_json,payload_hash,report_status,data_quality_status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`, [2, "2026-09-21", 1, 2, 2, payload, "def", "FINAL", "COMPLETE", "now"]));
    await run(db, `INSERT INTO consolidated_reporting_jobs (closing_id,business_date,close_sequence,contract_version,snapshot_version,payload_json,payload_hash,report_status,data_quality_status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`, [2, "2026-09-21", 2, 2, 2, JSON.stringify({ semantic: "incomplete" }), "ghi", "INCOMPLETE", "INCOMPLETE", "now"]);
    await run(db, `INSERT INTO consolidated_reporting_jobs (closing_id,business_date,close_sequence,contract_version,snapshot_version,payload_json,payload_hash,report_status,data_quality_status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`, [3, "2026-09-21", 3, 2, 2, JSON.stringify({ semantic: "unavailable" }), "jkl", "UNAVAILABLE", "UNAVAILABLE", "now"]);
    assert.strictEqual((await get(db, "SELECT COUNT(*) AS count FROM integration_outbox")).count, 1);
    assert.strictEqual((await get(db, "SELECT COUNT(*) AS count FROM segment_dsr_outbox")).count, 1);
    assert.strictEqual((await get(db, "SELECT COUNT(*) AS count FROM consolidated_reporting_jobs")).count, 3);
    await close(db);
}

async function createClosingDb() {
    const db = new sqlite3.Database(":memory:");
    await dbExec(db, CREATE_DAY_CLOSING_SNAPSHOTS_SQL);
    await run(db, `CREATE TABLE business_day_state (business_date TEXT PRIMARY KEY, state TEXT NOT NULL, opened_at TEXT NOT NULL, closed_at TEXT, updated_at TEXT NOT NULL)`);
    await run(db, `CREATE TABLE bills (id INTEGER PRIMARY KEY, bill_no TEXT UNIQUE, bill_date TEXT, total_qty INTEGER, gross_amount REAL, discount_amount REAL, net_amount REAL, cash_amount REAL, upi_amount REAL, card_amount REAL, store_credit_amount REAL, gift_voucher_amount REAL)`);
    await run(db, `CREATE TABLE bill_items (id INTEGER PRIMARY KEY, bill_no TEXT, qty INTEGER, business_segment TEXT, net_amount REAL)`);
    await run(db, `CREATE TABLE returns (id INTEGER PRIMARY KEY, net_reversal REAL, business_date TEXT, accounting_status TEXT, credit_note_no TEXT, accounting_snapshot_version INTEGER)`);
    await run(db, `CREATE TABLE return_items (id INTEGER PRIMARY KEY, return_id INTEGER, quantity INTEGER)`);
    await run(db, `CREATE TABLE customer_credit_transactions (id INTEGER PRIMARY KEY, transaction_type TEXT, amount REAL, created_at TEXT)`);
    await run(db, "CREATE TABLE integration_outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, business_date TEXT, closing_id INTEGER, close_sequence INTEGER, delivery_type TEXT, status TEXT DEFAULT 'PENDING', attempt_count INTEGER DEFAULT 0, created_at TEXT, last_attempt_at TEXT, completed_at TEXT, last_error TEXT, UNIQUE(closing_id, delivery_type))");
    await run(db, "CREATE TABLE segment_dsr_outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, closing_id INTEGER UNIQUE)");
    await migrateConsolidatedReportingJobs(db);
    await run(db, "INSERT INTO business_day_state VALUES ('2026-09-21','OPEN','2026-09-21T09:00:00.000Z',NULL,'2026-09-21T09:00:00.000Z')");
    return db;
}

function dbExec(db, sql) {
    return new Promise((resolve, reject) => db.exec(sql, error => error ? reject(error) : resolve()));
}

async function addBill(db, id, billNo, net = 100, cash = 10, segment = "KL") {
    await run(db, "INSERT INTO bills VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", [id, billNo, "2026-09-21", 1, net, 0, net, cash, 0, 0, 0, 0]);
    await run(db, "INSERT INTO bill_items VALUES (?,?,?,?,?)", [id, billNo, 1, segment, net]);
}

function createClosingService(db, persistence, overrides = {}) {
    return createDayClosingService({
        database: db,
        consolidatedReportingPersistence: persistence,
        now: () => new Date("2026-09-21T18:00:00.000Z"),
        getBusinessDate: () => "2026-09-21",
        createBackup: async () => ({ backupFileName: "backup.zip", backupFilePath: "backup.zip" }),
        validateBackup: async () => ({ success: true }),
        integrationOutbox: { enqueue: async () => {} },
        segmentDsrOutbox: { enqueue: async () => {} },
        logBusinessDayClosed: async () => {},
        logBusinessDayReopened: async () => {},
        ...overrides
    });
}

async function testC3AtomicCloseReopenReclose() {
    const db = await createClosingDb();
    await addBill(db, 1, "B1");
    const persistence = createConsolidatedReportingPersistenceService({ database: db });
    const service = createClosingService(db, persistence);
    const first = await service.closeBusinessDay("2026-09-21");
    assert.strictEqual(first.success, true);
    assert.strictEqual(first.snapshot.closeStatus, "CLOSED");
    const firstJob = await get(db, "SELECT * FROM consolidated_reporting_jobs WHERE closing_id=?", [first.snapshotId]);
    assert(firstJob);
    assert.strictEqual(firstJob.business_date, "2026-09-21");
    assert.strictEqual(firstJob.close_sequence, 1);
    assert.strictEqual(firstJob.closing_id, first.snapshotId);
    assert.strictEqual(JSON.parse(firstJob.payload_json).closeSequence, "1");
    assert.strictEqual(firstJob.payload_hash.length, 64);
    assert.strictEqual(firstJob.data_quality_status, "COMPLETE");
    const firstPayload = firstJob.payload_json;
    const firstHash = firstJob.payload_hash;
    await service.reopenBusinessDay("C1C3 test reopen");
    const reopenedJob = await get(db, "SELECT payload_json,payload_hash FROM consolidated_reporting_jobs WHERE closing_id=?", [first.snapshotId]);
    assert.strictEqual(reopenedJob.payload_json, firstPayload);
    assert.strictEqual(reopenedJob.payload_hash, firstHash);
    await addBill(db, 2, "B2", 200, 20, "MENS");
    const second = await service.closeBusinessDay("2026-09-21");
    assert.strictEqual(second.success, true);
    assert.notStrictEqual(second.snapshotId, first.snapshotId);
    const jobs = await all(db, "SELECT closing_id,close_sequence FROM consolidated_reporting_jobs ORDER BY close_sequence");
    assert.deepStrictEqual(jobs, [{ closing_id: first.snapshotId, close_sequence: 1 }, { closing_id: second.snapshotId, close_sequence: 2 }]);
    const secondPayload = await get(db, "SELECT payload_json FROM consolidated_reporting_jobs WHERE closing_id=?", [second.snapshotId]);
    assert.notStrictEqual(secondPayload.payload_json, firstPayload);
    await service.reopenBusinessDay("C1C3 second reopen");
    await addBill(db, 3, "B3", 300, 30, "KIDS");
    const third = await service.closeBusinessDay("2026-09-21");
    assert.strictEqual(third.success, true);
    assert.strictEqual((await get(db, "SELECT MAX(close_sequence) AS value FROM day_closing_snapshots WHERE business_date='2026-09-21'")).value, 3);
    assert.strictEqual((await get(db, "SELECT COUNT(*) AS value FROM consolidated_reporting_jobs WHERE business_date='2026-09-21'")).value, 3);
    await close(db);
}

async function testC3PersistenceFailureAfterClosedBoundary() {
    const db = await createClosingDb();
    await addBill(db, 1, "B1");
    const failingPersistence = { createFrozenJobWithinTransaction: async () => { throw new Error("injected consolidated job insert failure"); } };
    const service = createClosingService(db, failingPersistence);
    await assert.rejects(() => service.closeBusinessDay("2026-09-21"), /injected consolidated job insert failure/);
    const snapshot = await get(db, "SELECT close_status, backup_status FROM day_closing_snapshots WHERE business_date='2026-09-21'");
    assert.deepStrictEqual(snapshot, { close_status: "CLOSED", backup_status: "PENDING" },
        "post-close reporting persistence failure must not reopen the authoritative day");
    assert.strictEqual((await get(db, "SELECT state FROM business_day_state WHERE business_date='2026-09-21'")).state, "CLOSED");
    assert.strictEqual((await get(db, "SELECT COUNT(*) AS value FROM consolidated_reporting_jobs")).value, 0);
    await close(db);
}

async function testAuthoritativeCloseFailureStopsLaterWork() {
    const db = await createClosingDb();
    await addBill(db, 1, "B1");
    const stages = [];
    const originalRun = db.run.bind(db);
    db.run = function(sql, params, callback) {
        if (String(sql).includes("SET close_status = 'CLOSED'")) {
            queueMicrotask(() => callback(new Error("injected authoritative close failure")));
            return this;
        }
        return originalRun(sql, params, callback);
    };
    const service = createClosingService(db, createConsolidatedReportingPersistenceService({ database: db }), {
        onProgress: stage => stages.push(stage),
        createBackup: async () => { throw new Error("backup must not run after close failure"); }
    });
    await assert.rejects(() => service.closeBusinessDay("2026-09-21"), /injected authoritative close failure/);
    assert.strictEqual((await get(db, "SELECT close_status FROM day_closing_snapshots WHERE business_date='2026-09-21'")).close_status, "FAILED");
    assert.strictEqual((await get(db, "SELECT state FROM business_day_state WHERE business_date='2026-09-21'")).state, "OPEN");
    assert.deepStrictEqual(stages, ["FINALIZING_ACCOUNTS", "CLOSING_BUSINESS_DAY"]);
    assert.strictEqual((await get(db, "SELECT COUNT(*) AS value FROM consolidated_reporting_jobs")).value, 0);
    await close(db);
}

async function testC3MissingPersistenceFailsSafely() {
    const db = await createClosingDb();
    await addBill(db, 1, "B1");
    const missingService = createDayClosingService({
        database: db,
        now: () => new Date("2026-09-21T18:00:00.000Z"),
        getBusinessDate: () => "2026-09-21",
        createBackup: async () => ({ backupFileName: "backup.zip", backupFilePath: "backup.zip" }),
        validateBackup: async () => ({ success: true })
    });
    const result = await missingService.closeBusinessDay("2026-09-21");
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.reportingPersistenceRequired, true);
    assert.strictEqual((await get(db, "SELECT COUNT(*) AS value FROM day_closing_snapshots")).value, 0);
    assert.strictEqual((await get(db, "SELECT state FROM business_day_state WHERE business_date='2026-09-21'")).state, "OPEN");
    assert.strictEqual((await get(db, "SELECT COUNT(*) AS value FROM consolidated_reporting_jobs")).value, 0);
    const validService = createClosingService(db, createConsolidatedReportingPersistenceService({ database: db }));
    assert.strictEqual((await validService.closeBusinessDay("2026-09-21")).success, true);
    await close(db);
}

(async () => {
    await testC2Persistence();
    await testC3AtomicCloseReopenReclose();
    await testC3PersistenceFailureAfterClosedBoundary();
    await testAuthoritativeCloseFailureStopsLaterWork();
    await testC3MissingPersistenceFailsSafely();
    console.log("C2/C3 durable reporting and Day Closing boundary tests: PASS");
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
