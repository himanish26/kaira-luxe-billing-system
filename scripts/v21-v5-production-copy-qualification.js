const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const {
    CURRENT_DB_SCHEMA_VERSION,
    prepareDatabaseSchema,
    readSchemaVersion,
    migrateV5Foundation
} = require("../src/database/schemaVersion");

const WORKSPACE = "/private/tmp/KLBS-V21-01-qualification";
const run = (db, sql, params = []) => new Promise((resolve, reject) =>
    db.run(sql, params, function(error) { error ? reject(error) : resolve(this); }));
const get = (db, sql, params = []) => new Promise((resolve, reject) =>
    db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
const all = (db, sql, params = []) => new Promise((resolve, reject) =>
    db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
const close = db => new Promise((resolve, reject) =>
    db.close(error => error ? reject(error) : resolve()));

async function tableCount(db, table) {
    const row = await get(db, `SELECT COUNT(*) AS count FROM "${table}"`);
    return Number(row.count);
}

async function snapshotHash(db) {
    const bills = await all(db, `SELECT id, bill_no, bill_date, bill_time, customer_name, customer_mobile,
        total_items, total_qty, gross_amount, discount_amount, taxable_amount, cgst_amount,
        sgst_amount, gst_amount, net_amount, cash_amount, upi_amount, card_amount,
        store_credit_amount, gift_voucher_amount, payment_status, created_at
        FROM bills ORDER BY id`);
    const items = await all(db, `SELECT id, bill_no, barcode, product_name, brand, category, size,
        colour, qty, mrp, discount_percent, discount_amount, taxable_amount, gst_rate,
        gst_amount, net_amount, business_segment, gross_amount FROM bill_items ORDER BY id`);
    return crypto.createHash("sha256").update(JSON.stringify({ bills, items })).digest("hex");
}

async function controls(db) {
    const tableNames = ["products", "bills", "bill_items", "customers", "returns", "return_items",
        "store_credits", "customer_credit_transactions", "inventory_transactions", "day_closing",
        "day_closing_snapshots", "activities", "integration_outbox", "segment_dsr_outbox",
        "consolidated_reporting_jobs", "remote_dashboard_outbox"];
    const counts = {};
    for (const table of tableNames) counts[table] = await tableCount(db, table);
    const byType = await all(db, `SELECT transaction_type, COUNT(*) AS rows, SUM(quantity) AS quantity
        FROM inventory_transactions GROUP BY transaction_type ORDER BY transaction_type`);
    const inventory = await get(db, `SELECT COUNT(*) AS rows, SUM(quantity) AS quantity_sum,
        SUM(COALESCE(product_id, 0) * 1000003 + quantity) AS checksum
        FROM inventory_transactions`);
    return {
        counts,
        inventory: { ...inventory, byType },
        billSnapshotSha256: await snapshotHash(db)
    };
}

async function main() {
    const dbPath = path.resolve(process.argv[2] || "");
    const expected = path.join(WORKSPACE, "working-billing.db");
    assert.strictEqual(dbPath, expected, "Qualification is restricted to the designated working copy.");
    assert(fs.existsSync(dbPath), "Working qualification DB is missing.");
    assert.strictEqual(CURRENT_DB_SCHEMA_VERSION, 5);

    const db = new sqlite3.Database(dbPath);
    await run(db, "PRAGMA foreign_keys = ON");
    const beforeIntegrity = await get(db, "PRAGMA integrity_check");
    const beforeForeignKeys = await all(db, "PRAGMA foreign_key_check");
    assert.strictEqual(beforeIntegrity.integrity_check, "ok");
    assert.deepStrictEqual(beforeForeignKeys, []);
    const beforeVersion = await readSchemaVersion(db);
    assert.strictEqual(beforeVersion, 4);
    const before = await controls(db);

    const prepare = () => prepareDatabaseSchema({
        database: db,
        currentVersion: CURRENT_DB_SCHEMA_VERSION,
        migrations: [],
        runCurrentMigrations: () => migrateV5Foundation(db)
    });
    await prepare();
    const afterFirst = await controls(db);
    assert.strictEqual(await readSchemaVersion(db), 5);
    assert.deepStrictEqual(afterFirst, before, "V5 migration changed pre-existing business records or stock control totals.");
    assert.strictEqual((await get(db, "PRAGMA integrity_check")).integrity_check, "ok");
    assert.deepStrictEqual(await all(db, "PRAGMA foreign_key_check"), []);

    const unknownCost = await get(db, `SELECT COUNT(*) AS total,
        SUM(cost_basis_status <> 'UNKNOWN' OR unit_cost_paise IS NOT NULL) AS non_unknown
        FROM bill_items`);
    assert.strictEqual(Number(unknownCost.total), before.counts.bill_items);
    assert.strictEqual(Number(unknownCost.non_unknown || 0), 0);
    const linkedBills = await get(db, "SELECT COUNT(*) AS count FROM bills WHERE customer_id IS NOT NULL");
    assert.strictEqual(Number(linkedBills.count), 0);
    const syntheticMovementCount = await get(db, "SELECT COUNT(*) AS count FROM stock_movements");
    assert.strictEqual(Number(syntheticMovementCount.count), 0);

    await prepare();
    const afterSecond = await controls(db);
    assert.deepStrictEqual(afterSecond, before, "Repeated startup changed business control totals.");
    assert.strictEqual(await readSchemaVersion(db), 5);
    assert.strictEqual((await get(db, "PRAGMA integrity_check")).integrity_check, "ok");
    assert.deepStrictEqual(await all(db, "PRAGMA foreign_key_check"), []);
    await close(db);

    console.log(JSON.stringify({
        result: "PASS",
        databasePath: dbPath,
        databaseSizeBytes: fs.statSync(dbPath).size,
        schemaVersionBefore: beforeVersion,
        schemaVersionAfter: 5,
        before,
        afterFirst,
        afterSecond,
        integrityBefore: beforeIntegrity.integrity_check,
        integrityAfter: "ok",
        foreignKeyViolationsBefore: beforeForeignKeys.length,
        foreignKeyViolationsAfter: 0,
        historicalBillCostsUnknown: true,
        linkedHistoricalBills: Number(linkedBills.count),
        syntheticLegacyMovements: Number(syntheticMovementCount.count)
    }, null, 2));
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
