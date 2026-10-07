"use strict";

function run(database, sql, params = []) {
    return new Promise((resolve, reject) => database.run(sql, params, error => error ? reject(error) : resolve()));
}

async function migrateReturnCogsReversal(database) {
    const columns = await new Promise((resolve, reject) => database.all(
        "PRAGMA table_info(return_items)",
        [],
        (error, rows) => error ? reject(error) : resolve(rows || [])
    ));
    if (!columns.length) {
        throw new Error("V8 Return COGS migration requires the return_items table.");
    }
    const names = new Set(columns.map(column => column.name));
    const additions = [
        ["return_unit_cost_paise", "INTEGER CHECK (return_unit_cost_paise IS NULL OR return_unit_cost_paise >= 0)"],
        ["return_cost_paise", "INTEGER CHECK (return_cost_paise IS NULL OR return_cost_paise >= 0)"],
        ["return_cost_basis_status", "TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (return_cost_basis_status IN ('CAPTURED', 'UNKNOWN', 'NOT_APPLICABLE'))"],
        ["return_cost_source", "TEXT"],
        ["return_cost_method", "TEXT"]
    ];
    for (const [name, definition] of additions) {
        if (!names.has(name)) {
            await run(database, `ALTER TABLE return_items ADD COLUMN ${name} ${definition}`);
        }
    }

    await run(database, `
        CREATE INDEX IF NOT EXISTS idx_returns_cogs_date_status
        ON returns (business_date, accounting_status, accounting_snapshot_version)
    `);
    await run(database, `
        CREATE TRIGGER IF NOT EXISTS trg_return_items_cost_basis_insert_valid
        BEFORE INSERT ON return_items
        FOR EACH ROW
        WHEN EXISTS (
            SELECT 1 FROM returns
            WHERE id = NEW.return_id AND accounting_status = 'COMPLETED'
        )
        BEGIN
            SELECT CASE WHEN NOT EXISTS (
                SELECT 1
                FROM returns r
                JOIN bill_items bi
                  ON bi.id = NEW.original_bill_item_id
                 AND bi.bill_no = r.original_bill_no
                WHERE r.id = NEW.return_id
                  AND (
                    (bi.cost_basis_status = 'CAPTURED'
                     AND NEW.return_cost_basis_status = 'CAPTURED'
                     AND NEW.return_unit_cost_paise IS bi.unit_cost_paise
                     AND NEW.return_cost_paise = NEW.return_unit_cost_paise * NEW.quantity
                     AND typeof(NEW.return_cost_paise) = 'integer'
                     AND NEW.return_cost_source IS bi.cost_source
                     AND NEW.return_cost_method = 'ORIGINAL_SALE_TIME_COST_REVERSAL')
                    OR
                    (bi.cost_basis_status = 'UNKNOWN'
                     AND NEW.return_cost_basis_status = 'UNKNOWN'
                     AND NEW.return_unit_cost_paise IS NULL
                     AND NEW.return_cost_paise IS NULL
                     AND NEW.return_cost_source IS NULL
                     AND NEW.return_cost_method IS NULL)
                    OR
                    (bi.cost_basis_status = 'NOT_APPLICABLE'
                     AND NEW.return_cost_basis_status = 'NOT_APPLICABLE'
                     AND NEW.return_unit_cost_paise IS NULL
                     AND NEW.return_cost_paise IS NULL
                     AND NEW.return_cost_source IS NULL
                     AND NEW.return_cost_method IS NULL)
                  )
            ) THEN RAISE(ABORT, 'KLBS_RETURN_COST_BASIS_INVALID') END;
        END
    `);
}

module.exports = { migrateReturnCogsReversal };
