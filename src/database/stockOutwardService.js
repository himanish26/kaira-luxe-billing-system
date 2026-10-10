"use strict";

const { getBusinessDate } = require("./businessDate");

const REASONS = new Set(["DAMAGE", "SUPPLIER_RETURN", "ADJUSTMENT"]);
const MAX_DOCUMENT_NUMBER = 999999;
const deletionAuthorizations = new WeakSet();

function createStockOutwardDeletionAuthorization() {
    const authorization = Object.freeze({ purpose: "STOCK_OUTWARD_DELETE" });
    deletionAuthorizations.add(authorization);
    return authorization;
}

class StockOutwardError extends Error {
    constructor(message, code = "STOCK_OUTWARD_INVALID", details = {}) {
        super(message);
        this.name = "StockOutwardError";
        this.code = code;
        if (Number.isSafeInteger(details.available) && details.available >= 0) this.available = details.available;
        if (Number.isSafeInteger(details.requested) && details.requested > 0) this.requested = details.requested;
        if (Number.isSafeInteger(details.alreadyAdded) && details.alreadyAdded >= 0) this.alreadyAdded = details.alreadyAdded;
        if (typeof details.productName === "string") this.productName = details.productName;
    }
}

function positiveInteger(value, label = "Quantity") {
    if (typeof value === "string" && !/^\d+$/.test(value.trim())) {
        throw new StockOutwardError(`${label} must be a positive whole number.`, "STOCK_OUTWARD_QUANTITY_INVALID");
    }
    const quantity = Number(value);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
        throw new StockOutwardError(`${label} must be a positive whole number.`, "STOCK_OUTWARD_QUANTITY_INVALID");
    }
    return quantity;
}

function validDate(value, currentBusinessDate) {
    const text = String(value || "").trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) throw new StockOutwardError("Enter a valid Outward Date.", "STOCK_OUTWARD_DATE_INVALID");
    const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    if (parsed.getUTCFullYear() !== Number(match[1]) || parsed.getUTCMonth() !== Number(match[2]) - 1 || parsed.getUTCDate() !== Number(match[3])) {
        throw new StockOutwardError("Enter a valid Outward Date.", "STOCK_OUTWARD_DATE_INVALID");
    }
    if (text > currentBusinessDate) throw new StockOutwardError("Outward Date cannot be in the future.", "STOCK_OUTWARD_DATE_FUTURE");
    if (text < currentBusinessDate) throw new StockOutwardError("Stock Outward must use the current KLBS business date.", "STOCK_OUTWARD_DATE_BACKDATED");
    return text;
}

function barcodeText(value) {
    if (typeof value !== "string") throw new StockOutwardError("Scan a valid barcode.", "STOCK_OUTWARD_BARCODE_INVALID");
    if (/[\u0000-\u001F\u007F-\u009F]/.test(value)) throw new StockOutwardError("Barcode contains unsupported control characters.", "STOCK_OUTWARD_BARCODE_INVALID");
    const barcode = value.trim();
    if (!barcode) throw new StockOutwardError("Scan a valid barcode.", "STOCK_OUTWARD_BARCODE_INVALID");
    return barcode;
}

