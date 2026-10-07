const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => db.run(sql, params, function(error) {
        error ? reject(error) : resolve(this);
    }));
}

function close(db) {
    return new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
}

async function seed(db) {
    const rows = [
        ["SYSTEM", "APPLICATION_STARTED", "Kaira Luxe Billing System started", "SYSTEM", "SUCCESS", "APPLICATION", "APP-1"],
        ["BILLING", "INVOICE_GENERATED", "Invoice 001 generated", "OPERATOR", "SUCCESS", "BILL", "BILL-001"],
        ["INVENTORY", "STOCK_INWARD", "Restocked seasonal products", "billing-service", "SUCCESS", "BILLING_METADATA", "STOCK-001"],
        ["SECURITY", "PIN_CHANGED", "Administrator PIN changed", "billing-service", "SUCCESS", "BILLING_METADATA", "SEC-001"],
        ["STORE CREDIT", "STORE_CREDIT_ISSUED", "Store credit issued", "OPERATOR", "SUCCESS", "STORE_CREDIT", "STORE-001"],
        ["DAY CLOSING", "BUSINESS_DAY_CLOSED", "Business day closed", "ADMINISTRATOR", "SUCCESS", "BUSINESS_DAY", "24 Sep 2026"],
        ["PRINTING", "TEST_PRINT", "Printer test", "OPERATOR", "SUCCESS", "PRINTING", "PRINT-001"]
    ];
    for (const row of rows) {
        await run(db, `INSERT INTO activities
            (activity_date, activity_time, category, action, details, user_name, status, entity_type, reference_no, created_at)
            VALUES ('24 Sep 2026', '10:00:00 AM', ?, ?, ?, ?, ?, ?, ?, '2026-09-24T10:00:00.000Z')`, row);
    }
    for (let index = 1; index <= 201; index += 1) {
        await run(db, `INSERT INTO activities
            (activity_date, activity_time, category, action, details, user_name, status, entity_type, reference_no, created_at)
            VALUES ('24 Sep 2026', '10:00:00 AM', 'INVENTORY', 'STOCK_ADJUSTED', ?, 'OPERATOR', 'SUCCESS', 'INVENTORY', ?, ?)`, [
            `Unrelated stock adjustment ${index}`,
            `STOCK-${String(index).padStart(3, "0")}`,
            `2026-09-24T10:${String(index % 60).padStart(2, "0")}:00.000Z`
        ]);
    }
}

