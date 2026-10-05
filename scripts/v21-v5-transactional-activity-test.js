const assert = require("assert");
const sqlite3 = require("sqlite3").verbose();

const run = (db, sql, params = []) => new Promise((resolve, reject) =>
    db.run(sql, params, function(error) { error ? reject(error) : resolve(this); }));
const get = (db, sql, params = []) => new Promise((resolve, reject) =>
    db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
const close = db => new Promise((resolve, reject) =>
    db.close(error => error ? reject(error) : resolve()));

async function main() {
    const db = new sqlite3.Database(":memory:");
    const databaseModulePath = require.resolve("../src/database/database");
    require.cache[databaseModulePath] = {
        id: databaseModulePath,
        filename: databaseModulePath,
        loaded: true,
        exports: db
    };
    const activityService = require("../src/database/activityService");
    const { appendActivityInTransaction } = activityService;
    await run(db, `CREATE TABLE activities (
        id INTEGER PRIMARY KEY AUTOINCREMENT, activity_date TEXT, activity_time TEXT,
        category TEXT, action TEXT, details TEXT, user_name TEXT, status TEXT,
        entity_type TEXT, reference_no TEXT, change_data TEXT, created_at TEXT
    )`);
    await run(db, "BEGIN IMMEDIATE TRANSACTION");
    const rolledBack = await appendActivityInTransaction(db, {
        category: "EXPENSE", action: "EXPENSE_CREATED", details: "Test event",
        actor: "MANAGER", status: "SUCCESS", entity_type: "EXPENSE", reference_no: "E-1"
    }, "2026-10-05T12:00:00.000Z");
    assert.strictEqual(rolledBack.success, true);
    await run(db, "ROLLBACK");
    assert.strictEqual((await get(db, "SELECT COUNT(*) AS count FROM activities")).count, 0);

    await run(db, "BEGIN IMMEDIATE TRANSACTION");
    const committed = await appendActivityInTransaction(db, {
        category: "INVENTORY", action: "STOCK_MOVEMENT_POSTED", details: "Document posted",
        actor: "MANAGER", status: "SUCCESS", entity_type: "STOCK_MOVEMENT", reference_no: "SM-2"
    }, "2026-10-05T12:00:00.000Z");
    await run(db, "COMMIT");
    const row = await get(db, "SELECT category, action, user_name, reference_no FROM activities WHERE id=?", [committed.id]);
    assert.deepStrictEqual(row, {
        category: "INVENTORY", action: "STOCK_MOVEMENT_POSTED",
        user_name: "MANAGER", reference_no: "SM-2"
    });
    await run(db, `INSERT INTO activities
        (activity_date, activity_time, category, action, details, user_name, status, created_at)
        VALUES ('05 Oct 2026', '05:30:00 PM', 'BILLING', 'INVOICE_GENERATED', 'Invoice event', 'OPERATOR', 'SUCCESS', '2026-10-05T17:30:00+05:30')`);
    assert.strictEqual((await activityService.getActivityPage({ page: 1, pageSize: 100, keyword: "inventory" })).totalCount, 1);
    assert.strictEqual((await activityService.getActivityPage({ page: 1, pageSize: 100, keyword: "invoice" })).totalCount, 0);
    assert.strictEqual((await activityService.getActivityPage({ page: 1, pageSize: 100, keyword: "billing" })).totalCount, 1);
    await close(db);
    console.log("PASS transactional business activity append commits and rolls back with caller transaction");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
