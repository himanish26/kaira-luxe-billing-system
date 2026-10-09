"use strict";

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => db.run(sql, params, function (error) {
        if (error) reject(error); else resolve({ lastID: this.lastID, changes: this.changes });
    }));
}
function get(db, sql, params = []) {
    return new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
}
function all(db, sql, params = []) {
    return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
}

async function migrateStockInwardV14(db) {
    const movementSql = await get(db, "SELECT sql FROM sqlite_master WHERE type='table' AND name='stock_movements'");
    const lineSql = await get(db, "SELECT sql FROM sqlite_master WHERE type='table' AND name='stock_movement_lines'");
    if (!movementSql || !lineSql) throw new Error("V14 requires the V5 stock movement foundation.");
    const movements = await all(db, "SELECT * FROM stock_movements ORDER BY id");
    const lines = await all(db, "SELECT * FROM stock_movement_lines ORDER BY id");

    for (const name of ["trg_stock_movement_line_direction_insert", "trg_stock_movement_line_direction_update",
        "trg_stock_movement_line_posted_immutable", "trg_stock_movement_line_discard_guard",
        "trg_stock_movement_line_integer_insert", "trg_stock_movement_line_integer_update",
        "trg_stock_movement_line_posted_delete", "trg_stock_movement_posted_immutable",
        "trg_stock_movement_context_immutable", "trg_stock_movement_delete_prohibited"]) await run(db, `DROP TRIGGER IF EXISTS ${name}`);
    for (const name of ["idx_stock_movements_date_status", "idx_stock_movements_invoice",
        "idx_stock_movement_lines_barcode_state", "idx_stock_movement_lines_product",
        "idx_stock_movement_lines_movement_state"]) await run(db, `DROP INDEX IF EXISTS ${name}`);

    await run(db, `CREATE TABLE stock_movements_v14 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        movement_no TEXT NOT NULL UNIQUE,
        direction TEXT NOT NULL CHECK(direction IN ('INWARD','OUTWARD')),
        status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PARTIALLY_POSTED','PENDING_MASTER','COMPLETE','CANCELLED')),
        supplier_id INTEGER REFERENCES supplier_master(id),
        supplier_name TEXT,
        supplier_code_snapshot TEXT,
        supplier_invoice_id INTEGER REFERENCES supplier_invoices(id),
        supplier_invoice_code_snapshot TEXT,
        invoice_no TEXT,
        invoice_number_snapshot TEXT,
        reference_text TEXT,
        invoice_date TEXT,
        invoice_total_quantity INTEGER CHECK(invoice_total_quantity IS NULL OR (typeof(invoice_total_quantity)='integer' AND invoice_total_quantity>0)),
        store_id INTEGER REFERENCES stores(id),
        store_code_snapshot TEXT,
        store_name_snapshot TEXT,
        business_date TEXT NOT NULL,
        reason TEXT,
        remarks TEXT,
        idempotency_key TEXT NOT NULL UNIQUE,
        posted_by TEXT,
        posted_at TEXT,
        cancelled_by TEXT,
        cancelled_at TEXT,
        cancel_reason TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )`);
    await run(db, `INSERT INTO stock_movements_v14 (
        id,movement_no,direction,status,supplier_id,supplier_name,invoice_no,reference_text,
        business_date,reason,remarks,idempotency_key,posted_by,posted_at,cancelled_by,cancelled_at,
        cancel_reason,created_by,created_at,updated_at
    ) SELECT id,movement_no,direction,status,supplier_id,supplier_name,invoice_no,reference_text,
        business_date,reason,remarks,idempotency_key,posted_by,posted_at,cancelled_by,cancelled_at,
        cancel_reason,created_by,created_at,updated_at FROM stock_movements`);
    await run(db, "DROP TABLE stock_movements");
    await run(db, "ALTER TABLE stock_movements_v14 RENAME TO stock_movements");

    await run(db, `CREATE TABLE stock_movement_lines_v14 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        movement_id INTEGER NOT NULL,
        barcode TEXT NOT NULL,
        scanned_quantity INTEGER NOT NULL CHECK(scanned_quantity>0),
        recognized_quantity INTEGER NOT NULL DEFAULT 0 CHECK(recognized_quantity>=0 AND recognized_quantity<=scanned_quantity),
        product_id INTEGER,
        product_state TEXT NOT NULL DEFAULT 'PENDING_MASTER' CHECK(product_state IN ('READY','PENDING_MASTER')),
        posting_state TEXT NOT NULL DEFAULT 'UNPOSTED' CHECK(posting_state IN ('UNPOSTED','POSTED')),
        posted_quantity INTEGER NOT NULL DEFAULT 0 CHECK(posted_quantity>=0 AND posted_quantity<=recognized_quantity),
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
        UNIQUE(movement_id, barcode),
        CHECK((product_state='PENDING_MASTER' AND product_id IS NULL AND recognized_quantity=0) OR (product_state='READY' AND product_id IS NOT NULL AND recognized_quantity>0)),
        CHECK((posting_state='UNPOSTED' AND posted_quantity=0) OR (posting_state='POSTED' AND posted_quantity=recognized_quantity)),
        CHECK((discarded_at IS NULL AND discarded_by IS NULL AND discard_reason IS NULL) OR
              (discarded_at IS NOT NULL AND discarded_by IS NOT NULL AND length(trim(discard_reason))>0 AND product_state='PENDING_MASTER' AND posting_state='UNPOSTED')),
        FOREIGN KEY(movement_id) REFERENCES stock_movements(id),
        FOREIGN KEY(product_id) REFERENCES products(id),
        FOREIGN KEY(inventory_transaction_id) REFERENCES inventory_transactions(id)
    )`);
    await run(db, `INSERT INTO stock_movement_lines_v14 (
        id,movement_id,barcode,scanned_quantity,recognized_quantity,product_id,product_state,
        posting_state,posted_quantity,inventory_transaction_id,created_at,updated_at
    ) SELECT id,movement_id,barcode,scanned_quantity,recognized_quantity,product_id,product_state,
        posting_state,posted_quantity,inventory_transaction_id,created_at,updated_at FROM stock_movement_lines`);
    await run(db, "DROP TABLE stock_movement_lines");
    await run(db, "ALTER TABLE stock_movement_lines_v14 RENAME TO stock_movement_lines");

    await run(db, `CREATE TABLE IF NOT EXISTS stock_movement_sequences (
        id INTEGER PRIMARY KEY CHECK(id=1), next_movement_number INTEGER NOT NULL CHECK(typeof(next_movement_number)='integer' AND next_movement_number>0)
    )`);
    const maxLegacy = await get(db, `SELECT MAX(CAST(substr(movement_no,6) AS INTEGER)) AS n
        FROM stock_movements WHERE movement_no GLOB 'KLINW[0-9][0-9][0-9][0-9][0-9][0-9]'`);
    await run(db, `INSERT OR IGNORE INTO stock_movement_sequences(id,next_movement_number) VALUES(1,?)`, [Math.max(1, Number(maxLegacy?.n || 0) + 1)]);

    await run(db, "CREATE INDEX idx_stock_movements_date_status ON stock_movements(business_date,status)");
    await run(db, "CREATE INDEX idx_stock_movements_invoice ON stock_movements(supplier_id,invoice_no)");
    await run(db, "CREATE INDEX idx_stock_movements_store_date ON stock_movements(store_id,business_date,status)");
    await run(db, "CREATE INDEX idx_stock_movement_lines_barcode_state ON stock_movement_lines(barcode,product_state,posting_state)");
    await run(db, "CREATE INDEX idx_stock_movement_lines_product ON stock_movement_lines(product_id)");
    await run(db, "CREATE INDEX idx_stock_movement_lines_movement_state ON stock_movement_lines(movement_id,posting_state,product_state)");
    await run(db, `CREATE TRIGGER trg_stock_movement_line_direction_insert BEFORE INSERT ON stock_movement_lines
      FOR EACH ROW WHEN (SELECT direction FROM stock_movements WHERE id=NEW.movement_id)<>'INWARD' AND NEW.product_state='PENDING_MASTER'
      BEGIN SELECT RAISE(ABORT,'KLBS_STOCK_MOVEMENT_LINE_DIRECTION_INVALID'); END`);
    await run(db, `CREATE TRIGGER trg_stock_movement_line_direction_update BEFORE UPDATE OF movement_id,product_state,product_id ON stock_movement_lines
      FOR EACH ROW WHEN (SELECT direction FROM stock_movements WHERE id=NEW.movement_id)<>'INWARD' AND NEW.product_state='PENDING_MASTER'
      BEGIN SELECT RAISE(ABORT,'KLBS_STOCK_MOVEMENT_LINE_DIRECTION_INVALID'); END`);
    await run(db, `CREATE TRIGGER trg_stock_movement_line_posted_immutable BEFORE UPDATE ON stock_movement_lines
      FOR EACH ROW WHEN OLD.posting_state='POSTED' AND (NEW.posting_state<>OLD.posting_state OR NEW.barcode<>OLD.barcode OR NEW.scanned_quantity<>OLD.scanned_quantity OR NEW.recognized_quantity<>OLD.recognized_quantity OR NEW.product_id IS NOT OLD.product_id OR NEW.posted_quantity<>OLD.posted_quantity OR NEW.inventory_transaction_id IS NOT OLD.inventory_transaction_id OR NEW.sku_snapshot IS NOT OLD.sku_snapshot OR NEW.product_name_snapshot IS NOT OLD.product_name_snapshot OR NEW.colour_snapshot IS NOT OLD.colour_snapshot OR NEW.size_snapshot IS NOT OLD.size_snapshot)
      BEGIN SELECT RAISE(ABORT,'KLBS_POSTED_STOCK_MOVEMENT_LINE_IMMUTABLE'); END`);
    await run(db, `CREATE TRIGGER trg_stock_movement_line_posted_delete BEFORE DELETE ON stock_movement_lines
      FOR EACH ROW WHEN OLD.posting_state='POSTED'
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
    await run(db, `CREATE TRIGGER trg_stock_movement_posted_immutable BEFORE UPDATE ON stock_movements
      FOR EACH ROW WHEN (OLD.status IN ('COMPLETE','CANCELLED') AND (NEW.status<>OLD.status OR NEW.movement_no<>OLD.movement_no OR NEW.business_date<>OLD.business_date OR NEW.invoice_total_quantity IS NOT OLD.invoice_total_quantity)) OR (OLD.posted_at IS NOT NULL AND (NEW.posted_at IS NOT OLD.posted_at OR NEW.posted_by IS NOT OLD.posted_by))
      BEGIN SELECT RAISE(ABORT,'KLBS_POSTED_STOCK_MOVEMENT_IMMUTABLE'); END`);
    await run(db, `CREATE TRIGGER trg_stock_movement_context_immutable BEFORE UPDATE OF supplier_id,supplier_name,supplier_code_snapshot,supplier_invoice_id,supplier_invoice_code_snapshot,invoice_no,invoice_number_snapshot,reference_text,invoice_date,invoice_total_quantity,store_id,store_code_snapshot,store_name_snapshot,business_date ON stock_movements
      FOR EACH ROW WHEN OLD.posted_at IS NOT NULL AND (NEW.supplier_id IS NOT OLD.supplier_id OR NEW.supplier_name IS NOT OLD.supplier_name OR NEW.supplier_code_snapshot IS NOT OLD.supplier_code_snapshot OR NEW.supplier_invoice_id IS NOT OLD.supplier_invoice_id OR NEW.supplier_invoice_code_snapshot IS NOT OLD.supplier_invoice_code_snapshot OR NEW.invoice_no IS NOT OLD.invoice_no OR NEW.invoice_number_snapshot IS NOT OLD.invoice_number_snapshot OR NEW.reference_text IS NOT OLD.reference_text OR NEW.invoice_date IS NOT OLD.invoice_date OR NEW.invoice_total_quantity IS NOT OLD.invoice_total_quantity OR NEW.store_id IS NOT OLD.store_id OR NEW.store_code_snapshot IS NOT OLD.store_code_snapshot OR NEW.store_name_snapshot IS NOT OLD.store_name_snapshot OR NEW.business_date<>OLD.business_date)
      BEGIN SELECT RAISE(ABORT,'KLBS_POSTED_STOCK_MOVEMENT_CONTEXT_IMMUTABLE'); END`);
    await run(db, `CREATE TRIGGER trg_stock_movement_delete_prohibited BEFORE DELETE ON stock_movements
      BEGIN SELECT RAISE(ABORT,'KLBS_STOCK_MOVEMENT_DELETE_PROHIBITED'); END`);

    const afterMovements = await all(db, "SELECT * FROM stock_movements ORDER BY id");
    const afterLines = await all(db, "SELECT * FROM stock_movement_lines ORDER BY id");
    if (movements.length !== afterMovements.length || movements.some((row, index) => Object.keys(row).some(key => row[key] !== afterMovements[index][key]))) throw new Error("V14 stock movement migration did not preserve historical document values.");
    if (lines.length !== afterLines.length || lines.some((line, index) => line.id !== afterLines[index].id || line.movement_id !== afterLines[index].movement_id || line.barcode !== afterLines[index].barcode || line.scanned_quantity !== afterLines[index].scanned_quantity || line.recognized_quantity !== afterLines[index].recognized_quantity || line.inventory_transaction_id !== afterLines[index].inventory_transaction_id)) throw new Error("V14 stock movement migration did not preserve historical line values.");
}

module.exports = { migrateStockInwardV14 };
