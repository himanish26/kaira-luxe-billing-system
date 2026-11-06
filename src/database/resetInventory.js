"use strict";

const db = require("./database");
const { logInventoryReset } = require("./logService");

function run(sql, params = []) {
    return new Promise((resolve, reject) => db.run(sql, params, function (error) {
        if (error) reject(error);
        else resolve({ lastID: this.lastID, changes: this.changes });
    }));
}

function get(sql, params = []) {
    return new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
}

function all(sql, params = []) {
    return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
}

async function consumeBucketLayers(transactionId, bucketId, quantity, movementAllocationId, createdAt) {
    const batch = await run(`INSERT INTO stock_cost_allocation_batches
        (inventory_transaction_id,expected_quantity,status,created_at)
        VALUES(?,?,'OPEN',?)`, [transactionId, -quantity, createdAt]);
    const layers = await all(`SELECT l.id,l.unit_cost_paise,l.cost_basis_status,
        l.quantity_received+COALESCE((SELECT SUM(c.quantity) FROM stock_cost_allocations c WHERE c.layer_id=l.id),0) AS remaining
        FROM stock_receipt_layers l WHERE l.bucket_id=? ORDER BY l.received_at,l.id`, [bucketId]);
    let remaining = quantity;
    for (const layer of layers) {
        const available = Math.max(0, Number(layer.remaining));
        if (!available) continue;
        const take = Math.min(remaining, available);
        await run(`INSERT INTO stock_cost_allocations
            (batch_id,inventory_transaction_id,layer_id,quantity,unit_cost_paise,cost_basis_status,movement_allocation_id,created_at)
            VALUES(?,?,?,?,?,?,?,?)`, [batch.lastID, transactionId, layer.id, -take,
            layer.unit_cost_paise, layer.cost_basis_status, movementAllocationId, createdAt]);
        remaining -= take;
        if (!remaining) break;
    }
    if (remaining) throw new Error(`Cannot reset safely: MRP bucket ${bucketId} has ${remaining} unit(s) without matching FIFO cost layers.`);
    await run("UPDATE stock_cost_allocation_batches SET status='COMPLETE',completed_at=? WHERE id=?", [createdAt, batch.lastID]);
}

