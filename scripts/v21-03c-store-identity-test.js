"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const { CURRENT_DB_SCHEMA_VERSION, prepareDatabaseSchema, readSchemaVersion } = require("../src/database/schemaVersion");
const { createStoreIdentityService } = require("../src/database/storeIdentityService");

const run = (db, sql, params = []) => new Promise((resolve, reject) =>
    db.run(sql, params, function(error) { error ? reject(error) : resolve({ changes: this.changes, lastID: this.lastID }); }));
const get = (db, sql, params = []) => new Promise((resolve, reject) =>
    db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
const all = (db, sql, params = []) => new Promise((resolve, reject) =>
    db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
const exec = (db, sql) => new Promise((resolve, reject) => db.exec(sql, error => error ? reject(error) : resolve()));
const close = db => new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));

const BASE = `
    PRAGMA foreign_keys = ON;
    CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE bills (id INTEGER PRIMARY KEY, bill_no TEXT UNIQUE);
    CREATE TABLE bill_items (id INTEGER PRIMARY KEY, bill_no TEXT, business_segment TEXT,
        unit_cost_paise INTEGER, cost_basis_status TEXT DEFAULT 'UNKNOWN', cost_source TEXT, cost_method TEXT);
    CREATE TABLE returns (id INTEGER PRIMARY KEY, original_bill_no TEXT,
        accounting_status TEXT DEFAULT 'LEGACY_UNASSESSED', business_date TEXT,
        accounting_snapshot_version INTEGER);
    CREATE TABLE return_items (id INTEGER PRIMARY KEY, return_id INTEGER,
        original_bill_item_id INTEGER, quantity INTEGER);
    CREATE TABLE settings (id INTEGER PRIMARY KEY, store_name TEXT, gstin TEXT);
    CREATE TABLE inventory_transactions (id INTEGER PRIMARY KEY, quantity INTEGER);
    CREATE TABLE day_closing (id INTEGER PRIMARY KEY, business_date TEXT);
    CREATE TABLE expenses (id INTEGER PRIMARY KEY, expense_date TEXT NOT NULL, category TEXT NOT NULL,
        particulars TEXT NOT NULL, expense_class TEXT NOT NULL DEFAULT 'OPERATING', amount_paise INTEGER NOT NULL,
        payment_mode TEXT NOT NULL, paid_to TEXT, reference TEXT, business_segment TEXT NOT NULL,
        remarks TEXT, lifecycle_status TEXT NOT NULL DEFAULT 'ACTIVE', entered_by TEXT NOT NULL,
        last_modified_by TEXT, correction_reason TEXT, corrects_expense_id INTEGER, created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL, voided_by TEXT, voided_at TEXT, void_reason TEXT);
    CREATE TABLE klbs_schema_metadata (id INTEGER PRIMARY KEY CHECK(id=1), schema_version INTEGER NOT NULL);
`;

async function openV5() {
    const db = new sqlite3.Database(":memory:");
    await exec(db, BASE);
    await run(db, "INSERT INTO klbs_schema_metadata VALUES (1, 5)");
    await run(db, "INSERT INTO settings VALUES (1, 'Legacy Display Name', 'GST-UNCHANGED')");
    await run(db, "INSERT INTO bills VALUES (7, 'HISTORIC-7')");
    return db;
}

async function migrate(db) {
    return prepareDatabaseSchema({ database: db, currentVersion: CURRENT_DB_SCHEMA_VERSION, runCurrentMigrations: async () => {} });
}

