const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const XLSX = require("xlsx");

const headers = [
    "Barcode", "SKU", "Brand", "Segment", "Business Segment", "Category", "Season",
    "Collection", "Product Name", "Style Code", "Size", "Colour", "MRP",
    "Discount", "Selling Price", "Cost Price", "GST Rate", "HSN Code",
    "Opening Stock", "Reorder Level", "Supplier", "Active", "Variable Value"
];

function writeFixture(filePath, rows, fixtureHeaders = headers) {
    const selectedRows = rows.map(row => Object.fromEntries(
        fixtureHeaders.filter(header => Object.prototype.hasOwnProperty.call(row, header))
            .map(header => [header, row[header]])
    ));
    const sheet = XLSX.utils.json_to_sheet(selectedRows, { header: fixtureHeaders });
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
        Barcode: barcode, SKU: `SKU-${barcode}`, Brand: "Test Brand", Segment: "Women", "Business Segment": "KL",
        Category: "Top", Season: "SS26", Collection: "Core", "Product Name": `Product ${barcode}`,
        "Style Code": "STYLE-1", Size: "M", Colour: "Blue", MRP: 100, Discount: 10,
        "Selling Price": 90, "Cost Price": 50, "GST Rate": 5, "HSN Code": "6109",
        "Opening Stock": 0, "Reorder Level": 1, Supplier: "Test Supplier", Active: true, "Variable Value": "NO",
        ...overrides
    };
}

