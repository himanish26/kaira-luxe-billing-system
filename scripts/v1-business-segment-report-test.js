const assert = require("assert");
const sqlite3 = require("sqlite3").verbose();
const { createBusinessSegmentReportService } = require("../src/database/businessSegmentReportService");

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => db.run(sql, params, error => error ? reject(error) : resolve()));
}

function exec(db, sql) {
    return new Promise((resolve, reject) => db.exec(sql, error => error ? reject(error) : resolve()));
}

async function main() {
    const db = new sqlite3.Database(":memory:");
    await exec(db, `
        CREATE TABLE bills (id INTEGER PRIMARY KEY, bill_no TEXT, bill_date TEXT, total_qty INTEGER, gross_amount REAL, net_amount REAL);
        CREATE TABLE bill_items (id INTEGER PRIMARY KEY, bill_no TEXT, barcode TEXT, qty INTEGER, mrp REAL, discount_amount REAL, taxable_amount REAL, gst_amount REAL, net_amount REAL, business_segment TEXT);
        CREATE TABLE products (barcode TEXT PRIMARY KEY, business_segment TEXT);
        CREATE TABLE returns (id INTEGER PRIMARY KEY, credit_note_no TEXT, business_date TEXT, accounting_status TEXT, accounting_snapshot_version INTEGER);
        CREATE TABLE return_items (id INTEGER PRIMARY KEY, return_id INTEGER, original_bill_item_id INTEGER, barcode TEXT, quantity INTEGER, net_reversal REAL);
    `);
    const bill = async (id, no, items, date = "2026-09-15") => {
        const totalQty = items.reduce((n, i) => n + i.qty, 0);
        const gross = items.reduce((n, i) => n + i.mrp * i.qty, 0);
        const net = items.reduce((n, i) => n + i.net, 0);
        await run(db, "INSERT INTO bills VALUES (?, ?, ?, ?, ?, ?)", [id, no, date, totalQty, gross, net]);
        for (const i of items) await run(db, "INSERT INTO bill_items VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [i.id, no, i.barcode || `B${i.id}`, i.qty, i.mrp, i.discount || 0, i.taxable || i.net, i.gst || 0, i.net, i.segment]);
    };
    await bill(1, "S1", [{ id: 1, qty: 2, mrp: 100, net: 190, segment: "KL" }]);
    await bill(2, "S2", [{ id: 2, qty: 3, mrp: 100, net: 300, segment: "MENS" }]);
    await bill(3, "S3", [{ id: 3, qty: 1, mrp: 50, net: 50, segment: "KIDS" }]);
    await bill(4, "S4", [
        { id: 4, qty: 1, mrp: 80, net: 80, segment: "KL" },
        { id: 5, qty: 2, mrp: 70, net: 120, segment: "MENS" },
        { id: 6, qty: 3, mrp: 30, net: 90, segment: "KIDS" }
    ]);
    await bill(5, "S5", [
        { id: 7, qty: 1, mrp: 10, net: 10, segment: "KL" },
        { id: 8, qty: 2, mrp: 10, net: 20, segment: "KL" }
    ]);
    await run(db, "INSERT INTO returns VALUES (1, 'CN1', '2026-09-15', 'COMPLETED', 1)");
    await run(db, "INSERT INTO return_items VALUES (1, 1, 5, 'B5', 1, 60)");
    await run(db, "INSERT INTO returns VALUES (2, 'CN2', '2026-09-18', 'COMPLETED', 1)");
    await run(db, "INSERT INTO return_items VALUES (2, 2, 2, 'B2', 2, 200)");
    await run(db, "INSERT INTO products VALUES ('B1', 'KL')");
    const service = createBusinessSegmentReportService({ database: db });
    const report = await service.calculateBusinessSegmentReport("2026-09-15");
    assert.strictEqual(report.kairaLuxe.bills, 3);
    assert.strictEqual(report.mensWear.bills, 2);
    assert.strictEqual(report.kidsWear.bills, 2);
    assert.strictEqual(report.overall.bills, 5);
    assert.strictEqual(report.mensWear.qtySold, 5);
    assert.strictEqual(report.mensWear.qtyReturned, 1);
    assert.strictEqual(report.mensWear.returnValue, 60);
    assert.strictEqual(report.mensWear.netSalesAfterReturns, 360);
    assert.strictEqual(report.mensWear.netQty, 4);
    assert.strictEqual(report.mensWear.atv, 210);
    assert.strictEqual(report.mensWear.upt, 2.5);
    assert.strictEqual(report.kairaLuxe.upt, 2);
    assert.strictEqual(report.kairaLuxe.atv, 100);
    assert.strictEqual(report.reconciliation.classified, true);
    assert.strictEqual(report.reconciliation.segmentQtySold, report.overall.qtySold);
    assert.strictEqual(report.reconciliation.segmentNetSalesAfterReturns, report.overall.netSalesAfterReturns);
    assert.strictEqual(report.reconciliation.segmentNetQty, report.overall.netQty);
    await run(db, "UPDATE products SET business_segment = 'MENS' WHERE barcode = 'B1'");
    const historical = await service.calculateBusinessSegmentReport("2026-09-15");
    assert.strictEqual(historical.kairaLuxe.qtySold, 6);
    assert.strictEqual(historical.mensWear.qtySold, 5);
    await bill(6, "N1", [{ id: 9, qty: 1, mrp: 10, net: 10, segment: null }], "2026-09-16");
    await bill(7, "N2", [{ id: 10, qty: 1, mrp: 10, net: 10, segment: "WOMEN" }], "2026-09-16");
    const incomplete = await service.calculateBusinessSegmentReport("2026-09-16");
    assert.strictEqual(incomplete.dataQuality.complete, false);
    assert.strictEqual(incomplete.dataQuality.unclassifiedSaleItemCount, 2);
    assert.strictEqual(incomplete.kairaLuxe.qtySold, 0);
    const empty = await service.calculateBusinessSegmentReport("2026-09-17");
    assert.deepStrictEqual(empty.kairaLuxe.qtySold, 0);
    assert.deepStrictEqual(empty.overall.netSalesAfterReturns, 0);
    assert.strictEqual(empty.kairaLuxe.atv, 0);
    assert.strictEqual(empty.kairaLuxe.upt, 0);
    const returnOnly = await service.calculateBusinessSegmentReport("2026-09-18");
    assert.strictEqual(returnOnly.mensWear.bills, 0);
    assert.strictEqual(returnOnly.mensWear.netSalesAfterReturns, -200);
    assert.strictEqual(returnOnly.mensWear.netQty, -2);
    assert.strictEqual(returnOnly.mensWear.atv, 0);
    assert.strictEqual(returnOnly.mensWear.upt, 0);
    assert(Number.isFinite(returnOnly.mensWear.atv));
    assert(Number.isFinite(returnOnly.mensWear.upt));
    await new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
    console.log("Business Segment Stage 2 reporting tests: PASS");
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
