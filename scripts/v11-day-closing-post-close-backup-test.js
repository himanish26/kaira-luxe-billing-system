const assert = require("assert");
const sqlite3 = require("sqlite3").verbose();
const {
    CREATE_DAY_CLOSING_SNAPSHOTS_SQL
} = require("../src/database/dayClosingMigration");
const { createDayClosingService } = require("../src/database/dayClosingService");

const run = (db, sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function (error) {
    error ? reject(error) : resolve({ changes: this.changes, lastID: this.lastID });
}));
const get = (db, sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (error, row) => {
    error ? reject(error) : resolve(row || null);
}));
const exec = (db, sql) => new Promise((resolve, reject) => db.exec(sql, error => error ? reject(error) : resolve()));
const close = db => new Promise(resolve => db.close(resolve));

(async () => {
    const db = new sqlite3.Database(":memory:");
    await exec(db, CREATE_DAY_CLOSING_SNAPSHOTS_SQL);
    await exec(db, `
        CREATE TABLE business_day_state (
            business_date TEXT PRIMARY KEY,
            state TEXT NOT NULL,
            opened_at TEXT NOT NULL,
            closed_at TEXT,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE bills (
            id INTEGER PRIMARY KEY, bill_no TEXT, bill_date TEXT, total_qty INTEGER,
            gross_amount REAL, discount_amount REAL, net_amount REAL,
            cash_amount REAL, upi_amount REAL, card_amount REAL,
            store_credit_amount REAL, gift_voucher_amount REAL
        );
        CREATE TABLE bill_items (
            id INTEGER PRIMARY KEY, bill_no TEXT, qty INTEGER,
            business_segment TEXT, net_amount REAL
        );
        CREATE TABLE returns (
            id INTEGER PRIMARY KEY, net_reversal REAL, accounting_status TEXT,
            credit_note_no TEXT, accounting_snapshot_version INTEGER, business_date TEXT
        );
        CREATE TABLE return_items (return_id INTEGER, quantity INTEGER);
        CREATE TABLE customer_credit_transactions (
            id INTEGER PRIMARY KEY, transaction_type TEXT, amount REAL, created_at TEXT
        );
    `);
    await run(db, "INSERT INTO business_day_state VALUES (?,?,?,?,?)", [
        "2026-09-27", "OPEN", "2026-09-27T04:00:00.000Z", null, "2026-09-27T04:00:00.000Z"
    ]);

    const observed = [];
    const persistence = {
        async createFrozenJobWithinTransaction(snapshot) {
            observed.push("REPORT_FROZEN");
            assert.strictEqual(snapshot.close_status, "CLOSED");
            assert.strictEqual(snapshot.backup_status, "SUCCESS");
            assert.strictEqual(snapshot.backup_reference, "post-close.zip");
            return {
                jobId: 1,
                payloadHash: "test",
                payload: { dataQuality: { status: "PASS" } }
            };
        }
    };

    const service = createDayClosingService({
        database: db,
        now: () => new Date("2026-09-27T12:00:00.000Z"),
        getBusinessDate: () => "2026-09-27",
        reportingMode: "CONSOLIDATED_V2",
        consolidatedReportingPersistence: persistence,
        createBackup: async () => {
            const snapshot = await get(db, "SELECT close_status,backup_status,backup_reference FROM day_closing_snapshots WHERE business_date='2026-09-27' ORDER BY id DESC LIMIT 1");
            const day = await get(db, "SELECT state FROM business_day_state WHERE business_date='2026-09-27'");
            observed.push("BACKUP_CREATED");
            assert.deepStrictEqual(snapshot, {
                close_status: "CLOSED",
                backup_status: "PENDING",
                backup_reference: null
            });
            assert.strictEqual(day.state, "CLOSED");
            return { backupFileName: "post-close.zip", backupFilePath: "/tmp/post-close.zip" };
        },
        validateBackup: async () => {
            observed.push("BACKUP_VERIFIED");
            return { success: true };
        }
    });

    const result = await service.closeBusinessDay("2026-09-27");
    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(observed, ["BACKUP_CREATED", "BACKUP_VERIFIED", "REPORT_FROZEN"]);

    const snapshot = await get(db, "SELECT close_status,backup_status,backup_reference FROM day_closing_snapshots WHERE business_date='2026-09-27'");
    const day = await get(db, "SELECT state FROM business_day_state WHERE business_date='2026-09-27'");
    assert.deepStrictEqual(snapshot, {
        close_status: "CLOSED",
        backup_status: "SUCCESS",
        backup_reference: "post-close.zip"
    });
    assert.strictEqual(day.state, "CLOSED");

    await close(db);

    const failureDb = new sqlite3.Database(":memory:");
    await exec(failureDb, CREATE_DAY_CLOSING_SNAPSHOTS_SQL);
    await exec(failureDb, `
        CREATE TABLE business_day_state (
            business_date TEXT PRIMARY KEY, state TEXT NOT NULL,
            opened_at TEXT NOT NULL, closed_at TEXT, updated_at TEXT NOT NULL
        );
        CREATE TABLE bills (
            id INTEGER PRIMARY KEY, bill_no TEXT, bill_date TEXT, total_qty INTEGER,
            gross_amount REAL, discount_amount REAL, net_amount REAL,
            cash_amount REAL, upi_amount REAL, card_amount REAL,
            store_credit_amount REAL, gift_voucher_amount REAL
        );
        CREATE TABLE bill_items (
            id INTEGER PRIMARY KEY, bill_no TEXT, qty INTEGER,
            business_segment TEXT, net_amount REAL
        );
        CREATE TABLE returns (
            id INTEGER PRIMARY KEY, net_reversal REAL, accounting_status TEXT,
            credit_note_no TEXT, accounting_snapshot_version INTEGER, business_date TEXT
        );
        CREATE TABLE return_items (return_id INTEGER, quantity INTEGER);
        CREATE TABLE customer_credit_transactions (
            id INTEGER PRIMARY KEY, transaction_type TEXT, amount REAL, created_at TEXT
        );
    `);
    await run(failureDb, "INSERT INTO business_day_state VALUES (?,?,?,?,?)", [
        "2026-09-28", "OPEN", "2026-09-28T04:00:00.000Z", null, "2026-09-28T04:00:00.000Z"
    ]);

    const failureService = createDayClosingService({
        database: failureDb,
        now: () => new Date("2026-09-28T12:00:00.000Z"),
        getBusinessDate: () => "2026-09-28",
        reportingMode: "CONSOLIDATED_V2",
        consolidatedReportingPersistence: {
            async createFrozenJobWithinTransaction() {
                throw new Error("Reporting must not be reached after mandatory backup failure.");
            }
        },
        createBackup: async () => {
            throw new Error("DISPOSABLE_BACKUP_FAILURE");
        },
        validateBackup: async () => ({ success: true })
    });

    const failed = await failureService.closeBusinessDay("2026-09-28");
    assert.strictEqual(failed.success, false);
    assert.strictEqual(failed.dayClosed, true);
    assert.strictEqual(failed.backupFailed, true);
    const failedSnapshot = await get(failureDb, "SELECT close_status, backup_status FROM day_closing_snapshots WHERE business_date='2026-09-28'");
    const failedDay = await get(failureDb, "SELECT state FROM business_day_state WHERE business_date='2026-09-28'");
    assert.deepStrictEqual(failedSnapshot, { close_status: "CLOSED", backup_status: "FAILED" });
    assert.strictEqual(failedDay.state, "CLOSED");
    await close(failureDb);

    console.log("V1.1 Day Closing post-close backup regression test: PASS");
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
