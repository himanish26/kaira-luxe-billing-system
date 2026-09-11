const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const XLSX = require("xlsx");

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => db.run(sql, params, function (error) {
        error ? reject(error) : resolve(this);
    }));
}

function all(db, sql, params = []) {
    return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => {
        error ? reject(error) : resolve(rows);
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

function workbook(filePath, rows) {
    const sheet = XLSX.utils.json_to_sheet(rows);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Products");
    XLSX.writeFile(book, filePath);
}

async function failedActivities(db, fileName) {
    return all(db, `SELECT category, action, reference_no, details, status
        FROM activities WHERE action = 'PRODUCT_MASTER_IMPORT_FAILED' AND reference_no = ?
        ORDER BY id DESC`, [fileName]);
}

async function child(tempRoot) {
    const { app } = require("electron");
    app.setPath("userData", path.join(tempRoot, "user data"));
    const db = require("../src/database/database");
    await db.databaseReady;
    const { importProducts } = require("../src/database/importProducts");
    const files = name => path.join(tempRoot, name);
    const valid = row => ({
        Barcode: row.barcode,
        Brand: "Import Test",
        Category: "Test",
        "Product Name": "Import Test Product",
        MRP: 100,
        "GST Rate": 0,
        "Opening Stock": 0,
        ...row
    });

    const validFile = files("valid.xlsx");
    workbook(validFile, [valid({ barcode: "IMP-VALID-001" })]);
    const success = await importProducts(validFile);
    assert.strictEqual(success.success, true);
    assert.strictEqual((await failedActivities(db, "valid.xlsx")).length, 0);
    assert.strictEqual((await get(db, "SELECT COUNT(*) AS count FROM activities WHERE action = 'PRODUCT_IMPORT_COMPLETED' AND reference_no = 'valid.xlsx'")).count, 1);

    const duplicateFile = files("duplicate.xlsx");
    workbook(duplicateFile, [
        valid({ barcode: "IMP-DUP-001" }),
        valid({ barcode: "IMP-DUP-001" })
    ]);
    const duplicate = await importProducts(duplicateFile);
    assert.strictEqual(duplicate.success, false);
    const duplicateActivities = await failedActivities(db, "duplicate.xlsx");
    assert.strictEqual(duplicateActivities.length, 1);
    assert.strictEqual(duplicateActivities[0].category, "INVENTORY");
    assert.strictEqual(duplicateActivities[0].status, "FAILED");
    assert(duplicateActivities[0].details.includes("Duplicate barcode"));
    assert(!duplicateActivities[0].reference_no.includes(path.sep));
    assert.strictEqual((await get(db, "SELECT COUNT(*) AS count FROM products WHERE barcode = 'IMP-DUP-001'")).count, 0);

    const invalidFile = files("invalid.xlsx");
    workbook(invalidFile, [valid({ barcode: "IMP-INVALID-001", mrp: -1 })]);
    const invalid = await importProducts(invalidFile);
    assert.strictEqual(invalid.success, false);
    const invalidActivities = await failedActivities(db, "invalid.xlsx");
    assert.strictEqual(invalidActivities.length, 1);
    assert(invalidActivities[0].details.includes("Product Master validation failed"));

    const malformedFile = files("malformed.xlsx");
    fs.writeFileSync(malformedFile, "not an Excel workbook");
    await assert.rejects(() => importProducts(malformedFile));
    const malformedActivities = await failedActivities(db, "malformed.xlsx");
    assert.strictEqual(malformedActivities.length, 1);
    assert.strictEqual(malformedActivities[0].status, "FAILED");
    assert(!malformedActivities[0].details.includes(" at "));

    const activity = await get(db, `SELECT category, action, reference_no, details, status
        FROM activities WHERE action = 'PRODUCT_MASTER_IMPORT_FAILED' AND reference_no = 'duplicate.xlsx'`);
    assert.deepStrictEqual(activity, duplicateActivities[0]);
    assert.strictEqual((await get(db, "SELECT COUNT(*) AS count FROM activities WHERE action = 'PRODUCT_MASTER_IMPORT_FAILED'")).count, 3);
    assert.strictEqual((await get(db, "PRAGMA integrity_check")).integrity_check, "ok");
    await close(db);
    process.stdout.write("Product Master failed-import activity regression: PASS\n");
    app.exit(0);
}

if (process.argv.includes("--child")) {
    child(process.argv[process.argv.indexOf("--child") + 1]).catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
} else {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "klbs-import-failure-"));
    const electronBinary = require("electron");
    const result = spawnSync(electronBinary, ["--disable-gpu", "--in-process-gpu", __filename, "--child", tempRoot], {
        cwd: path.resolve(__dirname, ".."),
        env: { ...process.env, KLBS_DEV_DATABASE_PATH: path.join(tempRoot, "billing.db") },
        encoding: "utf8",
        timeout: 120000,
        windowsHide: true
    });
    if (result.status !== 0) {
        process.stdout.write(result.stdout || "");
        process.stderr.write(result.stderr || "");
        process.exit(result.status || 1);
    }
    process.stdout.write(result.stdout);
}
