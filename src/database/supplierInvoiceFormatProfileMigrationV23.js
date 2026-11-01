"use strict";

function run(db, sql) {
    return new Promise((resolve, reject) => db.run(sql, error => error ? reject(error) : resolve()));
}

function all(db, sql) {
    return new Promise((resolve, reject) => db.all(sql, (error, rows) => error ? reject(error) : resolve(rows || [])));
}

async function migrateSupplierInvoiceFormatProfilesV23(db) {
    const columns = await all(db, "PRAGMA table_info(supplier_invoice_format_profiles)");
    if (!columns.some(column => column.name === "is_default")) {
        await run(db, "ALTER TABLE supplier_invoice_format_profiles ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0,1))");
    }
    await run(db, "CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_invoice_format_profiles_one_default ON supplier_invoice_format_profiles(supplier_id) WHERE is_default=1");
}

module.exports = { migrateSupplierInvoiceFormatProfilesV23 };
