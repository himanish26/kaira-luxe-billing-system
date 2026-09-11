const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const XLSX = require("xlsx");

const headers = [
    "Barcode", "SKU", "Brand", "Segment", "Category", "Season",
    "Collection", "Product Name", "Style Code", "Size", "Colour", "MRP",
    "Discount", "Selling Price", "Cost Price", "GST Rate", "HSN Code",
    "Opening Stock", "Reorder Level", "Supplier", "Active"
];

function writeFixture(filePath, rows) {
    const sheet = XLSX.utils.json_to_sheet(rows, { header: headers });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Product Master");
    XLSX.writeFile(workbook, filePath);
}

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => db.run(sql, params, function(error) {
        error ? reject(error) : resolve(this);
    }));
}

function get(db, sql, params = []) {
    return new Promise((resolve, reject) => db.get(sql, params, (error, row) => {
        error ? reject(error) : resolve(row);
    }));
}

function close(db) {
    return new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
}

function baseRow(barcode, overrides = {}) {
    return {
        Barcode: barcode, SKU: `SKU-${barcode}`, Brand: "Test Brand", Segment: "Women",
        Category: "Top", Season: "SS26", Collection: "Core", "Product Name": `Product ${barcode}`,
        "Style Code": "STYLE-1", Size: "M", Colour: "Blue", MRP: 100, Discount: 10,
        "Selling Price": 90, "Cost Price": 50, "GST Rate": 5, "HSN Code": "6109",
        "Opening Stock": 0, "Reorder Level": 1, Supplier: "Test Supplier", Active: true,
        ...overrides
    };
}

async function main() {
    const { app } = require("electron");
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "klbs-pm-validation-"));
    app.setPath("userData", path.join(tempRoot, "user data"));
    process.env.KLBS_DEV_DATABASE_PATH = path.join(tempRoot, "billing.db");
    const db = require("../src/database/database");
    await db.databaseReady;
    const { importProducts } = require("../src/database/importProducts");
    const { getProductByBarcode } = require("../src/database/productService");
    let sequence = 0;
    const importRows = async (rows) => {
        const filePath = path.join(tempRoot, `fixture-${++sequence}.xlsx`);
        writeFixture(filePath, rows);
        return importProducts(filePath);
    };
    const productCount = async () => (await get(db, "SELECT COUNT(*) AS count FROM products")).count;
    const openingCount = async () => (await get(db, "SELECT COUNT(*) AS count FROM inventory_transactions WHERE transaction_type = 'OPENING'")).count;
    const invalidCases = [
        ["blank barcode", { Barcode: "" }, "barcode"],
        ["blank Brand", { Brand: "" }, "brand"],
        ["blank Category", { Category: "" }, "category"],
        ["blank Product Name", { "Product Name": "" }, "product_name"],
        ["missing MRP", { MRP: undefined }, "mrp"],
        ["nonnumeric MRP", { MRP: "abc" }, "mrp"],
        ["negative MRP", { MRP: -1 }, "mrp"],
        ["missing GST Rate", { "GST Rate": undefined }, "gst_rate"],
        ["nonnumeric GST Rate", { "GST Rate": "abc" }, "gst_rate"],
        ["negative GST Rate", { "GST Rate": -1 }, "gst_rate"],
        ["negative Opening Stock", { "Opening Stock": -1 }, "opening_stock"]
    ];
    const validationResults = [];
    for (const [name, overrides, field] of invalidCases) {
        const beforeProducts = await productCount();
        const beforeOpening = await openingCount();
        const result = await importRows([baseRow(`890990${String(sequence).padStart(4, "0")}`, overrides)]);
        assert.strictEqual(result.success, false, `${name} should reject`);
        assert(result.error.includes("Row 2") && result.error.includes(field), `${name} error should identify row and field`);
        assert.strictEqual(await productCount(), beforeProducts, `${name} mutated products`);
        assert.strictEqual(await openingCount(), beforeOpening, `${name} mutated opening ledger`);
        validationResults.push(name);
    }

    const valid = await importRows([
        baseRow("8909900001", { MRP: 0, "GST Rate": 0, "Opening Stock": 0, Active: true }),
        baseRow("8909900002", { MRP: 250, "GST Rate": 0, "Opening Stock": 4, Active: false })
    ]);
    assert.strictEqual(valid.success, true);
    assert.strictEqual(valid.imported, 2);
    const active = await getProductByBarcode("8909900001");
    const inactive = await getProductByBarcode("8909900002");
    assert.strictEqual(active.active, 1);
    assert.strictEqual(inactive.active, 0);
    assert.strictEqual(active.mrp, 0);
    assert.strictEqual(active.gst_rate, 0);
    assert.strictEqual(active.current_stock, 0);
    assert.strictEqual(inactive.current_stock, 4);
    assert.strictEqual(await openingCount(), 1);

    const beforeAtomicProducts = await productCount();
    const beforeAtomicOpening = await openingCount();
    const atomic = await importRows([
        baseRow("8909900003", { "Opening Stock": 9 }),
        baseRow("8909900004", { Brand: "" })
    ]);
    assert.strictEqual(atomic.success, false);
    assert.strictEqual(await productCount(), beforeAtomicProducts);
    assert.strictEqual(await openingCount(), beforeAtomicOpening);
    assert.strictEqual(await getProductByBarcode("8909900003"), undefined);

    const duplicate = await importRows([
        baseRow("8909900005"),
        baseRow("8909900005")
    ]);
    assert.strictEqual(duplicate.success, false);
    assert.strictEqual(await getProductByBarcode("8909900005"), undefined);

    const existingFirst = await importRows([baseRow("8909900006", { "Opening Stock": 5, Active: true })]);
    assert.strictEqual(existingFirst.success, true);
    const openingBeforeUpdate = await openingCount();
    const existingUpdate = await importRows([baseRow("8909900006", { Brand: "Updated Brand", "Opening Stock": 99, Active: false })]);
    assert.strictEqual(existingUpdate.success, true);
    assert.strictEqual(existingUpdate.updated, 1);
    const updated = await getProductByBarcode("8909900006");
    assert.strictEqual(updated.brand, "Updated Brand");
    assert.strictEqual(updated.opening_stock, 5);
    assert.strictEqual(updated.current_stock, 5);
    assert.strictEqual(await openingCount(), openingBeforeUpdate);

    console.log(JSON.stringify({
        result: "PASS",
        validationCases: validationResults.length,
        validActive: active.active,
        validInactive: inactive.active,
        atomicity: "PASS",
        duplicate: "PASS",
        existingUpdate: "PASS",
        openingTransactions: await openingCount(),
        tempRoot
    }));
    await close(db);
    fs.rmSync(tempRoot, { recursive: true, force: true });
    app.exit(0);
}

main().catch(error => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
