"use strict";

function run(db, sql) {
    return new Promise((resolve, reject) => db.run(sql, error => error ? reject(error) : resolve()));
}

async function migrateSupplierInvoiceFormatProfilesV22(db) {
    const createSql = [
        "CREATE TABLE IF NOT EXISTS supplier_invoice_format_profiles (",
        "id INTEGER PRIMARY KEY AUTOINCREMENT,",
        "supplier_id INTEGER NOT NULL REFERENCES supplier_master(id) ON DELETE CASCADE,",
        "format_signature TEXT NOT NULL CHECK(length(format_signature)=64),",
        "sheet_name TEXT NOT NULL,",
        "header_row INTEGER NOT NULL CHECK(typeof(header_row)='integer' AND header_row>0),",
        "headers_json TEXT NOT NULL,",
        "mapping_json TEXT NOT NULL,",
        "created_at TEXT NOT NULL,",
        "updated_at TEXT NOT NULL,",
        "UNIQUE(supplier_id,format_signature))"
    ].join(" ");
    await run(db, createSql);
    await run(db, "CREATE INDEX IF NOT EXISTS idx_supplier_invoice_format_profiles_supplier ON supplier_invoice_format_profiles(supplier_id,updated_at DESC)");
}

module.exports = { migrateSupplierInvoiceFormatProfilesV22 };
