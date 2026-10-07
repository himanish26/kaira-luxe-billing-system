"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const ExcelJS = require("exceljs");

const run = (db, sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, error => error ? reject(error) : resolve()));
const exec = (db, sql) => new Promise((resolve, reject) => db.exec(sql, error => error ? reject(error) : resolve()));
const close = db => new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));

async function main() {
    const db = new sqlite3.Database(":memory:");
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "klbs-v21-03a-reports-"));
    require.cache[require.resolve("../src/database/database")] = { exports: db };
    const reports = require("../src/database/reportService");

    try {
        await exec(db, `
            CREATE TABLE bills (
                id INTEGER PRIMARY KEY, bill_no TEXT, bill_date TEXT, bill_time TEXT,
                customer_name TEXT, customer_mobile TEXT, total_qty INTEGER,
                gross_amount REAL, discount_amount REAL, net_amount REAL,
                cash_amount REAL, upi_amount REAL, card_amount REAL,
                store_credit_amount REAL, gift_voucher_amount REAL
            );
            CREATE TABLE bill_items (
                id INTEGER PRIMARY KEY, bill_no TEXT, qty INTEGER, brand TEXT,
                business_segment TEXT, barcode TEXT, product_name TEXT, colour TEXT,
                size TEXT, category TEXT, mrp REAL, gross_amount REAL,
                discount_amount REAL, taxable_amount REAL, gst_rate REAL,
                gst_amount REAL, net_amount REAL
            );
            CREATE TABLE returns (
                id INTEGER PRIMARY KEY, business_date TEXT, accounting_status TEXT,
                credit_note_no TEXT, accounting_snapshot_version INTEGER,
                return_no TEXT, original_bill_no TEXT, original_bill_date TEXT,
                customer_name TEXT, customer_mobile TEXT
            );
            CREATE TABLE return_items (
                id INTEGER PRIMARY KEY, return_id INTEGER, original_bill_item_id INTEGER,
                barcode TEXT, product_name TEXT, quantity INTEGER, mrp REAL,
                gross_reversal REAL, discount_percent REAL, discount_reversal REAL,
                taxable_reversal REAL, gst_rate REAL, cgst_reversal REAL,
                sgst_reversal REAL, gst_reversal REAL, net_reversal REAL
            );
            CREATE TABLE products (barcode TEXT PRIMARY KEY, segment TEXT, style_code TEXT, supplier TEXT, hsn_code TEXT);
            CREATE TABLE stores (id INTEGER PRIMARY KEY, store_code TEXT, store_name TEXT, status TEXT);
            CREATE TABLE store_context (id INTEGER PRIMARY KEY, current_store_id INTEGER);
            INSERT INTO stores VALUES (1, 'KL001', 'Kaira Luxe', 'ACTIVE');
            INSERT INTO store_context VALUES (1, 1);
        `);
        await run(db, `INSERT INTO bills
            (id,bill_no,bill_date,bill_time,customer_name,customer_mobile,total_qty,gross_amount,
             discount_amount,net_amount,cash_amount,upi_amount,card_amount,store_credit_amount,gift_voucher_amount)
            VALUES (1,'FIXTURE-1','2026-10-02','10:00:00 AM','Synthetic Fixture','9000000000',2,200,10,190,190,0,0,0,0)`);
        await run(db, `INSERT INTO bill_items
            (id,bill_no,qty,brand,business_segment,barcode,product_name,colour,size,category,mrp,gross_amount,
             discount_amount,taxable_amount,gst_rate,gst_amount,net_amount)
            VALUES (1,'FIXTURE-1',2,'Fixture Brand','KL','FIXTURE-1','Fixture Product','','','Fixture',100,200,10,180.95,5,9.05,190)`);
        await run(db, "INSERT INTO products (barcode,segment,style_code,supplier,hsn_code) VALUES ('FIXTURE-1','Fixture Segment','STYLE-1','Fixture Supplier','6109')");

        const customerRows = await reports.getCustomerPurchaseReport("2026-10-01", "2026-10-31");
        assert.strictEqual(customerRows.length, 1);
        assert.strictEqual(customerRows[0].total_bills, 1);
        assert.strictEqual(customerRows[0].net_purchase_after_returns, 190);
        const billRows = await reports.getBillSummaryReport("2026-10-01", "2026-10-31");
        assert.strictEqual(billRows.length, 1);
        assert.strictEqual(billRows[0].bill_no, "FIXTURE-1");
        assert.strictEqual(billRows[0].net_amount, 190);

        const customerPath = path.join(outputDir, "customer.xlsx");
        const billPath = path.join(outputDir, "bill-summary.xlsx");
        const businessPath = path.join(outputDir, "business.xlsx");
        const productPath = path.join(outputDir, "product.xlsx");
        await reports.exportReport({ reportType: "business", fromDate: "2026-10-01", toDate: "2026-10-31" }, businessPath);
        await reports.exportReport({ reportType: "product", fromDate: "2026-10-01", toDate: "2026-10-31" }, productPath);
        await reports.exportReport({ reportType: "customer", fromDate: "2026-10-01", toDate: "2026-10-31" }, customerPath);
        await reports.exportReport({ reportType: "billSummary", fromDate: "2026-10-01", toDate: "2026-10-31" }, billPath);

        for (const [file, sheetName, expectedHeader] of [
            [businessPath, "Business Report", "Bill No"],
            [productPath, "Product Sales Report", "Barcode"],
            [customerPath, "Customer Purchase Report", "Customer Name"],
            [billPath, "Bill Summary Report", "Bill No"]
        ]) {
            assert(fs.existsSync(file), `${sheetName} export file generated in disposable temp output`);
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.readFile(file);
            const sheet = workbook.getWorksheet(sheetName);
            assert(sheet, `${sheetName} worksheet exists`);
            assert.strictEqual(sheet.getCell("B6").value, "KL001", `${sheetName} includes resolved Store Code metadata`);
            assert.strictEqual(sheet.getRow(11).getCell(1).value, expectedHeader);
            assert(sheet.rowCount >= 12, `${sheetName} includes its synthetic fixture row`);
        }
        process.stdout.write("V21-03A Business, Product, Customer, and Bill Summary report-service Excel exports: PASS\n");
    } finally {
        await close(db);
        fs.rmSync(outputDir, { recursive: true, force: true });
        delete require.cache[require.resolve("../src/database/reportService")];
        delete require.cache[require.resolve("../src/database/database")];
    }
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
