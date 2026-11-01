"use strict";

const { createHash } = require("node:crypto");

class DynamicMrpError extends Error {
    constructor(message, code = "DYNAMIC_MRP_INVALID") { super(message); this.name = "DynamicMrpError"; this.code = code; }
}

function positiveInteger(value, label) {
    if (typeof value === "string" && !/^\d+$/.test(value.trim())) throw new DynamicMrpError(`${label} must be a positive whole number.`, "DYNAMIC_MRP_QUANTITY_INVALID");
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) throw new DynamicMrpError(`${label} must be a positive whole number.`, "DYNAMIC_MRP_QUANTITY_INVALID");
    return number;
}

function mrpToPaise(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) throw new DynamicMrpError("Enter a valid MRP.", "DYNAMIC_MRP_PRICE_INVALID");
    const paise = Math.round((amount + Number.EPSILON) * 100);
    if (!Number.isSafeInteger(paise)) throw new DynamicMrpError("MRP is outside the supported range.", "DYNAMIC_MRP_PRICE_INVALID");
    return paise;
}

function canonicalAllocations(input) {
    if (!Array.isArray(input) || input.length === 0) throw new DynamicMrpError("Add the physically counted quantity for each printed MRP.", "DYNAMIC_MRP_RECONCILIATION_EMPTY");
    const byMrp = new Map();
    for (const row of input) {
        const mrpPaise = Number.isSafeInteger(Number(row?.mrpPaise)) ? Number(row.mrpPaise) : mrpToPaise(row?.mrp);
        if (!Number.isSafeInteger(mrpPaise) || mrpPaise < 0) throw new DynamicMrpError("Enter a valid printed MRP.", "DYNAMIC_MRP_PRICE_INVALID");
        const quantity = positiveInteger(row?.quantity, "Counted quantity");
        byMrp.set(mrpPaise, (byMrp.get(mrpPaise) || 0) + quantity);
    }
    return [...byMrp.entries()].sort(([a], [b]) => a - b).map(([mrpPaise, quantity]) => ({ mrpPaise, quantity }));
}