async function main() {
    assert.strictEqual(CURRENT_DB_SCHEMA_VERSION, 8);

    const db = await openV5();
    try {
        await migrate(db);
        assert.strictEqual(await readSchemaVersion(db), 8);
        assert.deepStrictEqual(await get(db, "SELECT id, store_code, store_name, status FROM stores"),
            { id: 1, store_code: "KL001", store_name: "Kaira Luxe", status: "ACTIVE" });
        assert.deepStrictEqual(await get(db, "SELECT id, current_store_id FROM store_context"), { id: 1, current_store_id: 1 });
        assert.strictEqual(Number((await get(db, "SELECT COUNT(*) AS count FROM store_context")).count), 1);
        assert.deepStrictEqual(await get(db, "SELECT store_name, gstin FROM settings WHERE id=1"),
            { store_name: "Legacy Display Name", gstin: "GST-UNCHANGED" });
        assert.deepStrictEqual(await get(db, "SELECT id, bill_no FROM bills WHERE id=7"), { id: 7, bill_no: "HISTORIC-7" });
        assert.deepStrictEqual(await all(db, "PRAGMA foreign_key_check"), []);
        assert.strictEqual((await get(db, "PRAGMA integrity_check")).integrity_check, "ok");

        const service = createStoreIdentityService(db);
        assert.deepStrictEqual(await service.getCurrentStore(), {
            id: 1, storeCode: "KL001", storeName: "Kaira Luxe", status: "ACTIVE"
        });
        await assert.rejects(() => run(db,
            "INSERT INTO stores (store_code, store_name, status, created_at, updated_at) VALUES ('KL001','Duplicate','ACTIVE','x','x')"));
        await assert.rejects(() => run(db, "UPDATE stores SET store_code='KL002' WHERE id=1"), /KLBS_STORE_CODE_IMMUTABLE/);
        await assert.rejects(() => run(db, "UPDATE stores SET status='PAUSED' WHERE id=1"));
        await assert.rejects(() => run(db, "INSERT INTO store_context (id,current_store_id) VALUES (2,1)"));
        await run(db, "UPDATE stores SET status='INACTIVE' WHERE id=1");
        await assert.rejects(() => service.getCurrentStore(), /current Store is inactive/);
        await run(db, "UPDATE stores SET status='ACTIVE' WHERE id=1");
        await run(db, "DELETE FROM store_context WHERE id=1");
        await assert.rejects(() => service.getCurrentStore(), /current Store is not configured/);
        await run(db, "PRAGMA foreign_keys = OFF");
        await run(db, "INSERT INTO store_context (id,current_store_id) VALUES (1,99)");
        await assert.rejects(() => service.getCurrentStore(), /reference is invalid/);
    } finally {
        await close(db);
    }

    const rollbackDb = await openV5();
    try {
        await run(rollbackDb, "CREATE TABLE store_context (id INTEGER PRIMARY KEY)");
        await assert.rejects(() => migrate(rollbackDb));
        assert.strictEqual(await readSchemaVersion(rollbackDb), 5);
        assert.strictEqual(await get(rollbackDb, "SELECT name FROM sqlite_master WHERE type='table' AND name='stores'"), null,
            "store DDL is rolled back when V6 migration fails");
    } finally {
        await close(rollbackDb);
    }

    const legacyDb = new sqlite3.Database(":memory:");
    try {
        await exec(legacyDb, BASE.replace("    CREATE TABLE klbs_schema_metadata (id INTEGER PRIMARY KEY CHECK(id=1), schema_version INTEGER NOT NULL);\n", ""));
        await migrate(legacyDb);
        assert.strictEqual(await readSchemaVersion(legacyDb), 8,
            "metadata-free startup runs the numbered migrations before adopting V8");
        assert.strictEqual((await createStoreIdentityService(legacyDb).getCurrentStore()).storeCode, "KL001");
    } finally {
        await close(legacyDb);
    }

    const html = fs.readFileSync(path.join(__dirname, "../src/renderer/index.html"), "utf8");
    const app = fs.readFileSync(path.join(__dirname, "../src/renderer/app.js"), "utf8");
    const preload = fs.readFileSync(path.join(__dirname, "../src/main/preload.js"), "utf8");
    const accounting = html.slice(html.indexOf('<div id="accountingDataScreen"'), html.indexOf("<!-- =====================================\n     REPORTS SCREEN"));
    const accountingCardIds = [...accounting.matchAll(/<button id="(accounting[^"]+)" class="business-workspace-card"/g)].map(match => match[1]);
    assert.deepStrictEqual(accountingCardIds, ["accountingExpenseTrackerBtn", "accountingManagementPLBtn", "accountingSupplierAccountsBtn"]);
    for (const forbidden of ["STORE MANAGEMENT", "STOCK MANAGEMENT", "MONTHLY GST", "EXPORT DATA", "ACCOUNTING LEDGER"]) {
        assert(!accounting.toUpperCase().includes(forbidden), `Accounting & Data excludes ${forbidden}`);
    }
    assert(accounting.includes("Expenses, profitability and supplier accounts"));
    assert.match(app, /accountingExpenseTrackerBtn[\s\S]*?openExpenseTracker/);
    assert(html.includes('id="expenseTrackerScreen"') && html.includes('modules/expenseTracker.js'));
    assert.match(app, /accountingManagementPLBtn[^\n]*window\.openManagementPnl/);
    assert(html.includes('id="managementPnlScreen"') && html.includes('modules/managementPnl.js'));
    assert.match(app, /showComingSoon\("Supplier \/ Distributor Accounts"\)/);
    const settingsStoreInfo = app.slice(app.indexOf("🏪 Store Information"), app.indexOf("function formatKLBSLastUpdated"));
    assert(settingsStoreInfo.includes("id=\"storeCodeValue\"") && settingsStoreInfo.includes("id=\"storeNameValue\"") && settingsStoreInfo.includes("id=\"storeStatusValue\""));
    assert.match(app, /getCurrentStoreIdentity\(\)[\s\S]*?storeNameValue[\s\S]*?storeCodeValue[\s\S]*?storeStatusValue/);
    assert(!app.includes("accountingStoreManagementBtn") && !app.includes("accountingStoreManagementView"));
    assert(preload.includes('ipcRenderer.invoke("store-identity:get-current")'));

    console.log("PASS V21-03C V5→V8 Store Identity/Expense/Return COGS migrations, seed, constraints, resolution, rollback, legacy adoption, and Accounting/Settings UI contract");
}

main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
