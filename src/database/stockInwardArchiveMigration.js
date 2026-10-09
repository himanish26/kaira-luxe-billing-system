"use strict";

function run(db, sql) { return new Promise((resolve, reject) => db.run(sql, error => error ? reject(error) : resolve())); }
function all(db, sql) { return new Promise((resolve, reject) => db.all(sql, (error, rows) => error ? reject(error) : resolve(rows || []))); }

async function migrateStockInwardArchiveV15(db) {
    const columns = new Set((await all(db, "PRAGMA table_info(stock_movements)")).map(row => row.name));
    if (!columns.has("archived_at")) await run(db, "ALTER TABLE stock_movements ADD COLUMN archived_at TEXT");
    if (!columns.has("archived_by")) await run(db, "ALTER TABLE stock_movements ADD COLUMN archived_by TEXT");
    await run(db, "CREATE INDEX IF NOT EXISTS idx_stock_movements_inward_archive ON stock_movements(direction,status,archived_at,updated_at)");
    await run(db, `CREATE TRIGGER IF NOT EXISTS trg_stock_movement_archive_guard
      BEFORE UPDATE OF archived_at,archived_by ON stock_movements
      FOR EACH ROW WHEN (NEW.archived_at IS NOT NULL AND (NEW.direction<>'INWARD' OR NEW.status<>'CANCELLED' OR NEW.archived_by IS NULL OR TRIM(NEW.archived_by)=''))
        OR (OLD.archived_at IS NOT NULL AND (NEW.archived_at IS NOT OLD.archived_at OR NEW.archived_by IS NOT OLD.archived_by))
      BEGIN SELECT RAISE(ABORT,'KLBS_STOCK_INWARD_ARCHIVE_INVALID'); END`);
}

module.exports = { migrateStockInwardArchiveV15 };