function createDynamicMrpService(database, options = {}) {
    if (!database || typeof database.run !== "function" || typeof database.get !== "function" || typeof database.all !== "function") {
        throw new TypeError("A SQLite database connection is required.");
    }
    const db = database;
    const now = options.now || (() => new Date());
    const appendActivity = options.appendActivityInTransaction || ((conn, event, instant) => require("./activityService").appendActivityInTransaction(conn, event, instant));
    const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function (error) {
        error ? reject(error) : resolve({ lastID: this.lastID, changes: this.changes });
    }));
    const get = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
    const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
    let queue = Promise.resolve();
    function serialize(operation) { const task = queue.then(operation, operation); queue = task.catch(() => {}); return task; }
    async function transaction(operation) {
        await run("BEGIN IMMEDIATE TRANSACTION");
        try { const result = await operation(); await run("COMMIT"); return result; }
        catch (error) { await run("ROLLBACK").catch(() => {}); throw error; }
    }

    async function getBuckets(barcodeInput) {
        const barcode = String(barcodeInput || "").trim();
        if (!barcode) throw new DynamicMrpError("A product barcode is required.", "DYNAMIC_MRP_BARCODE_INVALID");
        const product = await get("SELECT id,barcode,sku,product_name,mrp FROM products WHERE TRIM(CAST(barcode AS TEXT))=? LIMIT 1", [barcode]);
        if (!product) throw new DynamicMrpError("Product was not found.", "DYNAMIC_MRP_PRODUCT_NOT_FOUND");
        const buckets = await all(`SELECT b.id,b.mrp_paise,b.status,COALESCE(SUM(t.quantity),0) AS quantity
            FROM product_mrp_buckets b LEFT JOIN inventory_transactions t ON t.mrp_bucket_id=b.id
            WHERE b.product_id=? GROUP BY b.id ORDER BY b.mrp_paise,b.id`, [product.id]);
        const unallocated = await get("SELECT COALESCE(SUM(quantity),0) AS quantity FROM inventory_transactions WHERE product_id=? AND mrp_bucket_id IS NULL", [product.id]);
        return {
            product: { id: Number(product.id), barcode: product.barcode, sku: product.sku, productName: product.product_name },
            mode: buckets.length || Number(unallocated?.quantity || 0) !== 0 ? "DYNAMIC_MRP" : "LEGACY_SINGLE_MRP",
            requiresReconciliation: Number(unallocated?.quantity || 0) !== 0,
            unallocatedQuantity: Number(unallocated?.quantity || 0),
            buckets: buckets.map(bucket => ({ id: Number(bucket.id), mrpPaise: Number(bucket.mrp_paise), mrp: Number(bucket.mrp_paise) / 100,
                status: bucket.status, quantity: Number(bucket.quantity), available: bucket.status === "ACTIVE" ? Math.max(0, Number(bucket.quantity)) : 0 }))
        };
    }

    async function reconcileExistingStock(input = {}) {
        const productId = positiveInteger(input.productId, "Product");
        const operationKey = String(input.operationKey || "").trim();
        const actor = String(input.actor || "MANAGER").trim().toUpperCase();
        const reason = String(input.reason || "").trim();
        if (!/^[A-Za-z0-9._:-]{8,128}$/.test(operationKey)) throw new DynamicMrpError("A valid reconciliation reference is required.", "DYNAMIC_MRP_OPERATION_KEY_INVALID");
        if (!new Set(["MANAGER", "ADMINISTRATOR"]).has(actor)) throw new DynamicMrpError("Manager authorization is required to reconcile stock.", "DYNAMIC_MRP_UNAUTHORIZED");
        if (!reason || reason.length > 500) throw new DynamicMrpError("Enter why the physical stock was reconciled.", "DYNAMIC_MRP_REASON_REQUIRED");
        const allocations = canonicalAllocations(input.allocations);
        const payloadHash = createHash("sha256").update(JSON.stringify({ productId, allocations, reason })).digest("hex");
        return serialize(() => transaction(async () => {
            const prior = await get("SELECT id,payload_hash,status FROM product_mrp_reconciliation WHERE operation_key=?", [operationKey]);
            if (prior) {
                if (prior.payload_hash !== payloadHash) throw new DynamicMrpError("This reconciliation reference was already used for different quantities.", "DYNAMIC_MRP_IDEMPOTENCY_CONFLICT");
                return { reconciliationId: Number(prior.id), repeated: true, status: prior.status };
            }
            const product = await get("SELECT id,barcode FROM products WHERE id=?", [productId]);
            if (!product) throw new DynamicMrpError("Product was not found.", "DYNAMIC_MRP_PRODUCT_NOT_FOUND");
            const unallocated = await get("SELECT COALESCE(SUM(quantity),0) AS quantity FROM inventory_transactions WHERE product_id=? AND mrp_bucket_id IS NULL", [productId]);
            const unallocatedQuantity = Number(unallocated?.quantity || 0);
            const countedQuantity = allocations.reduce((sum, row) => sum + row.quantity, 0);
            if (unallocatedQuantity <= 0 || countedQuantity !== unallocatedQuantity) {
                throw new DynamicMrpError(`The physical count must total the ${unallocatedQuantity} unallocated units in KLBS.`, "DYNAMIC_MRP_RECONCILIATION_TOTAL_MISMATCH");
            }
            const instant = now().toISOString();
            const operation = await run(`INSERT INTO product_mrp_reconciliation(product_id,status,operation_key,payload_hash,actor,reason,created_at)
                VALUES(?,'OPEN',?,?,?,?,?)`, [productId, operationKey, payloadHash, actor, reason, instant]);
            for (const row of allocations) {
                let bucket = await get("SELECT id,status FROM product_mrp_buckets WHERE product_id=? AND mrp_paise=?", [productId, row.mrpPaise]);
                if (bucket?.status === "CLOSED") await run("UPDATE product_mrp_buckets SET status='ACTIVE' WHERE id=?", [bucket.id]);
                if (!bucket) {
                    const inserted = await run(`INSERT INTO product_mrp_buckets(product_id,mrp_paise,status,source,created_by,created_at)
                        VALUES(?,?,'ACTIVE','RECONCILIATION',?,?)`, [productId, row.mrpPaise, actor, instant]);
                    bucket = { id: inserted.lastID };
                }
                const source = await run(`INSERT INTO inventory_transactions(product_id,barcode,transaction_type,quantity,reference_type,reference_id,remarks,created_by,created_at)
                    VALUES(?,?,'ADJUSTMENT',?,'MRP_RECONCILIATION',?,?,?,?)`, [productId, product.barcode, -row.quantity, operationKey, reason, actor, instant]);
                const destination = await run(`INSERT INTO inventory_transactions(product_id,barcode,transaction_type,quantity,reference_type,reference_id,remarks,created_by,created_at,mrp_bucket_id)
                    VALUES(?,?,'ADJUSTMENT',?,'MRP_RECONCILIATION',?,?,?, ?,?)`, [productId, product.barcode, row.quantity, operationKey, reason, actor, instant, bucket.id]);
                await run(`INSERT INTO product_mrp_reconciliation_lines(reconciliation_id,bucket_id,quantity,source_transaction_id,destination_transaction_id,created_at)
                    VALUES(?,?,?,?,?,?)`, [operation.lastID, bucket.id, row.quantity, source.lastID, destination.lastID, instant]);
                await run(`INSERT INTO stock_receipt_layers(bucket_id,quantity_received,unit_cost_paise,cost_basis_status,cost_source,received_at,created_by)
                    VALUES(?,?,NULL,'UNKNOWN',NULL,?,?)`, [bucket.id, row.quantity, instant, actor]);
            }
            await run("UPDATE product_mrp_reconciliation SET status='COMPLETE',completed_at=? WHERE id=? AND status='OPEN'", [instant, operation.lastID]);
            const summary = allocations.map(row => `₹${(row.mrpPaise / 100).toFixed(2)} × ${row.quantity}`).join(", ");
            await appendActivity(db, { category: "INVENTORY", action: "DYNAMIC_MRP_STOCK_RECONCILED",
                details: `${product.barcode}; ${summary}; ${reason}; reference ${operationKey}`, user_name: actor,
                status: "SUCCESS", entity_type: "MRP_RECONCILIATION", reference_no: operationKey,
                change_data: { version: 1, changes: [{ field: "barcode", label: "Barcode", old: null, new: product.barcode },
                    { field: "quantity", label: "Reconciled quantity", old: String(unallocatedQuantity), new: String(countedQuantity) },
                    { field: "reason", label: "Reason", old: null, new: reason }] } }, now());
            return { reconciliationId: Number(operation.lastID), repeated: false, status: "COMPLETE", totalQuantity: countedQuantity, buckets: allocations };
        }));
    }

    async function getBillingOptions(barcode, currentCart = []) {
        const detail = await getBuckets(barcode);
        if (detail.mode === "LEGACY_SINGLE_MRP") return { ...detail, choices: [], eligibleCount: 0 };
        if (detail.requiresReconciliation) return { ...detail, choices: [], eligibleCount: 0, blockedReason: "MRP_RECONCILIATION_REQUIRED" };
        const inCart = new Map();
        for (const line of Array.isArray(currentCart) ? currentCart : []) {
            if (String(line?.barcode || "").trim() !== detail.product.barcode || !line?.mrp_bucket_id) continue;
            const bucketId = Number(line.mrp_bucket_id);
            const quantity = Number(line.qty);
            if (Number.isSafeInteger(bucketId) && Number.isSafeInteger(quantity) && quantity > 0) inCart.set(bucketId, (inCart.get(bucketId) || 0) + quantity);
        }
        const choices = detail.buckets.map(bucket => ({ ...bucket, availableToAdd: Math.max(0, bucket.available - (inCart.get(bucket.id) || 0)) }))
            .filter(bucket => bucket.status === "ACTIVE" && bucket.availableToAdd > 0);
        return { ...detail, choices, eligibleCount: choices.length,
            action: choices.length > 1 ? "SELECT_MRP" : choices.length === 1 ? "ADD_DIRECTLY" : "INSUFFICIENT_STOCK" };
    }

    async function configureMovementAllocations(input = {}) {
        const movementId = positiveInteger(input.movementId, "Stock movement");
        const lineId = positiveInteger(input.lineId, "Stock movement line");
        if (!Array.isArray(input.allocations) || !input.allocations.length) throw new DynamicMrpError("Add an MRP and quantity for every received or removed item.", "DYNAMIC_MRP_ALLOCATION_EMPTY");
        return serialize(() => transaction(async () => {
            const line = await get(`SELECT l.*,m.direction,m.status FROM stock_movement_lines l JOIN stock_movements m ON m.id=l.movement_id
                WHERE l.id=? AND l.movement_id=?`, [lineId, movementId]);
            if (!line || line.product_state !== "READY" || !["UNPOSTED","PARTIALLY_POSTED"].includes(line.posting_state) || line.discarded_at || !["DRAFT","PENDING_MASTER","PARTIALLY_POSTED"].includes(line.status)) {
                throw new DynamicMrpError("This stock line cannot be assigned to an MRP.", "DYNAMIC_MRP_MOVEMENT_LINE_INVALID");
            }
            const byMrp = new Map();
            for (const row of input.allocations) {
                const mrpPaise = Number.isSafeInteger(Number(row?.mrpPaise)) ? Number(row.mrpPaise) : mrpToPaise(row?.mrp);
                if (mrpPaise < 0) throw new DynamicMrpError("Enter a valid printed MRP.", "DYNAMIC_MRP_PRICE_INVALID");
                const quantity = positiveInteger(row?.quantity, "Allocated quantity");
                const unitCostPaise = line.direction === "INWARD" ? (Number.isSafeInteger(Number(row?.unitCostPaise)) ? Number(row.unitCostPaise) : mrpToPaise(row?.unitCost)) : null;
                if (line.direction === "INWARD" && (unitCostPaise == null || unitCostPaise < 0)) throw new DynamicMrpError("Enter the invoice rate per piece for each MRP line.", "DYNAMIC_MRP_INVOICE_RATE_REQUIRED");
                const prior = byMrp.get(mrpPaise) || { mrpPaise, quantity: 0, unitCostPaise };
                if (line.direction === "INWARD" && prior.unitCostPaise !== unitCostPaise) throw new DynamicMrpError("Split rows when invoice rates differ.", "DYNAMIC_MRP_COST_MISMATCH");
                prior.quantity += quantity;
                byMrp.set(mrpPaise, prior);
            }
            const allocations = [...byMrp.values()];
            const total = allocations.reduce((sum, row) => sum + row.quantity, 0);
            const remainingQuantity = Number(line.recognized_quantity) - Number(line.posted_quantity);
            if (total !== remainingQuantity) throw new DynamicMrpError(`MRP quantities must add up to ${remainingQuantity} unposted units for this barcode.`, "DYNAMIC_MRP_ALLOCATION_TOTAL_MISMATCH");
            const instant = now().toISOString();
            const productMaster = line.direction === "INWARD" ? await get("SELECT mrp FROM products WHERE id=?", [line.product_id]) : null;
            const referenceMrpPaise = productMaster?.mrp == null ? null : mrpToPaise(productMaster.mrp);
            const bucketRows = [];
            for (const row of allocations) {
                let bucket = await get("SELECT id,status FROM product_mrp_buckets WHERE product_id=? AND mrp_paise=?", [line.product_id, row.mrpPaise]);
                if (!bucket) {
                    const created = await run(`INSERT INTO product_mrp_buckets(product_id,mrp_paise,status,source,created_by,created_at)
                        VALUES(?,?,'ACTIVE','STOCK_MOVEMENT','MANAGER',?)`, [line.product_id,row.mrpPaise,instant]);
                    bucket = { id: created.lastID, status: "ACTIVE" };
                } else if (bucket.status === "CLOSED") {
                    await run("UPDATE product_mrp_buckets SET status='ACTIVE' WHERE id=?", [bucket.id]);
                }
                if (line.direction === "OUTWARD") {
                    const stock = await get("SELECT COALESCE(SUM(quantity),0) AS quantity FROM inventory_transactions WHERE mrp_bucket_id=?", [bucket.id]);
                    const reserved = await get(`SELECT COALESCE(SUM(a.quantity),0) AS quantity FROM stock_movement_mrp_allocations a
                        JOIN stock_movement_lines l ON l.id=a.movement_line_id JOIN stock_movements m ON m.id=l.movement_id
                        WHERE a.bucket_id=? AND a.posting_state='UNPOSTED' AND m.direction='OUTWARD' AND m.status='DRAFT' AND a.movement_line_id<>?`, [bucket.id,lineId]);
                    if (row.quantity > Number(stock?.quantity || 0) - Number(reserved?.quantity || 0)) throw new DynamicMrpError(`Not enough stock under MRP ₹${(row.mrpPaise/100).toFixed(2)}.`, "DYNAMIC_MRP_INSUFFICIENT_STOCK");
                }
                bucketRows.push({ ...row, bucketId: Number(bucket.id), referenceMrpPaise,
                    mrpChangeStatus: referenceMrpPaise == null ? null : row.mrpPaise === referenceMrpPaise ? "SAME" : "CHANGED" });
            }
            await run("DELETE FROM stock_movement_mrp_allocations WHERE movement_line_id=? AND posting_state='UNPOSTED'", [lineId]);
            for (const row of bucketRows) await run(`INSERT INTO stock_movement_mrp_allocations(movement_line_id,bucket_id,quantity,unit_cost_paise,cost_basis_status,posting_state,created_by,created_at,reference_mrp_paise,mrp_change_status)
                VALUES(?,?,?,? ,?,'UNPOSTED',?,?,?,?)`, [lineId,row.bucketId,row.quantity,row.unitCostPaise,line.direction === "INWARD" ? "CAPTURED" : "UNKNOWN",String(input.actor||"MANAGER"),instant,row.referenceMrpPaise,row.mrpChangeStatus]);
            await appendActivity(db,{category:"INVENTORY",action:"DYNAMIC_MRP_MOVEMENT_ALLOCATED",details:`${line.direction} ${line.barcode}; ${bucketRows.map(row=>`₹${(row.mrpPaise/100).toFixed(2)} × ${row.quantity}`).join(", ")}`,user_name:String(input.actor||"MANAGER"),status:"SUCCESS",entity_type:"STOCK_MOVEMENT",reference_no:String(movementId),change_data:{version:1,changes:[]}},now());
            return { movementId, lineId, direction: line.direction, allocations: bucketRows };
        }));
    }

    async function getMovementAllocations(movementId) {
        const id = positiveInteger(movementId, "Stock movement");
        return all(`SELECT a.id,a.movement_line_id,a.bucket_id,a.quantity,a.unit_cost_paise,a.cost_basis_status,a.posting_state,
            b.mrp_paise,l.barcode,a.reference_mrp_paise,a.mrp_change_status FROM stock_movement_mrp_allocations a JOIN product_mrp_buckets b ON b.id=a.bucket_id
            JOIN stock_movement_lines l ON l.id=a.movement_line_id WHERE l.movement_id=? ORDER BY l.id,b.mrp_paise`, [id]);
    }

    async function getReturnCostOptions(billItemId) {
        const id=positiveInteger(billItemId,"Bill item");
        const item=await get("SELECT id,mrp_bucket_id,qty,barcode FROM bill_items WHERE id=?",[id]);
        if(!item)throw new DynamicMrpError("Original bill item was not found.","DYNAMIC_MRP_BILL_ITEM_NOT_FOUND");
        if(!item.mrp_bucket_id)return {dynamicMrp:false,options:[]};
        const options=await all(`SELECT a.id AS sourceAllocationId,b.mrp_paise,ABS(a.quantity)-COALESCE((SELECT SUM(r.quantity) FROM stock_cost_allocations r WHERE r.source_allocation_id=a.id),0) AS availableQuantity,
            a.unit_cost_paise,a.cost_basis_status FROM stock_cost_allocations a JOIN stock_receipt_layers l ON l.id=a.layer_id
            JOIN product_mrp_buckets b ON b.id=l.bucket_id
            WHERE a.bill_item_id=? AND a.quantity<0 ORDER BY a.id`,[id]);
        return {dynamicMrp:true,billItemId:id,bucketId:Number(item.mrp_bucket_id),barcode:item.barcode,soldQuantity:Number(item.qty),options:options.filter(row=>Number(row.availableQuantity)>0).map(row=>({
            sourceAllocationId:Number(row.sourceAllocationId),mrpPaise:Number(row.mrp_paise),mrp:Number(row.mrp_paise)/100,
            availableQuantity:Number(row.availableQuantity),unitCostPaise:row.unit_cost_paise==null?null:Number(row.unit_cost_paise),costBasisStatus:row.cost_basis_status
        }))};
    }

    async function getInventoryExportRows() {
        const buckets = await all(`SELECT p.barcode,p.sku,p.product_name,b.mrp_paise/100.0 AS mrp,COALESCE(SUM(t.quantity),0) AS current_stock,b.status
            FROM product_mrp_buckets b JOIN products p ON p.id=b.product_id
            LEFT JOIN inventory_transactions t ON t.mrp_bucket_id=b.id
            GROUP BY b.id ORDER BY p.barcode,b.mrp_paise`);
        const unallocated = await all(`SELECT p.barcode,p.sku,p.product_name,NULL AS mrp,
                SUM(t.quantity) AS current_stock,'UNALLOCATED · PHYSICAL MRP COUNT REQUIRED' AS status
            FROM products p JOIN inventory_transactions t ON t.product_id=p.id AND t.mrp_bucket_id IS NULL
            WHERE EXISTS(SELECT 1 FROM product_mrp_buckets b WHERE b.product_id=p.id)
            GROUP BY p.id HAVING SUM(t.quantity)<>0 ORDER BY p.barcode`);
        return [...buckets, ...unallocated].sort((a, b) =>
            String(a.barcode || "").localeCompare(String(b.barcode || ""), "en", { numeric: true }) ||
            (a.mrp == null ? -1 : b.mrp == null ? 1 : Number(a.mrp) - Number(b.mrp)));
    }

    return { getBuckets, getBillingOptions, reconcileExistingStock, configureMovementAllocations, getMovementAllocations, getReturnCostOptions, getInventoryExportRows };
}

module.exports = { DynamicMrpError, createDynamicMrpService, mrpToPaise, canonicalAllocations };
