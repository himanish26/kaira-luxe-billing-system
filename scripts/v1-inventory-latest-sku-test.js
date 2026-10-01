"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");
const sqlite3 = require("sqlite3").verbose();

const db = new sqlite3.Database(":memory:");
const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function (error) { error ? reject(error) : resolve({ lastID: this.lastID }); }));
const close = () => new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));

async function main() {
    const databaseModulePath = require.resolve("../src/database/database");
    const productServicePath = require.resolve("../src/database/productService");
    const previousDatabaseModule = require.cache[databaseModulePath];
    const previousProductService = require.cache[productServicePath];
    const databaseStub = new Module(databaseModulePath, module);
    databaseStub.filename = databaseModulePath;
    databaseStub.loaded = true;
    databaseStub.exports = db;
    require.cache[databaseModulePath] = databaseStub;
    delete require.cache[productServicePath];

    try {
        await run(`CREATE TABLE products (
            id INTEGER PRIMARY KEY, sku TEXT, brand TEXT, segment TEXT,
            category TEXT, season TEXT, collection TEXT)`);
        await run(`CREATE TABLE inventory_transactions (product_id INTEGER, quantity INTEGER)`);
        const { getInventorySummary } = require("../src/database/productService");
        const summary = async () => new Promise((resolve, reject) => {
            getInventorySummary().then(resolve, reject);
        });

        // Simulate batch/import order differing from numeric SKU order, with gaps.
        await run(`INSERT INTO products (id,sku) VALUES
            (1,'KL001704'),(2,'KL001699'),(3,'KL001702'),(4,'KL00170A'),
            (5,'KL001999X'),(6,'OTHER001999'),(7,'kl009999'),(8,'KL001700')`);
        let result = await summary();
        assert.strictEqual(result.latest_sku, "KL001704", "numeric maximum wins over last inserted lower SKU and gaps");
        const next = `KL${String(Number(result.latest_sku.slice(2)) + 1).padStart(result.latest_sku.length - 2, "0")}`;
        assert.strictEqual(next, "KL001705", "next sequential value follows persisted maximum");

        // Preserve the exact stored leading-zero format for other maxima too.
        await run("DELETE FROM products");
        await run("INSERT INTO products (id,sku) VALUES (1,'KL000042'),(2,'KL000040'),(3,'SKU-OTHER')");
        result = await summary();
        assert.strictEqual(result.latest_sku, "KL000042", "existing KL zero-padding is returned unchanged");

        const renderer = fs.readFileSync(path.join(__dirname, "../src/renderer/modules/inventory.js"), "utf8");
        assert(renderer.includes("summary.latest_sku || \"-\""), "Inventory continues displaying the authoritative summary value");
        console.log("PASS: highest persisted numeric KL SKU, out-of-order/gapped imports, next SKU arithmetic, and existing formatting");
    } finally {
        if (previousProductService) require.cache[productServicePath] = previousProductService;
        else delete require.cache[productServicePath];
        if (previousDatabaseModule) require.cache[databaseModulePath] = previousDatabaseModule;
        else delete require.cache[databaseModulePath];
        await close();
    }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
