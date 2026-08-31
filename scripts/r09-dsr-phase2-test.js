const assert = require("assert");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();
const { migrateDayClosingSnapshots } = require("../src/database/dayClosingMigration");
const { readClosedDsrPayload } = require("../src/database/dayClosingDsrService");
const {
    PAYLOAD_FIELDS, canonicalizePayload, signPayload, createDsrSyncService
} = require("../src/services/dsrSyncService");
const { createDayClosingService } = require("../src/database/dayClosingService");
const { AUTHORIZATION_POLICY } = require("../src/services/administratorSecurityService");

const dbPath = "/private/tmp/klbs_r09_dsr_phase2_test.db";
try { fs.unlinkSync(dbPath); } catch (_) {}
const db = new sqlite3.Database(dbPath);
const run = (sql, params = []) => new Promise((resolve, reject) =>
    db.run(sql, params, function(error) {
        error ? reject(error) : resolve({ lastID: this.lastID, changes: this.changes });
    }));
const get = (sql, params = []) => new Promise((resolve, reject) =>
    db.get(sql, params, (error, row) => error ? reject(error) : resolve(row)));

function closedValues(overrides = {}) {
    return {
        business_date: "2026-09-01", close_sequence: 1, snapshot_version: 1,
        close_status: "CLOSED", closed_at: "2026-09-01T12:30:00.000Z",
        total_bills: 2, qty_sold: 3, gross_sales_paise: 12000,
        total_discount_paise: 2000, net_billing_paise: 10000,
        credit_note_count: 1, qty_returned: 1, return_cn_value_paise: 1000,
        net_sales_after_returns_paise: 9000, cash_paise: 4000, upi_paise: 3000,
        card_paise: 1000, store_credit_redeemed_paise: 1000,
        gift_voucher_redeemed_paise: 1000, settlement_total_paise: 10000,
        actual_money_collection_paise: 8000, store_credit_issued_paise: 1000,
        settlement_difference_paise: 0, store_credit_ledger_redeemed_paise: 1000,
        store_credit_ledger_difference_paise: 0, backup_status: "SUCCESS",
        email_status: "FAILED", created_at: "2026-09-01T12:00:00.000Z",
        updated_at: "2026-09-01T12:30:00.000Z", ...overrides
    };
}

