const assert = require("assert");
const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const root = path.join(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const receipt = read("src/renderer/receipt.js");
const history = read("src/renderer/app.js");
const productSales = read("src/database/reportService.js");
const segmentReport = read("src/database/businessSegmentReportService.js");
const businessExport = read("src/database/excelExporter.js");

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => db.run(sql, params, error => error ? reject(error) : resolve()));
}
function all(db, sql, params = []) {
    return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
}

async function main() {
    assert.match(receipt, /Number\(item\.variable_value\)\s*===\s*1\s*&&\s*item\.gross_amount\s*!=\s*null/);
    assert.match(history, /Number\(item\.variable_value\)\s*===\s*1\s*&&\s*item\.gross_amount\s*!=\s*null/);
    assert.match(productSales, /COALESCE\(bi\.gross_amount, bi\.mrp \* bi\.qty\)\s*,?\s*2\s*\)?\s*AS gross_sales/s);
    assert.match(segmentReport, /COALESCE\(bi\.gross_amount, bi\.mrp \* bi\.qty\)/);
    assert.match(businessExport, /row\.gross_amount == null[\s\S]*?Number\(row\.mrp \|\| 0\) \* Number\(row\.quantity \|\| 0\)/);
    assert.match(businessExport, /SUM\('Business Report'!Z12:Z\$\{salesEnd\}\)/);

    const reportDb = new sqlite3.Database(":memory:");
    require.cache[require.resolve("../src/database/database")] = { exports: reportDb };
    const reports = require("../src/database/reportService");
    await new Promise((resolve, reject) => reportDb.exec(`
        CREATE TABLE bills (bill_no TEXT, bill_date TEXT);
        CREATE TABLE products (barcode TEXT, segment TEXT, style_code TEXT);
        CREATE TABLE bill_items (
            id INTEGER, bill_no TEXT, barcode TEXT, brand TEXT, business_segment TEXT,
            product_name TEXT, colour TEXT, size TEXT, category TEXT, qty INTEGER,
            mrp REAL, gross_amount REAL, discount_amount REAL, taxable_amount REAL,
            gst_amount REAL, net_amount REAL
        );
        CREATE TABLE returns (
            id INTEGER, credit_note_no TEXT, business_date TEXT, accounting_status TEXT,
            original_bill_no TEXT, original_bill_date TEXT, return_no TEXT,
            customer_name TEXT, customer_mobile TEXT, accounting_snapshot_version INTEGER
        );
        CREATE TABLE return_items (
            id INTEGER, return_id INTEGER, original_bill_item_id INTEGER, barcode TEXT,
            product_name TEXT, quantity INTEGER, net_reversal REAL
        );
        INSERT INTO bills VALUES ('MIXED', '2026-09-28');
        INSERT INTO bill_items VALUES (1, 'MIXED', 'COS', 'Generic', 'KL', 'Cosmetics', '', '', '', 3, 1, 80, 0, 76.19, 3.81, 80);
        INSERT INTO bill_items VALUES (2, 'MIXED', 'BRA', 'Jockey', 'KL', 'Bra', '', '', '', 1, 599, 599, 72, 501.90, 25.10, 527);
        INSERT INTO bill_items VALUES (3, 'MIXED', 'NIT', 'Generic', 'KL', 'Nighty', '', '', '', 3, 1, 800, 80, 685.71, 34.29, 720);
        INSERT INTO bill_items VALUES (4, 'MIXED', 'OLD', 'Legacy', 'KL', 'Legacy', '', '', '', 2, 100, NULL, 0, 190.48, 9.52, 200);
        INSERT INTO products VALUES ('COS', 'Luxe', 'C1');
        INSERT INTO products VALUES ('BRA', 'Luxe', 'B1');
        INSERT INTO products VALUES ('NIT', 'Luxe', 'N1');
        INSERT INTO products VALUES ('OLD', 'Luxe', 'O1');
    `, error => error ? reject(error) : resolve()));
    const productRows = await reports.getProductSalesReport("2026-09-28", "2026-09-28");
    const productMoney = productRows.filter(row => ["COS", "BRA", "NIT"].includes(row.barcode));
    assert.strictEqual(productMoney.reduce((sum, row) => sum + row.gross_sales, 0), 1479);
    assert.strictEqual(productMoney.reduce((sum, row) => sum + row.discount_amount, 0), 152);
    assert.strictEqual(productMoney.reduce((sum, row) => sum + row.net_sales, 0), 1327);
    assert.strictEqual(productRows.find(row => row.barcode === "OLD").gross_sales, 200);
    await new Promise((resolve, reject) => reportDb.close(error => error ? reject(error) : resolve()));

    const db = new sqlite3.Database(":memory:");
    await run(db, "CREATE TABLE bill_items (id INTEGER, qty INTEGER, mrp REAL, gross_amount REAL, discount_amount REAL, net_amount REAL)");
    await run(db, "INSERT INTO bill_items VALUES (1, 3, 1, 80, 0, 80)");
    await run(db, "INSERT INTO bill_items VALUES (2, 3, 1, 800, 80, 720)");
    await run(db, "INSERT INTO bill_items VALUES (3, 1, 599, 599, 72, 527)");
    await run(db, "INSERT INTO bill_items VALUES (4, 2, 100, NULL, 0, 200)");
    const rows = await all(db, "SELECT id, qty, mrp, gross_amount, discount_amount, net_amount, COALESCE(gross_amount, mrp * qty) AS gross FROM bill_items ORDER BY id");
    assert.deepStrictEqual(rows.map(row => row.gross), [80, 800, 599, 200]);
    assert.strictEqual(rows.reduce((sum, row) => sum + row.gross, 0), 1679);
    assert.strictEqual(rows.slice(0, 3).reduce((sum, row) => sum + row.gross, 0), 1479);
    assert.strictEqual(rows.slice(0, 3).reduce((sum, row) => sum + row.discount_amount, 0), 152);
    assert.strictEqual(rows.slice(0, 3).reduce((sum, row) => sum + row.net_amount, 0), 1327);
    const variableLine = items => Math.round(
        Number(items.variable_value) === 1 && items.gross_amount != null
            ? Number(items.gross_amount)
            : Number(items.mrp) || 0
    );
    assert.strictEqual(variableLine({ variable_value: 1, gross_amount: 80, mrp: 1 }), 80);
    assert.strictEqual(variableLine({ variable_value: 1, gross_amount: 800, mrp: 1 }), 800);
    assert.strictEqual(variableLine({ variable_value: 0, gross_amount: 599, mrp: 599 }), 599);
    assert.strictEqual(variableLine({ variable_value: 1, gross_amount: null, mrp: 100 }), 100);
    assert.deepStrictEqual(rows.slice(0, 3).map(row => variableLine({
        variable_value: row.id === 3 ? 0 : 1,
        gross_amount: row.gross_amount,
        mrp: row.mrp
    })), [80, 800, 599]);
    await new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
    console.log("Variable-Value downstream consumer tests: PASS");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
