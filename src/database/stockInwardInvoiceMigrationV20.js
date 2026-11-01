"use strict";

function run(db, sql) {
    return new Promise((resolve, reject) => db.run(sql, error => error ? reject(error) : resolve()));
}

async function migrateStockInwardInvoiceV20(db) {
    await run(db, `CREATE TABLE IF NOT EXISTS stock_movement_invoice_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        movement_id INTEGER NOT NULL REFERENCES stock_movements(id) ON DELETE CASCADE,
        line_number INTEGER NOT NULL CHECK(typeof(line_number)='integer' AND line_number>0),
        barcode TEXT NOT NULL CHECK(length(trim(barcode))>0),
        sku TEXT,
        product_name TEXT,
        size TEXT,
        colour TEXT,
        expected_quantity INTEGER NOT NULL CHECK(typeof(expected_quantity)='integer' AND expected_quantity>0),
        mrp_paise INTEGER NOT NULL CHECK(typeof(mrp_paise)='integer' AND mrp_paise>=0),
        unit_cost_paise INTEGER NOT NULL CHECK(typeof(unit_cost_paise)='integer' AND unit_cost_paise>=0),
        created_at TEXT NOT NULL,
        UNIQUE(movement_id,line_number)
    )`);
    await run(db, "CREATE INDEX IF NOT EXISTS idx_stock_movement_invoice_lines_movement_barcode ON stock_movement_invoice_lines(movement_id,barcode)");
}

module.exports = { migrateStockInwardInvoiceV20 };
