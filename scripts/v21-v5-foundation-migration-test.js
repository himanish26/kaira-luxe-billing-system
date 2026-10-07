const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const {
    SCHEMA_METADATA_TABLE,
    prepareDatabaseSchema,
    readSchemaVersion,
    migrateBusinessSegmentColumns,
    migrateVariableValueBillingFoundation,
    migrateV5Foundation
} = require("../src/database/schemaVersion");

const run = (db, sql, params = []) => new Promise((resolve, reject) =>
    db.run(sql, params, function(error) { error ? reject(error) : resolve(this); }));
const get = (db, sql, params = []) => new Promise((resolve, reject) =>
    db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
const all = (db, sql, params = []) => new Promise((resolve, reject) =>
    db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
const exec = (db, sql) => new Promise((resolve, reject) =>
    db.exec(sql, error => error ? reject(error) : resolve()));
const close = db => new Promise((resolve, reject) =>
    db.close(error => error ? reject(error) : resolve()));
const V5_SCHEMA_VERSION = 5;

const V4_SCHEMA = `
    CREATE TABLE products (id INTEGER PRIMARY KEY, barcode TEXT UNIQUE, product_name TEXT,
        business_segment TEXT, variable_value INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE bills (id INTEGER PRIMARY KEY, bill_no TEXT UNIQUE, customer_name TEXT, customer_mobile TEXT);
    CREATE TABLE bill_items (id INTEGER PRIMARY KEY, bill_no TEXT, barcode TEXT, qty INTEGER,
        mrp REAL, gross_amount REAL, discount_percent REAL, discount_amount REAL,
        taxable_amount REAL, gst_rate REAL, gst_amount REAL, net_amount REAL, business_segment TEXT);
    CREATE TABLE settings (id INTEGER PRIMARY KEY);
    CREATE TABLE inventory_transactions (id INTEGER PRIMARY KEY, product_id INTEGER, barcode TEXT,
        transaction_type TEXT, quantity INTEGER, reference_type TEXT, reference_id TEXT);
    CREATE TABLE day_closing (id INTEGER PRIMARY KEY, business_date TEXT);
    CREATE TABLE customers (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_code TEXT UNIQUE,
        name TEXT NOT NULL, mobile TEXT UNIQUE, email TEXT, address TEXT, remarks TEXT,
        active INTEGER DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE returns (id INTEGER PRIMARY KEY, original_bill_no TEXT);
    CREATE TABLE return_items (id INTEGER PRIMARY KEY, return_id INTEGER, original_bill_item_id INTEGER);
    CREATE TABLE store_credits (id INTEGER PRIMARY KEY, return_id INTEGER, customer_id INTEGER);
    CREATE TABLE customer_credit_transactions (id INTEGER PRIMARY KEY, customer_id INTEGER);
    CREATE TABLE activities (id INTEGER PRIMARY KEY, action TEXT);
    CREATE TABLE day_closing_snapshots (id INTEGER PRIMARY KEY, business_date TEXT);
    CREATE TABLE integration_outbox (id INTEGER PRIMARY KEY, status TEXT);
    CREATE TABLE segment_dsr_outbox (id INTEGER PRIMARY KEY, status TEXT);
    CREATE TABLE consolidated_reporting_jobs (id INTEGER PRIMARY KEY, email_status TEXT);
    CREATE TABLE remote_dashboard_outbox (id INTEGER PRIMARY KEY, status TEXT);
    CREATE TABLE ${SCHEMA_METADATA_TABLE} (id INTEGER PRIMARY KEY CHECK (id=1), schema_version INTEGER NOT NULL);
    INSERT INTO ${SCHEMA_METADATA_TABLE} VALUES (1, 4);
`;

async function prepare(db) {
    return prepareDatabaseSchema({
        database: db,
        currentVersion: V5_SCHEMA_VERSION,
        migrations: [],
        runCurrentMigrations: async () => {
            await migrateBusinessSegmentColumns(db);
            await migrateVariableValueBillingFoundation(db);
            await migrateV5Foundation(db);
        }
    });
}

async function migrateAndAssert(filePath, fresh = false) {
    const db = new sqlite3.Database(filePath);
    await exec(db, V4_SCHEMA.replace("INSERT INTO klbs_schema_metadata VALUES (1, 4);", fresh ? "" : "INSERT INTO klbs_schema_metadata VALUES (1, 4);"));
    await run(db, "INSERT INTO products VALUES (17, 'BC-17', 'Fixture', 'KL', 0)");
    if (!fresh) {
        await run(db, `INSERT INTO bills (id, bill_no, customer_name, customer_mobile)
            VALUES (21, 'B-21', 'Historic Snapshot', '9990012345')`);
        await run(db, `INSERT INTO bill_items (id, bill_no, barcode, qty, mrp, gross_amount,
            discount_percent, discount_amount, taxable_amount, gst_rate, gst_amount,
            net_amount, business_segment)
            VALUES (31, 'B-21', 'BC-17', 2, 100, 200, 0, 0, 190.48, 5, 9.52, 200, 'KL')`);
        await run(db, `INSERT INTO customers (id, customer_code, name, mobile, created_at, updated_at)
            VALUES (41, 'C-41', 'Profile One', '9990012345', '2026-01-01', '2026-01-01')`);
        await run(db, `INSERT INTO returns VALUES (51, 'B-21')`);
        await run(db, `INSERT INTO return_items VALUES (61, 51, 31)`);
        await run(db, `INSERT INTO store_credits VALUES (71, 51, 41)`);
        await run(db, `INSERT INTO customer_credit_transactions VALUES (81, 41)`);
        await run(db, `INSERT INTO inventory_transactions VALUES (91, 17, 'BC-17', 'INWARD', 3, 'STOCK_INWARD', NULL)`);
        await run(db, `INSERT INTO activities VALUES (101, 'FIXTURE_ACTIVITY')`);
        await run(db, `INSERT INTO day_closing_snapshots VALUES (111, '2026-01-01')`);
        await run(db, `INSERT INTO integration_outbox VALUES (121, 'SUCCESS')`);
        await run(db, `INSERT INTO segment_dsr_outbox VALUES (131, 'SUCCESS')`);
        await run(db, `INSERT INTO consolidated_reporting_jobs VALUES (141, 'DELIVERED')`);
        await run(db, `INSERT INTO remote_dashboard_outbox VALUES (151, 'ACCEPTED')`);
    }

    await prepare(db);
    assert.strictEqual(await readSchemaVersion(db), V5_SCHEMA_VERSION);
    const tables = new Set((await all(db, "SELECT name FROM sqlite_master WHERE type='table'")).map(row => row.name));
    for (const name of ["stock_movements", "stock_movement_lines", "expenses"]) assert(tables.has(name));
    const fkViolations = await all(db, "PRAGMA foreign_key_check");
    assert.deepStrictEqual(fkViolations, []);
    assert.strictEqual((await get(db, "PRAGMA integrity_check")).integrity_check, "ok");

    const customerColumns = await all(db, "PRAGMA table_info(customers)");
    assert(customerColumns.some(column => column.name === "birthday_ddmm"));
    assert(customerColumns.some(column => column.name === "marriage_anniversary_ddmm"));
    assert(customerColumns.some(column => column.name === "mobile"));
    const uniqueCustomerIndexes = await all(db, "PRAGMA index_list(customers)");
    for (const index of uniqueCustomerIndexes.filter(row => row.unique === 1)) {
        const indexedColumns = await all(db, `PRAGMA index_info("${index.name}")`);
        assert(!indexedColumns.some(column => column.name === "mobile"), "Customer mobile must be non-unique.");
    }
    await run(db, `INSERT INTO customers (customer_code, name, mobile, created_at, updated_at)
        VALUES ('C-42', 'Profile Two', '9990012345', '2026-02-01', '2026-02-01')`);
    await run(db, `UPDATE customers SET birthday_ddmm='29/02', marriage_anniversary_ddmm='31/12'
        WHERE customer_code='C-42'`);
    await assert.rejects(() => run(db, `UPDATE customers SET birthday_ddmm='2026-02-29'
        WHERE customer_code='C-42'`));
    await run(db, "INSERT INTO bills (bill_no, customer_name, customer_mobile, customer_id) VALUES ('ANON', NULL, NULL, NULL)");
    assert.strictEqual((await get(db, "SELECT customer_id FROM bills WHERE bill_no='ANON'")).customer_id, null);

    if (!fresh) {
        assert.strictEqual((await get(db, "SELECT COUNT(*) AS n FROM products")).n, 1);
        assert.strictEqual((await get(db, "SELECT COUNT(*) AS n FROM bills WHERE bill_no='B-21'")).n, 1);
        assert.strictEqual((await get(db, "SELECT COUNT(*) AS n FROM bill_items WHERE id=31")).n, 1);
        assert.strictEqual((await get(db, "SELECT COUNT(*) AS n FROM customers WHERE id=41")).n, 1);
        assert.strictEqual((await get(db, "SELECT COUNT(*) AS n FROM returns")).n, 1);
        assert.strictEqual((await get(db, "SELECT COUNT(*) AS n FROM return_items")).n, 1);
        assert.strictEqual((await get(db, "SELECT COUNT(*) AS n FROM store_credits")).n, 1);
        assert.strictEqual((await get(db, "SELECT COUNT(*) AS n FROM customer_credit_transactions")).n, 1);
        assert.strictEqual((await get(db, "SELECT COUNT(*) AS n FROM inventory_transactions")).n, 1);
        assert.strictEqual((await get(db, "SELECT reference_id FROM inventory_transactions WHERE id=91")).reference_id, null);
        const historicItem = await get(db, "SELECT unit_cost_paise, cost_basis_status, cost_source FROM bill_items WHERE id=31");
        assert.deepStrictEqual(historicItem, { unit_cost_paise: null, cost_basis_status: "UNKNOWN", cost_source: null });
        const historicBill = await get(db, "SELECT customer_name, customer_mobile, customer_id FROM bills WHERE bill_no='B-21'");
        assert.deepStrictEqual(historicBill, { customer_name: "Historic Snapshot", customer_mobile: "9990012345", customer_id: null });
    }

    await run(db, `INSERT INTO bill_items (bill_no, unit_cost_paise, cost_basis_status, cost_source, cost_method)
        VALUES ('FUTURE', 12345, 'CAPTURED', 'PRODUCT_MASTER_AT_SAVE', 'UNIT_COST')`);
    await assert.rejects(() => run(db, `INSERT INTO bill_items (bill_no, unit_cost_paise, cost_basis_status)
        VALUES ('BAD-COST', 100, 'UNKNOWN')`));
    const movement = await run(db, `INSERT INTO stock_movements
        (movement_no, direction, status, business_date, idempotency_key, created_by, created_at, updated_at)
        VALUES ('M-1', 'INWARD', 'PENDING_MASTER', '2026-10-05', 'IDEM-1', 'MANAGER', 'now', 'now')`);
    await run(db, `INSERT INTO stock_movement_lines
        (movement_id, barcode, scanned_quantity, recognized_quantity, product_state, posting_state, created_at, updated_at)
        VALUES (?, 'UNKNOWN-1', 10, 0, 'PENDING_MASTER', 'UNPOSTED', 'now', 'now')`, [movement.lastID]);
    await run(db, `INSERT INTO stock_movement_lines
        (movement_id, barcode, scanned_quantity, recognized_quantity, product_id, product_state, posting_state, created_at, updated_at)
        VALUES (?, 'BC-17', 2, 2, 17, 'READY', 'UNPOSTED', 'now', 'now')`, [movement.lastID]);
    const outward = await run(db, `INSERT INTO stock_movements
        (movement_no, direction, status, business_date, idempotency_key, created_by, created_at, updated_at)
        VALUES ('M-2', 'OUTWARD', 'DRAFT', '2026-10-05', 'IDEM-2', 'MANAGER', 'now', 'now')`);
    await assert.rejects(() => run(db, `INSERT INTO stock_movement_lines
        (movement_id, barcode, scanned_quantity, product_state, created_at, updated_at)
        VALUES (?, 'UNKNOWN-OUT', 1, 'PENDING_MASTER', 'now', 'now')`, [outward.lastID]));
    const stockRowsBefore = (await get(db, "SELECT COUNT(*) AS n FROM inventory_transactions")).n;
    assert.strictEqual(stockRowsBefore, fresh ? 0 : 1);
    await run(db, `INSERT INTO expenses (expense_date, category, particulars, amount_paise, payment_mode,
        business_segment, lifecycle_status, entered_by, created_at, updated_at)
        VALUES ('2026-10-05', 'RENT', 'Fixture', 10000, 'CASH', 'COMMON', 'ACTIVE', 'MANAGER', 'now', 'now')`);
    await assert.rejects(() => run(db, `INSERT INTO expenses (expense_date, category, particulars, amount_paise,
        payment_mode, business_segment, entered_by, created_at, updated_at)
        VALUES ('2026-10-05', 'X', 'Bad segment', 100, 'CASH', 'STORE', 'M', 'now', 'now')`));
    await assert.rejects(() => run(db, "DELETE FROM expenses WHERE category='RENT'"));
    await assert.rejects(() => run(db, `INSERT INTO stock_movement_lines
        (movement_id, barcode, scanned_quantity, created_at, updated_at) VALUES (?, 'UNKNOWN-1', 1, 'now', 'now')`, [movement.lastID]));

    // Repeated startup must not duplicate foundation objects or alter historical rows.
    const firstCounts = await get(db, "SELECT (SELECT COUNT(*) FROM stock_movements) movements, (SELECT COUNT(*) FROM stock_movement_lines) lines, (SELECT COUNT(*) FROM expenses) expenses");
    await prepare(db);
    const secondCounts = await get(db, "SELECT (SELECT COUNT(*) FROM stock_movements) movements, (SELECT COUNT(*) FROM stock_movement_lines) lines, (SELECT COUNT(*) FROM expenses) expenses");
    assert.deepStrictEqual(secondCounts, firstCounts);
    assert.strictEqual(await readSchemaVersion(db), V5_SCHEMA_VERSION);
    assert.deepStrictEqual(await all(db, "PRAGMA foreign_key_check"), []);
    assert.strictEqual((await get(db, "PRAGMA integrity_check")).integrity_check, "ok");
    await close(db);
}

async function main() {
    assert.strictEqual(V5_SCHEMA_VERSION, 5);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "klbs-v21-v5-test-"));
    try {
        await migrateAndAssert(path.join(directory, "v4.db"));
        await migrateAndAssert(path.join(directory, "fresh.db"), true);
        console.log("PASS V21 V4-to-V5 migration, preservation, customer shared mobile, anonymous bill, cost UNKNOWN, stock pending foundation, expense constraints, clean initialization, repeated startup");
    }
    finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
