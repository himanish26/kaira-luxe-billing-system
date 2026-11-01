"use strict";

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => db.run(sql, params, function (error) {
        error ? reject(error) : resolve({ lastID: this.lastID, changes: this.changes });
    }));
}

function get(db, sql, params = []) {
    return new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
}

function all(db, sql, params = []) {
    return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
}

async function migrateDynamicMrpLegacyStockV27(db) {
    // Adopt the agreed legacy-stock policy: pre-Dynamic-MRP on-hand quantity
    // starts at the Product Master MRP; later inward receipts may add other MRPs.
    const products = await all(db, `SELECT p.id,p.barcode,p.mrp,COALESCE(SUM(t.quantity),0) AS quantity
        FROM products p JOIN inventory_transactions t ON t.product_id=p.id AND t.mrp_bucket_id IS NULL
        WHERE COALESCE(p.variable_value,0)=0 AND CAST(p.mrp AS REAL)>0
          AND EXISTS(SELECT 1 FROM product_mrp_buckets existing_bucket WHERE existing_bucket.product_id=p.id)
        GROUP BY p.id,p.barcode,p.mrp
        HAVING COALESCE(SUM(t.quantity),0)>0
        ORDER BY p.id`);

    for (const product of products) {
        const mrp = Number(product.mrp);
        const quantity = Number(product.quantity);
        const mrpPaise = Math.round((mrp + Number.EPSILON) * 100);
        if (!Number.isSafeInteger(mrpPaise) || mrpPaise < 0 || !Number.isSafeInteger(quantity) || quantity <= 0) continue;

        const operationKey = `V27-LEGACY-MRP-${Number(product.id)}`;
        if (await get(db, "SELECT id FROM product_mrp_reconciliation WHERE operation_key=?", [operationKey])) continue;

        let bucket = await get(db, "SELECT id,status FROM product_mrp_buckets WHERE product_id=? AND mrp_paise=?", [product.id, mrpPaise]);
        const createdAt = new Date().toISOString();
        if (!bucket) {
            const inserted = await run(db, `INSERT INTO product_mrp_buckets(product_id,mrp_paise,status,source,created_by,created_at)
                VALUES(?,?,'ACTIVE','LEGACY_VERIFIED','SYSTEM_MIGRATION_V27',?)`, [product.id, mrpPaise, createdAt]);
            bucket = { id: inserted.lastID };
        } else if (bucket.status !== "ACTIVE") {
            await run(db, "UPDATE product_mrp_buckets SET status='ACTIVE' WHERE id=?", [bucket.id]);
        }

        const reason = "Existing unallocated stock assigned to the Product Master MRP by the approved Dynamic MRP legacy-stock policy. Total stock is unchanged; historical purchase cost remains unknown.";
        const reconciliation = await run(db, `INSERT INTO product_mrp_reconciliation(product_id,status,operation_key,payload_hash,actor,reason,created_at,completed_at)
            VALUES(?,'COMPLETE',?,?,?, ?,?,?)`, [product.id, operationKey, `V27:${product.id}:${quantity}:${mrpPaise}`, "SYSTEM_MIGRATION_V27", reason, createdAt, createdAt]);
        const source = await run(db, `INSERT INTO inventory_transactions(product_id,barcode,transaction_type,quantity,reference_type,reference_id,remarks,created_by,created_at)
            VALUES(?,?,'ADJUSTMENT',?,'MRP_RECONCILIATION',?,?,?,?)`,
        [product.id, product.barcode, -quantity, operationKey, reason, "SYSTEM_MIGRATION_V27", createdAt]);
        const destination = await run(db, `INSERT INTO inventory_transactions(product_id,barcode,transaction_type,quantity,reference_type,reference_id,remarks,created_by,created_at,mrp_bucket_id)
            VALUES(?,?,'ADJUSTMENT',?,'MRP_RECONCILIATION',?,?,?, ?,?)`,
        [product.id, product.barcode, quantity, operationKey, reason, "SYSTEM_MIGRATION_V27", createdAt, bucket.id]);
        await run(db, `INSERT INTO product_mrp_reconciliation_lines(reconciliation_id,bucket_id,quantity,source_transaction_id,destination_transaction_id,created_at)
            VALUES(?,?,?,?,?,?)`, [reconciliation.lastID, bucket.id, quantity, source.lastID, destination.lastID, createdAt]);
        await run(db, `INSERT INTO stock_receipt_layers(bucket_id,quantity_received,unit_cost_paise,cost_basis_status,cost_source,received_at,created_by)
            VALUES(?,?,NULL,'UNKNOWN',NULL,?,?)`, [bucket.id, quantity, createdAt, "SYSTEM_MIGRATION_V27"]);
    }
}

module.exports = { migrateDynamicMrpLegacyStockV27 };
