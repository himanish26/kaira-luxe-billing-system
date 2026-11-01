"use strict";

function run(db, sql) {
    return new Promise((resolve, reject) => db.run(sql, error => error ? reject(error) : resolve()));
}

function all(db, sql) {
    return new Promise((resolve, reject) => db.all(sql, (error, rows) => error ? reject(error) : resolve(rows || [])));
}

async function migrateSupplierInvoiceFormatProfilesV24(db) {
    const columns = await all(db, "PRAGMA table_info(supplier_invoice_format_profiles)");
    if (!columns.some(column => column.name === "sort_order")) {
        await run(db, "ALTER TABLE supplier_invoice_format_profiles ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0 CHECK(typeof(sort_order)='integer' AND sort_order>=0)");
    }
    await run(db, "CREATE INDEX IF NOT EXISTS idx_supplier_invoice_format_profiles_order ON supplier_invoice_format_profiles(supplier_id,sort_order,updated_at DESC)");
}

module.exports = { migrateSupplierInvoiceFormatProfilesV24 };
