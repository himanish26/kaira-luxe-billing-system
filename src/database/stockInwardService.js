"use strict";

const { getBusinessDate } = require("./businessDate");
const { normalizeBusinessSegment } = require("../shared/businessSegment");

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
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:T.*)?$/.exec(text);
    let year, month, day;
    if (m) {
        [, year, month, day] = m;
    } else {
        m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
        if (m) {
            [, day, month, year] = m;
        } else {
            m = /^(\d{1,2})[-\s]([A-Za-z]{3,})[-\s](\d{4})$/.exec(text);
            const monthNames = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
            if (!m || !monthNames[m[2].slice(0, 3).toLowerCase()]) {
                throw new StockInwardError("Enter a valid Invoice Date.", "STOCK_INWARD_DATE_INVALID");
            }
            day = m[1];
            month = monthNames[m[2].slice(0, 3).toLowerCase()];
            year = m[3];
        }
    }
    const y = Number(year), mo = Number(month), d = Number(day);
    const parsed = new Date(Date.UTC(y, mo - 1, d));
    if (!Number.isInteger(y) || !Number.isInteger(mo) || !Number.isInteger(d) ||
        parsed.getUTCFullYear() !== y || parsed.getUTCMonth() !== mo - 1 || parsed.getUTCDate() !== d) {
        throw new StockInwardError("Enter a valid Invoice Date.", "STOCK_INWARD_DATE_INVALID");
    }
    return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function normalizedInvoiceNumber(value) { return String(value || "").trim().toLocaleUpperCase("en-IN"); }
