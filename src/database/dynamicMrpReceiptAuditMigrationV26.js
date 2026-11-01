"use strict";

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => db.run(sql, params, error => error ? reject(error) : resolve()));
}

function all(db, sql) {
    return new Promise((resolve, reject) => db.all(sql, [], (error, rows) => error ? reject(error) : resolve(rows || [])));
}

async function addColumn(db, table, name, definition) {
    const columns = await all(db, `PRAGMA table_info(${table})`);
    if (!columns.some(column => column.name === name)) await run(db, `ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}

async function migrateDynamicMrpReceiptAuditV26(db) {
    await addColumn(db, "stock_movement_mrp_allocations", "reference_mrp_paise", "INTEGER CHECK(reference_mrp_paise IS NULL OR (typeof(reference_mrp_paise)='integer' AND reference_mrp_paise>=0))");
    await addColumn(db, "stock_movement_mrp_allocations", "mrp_change_status", "TEXT CHECK(mrp_change_status IS NULL OR mrp_change_status IN ('SAME','CHANGED'))");
}

module.exports = { migrateDynamicMrpReceiptAuditV26 };
