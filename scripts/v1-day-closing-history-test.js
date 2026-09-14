const assert = require("assert");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();
const { createDayClosingHistoryService } = require("../src/database/dayClosingHistoryService");

const run = (db, sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, error => error ? reject(error) : resolve()));
const get = (db, sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row)));
const close = db => new Promise(resolve => db.close(resolve));
const subtractCalendarDay = value => {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
};

async function main() {
    const db = new sqlite3.Database(":memory:");
    await run(db, `CREATE TABLE day_closing_snapshots (
        id INTEGER PRIMARY KEY, business_date TEXT, close_sequence INTEGER, snapshot_version INTEGER,
        close_status TEXT, closed_at TEXT, closed_by TEXT, total_bills INTEGER, qty_sold INTEGER,
        gross_sales_paise INTEGER, total_discount_paise INTEGER, net_billing_paise INTEGER,
        credit_note_count INTEGER, qty_returned INTEGER, return_cn_value_paise INTEGER,
        net_sales_after_returns_paise INTEGER, cash_paise INTEGER, upi_paise INTEGER, card_paise INTEGER,
        store_credit_redeemed_paise INTEGER, gift_voucher_redeemed_paise INTEGER, settlement_total_paise INTEGER,
        actual_money_collection_paise INTEGER, store_credit_issued_paise INTEGER, settlement_difference_paise INTEGER,
        backup_status TEXT, email_status TEXT, dsr_sync_status TEXT, dsr_synced_at TEXT, remarks TEXT
    )`);
    const values = (id, date, sequence, bills) => [id, date, sequence, 1, "CLOSED", `${date}T12:00:00.000Z`, "Administrator", bills, bills, bills * 100, 0, bills * 100, 0, 0, 0, bills * 100, bills * 100, 0, 0, bills * 100, 0, bills * 100, bills * 100, 0, 0, "SUCCESS", "SUCCESS", "SYNCED", null, null];
    const insertSql = `INSERT INTO day_closing_snapshots VALUES (${new Array(30).fill("?").join(",")})`;
    await run(db, insertSql, values(1, "2026-09-11", 1, 4));
    await run(db, insertSql, values(2, "2026-09-13", 1, 5));
    await run(db, insertSql, values(3, "2026-09-13", 2, 6));

    const service = createDayClosingHistoryService({ database: db });
    const before = (await get(db, "SELECT total_changes() AS count")).count;
    assert.deepStrictEqual(await service.listSnapshotBusinessDates(), ["2026-09-11", "2026-09-13"]);
    const snapshots = await service.listSnapshotsForDate("2026-09-13");
    assert.deepStrictEqual(snapshots.map(item => item.closeSequence), [2, 1]);
    assert.strictEqual((await service.getLatestSnapshotForDate("2026-09-13")).snapshotId, 3);
    assert.strictEqual((await service.getSnapshot(1)).netBilling, 4);
    assert.deepStrictEqual(await service.listSnapshotsForDate("2026-09-12"), []);
    const after = (await get(db, "SELECT total_changes() AS count")).count;
    assert.strictEqual(after, before, "history reads must not change the database");

    const mainSource = fs.readFileSync("src/main/main.js", "utf8");
    const rendererSource = fs.readFileSync("src/renderer/modules/system/dayClosingHistory.js", "utf8");
    assert(mainSource.includes("Only the final Day Closing sequence can be printed."));
    assert(mainSource.includes("await printDayClosingReceipt(snapshot)"));
    assert(rendererSource.includes("getBusinessDayStatus()"));
    assert(rendererSource.includes("date.max = historyMaximumDate"));
    assert(rendererSource.includes("value > historyMaximumDate"));
    assert.strictEqual(subtractCalendarDay("2026-09-14"), "2026-09-13");
    assert.strictEqual(subtractCalendarDay("2026-10-01"), "2026-09-30");
    assert.strictEqual(subtractCalendarDay("2027-01-01"), "2026-12-31");
    await close(db);
    console.log("Day Closing History focused regression: PASS");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