function productBarcodeText(value) {
    if (typeof value !== "string") throw new StockInwardError("Enter a valid product barcode.", "STOCK_INWARD_BARCODE_INVALID");
    if (/[\u0000-\u001F\u007F-\u009F]/.test(value)) throw new StockInwardError("Barcode contains unsupported control characters.", "STOCK_INWARD_BARCODE_INVALID");
    const barcode = value.trim();
    if (!barcode) throw new StockInwardError("Enter a valid product barcode.", "STOCK_INWARD_BARCODE_INVALID");
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
    function productDraftFromInvoice(row, doc) {
        const businessSegment = normalizeBusinessSegment(row.business_segment);
        const draft = {
            brand: String(row.brand || "").trim(),
            segment: String(row.segment || "Women").trim(),
            businessSegment,
            category: String(row.category || "").trim(),
            season: String(row.season || "All Season").trim(),
            collection: String(row.collection || "").trim(),
            productName: String(row.product_name || "").trim(),
            styleCode: String(row.style_code || "").trim(),
            size: String(row.size || "").trim(),
            colour: String(row.colour || "").trim(),
            mrpPaise: Number(row.mrp_paise),
            discount: row.discount == null ? 0 : Number(row.discount),
            sellingPricePaise: row.selling_price_paise == null ? Number(row.mrp_paise) : Number(row.selling_price_paise),
            unitCostPaise: Number(row.unit_cost_paise),
            gstRate: row.gst_rate == null ? null : Number(row.gst_rate),
            hsnCode: String(row.hsn_code || "").trim(),
            reorderLevel: row.reorder_level == null ? 0 : Number(row.reorder_level),
            supplier: String(row.supplier || doc?.supplier_name || "").trim(),
            active: row.active == null ? true : Number(row.active) === 1,
            variableValue: row.variable_value == null ? false : Number(row.variable_value) === 1
        };
        const missing = [];
        if (!draft.brand) missing.push("brand");
        if (!draft.category) missing.push("category");
        if (!draft.productName) missing.push("productName");
        if (!draft.businessSegment) missing.push("businessSegment");
        if (!Number.isFinite(draft.gstRate) || draft.gstRate < 0 || draft.gstRate > 100) missing.push("gstRate");
        if (!Number.isSafeInteger(draft.mrpPaise) || draft.mrpPaise <= 0) missing.push("mrpPaise");
        return { draft, missing };
    }
    async function allocateSku() {
        const skuRows = await all("SELECT sku FROM products WHERE sku IS NOT NULL AND TRIM(sku)<>''");
        const used = new Set(skuRows.map(row => String(row.sku).trim().toUpperCase()));
        let sequence = skuRows.reduce((max, row) => {
            const match = /^KL(\d+)$/i.exec(String(row.sku || "").trim());
            return match ? Math.max(max, Number(match[1])) : max;
        }, 0);
        let candidate;
        do { sequence += 1; candidate = `KL${String(sequence).padStart(6, "0")}`; } while (used.has(candidate));
        return candidate;
    }
    async function insertProductFromInvoice(barcode, line, doc, overrides = {}) {
        const merged = {
            ...line,
            brand: overrides.brand ?? line.brand,
            segment: overrides.segment ?? line.segment,
            business_segment: overrides.businessSegment ?? overrides.business_segment ?? line.business_segment,
            category: overrides.category ?? line.category,
            product_name: overrides.productName ?? overrides.product_name ?? line.product_name,
            gst_rate: overrides.gstRate ?? overrides.gst_rate ?? line.gst_rate,
            season: overrides.season ?? line.season,
            collection: overrides.collection ?? line.collection,
            style_code: overrides.styleCode ?? overrides.style_code ?? line.style_code,
            size: overrides.size ?? line.size,
            colour: overrides.colour ?? line.colour,
            hsn_code: overrides.hsnCode ?? overrides.hsn_code ?? line.hsn_code,
            discount: overrides.discount ?? line.discount,
            selling_price_paise: overrides.sellingPricePaise ?? overrides.selling_price_paise ?? line.selling_price_paise,
            reorder_level: overrides.reorderLevel ?? overrides.reorder_level ?? line.reorder_level,
            supplier: overrides.supplier ?? line.supplier
        };
        const { draft, missing } = productDraftFromInvoice(merged, doc);
        if (missing.length) return { created: false, missing, draft };
        if (!["Women", "Men", "Kids"].includes(draft.segment)) draft.segment = "Women";
        if (!["brand", "category", "productName", "segment", "season", "collection", "styleCode", "size", "colour", "hsnCode", "supplier"].every(key => !/[\u0000-\u001F\u007F-\u009F]/.test(String(draft[key] || "")))) {
            throw new StockInwardError("Product details contain unsupported control characters.", "STOCK_INWARD_PRODUCT_DETAILS_INVALID");
        }
        if (!Number.isFinite(draft.discount) || draft.discount < 0 || draft.discount > 100 || !Number.isSafeInteger(draft.sellingPricePaise) || draft.sellingPricePaise < 0 ||
            !Number.isSafeInteger(draft.unitCostPaise) || draft.unitCostPaise < 0 || !Number.isSafeInteger(draft.reorderLevel) || draft.reorderLevel < 0) {
            throw new StockInwardError("Product price or reorder details are invalid.", "STOCK_INWARD_PRODUCT_DETAILS_INVALID");
        }
        const found = await productForBarcode(barcode);
        if (found.product) return { created: false, existing: found.product };
        if (found.resolution === "AMBIGUOUS") throw new StockInwardError("This barcode already matches multiple Product Master records.", "STOCK_INWARD_BARCODE_AMBIGUOUS");
        const sku = await allocateSku();
        const result = await run(`INSERT INTO products(
            barcode,sku,brand,segment,business_segment,category,season,collection,product_name,style_code,size,colour,
            mrp,discount,selling_price,cost_price,gst_rate,hsn_code,opening_stock,reorder_level,supplier,active,variable_value)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?)`, [barcode,sku,draft.brand,draft.segment,draft.businessSegment,draft.category,draft.season,draft.collection,
            draft.productName,draft.styleCode,draft.size,draft.colour,draft.mrpPaise/100,draft.discount,draft.sellingPricePaise/100,draft.unitCostPaise/100,
            draft.gstRate,draft.hsnCode, draft.reorderLevel,draft.supplier, draft.active?1:0,draft.variableValue?1:0]);
        await appendActivity(db, { category:"INVENTORY",action:"STOCK_INWARD_PRODUCT_CREATED",details:`${doc.movement_no}: new Product Master item ${sku} created from scanned supplier invoice barcode ${barcode}; zero opening stock; stock will enter only through the Stock Inward posting.`,user_name:"MANAGER",status:"SUCCESS",entity_type:"PRODUCT",reference_no:sku,change_data:{version:1,changes:[{field:"barcode",label:"Barcode",old:null,new:barcode},{field:"sku",label:"KLBS SKU",old:null,new:sku},{field:"brand",label:"Brand",old:null,new:draft.brand},{field:"mrp",label:"MRP",old:null,new:String(draft.mrpPaise/100)}]} }, now());
        return { created: true, product: { id: result.lastID, barcode, sku, product_name: draft.productName, brand: draft.brand, colour: draft.colour, size: draft.size, mrp: draft.mrpPaise/100, active: draft.active?1:0, variable_value: draft.variableValue?1:0 } };
    }
    async function productsForBarcodes(barcodes) {
        const unique = [...new Set(barcodes.map(value => String(value).trim()).filter(Boolean))];
        const found = new Map();
        for (let offset = 0; offset < unique.length; offset += 400) {
            const batch = unique.slice(offset, offset + 400);
            const rows = await all(`SELECT id,barcode,sku,product_name,brand,colour,size,mrp,active,variable_value
                FROM products WHERE TRIM(CAST(barcode AS TEXT)) IN (${batch.map(() => "?").join(",")}) ORDER BY id`, batch);
            for (const product of rows) {
                const barcode = String(product.barcode || "").trim();
                const matches = found.get(barcode) || [];
                if (matches.length < 2) matches.push(product);
                found.set(barcode, matches);
            }
        }
        return new Map(unique.map(barcode => {
            const matches = found.get(barcode) || [];
            return [barcode, matches.length === 0 ? { productResolution: "NOT_FOUND" }
                : matches.length > 1 ? { productResolution: "AMBIGUOUS" }
                    : { productResolution: "UNIQUE", productId: matches[0].id, sku: matches[0].sku,
                        productName: matches[0].product_name, brand: matches[0].brand,
                        colour: matches[0].colour, size: matches[0].size }];
        }));
    }
    async function assignInvoiceMrpToScannedUnits(line, invoiceRows, actor, instant) {
        if (!line || line.product_state !== "READY" || !Array.isArray(invoiceRows) || !invoiceRows.length) return [];
        const postedRows = await all(`SELECT b.mrp_paise,a.unit_cost_paise,SUM(a.posted_quantity) AS quantity
            FROM stock_movement_mrp_allocations a JOIN product_mrp_buckets b ON b.id=a.bucket_id
            WHERE a.movement_line_id=? AND a.posting_state='POSTED' GROUP BY b.mrp_paise,a.unit_cost_paise`, [line.id]);
        const postedByKey = new Map(postedRows.map(row => [`${Number(row.mrp_paise)}:${row.unit_cost_paise == null ? "" : Number(row.unit_cost_paise)}`, Number(row.quantity || 0)]));
        const expectedByKey = new Map();
        for (const row of invoiceRows) {
            const key = `${Number(row.mrp_paise)}:${Number(row.unit_cost_paise)}`;
            const prior = expectedByKey.get(key) || { mrpPaise:Number(row.mrp_paise), unitCostPaise:Number(row.unit_cost_paise), quantity:0 };
            prior.quantity += Number(row.expected_quantity);
            expectedByKey.set(key, prior);
        }
        await run("DELETE FROM stock_movement_mrp_allocations WHERE movement_line_id=? AND posting_state='UNPOSTED'", [line.id]);
        let needed = Math.max(0, Number(line.recognized_quantity) - Number(line.posted_quantity));
        if (!needed) return [];
        const product = await get("SELECT mrp FROM products WHERE id=?", [line.product_id]);
        const referenceMrpPaise = product?.mrp == null ? null : Math.round(Number(product.mrp) * 100);
        const assigned = [];
        for (const [key, expected] of expectedByKey) {
            const capacity = Math.max(0, expected.quantity - (postedByKey.get(key) || 0));
            const quantity = Math.min(capacity, needed);
            if (!quantity) continue;
            let bucket = await get("SELECT id,status FROM product_mrp_buckets WHERE product_id=? AND mrp_paise=?", [line.product_id, expected.mrpPaise]);
            if (!bucket) {
                const created = await run(`INSERT INTO product_mrp_buckets(product_id,mrp_paise,status,source,created_by,created_at)
                    VALUES(?,?,'ACTIVE','STOCK_MOVEMENT',?,?)`, [line.product_id,expected.mrpPaise,String(actor || "CASHIER"),instant]);
                bucket = { id:created.lastID, status:"ACTIVE" };
            } else if (bucket.status === "CLOSED") {
                await run("UPDATE product_mrp_buckets SET status='ACTIVE' WHERE id=?", [bucket.id]);
            }
            await run(`INSERT INTO stock_movement_mrp_allocations(movement_line_id,bucket_id,quantity,unit_cost_paise,cost_basis_status,posting_state,created_by,created_at,reference_mrp_paise,mrp_change_status)
                VALUES(?,?,?,?,?,'UNPOSTED',?,?,?,?)`, [line.id,bucket.id,quantity,expected.unitCostPaise,"CAPTURED",String(actor || "CASHIER"),instant,referenceMrpPaise,
                referenceMrpPaise == null ? null : expected.mrpPaise === referenceMrpPaise ? "SAME" : "CHANGED"]);
            assigned.push({ mrpPaise:expected.mrpPaise, unitCostPaise:expected.unitCostPaise, quantity });
            needed -= quantity;
            if (!needed) break;
        }
        if (assigned.length) {
            const summary = assigned.map(row => `₹${(row.mrpPaise / 100).toFixed(2)} × ${row.quantity} @ ₹${(row.unitCostPaise / 100).toFixed(2)}`).join(", ");
            await appendActivity(db, { category:"INVENTORY",action:"DYNAMIC_MRP_MOVEMENT_ALLOCATED",
                details:`INWARD ${line.barcode}; invoice-derived scan allocation; ${summary}`,user_name:["SYSTEM","OPERATOR","MANAGER","ADMINISTRATOR"].includes(String(actor || "").toUpperCase()) ? String(actor).toUpperCase() : "OPERATOR",status:"SUCCESS",
                entity_type:"STOCK_MOVEMENT",reference_no:String(line.movement_id),change_data:{version:1,changes:[]} },instant);
        }
        return assigned;
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
        const movementMrpAllocations = await all(`SELECT a.id,a.movement_line_id,a.quantity,a.posted_quantity,a.unit_cost_paise,a.posting_state,
            b.mrp_paise,a.mrp_change_status FROM stock_movement_mrp_allocations a
            JOIN product_mrp_buckets b ON b.id=a.bucket_id JOIN stock_movement_lines l ON l.id=a.movement_line_id
            WHERE l.movement_id=? ORDER BY a.movement_line_id,b.mrp_paise,a.id`, [movementId]);
        const allocationsByLine = new Map();
        for (const allocation of movementMrpAllocations) {
            const list = allocationsByLine.get(Number(allocation.movement_line_id)) || [];
            list.push(allocation);
            allocationsByLine.set(Number(allocation.movement_line_id), list);
        }
        for (const line of lines) line.mrpAllocations = allocationsByLine.get(Number(line.id)) || [];
        const invoiceLines = await all("SELECT * FROM stock_movement_invoice_lines WHERE movement_id=? ORDER BY line_number", [movementId]);
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
        const invoiceByBarcode = new Map();
        for (const row of invoiceLines) {
            const prior = invoiceByBarcode.get(row.barcode) || { barcode: row.barcode, expectedQuantity: 0, mrps: [] };
            prior.expectedQuantity += Number(row.expected_quantity);
            prior.mrps.push({ mrpPaise: Number(row.mrp_paise), quantity: Number(row.expected_quantity), unitCostPaise: Number(row.unit_cost_paise) });
            invoiceByBarcode.set(row.barcode, prior);
        }
        const scanByBarcode = new Map(active.map(line => [line.barcode, Number(line.scanned_quantity)]));
        const reconciliationBarcodes = [...new Set([...invoiceByBarcode.keys(), ...scanByBarcode.keys()])];
        const productMatches = await productsForBarcodes(reconciliationBarcodes);
        const invoiceReconciliation = reconciliationBarcodes.map(barcode => {
            const expected = invoiceByBarcode.get(barcode)?.expectedQuantity || 0;
            const scanned = scanByBarcode.get(barcode) || 0;
            const match = productMatches.get(barcode) || { productResolution: "NOT_FOUND" };
            return { barcode, expectedQuantity: expected, scannedQuantity: scanned, difference: expected - scanned,
                state: expected === scanned ? "MATCHED" : expected > scanned ? "SHORT" : "OVER",
                ...match, mrps: invoiceByBarcode.get(barcode)?.mrps || [] };
        });
        const invoiceBarcodeMatches = invoiceReconciliation.filter(row => row.expectedQuantity > 0);
        const meaningful = lines.length > 0 || invoiceLines.length > 0 || doc.supplier_id != null || doc.supplier_invoice_id != null ||
            Boolean(String(doc.invoice_no || "").trim()) || Boolean(String(doc.reference_text || "").trim()) ||
            doc.invoice_date != null || doc.invoice_total_quantity != null;
        return { document: doc, lines, meaningful, currentBusinessDate: businessDate(now()), summary: { knownSkus: known.length, knownUnits, unresolvedBarcodes: unresolved.length,
            unresolvedUnits: unresolved.reduce((sum, line) => sum + Number(line.scanned_quantity), 0), scannedQty,
            eligibleToPost: known.filter(line => ["UNPOSTED","PARTIALLY_POSTED"].includes(line.posting_state)).reduce((sum, line) => sum + Math.max(0, Number(line.recognized_quantity) - Number(line.posted_quantity)), 0),
            postedUnits, reconciliation, invoiceLines, invoiceReconciliation,
            invoiceMatchedBarcodes: invoiceBarcodeMatches.filter(row => row.productResolution === "UNIQUE").length,
            invoiceUnresolvedBarcodes: invoiceBarcodeMatches.filter(row => row.productResolution !== "UNIQUE").length } };
    }
    async function importInvoiceLines(input = {}) {
        const movementId = integer(input.movementId, "Stock Inward document");
        const rows = Array.isArray(input.rows) ? input.rows : [];
        if (!rows.length || rows.length > 20000) throw new StockInwardError("The invoice must contain between 1 and 20,000 product rows.", "STOCK_INWARD_IMPORT_INVALID");
        const clean = rows.map((row, index) => {
            const barcode = productBarcodeText(String(row.barcode ?? ""));
            const quantity = integer(row.quantity, `Row ${index + 2} quantity`);
            const mrpPaise = integer(row.mrpPaise, `Row ${index + 2} printed MRP`, true);
            const unitCostPaise = integer(row.unitCostPaise, `Row ${index + 2} invoice rate`, true);
            for (const [label, value] of [["SKU",row.sku],["Brand",row.brand],["Segment",row.segment],["Business Segment",row.businessSegment],
                ["Category",row.category],["Season",row.season],["Collection",row.collection],["Product",row.productName],["Style Code",row.styleCode],
                ["Size",row.size],["Colour",row.colour],["HSN Code",row.hsnCode],["Supplier",row.supplier]]) {
                if (value != null && /[\u0000-\u001F\u007F-\u009F]/.test(String(value))) throw new StockInwardError(`Row ${index + 2}: ${label} contains unsupported characters.`, "STOCK_INWARD_IMPORT_INVALID");
            }
            const discount= row.discount == null ? null : Number(row.discount);
            const sellingPricePaise=row.sellingPricePaise == null ? null : integer(row.sellingPricePaise, `Row ${index + 2} selling price`, true);
            const gstRate=row.gstRate == null ? null : Number(row.gstRate);
            const reorderLevel=row.reorderLevel == null ? null : integer(row.reorderLevel, `Row ${index + 2} reorder level`, true);
            if (discount != null && (!Number.isFinite(discount) || discount < 0 || discount > 100)) throw new StockInwardError(`Row ${index + 2}: Discount must be between 0 and 100.`, "STOCK_INWARD_IMPORT_INVALID");
            if (gstRate != null && (!Number.isFinite(gstRate) || gstRate < 0 || gstRate > 100)) throw new StockInwardError(`Row ${index + 2}: GST Rate must be between 0 and 100.`, "STOCK_INWARD_IMPORT_INVALID");
            for (const [label,value] of [["Active",row.active],["Variable Value",row.variableValue]]) if (value != null && typeof value !== "boolean") throw new StockInwardError(`Row ${index + 2}: ${label} must be Yes or No.`, "STOCK_INWARD_IMPORT_INVALID");
            return { barcode, quantity, mrpPaise, unitCostPaise, sku:row.sku || null, brand:row.brand || null, segment:row.segment || null,
                businessSegment:row.businessSegment || null, category:row.category || null, season:row.season || null, collection:row.collection || null,
                productName:row.productName || null, styleCode:row.styleCode || null, size:row.size || null, colour:row.colour || null, discount,
                sellingPricePaise, gstRate, hsnCode:row.hsnCode || null, reorderLevel, supplier:row.supplier || null,
                active:row.active == null ? null : Number(row.active), variableValue:row.variableValue == null ? null : Number(row.variableValue) };
        });
        if (!Number.isSafeInteger(clean.reduce((sum,row)=>sum+row.quantity,0))) throw new StockInwardError("The invoice quantity total is too large.", "STOCK_INWARD_IMPORT_INVALID");
        return serialize(() => transaction(async () => {
            const doc = await assertDraft(movementId);
            const existing = await get("SELECT COUNT(*) AS count FROM stock_movement_lines WHERE movement_id=? AND (discarded_at IS NULL OR posting_state='POSTED')", [movementId]);
            if (Number(existing?.count || 0)) throw new StockInwardError("Import the invoice before scanning products. Remove the unposted scan lines to replace it.", "STOCK_INWARD_IMPORT_AFTER_SCAN");
            if (!doc.supplier_id || !(doc.invoice_number_snapshot || doc.invoice_no) || !doc.invoice_date) throw new StockInwardError("Enter the supplier, invoice number and invoice date before importing.", "STOCK_INWARD_HEADER_INCOMPLETE");
            await run("DELETE FROM stock_movement_invoice_lines WHERE movement_id=?", [movementId]);
            const instant = now().toISOString();
            for (let index = 0; index < clean.length; index++) {
                const row = clean[index];
                await run(`INSERT INTO stock_movement_invoice_lines(
                    movement_id,line_number,barcode,sku,product_name,size,colour,expected_quantity,mrp_paise,unit_cost_paise,
                    brand,segment,business_segment,category,season,collection,style_code,discount,selling_price_paise,gst_rate,hsn_code,reorder_level,supplier,active,variable_value,created_at)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [movementId,index+1,row.barcode,row.sku,row.productName,row.size,row.colour,row.quantity,row.mrpPaise,row.unitCostPaise,
                    row.brand,row.segment,row.businessSegment,row.category,row.season,row.collection,row.styleCode,row.discount,row.sellingPricePaise,row.gstRate,row.hsnCode,row.reorderLevel,row.supplier,row.active,row.variableValue,instant]);
            }
            const total = clean.reduce((sum,row)=>sum+row.quantity,0);
            await run("UPDATE stock_movements SET invoice_total_quantity=?,updated_at=? WHERE id=?", [total,instant,movementId]);
            return readDocument(movementId);
        }));
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
            const seq = await get("SELECT next_movement_number FROM stock_movement_sequences WHERE id=1");
            if (!seq || !Number.isSafeInteger(Number(seq.next_movement_number))) throw new StockInwardError("Stock Inward number sequence is unavailable.", "STOCK_INWARD_SEQUENCE_INVALID");
            const number = Number(seq.next_movement_number);
            if (number > 999999) throw new StockInwardError("Stock Inward document number sequence is exhausted.", "STOCK_INWARD_SEQUENCE_EXHAUSTED");
            await run("UPDATE stock_movement_sequences SET next_movement_number=? WHERE id=1 AND next_movement_number=?", [number + 1, number]);
            const code = `KLINW${String(number).padStart(6, "0")}`;
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
            const hasPostedLine = await get("SELECT 1 AS found FROM stock_movement_lines WHERE movement_id=? AND posted_quantity>0 LIMIT 1", [doc.id]);
            const supplierId = input.supplierId || null;
            const supplier = supplierId ? await get("SELECT id,supplier_code,name FROM supplier_master WHERE id=?", [supplierId]) : null;
            if (supplierId && !supplier) throw new StockInwardError("Selected Supplier was not found.", "STOCK_INWARD_SUPPLIER_INVALID");
            const invoice = input.supplierInvoiceId ? await get("SELECT id,invoice_code,store_id,supplier_id,supplier_invoice_number,status FROM supplier_invoices WHERE id=?", [input.supplierInvoiceId]) : null;
            if (input.supplierInvoiceId && (!invoice || invoice.status !== "POSTED" || Number(invoice.store_id) !== Number(doc.store_id) || Number(invoice.supplier_id) !== Number(supplierId))) throw new StockInwardError("Supplier Invoice must belong to the selected Supplier and current Store.", "STOCK_INWARD_INVOICE_MISMATCH");
            const invoiceQty = input.invoiceTotalQuantity == null || String(input.invoiceTotalQuantity).trim() === "" ? null : integer(input.invoiceTotalQuantity, "Invoice Total Qty");
            const invoiceNumber = String(input.invoiceNumber || "").trim() || invoice?.supplier_invoice_number || null;
            const invoiceDate = dateOrNull(input.invoiceDate);
            const reference = String(input.reference || "").trim() || null;
            const requestedBusinessDate = input.businessDate == null ? doc.business_date : String(input.businessDate).trim();
            if (input.businessDate != null && requestedBusinessDate !== businessDate(now())) {
                throw new StockInwardError("Stock Inward must use the current KLBS business date.", "STOCK_INWARD_BUSINESS_DATE_MISMATCH");
            }
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
            await run(`UPDATE stock_movements SET supplier_id=?,supplier_name=?,supplier_code_snapshot=?,supplier_invoice_id=?,supplier_invoice_code_snapshot=?,invoice_no=?,invoice_number_snapshot=?,reference_text=?,invoice_date=?,invoice_total_quantity=?,business_date=?,updated_at=? WHERE id=?`,
                [supplier?.id || null,supplier?.name || null,supplier?.supplier_code || null,invoice?.id || null,invoice?.invoice_code || null,
                    invoiceNumber,invoiceNumber,reference,invoiceDate,invoiceQty,requestedBusinessDate,now().toISOString(),doc.id]);
            const result = await readDocument(doc.id);
            result.splitDeliveryWarning = Number(linkedElsewhere?.count || 0) > 0;
            return result;
        }));
    }
    async function scan(input = {}) {
        const barcode = productBarcodeText(input.barcode);
        const scanQuantity = integer(input.quantity == null ? 1 : input.quantity, "Quantity");
        return serialize(() => transaction(async () => {
            const doc = await assertDraft(input.movementId);
            const header = receivingHeader({ supplierId:doc.supplier_id,invoiceNumber:doc.invoice_number_snapshot || doc.invoice_no,invoiceDate:doc.invoice_date,invoiceTotalQuantity:doc.invoice_total_quantity,reference:doc.reference_text });
            const duplicate = await duplicateInvoiceRow(header.supplierId,header.invoiceNumber,doc.id);
            if (duplicate) throw new StockInwardError(`Invoice ${header.invoiceNumber} is already assigned to ${duplicate.movement_no}.`, "STOCK_INWARD_DUPLICATE_INVOICE");
            const instant = now().toISOString();
            const invoiceRows = await all(`SELECT * FROM stock_movement_invoice_lines
                WHERE movement_id=? AND barcode=? AND expected_quantity>0 ORDER BY line_number`, [doc.id,barcode]);
            const invoiceLine = invoiceRows[0] || null;
            const invoiceUpload = await get("SELECT 1 AS found FROM stock_movement_invoice_lines WHERE movement_id=? LIMIT 1", [doc.id]);
            let found = await productForBarcode(barcode);
            let productCreated = false;
            if (found.resolution === "NOT_FOUND" && invoiceLine) {
                const capture = await insertProductFromInvoice(barcode,invoiceLine,doc);
                if (capture.created) productCreated = true;
                found = await productForBarcode(barcode);
            }
            const old = await get("SELECT * FROM stock_movement_lines WHERE movement_id=? AND barcode=?", [doc.id,barcode]);
            if (old?.discarded_at) throw new StockInwardError("This barcode was discarded. Retry matching or start a new line after review.", "STOCK_INWARD_LINE_DISCARDED");
            const quantity = old ? integer(old.scanned_quantity, "Quantity") + scanQuantity : scanQuantity;
            if (!Number.isSafeInteger(quantity)) throw new StockInwardError("Quantity is too large.", "STOCK_INWARD_QUANTITY_INVALID");
            const offInvoice = Boolean(invoiceUpload) && !invoiceLine;
            const product = offInvoice ? null : found.product;
            const state = product ? "READY" : "PENDING_MASTER";
            const note = offInvoice ? "NOT ON INVOICE" : found.resolution === "AMBIGUOUS" ? "AMBIGUOUS BARCODE" : found.resolution === "NOT_FOUND" ? "PRODUCT NOT FOUND" : product?.active === 0 ? "PRODUCT IS INACTIVE" : null;
            const postedQuantity = Number(old?.posted_quantity || 0);
            const nextPostingState = postedQuantity > 0 ? "PARTIALLY_POSTED" : "UNPOSTED";
            if (old) {
                await run(`UPDATE stock_movement_lines SET scanned_quantity=?,recognized_quantity=?,product_id=?,product_state=?,posting_state=?,posted_quantity=?,inventory_transaction_id=?,sku_snapshot=?,product_name_snapshot=?,colour_snapshot=?,size_snapshot=?,resolution_note=?,updated_at=? WHERE id=?`,
                    [quantity,product ? quantity : 0,product?.id || null,state,nextPostingState,postedQuantity,null,product?.sku || null,product?.product_name || null,product?.colour || null,product?.size || null,note,instant,old.id]);
            } else {
                await run(`INSERT INTO stock_movement_lines(movement_id,barcode,scanned_quantity,recognized_quantity,product_id,product_state,sku_snapshot,product_name_snapshot,colour_snapshot,size_snapshot,resolution_note,created_at,updated_at)
                    VALUES(?,?,?, ?,?,?, ?,?,?,?,?,?,?)`, [doc.id,barcode,scanQuantity,product ? scanQuantity : 0,product?.id || null,state,product?.sku || null,product?.product_name || null,product?.colour || null,product?.size || null,note,instant,instant]);
            }
            let lastMrpAllocations = [];
            if (product && invoiceRows.length) {
                const currentLine = await get("SELECT * FROM stock_movement_lines WHERE movement_id=? AND barcode=?", [doc.id,barcode]);
                lastMrpAllocations = await assignInvoiceMrpToScannedUnits(currentLine,invoiceRows,input.actor || "OPERATOR",instant);
            }
            if (doc.status !== "PARTIALLY_POSTED") await run("UPDATE stock_movements SET status=?,updated_at=? WHERE id=?", [product ? "DRAFT" : "PENDING_MASTER",instant,doc.id]);
            const result = await readDocument(doc.id);
            result.lastResolution = offInvoice ? "NOT_ON_INVOICE" : productCreated ? "CREATED_FROM_INVOICE" : found.resolution;
            result.lastProductCreated = productCreated;
            result.lastMrpAllocations = lastMrpAllocations;
            return result;
        }));
    }
    async function createProductFromInvoice(input = {}) {
        const movementId = integer(input.movementId, "Stock Inward document");
        const lineId = integer(input.lineId, "Unresolved line");
        return serialize(() => transaction(async () => {
            const doc = await assertDraft(movementId);
            const line = await get(`SELECT * FROM stock_movement_lines WHERE id=? AND movement_id=?
                AND product_state='PENDING_MASTER' AND posting_state='UNPOSTED' AND discarded_at IS NULL`, [lineId,movementId]);
            if (!line) throw new StockInwardError("This unresolved scan is no longer available for product setup.", "STOCK_INWARD_PRODUCT_CAPTURE_LINE_INVALID");
            const invoiceLine = await get(`SELECT * FROM stock_movement_invoice_lines WHERE movement_id=? AND barcode=? AND expected_quantity>0 ORDER BY line_number LIMIT 1`, [movementId,line.barcode]);
            if (!invoiceLine) throw new StockInwardError("This barcode is not on the uploaded invoice. It must remain unresolved until reviewed.", "STOCK_INWARD_PRODUCT_CAPTURE_NO_INVOICE");
            const capture = await insertProductFromInvoice(line.barcode,invoiceLine,doc,input.product || {});
            if (!capture.created && !capture.product) {
                return { ...await readDocument(movementId), productCapture:{ created:false,missing:capture.missing,draft:capture.draft } };
            }
            const product = capture.product || capture.existing;
            if (!product || Number(product.active) !== 1) throw new StockInwardError("The barcode could not be resolved to one active Product Master item.", "STOCK_INWARD_PRODUCT_CAPTURE_NOT_UNIQUE");
            const quantity = Number(line.scanned_quantity), instant = now().toISOString();
            await run(`UPDATE stock_movement_lines SET recognized_quantity=?,product_id=?,product_state='READY',
                sku_snapshot=?,product_name_snapshot=?,colour_snapshot=?,size_snapshot=?,resolution_note=NULL,updated_at=?
                WHERE id=? AND product_state='PENDING_MASTER' AND posting_state='UNPOSTED'`,
            [quantity,product.id,product.sku,product.product_name,product.colour,product.size,instant,line.id]);
            const currentLine = await get("SELECT * FROM stock_movement_lines WHERE id=?", [line.id]);
            const invoiceRows = await all(`SELECT * FROM stock_movement_invoice_lines
                WHERE movement_id=? AND barcode=? AND expected_quantity>0 ORDER BY line_number`, [movementId,line.barcode]);
            const mrpAllocations = await assignInvoiceMrpToScannedUnits(currentLine,invoiceRows,input.actor || "OPERATOR",instant);
            if (doc.status !== "PARTIALLY_POSTED") await run("UPDATE stock_movements SET status='DRAFT',updated_at=? WHERE id=?", [instant,movementId]);
            const result = await readDocument(movementId);
            result.productCapture = { created:Boolean(capture.created),sku:product.sku };
            result.lastMrpAllocations = mrpAllocations;
            return result;
        }));
    }
    async function resolveBarcode(barcodeInput) {
        const barcode = productBarcodeText(barcodeInput);
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
            if (!line || Number(line.posted_quantity)>0 || line.discarded_at) throw new StockInwardError("This line can no longer be changed.", "STOCK_INWARD_LINE_LOCKED");
            const instant = now().toISOString();
            await run("UPDATE stock_movement_lines SET scanned_quantity=?,recognized_quantity=?,posted_quantity=0,updated_at=? WHERE id=?", [qty,line.product_state === "READY" ? qty : 0,instant,line.id]);
            const currentLine = await get("SELECT * FROM stock_movement_lines WHERE id=?", [line.id]);
            const invoiceRows = await all(`SELECT * FROM stock_movement_invoice_lines
                WHERE movement_id=? AND barcode=? AND expected_quantity>0 ORDER BY line_number`, [doc.id,line.barcode]);
            await assignInvoiceMrpToScannedUnits(currentLine,invoiceRows,input.actor || "CASHIER",instant);
            return readDocument(doc.id);
        }));
    }
    async function removeLine(input = {}) {
        return serialize(() => transaction(async () => {
            const doc = await assertDraft(input.movementId);
            const line = await get("SELECT * FROM stock_movement_lines WHERE id=? AND movement_id=?", [input.lineId,doc.id]);
            if (!line || Number(line.posted_quantity)>0) throw new StockInwardError("Posted lines cannot be removed.", "STOCK_INWARD_LINE_LOCKED");
            await run("DELETE FROM stock_movement_mrp_allocations WHERE movement_line_id=? AND posting_state='UNPOSTED'", [line.id]);
            await run("DELETE FROM stock_movement_lines WHERE id=?", [line.id]);
            return readDocument(doc.id);
        }));
    }
    async function removeUnresolvedLines(input = {}) {
        try {
            const movementId = Number(input.movementId);
            if (!Number.isSafeInteger(movementId) || movementId <= 0) {
                throw new StockInwardError("A valid Stock Inward document is required.", "STOCK_INWARD_NOT_FOUND");
            }
            if (!Array.isArray(input.lineIds) || input.lineIds.length === 0) {
                throw new StockInwardError("Select at least one unresolved barcode entry.", "STOCK_INWARD_BULK_REMOVE_SELECTION_INVALID");
            }
            const lineIds = input.lineIds.map(Number);
            if (lineIds.some(id => !Number.isSafeInteger(id) || id <= 0) ||
                new Set(lineIds).size !== lineIds.length) {
                throw new StockInwardError("The selected unresolved barcode entries are invalid.", "STOCK_INWARD_BULK_REMOVE_SELECTION_INVALID");
            }

            const document = await serialize(() => transaction(async () => {
                const doc = await assertDraft(movementId);
                const lines = await all(
                    "SELECT id,product_state,posting_state,discarded_at FROM stock_movement_lines WHERE movement_id=?",
                    [doc.id]
                );
                const byId = new Map(lines.map(line => [Number(line.id), line]));
                for (const id of lineIds) {
                    const line = byId.get(id);
                    if (!line) {
                        throw new StockInwardError("One or more selected entries do not belong to this Stock Inward.", "STOCK_INWARD_BULK_REMOVE_LINE_INVALID");
                    }
                    if (line.product_state !== "PENDING_MASTER" || line.posting_state !== "UNPOSTED" || line.discarded_at) {
                        throw new StockInwardError("Only unresolved, unposted barcode entries can be removed in bulk.", "STOCK_INWARD_BULK_REMOVE_LINE_INVALID");
                    }
                }
                for (const id of lineIds) {
                    const deletion = await run(
                        `DELETE FROM stock_movement_lines
                         WHERE id=? AND movement_id=? AND product_state='PENDING_MASTER'
                           AND posting_state='UNPOSTED' AND discarded_at IS NULL`,
                        [id, doc.id]
                    );
                    if (deletion.changes !== 1) {
                        throw new StockInwardError("A selected unresolved barcode entry changed before removal.", "STOCK_INWARD_BULK_REMOVE_LINE_INVALID");
                    }
                }
                return readDocument(doc.id);
            }));
            return { success: true, document };
        }
        catch (error) {
            return {
                success: false,
                code: error.code || "STOCK_INWARD_BULK_REMOVE_FAILED",
                message: error.message || "Unable to remove the selected unresolved barcode entries."
            };
        }
    }
    async function retryMatching(movementId) {
        return serialize(() => transaction(async () => {
            const doc = await assertDraft(movementId);
            const lines = await all("SELECT * FROM stock_movement_lines WHERE movement_id=? AND product_state='PENDING_MASTER' AND discarded_at IS NULL ORDER BY id", [doc.id]);
            const attemptedCount = lines.length;
            let matchedCount = 0;
            for (const line of lines) {
                const invoiceLine = await get("SELECT 1 AS found FROM stock_movement_invoice_lines WHERE movement_id=? AND barcode=? AND expected_quantity>0 LIMIT 1", [doc.id,line.barcode]);
                const invoiceUpload = await get("SELECT 1 AS found FROM stock_movement_invoice_lines WHERE movement_id=? LIMIT 1", [doc.id]);
                if (invoiceUpload && !invoiceLine) {
                    await run("UPDATE stock_movement_lines SET resolution_note='NOT ON INVOICE',updated_at=? WHERE id=?",[now().toISOString(),line.id]);
                    continue;
                }
                const found = await productForBarcode(line.barcode);
                if (found.product) {
                    const updated = await run(`UPDATE stock_movement_lines SET product_id=?,product_state='READY',recognized_quantity=scanned_quantity,sku_snapshot=?,product_name_snapshot=?,colour_snapshot=?,size_snapshot=?,resolution_note=NULL,updated_at=? WHERE id=?`,
                        [found.product.id,found.product.sku || null,found.product.product_name || null,found.product.colour || null,found.product.size || null,now().toISOString(),line.id]);
                    if (updated.changes === 1) matchedCount += 1;
                }
                else await run("UPDATE stock_movement_lines SET resolution_note=?,updated_at=? WHERE id=?", [found.resolution === "AMBIGUOUS" ? "AMBIGUOUS BARCODE" : "PRODUCT NOT FOUND",now().toISOString(),line.id]);
            }
            const remaining = await get("SELECT COUNT(*) AS count FROM stock_movement_lines WHERE movement_id=? AND product_state='PENDING_MASTER' AND discarded_at IS NULL", [doc.id]);
            const posted = await get("SELECT COUNT(*) AS count FROM stock_movement_lines WHERE movement_id=? AND posted_quantity>0", [doc.id]);
            const unpostedReady = await get("SELECT COUNT(*) AS count FROM stock_movement_lines WHERE movement_id=? AND product_state='READY' AND posting_state='UNPOSTED' AND discarded_at IS NULL",[doc.id]);
            const current = await readDocument(doc.id);
            const remainsOnInvoice = current.summary.invoiceLines.length > 0 && Number(doc.invoice_total_quantity) > Number(current.summary.scannedQty);
            const hasPending = Number(remaining?.count) + Number(unpostedReady?.count) > 0;
            const status = hasPending || remainsOnInvoice ? (Number(posted?.count) ? "PARTIALLY_POSTED" : "PENDING_MASTER") : (Number(posted?.count) ? "COMPLETE" : "DRAFT");
            await run("UPDATE stock_movements SET status=?,updated_at=? WHERE id=?", [status,now().toISOString(),doc.id]);
            const document = await readDocument(doc.id);
            return {
                ...document,
                retryResult: {
                    attemptedCount,
                    matchedCount,
                    remainingCount: Number(remaining?.count) || 0
                }
            };
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
            const activeUnposted=await get("SELECT COUNT(*) AS n FROM stock_movement_lines WHERE movement_id=? AND product_state='READY' AND recognized_quantity>posted_quantity AND discarded_at IS NULL",[doc.id]);
            const posted=await get("SELECT COUNT(*) AS n FROM stock_movement_lines WHERE movement_id=? AND posted_quantity>0",[doc.id]);
            const remainingExpected = Number(doc.invoice_total_quantity || 0) > Number((await readDocument(doc.id)).summary.scannedQty);
            const hasPending = Number(activeUnresolved.n)+Number(activeUnposted.n)>0 || remainingExpected;
            const nextStatus=hasPending?(Number(posted.n)?"PARTIALLY_POSTED":"PENDING_MASTER"):(Number(posted.n)?"COMPLETE":"DRAFT");
            await run("UPDATE stock_movements SET status=?,updated_at=? WHERE id=?",[nextStatus,instant,doc.id]);
            return readDocument(doc.id);
        }));
    }
    async function cancelDraft(movementId, actor = "USER") {
        return serialize(() => transaction(async () => {
            const doc = await get("SELECT * FROM stock_movements WHERE id=? AND direction='INWARD'", [movementId]);
            if (!doc || ["COMPLETE","CANCELLED","PARTIALLY_POSTED"].includes(doc.status)) throw new StockInwardError("Only a wholly unposted draft can be cancelled.", "STOCK_INWARD_CANCEL_NOT_ALLOWED");
            const posted = await get("SELECT COUNT(*) AS count FROM stock_movement_lines WHERE movement_id=? AND posted_quantity>0", [doc.id]);
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
            const authorizedBusinessDate = businessDate(now());
            if (doc.business_date !== authorizedBusinessDate) {
                throw new StockInwardError("Stock Inward must be posted on the current KLBS business date.", "STOCK_INWARD_BUSINESS_DATE_MISMATCH");
            }
            if (doc.supplier_invoice_id) {
                const invoice = await get("SELECT id,store_id,supplier_id,status FROM supplier_invoices WHERE id=?", [doc.supplier_invoice_id]);
                if (!invoice || invoice.status !== "POSTED" || Number(invoice.store_id) !== activeStore.id || Number(invoice.supplier_id) !== Number(doc.supplier_id)) throw new StockInwardError("Linked Supplier Invoice no longer matches this Supplier and Store.", "STOCK_INWARD_INVOICE_MISMATCH");
            }
            const lines = await all("SELECT * FROM stock_movement_lines WHERE movement_id=? ORDER BY id", [doc.id]);
            const eligible = lines.filter(line => line.product_state === "READY" && ["UNPOSTED","PARTIALLY_POSTED"].includes(line.posting_state) && Number(line.recognized_quantity) > Number(line.posted_quantity) && !line.discarded_at);
            if (!eligible.length) {
                const unresolved = lines.some(line => line.product_state === "PENDING_MASTER" && !line.discarded_at);
                if (unresolved) {
                    const priorPosting = lines.some(line => Number(line.posted_quantity) > 0);
                    const pendingStatus = priorPosting ? "PARTIALLY_POSTED" : "PENDING_MASTER";
                    await run("UPDATE stock_movements SET status=?,updated_at=? WHERE id=?", [pendingStatus,now().toISOString(),doc.id]);
                    return { ...await readDocument(doc.id), posted:false, pendingMaster:true };
                }
                const priorPosting = lines.some(line => Number(line.posted_quantity) > 0);
                if (priorPosting) {
                    const current = await readDocument(doc.id);
                    const remainsOnInvoice = current.summary.invoiceLines.length > 0 && Number(doc.invoice_total_quantity) > Number(current.summary.scannedQty);
                    const remainsUnresolved = current.summary.unresolvedUnits > 0;
                    const status = remainsOnInvoice || remainsUnresolved ? "PARTIALLY_POSTED" : "COMPLETE";
                    await run("UPDATE stock_movements SET status=?,updated_at=? WHERE id=?", [status,now().toISOString(),doc.id]);
                    return { ...await readDocument(doc.id), posted:false, completed:status === "COMPLETE", pendingReceipt:status === "PARTIALLY_POSTED" };
                }
                throw new StockInwardError("There are no recognized items ready to post.", "STOCK_INWARD_NO_ELIGIBLE_LINES");
            }
            const instant = now().toISOString();
            async function logPostedInwardLine(line, quantity, allocations = []) {
                const product = await get("SELECT sku FROM products WHERE id=?", [line.product_id]);
                const sku = String(line.sku_snapshot || product?.sku || "UNKNOWN");
                const mrpSummary = allocations.length
                    ? allocations.map(allocation => `₹${(Number(allocation.mrp_paise)/100).toFixed(2)} × ${Number(allocation.quantity)}`).join(", ")
                    : "No separate MRP bucket";
                await appendActivity(db, {
                    category:"INVENTORY",
                    action:"STOCK_INWARD_LINE_POSTED",
                    details:`${doc.movement_no}; Barcode ${line.barcode}; SKU ${sku}; Quantity ${quantity}; ${mrpSummary}`,
                    user_name:input.actor || "MANAGER",
                    status:"SUCCESS",
                    entity_type:"STOCK_INWARD_LINE",
                    reference_no:doc.movement_no,
                    change_data:{version:1,changes:[
                        {field:"barcode",label:"Barcode",old:null,new:String(line.barcode)},
                        {field:"sku",label:"KLBS SKU",old:null,new:sku},
                        {field:"quantity",label:"Posted quantity",old:"0",new:String(quantity)},
                        {field:"mrp",label:"MRP allocation",old:null,new:mrpSummary}
                    ]}
                }, now());
            }
            for (const line of eligible) {
                const qty = integer(Number(line.recognized_quantity) - Number(line.posted_quantity), "Remaining recognized quantity");
                const mrpAllocations = await all(`SELECT a.*,b.mrp_paise FROM stock_movement_mrp_allocations a
                    JOIN product_mrp_buckets b ON b.id=a.bucket_id WHERE a.movement_line_id=? AND a.posting_state='UNPOSTED' ORDER BY b.mrp_paise`, [line.id]);
                const existingBuckets = await get("SELECT COUNT(*) AS count FROM product_mrp_buckets WHERE product_id=?", [line.product_id]);
                const invoiceRows = await get("SELECT COUNT(*) AS count FROM stock_movement_invoice_lines WHERE movement_id=? AND barcode=?", [doc.id,line.barcode]);
                if (!mrpAllocations.length) {
                    if (Number(existingBuckets?.count || 0) > 0 || Number(invoiceRows?.count || 0) > 0) {
                        throw new StockInwardError(`Assign printed MRP and invoice rate for ${line.barcode} before posting this receipt.`, "STOCK_INWARD_MRP_ALLOCATION_REQUIRED");
                    }
                }
                if (mrpAllocations.length) {
                    if (mrpAllocations.reduce((sum, allocation) => sum + Number(allocation.quantity), 0) !== qty) {
                        throw new StockInwardError(`MRP quantities for ${line.barcode} must equal the received quantity.`, "STOCK_INWARD_MRP_ALLOCATION_INVALID");
                    }
                    for (const allocation of mrpAllocations) {
                        const inserted = await run(`INSERT INTO inventory_transactions(product_id,barcode,transaction_type,quantity,reference_type,reference_id,supplier_id,invoice_no,remarks,created_by,created_at,mrp_bucket_id)
                            VALUES(?,?,'INWARD',?,'STOCK_INWARD',?,?,?,?,?,?,?)`, [line.product_id,line.barcode,allocation.quantity,doc.movement_no,doc.supplier_id,doc.invoice_no,
                            `Stock Inward ${doc.movement_no} · MRP ₹${(Number(allocation.mrp_paise)/100).toFixed(2)}`,input.actor || "MANAGER",instant,allocation.bucket_id]);
                        await run("UPDATE stock_movement_mrp_allocations SET posting_state='POSTED',posted_quantity=quantity,inventory_transaction_id=? WHERE id=? AND posting_state='UNPOSTED'", [inserted.lastID,allocation.id]);
                        await run(`INSERT INTO stock_receipt_layers(bucket_id,supplier_invoice_id,supplier_id,invoice_no,invoice_date,quantity_received,unit_cost_paise,cost_basis_status,cost_source,source_movement_allocation_id,source_movement_line_id,received_at,created_by)
                            VALUES(?,?,?,?,?,?,?,'CAPTURED','SUPPLIER_INVOICE',?,?,?,?)`, [allocation.bucket_id,doc.supplier_invoice_id,doc.supplier_id,doc.invoice_no,doc.invoice_date,
                            allocation.quantity,allocation.unit_cost_paise,allocation.id,line.id,instant,input.actor || "MANAGER"]);
                    }
                    const nextPostedQuantity = Number(line.posted_quantity) + qty;
                    const nextPostingState = nextPostedQuantity === Number(line.recognized_quantity) ? "POSTED" : "PARTIALLY_POSTED";
                    await run("UPDATE stock_movement_lines SET posting_state=?,posted_quantity=?,inventory_transaction_id=NULL,updated_at=? WHERE id=?", [nextPostingState,nextPostedQuantity,instant,line.id]);
                    await logPostedInwardLine(line, qty, mrpAllocations);
                    continue;
                }
                const insert = await run(`INSERT INTO inventory_transactions(product_id,barcode,transaction_type,quantity,reference_type,reference_id,supplier_id,invoice_no,remarks,created_by,created_at)
                    VALUES(?,?,'INWARD',?,'STOCK_INWARD',?,?,?,?,?,?)`, [line.product_id,line.barcode,qty,doc.movement_no,doc.supplier_id,doc.invoice_no,`Stock Inward ${doc.movement_no}`,input.actor || "MANAGER",instant]);
                const nextPostedQuantity = Number(line.posted_quantity) + qty;
                const nextPostingState = nextPostedQuantity === Number(line.recognized_quantity) ? "POSTED" : "PARTIALLY_POSTED";
                await run("UPDATE stock_movement_lines SET posting_state=?,posted_quantity=?,inventory_transaction_id=?,updated_at=? WHERE id=?", [nextPostingState,nextPostedQuantity,insert.lastID,instant,line.id]);
                await logPostedInwardLine(line, qty);
            }
            const unresolved = lines.some(line => line.product_state === "PENDING_MASTER" && !line.discarded_at);
            const snapshot = await readDocument(doc.id);
            const remainsOnInvoice = snapshot.summary.invoiceLines.length > 0 && Number(doc.invoice_total_quantity) > Number(snapshot.summary.scannedQty);
            const status = unresolved || remainsOnInvoice ? "PARTIALLY_POSTED" : "COMPLETE";
            const postedUnits = eligible.reduce((sum, line) => sum + Math.max(0, Number(line.recognized_quantity) - Number(line.posted_quantity)), 0);
            const previouslyPostedUnits = lines.reduce((sum, line) => sum + Number(line.posted_quantity), 0);
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
            const unresolvedUnits = snapshot.summary.unresolvedUnits;
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
        const invoiceLines = await all("SELECT * FROM stock_movement_invoice_lines WHERE movement_id=? ORDER BY line_number", [movementId]);
        const invoiceByBarcode = new Map();
        for (const invoiceLine of invoiceLines) if (!invoiceByBarcode.has(invoiceLine.barcode)) invoiceByBarcode.set(invoiceLine.barcode,invoiceLine);
        const doc = await get("SELECT * FROM stock_movements WHERE id=?", [movementId]);
        const results = [];
        for (const line of lines) {
            const found = await productForBarcode(line.barcode);
            const invoiceLine = invoiceByBarcode.get(line.barcode) || null;
            const productDraft = invoiceLine ? productDraftFromInvoice(invoiceLine,doc) : null;
            results.push({ ...line,currentResolution:found.resolution,
                currentProduct:found.product ? {id:found.product.id,sku:found.product.sku,product_name:found.product.product_name,colour:found.product.colour,size:found.product.size} : null,
                invoiceLine,productDraft:productDraft?.draft || null,missingProductFields:productDraft?.missing || [],hasInvoiceLine:Boolean(invoiceLine) });
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
    return { createDraft,updateContext,scan,createProductFromInvoice,importInvoiceLines,resolveBarcode,editLine,removeLine,removeUnresolvedLines,retryMatching,discardLine,cancelDraft,listResumable,listRecentHistory,abandonEmptyDraft,load,post,getUnknownExportRows,getSuppliers,getSupplierInvoices,productForBarcode,findDuplicateInvoice,currentMasterForUnresolved,archiveCancelled };
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
    ...Object.fromEntries(["createDraft","updateContext","scan","createProductFromInvoice","importInvoiceLines","resolveBarcode","editLine","removeLine","removeUnresolvedLines","retryMatching","discardLine","cancelDraft","listResumable","listRecentHistory","abandonEmptyDraft","load","post","getUnknownExportRows","getSuppliers","getSupplierInvoices","findDuplicateInvoice","currentMasterForUnresolved","archiveCancelled"].map(name => [name,async (...args)=>(await defaultService())[name](...args)])) };