async function resetInventory() {
    const now = new Date();
    const instant = now.toISOString();
    const businessDate = instant.slice(0, 10);
    let movementNo = null;

    try {
        await run("BEGIN IMMEDIATE TRANSACTION");

        const openMovement = await get(`SELECT movement_no,status FROM stock_movements
            WHERE status NOT IN ('COMPLETE','CANCELLED') ORDER BY id LIMIT 1`);
        if (openMovement) throw new Error(`Finish or cancel stock movement ${openMovement.movement_no} (${openMovement.status}) before resetting inventory.`);

        const balances = await all(`SELECT p.id AS product_id,p.barcode,p.sku,p.product_name,p.colour,p.size,
            COALESCE(SUM(t.quantity),0) AS total_quantity,
            COALESCE(SUM(CASE WHEN t.mrp_bucket_id IS NULL THEN t.quantity ELSE 0 END),0) AS unassigned_quantity
            FROM products p LEFT JOIN inventory_transactions t ON t.product_id=p.id
            GROUP BY p.id,p.barcode,p.sku,p.product_name,p.colour,p.size ORDER BY p.id`);
        const bucketRows = await all(`SELECT b.id AS bucket_id,b.product_id,b.mrp_paise,
            COALESCE(SUM(t.quantity),0) AS quantity,p.barcode,p.sku,p.product_name,p.colour,p.size
            FROM product_mrp_buckets b JOIN products p ON p.id=b.product_id
            LEFT JOIN inventory_transactions t ON t.mrp_bucket_id=b.id
            GROUP BY b.id,b.product_id,b.mrp_paise,p.barcode,p.sku,p.product_name,p.colour,p.size
            HAVING COALESCE(SUM(t.quantity),0)<>0 ORDER BY b.product_id,b.mrp_paise`);

        const bucketsByProduct = new Map();
        for (const bucket of bucketRows) {
            const quantity = Number(bucket.quantity);
            if (!Number.isSafeInteger(quantity) || quantity < 0) throw new Error(`Cannot reset safely: barcode ${bucket.barcode} has a negative MRP balance.`);
            if (!bucketsByProduct.has(Number(bucket.product_id))) bucketsByProduct.set(Number(bucket.product_id), []);
            bucketsByProduct.get(Number(bucket.product_id)).push({ ...bucket, quantity });
        }
        for (const product of balances) {
            const bucketTotal = (bucketsByProduct.get(Number(product.product_id)) || []).reduce((sum, row) => sum + row.quantity, 0);
            const total = Number(product.total_quantity);
            const unassigned = Number(product.unassigned_quantity);
            if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(unassigned) || unassigned < 0 || bucketTotal + unassigned !== total) {
                throw new Error(`Cannot reset safely: stock ledger does not reconcile for barcode ${product.barcode}. No changes were made.`);
            }
        }

        const allocatedBuckets = bucketRows.filter(row => Number(row.quantity) > 0);
        if (allocatedBuckets.length) {
            const sequence = await get("SELECT next_movement_number FROM stock_movement_sequences WHERE id=1");
            if (!sequence) throw new Error("Cannot reset safely: stock movement number sequence is unavailable.");
            const number = Number(sequence.next_movement_number);
            if (!Number.isSafeInteger(number) || number < 1) throw new Error("Cannot reset safely: stock movement number sequence is invalid.");
            movementNo = `KLOUT${String(number).padStart(6, "0")}`;
            await run("UPDATE stock_movement_sequences SET next_movement_number=? WHERE id=1 AND next_movement_number=?", [number + 1, number]);
            await run(`INSERT INTO stock_movements
                (movement_no,direction,status,business_date,reason,remarks,idempotency_key,created_by,created_at,updated_at)
                VALUES(?,'OUTWARD','DRAFT',?,'ADJUSTMENT','History-preserving inventory rebaseline','INVENTORY_RESET:'||?, 'ADMINISTRATOR',?,?)`,
                [movementNo, businessDate, movementNo, instant, instant]);
            const movement = await get("SELECT id FROM stock_movements WHERE movement_no=?", [movementNo]);

            for (const [productId, productBuckets] of bucketsByProduct.entries()) {
                const positiveBuckets = productBuckets.filter(bucket => bucket.quantity > 0);
                if (!positiveBuckets.length) continue;
                const product = positiveBuckets[0];
                const quantity = positiveBuckets.reduce((sum, bucket) => sum + bucket.quantity, 0);
                const line = await run(`INSERT INTO stock_movement_lines
                    (movement_id,barcode,scanned_quantity,recognized_quantity,product_id,product_state,posting_state,posted_quantity,
                     sku_snapshot,product_name_snapshot,colour_snapshot,size_snapshot,created_at,updated_at)
                    VALUES(?,?,?,?,?,'READY','UNPOSTED',0,?,?,?,?,?,?)`,
                    [movement.id, product.barcode, quantity, quantity, productId, product.sku, product.product_name,
                    product.colour, product.size, instant, instant]);

                for (const bucket of positiveBuckets) {
                    const allocation = await run(`INSERT INTO stock_movement_mrp_allocations
                        (movement_line_id,bucket_id,quantity,unit_cost_paise,cost_basis_status,posting_state,posted_quantity,created_by,created_at)
                        VALUES(?,?,?,NULL,'UNKNOWN','UNPOSTED',0,'ADMINISTRATOR',?)`, [line.lastID, bucket.bucket_id, bucket.quantity, instant]);
                    const transaction = await run(`INSERT INTO inventory_transactions
                        (product_id,barcode,transaction_type,quantity,reference_type,reference_id,remarks,created_by,created_at,mrp_bucket_id)
                        VALUES(?,?,'ADJUSTMENT',?,'STOCK_OUTWARD',?,?, 'Administrator',?,?)`,
                        [productId, product.barcode, -bucket.quantity, movementNo,
                        `Inventory reset · MRP ₹${(Number(bucket.mrp_paise) / 100).toFixed(2)} · stock cleared for Product Master rebaseline`, instant, bucket.bucket_id]);
                    await run(`UPDATE stock_movement_mrp_allocations SET posting_state='POSTED',posted_quantity=quantity,inventory_transaction_id=? WHERE id=?`, [transaction.lastID, allocation.lastID]);
                    await consumeBucketLayers(transaction.lastID, bucket.bucket_id, bucket.quantity, allocation.lastID, instant);
                    await run(`UPDATE product_mrp_buckets SET status='CLOSED' WHERE id=?`, [bucket.bucket_id]);
                }
                await run(`UPDATE stock_movement_lines SET posting_state='POSTED',posted_quantity=recognized_quantity,updated_at=? WHERE id=?`, [instant, line.lastID]);
            }
            await run(`UPDATE stock_movements SET status='COMPLETE',posted_by='ADMINISTRATOR',posted_at=?,updated_at=? WHERE id=?`, [instant, instant, movement.id]);
        }

        for (const product of balances) {
            const unassigned = Number(product.unassigned_quantity);
            if (unassigned > 0) {
                await run(`INSERT INTO inventory_transactions
                    (product_id,barcode,transaction_type,quantity,reference_type,reference_id,remarks,created_by,created_at)
                    VALUES(?,?,'ADJUSTMENT',?,'INVENTORY_RESET',?,'Unassigned stock cleared for Product Master rebaseline','ADMINISTRATOR',?)`,
                    [product.product_id, product.barcode, -unassigned, movementNo || `RESET-${instant}`, instant]);
            }
        }

        await run("UPDATE product_mrp_buckets SET status='CLOSED'");
        await run("UPDATE products SET opening_stock=0,active=0");
        await run(`INSERT INTO inventory_initialization(initialization_type,status,initialized_at,initialized_by,remarks)
            VALUES('OPENING_STOCK','RESET_PENDING',NULL,'ADMINISTRATOR',?)
            ON CONFLICT(initialization_type) DO UPDATE SET status='RESET_PENDING',initialized_at=NULL,initialized_by='ADMINISTRATOR',remarks=excluded.remarks`,
            [`Inventory reset ${instant}; import a reconciled Product Master to establish the new opening stock.`]);

        await run("COMMIT");
    } catch (error) {
        try { await run("ROLLBACK"); } catch (_) { /* preserve the original failure */ }
        throw error;
    }

    let activityWarning = null;
    try { await logInventoryReset(); }
    catch (logError) {
        activityWarning = "Activity Log could not be recorded.";
        console.error("Inventory reset activity logging failed:", logError.message);
    }
    return { success: true, activityWarning, movementNo };
}

module.exports = resetInventory;