async function child(tempRoot) {
    const { app } = require("electron");
    app.setPath("userData", path.join(tempRoot, "user data"));
    const expectedDatabasePath = path.join(tempRoot, "billing.db");
    assert.strictEqual(process.env.KLBS_DEV_DATABASE_PATH, expectedDatabasePath,
        "test DB override must reach Electron before the database module loads");
    assert(expectedDatabasePath.startsWith(`${tempRoot}${path.sep}`), "database path is confined to the disposable test directory");
    const db = require("../src/database/database");
    await db.databaseReady;
    const pathAuthority = require("../src/database/databasePath");
    assert.strictEqual(pathAuthority.normalizeForComparison(db.databasePath),
        pathAuthority.normalizeForComparison(expectedDatabasePath), "database module resolved the expected disposable path");
    assert.strictEqual(await pathAuthority.assertAuthoritativeDatabaseConnection(db), true,
        "active SQLite connection matches the authoritative disposable path");
    const activeDatabasePath = await pathAuthority.readSqliteMainPath(db);
    assert.strictEqual(pathAuthority.normalizeForComparison(activeDatabasePath),
        pathAuthority.normalizeForComparison(expectedDatabasePath), "SQLite main path matches before test seed");
    assert(fs.existsSync(activeDatabasePath), "disposable test SQLite file exists before seed");
    await seed(db);
    const { getActivityPage } = require("../src/database/activityService");

    const all = await getActivityPage({ page: 1, pageSize: 100, keyword: "" });
    assert.strictEqual(all.totalCount, 208, "empty search returns the normal Activity Log set");
    assert.strictEqual(all.activities.length, 100, "empty search remains paginated");

    const invoice = await getActivityPage({ page: 1, pageSize: 100, keyword: "invoice" });
    assert.strictEqual(invoice.totalCount, 0, "action/details do not cause a category search match");

    for (const keyword of ["billing", "Billing", "BILLING"]) {
        const result = await getActivityPage({ page: 1, pageSize: 100, keyword });
        assert.strictEqual(result.totalCount, 1, `${keyword} is case-insensitive and category-only`);
        assert.deepStrictEqual(result.activities.map(row => row.reference_no), ["BILL-001"]);
    }

    assert.strictEqual((await getActivityPage({ page: 1, pageSize: 100, keyword: "bill" })).totalCount, 1);
    assert.strictEqual((await getActivityPage({ page: 1, pageSize: 100, keyword: "inven" })).totalCount, 202);
    assert.strictEqual((await getActivityPage({ page: 1, pageSize: 100, keyword: "store" })).totalCount, 1);

    const multiCategory = await getActivityPage({ page: 1, pageSize: 100, keyword: "in" });
    assert.strictEqual(multiCategory.totalCount, 205, "partial fragments return all matching categories");
    const multiCategoryRows = [...multiCategory.activities];
    for (let page = 2; page <= multiCategory.totalPages; page += 1) {
        multiCategoryRows.push(...(await getActivityPage({ page, pageSize: 100, keyword: "in" })).activities);
    }
    assert.deepStrictEqual([...new Set(multiCategoryRows.map(row => row.category))].sort(), [
        "BILLING", "DAY CLOSING", "INVENTORY", "PRINTING"
    ]);

    const secondInventoryPage = await getActivityPage({ page: 2, pageSize: 100, keyword: "inven" });
    assert.strictEqual(secondInventoryPage.totalCount, 202, "pagination count keeps the category predicate");
    assert.strictEqual(secondInventoryPage.page, 2);
    assert(secondInventoryPage.activities.length > 0);
    assert(secondInventoryPage.activities.every(row => row.category === "INVENTORY"));
    const jumpedInventoryPage = await getActivityPage({ page: 3, pageSize: 100, keyword: "inven" });
    assert.strictEqual(jumpedInventoryPage.page, 3);
    assert.strictEqual(jumpedInventoryPage.activities.length, 2);

    const missing = await getActivityPage({ page: 1, pageSize: 100, keyword: "does-not-exist" });
    assert.strictEqual(missing.totalCount, 0, "nonexistent search returns no rows");
    assert.deepStrictEqual(missing.activities, []);

    const special = await getActivityPage({ page: 1, pageSize: 100, keyword: "%\' OR 1=1 --" });
    assert.strictEqual(special.totalCount, 0, "special characters remain safely bound and literal");

    const whitespace = await getActivityPage({ page: 1, pageSize: 100, keyword: "  billing  " });
    assert.strictEqual(whitespace.totalCount, 1, "leading/trailing whitespace is trimmed");
    const cleared = await getActivityPage({ page: 1, pageSize: 100, keyword: "   " });
    assert.strictEqual(cleared.totalCount, 208, "whitespace-only search restores the normal set");

    await close(db);
    console.log("LOG-01 Activity Log search regression: PASS");
    app.exit(0);
}

if (process.argv.includes("--child")) {
    child(process.argv[process.argv.indexOf("--child") + 1]).catch(error => {
        console.error(error);
        try { require("electron").app.exit(1); } catch (_) {}
        process.exitCode = 1;
    });
}
else {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "klbs-log01-"));
    try {
        const result = spawnSync(require("electron"), [
            "--disable-gpu", "--in-process-gpu", __filename, "--child", tempRoot
        ], {
            cwd: path.resolve(__dirname, ".."),
            env: { ...process.env, KLBS_DEV_DATABASE_PATH: path.join(tempRoot, "billing.db") },
            encoding: "utf8", timeout: 120000, windowsHide: true
        });
        process.stdout.write(result.stdout || "");
        process.stderr.write(result.stderr || "");
        if (result.error) throw result.error;
        if (result.status !== 0) process.exitCode = result.status || 1;
    }
    finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}