function createStockOutwardService(database, options = {}) {
    if (!database || typeof database.run !== "function" || typeof database.get !== "function" || typeof database.all !== "function") {
        throw new TypeError("A SQLite database connection is required.");
    }
    const db = database;
    const now = options.now || (() => new Date());
    const getBusinessDay = options.getBusinessDate || getBusinessDate;
    const appendActivity = options.appendActivityInTransaction || ((conn, event, instant) => require("./activityService").appendActivityInTransaction(conn, event, instant));
    let queue = Promise.resolve();
    const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function (error) {
        error ? reject(error) : resolve({ lastID: this.lastID, changes: this.changes });
    }));
    const get = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
    const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));

    function serialize(operation) {
        const task = queue.then(operation, operation);
        queue = task.catch(() => {});
        return task;
    }
    async function transaction(operation) {
        await run("BEGIN IMMEDIATE TRANSACTION");
        try {
            const result = await operation();
            await run("COMMIT");
            return result;
        } catch (error) {
            await run("ROLLBACK").catch(() => {});
            throw error;
        }
    }
    function currentDate() { return getBusinessDay(now()); }
    async function activeStore() {
        const store = await get(`SELECT s.id,s.store_code,s.store_name,s.status
            FROM store_context c JOIN stores s ON s.id=c.current_store_id WHERE c.id=1`);
        if (!store || store.status !== "ACTIVE" || !Number.isSafeInteger(Number(store.id))) {
            throw new StockOutwardError("The active Store identity could not be resolved.", "STOCK_OUTWARD_STORE_INVALID");
        }
        return { id: Number(store.id), storeCode: store.store_code, storeName: store.store_name };
    }
    async function productForBarcode(barcode) {
        const rows = await all(`SELECT id,barcode,sku,product_name,brand,colour,size,active
            FROM products WHERE TRIM(CAST(barcode AS TEXT))=? ORDER BY id LIMIT 2`, [barcode]);
        if (!rows.length) throw new StockOutwardError(`Barcode ${barcode} was not found in Product Master.`, "STOCK_OUTWARD_PRODUCT_NOT_FOUND");
        if (rows.length > 1) throw new StockOutwardError(`Barcode ${barcode} matches more than one Product Master item.`, "STOCK_OUTWARD_BARCODE_AMBIGUOUS");
        if (Number(rows[0].active) !== 1) throw new StockOutwardError(`Product for barcode ${barcode} is inactive.`, "STOCK_OUTWARD_PRODUCT_INACTIVE");
        return rows[0];
    }
    async function liveStock(productId) {
        const row = await get("SELECT COALESCE(SUM(quantity),0) AS available FROM inventory_transactions WHERE product_id=?", [productId]);
        const available = Number(row?.available);
        if (!row || !Number.isSafeInteger(available) || available < 0) {
            throw new StockOutwardError("Available stock could not be determined.", "STOCK_OUTWARD_STOCK_INVALID");
        }
        return available;
    }
    async function assertDraft(movementId) {
        const id = Number(movementId);
        if (!Number.isSafeInteger(id) || id <= 0) throw new StockOutwardError("Stock Outward document was not found.", "STOCK_OUTWARD_NOT_FOUND");
        const doc = await get("SELECT * FROM stock_movements WHERE id=? AND direction='OUTWARD'", [id]);
        if (!doc) throw new StockOutwardError("Stock Outward document was not found.", "STOCK_OUTWARD_NOT_FOUND");
        const store=await activeStore();
        if(Number(doc.store_id)!==store.id)throw new StockOutwardError("Stock Outward belongs to a different Store.","STOCK_OUTWARD_STORE_MISMATCH");
        if (doc.status !== "DRAFT" || doc.posted_at) throw new StockOutwardError("This Stock Outward can no longer be edited.", "STOCK_OUTWARD_NOT_EDITABLE");
        return doc;
    }
    async function readDocument(movementId) {
        const id = Number(movementId);
        const doc = await get("SELECT * FROM stock_movements WHERE id=? AND direction='OUTWARD'", [id]);
        if (!doc) return null;
        const store=await activeStore();
        if(Number(doc.store_id)!==store.id)return null;
        const lines = await all(`SELECT l.*,COALESCE(l.product_name_snapshot,'') AS product_name,
                COALESCE(l.sku_snapshot,'') AS sku,COALESCE(l.colour_snapshot,'') AS colour,
                COALESCE(l.size_snapshot,'') AS size,
                COALESCE((SELECT SUM(it.quantity) FROM inventory_transactions it WHERE it.product_id=l.product_id),0) AS available_stock
            FROM stock_movement_lines l WHERE l.movement_id=? ORDER BY l.id`, [id]);
        const summaryLines=doc.status==="COMPLETE"?lines.filter(line=>line.posting_state==="POSTED"):lines;
        const totalUnits = summaryLines.reduce((sum, line) => sum + Number(doc.status === "COMPLETE" ? line.posted_quantity : line.recognized_quantity), 0);
        return { document: doc, lines, summary: { totalItems: new Set(summaryLines.map(line => Number(line.product_id))).size, totalUnits }, currentBusinessDate: currentDate() };
    }
    async function createDraft(input = {}, actor = "MANAGER") {
        return serialize(() => transaction(async () => {
            const store = await activeStore();
            const date = validDate(input.businessDate || currentDate(), currentDate());
            const latest = await get(`SELECT MAX(CAST(substr(movement_no,6) AS INTEGER)) AS last_number
                FROM stock_movements WHERE direction='OUTWARD' AND movement_no GLOB 'KLOUT[0-9][0-9][0-9][0-9][0-9][0-9]'`);
            const sequence = await get("SELECT seq FROM sqlite_sequence WHERE name='stock_movements'");
            const maxId = await get("SELECT COALESCE(MAX(id),0) AS last_id FROM stock_movements");
            const next = Math.max(Number(sequence?.seq || 0), Number(maxId?.last_id || 0), Number(latest?.last_number || 0)) + 1;
            if (!Number.isSafeInteger(next) || next > MAX_DOCUMENT_NUMBER) {
                throw new StockOutwardError("Stock Outward number sequence is exhausted.", "STOCK_OUTWARD_SEQUENCE_EXHAUSTED");
            }
            const movementNo = `KLOUT${String(next).padStart(6, "0")}`;
            const instant = now().toISOString();
            const inserted = await run(`INSERT INTO stock_movements(
                id,movement_no,direction,status,store_id,store_code_snapshot,store_name_snapshot,
                business_date,reason,remarks,idempotency_key,created_by,created_at,updated_at
            ) VALUES(?,?,'OUTWARD','DRAFT',?,?,?,?,NULL,NULL,?,?,?,?)`,
            [next,movementNo,store.id,store.storeCode,store.storeName,date,`STOCK_OUTWARD:${movementNo}`,actor,instant,instant]);
            if (Number(inserted.lastID) !== next) throw new StockOutwardError("Stock Outward number allocation could not be verified.", "STOCK_OUTWARD_SEQUENCE_INVALID");
            return { movementId: inserted.lastID, movementNo };
        }));
    }
    async function updateContext(input = {}) {
        return serialize(() => transaction(async () => {
            const doc = await assertDraft(input.movementId);
            const date = validDate(input.businessDate, currentDate());
            const reason = String(input.reason || "").trim().toUpperCase();
            if (!REASONS.has(reason)) throw new StockOutwardError("Select a valid Stock Outward reason.", "STOCK_OUTWARD_REASON_REQUIRED");
            const remarks = String(input.remarks || "").trim();
            if (remarks.length > 2000) throw new StockOutwardError("Remarks must be 2,000 characters or fewer.", "STOCK_OUTWARD_REMARKS_TOO_LONG");
            await run("UPDATE stock_movements SET business_date=?,reason=?,remarks=?,updated_at=? WHERE id=? AND direction='OUTWARD' AND status='DRAFT'",
                [date,reason,remarks || null,now().toISOString(),doc.id]);
            return readDocument(doc.id);
        }));
    }
    async function saveDraft(input = {}) {
        return serialize(() => transaction(async () => {
            const doc = await assertDraft(input.movementId);
            validDate(doc.business_date, currentDate());
            if (!REASONS.has(String(doc.reason || "").trim().toUpperCase())) {
                throw new StockOutwardError("Please select a Stock Outward reason.", "STOCK_OUTWARD_REASON_REQUIRED");
            }
            const lines = await all("SELECT * FROM stock_movement_lines WHERE movement_id=? ORDER BY id", [doc.id]);
            if (!lines.length) throw new StockOutwardError("Scan at least one product before saving the draft.", "STOCK_OUTWARD_EMPTY_DRAFT");
            const totals = new Map();
            for (const line of lines) {
                if (line.product_state !== "READY" || line.posting_state !== "UNPOSTED" || !line.product_id) {
                    throw new StockOutwardError(`Barcode ${line.barcode} is not ready to save.`, "STOCK_OUTWARD_LINE_INVALID");
                }
                const quantity = positiveInteger(line.recognized_quantity);
                totals.set(Number(line.product_id), (totals.get(Number(line.product_id)) || 0) + quantity);
            }
            for (const [productId, requested] of totals) {
                const available = await liveStock(productId);
                if (requested > available) {
                    const line = lines.find(item => Number(item.product_id) === productId);
                    throw new StockOutwardError(`Only ${available} units available for ${line.barcode}. Outward quantity cannot exceed available stock.`, "STOCK_OUTWARD_INSUFFICIENT_STOCK", { available, requested });
                }
            }
            await run("UPDATE stock_movements SET updated_at=? WHERE id=? AND direction='OUTWARD' AND status='DRAFT'", [now().toISOString(), doc.id]);
            return { success: true, ...(await readDocument(doc.id)) };
        }));
    }
    async function scan(input = {}) {
        const barcode = barcodeText(input.barcode);
        const quantity = positiveInteger(input.quantity == null ? 1 : input.quantity);
        return serialize(() => transaction(async () => {
            const doc = await assertDraft(input.movementId);
            if (!REASONS.has(String(doc.reason || "").toUpperCase())) throw new StockOutwardError("Select a reason before scanning items.", "STOCK_OUTWARD_REASON_REQUIRED");
            validDate(doc.business_date,currentDate());
            const product = await productForBarcode(barcode);
            const existing = await get("SELECT * FROM stock_movement_lines WHERE movement_id=? AND (barcode=? OR product_id=?) ORDER BY CASE WHEN barcode=? THEN 0 ELSE 1 END,id LIMIT 1", [doc.id,barcode,product.id,barcode]);
            const available = await liveStock(product.id);
            if (!Number.isSafeInteger(available) || available < 0) throw new StockOutwardError("Available stock could not be determined.", "STOCK_OUTWARD_STOCK_INVALID");
            const allocated = await get("SELECT COALESCE(SUM(recognized_quantity),0) AS quantity FROM stock_movement_lines WHERE movement_id=? AND product_id=? AND posting_state='UNPOSTED'", [doc.id,product.id]);
            const alreadyRequested = Number(allocated?.quantity || 0);
            const requested = alreadyRequested + quantity;
            if (requested > available) {
                const code = available === 0 && alreadyRequested === 0 ? "STOCK_OUTWARD_ZERO_STOCK" : "STOCK_OUTWARD_INSUFFICIENT_STOCK";
                throw new StockOutwardError(`Only ${available} units available for this SKU.`, code, {
                    available, alreadyAdded: alreadyRequested, requested, productName: product.product_name || "Product"
                });
            }
            if (existing) {
                const nextQuantity = Number(existing.recognized_quantity) + quantity;
                await run("UPDATE stock_movement_lines SET scanned_quantity=?,recognized_quantity=?,updated_at=? WHERE id=? AND movement_id=? AND posting_state='UNPOSTED'",
                    [nextQuantity,nextQuantity,now().toISOString(),existing.id,doc.id]);
                return { ...await readDocument(doc.id), duplicate: true, duplicateLineId: existing.id, availableStock: available };
            }
            const instant = now().toISOString();
            const inserted = await run(`INSERT INTO stock_movement_lines(
                movement_id,barcode,scanned_quantity,recognized_quantity,product_id,product_state,
                posting_state,posted_quantity,sku_snapshot,product_name_snapshot,colour_snapshot,size_snapshot,created_at,updated_at
            ) VALUES(?,?,?, ?,?,'READY','UNPOSTED',0,?,?,?,?,?,?)`,
            [doc.id,barcode,quantity,quantity,product.id,product.sku || null,product.product_name || null,product.colour || null,product.size || null,instant,instant]);
            return { ...await readDocument(doc.id), duplicate: false, addedLineId: inserted.lastID, availableStock: available };
        }));
    }
    async function editLine(input = {}) {
        const quantity = positiveInteger(input.quantity);
        return serialize(() => transaction(async () => {
            const doc = await assertDraft(input.movementId);
            const line = await get("SELECT * FROM stock_movement_lines WHERE id=? AND movement_id=? AND posting_state='UNPOSTED'", [Number(input.lineId),doc.id]);
            if (!line) throw new StockOutwardError("This Stock Outward line can no longer be changed.", "STOCK_OUTWARD_LINE_LOCKED");
            const available = await liveStock(line.product_id);
            const other = await get("SELECT COALESCE(SUM(recognized_quantity),0) AS quantity FROM stock_movement_lines WHERE movement_id=? AND product_id=? AND posting_state='UNPOSTED' AND id<>?", [doc.id,line.product_id,line.id]);
            const requested = Number(other?.quantity || 0) + quantity;
            if (requested > available) throw new StockOutwardError(`Only ${available} units available for this SKU.`, "STOCK_OUTWARD_INSUFFICIENT_STOCK", { available, requested });
            await run("UPDATE stock_movement_lines SET scanned_quantity=?,recognized_quantity=?,updated_at=? WHERE id=?", [quantity,quantity,now().toISOString(),line.id]);
            return { ...await readDocument(doc.id), availableStock: available };
        }));
    }
    async function removeLine(input = {}) {
        return serialize(() => transaction(async () => {
            const doc = await assertDraft(input.movementId);
            const result = await run("DELETE FROM stock_movement_lines WHERE id=? AND movement_id=? AND posting_state='UNPOSTED'", [Number(input.lineId),doc.id]);
            if (!result.changes) throw new StockOutwardError("This Stock Outward line can no longer be removed.", "STOCK_OUTWARD_LINE_LOCKED");
            return readDocument(doc.id);
        }));
    }
    async function listResumable() {
        const store = await activeStore();
        return all(`SELECT m.id,m.movement_no,m.status,m.business_date,m.reason,m.remarks,m.updated_at,
                (SELECT COUNT(DISTINCT l.product_id) FROM stock_movement_lines l WHERE l.movement_id=m.id) AS item_count,
                (SELECT COALESCE(SUM(l.recognized_quantity),0) FROM stock_movement_lines l WHERE l.movement_id=m.id) AS total_units
            FROM stock_movements m WHERE m.direction='OUTWARD' AND m.store_id=? AND m.status='DRAFT'
            ORDER BY m.updated_at DESC,m.id DESC`, [store.id]);
    }
    async function listHistory(options = {}) {
        const store = await activeStore();
        const pageSizeRaw = Number.parseInt(options.pageSize,10);
        const pageSize = Number.isFinite(pageSizeRaw) ? Math.min(Math.max(pageSizeRaw,1),100) : 50;
        const keyword = String(options.keyword || "").trim().slice(0,200).toLowerCase();
        const escaped = keyword.replace(/[\\%_]/g, "\\$&");
        const where = `m.direction='OUTWARD' AND m.store_id=? AND m.status IN ('COMPLETE','CANCELLED') AND
            (?='' OR LOWER(m.movement_no) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(m.reason,'')) LIKE ? ESCAPE '\\' OR
             LOWER(m.business_date) LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM stock_movement_lines l WHERE l.movement_id=m.id AND LOWER(l.barcode) LIKE ? ESCAPE '\\'))`;
        const search = `%${escaped}%`;
        const params = [store.id,keyword,search,search,search,search];
        const count = await get(`SELECT COUNT(*) AS total FROM stock_movements m WHERE ${where}`,params);
        const totalCount = Number(count?.total || 0);
        const totalPages = Math.max(1,Math.ceil(totalCount/pageSize));
        const requestedPage = Number.parseInt(options.page,10);
        const page = Math.min(Math.max(Number.isFinite(requestedPage) ? requestedPage : 1,1),totalPages);
        const rows = await all(`SELECT m.id,m.movement_no,m.status,m.business_date,m.reason,m.remarks,m.posted_at,m.updated_at,
                (SELECT COUNT(DISTINCT l.product_id) FROM stock_movement_lines l WHERE l.movement_id=m.id AND (m.status<>'COMPLETE' OR l.posting_state='POSTED')) AS item_count,
                (SELECT COALESCE(SUM(CASE WHEN m.status='COMPLETE' THEN l.posted_quantity ELSE l.recognized_quantity END),0) FROM stock_movement_lines l WHERE l.movement_id=m.id AND (m.status<>'COMPLETE' OR l.posting_state='POSTED')) AS total_units
            FROM stock_movements m WHERE ${where}
            ORDER BY COALESCE(m.posted_at,m.updated_at) DESC,m.id DESC LIMIT ? OFFSET ?`, [...params,pageSize,(page-1)*pageSize]);
        return { rows,totalCount,page,totalPages,pageSize };
    }
    async function cancelDraft(movementId, actor = "MANAGER") {
        return serialize(() => transaction(async () => {
            const doc = await assertDraft(movementId);
            const lineCount = await get("SELECT COUNT(*) AS count FROM stock_movement_lines WHERE movement_id=?",[doc.id]);
            const instant=now().toISOString();
            await run("UPDATE stock_movements SET status='CANCELLED',cancelled_by=?,cancelled_at=?,cancel_reason='Draft cancelled',updated_at=? WHERE id=? AND status='DRAFT'",[actor,instant,instant,doc.id]);
            return { cancelled:true,hadLines:Number(lineCount?.count||0)>0 };
        }));
    }
    async function deleteDocument(input = {}) {
        return serialize(() => transaction(async () => {
            if (!input.authorization || !deletionAuthorizations.has(input.authorization)) {
                throw new StockOutwardError("Manager authorization is required to delete a Stock Outward document.", "STOCK_OUTWARD_DELETE_UNAUTHORIZED");
            }
            const id = Number(input.movementId);
            if (!Number.isSafeInteger(id) || id <= 0) throw new StockOutwardError("Stock Outward document was not found.", "STOCK_OUTWARD_NOT_FOUND");
            const doc = await get("SELECT * FROM stock_movements WHERE id=? AND direction='OUTWARD'", [id]);
            if (!doc) throw new StockOutwardError("Stock Outward document was not found or was already deleted.", "STOCK_OUTWARD_NOT_FOUND");
            const store = await activeStore();
            if (Number(doc.store_id) !== store.id) throw new StockOutwardError("Stock Outward belongs to a different Store.", "STOCK_OUTWARD_STORE_MISMATCH");
            if (!['DRAFT','CANCELLED'].includes(doc.status) || doc.posted_at) {
                throw new StockOutwardError("Only unposted Draft or Cancelled Stock Outward documents can be deleted.", "STOCK_OUTWARD_DELETE_NOT_ALLOWED");
            }
            const linked = await get(`SELECT COUNT(*) AS count FROM inventory_transactions t
                WHERE t.reference_type='STOCK_OUTWARD' AND t.reference_id=?`, [doc.movement_no]);
            const linePosting = await get(`SELECT COUNT(*) AS count FROM stock_movement_lines l
                LEFT JOIN inventory_transactions t ON t.id=l.inventory_transaction_id
                WHERE l.movement_id=? AND (l.posting_state='POSTED' OR t.id IS NOT NULL)`, [doc.id]);
            if (Number(linked?.count || 0) || Number(linePosting?.count || 0)) {
                throw new StockOutwardError("This document has posted inventory entries and cannot be deleted.", "STOCK_OUTWARD_DELETE_HAS_LEDGER");
            }
            if (input.emptyOnly) {
                const lineCount = await get("SELECT COUNT(*) AS count FROM stock_movement_lines WHERE movement_id=?", [doc.id]);
                if (doc.status !== "DRAFT" || Number(lineCount?.count || 0) !== 0) {
                    throw new StockOutwardError("Only an empty Stock Outward draft can be closed without saving.", "STOCK_OUTWARD_EMPTY_CLEANUP_NOT_ALLOWED");
                }
            }
            const instant = now().toISOString();
            const actor = String(input.actor || "MANAGER").trim() || "MANAGER";
            const details = `document_id=${doc.id}; movement_no=${doc.movement_no}; previous_status=${doc.status}; outward_reason=${doc.reason || "UNSET"}; deletion_timestamp=${instant}; authorized_manager=${actor}; no_ledger_entries=true; action=PERMANENT_DELETE`;
            await appendActivity(db, {
                category: "INVENTORY", action: "STOCK_OUTWARD_DOCUMENT_DELETED", details,
                user_name: actor, status: "SUCCESS", entity_type: "STOCK_OUTWARD",
                reference_no: doc.movement_no,
                // Activity change_data is restricted to the established field allowlist.
                // The complete deletion audit context is retained in sanitized details.
                change_data: { version: 1, changes: [
                    { field: "status", label: "Previous status", old: doc.status, new: "DELETED" }
                ] }
            }, now());
            await run("DELETE FROM stock_movement_lines WHERE movement_id=?", [doc.id]);
            const removed = await run("DELETE FROM stock_movements WHERE id=? AND direction='OUTWARD' AND status=? AND posted_at IS NULL", [doc.id, doc.status]);
            if (removed.changes !== 1) throw new StockOutwardError("Stock Outward changed while deletion was in progress. Refresh history and retry.", "STOCK_OUTWARD_DELETE_CONFLICT");
            return { success: true, movementId: doc.id, movementNo: doc.movement_no, previousStatus: doc.status };
        }));
    }
    async function post(input = {}) {
        return serialize(() => transaction(async () => {
            const doc = await get("SELECT * FROM stock_movements WHERE id=? AND direction='OUTWARD'",[Number(input.movementId)]);
            if (!doc || doc.status !== "DRAFT" || doc.posted_at) throw new StockOutwardError("Stock Outward is already posted or cannot be posted.","STOCK_OUTWARD_ALREADY_POSTED");
            if (!REASONS.has(String(doc.reason || "").toUpperCase())) throw new StockOutwardError("Select a valid Stock Outward reason.","STOCK_OUTWARD_REASON_REQUIRED");
            validDate(doc.business_date,currentDate());
            const store=await activeStore();
            if (Number(doc.store_id)!==store.id) throw new StockOutwardError("Stock Outward belongs to a different Store.","STOCK_OUTWARD_STORE_MISMATCH");
            const lines=await all("SELECT * FROM stock_movement_lines WHERE movement_id=? ORDER BY id",[doc.id]);
            if (!lines.length) throw new StockOutwardError("Add at least one item before posting.","STOCK_OUTWARD_EMPTY");
            const byProduct=new Map();
            for(const line of lines){
                if(line.product_state!=="READY"||line.posting_state!=="UNPOSTED"||!line.product_id) throw new StockOutwardError(`Barcode ${line.barcode} is not ready to post.`,"STOCK_OUTWARD_LINE_INVALID");
                const quantity=positiveInteger(line.recognized_quantity);
                if(quantity!==Number(line.scanned_quantity)) throw new StockOutwardError(`Quantity for ${line.barcode} is inconsistent.`,"STOCK_OUTWARD_LINE_INVALID");
                byProduct.set(Number(line.product_id),(byProduct.get(Number(line.product_id))||0)+quantity);
            }
            const shortages=[];
            for(const [productId,requested] of byProduct){
                const available=await liveStock(productId);
                if(requested>available){
                    const product=lines.find(line=>Number(line.product_id)===productId);
                    shortages.push({barcode:product.barcode,available,requested});
                }
            }
            if(shortages.length){
                const shortage=shortages[0];
                throw new StockOutwardError(`Only ${shortage.available} units available for barcode ${shortage.barcode}; ${shortage.requested} requested.`,"STOCK_OUTWARD_INSUFFICIENT_STOCK", { available: shortage.available, requested: shortage.requested });
            }
            const instant=now().toISOString();
            for(const line of lines){
                const quantity=Number(line.recognized_quantity);
                const insert=await run(`INSERT INTO inventory_transactions(
                    product_id,barcode,transaction_type,quantity,reference_type,reference_id,remarks,created_by,created_at
                ) VALUES(?,?,?,?,?,?,?, ?,?)`,[line.product_id,line.barcode,doc.reason,-quantity,"STOCK_OUTWARD",doc.movement_no,doc.remarks, input.actor||"MANAGER",instant]);
                await run("UPDATE stock_movement_lines SET posting_state='POSTED',posted_quantity=?,inventory_transaction_id=?,updated_at=? WHERE id=? AND posting_state='UNPOSTED'",[quantity,insert.lastID,instant,line.id]);
            }
            await run("UPDATE stock_movements SET status='COMPLETE',posted_by=?,posted_at=?,updated_at=? WHERE id=? AND status='DRAFT'",[input.actor||"MANAGER",instant,instant,doc.id]);
            const totalUnits=lines.reduce((sum,line)=>sum+Number(line.recognized_quantity),0);
            await appendActivity(db,{category:"INVENTORY",action:"STOCK_OUTWARD_POSTED",details:`${doc.movement_no}; Store ${doc.store_code_snapshot||doc.store_id}; Reason ${doc.reason}; ${lines.length} SKU(s); ${totalUnits} unit(s)`,user_name:input.actor||"MANAGER",status:"SUCCESS",entity_type:"STOCK_OUTWARD",reference_no:doc.movement_no,change_data:{version:1,changes:[{field:"status",label:"Stock Outward status",old:"DRAFT",new:"COMPLETE"},{field:"quantity",label:"Total units",old:"0",new:String(totalUnits)}]}},now());
            return { ...await readDocument(doc.id),posted:true };
        }));
    }
    return { createDraft,updateContext,saveDraft,scan,editLine,removeLine,listResumable,listHistory,load:readDocument,cancelDraft,deleteDocument,post,productForBarcode,liveStock };
}

