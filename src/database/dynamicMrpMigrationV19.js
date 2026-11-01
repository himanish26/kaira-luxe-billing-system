"use strict";

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => db.run(sql, params, error => error ? reject(error) : resolve()));
}
function all(db, sql) {
    return new Promise((resolve, reject) => db.all(sql, [], (error, rows) => error ? reject(error) : resolve(rows || [])));
}

async function addColumn(db, table, name, definition) {
    const columns = await all(db, `PRAGMA table_info(${table})`);
    if (!columns.some(column => column.name === name)) await run(db, `ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}

async function migrateDynamicMrpV19(db) {
    await run(db, `CREATE TABLE IF NOT EXISTS product_mrp_buckets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products(id),
        mrp_paise INTEGER NOT NULL CHECK(typeof(mrp_paise)='integer' AND mrp_paise>=0),
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','CLOSED')),
        source TEXT NOT NULL CHECK(source IN ('INWARD','STOCK_MOVEMENT','RECONCILIATION','LEGACY_VERIFIED')),
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(product_id,mrp_paise),
        UNIQUE(id,product_id)
    )`);
    await run(db, `CREATE TABLE IF NOT EXISTS product_mrp_reconciliation (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products(id),
        status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','COMPLETE')),
        operation_key TEXT NOT NULL UNIQUE,
        payload_hash TEXT NOT NULL,
        actor TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL,
        completed_at TEXT
    )`);
    await run(db, `CREATE TABLE IF NOT EXISTS product_mrp_reconciliation_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reconciliation_id INTEGER NOT NULL REFERENCES product_mrp_reconciliation(id),
        bucket_id INTEGER NOT NULL REFERENCES product_mrp_buckets(id),
        quantity INTEGER NOT NULL CHECK(typeof(quantity)='integer' AND quantity>0),
        source_transaction_id INTEGER NOT NULL UNIQUE REFERENCES inventory_transactions(id),
        destination_transaction_id INTEGER NOT NULL UNIQUE REFERENCES inventory_transactions(id),
        created_at TEXT NOT NULL
    )`);
    await run(db, `CREATE TABLE IF NOT EXISTS stock_receipt_layers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bucket_id INTEGER NOT NULL REFERENCES product_mrp_buckets(id),
        source_movement_line_id INTEGER REFERENCES stock_movement_lines(id),
        source_movement_allocation_id INTEGER UNIQUE REFERENCES stock_movement_mrp_allocations(id),
        supplier_invoice_id INTEGER REFERENCES supplier_invoices(id),
        supplier_id INTEGER REFERENCES supplier_master(id),
        invoice_no TEXT,
        invoice_date TEXT,
        quantity_received INTEGER NOT NULL CHECK(typeof(quantity_received)='integer' AND quantity_received>0),
        unit_cost_paise INTEGER CHECK(unit_cost_paise IS NULL OR (typeof(unit_cost_paise)='integer' AND unit_cost_paise>=0)),
        cost_basis_status TEXT NOT NULL CHECK(cost_basis_status IN ('CAPTURED','UNKNOWN')),
        cost_source TEXT,
        received_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        CHECK((cost_basis_status='CAPTURED' AND unit_cost_paise IS NOT NULL AND cost_source='SUPPLIER_INVOICE') OR
              (cost_basis_status='UNKNOWN' AND unit_cost_paise IS NULL AND cost_source IS NULL))
    )`);
    await run(db, `CREATE TABLE IF NOT EXISTS stock_movement_mrp_allocations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        movement_line_id INTEGER NOT NULL REFERENCES stock_movement_lines(id),
        bucket_id INTEGER NOT NULL REFERENCES product_mrp_buckets(id),
        quantity INTEGER NOT NULL CHECK(typeof(quantity)='integer' AND quantity>0),
        unit_cost_paise INTEGER CHECK(unit_cost_paise IS NULL OR (typeof(unit_cost_paise)='integer' AND unit_cost_paise>=0)),
        cost_basis_status TEXT NOT NULL CHECK(cost_basis_status IN ('CAPTURED','UNKNOWN')),
        posting_state TEXT NOT NULL DEFAULT 'UNPOSTED' CHECK(posting_state IN ('UNPOSTED','POSTED')),
        posted_quantity INTEGER NOT NULL DEFAULT 0 CHECK(typeof(posted_quantity)='integer' AND posted_quantity>=0 AND posted_quantity<=quantity),
        inventory_transaction_id INTEGER REFERENCES inventory_transactions(id),
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        CHECK((cost_basis_status='CAPTURED' AND unit_cost_paise IS NOT NULL) OR (cost_basis_status='UNKNOWN' AND unit_cost_paise IS NULL)),
        CHECK((posting_state='UNPOSTED' AND posted_quantity=0 AND inventory_transaction_id IS NULL) OR
              (posting_state='POSTED' AND posted_quantity=quantity AND inventory_transaction_id IS NOT NULL))
    )`);
    await run(db, `CREATE TABLE IF NOT EXISTS stock_cost_allocation_batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        inventory_transaction_id INTEGER NOT NULL UNIQUE REFERENCES inventory_transactions(id),
        expected_quantity INTEGER NOT NULL CHECK(typeof(expected_quantity)='integer' AND expected_quantity<>0),
        status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','COMPLETE')),
        created_at TEXT NOT NULL,
        completed_at TEXT
    )`);
    await run(db, `CREATE TABLE IF NOT EXISTS stock_cost_allocations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id INTEGER NOT NULL REFERENCES stock_cost_allocation_batches(id),
        inventory_transaction_id INTEGER NOT NULL REFERENCES inventory_transactions(id),
        bill_item_id INTEGER REFERENCES bill_items(id),
        return_item_id INTEGER REFERENCES return_items(id),
        movement_allocation_id INTEGER REFERENCES stock_movement_mrp_allocations(id),
        layer_id INTEGER NOT NULL REFERENCES stock_receipt_layers(id),
        quantity INTEGER NOT NULL CHECK(typeof(quantity)='integer' AND quantity<>0),
        unit_cost_paise INTEGER CHECK(unit_cost_paise IS NULL OR (typeof(unit_cost_paise)='integer' AND unit_cost_paise>=0)),
        cost_basis_status TEXT NOT NULL CHECK(cost_basis_status IN ('CAPTURED','UNKNOWN')),
        source_allocation_id INTEGER REFERENCES stock_cost_allocations(id),
        created_at TEXT NOT NULL,
        CHECK((cost_basis_status='CAPTURED' AND unit_cost_paise IS NOT NULL) OR (cost_basis_status='UNKNOWN' AND unit_cost_paise IS NULL)),
        CHECK((quantity<0 AND source_allocation_id IS NULL AND return_item_id IS NULL AND
                ((bill_item_id IS NOT NULL AND movement_allocation_id IS NULL) OR (bill_item_id IS NULL AND movement_allocation_id IS NOT NULL))) OR
              (quantity>0 AND source_allocation_id IS NOT NULL AND bill_item_id IS NULL AND movement_allocation_id IS NULL AND return_item_id IS NOT NULL))
    )`);

    await addColumn(db, "inventory_transactions", "mrp_bucket_id", "INTEGER REFERENCES product_mrp_buckets(id)");
    await addColumn(db, "bill_items", "mrp_bucket_id", "INTEGER REFERENCES product_mrp_buckets(id)");
    await addColumn(db, "bill_items", "cost_total_paise", "INTEGER CHECK(cost_total_paise IS NULL OR (typeof(cost_total_paise)='integer' AND cost_total_paise>=0))");
    await addColumn(db, "return_items", "mrp_bucket_id", "INTEGER REFERENCES product_mrp_buckets(id)");
    await run(db, "CREATE INDEX IF NOT EXISTS idx_mrp_bucket_product_status ON product_mrp_buckets(product_id,status,mrp_paise)");
    await run(db, "CREATE INDEX IF NOT EXISTS idx_inventory_transactions_mrp_bucket ON inventory_transactions(mrp_bucket_id,product_id)");
    await run(db, "CREATE INDEX IF NOT EXISTS idx_bill_items_mrp_bucket ON bill_items(mrp_bucket_id,bill_no)");
    await run(db, "CREATE INDEX IF NOT EXISTS idx_return_items_mrp_bucket ON return_items(mrp_bucket_id,return_id)");
    await run(db, "CREATE INDEX IF NOT EXISTS idx_receipt_layers_fifo ON stock_receipt_layers(bucket_id,received_at,id)");
    await run(db, "CREATE INDEX IF NOT EXISTS idx_movement_mrp_allocations_line ON stock_movement_mrp_allocations(movement_line_id,posting_state)");
    await run(db, "CREATE INDEX IF NOT EXISTS idx_cost_allocations_layer ON stock_cost_allocations(layer_id,created_at,id)");
    await run(db, "CREATE INDEX IF NOT EXISTS idx_cost_allocations_batch ON stock_cost_allocations(batch_id,id)");

    await run(db, `CREATE TRIGGER IF NOT EXISTS trg_inventory_mrp_bucket_product_insert
        BEFORE INSERT ON inventory_transactions WHEN NEW.mrp_bucket_id IS NOT NULL AND NOT EXISTS(
            SELECT 1 FROM product_mrp_buckets b WHERE b.id=NEW.mrp_bucket_id AND b.product_id=NEW.product_id)
        BEGIN SELECT RAISE(ABORT,'KLBS_MRP_BUCKET_PRODUCT_MISMATCH'); END`);
    await run(db, `CREATE TRIGGER IF NOT EXISTS trg_inventory_mrp_bucket_product_update
        BEFORE UPDATE OF mrp_bucket_id,product_id ON inventory_transactions WHEN NEW.mrp_bucket_id IS NOT NULL AND NOT EXISTS(
            SELECT 1 FROM product_mrp_buckets b WHERE b.id=NEW.mrp_bucket_id AND b.product_id=NEW.product_id)
        BEGIN SELECT RAISE(ABORT,'KLBS_MRP_BUCKET_PRODUCT_MISMATCH'); END`);
    await run(db, `CREATE TRIGGER IF NOT EXISTS trg_inventory_mrp_bucket_immutable
        BEFORE UPDATE OF mrp_bucket_id ON inventory_transactions
        WHEN OLD.mrp_bucket_id IS NOT NULL AND NEW.mrp_bucket_id IS NOT OLD.mrp_bucket_id
        BEGIN SELECT RAISE(ABORT,'KLBS_MRP_INVENTORY_ALLOCATION_IMMUTABLE'); END`);
    await run(db, `CREATE TRIGGER IF NOT EXISTS trg_mrp_bucket_price_immutable
        BEFORE UPDATE OF product_id,mrp_paise ON product_mrp_buckets
        WHEN NEW.product_id<>OLD.product_id OR NEW.mrp_paise<>OLD.mrp_paise
        BEGIN SELECT RAISE(ABORT,'KLBS_MRP_BUCKET_IDENTITY_IMMUTABLE'); END`);
    await run(db, `CREATE TRIGGER IF NOT EXISTS trg_mrp_reconciliation_complete_immutable
        BEFORE UPDATE ON product_mrp_reconciliation WHEN OLD.status='COMPLETE'
        BEGIN SELECT RAISE(ABORT,'KLBS_MRP_RECONCILIATION_IMMUTABLE'); END`);
    await run(db, `CREATE TRIGGER IF NOT EXISTS trg_mrp_reconciliation_delete_guard
        BEFORE DELETE ON product_mrp_reconciliation
        BEGIN SELECT RAISE(ABORT,'KLBS_MRP_RECONCILIATION_DELETE_PROHIBITED'); END`);
    await run(db, `CREATE TRIGGER IF NOT EXISTS trg_stock_receipt_layer_immutable_update
        BEFORE UPDATE ON stock_receipt_layers
        BEGIN SELECT RAISE(ABORT,'KLBS_STOCK_RECEIPT_LAYER_IMMUTABLE'); END`);
    await run(db, `CREATE TRIGGER IF NOT EXISTS trg_stock_receipt_layer_immutable_delete
        BEFORE DELETE ON stock_receipt_layers
        BEGIN SELECT RAISE(ABORT,'KLBS_STOCK_RECEIPT_LAYER_DELETE_PROHIBITED'); END`);
    await run(db, `CREATE TRIGGER IF NOT EXISTS trg_bill_item_mrp_bucket_insert
        BEFORE INSERT ON bill_items WHEN NEW.mrp_bucket_id IS NOT NULL AND NOT EXISTS(
          SELECT 1 FROM product_mrp_buckets b JOIN products p ON p.id=b.product_id
          WHERE b.id=NEW.mrp_bucket_id AND p.barcode=NEW.barcode AND round(NEW.mrp*100)=b.mrp_paise)
        BEGIN SELECT RAISE(ABORT,'KLBS_BILL_ITEM_MRP_BUCKET_MISMATCH'); END`);
    await run(db, `CREATE TRIGGER IF NOT EXISTS trg_bill_item_mrp_bucket_update
        BEFORE UPDATE OF mrp_bucket_id,mrp,barcode ON bill_items WHEN NEW.mrp_bucket_id IS NOT NULL AND NOT EXISTS(
          SELECT 1 FROM product_mrp_buckets b JOIN products p ON p.id=b.product_id
          WHERE b.id=NEW.mrp_bucket_id AND p.barcode=NEW.barcode AND round(NEW.mrp*100)=b.mrp_paise)
        BEGIN SELECT RAISE(ABORT,'KLBS_BILL_ITEM_MRP_BUCKET_MISMATCH'); END`);
    await run(db, `CREATE TRIGGER IF NOT EXISTS trg_return_item_mrp_bucket_insert
        BEFORE INSERT ON return_items WHEN NEW.mrp_bucket_id IS NOT NULL AND NOT EXISTS(
          SELECT 1 FROM bill_items bi WHERE bi.id=NEW.original_bill_item_id AND bi.barcode=NEW.barcode AND bi.mrp_bucket_id=NEW.mrp_bucket_id AND bi.mrp=NEW.mrp)
        BEGIN SELECT RAISE(ABORT,'KLBS_RETURN_ITEM_MRP_BUCKET_MISMATCH'); END`);
    await run(db, `CREATE TRIGGER IF NOT EXISTS trg_return_inventory_mrp_bucket_insert
        BEFORE INSERT ON inventory_transactions WHEN NEW.transaction_type='RETURN' AND NEW.mrp_bucket_id IS NOT NULL AND NOT EXISTS(
          SELECT 1 FROM returns r JOIN return_items ri ON ri.return_id=r.id
          WHERE r.return_no=NEW.reference_id AND ri.product_id=NEW.product_id AND ri.barcode=NEW.barcode AND ri.mrp_bucket_id=NEW.mrp_bucket_id AND ri.quantity=NEW.quantity)
        BEGIN SELECT RAISE(ABORT,'KLBS_RETURN_INVENTORY_MRP_BUCKET_MISMATCH'); END`);
    await run(db, `CREATE TRIGGER IF NOT EXISTS trg_stock_mrp_allocation_valid_insert
        BEFORE INSERT ON stock_movement_mrp_allocations
        WHEN NOT EXISTS(SELECT 1 FROM stock_movement_lines l JOIN stock_movements m ON m.id=l.movement_id
            JOIN product_mrp_buckets b ON b.id=NEW.bucket_id AND b.product_id=l.product_id
            WHERE l.id=NEW.movement_line_id AND m.direction IN ('INWARD','OUTWARD') AND l.posting_state='UNPOSTED'
              AND NEW.quantity <= l.recognized_quantity - COALESCE((SELECT SUM(a.quantity) FROM stock_movement_mrp_allocations a WHERE a.movement_line_id=l.id),0))
        BEGIN SELECT RAISE(ABORT,'KLBS_STOCK_MRP_ALLOCATION_INVALID'); END`);
    await run(db, `CREATE TRIGGER IF NOT EXISTS trg_stock_mrp_allocation_valid_update
        BEFORE UPDATE ON stock_movement_mrp_allocations
        WHEN OLD.posting_state='UNPOSTED' AND NEW.posting_state='UNPOSTED' AND NOT EXISTS(
          SELECT 1 FROM stock_movement_lines l JOIN stock_movements m ON m.id=l.movement_id
            JOIN product_mrp_buckets b ON b.id=NEW.bucket_id AND b.product_id=l.product_id
            WHERE l.id=NEW.movement_line_id AND m.direction IN ('INWARD','OUTWARD') AND l.posting_state='UNPOSTED'
              AND NEW.quantity <= l.recognized_quantity - COALESCE((SELECT SUM(a.quantity) FROM stock_movement_mrp_allocations a WHERE a.movement_line_id=l.id AND a.id<>OLD.id),0))
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
    await run(db, `CREATE TRIGGER IF NOT EXISTS trg_stock_mrp_allocation_immutable
        BEFORE UPDATE ON stock_movement_mrp_allocations
        WHEN OLD.posting_state='POSTED' AND (NEW.movement_line_id<>OLD.movement_line_id OR NEW.bucket_id<>OLD.bucket_id OR
          NEW.quantity<>OLD.quantity OR NEW.unit_cost_paise IS NOT OLD.unit_cost_paise OR
          NEW.cost_basis_status<>OLD.cost_basis_status OR NEW.posting_state<>OLD.posting_state OR
          NEW.posted_quantity<>OLD.posted_quantity OR NEW.inventory_transaction_id IS NOT OLD.inventory_transaction_id)
        BEGIN SELECT RAISE(ABORT,'KLBS_POSTED_STOCK_MRP_ALLOCATION_IMMUTABLE'); END`);
    await run(db, `CREATE TRIGGER IF NOT EXISTS trg_stock_mrp_allocation_posted_delete
        BEFORE DELETE ON stock_movement_mrp_allocations WHEN OLD.posting_state='POSTED'
        BEGIN SELECT RAISE(ABORT,'KLBS_POSTED_STOCK_MRP_ALLOCATION_DELETE_PROHIBITED'); END`);
    await run(db, `CREATE TRIGGER IF NOT EXISTS trg_stock_receipt_layer_source_guard
        BEFORE INSERT ON stock_receipt_layers WHEN NEW.source_movement_allocation_id IS NOT NULL AND NOT EXISTS(
          SELECT 1 FROM stock_movement_mrp_allocations a JOIN stock_movement_lines l ON l.id=a.movement_line_id
          JOIN stock_movements m ON m.id=l.movement_id WHERE a.id=NEW.source_movement_allocation_id
            AND a.bucket_id=NEW.bucket_id AND a.posting_state='POSTED' AND a.posted_quantity=NEW.quantity_received
            AND a.unit_cost_paise IS NEW.unit_cost_paise AND a.cost_basis_status=NEW.cost_basis_status
            AND l.id=NEW.source_movement_line_id AND m.direction='INWARD')
        BEGIN SELECT RAISE(ABORT,'KLBS_STOCK_RECEIPT_LAYER_SOURCE_INVALID'); END`);
    await run(db, `CREATE TRIGGER IF NOT EXISTS trg_mrp_reconciliation_pair_guard
        BEFORE INSERT ON product_mrp_reconciliation_lines
        WHEN NOT EXISTS(SELECT 1 FROM product_mrp_reconciliation r
          JOIN product_mrp_buckets b ON b.id=NEW.bucket_id AND b.product_id=r.product_id
          JOIN inventory_transactions src ON src.id=NEW.source_transaction_id AND src.product_id=r.product_id
          JOIN inventory_transactions dst ON dst.id=NEW.destination_transaction_id AND dst.product_id=r.product_id
          WHERE r.id=NEW.reconciliation_id AND src.transaction_type='ADJUSTMENT' AND src.mrp_bucket_id IS NULL
            AND src.quantity=-NEW.quantity AND src.reference_type='MRP_RECONCILIATION' AND src.reference_id=r.operation_key
            AND dst.transaction_type='ADJUSTMENT' AND dst.mrp_bucket_id=NEW.bucket_id AND dst.quantity=NEW.quantity
            AND dst.reference_type='MRP_RECONCILIATION' AND dst.reference_id=r.operation_key)
        BEGIN SELECT RAISE(ABORT,'KLBS_MRP_RECONCILIATION_PAIR_INVALID'); END`);
    await run(db, `CREATE TRIGGER IF NOT EXISTS trg_mrp_reconciliation_line_immutable_update
        BEFORE UPDATE ON product_mrp_reconciliation_lines
        BEGIN SELECT RAISE(ABORT,'KLBS_MRP_RECONCILIATION_LINE_IMMUTABLE'); END`);
    await run(db, `CREATE TRIGGER IF NOT EXISTS trg_mrp_reconciliation_line_immutable_delete
        BEFORE DELETE ON product_mrp_reconciliation_lines
        BEGIN SELECT RAISE(ABORT,'KLBS_MRP_RECONCILIATION_LINE_DELETE_PROHIBITED'); END`);
    await run(db, `CREATE TRIGGER IF NOT EXISTS trg_stock_cost_batch_complete_guard
        BEFORE UPDATE OF status ON stock_cost_allocation_batches
        WHEN NEW.status='COMPLETE' AND (COALESCE((SELECT SUM(a.quantity) FROM stock_cost_allocations a WHERE a.batch_id=OLD.id),0)<>NEW.expected_quantity OR
          NOT EXISTS(SELECT 1 FROM inventory_transactions t WHERE t.id=NEW.inventory_transaction_id AND t.quantity=NEW.expected_quantity))
        BEGIN SELECT RAISE(ABORT,'KLBS_STOCK_COST_ALLOCATION_QUANTITY_MISMATCH'); END`);
    await run(db, `CREATE TRIGGER IF NOT EXISTS trg_stock_cost_batch_immutable
        BEFORE UPDATE ON stock_cost_allocation_batches WHEN OLD.status='COMPLETE'
        BEGIN SELECT RAISE(ABORT,'KLBS_STOCK_COST_ALLOCATION_BATCH_IMMUTABLE'); END`);
    await run(db, `CREATE TRIGGER IF NOT EXISTS trg_stock_cost_batch_insert_guard
        BEFORE INSERT ON stock_cost_allocation_batches
        WHEN NOT EXISTS(SELECT 1 FROM inventory_transactions t WHERE t.id=NEW.inventory_transaction_id AND t.quantity=NEW.expected_quantity AND t.mrp_bucket_id IS NOT NULL)
        BEGIN SELECT RAISE(ABORT,'KLBS_STOCK_COST_ALLOCATION_BATCH_INVALID'); END`);
    await run(db, `CREATE TRIGGER IF NOT EXISTS trg_stock_cost_allocation_valid_insert
        BEFORE INSERT ON stock_cost_allocations
        WHEN NOT EXISTS(SELECT 1 FROM inventory_transactions t JOIN stock_receipt_layers l ON l.id=NEW.layer_id
          JOIN stock_cost_allocation_batches b ON b.id=NEW.batch_id AND b.inventory_transaction_id=t.id AND b.status='OPEN'
          WHERE t.id=NEW.inventory_transaction_id AND t.mrp_bucket_id=l.bucket_id AND
            NEW.unit_cost_paise IS l.unit_cost_paise AND NEW.cost_basis_status=l.cost_basis_status AND
            ((NEW.quantity<0 AND t.quantity<0 AND NEW.return_item_id IS NULL AND
                ((NEW.bill_item_id IS NOT NULL AND NEW.movement_allocation_id IS NULL AND EXISTS(SELECT 1 FROM bill_items bi WHERE bi.id=NEW.bill_item_id AND bi.mrp_bucket_id=l.bucket_id AND bi.qty=-t.quantity AND bi.barcode=t.barcode)) OR
                 (NEW.bill_item_id IS NULL AND NEW.movement_allocation_id IS NOT NULL AND EXISTS(SELECT 1 FROM stock_movement_mrp_allocations ma WHERE ma.id=NEW.movement_allocation_id AND ma.bucket_id=l.bucket_id AND ma.inventory_transaction_id=t.id)))) OR
             (NEW.quantity>0 AND t.quantity>0 AND NEW.source_allocation_id IS NOT NULL AND NEW.return_item_id IS NOT NULL AND NEW.bill_item_id IS NULL AND NEW.movement_allocation_id IS NULL
                AND EXISTS(SELECT 1 FROM return_items ri JOIN bill_items bi ON bi.id=ri.original_bill_item_id
                    JOIN stock_cost_allocations source ON source.id=NEW.source_allocation_id
                    WHERE ri.id=NEW.return_item_id AND ri.product_id=t.product_id AND bi.mrp_bucket_id=l.bucket_id
                      AND source.bill_item_id=bi.id AND source.layer_id=l.id)))) OR
          (NEW.quantity>0 AND (NOT EXISTS(SELECT 1 FROM stock_cost_allocations s WHERE s.id=NEW.source_allocation_id
              AND s.layer_id=NEW.layer_id AND s.quantity<0) OR
            NEW.quantity > -COALESCE((SELECT s.quantity FROM stock_cost_allocations s WHERE s.id=NEW.source_allocation_id),0) -
              COALESCE((SELECT SUM(r.quantity) FROM stock_cost_allocations r WHERE r.source_allocation_id=NEW.source_allocation_id),0))) OR
          (NEW.quantity<0 AND -NEW.quantity > COALESCE((SELECT l.quantity_received FROM stock_receipt_layers l WHERE l.id=NEW.layer_id),0) +
              COALESCE((SELECT SUM(a.quantity) FROM stock_cost_allocations a WHERE a.layer_id=NEW.layer_id),0))
        BEGIN SELECT RAISE(ABORT,'KLBS_STOCK_COST_ALLOCATION_INVALID'); END`);
    await run(db, `CREATE TRIGGER IF NOT EXISTS trg_stock_cost_allocation_immutable_update
        BEFORE UPDATE ON stock_cost_allocations
        BEGIN SELECT RAISE(ABORT,'KLBS_STOCK_COST_ALLOCATION_IMMUTABLE'); END`);
    await run(db, `CREATE TRIGGER IF NOT EXISTS trg_stock_cost_allocation_immutable_delete
        BEFORE DELETE ON stock_cost_allocations
        BEGIN SELECT RAISE(ABORT,'KLBS_STOCK_COST_ALLOCATION_DELETE_PROHIBITED'); END`);
    await run(db, `CREATE TRIGGER IF NOT EXISTS trg_stock_cost_allocation_batch_complete_insert
        BEFORE INSERT ON stock_cost_allocations
        WHEN (SELECT status FROM stock_cost_allocation_batches WHERE id=NEW.batch_id)<>'OPEN'
        BEGIN SELECT RAISE(ABORT,'KLBS_STOCK_COST_ALLOCATION_BATCH_CLOSED'); END`);
}

module.exports = { migrateDynamicMrpV19 };