async function child(tempRoot) {
    const { app } = require("electron");
    app.setPath("userData", path.join(tempRoot, "user data"));
    process.env.KLBS_DEV_DATABASE_PATH = path.join(tempRoot, "billing.db");
    const db = require("../src/database/database");
    await db.databaseReady;
    const productColumns = await new Promise((resolve, reject) => db.all("PRAGMA table_info(products)", (error, rows) => error ? reject(error) : resolve(rows)));
    const billItemColumns = await new Promise((resolve, reject) => db.all("PRAGMA table_info(bill_items)", (error, rows) => error ? reject(error) : resolve(rows)));
    assert(productColumns.some(column => column.name === "variable_value" && column.notnull === 1 && String(column.dflt_value) === "0"));
    assert(billItemColumns.some(column => column.name === "gross_amount"));
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
        , ["missing Business Segment", { "Business Segment": "" }, "business_segment"]
        , ["invalid Business Segment", { "Business Segment": "Men" }, "business_segment"]
        , ["SIS Business Segment", { "Business Segment": "SIS" }, "business_segment"]
        , ["invalid Variable Value Y", { "Variable Value": "Y" }, "variable_value"]
        , ["invalid Variable Value N", { "Variable Value": "N" }, "variable_value"]
        , ["invalid Variable Value TRUE", { "Variable Value": "TRUE" }, "variable_value"]
        , ["invalid Variable Value FALSE", { "Variable Value": "FALSE" }, "variable_value"]
        , ["invalid Variable Value 1", { "Variable Value": "1" }, "variable_value"]
        , ["invalid Variable Value 0", { "Variable Value": "0" }, "variable_value"]
        , ["invalid Variable Value VARIABLE", { "Variable Value": "VARIABLE" }, "variable_value"]
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
    assert.strictEqual(active.business_segment, "KL");
    assert.strictEqual(active.current_stock, 0);
    assert.strictEqual(inactive.current_stock, 4);
    assert.strictEqual(active.variable_value, 0);
    assert.strictEqual(inactive.variable_value, 0);
    assert.strictEqual(await openingCount(), 1);

    assert.strictEqual((await importRows([baseRow("8909900010", { "Variable Value": " yEs " })])).success, true);
    assert.strictEqual((await getProductByBarcode("8909900010")).variable_value, 1);
    assert.strictEqual((await importRows([baseRow("8909900011", { "Variable Value": " nO " })])).success, true);
    assert.strictEqual((await getProductByBarcode("8909900011")).variable_value, 0);
    assert.strictEqual((await importRows([baseRow("8909900012", { "Variable Value": " " })])).success, true);
    assert.strictEqual((await getProductByBarcode("8909900012")).variable_value, 0);

    assert.strictEqual((await importRows([baseRow("8909900013", { "Variable Value": "YES" })])).success, true);
    const legacyHeaders = headers.filter(header => header !== "Variable Value");
    const legacyWorkbookPath = path.join(tempRoot, `fixture-${++sequence}.xlsx`);
    writeFixture(legacyWorkbookPath, [baseRow("8909900013")], legacyHeaders);
    assert.strictEqual((await importProducts(legacyWorkbookPath)).success, true);
    assert.strictEqual((await getProductByBarcode("8909900013")).variable_value, 1);
    assert.strictEqual((await importRows([baseRow("8909900013", { "Variable Value": "" })])).success, true);
    assert.strictEqual((await getProductByBarcode("8909900013")).variable_value, 0);

    assert.strictEqual((await importRows([baseRow("8909900014", { "Variable Value": "NO" })])).success, true);
    assert.strictEqual((await importRows([baseRow("8909900014", { "Variable Value": "YES" })])).success, true);
    assert.strictEqual((await getProductByBarcode("8909900014")).variable_value, 1);

    const noHeaderNewPath = path.join(tempRoot, `fixture-${++sequence}.xlsx`);
    writeFixture(noHeaderNewPath, [baseRow("8909900015")], legacyHeaders);
    assert.strictEqual((await importProducts(noHeaderNewPath)).success, true);
    assert.strictEqual((await getProductByBarcode("8909900015")).variable_value, 0);

    assert.strictEqual((await importRows([baseRow("8909900016", { MRP: 1, "Variable Value": "NO" })])).success, true);
    assert.strictEqual((await getProductByBarcode("8909900016")).variable_value, 0);

    const templatePath = path.join(tempRoot, "product-master-template.xlsx");
    await require("../src/database/productMasterExporter").downloadProductMasterTemplate(templatePath);
    const templateWorkbook = XLSX.readFile(templatePath);
    const templateRows = XLSX.utils.sheet_to_json(templateWorkbook.Sheets["Product Master"], { defval: "" });
    assert.strictEqual(templateRows[0]["Variable Value"], "NO");
    assert(XLSX.utils.sheet_to_json(templateWorkbook.Sheets.Instructions, { header: 1 }).flat().some(value => String(value).includes("Variable Value") && String(value).includes("YES or NO")));

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

    const labelImport = await importRows([
        baseRow("8909900007", { "Business Segment": "Mens Wear" }),
        baseRow("8909900008", { "Business Segment": "Kids Wear" })
    ]);
    assert.strictEqual(labelImport.success, true);
    assert.strictEqual((await getProductByBarcode("8909900007")).business_segment, "MENS");
    assert.strictEqual((await getProductByBarcode("8909900008")).business_segment, "KIDS");
    const reimported = await importRows([
        baseRow("8909900007", { "Business Segment": "KL" })
    ]);
    assert.strictEqual(reimported.success, true);
    assert.strictEqual((await getProductByBarcode("8909900007")).business_segment, "KL");

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

if (process.argv.includes("--node-child")) {
    const tempRoot = process.argv[process.argv.indexOf("--node-child") + 1];
    const Module = require("module");
    const originalLoad = Module._load;
    const app = {
        isPackaged: false,
        setPath() {},
        getPath: () => path.join(tempRoot, "user data"),
        exit: code => process.exit(code)
    };
    Module._load = function(request, parent, isMain) {
        if (request === "electron") return { app };
        return originalLoad.call(this, request, parent, isMain);
    };
    child(tempRoot).catch(error => {
        console.error(error.stack || error);
        process.exitCode = 1;
    });
} else {
    const tempRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "klbs-pm-validation-"));
    const result = spawnSync(
        process.execPath,
        [__filename, "--node-child", tempRoot],
        {
            cwd: path.resolve(__dirname, ".."),
            env: { ...process.env, KLBS_DEV_DATABASE_PATH: path.join(tempRoot, "billing.db") },
            encoding: "utf8",
            timeout: 120000,
            windowsHide: true
        }
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
        process.stdout.write(result.stdout || "");
        process.stderr.write(result.stderr || "");
        process.exit(result.status || 1);
    }
    process.stdout.write(result.stdout || "");
}