let singletonServicePromise=null;
let singletonDatabase=null;
async function defaultService(){
    if(!singletonServicePromise) singletonServicePromise=(async()=>{
        const primary=require("./database");
        await primary.databaseReady;
        const sqlite3=require("sqlite3").verbose();
        singletonDatabase=await new Promise((resolve,reject)=>{
            const connection=new sqlite3.Database(primary.databasePath,error=>error?reject(error):resolve(connection));
        });
        await new Promise((resolve,reject)=>singletonDatabase.run("PRAGMA foreign_keys=ON",error=>error?reject(error):resolve()));
        await new Promise((resolve,reject)=>singletonDatabase.run("PRAGMA busy_timeout=10000",error=>error?reject(error):resolve()));
        return createStockOutwardService(singletonDatabase);
    })();
    return singletonServicePromise;
}
async function closeDefaultService(){
    if(!singletonServicePromise||!singletonDatabase)return;
    await singletonServicePromise;
    const connection=singletonDatabase;singletonDatabase=null;singletonServicePromise=null;
    await new Promise((resolve,reject)=>connection.close(error=>error?reject(error):resolve()));
}

module.exports={StockOutwardError,createStockOutwardService,closeDefaultService,createStockOutwardDeletionAuthorization,
    ...Object.fromEntries(["createDraft","updateContext","saveDraft","scan","editLine","removeLine","listResumable","listHistory","load","cancelDraft","deleteDocument","post"].map(name=>[name,async(...args)=>(await defaultService())[name](...args)]))};
