"use strict";

const { getBusinessDate } = require("./businessDate");

class StockInwardError extends Error {
    constructor(message, code = "STOCK_INWARD_INVALID") { super(message); this.name = "StockInwardError"; this.code = code; }
}
function integer(value, label, allowZero = false) {
    if (typeof value === "string" && !/^\d+$/.test(value.trim())) throw new StockInwardError(`${label} must be a positive whole number.`, "STOCK_INWARD_QUANTITY_INVALID");
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < (allowZero ? 0 : 1)) throw new StockInwardError(`${label} must be a positive whole number.`, "STOCK_INWARD_QUANTITY_INVALID");
    return n;
}
function dateOrNull(value) {
    if (!value) return null;
    const text = String(value).trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!m) throw new StockInwardError("Enter a valid Invoice Date.", "STOCK_INWARD_DATE_INVALID");
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) throw new StockInwardError("Enter a valid Invoice Date.", "STOCK_INWARD_DATE_INVALID");
    return text;
}
function normalizedInvoiceNumber(value) { return String(value || "").trim().toLocaleUpperCase("en-IN"); }
function numericBarcodeText(value) {
    if (typeof value !== "string") throw new StockInwardError("Barcode must contain numbers only.", "STOCK_INWARD_BARCODE_INVALID");
    const barcode = value.trim();
    if (!/^[0-9]+$/.test(barcode)) throw new StockInwardError("Barcode must contain numbers only.", "STOCK_INWARD_BARCODE_INVALID");
    return barcode;
}
function receivingHeader(input) {
    const supplierId = Number(input.supplierId || 0);
    const invoiceNumber = String(input.invoiceNumber || "").trim();
    const invoiceDate = dateOrNull(input.invoiceDate);
    const invoiceTotalQuantity = integer(input.invoiceTotalQuantity, "Invoice Total Qty");
    const reference = String(input.reference || "").trim();
    if (!Number.isSafeInteger(supplierId) || supplierId <= 0) throw new StockInwardError("Select a valid Supplier before scanning.", "STOCK_INWARD_HEADER_INCOMPLETE");
    if (!invoiceNumber) throw new StockInwardError("Enter the Invoice Number before scanning.", "STOCK_INWARD_HEADER_INCOMPLETE");
    if (!invoiceDate) throw new StockInwardError("Enter the Invoice Date before scanning.", "STOCK_INWARD_HEADER_INCOMPLETE");
    return { supplierId, invoiceNumber, invoiceDate, invoiceTotalQuantity, reference };
}

