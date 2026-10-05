const assert = require("assert");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const {
    readSchemaVersion,
    runForwardMigrations,
    migrateV5Foundation
} = require("../src/database/schemaVersion");

const WORKSPACE = "/private/tmp/KLBS-V21-01-qualification";
const run = (db, sql) => new Promise((resolve, reject) =>
    db.run(sql, error => error ? reject(error) : resolve()));
const get = (db, sql) => new Promise((resolve, reject) =>
    db.get(sql, (error, row) => error ? reject(error) : resolve(row || null)));
const close = db => new Promise((resolve, reject) =>
    db.close(error => error ? reject(error) : resolve()));

async function main() {
    const dbPath = path.resolve(process.argv[2] || "");
    assert.strictEqual(dbPath, path.join(WORKSPACE, "failure-billing.db"),
        "Failure qualification is restricted to its disposable database copy.");
    const db = new sqlite3.Database(dbPath);
    await run(db, "PRAGMA foreign_keys=ON");
    assert.strictEqual(await readSchemaVersion(db), 4);
    const customerCount = await get(db, "SELECT COUNT(*) AS count FROM customers");
    const stockCount = await get(db, "SELECT COUNT(*) AS count FROM inventory_transactions");
    await assert.rejects(() => runForwardMigrations(db, 4, 5, [{
        from: 4,
        to: 5,
        name: "injected_v5_failure_qualification",
        up: async database => {
            await migrateV5Foundation(database);
            throw new Error("Intentional isolated qualification failure after V5 DDL.");
        }
    }]));
    assert.strictEqual(await readSchemaVersion(db), 4);
    assert.strictEqual(Number((await get(db, "SELECT COUNT(*) AS count FROM customers")).count), Number(customerCount.count));
    assert.strictEqual(Number((await get(db, "SELECT COUNT(*) AS count FROM inventory_transactions")).count), Number(stockCount.count));
    assert.strictEqual(await get(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='stock_movements'"), null);
    const customerSql = await get(db, "SELECT sql FROM sqlite_master WHERE type='table' AND name='customers'");
    assert(/mobile\s+TEXT\s+UNIQUE/i.test(customerSql.sql));
    assert.strictEqual((await get(db, "PRAGMA integrity_check")).integrity_check, "ok");
    assert.deepStrictEqual(await new Promise((resolve, reject) => db.all("PRAGMA foreign_key_check", (e, rows) => e ? reject(e) : resolve(rows))), []);
    await close(db);
    console.log("PASS isolated production-copy V5 injected failure: transaction rolled back, schema/data preserved, database healthy");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
