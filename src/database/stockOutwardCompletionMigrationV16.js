"use strict";

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => db.run(sql, params, error => error ? reject(error) : resolve()));
}

function get(db, sql, params = []) {
    return new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
}

async function migrateStockOutwardCompletionV16(db) {
    const row = await get(db, "SELECT seq FROM sqlite_sequence WHERE name='stock_movements'");
    const maxId = await get(db, "SELECT COALESCE(MAX(id),0) AS value FROM stock_movements");
    const maxOutward = await get(db, `SELECT COALESCE(MAX(CAST(substr(movement_no,6) AS INTEGER)),0) AS value
        FROM stock_movements WHERE direction='OUTWARD' AND movement_no GLOB 'KLOUT[0-9][0-9][0-9][0-9][0-9][0-9]'`);
    const highWater = Math.max(Number(row?.seq || 0), Number(maxId?.value || 0), Number(maxOutward?.value || 0));
    const exists = await get(db, "SELECT 1 AS present FROM sqlite_sequence WHERE name='stock_movements'");
    if (exists) await run(db, "UPDATE sqlite_sequence SET seq=? WHERE name='stock_movements'", [highWater]);
    else await run(db, "INSERT INTO sqlite_sequence(name,seq) VALUES('stock_movements',?)", [highWater]);

    await run(db, "DROP TRIGGER IF EXISTS trg_stock_movement_delete_prohibited");
    await run(db, `CREATE TRIGGER trg_stock_movement_delete_prohibited BEFORE DELETE ON stock_movements
      FOR EACH ROW WHEN NOT (
        OLD.direction='OUTWARD' AND OLD.status IN ('DRAFT','CANCELLED') AND OLD.posted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM stock_movement_lines l LEFT JOIN inventory_transactions t
            ON t.id=l.inventory_transaction_id
          WHERE l.movement_id=OLD.id AND (l.posting_state='POSTED' OR t.id IS NOT NULL)
        )
        AND NOT EXISTS (
          SELECT 1 FROM inventory_transactions t
          WHERE t.reference_type='STOCK_OUTWARD' AND t.reference_id=OLD.movement_no
        )
        AND EXISTS (
          SELECT 1 FROM activities a
          WHERE a.action='STOCK_OUTWARD_DOCUMENT_DELETED'
            AND a.entity_type='STOCK_OUTWARD' AND a.reference_no=OLD.movement_no
            AND a.status='SUCCESS' AND instr(COALESCE(a.details,''),'document_id='||OLD.id)>0
            AND instr(COALESCE(a.details,''),'no_ledger_entries=true')>0
        )
      )
      BEGIN SELECT RAISE(ABORT,'KLBS_STOCK_MOVEMENT_DELETE_PROHIBITED'); END`);

    const trigger = await get(db, "SELECT sql FROM sqlite_master WHERE type='trigger' AND name='trg_stock_movement_delete_prohibited'");
    if (!trigger || !String(trigger.sql).includes("STOCK_OUTWARD_DOCUMENT_DELETED")) {
        throw new Error("V16 Stock Outward deletion guard verification failed.");
    }
}

module.exports = { migrateStockOutwardCompletionV16 };