function createStockInwardService(database, options = {}) {
    const db = database;
    const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function (error) { error ? reject(error) : resolve({ lastID: this.lastID, changes: this.changes }); }));
    const get = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
    const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
    const now = options.now || (() => new Date());
    const storeResolver = options.getCurrentStore || (() => require("./storeIdentityService").getCurrentStore());
    const businessDate = options.getBusinessDate || getBusinessDate;
    const appendActivity = options.appendActivityInTransaction || ((conn, event, time) => require("./activityService").appendActivityInTransaction(conn, event, time));
    const resolveGrant = options.authorize || (() => true);
    let queue = Promise.resolve();
    function serialize(fn) { const task = queue.then(fn, fn); queue = task.catch(() => {}); return task; }
    async function transaction(fn) {
        await run("BEGIN IMMEDIATE TRANSACTION");
        try { const value = await fn(); await run("COMMIT"); return value; }
        catch (error) { await run("ROLLBACK").catch(() => {}); throw error; }
    }
    async function store() {
        const value = await storeResolver();
        if (!value || !Number.isSafeInteger(Number(value.id)) || value.status !== "ACTIVE") throw new StockInwardError("The active Store could not be resolved.", "STOCK_INWARD_STORE_INVALID");
        return { id: Number(value.id), storeCode: value.storeCode, storeName: value.storeName };
    }
    async function productForBarcode(barcode) {
        const rows = await all(`SELECT id,barcode,sku,product_name,brand,colour,size,mrp,active,variable_value
            FROM products WHERE TRIM(CAST(barcode AS TEXT))=? ORDER BY id LIMIT 2`, [String(barcode).trim()]);
        if (!rows.length) return { resolution: "NOT_FOUND" };
        if (rows.length > 1) return { resolution: "AMBIGUOUS" };
        return { resolution: "UNIQUE", product: rows[0] };
    }
    async function assertDraft(movementId) {
        const doc = await get("SELECT * FROM stock_movements WHERE id=? AND direction='INWARD'", [movementId]);
        if (!doc) throw new StockInwardError("Stock Inward document was not found.", "STOCK_INWARD_NOT_FOUND");
        if (!["DRAFT", "PENDING_MASTER", "PARTIALLY_POSTED"].includes(doc.status)) throw new StockInwardError("This Stock Inward can no longer be edited.", "STOCK_INWARD_NOT_EDITABLE");
        return doc;
    }
    async function readDocument(movementId) {
        const doc = await get("SELECT * FROM stock_movements WHERE id=? AND direction='INWARD'", [movementId]);
        if (!doc) return null;
        const lines = await all("SELECT * FROM stock_movement_lines WHERE movement_id=? ORDER BY id", [movementId]);
        const active = lines.filter(line => !line.discarded_at);
        const known = active.filter(line => line.product_state === "READY");
        const unresolved = active.filter(line => line.product_state === "PENDING_MASTER");
        const scannedQty = active.reduce((sum, line) => sum + Number(line.scanned_quantity), 0);
        const knownUnits = known.reduce((sum, line) => sum + Number(line.recognized_quantity), 0);
        const postedUnits = lines.reduce((sum, line) => sum + Number(line.posted_quantity), 0);
        let reconciliation = { state: "NO_INVOICE_QTY", difference: null, text: `SCANNED QTY ${scannedQty}` };
        if (doc.invoice_total_quantity != null) {
            const difference = Number(doc.invoice_total_quantity) - scannedQty;
            reconciliation = difference === 0 ? { state: "MATCHED", difference: 0, text: "MATCHED" }
                : difference > 0 ? { state: "SHORT", difference, text: `SHORT BY ${difference}` }
                    : { state: "OVER", difference: Math.abs(difference), text: `OVER BY ${Math.abs(difference)}` };
        }
        const meaningful = lines.length > 0 || doc.supplier_id != null || doc.supplier_invoice_id != null ||
            Boolean(String(doc.invoice_no || "").trim()) || Boolean(String(doc.reference_text || "").trim()) ||
            doc.invoice_date != null || doc.invoice_total_quantity != null;
        return { document: doc, lines, meaningful, summary: { knownSkus: known.length, knownUnits, unresolvedBarcodes: unresolved.length,
            unresolvedUnits: unresolved.reduce((sum, line) => sum + Number(line.scanned_quantity), 0), scannedQty,
            eligibleToPost: known.filter(line => line.posting_state === "UNPOSTED").reduce((sum, line) => sum + Number(line.recognized_quantity), 0),
            postedUnits, reconciliation } };
    }
    async function duplicateInvoiceRow(supplierId, invoiceNumber, excludeId = 0) {
        const normalized = normalizedInvoiceNumber(invoiceNumber);
        if (!supplierId || !normalized) return null;
        const activeStore = await store();
        const candidates = await all(`SELECT id,movement_no,status,invoice_number_snapshot,invoice_no FROM stock_movements
            WHERE direction='INWARD' AND (store_id=? OR (store_id IS NULL AND (SELECT COUNT(*) FROM stores)=1)) AND supplier_id=? AND status IN ('DRAFT','PENDING_MASTER','PARTIALLY_POSTED','COMPLETE')
              AND archived_at IS NULL AND id<>?
            ORDER BY CASE WHEN status='COMPLETE' THEN 1 ELSE 0 END,COALESCE(posted_at,updated_at) DESC`, [activeStore.id,supplierId, excludeId]);
        return candidates.find(row => normalizedInvoiceNumber(row.invoice_number_snapshot || row.invoice_no) === normalized) || null;
    }
    async function findDuplicateInvoice(input = {}) {
        return serialize(async () => {
            const supplierId = Number(input.supplierId || 0), normalized = normalizedInvoiceNumber(input.invoiceNumber);
            if (!Number.isSafeInteger(supplierId) || supplierId <= 0 || !normalized) return { duplicate:false };
            const candidate = await duplicateInvoiceRow(supplierId,input.invoiceNumber,input.excludeMovementId || 0);
            if (!candidate) return { duplicate:false };
            const detail = await readDocument(candidate.id);
            if (!detail) return { duplicate:false };
            const currentMaster = detail.summary.unresolvedBarcodes ? await currentMasterForUnresolved(candidate.id) : [];
            const nowFound = currentMaster.filter(line=>line.currentResolution === "UNIQUE").length;
            return { duplicate:true,kind:detail.document.status === "DRAFT" ? "ACTIVE" : "RECEIVED",...detail,
                currentMasterSummary:{checked:currentMaster.length,nowFound,stillUnresolved:currentMaster.length-nowFound},currentMaster };
        });
    }
    async function createDraft(input = {}, actor = "USER") {
        return serialize(() => transaction(async () => {
            const activeStore = await store();
            let supplier = null, invoice = null;
            if (input.supplierId) {
                supplier = await get("SELECT id,supplier_code,name,status FROM supplier_master WHERE id=?", [input.supplierId]);
                if (!supplier) throw new StockInwardError("Selected Supplier was not found.", "STOCK_INWARD_SUPPLIER_INVALID");
            }
            if (input.supplierInvoiceId) {
                invoice = await get("SELECT id,invoice_code,store_id,supplier_id,supplier_invoice_number,supplier_invoice_date,status FROM supplier_invoices WHERE id=?", [input.supplierInvoiceId]);
                if (!invoice || invoice.status !== "POSTED" || Number(invoice.store_id) !== activeStore.id || (supplier && Number(invoice.supplier_id) !== Number(supplier.id))) throw new StockInwardError("Supplier Invoice must belong to the selected Supplier and current Store.", "STOCK_INWARD_INVOICE_MISMATCH");
                if (!supplier) supplier = await get("SELECT id,supplier_code,name,status FROM supplier_master WHERE id=?", [invoice.supplier_id]);
            }
            const seq = await get("SELECT next_movement_number FROM stock_movement_sequences WHERE id=1");
            if (!seq || !Number.isSafeInteger(Number(seq.next_movement_number))) throw new StockInwardError("Stock Inward number sequence is unavailable.", "STOCK_INWARD_SEQUENCE_INVALID");
            const number = Number(seq.next_movement_number);
            if (number > 999999) throw new StockInwardError("Stock Inward document number sequence is exhausted.", "STOCK_INWARD_SEQUENCE_EXHAUSTED");
            await run("UPDATE stock_movement_sequences SET next_movement_number=? WHERE id=1 AND next_movement_number=?", [number + 1, number]);
            const code = `KLINW${String(number).padStart(6, "0")}`;
            const instant = now().toISOString();
            const invoiceNo = String(input.invoiceNumber || input.invoiceNo || invoice?.supplier_invoice_number || "").trim() || null;
            const invoiceDate = dateOrNull(input.invoiceDate);
            const invoiceQty = input.invoiceTotalQuantity == null || String(input.invoiceTotalQuantity).trim() === "" ? null : integer(input.invoiceTotalQuantity, "Invoice Total Qty");
            if (supplier && invoiceNo) {
                const duplicate = await duplicateInvoiceRow(supplier.id,invoiceNo,0);
                if (duplicate) throw new StockInwardError(`Invoice ${invoiceNo} is already assigned to ${duplicate.movement_no}.`, "STOCK_INWARD_DUPLICATE_INVOICE");
            }
            const empty = await get(`SELECT m.id,m.movement_no FROM stock_movements m
                WHERE m.direction='INWARD' AND m.store_id=? AND m.status='DRAFT' AND m.archived_at IS NULL
                  AND m.supplier_id IS NULL AND m.supplier_invoice_id IS NULL
                  AND NULLIF(TRIM(COALESCE(m.invoice_no,'')),'') IS NULL
                  AND NULLIF(TRIM(COALESCE(m.reference_text,'')),'') IS NULL
                  AND m.invoice_date IS NULL AND m.invoice_total_quantity IS NULL
                  AND NOT EXISTS (SELECT 1 FROM stock_movement_lines l WHERE l.movement_id=m.id)
                ORDER BY m.created_at,m.id LIMIT 1`, [activeStore.id]);
            if (empty) {
                await run(`UPDATE stock_movements SET supplier_id=?,supplier_name=?,supplier_code_snapshot=?,supplier_invoice_id=?,supplier_invoice_code_snapshot=?,invoice_no=?,invoice_number_snapshot=?,reference_text=?,invoice_date=?,invoice_total_quantity=?,updated_at=? WHERE id=? AND status='DRAFT'`,
                    [supplier?.id || null,supplier?.name || null,supplier?.supplier_code || null,invoice?.id || null,invoice?.invoice_code || null,invoiceNo,invoiceNo,String(input.reference || "").trim() || null,invoiceDate,invoiceQty,now().toISOString(),empty.id]);
                return {movementId:empty.id,movementNo:empty.movement_no,reusedEmptyReservation:true};
            }
            const inserted = await run(`INSERT INTO stock_movements(
                movement_no,direction,status,supplier_id,supplier_name,supplier_code_snapshot,supplier_invoice_id,
                supplier_invoice_code_snapshot,invoice_no,invoice_number_snapshot,reference_text,invoice_date,invoice_total_quantity,
                store_id,store_code_snapshot,store_name_snapshot,business_date,idempotency_key,created_by,created_at,updated_at
            ) VALUES(?, 'INWARD','DRAFT',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [code,supplier?.id || null,supplier?.name || null,supplier?.supplier_code || null,
                invoice?.id || null,invoice?.invoice_code || null,invoiceNo,invoiceNo,String(input.reference || "").trim() || null,invoiceDate,invoiceQty,
                activeStore.id,activeStore.storeCode,activeStore.storeName,businessDate(now()),`STOCK_INWARD:${code}`,actor,instant,instant]);
            return { movementId: inserted.lastID, movementNo: code };
        }));
    }
    async function updateContext(input = {}) {
        return serialize(() => transaction(async () => {
            const doc = await assertDraft(input.movementId);
            const acceptedLines = await get("SELECT COUNT(*) AS count FROM stock_movement_lines WHERE movement_id=?", [doc.id]);
            const hasPostedLine = await get("SELECT 1 AS found FROM stock_movement_lines WHERE movement_id=? AND posting_state='POSTED' LIMIT 1", [doc.id]);
            const supplierId = input.supplierId || null;
            const supplier = supplierId ? await get("SELECT id,supplier_code,name FROM supplier_master WHERE id=?", [supplierId]) : null;
            if (supplierId && !supplier) throw new StockInwardError("Selected Supplier was not found.", "STOCK_INWARD_SUPPLIER_INVALID");
            const invoice = input.supplierInvoiceId ? await get("SELECT id,invoice_code,store_id,supplier_id,supplier_invoice_number,status FROM supplier_invoices WHERE id=?", [input.supplierInvoiceId]) : null;
            if (input.supplierInvoiceId && (!invoice || invoice.status !== "POSTED" || Number(invoice.store_id) !== Number(doc.store_id) || Number(invoice.supplier_id) !== Number(supplierId))) throw new StockInwardError("Supplier Invoice must belong to the selected Supplier and current Store.", "STOCK_INWARD_INVOICE_MISMATCH");
            const invoiceQty = input.invoiceTotalQuantity == null || String(input.invoiceTotalQuantity).trim() === "" ? null : integer(input.invoiceTotalQuantity, "Invoice Total Qty");
            const invoiceNumber = String(input.invoiceNumber || "").trim() || invoice?.supplier_invoice_number || null;
            const invoiceDate = dateOrNull(input.invoiceDate);
            const reference = String(input.reference || "").trim() || null;
            const duplicate = await duplicateInvoiceRow(supplierId, invoiceNumber, doc.id);
            if (duplicate) {
                const detail = await readDocument(duplicate.id);
                return { ...await readDocument(doc.id), invoiceDuplicate:{ kind:["DRAFT","PENDING_MASTER"].includes(detail.document.status) ? "ACTIVE" : "RECEIVED", ...detail } };
            }
            if (Number(acceptedLines?.count || 0) > 0 && (
                Number(doc.supplier_id || 0) !== Number(supplierId || 0) ||
                Number(doc.supplier_invoice_id || 0) !== Number(input.supplierInvoiceId || 0) ||
                (doc.invoice_number_snapshot || null) !== invoiceNumber || (doc.invoice_date || null) !== invoiceDate
            )) throw new StockInwardError("Supplier and invoice identity are locked after the first accepted scan.", "STOCK_INWARD_IDENTITY_LOCKED");
            if (doc.posted_at || hasPostedLine || !["DRAFT","PENDING_MASTER"].includes(doc.status)) {
                const unchanged = Number(doc.supplier_id || 0) === Number(supplierId || 0) && Number(doc.supplier_invoice_id || 0) === Number(input.supplierInvoiceId || 0) &&
                    (doc.invoice_number_snapshot || null) === invoiceNumber && (doc.invoice_date || null) === invoiceDate &&
                    (doc.invoice_total_quantity ?? null) === invoiceQty && (doc.reference_text || null) === reference;
                if (!unchanged) throw new StockInwardError("Document details are locked after posting begins.", "STOCK_INWARD_CONTEXT_LOCKED");
                return readDocument(doc.id);
            }
            const linkedElsewhere = invoice ? await get("SELECT COUNT(*) AS count FROM stock_movements WHERE supplier_invoice_id=? AND id<>? AND status<>'CANCELLED'", [invoice.id,doc.id]) : null;
            await run(`UPDATE stock_movements SET supplier_id=?,supplier_name=?,supplier_code_snapshot=?,supplier_invoice_id=?,supplier_invoice_code_snapshot=?,invoice_no=?,invoice_number_snapshot=?,reference_text=?,invoice_date=?,invoice_total_quantity=?,updated_at=? WHERE id=?`,
                [supplier?.id || null,supplier?.name || null,supplier?.supplier_code || null,invoice?.id || null,invoice?.invoice_code || null,
                    invoiceNumber,invoiceNumber,reference,invoiceDate,invoiceQty,now().toISOString(),doc.id]);
            const result = await readDocument(doc.id);
            result.splitDeliveryWarning = Number(linkedElsewhere?.count || 0) > 0;
            return result;
        }));
    }
    async function scan(input = {}) {
        const barcode = numericBarcodeText(input.barcode);
        const scanQuantity = integer(input.quantity == null ? 1 : input.quantity, "Quantity");
        return serialize(() => transaction(async () => {
            const doc = await assertDraft(input.movementId);
            const header = receivingHeader({ supplierId:doc.supplier_id,invoiceNumber:doc.invoice_number_snapshot || doc.invoice_no,invoiceDate:doc.invoice_date,invoiceTotalQuantity:doc.invoice_total_quantity,reference:doc.reference_text });
            const duplicate = await duplicateInvoiceRow(header.supplierId,header.invoiceNumber,doc.id);
            if (duplicate) throw new StockInwardError(`Invoice ${header.invoiceNumber} is already assigned to ${duplicate.movement_no}.`, "STOCK_INWARD_DUPLICATE_INVOICE");
            const instant = now().toISOString();
            const found = await productForBarcode(barcode);
            const old = await get("SELECT * FROM stock_movement_lines WHERE movement_id=? AND barcode=?", [doc.id,barcode]);
            if (old?.discarded_at) throw new StockInwardError("This barcode was discarded. Retry matching or start a new line after review.", "STOCK_INWARD_LINE_DISCARDED");
            if (old?.posting_state === "POSTED") throw new StockInwardError("This barcode line is already posted. Start a new Stock Inward for additional units.", "STOCK_INWARD_LINE_POSTED");
            const quantity = old ? integer(old.scanned_quantity, "Quantity") + scanQuantity : scanQuantity;
            if (!Number.isSafeInteger(quantity)) throw new StockInwardError("Quantity is too large.", "STOCK_INWARD_QUANTITY_INVALID");
            const product = found.product;
            const state = product ? "READY" : "PENDING_MASTER";
            const note = found.resolution === "AMBIGUOUS" ? "AMBIGUOUS BARCODE" : found.resolution === "NOT_FOUND" ? "PRODUCT NOT FOUND" : product?.active === 0 ? "PRODUCT IS INACTIVE" : null;
            if (old) {
                await run(`UPDATE stock_movement_lines SET scanned_quantity=?,recognized_quantity=?,product_id=?,product_state=?,posting_state='UNPOSTED',posted_quantity=0,inventory_transaction_id=NULL,sku_snapshot=?,product_name_snapshot=?,colour_snapshot=?,size_snapshot=?,resolution_note=?,updated_at=? WHERE id=?`,
                    [quantity,product ? quantity : 0,product?.id || null,state,product?.sku || null,product?.product_name || null,product?.colour || null,product?.size || null,note,instant,old.id]);
            } else {
                await run(`INSERT INTO stock_movement_lines(movement_id,barcode,scanned_quantity,recognized_quantity,product_id,product_state,sku_snapshot,product_name_snapshot,colour_snapshot,size_snapshot,resolution_note,created_at,updated_at)
                    VALUES(?,?,?, ?,?,?, ?,?,?,?,?,?,?)`, [doc.id,barcode,scanQuantity,product ? scanQuantity : 0,product?.id || null,state,product?.sku || null,product?.product_name || null,product?.colour || null,product?.size || null,note,instant,instant]);
            }
            if (doc.status !== "PARTIALLY_POSTED") await run("UPDATE stock_movements SET status=?,updated_at=? WHERE id=?", [product ? "DRAFT" : "PENDING_MASTER",instant,doc.id]);
            const result = await readDocument(doc.id);
            result.lastResolution = found.resolution;
            return result;
        }));
    }
    async function resolveBarcode(barcodeInput) {
        const barcode = numericBarcodeText(barcodeInput);
        return serialize(async () => {
            const found = await productForBarcode(barcode);
            if (!found.product) return { resolution: found.resolution, product: null };
            const p = found.product;
            return { resolution: "UNIQUE", product: { id: p.id, barcode: p.barcode, sku: p.sku, product_name: p.product_name, variable_value: Number(p.variable_value) === 1 ? 1 : 0, active: p.active } };
        });
    }
    async function editLine(input = {}) {
        const qty = integer(input.quantity, "Quantity");
        return serialize(() => transaction(async () => {
            const doc = await assertDraft(input.movementId);
            const line = await get("SELECT * FROM stock_movement_lines WHERE id=? AND movement_id=?", [input.lineId,doc.id]);
            if (!line || line.posting_state === "POSTED" || line.discarded_at) throw new StockInwardError("This line can no longer be changed.", "STOCK_INWARD_LINE_LOCKED");
            await run("UPDATE stock_movement_lines SET scanned_quantity=?,recognized_quantity=?,posted_quantity=0,updated_at=? WHERE id=?", [qty,line.product_state === "READY" ? qty : 0,now().toISOString(),line.id]);
            return readDocument(doc.id);
        }));
    }
    async function removeLine(input = {}) {
        return serialize(() => transaction(async () => {
            const doc = await assertDraft(input.movementId);
            const line = await get("SELECT * FROM stock_movement_lines WHERE id=? AND movement_id=?", [input.lineId,doc.id]);
            if (!line || line.posting_state === "POSTED") throw new StockInwardError("Posted lines cannot be removed.", "STOCK_INWARD_LINE_LOCKED");
            await run("DELETE FROM stock_movement_lines WHERE id=?", [line.id]);
            return readDocument(doc.id);
        }));
    }
    async function retryMatching(movementId) {
        return serialize(() => transaction(async () => {
            const doc = await assertDraft(movementId);
            const lines = await all("SELECT * FROM stock_movement_lines WHERE movement_id=? AND product_state='PENDING_MASTER' AND discarded_at IS NULL ORDER BY id", [doc.id]);
            for (const line of lines) {
                const found = await productForBarcode(line.barcode);
                if (found.product) await run(`UPDATE stock_movement_lines SET product_id=?,product_state='READY',recognized_quantity=scanned_quantity,sku_snapshot=?,product_name_snapshot=?,colour_snapshot=?,size_snapshot=?,resolution_note=NULL,updated_at=? WHERE id=?`,
                    [found.product.id,found.product.sku || null,found.product.product_name || null,found.product.colour || null,found.product.size || null,now().toISOString(),line.id]);
                else await run("UPDATE stock_movement_lines SET resolution_note=?,updated_at=? WHERE id=?", [found.resolution === "AMBIGUOUS" ? "AMBIGUOUS BARCODE" : "PRODUCT NOT FOUND",now().toISOString(),line.id]);
            }
            const remaining = await get("SELECT COUNT(*) AS count FROM stock_movement_lines WHERE movement_id=? AND product_state='PENDING_MASTER' AND discarded_at IS NULL", [doc.id]);
            const posted = await get("SELECT COUNT(*) AS count FROM stock_movement_lines WHERE movement_id=? AND posting_state='POSTED'", [doc.id]);
            const unpostedReady = await get("SELECT COUNT(*) AS count FROM stock_movement_lines WHERE movement_id=? AND product_state='READY' AND posting_state='UNPOSTED' AND discarded_at IS NULL",[doc.id]);
            const hasPending = Number(remaining?.count) + Number(unpostedReady?.count) > 0;
            const status = hasPending ? (Number(posted?.count) ? "PARTIALLY_POSTED" : "PENDING_MASTER") : (Number(posted?.count) ? "COMPLETE" : "DRAFT");
            await run("UPDATE stock_movements SET status=?,updated_at=? WHERE id=?", [status,now().toISOString(),doc.id]);
            return readDocument(doc.id);
        }));
    }
    async function discardLine(input = {}) {
        resolveGrant(input.authorizationGrant, "INVENTORY_INWARD");
        const reason = String(input.reason || "").trim();
        if (!reason || reason.length > 500) throw new StockInwardError("Enter a reason to discard this unresolved barcode.", "STOCK_INWARD_DISCARD_REASON_REQUIRED");
        return serialize(() => transaction(async () => {
            const doc = await assertDraft(input.movementId);
            const line = await get("SELECT * FROM stock_movement_lines WHERE id=? AND movement_id=?", [input.lineId,doc.id]);
            if (!line || line.product_state !== "PENDING_MASTER" || line.posting_state !== "UNPOSTED" || line.discarded_at) throw new StockInwardError("Only unresolved, unposted lines can be discarded.", "STOCK_INWARD_DISCARD_NOT_ALLOWED");
            const instant = now().toISOString();
            await run("UPDATE stock_movement_lines SET discard_reason=?,discarded_by=?,discarded_at=?,updated_at=? WHERE id=?", [reason,input.actor || "MANAGER",instant,instant,line.id]);
            await appendActivity(db, { category:"INVENTORY",action:"STOCK_INWARD_BARCODE_DISCARDED",details:`${doc.movement_no}: ${line.barcode} × ${line.scanned_quantity}; ${reason}`,user_name:input.actor || "MANAGER",status:"SUCCESS",entity_type:"STOCK_INWARD_LINE",reference_no:doc.movement_no,change_data:{version:1,changes:[{field:"barcode",label:"Barcode",old:null,new:line.barcode},{field:"quantity",label:"Scanned quantity",old:null,new:String(line.scanned_quantity)},{field:"reason",label:"Discard reason",old:null,new:reason}]} }, now());
            const activeUnresolved=await get("SELECT COUNT(*) AS n FROM stock_movement_lines WHERE movement_id=? AND product_state='PENDING_MASTER' AND discarded_at IS NULL",[doc.id]);
            const activeUnposted=await get("SELECT COUNT(*) AS n FROM stock_movement_lines WHERE movement_id=? AND product_state='READY' AND posting_state='UNPOSTED' AND discarded_at IS NULL",[doc.id]);
            const posted=await get("SELECT COUNT(*) AS n FROM stock_movement_lines WHERE movement_id=? AND posting_state='POSTED'",[doc.id]);
            const nextStatus=Number(activeUnresolved.n)+Number(activeUnposted.n)>0?(Number(posted.n)?"PARTIALLY_POSTED":"PENDING_MASTER"):(Number(posted.n)?"COMPLETE":"DRAFT");
            await run("UPDATE stock_movements SET status=?,updated_at=? WHERE id=?",[nextStatus,instant,doc.id]);
            return readDocument(doc.id);
        }));
    }
    async function cancelDraft(movementId, actor = "USER") {
        return serialize(() => transaction(async () => {
            const doc = await get("SELECT * FROM stock_movements WHERE id=? AND direction='INWARD'", [movementId]);
            if (!doc || ["COMPLETE","CANCELLED","PARTIALLY_POSTED"].includes(doc.status)) throw new StockInwardError("Only a wholly unposted draft can be cancelled.", "STOCK_INWARD_CANCEL_NOT_ALLOWED");
            const posted = await get("SELECT COUNT(*) AS count FROM stock_movement_lines WHERE movement_id=? AND posting_state='POSTED'", [doc.id]);
            if (Number(posted?.count)) throw new StockInwardError("A document with posted stock cannot be cancelled.", "STOCK_INWARD_CANCEL_NOT_ALLOWED");
            const lines = await get("SELECT COUNT(*) AS count FROM stock_movement_lines WHERE movement_id=?", [doc.id]);
            const meaningful = Number(lines?.count) > 0 || doc.supplier_id != null || doc.supplier_invoice_id != null ||
                Boolean(String(doc.invoice_no || "").trim()) || Boolean(String(doc.reference_text || "").trim()) ||
                doc.invoice_date != null || doc.invoice_total_quantity != null;
            if (!meaningful) {
                return { success:true, empty:true, historyExcluded:true };
            }
            await run("UPDATE stock_movements SET status='CANCELLED',cancelled_by=?,cancelled_at=?,cancel_reason='Draft cancelled',updated_at=? WHERE id=?", [actor,now().toISOString(),now().toISOString(),doc.id]);
            return { success:true };
        }));
    }
    async function listResumable() {
        const meaningful = `(
            supplier_id IS NOT NULL OR supplier_invoice_id IS NOT NULL OR
            NULLIF(TRIM(COALESCE(invoice_no,'')),'') IS NOT NULL OR
            NULLIF(TRIM(COALESCE(reference_text,'')),'') IS NOT NULL OR invoice_date IS NOT NULL OR invoice_total_quantity IS NOT NULL OR
            EXISTS (SELECT 1 FROM stock_movement_lines l WHERE l.movement_id=stock_movements.id)
        )`;
        const activeStore = await store();
        return all(`SELECT id,movement_no,status,business_date,supplier_name,invoice_no,updated_at,
            (SELECT COUNT(*) FROM stock_movement_lines l WHERE l.movement_id=stock_movements.id AND l.product_state='READY') AS sku_count,
            (SELECT COALESCE(SUM(CASE WHEN l.discarded_at IS NULL THEN l.scanned_quantity ELSE 0 END),0) FROM stock_movement_lines l WHERE l.movement_id=stock_movements.id) AS units,
            (SELECT COALESCE(SUM(l.posted_quantity),0) FROM stock_movement_lines l WHERE l.movement_id=stock_movements.id) AS posted_units,
            (SELECT COUNT(*) FROM stock_movement_lines l WHERE l.movement_id=stock_movements.id AND l.product_state='PENDING_MASTER' AND l.discarded_at IS NULL) AS unresolved_count
            FROM stock_movements WHERE direction='INWARD' AND store_id=? AND status IN ('DRAFT','PENDING_MASTER','PARTIALLY_POSTED') AND ${meaningful}
            ORDER BY updated_at DESC,id DESC`, [activeStore.id]);
    }
    async function listRecentHistory(input = {}) {
        const activeStore = await store();
        const requestedPage = Number.isSafeInteger(Number(input.page)) ? Number(input.page) : 1;
        const pageSize = 100;
        const keyword = String(input.keyword || "").trim().slice(0, 200);
        const search = `%${keyword}%`;
        const meaningful = `(
            m.supplier_id IS NOT NULL OR m.supplier_invoice_id IS NOT NULL OR NULLIF(TRIM(COALESCE(m.invoice_no,'')),'') IS NOT NULL OR
            NULLIF(TRIM(COALESCE(m.reference_text,'')),'') IS NOT NULL OR m.invoice_date IS NOT NULL OR m.invoice_total_quantity IS NOT NULL OR
            EXISTS (SELECT 1 FROM stock_movement_lines l WHERE l.movement_id=m.id)
        )`;
        const filtered = `m.direction='INWARD' AND m.store_id=? AND m.status IN ('COMPLETE','CANCELLED') AND m.archived_at IS NULL AND ${meaningful}
            AND (?='' OR LOWER(m.movement_no) LIKE LOWER(?) OR LOWER(COALESCE(m.supplier_name,'')) LIKE LOWER(?) OR
                 LOWER(COALESCE(m.supplier_code_snapshot,'')) LIKE LOWER(?) OR LOWER(COALESCE(m.invoice_number_snapshot,m.invoice_no,'')) LIKE LOWER(?))`;
        const params = [activeStore.id,keyword,search,search,search,search];
        const count = await get(`SELECT COUNT(*) AS total FROM stock_movements m WHERE ${filtered}`, params);
        const totalCount = Number(count?.total) || 0;
        const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
        const page = Math.min(Math.max(requestedPage, 1), totalPages);
        const rows = await all(`SELECT m.id,m.movement_no,m.status,m.business_date,m.supplier_name,m.supplier_code_snapshot,
                COALESCE(m.invoice_number_snapshot,m.invoice_no) AS invoice_no,m.posted_at,m.updated_at,
                (SELECT COALESCE(SUM(l.posted_quantity),0) FROM stock_movement_lines l WHERE l.movement_id=m.id) AS posted_units
            FROM stock_movements m WHERE ${filtered}
            ORDER BY COALESCE(m.posted_at,m.updated_at) DESC,m.id DESC LIMIT ? OFFSET ?`,
            [...params,pageSize,(page-1)*pageSize]);
        return { rows,totalCount,page,totalPages,pageSize };
    }
    async function abandonEmptyDraft(movementId) {
        return serialize(() => transaction(async () => {
            const doc = await get("SELECT * FROM stock_movements WHERE id=? AND direction='INWARD'", [movementId]);
            if (!doc || !["DRAFT","PENDING_MASTER"].includes(doc.status) || doc.posted_at) return { removed:false };
            const lines = await get("SELECT COUNT(*) AS count FROM stock_movement_lines WHERE movement_id=?", [doc.id]);
            const meaningful = Number(lines?.count) > 0 || doc.supplier_id != null || doc.supplier_invoice_id != null ||
                Boolean(String(doc.invoice_no || "").trim()) || Boolean(String(doc.reference_text || "").trim()) ||
                doc.invoice_date != null || doc.invoice_total_quantity != null;
            if (meaningful) return { removed:false };
            // V14 deliberately prevents deleting movement documents. Keep the
            // untouched row as DRAFT; list queries exclude it from all UI history.
            return { removed:false, historyExcluded:true };
        }));
    }
    async function load(movementId) { return readDocument(movementId); }
    async function post(input = {}) {
        resolveGrant(input.authorizationGrant, "INVENTORY_INWARD");
        return serialize(() => transaction(async () => {
            const doc = await get("SELECT * FROM stock_movements WHERE id=? AND direction='INWARD'", [input.movementId]);
            if (!doc || !["DRAFT","PENDING_MASTER","PARTIALLY_POSTED"].includes(doc.status)) throw new StockInwardError("Stock Inward is already posted or cannot be posted.", "STOCK_INWARD_ALREADY_POSTED");
            const header = receivingHeader({ supplierId:doc.supplier_id,invoiceNumber:doc.invoice_number_snapshot || doc.invoice_no,invoiceDate:doc.invoice_date,invoiceTotalQuantity:doc.invoice_total_quantity,reference:doc.reference_text });
            const duplicate = await duplicateInvoiceRow(header.supplierId,header.invoiceNumber,doc.id);
            if (duplicate) throw new StockInwardError(`Invoice ${header.invoiceNumber} was already received as ${duplicate.movement_no}.`, "STOCK_INWARD_DUPLICATE_INVOICE");
            const activeStore = await store();
            if (doc.store_id != null && Number(doc.store_id) !== activeStore.id) throw new StockInwardError("Stock Inward belongs to a different Store.", "STOCK_INWARD_STORE_MISMATCH");
            if (doc.supplier_invoice_id) {
                const invoice = await get("SELECT id,store_id,supplier_id,status FROM supplier_invoices WHERE id=?", [doc.supplier_invoice_id]);
                if (!invoice || invoice.status !== "POSTED" || Number(invoice.store_id) !== activeStore.id || Number(invoice.supplier_id) !== Number(doc.supplier_id)) throw new StockInwardError("Linked Supplier Invoice no longer matches this Supplier and Store.", "STOCK_INWARD_INVOICE_MISMATCH");
            }
            const lines = await all("SELECT * FROM stock_movement_lines WHERE movement_id=? ORDER BY id", [doc.id]);
            const eligible = lines.filter(line => line.product_state === "READY" && line.posting_state === "UNPOSTED" && !line.discarded_at);
            if (!eligible.length) {
                const unresolved = lines.some(line => line.product_state === "PENDING_MASTER" && !line.discarded_at);
                if (unresolved) {
                    const priorPosting = lines.some(line => line.posting_state === "POSTED");
                    const pendingStatus = priorPosting ? "PARTIALLY_POSTED" : "PENDING_MASTER";
                    await run("UPDATE stock_movements SET status=?,updated_at=? WHERE id=?", [pendingStatus,now().toISOString(),doc.id]);
                    return { ...await readDocument(doc.id), posted:false, pendingMaster:true };
                }
                const priorPosting = lines.some(line => line.posting_state === "POSTED");
                if (priorPosting) {
                    await run("UPDATE stock_movements SET status='COMPLETE',updated_at=? WHERE id=?", [now().toISOString(),doc.id]);
                    return { ...await readDocument(doc.id), posted:false, completed:true };
                }
                throw new StockInwardError("There are no recognized items ready to post.", "STOCK_INWARD_NO_ELIGIBLE_LINES");
            }
            const instant = now().toISOString();
            for (const line of eligible) {
                const qty = integer(line.recognized_quantity, "Recognized quantity");
                const insert = await run(`INSERT INTO inventory_transactions(product_id,barcode,transaction_type,quantity,reference_type,reference_id,supplier_id,invoice_no,remarks,created_by,created_at)
                    VALUES(?,?,'INWARD',?,'STOCK_INWARD',?,?,?,?,?,?)`, [line.product_id,line.barcode,qty,doc.movement_no,doc.supplier_id,doc.invoice_no,`Stock Inward ${doc.movement_no}`,input.actor || "MANAGER",instant]);
                await run("UPDATE stock_movement_lines SET posting_state='POSTED',posted_quantity=?,inventory_transaction_id=?,updated_at=? WHERE id=?", [qty,insert.lastID,instant,line.id]);
            }
            const unresolved = lines.some(line => line.product_state === "PENDING_MASTER" && !line.discarded_at);
            const status = unresolved ? "PARTIALLY_POSTED" : "COMPLETE";
            const postedUnits = eligible.reduce((sum, line) => sum + Number(line.recognized_quantity), 0);
            const previouslyPostedUnits = lines.filter(line => line.posting_state === "POSTED").reduce((sum, line) => sum + Number(line.posted_quantity), 0);
            const snapshot = await readDocument(doc.id);
            // posted_at / posted_by are first-post identity snapshots. The
            // database immutability trigger intentionally freezes them once
            // the first batch posts, while PARTIALLY_POSTED documents may
            // still receive later eligible lines. Only the first posting
            // writes these fields; incremental batches update lifecycle state.
            if (doc.posted_at == null) {
                await run("UPDATE stock_movements SET status=?,posted_by=?,posted_at=?,updated_at=? WHERE id=?", [status,input.actor || "MANAGER",instant,instant,doc.id]);
            } else {
                await run("UPDATE stock_movements SET status=?,updated_at=? WHERE id=?", [status,instant,doc.id]);
            }
            const unresolvedUnits = lines.filter(line => line.product_state === "PENDING_MASTER" && !line.discarded_at).reduce((sum,line) => sum + Number(line.scanned_quantity),0);
            await appendActivity(db, { category:"INVENTORY",action:"STOCK_INWARD_POSTED",details:`${doc.movement_no}; Store ${doc.store_code_snapshot || doc.store_id}; Supplier ${doc.supplier_name || "None"}; Invoice ${doc.invoice_no || "None"}; Invoice Qty ${doc.invoice_total_quantity ?? "Not entered"}; Scanned ${snapshot.summary.scannedQty}; Posted this attempt ${postedUnits}; Posted total ${previouslyPostedUnits + postedUnits}; Unresolved ${unresolvedUnits}; ${eligible.length} SKU(s); status ${status}; reconciliation ${snapshot.summary.reconciliation.text}`,user_name:input.actor || "MANAGER",status:"SUCCESS",entity_type:"STOCK_INWARD",reference_no:doc.movement_no,change_data:{version:1,changes:[{field:"status",label:"Stock Inward status",old:doc.status,new:status},{field:"quantity",label:"Total units posted",old:String(previouslyPostedUnits),new:String(previouslyPostedUnits + postedUnits)}]} }, now());
            return { ...await readDocument(doc.id),posted:true,postedLineIds:eligible.map(line=>Number(line.id)) };
        }));
    }
    async function getUnknownExportRows(movementId) {
        return all(`SELECT m.movement_no,m.business_date,m.store_code_snapshot,m.supplier_code_snapshot,m.supplier_name,m.supplier_invoice_code_snapshot,m.invoice_no,m.invoice_date,m.invoice_total_quantity,l.barcode,l.scanned_quantity,l.resolution_note,m.created_at,m.status
          FROM stock_movements m JOIN stock_movement_lines l ON l.movement_id=m.id
          WHERE m.id=? AND l.product_state='PENDING_MASTER' AND l.discarded_at IS NULL ORDER BY l.id`, [movementId]);
    }
    async function currentMasterForUnresolved(movementId) {
        const lines = await all(`SELECT id,barcode,scanned_quantity AS quantity,product_state,posting_state,resolution_note
            FROM stock_movement_lines WHERE movement_id=? AND product_state='PENDING_MASTER' AND discarded_at IS NULL ORDER BY id`, [movementId]);
        const results = [];
        for (const line of lines) {
            const found = await productForBarcode(line.barcode);
            results.push({ ...line,currentResolution:found.resolution,
                currentProduct:found.product ? {id:found.product.id,sku:found.product.sku,product_name:found.product.product_name,colour:found.product.colour,size:found.product.size} : null });
        }
        return results;
    }
    async function archiveCancelled(movementId, actor = "MANAGER") {
        return serialize(() => transaction(async () => {
            const doc = await get("SELECT * FROM stock_movements WHERE id=? AND direction='INWARD'", [movementId]);
            if (!doc || doc.status !== "CANCELLED") throw new StockInwardError("Only cancelled Stock Inwards can be removed from Recent.", "STOCK_INWARD_ARCHIVE_NOT_ALLOWED");
            if (doc.archived_at) return { success:true,archived:true,alreadyArchived:true };
            const instant = now().toISOString();
            const result = await run("UPDATE stock_movements SET archived_at=?,archived_by=?,updated_at=? WHERE id=? AND status='CANCELLED' AND archived_at IS NULL", [instant,actor,instant,doc.id]);
            if (!result.changes) throw new StockInwardError("Cancelled Stock Inward could not be archived.", "STOCK_INWARD_ARCHIVE_NOT_ALLOWED");
            await appendActivity(db,{category:"INVENTORY",action:"STOCK_INWARD_CANCELLED_ARCHIVED",details:`Stock Inward ${doc.movement_no} (movement ${doc.id}) changed from CANCELLED and visible in Recent Stock Inwards to CANCELLED and archived from the normal list. No inventory was changed.`,user_name:actor,status:"SUCCESS",entity_type:"STOCK_INWARD",reference_no:doc.movement_no,change_data:{version:1,changes:[]}},now());
            return {success:true,archived:true};
        }));
    }
    async function getSuppliers() { return all("SELECT id,supplier_code,name,status FROM supplier_master ORDER BY name COLLATE NOCASE"); }
    async function getSupplierInvoices(supplierId) { const activeStore = await store(); return all("SELECT id,invoice_code,supplier_invoice_number,supplier_invoice_date,store_id,supplier_id FROM supplier_invoices WHERE status='POSTED' AND supplier_id=? AND store_id=? ORDER BY posting_date DESC LIMIT 100", [supplierId,activeStore.id]); }
    return { createDraft,updateContext,scan,resolveBarcode,editLine,removeLine,retryMatching,discardLine,cancelDraft,listResumable,listRecentHistory,abandonEmptyDraft,load,post,getUnknownExportRows,getSuppliers,getSupplierInvoices,productForBarcode,findDuplicateInvoice,currentMasterForUnresolved,archiveCancelled };
}

let singletonServicePromise = null;
let singletonDatabase = null;
async function defaultService() {
    if (!singletonServicePromise) singletonServicePromise = (async () => {
        const primary = require("./database");
        await primary.databaseReady;
        const sqlite3 = require("sqlite3").verbose();
        singletonDatabase = await new Promise((resolve, reject) => {
            const connection = new sqlite3.Database(primary.databasePath, error => error ? reject(error) : resolve(connection));
        });
        await new Promise((resolve, reject) => singletonDatabase.run("PRAGMA foreign_keys=ON", error => error ? reject(error) : resolve()));
        await new Promise((resolve, reject) => singletonDatabase.run("PRAGMA busy_timeout=10000", error => error ? reject(error) : resolve()));
        return createStockInwardService(singletonDatabase);
    })();
    return singletonServicePromise;
}
async function closeDefaultService() {
    if (!singletonServicePromise || !singletonDatabase) return;
    await singletonServicePromise;
    const connection = singletonDatabase; singletonDatabase = null; singletonServicePromise = null;
    await new Promise((resolve, reject) => connection.close(error => error ? reject(error) : resolve()));
}
module.exports = { StockInwardError, createStockInwardService, closeDefaultService,
    ...Object.fromEntries(["createDraft","updateContext","scan","resolveBarcode","editLine","removeLine","retryMatching","discardLine","cancelDraft","listResumable","listRecentHistory","abandonEmptyDraft","load","post","getUnknownExportRows","getSuppliers","getSupplierInvoices","findDuplicateInvoice","currentMasterForUnresolved","archiveCancelled"].map(name => [name,async (...args)=>(await defaultService())[name](...args)])) };
