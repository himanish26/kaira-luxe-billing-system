"use strict";

function run(db, sql) {
    return new Promise((resolve, reject) => db.run(sql, error => error ? reject(error) : resolve()));
}
function all(db, sql) {
    return new Promise((resolve, reject) => db.all(sql, [], (error, rows) => error ? reject(error) : resolve(rows || [])));
}

async function migrateStockInwardProductCaptureV21(db) {
    const additions = [
        ["brand", "TEXT"], ["segment", "TEXT"], ["business_segment", "TEXT"], ["category", "TEXT"],
        ["season", "TEXT"], ["collection", "TEXT"], ["style_code", "TEXT"], ["discount", "REAL"],
        ["selling_price_paise", "INTEGER"], ["gst_rate", "REAL"], ["hsn_code", "TEXT"],
        ["reorder_level", "INTEGER"], ["supplier", "TEXT"], ["active", "INTEGER"], ["variable_value", "INTEGER"]
    ];
    const columns = new Set((await all(db, "PRAGMA table_info(stock_movement_invoice_lines)")).map(column => column.name));
    for (const [name, definition] of additions) {
        if (!columns.has(name)) await run(db, `ALTER TABLE stock_movement_invoice_lines ADD COLUMN ${name} ${definition}`);
    }
    const verified = new Set((await all(db, "PRAGMA table_info(stock_movement_invoice_lines)")).map(column => column.name));
    for (const [name] of additions) if (!verified.has(name)) throw new Error(`Stock Inward Product Capture migration failed: ${name} is missing.`);
}

module.exports = { migrateStockInwardProductCaptureV21 };