async function insertSnapshot(values) {
    const keys = Object.keys(values);
    const result = await run(
        `INSERT INTO day_closing_snapshots (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
        keys.map(key => values[key])
    );
    return result.lastID;
}

async function main() {
    await migrateDayClosingSnapshots(db);
    await migrateDayClosingSnapshots(db);
    const columns = await new Promise((resolve, reject) => db.all(
        "PRAGMA table_info(day_closing_snapshots)", [],
        (error, rows) => error ? reject(error) : resolve(rows)
    ));
    for (const name of ["dsr_sync_status", "dsr_synced_at", "dsr_sync_error", "dsr_sync_attempts"]) {
        assert(columns.some(column => column.name === name));
    }

    const id = await insertSnapshot(closedValues());
    const initial = await get("SELECT dsr_sync_status, dsr_sync_attempts FROM day_closing_snapshots WHERE id = ?", [id]);
    assert.deepStrictEqual(initial, { dsr_sync_status: "NOT_ATTEMPTED", dsr_sync_attempts: 0 });
    const payload = await readClosedDsrPayload(db, id, "1.0.0-RC8");
    assert.deepStrictEqual(Object.keys(payload), PAYLOAD_FIELDS);
    assert.strictEqual(payload.grossSalesPaise, 12000);
    assert.strictEqual(canonicalizePayload(payload), canonicalizePayload({ ...payload }));
    const signature = signPayload(payload, "2026-09-01T12:31:00.000Z", "test-secret");
    assert.strictEqual(signature.length, 64);
    assert.notStrictEqual(signature, signPayload({ ...payload, cashPaise: 4001 }, "2026-09-01T12:31:00.000Z", "test-secret"));
    assert.notStrictEqual(signature, signPayload(payload, "2026-09-01T12:32:00.000Z", "test-secret"));

    for (const status of ["PREPARING", "REOPENED"]) {
        const badId = await insertSnapshot(closedValues({
            business_date: status === "PREPARING" ? "2026-09-02" : "2026-09-03",
            close_status: status
        }));
        await assert.rejects(() => readClosedDsrPayload(db, badId, "1.0.0-RC8"), /CLOSED/);
    }
    const legacyId = await insertSnapshot(closedValues({ business_date: "2026-09-04", snapshot_version: 0 }));
    await assert.rejects(() => readClosedDsrPayload(db, legacyId, "1.0.0-RC8"), /version 1/);
    const unsafeId = await insertSnapshot(closedValues({ business_date: "2026-09-05", gross_sales_paise: 9007199254740992 }));
    await assert.rejects(() => readClosedDsrPayload(db, unsafeId, "1.0.0-RC8"), /safe integer/);

    for (const action of ["INSERTED", "UPDATED", "UNCHANGED"]) {
        const service = createDsrSyncService({
            endpoint: "https://example.invalid/dsr", secret: "test-secret",
            now: () => new Date("2026-09-01T12:31:00.000Z"),
            httpClient: { post: async () => ({ data: {
                ok: true, action, businessDate: payload.businessDate,
                closingId: payload.closingId, closeSequence: payload.closeSequence,
                syncedAt: "2026-09-01T12:31:01.000Z"
            } }) }
        });
        assert.strictEqual((await service.sync(payload)).action, action);
    }
    const failedService = createDsrSyncService({
        endpoint: "https://example.invalid/dsr", secret: "test-secret",
        httpClient: { post: async () => { throw Object.assign(new Error("timeout"), { code: "ECONNABORTED" }); } }
    });
    assert.deepStrictEqual(await failedService.sync(payload), { success: false, error: "DSR sync timed out." });

    const dayService = createDayClosingService({
        database: db, klbsVersion: "1.0.0-RC8",
        createBackup: async () => ({}), validateBackup: async () => ({ success: true }),
        sendEmail: async () => {},
        dsrSyncService: { sync: async () => ({ success: false, error: "offline" }) },
        logDsrSyncFailed: async () => {}, logDsrSyncSucceeded: async () => {}
    });
    const retry = await dayService.retryDsrSync(id);
    assert.strictEqual(retry.status, "FAILED");
    const afterFailure = await get("SELECT dsr_sync_status, dsr_sync_attempts, dsr_sync_error FROM day_closing_snapshots WHERE id = ?", [id]);
    assert.strictEqual(afterFailure.dsr_sync_status, "FAILED");
    assert.strictEqual(afterFailure.dsr_sync_attempts, 1);
    assert.strictEqual(afterFailure.dsr_sync_error, "offline");

    const successService = createDayClosingService({
        database: db, klbsVersion: "1.0.0-RC8",
        createBackup: async () => ({}), validateBackup: async () => ({ success: true }),
        sendEmail: async () => {},
        dsrSyncService: { sync: async p => ({
            success: true, action: "UPDATED", syncedAt: "2026-09-01T12:35:00.000Z",
            businessDate: p.businessDate, closingId: p.closingId, closeSequence: p.closeSequence
        }) },
        logDsrSyncFailed: async () => {}, logDsrSyncSucceeded: async () => {}
    });
    assert.strictEqual((await successService.retryDsrSync(id)).status, "SYNCED");
    const afterSuccess = await get("SELECT dsr_sync_status, dsr_sync_attempts, dsr_sync_error FROM day_closing_snapshots WHERE id = ?", [id]);
    assert.deepStrictEqual(afterSuccess, { dsr_sync_status: "SYNCED", dsr_sync_attempts: 2, dsr_sync_error: null });
    assert.strictEqual(AUTHORIZATION_POLICY.DSR_SYNC_RETRY, "ADMINISTRATOR");

    await run(`CREATE TABLE bills (
        id INTEGER PRIMARY KEY, bill_date TEXT, total_qty INTEGER,
        gross_amount REAL, discount_amount REAL, net_amount REAL,
        cash_amount REAL, upi_amount REAL, card_amount REAL,
        store_credit_amount REAL, gift_voucher_amount REAL
    )`);
    await run(`CREATE TABLE returns (
        id INTEGER PRIMARY KEY, net_reversal REAL, accounting_status TEXT,
        credit_note_no TEXT, accounting_snapshot_version INTEGER, business_date TEXT
    )`);
    await run("CREATE TABLE return_items (id INTEGER PRIMARY KEY, return_id INTEGER, quantity INTEGER)");
    await run(`CREATE TABLE customer_credit_transactions (
        id INTEGER PRIMARY KEY, transaction_type TEXT, amount REAL, created_at TEXT
    )`);
    await run(`INSERT INTO bills VALUES (1, '2026-09-10', 1, 100, 10, 90, 90, 0, 0, 0, 0)`);
    let observedPayload = null;
    const closeService = createDayClosingService({
        database: db, klbsVersion: "1.0.0-RC8",
        now: () => new Date("2026-09-10T12:00:00.000Z"),
        getBusinessDate: () => "2026-09-10",
        createBackup: async () => ({ backupFilePath: "/private/tmp/test.zip", backupFileName: "test.zip" }),
        validateBackup: async () => ({ success: true }),
        closingEmail: "test@example.invalid",
        sendEmail: async () => { throw new Error("injected email failure"); },
        dsrSyncService: { sync: async value => {
            observedPayload = value;
            return { success: false, error: "injected network failure" };
        } },
        logBusinessDayClosed: async () => {}, logBusinessDayReopened: async () => {},
        logDsrSyncFailed: async () => {}, logDsrSyncSucceeded: async () => {}
    });
    const closeResult = await closeService.closeBusinessDay();
    assert.strictEqual(closeResult.success, true);
    assert.strictEqual(closeResult.dsrSyncStatus, "FAILED");
    assert.strictEqual(observedPayload.emailStatus, "FAILED");
    assert.strictEqual(observedPayload.netBillingPaise, 9000);
    const closedRow = await get("SELECT close_status, dsr_sync_status FROM day_closing_snapshots WHERE id = ?", [closeResult.snapshotId]);
    assert.deepStrictEqual(closedRow, { close_status: "CLOSED", dsr_sync_status: "FAILED" });
    console.log("R09 DSR Phase 2 focused tests passed.");
    console.log(`Disposable database: ${dbPath}`);
}

main().then(() => db.close()).catch(error => {
    console.error(error);
    db.close(() => process.exit(1));
});
