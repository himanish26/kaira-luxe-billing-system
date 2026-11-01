"use strict";

function run(db, sql, params = []) { return new Promise((resolve, reject) => db.run(sql, params, error => error ? reject(error) : resolve())); }
function all(db, sql, params = []) { return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || []))); }
function get(db, sql, params = []) { return new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null))); }

async function migrateStockInwardIncrementalPostingV25(db) {
    const existing = await get(db, "SELECT sql FROM sqlite_master WHERE type='table' AND name='stock_movement_lines'");
    if (!existing) throw new Error("V25 requires the Stock Inward movement line table.");
    if (!String(existing.sql || "").includes("'PARTIALLY_POSTED'")) {
        const lines = await all(db, "SELECT * FROM stock_movement_lines ORDER BY id");
        await run(db, "DROP TRIGGER IF EXISTS trg_stock_mrp_allocation_valid_insert");
        await run(db, "DROP TRIGGER IF EXISTS trg_stock_mrp_allocation_valid_update");
        await run(db, "DROP TRIGGER IF EXISTS trg_stock_mrp_allocation_post_guard");
        await run(db, "DROP TRIGGER IF EXISTS trg_stock_receipt_layer_source_guard");
        await run(db, "DROP TRIGGER IF EXISTS trg_stock_movement_delete_prohibited");
        for (const name of ["trg_stock_movement_line_direction_insert","trg_stock_movement_line_direction_update","trg_stock_movement_line_posted_immutable","trg_stock_movement_line_posted_delete","trg_stock_movement_line_integer_insert","trg_stock_movement_line_integer_update","trg_stock_movement_line_discard_guard"]) {
            await run(db, "DROP TRIGGER IF EXISTS " + name);
        }
        await run(db, `CREATE TABLE stock_movement_lines_v25 (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            movement_id INTEGER NOT NULL,
            barcode TEXT NOT NULL,
            scanned_quantity INTEGER NOT NULL CHECK(typeof(scanned_quantity)='integer' AND scanned_quantity>0),
            recognized_quantity INTEGER NOT NULL DEFAULT 0 CHECK(typeof(recognized_quantity)='integer' AND recognized_quantity>=0 AND recognized_quantity<=scanned_quantity),
            product_id INTEGER,
            product_state TEXT NOT NULL DEFAULT 'PENDING_MASTER' CHECK(product_state IN ('READY','PENDING_MASTER')),
            posting_state TEXT NOT NULL DEFAULT 'UNPOSTED' CHECK(posting_state IN ('UNPOSTED','PARTIALLY_POSTED','POSTED')),
            posted_quantity INTEGER NOT NULL DEFAULT 0 CHECK(typeof(posted_quantity)='integer' AND posted_quantity>=0 AND posted_quantity<=recognized_quantity),
            inventory_transaction_id INTEGER,
            sku_snapshot TEXT,
            product_name_snapshot TEXT,
            colour_snapshot TEXT,
            size_snapshot TEXT,
            resolution_note TEXT,
            discard_reason TEXT,
            discarded_by TEXT,
            discarded_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(movement_id,barcode),
            CHECK((product_state='PENDING_MASTER' AND product_id IS NULL AND recognized_quantity=0) OR (product_state='READY' AND product_id IS NOT NULL AND recognized_quantity>0)),
            CHECK((posting_state='UNPOSTED' AND posted_quantity=0) OR
                  (posting_state='PARTIALLY_POSTED' AND posted_quantity>0 AND posted_quantity<recognized_quantity) OR
                  (posting_state='POSTED' AND posted_quantity=recognized_quantity)),
            CHECK((discarded_at IS NULL AND discarded_by IS NULL AND discard_reason IS NULL) OR
                  (discarded_at IS NOT NULL AND discarded_by IS NOT NULL AND length(trim(discard_reason))>0 AND product_state='PENDING_MASTER' AND posting_state='UNPOSTED')),
            FOREIGN KEY(movement_id) REFERENCES stock_movements(id),
            FOREIGN KEY(product_id) REFERENCES products(id),
            FOREIGN KEY(inventory_transaction_id) REFERENCES inventory_transactions(id)
        )`);
        await run(db, `INSERT INTO stock_movement_lines_v25 (
            id,movement_id,barcode,scanned_quantity,recognized_quantity,product_id,product_state,posting_state,posted_quantity,
            inventory_transaction_id,sku_snapshot,product_name_snapshot,colour_snapshot,size_snapshot,resolution_note,
            discard_reason,discarded_by,discarded_at,created_at,updated_at)
            SELECT id,movement_id,barcode,scanned_quantity,recognized_quantity,product_id,product_state,posting_state,posted_quantity,
            inventory_transaction_id,sku_snapshot,product_name_snapshot,colour_snapshot,size_snapshot,resolution_note,
            discard_reason,discarded_by,discarded_at,created_at,updated_at FROM stock_movement_lines`);
        await run(db, "DROP TABLE stock_movement_lines");
        await run(db, "ALTER TABLE stock_movement_lines_v25 RENAME TO stock_movement_lines");
        for (const sql of [
            "CREATE INDEX IF NOT EXISTS idx_stock_movement_lines_barcode_state ON stock_movement_lines(barcode,product_state,posting_state)",
            "CREATE INDEX IF NOT EXISTS idx_stock_movement_lines_product ON stock_movement_lines(product_id)",
            "CREATE INDEX IF NOT EXISTS idx_stock_movement_lines_movement_state ON stock_movement_lines(movement_id,posting_state,product_state)"
        ]) await run(db, sql);
        await run(db, `CREATE TRIGGER trg_stock_movement_line_direction_insert BEFORE INSERT ON stock_movement_lines
          FOR EACH ROW WHEN (SELECT direction FROM stock_movements WHERE id=NEW.movement_id)<>'INWARD' AND NEW.product_state='PENDING_MASTER'
          BEGIN SELECT RAISE(ABORT,'KLBS_STOCK_MOVEMENT_LINE_DIRECTION_INVALID'); END`);
        await run(db, `CREATE TRIGGER trg_stock_movement_line_direction_update BEFORE UPDATE OF movement_id,product_state,product_id ON stock_movement_lines
          FOR EACH ROW WHEN (SELECT direction FROM stock_movements WHERE id=NEW.movement_id)<>'INWARD' AND NEW.product_state='PENDING_MASTER'
          BEGIN SELECT RAISE(ABORT,'KLBS_STOCK_MOVEMENT_LINE_DIRECTION_INVALID'); END`);
        await run(db, `CREATE TRIGGER trg_stock_movement_line_posted_immutable BEFORE UPDATE ON stock_movement_lines
          FOR EACH ROW WHEN OLD.posted_quantity>0 AND NOT (
            NEW.movement_id=OLD.movement_id AND NEW.barcode=OLD.barcode AND NEW.product_id IS OLD.product_id AND NEW.product_state=OLD.product_state AND
            NEW.sku_snapshot IS OLD.sku_snapshot AND NEW.product_name_snapshot IS OLD.product_name_snapshot AND
            NEW.colour_snapshot IS OLD.colour_snapshot AND NEW.size_snapshot IS OLD.size_snapshot AND
            NEW.discard_reason IS OLD.discard_reason AND NEW.discarded_by IS OLD.discarded_by AND NEW.discarded_at IS OLD.discarded_at AND
            ((NEW.posted_quantity=OLD.posted_quantity AND NEW.scanned_quantity>OLD.scanned_quantity AND
              NEW.recognized_quantity=NEW.scanned_quantity AND NEW.recognized_quantity>OLD.recognized_quantity AND
              NEW.posting_state='PARTIALLY_POSTED' AND NEW.inventory_transaction_id IS NULL) OR
             (NEW.scanned_quantity=OLD.scanned_quantity AND NEW.recognized_quantity=OLD.recognized_quantity AND
              NEW.posted_quantity>=OLD.posted_quantity AND NEW.posted_quantity<=NEW.recognized_quantity AND
              NEW.posting_state=CASE WHEN NEW.posted_quantity=NEW.recognized_quantity THEN 'POSTED' ELSE 'PARTIALLY_POSTED' END))
          )
          BEGIN SELECT RAISE(ABORT,'KLBS_POSTED_STOCK_MOVEMENT_LINE_IMMUTABLE'); END`);
        await run(db, `CREATE TRIGGER trg_stock_movement_line_posted_delete BEFORE DELETE ON stock_movement_lines
          FOR EACH ROW WHEN OLD.posted_quantity>0
          BEGIN SELECT RAISE(ABORT,'KLBS_POSTED_STOCK_MOVEMENT_LINE_DELETE_PROHIBITED'); END`);
        await run(db, `CREATE TRIGGER trg_stock_movement_line_integer_insert BEFORE INSERT ON stock_movement_lines
          FOR EACH ROW WHEN typeof(NEW.scanned_quantity)<>'integer' OR typeof(NEW.recognized_quantity)<>'integer' OR typeof(NEW.posted_quantity)<>'integer'
          BEGIN SELECT RAISE(ABORT,'KLBS_STOCK_MOVEMENT_QUANTITY_INTEGER_REQUIRED'); END`);
        await run(db, `CREATE TRIGGER trg_stock_movement_line_integer_update BEFORE UPDATE OF scanned_quantity,recognized_quantity,posted_quantity ON stock_movement_lines
          FOR EACH ROW WHEN typeof(NEW.scanned_quantity)<>'integer' OR typeof(NEW.recognized_quantity)<>'integer' OR typeof(NEW.posted_quantity)<>'integer'
          BEGIN SELECT RAISE(ABORT,'KLBS_STOCK_MOVEMENT_QUANTITY_INTEGER_REQUIRED'); END`);
        await run(db, `CREATE TRIGGER trg_stock_movement_line_discard_guard BEFORE UPDATE OF discarded_at ON stock_movement_lines
          FOR EACH ROW WHEN NEW.discarded_at IS NOT NULL AND (OLD.product_state<>'PENDING_MASTER' OR OLD.posting_state<>'UNPOSTED' OR (SELECT direction FROM stock_movements WHERE id=OLD.movement_id)<>'INWARD')
          BEGIN SELECT RAISE(ABORT,'KLBS_STOCK_MOVEMENT_LINE_DISCARD_INVALID'); END`);
        if (lines.length !== Number((await get(db, "SELECT COUNT(*) AS n FROM stock_movement_lines"))?.n)) throw new Error("V25 did not preserve every Stock Inward line.");
    }
    await run(db, "DROP TRIGGER IF EXISTS trg_stock_mrp_allocation_valid_insert");
    await run(db, "DROP TRIGGER IF EXISTS trg_stock_mrp_allocation_valid_update");
    await run(db, `CREATE TRIGGER trg_stock_mrp_allocation_valid_insert BEFORE INSERT ON stock_movement_mrp_allocations
        WHEN NOT EXISTS(SELECT 1 FROM stock_movement_lines l JOIN stock_movements m ON m.id=l.movement_id
            JOIN product_mrp_buckets b ON b.id=NEW.bucket_id AND b.product_id=l.product_id
            WHERE l.id=NEW.movement_line_id AND m.direction IN ('INWARD','OUTWARD') AND l.posting_state IN ('UNPOSTED','PARTIALLY_POSTED')
              AND NEW.quantity <= l.recognized_quantity-l.posted_quantity-
                COALESCE((SELECT SUM(a.quantity) FROM stock_movement_mrp_allocations a WHERE a.movement_line_id=l.id AND a.posting_state='UNPOSTED'),0))
        BEGIN SELECT RAISE(ABORT,'KLBS_STOCK_MRP_ALLOCATION_INVALID'); END`);
    await run(db, `CREATE TRIGGER trg_stock_mrp_allocation_valid_update BEFORE UPDATE ON stock_movement_mrp_allocations
        WHEN OLD.posting_state='UNPOSTED' AND NEW.posting_state='UNPOSTED' AND NOT EXISTS(
          SELECT 1 FROM stock_movement_lines l JOIN stock_movements m ON m.id=l.movement_id
            JOIN product_mrp_buckets b ON b.id=NEW.bucket_id AND b.product_id=l.product_id
            WHERE l.id=NEW.movement_line_id AND m.direction IN ('INWARD','OUTWARD') AND l.posting_state IN ('UNPOSTED','PARTIALLY_POSTED')
              AND NEW.quantity <= l.recognized_quantity-l.posted_quantity-
                COALESCE((SELECT SUM(a.quantity) FROM stock_movement_mrp_allocations a WHERE a.movement_line_id=l.id AND a.posting_state='UNPOSTED' AND a.id<>OLD.id),0))
        BEGIN SELECT RAISE(ABORT,'KLBS_STOCK_MRP_ALLOCATION_INVALID'); END`);
    await run(db, `CREATE TRIGGER IF NOT EXISTS trg_stock_mrp_allocation_post_guard
        BEFORE UPDATE OF posting_state,posted_quantity,inventory_transaction_id ON stock_movement_mrp_allocations
        WHEN NEW.posting_state='POSTED' AND NOT EXISTS(
          SELECT 1 FROM inventory_transactions t JOIN stock_movement_lines l ON l.id=NEW.movement_line_id
          JOIN product_mrp_buckets b ON b.id=NEW.bucket_id AND b.product_id=l.product_id
          WHERE t.id=NEW.inventory_transaction_id AND t.product_id=l.product_id AND t.mrp_bucket_id=NEW.bucket_id
            AND t.quantity=CASE WHEN (SELECT direction FROM stock_movements WHERE id=l.movement_id)='INWARD' THEN NEW.quantity ELSE -NEW.quantity END
            AND NEW.posted_quantity=NEW.quantity)
        BEGIN SELECT RAISE(ABORT,'KLBS_STOCK_MRP_ALLOCATION_POST_INVALID'); END`);
    await run(db, `CREATE TRIGGER IF NOT EXISTS trg_stock_receipt_layer_source_guard
        BEFORE INSERT ON stock_receipt_layers WHEN NEW.source_movement_allocation_id IS NOT NULL AND NOT EXISTS(
          SELECT 1 FROM stock_movement_mrp_allocations a JOIN stock_movement_lines l ON l.id=a.movement_line_id
          JOIN stock_movements m ON m.id=l.movement_id WHERE a.id=NEW.source_movement_allocation_id
            AND a.bucket_id=NEW.bucket_id AND a.posting_state='POSTED' AND a.posted_quantity=NEW.quantity_received
            AND a.unit_cost_paise IS NEW.unit_cost_paise AND a.cost_basis_status=NEW.cost_basis_status
            AND l.id=NEW.source_movement_line_id AND m.direction='INWARD')
        BEGIN SELECT RAISE(ABORT,'KLBS_STOCK_RECEIPT_LAYER_SOURCE_INVALID'); END`);
    await run(db, `CREATE TRIGGER IF NOT EXISTS trg_stock_movement_delete_prohibited BEFORE DELETE ON stock_movements
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
    const violations = await all(db, "PRAGMA foreign_key_check");
    if (violations.length) throw new Error("V25 Stock Inward migration found foreign key violations.");
}
module.exports = { migrateStockInwardIncrementalPostingV25 };

