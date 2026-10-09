"use strict";

const { addBusinessCalendarDays, getBusinessDate } = require("./businessDate");
const { validateIndianMobile } = require("../shared/supplierContactValidation");
const SUPPLIER_TYPES = Object.freeze(["DISTRIBUTOR", "COMPANY", "WHOLESALER", "OTHER"]);
const BUSINESS_SEGMENTS = Object.freeze(["KL", "MENS", "KIDS"]);
const PAYMENT_MODES = Object.freeze(["Cash", "UPI", "Card", "Bank Transfer", "Other"]);
const PAGE_SIZE = 50;

class SupplierAccountError extends Error {
    constructor(message, code) { super(message); this.name = "SupplierAccountError"; this.code = code; }
}

function positivePaise(value, label, allowZero = false) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < (allowZero ? 0 : 1)) throw new SupplierAccountError(`${label} must be ${allowZero ? "zero or a positive" : "a positive"} integer number of paise.`, "SUPPLIER_AMOUNT_INVALID");
    return number;
}
function validDate(value, label, latest = null) {
    const text = String(value || "").trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) throw new SupplierAccountError(`Enter a valid ${label}.`, "SUPPLIER_DATE_INVALID");
    const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
    if (date.getUTCFullYear() !== +match[1] || date.getUTCMonth() !== +match[2] - 1 || date.getUTCDate() !== +match[3]) throw new SupplierAccountError(`Enter a valid ${label}.`, "SUPPLIER_DATE_INVALID");
    if (latest && text > latest) throw new SupplierAccountError(`${label} cannot be in the future.`, "SUPPLIER_DATE_FUTURE");
    return text;
}
function text(value, label, max, required = false) {
    const result = String(value ?? "").trim();
    if (required && !result) throw new SupplierAccountError(`${label} is required.`, "SUPPLIER_FIELD_REQUIRED");
    if (result.length > max) throw new SupplierAccountError(`${label} must be ${max} characters or fewer.`, "SUPPLIER_FIELD_TOO_LONG");
    return result || null;
}
const CONTACT_PERSON_PATTERN = /^\p{L}[\p{L}\p{M}]*(?:[.'’-]\p{L}[\p{L}\p{M}]*)*\.?(?: \p{L}[\p{L}\p{M}]*(?:[.'’-]\p{L}[\p{L}\p{M}]*)*\.?)*$/u;
function normalizeContactPerson(value) {
    const normalized = String(value ?? "").normalize("NFC").trim().replace(/\s+/gu, " ");
    if (!normalized) throw new SupplierAccountError("Contact Person is required.", "SUPPLIER_FIELD_REQUIRED");
    if (!CONTACT_PERSON_PATTERN.test(normalized)) throw new SupplierAccountError("Enter a valid contact person name.", "SUPPLIER_CONTACT_PERSON_INVALID");
    return text(normalized, "Contact Person", 120, true);
}
function normalizeIndianMobile(value, label, required) {
    const result = validateIndianMobile(value, required);
    if (!result.valid) throw new SupplierAccountError(`${label} must be a valid 10-digit Indian mobile number.`, "SUPPLIER_MOBILE_INVALID");
    return result.value || null;
}
function normalizeSupplier(input = {}) {
    const name = text(input.name, "Supplier Name", 200, true);
    const supplierType = String(input.supplierType || input.supplier_type || "").trim().toUpperCase();
    if (!SUPPLIER_TYPES.includes(supplierType)) throw new SupplierAccountError("Select a valid Supplier Type.", "SUPPLIER_TYPE_INVALID");
    const status = String(input.status || "ACTIVE").toUpperCase();
    if (!new Set(["ACTIVE", "INACTIVE"]).has(status)) throw new SupplierAccountError("Select ACTIVE or INACTIVE status.", "SUPPLIER_STATUS_INVALID");
    const credit = Number(input.defaultCreditPeriodDays ?? input.default_credit_period_days ?? 0);
    if (!Number.isInteger(credit) || credit < 0 || credit > 3650) throw new SupplierAccountError("Default Credit Period must be from 0 to 3650 days.", "SUPPLIER_CREDIT_PERIOD_INVALID");
    const result = { name, supplierType, status, credit };
    for (const [key, max] of Object.entries({ legalName: 200, email: 254, gstin: 15, pan: 10, addressLine1: 200, addressLine2: 200, city: 100, district: 100, state: 100, pinCode: 10, notes: 2000 })) result[key] = text(input[key] ?? input[key.replace(/[A-Z]/g, m => `_${m.toLowerCase()}`)], key, max);
    result.contactPerson = normalizeContactPerson(input.contactPerson ?? input.contact_person);
    result.mobile = normalizeIndianMobile(input.mobile, "Primary Mobile", true);
    result.alternateMobile = normalizeIndianMobile(input.alternateMobile ?? input.alternate_mobile, "Alternate Mobile", false);
    if (!result.state) throw new SupplierAccountError("State is required.", "SUPPLIER_STATE_REQUIRED");
    result.gstin = result.gstin ? result.gstin.toUpperCase() : null;
    result.pan = result.pan ? result.pan.toUpperCase() : null;
    if (result.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(result.email)) throw new SupplierAccountError("Enter a valid Email address.", "SUPPLIER_EMAIL_INVALID");
    if (result.gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/.test(result.gstin)) throw new SupplierAccountError("Enter a valid GSTIN or leave it blank.", "SUPPLIER_GSTIN_INVALID");
    if (result.pan && !/^[A-Z]{5}\d{4}[A-Z]$/.test(result.pan)) throw new SupplierAccountError("Enter a valid PAN or leave it blank.", "SUPPLIER_PAN_INVALID");
    if (result.pinCode && !/^[1-9]\d{5}$/.test(result.pinCode)) throw new SupplierAccountError("Enter a valid 6-digit Indian PIN Code or leave it blank.", "SUPPLIER_PIN_INVALID");
    result.relationships = normalizeRelationships(input.relationships || []);
    if (input.requireRelationship && !result.relationships.length) throw new SupplierAccountError("Add at least one Business Relationship.", "SUPPLIER_RELATIONSHIP_REQUIRED");
    return result;
}
function normalizeRelationships(values) {
    if (!Array.isArray(values)) return [];
    const unique = new Map();
    for (const row of values) {
        const brand = cleanRelationshipValue(row?.brand, "Brand");
        const productSegment = cleanRelationshipValue(row?.productSegment ?? row?.product_segment, "Product Segment");
        const businessSegment = String(row?.businessSegment ?? row?.business_segment ?? "").trim().toUpperCase();
        if (!BUSINESS_SEGMENTS.includes(businessSegment)) throw new SupplierAccountError("Select KL, MENS, or KIDS for each relationship.", "SUPPLIER_SEGMENT_INVALID");
        const brandNormalized = relationshipKey(brand);
        const productSegmentNormalized = relationshipKey(productSegment);
        const key = `${brandNormalized}\u0000${productSegmentNormalized}\u0000${businessSegment}`;
        if (unique.has(key)) throw new SupplierAccountError("This Supplier relationship already exists.", "SUPPLIER_RELATIONSHIP_DUPLICATE");
        const effectiveFrom = row?.effectiveFrom ?? row?.effective_from ?? null;
        if (effectiveFrom) validDate(effectiveFrom, "Relationship Effective From");
        unique.set(key, { brand, brandNormalized, productSegment, productSegmentNormalized, businessSegment, brandCode: row?.brandCode ?? row?.brand_code ?? null, productSegmentCode: row?.productSegmentCode ?? row?.product_segment_code ?? null, relationshipCode: row?.relationshipCode ?? row?.relationship_code ?? null, effectiveFrom });
    }
    return [...unique.values()];
}
function cleanRelationshipValue(value, label) {
    const normalized = String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ");
    if (!normalized) throw new SupplierAccountError(`${label} is required for each Business Relationship.`, "SUPPLIER_RELATIONSHIP_INVALID");
    if (normalized.length > 100) throw new SupplierAccountError(`${label} must be 100 characters or fewer.`, "SUPPLIER_RELATIONSHIP_INVALID");
    return normalized;
}
function relationshipKey(value) { return String(value).normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-IN"); }
function cleanList(values, max) {
    if (!Array.isArray(values)) return [];
    const seen = new Set();
    const list = values.map(value => String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ")).filter(value => {
        if (!value) return false;
        const key = value.toLocaleLowerCase("en-IN");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    if (list.some(value => value.length > max)) throw new SupplierAccountError("A relationship value is too long.", "SUPPLIER_RELATIONSHIP_INVALID");
    return list;
}

function createSupplierDistributorService(database, options = {}) {
    if (!database || typeof database.run !== "function") throw new TypeError("SQLite database connection required.");
    const now = options.now || (() => new Date());
    const getCurrentStore = options.getCurrentStore || (() => require("./storeIdentityService").getCurrentStore());
    const appendActivity = options.appendActivityInTransaction || ((db, event, time) => require("./activityService").appendActivityInTransaction(db, event, time));
    const security = options.security || null;
    const run = (sql, params = []) => new Promise((resolve, reject) => database.run(sql, params, function(error) { error ? reject(error) : resolve({ lastID: this.lastID, changes: this.changes }); }));
    const get = (sql, params = []) => new Promise((resolve, reject) => database.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
    const all = (sql, params = []) => new Promise((resolve, reject) => database.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
    const businessDate = () => (options.getBusinessDate || getBusinessDate)(now());
    async function store() {
        const value = await getCurrentStore();
        if (!value || !Number.isSafeInteger(Number(value.id)) || value.status !== "ACTIVE") throw new SupplierAccountError("The active Store identity could not be resolved.", "SUPPLIER_STORE_UNAVAILABLE");
        return { ...value, id: Number(value.id) };
    }
    function authorize(grant, purpose) {
        if (!security || !security.consumeGrant || !security.consumeGrant(grant, purpose)) throw new SupplierAccountError("Manager authorization is missing, invalid, or expired.", "SUPPLIER_MANAGER_AUTH_REQUIRED");
    }
    async function reserveCode(column, prefix) {
        const allowed = { supplier: "next_supplier_sequence", invoice: "next_invoice_sequence", payment: "next_payment_sequence" };
        const field = allowed[column];
        if (!field) throw new Error("Invalid supplier identity sequence.");
        const sequence = await get(`SELECT ${field} AS next_sequence FROM supplier_sequences WHERE id=1`);
        const next = Number(sequence?.next_sequence);
        if (!Number.isInteger(next) || next < 1 || next > 999999) throw new SupplierAccountError(`${prefix} identity sequence exhausted.`, "SUPPLIER_SEQUENCE_EXHAUSTED");
        const updated = await run(`UPDATE supplier_sequences SET ${field}=? WHERE id=1 AND ${field}=?`, [next + 1, next]);
        if (updated.changes !== 1) throw new Error("Supplier sequence changed unexpectedly.");
        return `${prefix}${String(next).padStart(6, "0")}`;
    }
    async function reserveSubledgerCode(kind, prefix) {
        const fields={opening:"next_opening_sequence",creditNote:"next_credit_note_sequence"},field=fields[kind];
        if(!field)throw new Error("Invalid Supplier subledger sequence.");
        const row=await get(`SELECT ${field} AS next_sequence FROM supplier_subledger_sequences WHERE id=1`),next=Number(row?.next_sequence);
        if(!Number.isInteger(next)||next<1||next>999999)throw new SupplierAccountError(`${prefix} identity sequence exhausted.`,"SUPPLIER_SEQUENCE_EXHAUSTED");
        const update=await run(`UPDATE supplier_subledger_sequences SET ${field}=? WHERE id=1 AND ${field}=?`,[next+1,next]);
        if(update.changes!==1)throw new Error("Supplier subledger sequence changed unexpectedly.");
        return `${prefix}${String(next).padStart(6,"0")}`;
    }
    async function reserveRelationshipCode(kind, prefix) {
        const fields = { brand: "next_brand_sequence", productSegment: "next_product_segment_sequence", relationship: "next_relationship_sequence" };
        const field = fields[kind];
        if (!field) throw new Error("Invalid Supplier relationship identity sequence.");
        const row = await get(`SELECT ${field} AS next_sequence FROM supplier_relationship_sequences WHERE id=1`);
        const next = Number(row?.next_sequence);
        if (!Number.isInteger(next) || next < 1 || next > 999999) throw new SupplierAccountError(`${prefix} identity sequence exhausted.`, "SUPPLIER_SEQUENCE_EXHAUSTED");
        const result = await run(`UPDATE supplier_relationship_sequences SET ${field}=? WHERE id=1 AND ${field}=?`, [next + 1, next]);
        if (result.changes !== 1) throw new Error("Supplier relationship sequence changed unexpectedly.");
        return `${prefix}${String(next).padStart(6, "0")}`;
    }
    async function createVocabulary(kind, rawValue) {
        const configs = {
            brand: { table: "supplier_brand_master", nameColumn: "display_name", normalizedColumn: "normalized_name", codeColumn: "brand_code", prefix: "KLSBR", sequence: "brand", label: "Brand", action: "SUPPLIER_BRAND_CREATED" },
            productSegment: { table: "supplier_product_segment_master", nameColumn: "display_name", normalizedColumn: "normalized_name", codeColumn: "product_segment_code", prefix: "KLSPS", sequence: "productSegment", label: "Product Segment", action: "SUPPLIER_PRODUCT_SEGMENT_CREATED" }
        };
        const config = configs[kind];
        if (!config) throw new Error("Invalid Supplier vocabulary type.");
        const display = cleanRelationshipValue(rawValue, config.label);
        const normalized = relationshipKey(display);
        await run("BEGIN IMMEDIATE TRANSACTION");
        try {
            const existing = await get(`SELECT ${config.codeColumn} AS code,${config.nameColumn} AS name,status FROM ${config.table} WHERE ${config.normalizedColumn}=?`, [normalized]);
            if (existing) throw new SupplierAccountError(`${config.label} already exists in Supplier vocabulary.`, "SUPPLIER_VOCABULARY_DUPLICATE");
            const code = await reserveRelationshipCode(config.sequence, config.prefix);
            const timestamp = now().toISOString();
            await run(`INSERT INTO ${config.table}(${config.codeColumn},${config.nameColumn},${config.normalizedColumn},status,created_at,updated_at) VALUES(?,?,?,'ACTIVE',?,?)`, [code, display, normalized, timestamp, timestamp]);
            await appendActivity(database, { category: "ACCOUNTING", action: config.action, details: `${config.label} ${code} created: ${display}`, user_name: "OPERATOR", status: "SUCCESS", entity_type: "SUPPLIER", reference_no: code }, now());
            await run("COMMIT");
            return { code, name: display, status: "ACTIVE" };
        } catch (error) { await run("ROLLBACK").catch(() => {}); throw error; }
    }
    async function resolveRelationship(row) {
        const [value] = normalizeRelationships([row]);
        const brand = await get("SELECT id,brand_code,display_name,status FROM supplier_brand_master WHERE normalized_name=?", [value.brandNormalized]);
        const productSegment = await get("SELECT id,product_segment_code,display_name,status FROM supplier_product_segment_master WHERE normalized_name=?", [value.productSegmentNormalized]);
        if (!brand || brand.status !== "ACTIVE") throw new SupplierAccountError("Select an active Supplier Brand from the suggestions or add it explicitly.", "SUPPLIER_BRAND_REQUIRED");
        if (!productSegment || productSegment.status !== "ACTIVE") throw new SupplierAccountError("Select an active Supplier Product Segment from the suggestions or add it explicitly.", "SUPPLIER_PRODUCT_SEGMENT_REQUIRED");
        if (value.brandCode && String(value.brandCode).toUpperCase() !== brand.brand_code) throw new SupplierAccountError("The selected Supplier Brand changed. Refresh and select it again.", "SUPPLIER_BRAND_INVALID");
        if (value.productSegmentCode && String(value.productSegmentCode).toUpperCase() !== productSegment.product_segment_code) throw new SupplierAccountError("The selected Supplier Product Segment changed. Refresh and select it again.", "SUPPLIER_PRODUCT_SEGMENT_INVALID");
        return { ...value, brandId: Number(brand.id), brandCode: brand.brand_code, brand: brand.display_name, productSegmentId: Number(productSegment.id), productSegmentCode: productSegment.product_segment_code, productSegment: productSegment.display_name };
    }
    async function insertRelationships(id, relationships) {
        for (const source of relationships) {
            const row = await resolveRelationship(source), timestamp = now().toISOString(), effectiveFrom = row.effectiveFrom || businessDate(), code = await reserveRelationshipCode("relationship", "KLSREL");
            await run("INSERT INTO supplier_relationships(relationship_code,supplier_id,brand_id,product_segment_id,business_segment,status,effective_from,effective_to,created_at,updated_at) VALUES(?,?,?,?,?,'ACTIVE',?,NULL,?,?)", [code,id,row.brandId,row.productSegmentId,row.businessSegment,effectiveFrom,timestamp,timestamp]);
            await appendActivity(database, { category: "ACCOUNTING", action: "SUPPLIER_RELATIONSHIP_CREATED", details: `Supplier relationship ${code} created for ${row.brand} / ${row.productSegment} / ${row.businessSegment}`, user_name: "OPERATOR", status: "SUCCESS", entity_type: "SUPPLIER", reference_no: code }, now());
        }
    }
    async function getSupplierByCode(code) {
        const row = await get("SELECT * FROM supplier_master WHERE supplier_code=?", [String(code || "").toUpperCase()]);
        if (!row) return null;
        const relationshipHistory = await all(`SELECT r.relationship_code AS relationshipCode,b.display_name AS brand,b.brand_code AS brandCode,p.display_name AS productSegment,p.product_segment_code AS productSegmentCode,r.business_segment AS businessSegment,r.status,r.effective_from AS effectiveFrom,r.effective_to AS effectiveTo,r.created_at AS createdAt,r.updated_at AS updatedAt
            FROM supplier_relationships r JOIN supplier_brand_master b ON b.id=r.brand_id JOIN supplier_product_segment_master p ON p.id=r.product_segment_id
            WHERE r.supplier_id=? ORDER BY r.effective_from,r.relationship_code`, [row.id]);
        const relationships = relationshipHistory.filter(item => item.status === "ACTIVE" && item.effectiveTo === null).sort((a,b)=>a.brand.localeCompare(b.brand)||a.productSegment.localeCompare(b.productSegment)||a.businessSegment.localeCompare(b.businessSegment));
        const summary = await getSupplierSummary(row.id);
        const { id, ...publicProfile } = row;
        return { ...publicProfile, relationships, relationshipHistory, brands: [...new Set(relationships.map(x=>x.brand))].sort((a,b)=>a.localeCompare(b)), productSegments: [...new Set(relationships.map(x=>x.productSegment))].sort((a,b)=>a.localeCompare(b)), businessSegments: [...new Set(relationships.map(x=>x.businessSegment))].sort(), ...summary };
    }
    async function createSupplier(input) {
        const value = normalizeSupplier({ ...input, requireRelationship: true }); const timestamp = now().toISOString();
        await run("BEGIN IMMEDIATE TRANSACTION");
        try {
            const code = await reserveCode("supplier", "KLSUP");
            const inserted = await run(`INSERT INTO supplier_master(supplier_code,name,legal_name,status,supplier_type,contact_person,mobile,alternate_mobile,email,gstin,pan,address_line_1,address_line_2,city,district,state,pin_code,default_credit_period_days,notes,created_at,updated_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [code,value.name,value.legalName,value.status,value.supplierType,value.contactPerson,value.mobile,value.alternateMobile,value.email,value.gstin,value.pan,value.addressLine1,value.addressLine2,value.city,value.district,value.state,value.pinCode,value.credit,value.notes,timestamp,timestamp]);
            await insertRelationships(inserted.lastID, value.relationships);
            await appendActivity(database,{category:"ACCOUNTING",action:"SUPPLIER_CREATED",details:`Supplier ${code} created: ${value.name}`,user_name:"OPERATOR",status:"SUCCESS",entity_type:"SUPPLIER",reference_no:code},now());
            await run("COMMIT"); return getSupplierByCode(code);
        } catch(error) { await run("ROLLBACK").catch(()=>{}); throw error; }
    }
    async function updateSupplier(code, input) {
        const value = normalizeSupplier(input); const old = await getSupplierByCode(code);
        if (!old) throw new SupplierAccountError("Supplier was not found.","SUPPLIER_NOT_FOUND");
        const internal = await get("SELECT id FROM supplier_master WHERE supplier_code=?", [old.supplier_code]);
        const timestamp = now().toISOString();
        await run("BEGIN IMMEDIATE TRANSACTION");
        try {
            await run(`UPDATE supplier_master SET name=?,legal_name=?,status=?,supplier_type=?,contact_person=?,mobile=?,alternate_mobile=?,email=?,gstin=?,pan=?,address_line_1=?,address_line_2=?,city=?,district=?,state=?,pin_code=?,default_credit_period_days=?,notes=?,updated_at=? WHERE id=?`, [value.name,value.legalName,value.status,value.supplierType,value.contactPerson,value.mobile,value.alternateMobile,value.email,value.gstin,value.pan,value.addressLine1,value.addressLine2,value.city,value.district,value.state,value.pinCode,value.credit,value.notes,timestamp,internal.id]);
            if (Array.isArray(input.relationships)) {
                const current = await all("SELECT r.relationship_code AS relationshipCode,r.effective_from,b.normalized_name AS brandNormalized,p.normalized_name AS productSegmentNormalized,r.business_segment AS businessSegment FROM supplier_relationships r JOIN supplier_brand_master b ON b.id=r.brand_id JOIN supplier_product_segment_master p ON p.id=r.product_segment_id WHERE r.supplier_id=? AND r.status='ACTIVE' AND r.effective_to IS NULL", [internal.id]);
                const key = item => `${item.brandNormalized}\u0000${item.productSegmentNormalized}\u0000${item.businessSegment}`;
                const desired = new Map(value.relationships.map(item => [key(item), item]));
                const existing = new Map(current.map(item => [key(item), item]));
                const endDate = businessDate();
                for (const oldRelationship of current) {
                    if (!desired.has(key(oldRelationship))) {
                        if (endDate < oldRelationship.effective_from) throw new SupplierAccountError("A relationship cannot end before its effective date.", "SUPPLIER_RELATIONSHIP_DATE_INVALID");
                        const ended = await run("UPDATE supplier_relationships SET status='INACTIVE',effective_to=?,updated_at=? WHERE relationship_code=? AND status='ACTIVE'", [endDate,timestamp,oldRelationship.relationshipCode]);
                        if (ended.changes !== 1) throw new SupplierAccountError("The Supplier relationship changed before it could be ended.", "SUPPLIER_RELATIONSHIP_NOT_FOUND");
                        await appendActivity(database,{category:"ACCOUNTING",action:"SUPPLIER_RELATIONSHIP_ENDED",details:`Supplier relationship ${oldRelationship.relationshipCode} ended on ${endDate}`,user_name:"OPERATOR",status:"SUCCESS",entity_type:"SUPPLIER",reference_no:oldRelationship.relationshipCode},now());
                    }
                }
                const additions = [...desired].filter(([itemKey]) => !existing.has(itemKey)).map(([,item]) => item);
                await insertRelationships(internal.id, additions);
            }
            await appendActivity(database,{category:"ACCOUNTING",action:old.status===value.status?"SUPPLIER_UPDATED":"SUPPLIER_STATUS_CHANGED",details:`Supplier ${old.supplier_code} updated`,user_name:"OPERATOR",status:"SUCCESS",entity_type:"SUPPLIER",reference_no:old.supplier_code},now());
            await run("COMMIT"); return getSupplierByCode(code);
        } catch(error) { await run("ROLLBACK").catch(()=>{}); throw error; }
    }
    async function addSupplierRelationship(code, input) {
        const supplier = await get("SELECT id FROM supplier_master WHERE supplier_code=?", [String(code||"").trim().toUpperCase()]);
        if (!supplier) throw new SupplierAccountError("Supplier was not found.", "SUPPLIER_NOT_FOUND");
        const [relationship] = normalizeRelationships([input]);
        try {
            await run("BEGIN IMMEDIATE TRANSACTION");
            await insertRelationships(supplier.id,[relationship]);
            await run("COMMIT");
        } catch (error) {
            await run("ROLLBACK").catch(()=>{});
            if (/UNIQUE|constraint/i.test(error.message)) throw new SupplierAccountError("This Supplier relationship already exists.", "SUPPLIER_RELATIONSHIP_DUPLICATE");
            throw error;
        }
        return getSupplierByCode(code);
    }
    async function updateSupplierRelationship(code, previous, input) {
        const supplier = await get("SELECT id FROM supplier_master WHERE supplier_code=?", [String(code||"").trim().toUpperCase()]);
        if (!supplier) throw new SupplierAccountError("Supplier was not found.", "SUPPLIER_NOT_FOUND");
        const relationshipCode = String(previous?.relationshipCode || previous?.relationship_code || "").trim().toUpperCase();
        if (!relationshipCode) throw new SupplierAccountError("A relationship business code is required.", "SUPPLIER_RELATIONSHIP_NOT_FOUND");
        const [after] = normalizeRelationships([input]);
        const replacementStart = after.effectiveFrom || businessDate();
        const endDate = new Date(`${replacementStart}T00:00:00.000Z`);
        endDate.setUTCDate(endDate.getUTCDate()-1);
        const effectiveTo = endDate.toISOString().slice(0,10);
        const timestamp = now().toISOString();
        await run("BEGIN IMMEDIATE TRANSACTION");
        try {
            const old = await get("SELECT * FROM supplier_relationships WHERE supplier_id=? AND relationship_code=? AND status='ACTIVE' AND effective_to IS NULL",[supplier.id,relationshipCode]);
            if (!old) throw new SupplierAccountError("The active Supplier relationship was not found.", "SUPPLIER_RELATIONSHIP_NOT_FOUND");
            const [before] = await all("SELECT b.normalized_name AS brand,p.normalized_name AS product_segment,r.business_segment FROM supplier_relationships r JOIN supplier_brand_master b ON b.id=r.brand_id JOIN supplier_product_segment_master p ON p.id=r.product_segment_id WHERE r.id=?",[old.id]);
            if (relationshipKey(before.brand)===after.brandNormalized&&relationshipKey(before.product_segment)===after.productSegmentNormalized&&before.business_segment===after.businessSegment) { await run("COMMIT"); return getSupplierByCode(code); }
            if (effectiveTo < old.effective_from) throw new SupplierAccountError("A replacement relationship must start after the current relationship began.", "SUPPLIER_RELATIONSHIP_DATE_INVALID");
            await run("UPDATE supplier_relationships SET status='INACTIVE',effective_to=?,updated_at=? WHERE id=?",[effectiveTo,timestamp,old.id]);
            await appendActivity(database,{category:"ACCOUNTING",action:"SUPPLIER_RELATIONSHIP_ENDED",details:`Supplier relationship ${relationshipCode} ended on ${effectiveTo} before replacement`,user_name:"OPERATOR",status:"SUCCESS",entity_type:"SUPPLIER",reference_no:relationshipCode},now());
            await insertRelationships(supplier.id,[after]);
            await run("COMMIT");
        } catch (error) {
            await run("ROLLBACK").catch(()=>{});
            if (/UNIQUE|constraint/i.test(error.message)) throw new SupplierAccountError("This Supplier relationship already exists.", "SUPPLIER_RELATIONSHIP_DUPLICATE");
            throw error;
        }
        return getSupplierByCode(code);
    }
    async function endSupplierRelationship(code, relationshipCode, effectiveTo = businessDate()) {
        const supplier = await get("SELECT id FROM supplier_master WHERE supplier_code=?", [String(code||"").trim().toUpperCase()]);
        if (!supplier) throw new SupplierAccountError("Supplier was not found.", "SUPPLIER_NOT_FOUND");
        const date = validDate(effectiveTo, "Relationship Effective To", businessDate()), timestamp = now().toISOString();
        await run("BEGIN IMMEDIATE TRANSACTION");
        try {
            const row = await get("SELECT id,effective_from FROM supplier_relationships WHERE supplier_id=? AND relationship_code=? AND status='ACTIVE' AND effective_to IS NULL",[supplier.id,String(relationshipCode||"").toUpperCase()]);
            if (!row) throw new SupplierAccountError("The active Supplier relationship was not found.", "SUPPLIER_RELATIONSHIP_NOT_FOUND");
            if (date < row.effective_from) throw new SupplierAccountError("Relationship Effective To cannot precede Effective From.", "SUPPLIER_RELATIONSHIP_DATE_INVALID");
            await run("UPDATE supplier_relationships SET status='INACTIVE',effective_to=?,updated_at=? WHERE id=?",[date,timestamp,row.id]);
            await appendActivity(database,{category:"ACCOUNTING",action:"SUPPLIER_RELATIONSHIP_ENDED",details:`Supplier relationship ${relationshipCode} ended on ${date}`,user_name:"OPERATOR",status:"SUCCESS",entity_type:"SUPPLIER",reference_no:relationshipCode},now());
            await run("COMMIT");
        } catch(error) { await run("ROLLBACK").catch(()=>{}); throw error; }
        return getSupplierByCode(code);
    }
    async function removeSupplierRelationship(code, input) { return endSupplierRelationship(code,input?.relationshipCode||input?.relationship_code,businessDate()); }
    async function searchSuppliersByBrand(value) {
        const key = relationshipKey(value);
        if (!key) return [];
        return all("SELECT DISTINCT s.supplier_code,s.name,s.status FROM supplier_master s JOIN supplier_relationships r ON r.supplier_id=s.id WHERE r.status='ACTIVE' AND r.effective_to IS NULL AND r.brand_id IN (SELECT id FROM supplier_brand_master WHERE normalized_name LIKE ? AND status='ACTIVE') ORDER BY s.name,s.supplier_code", [`%${key}%`]);
    }
    async function listSuppliers({search="",page=1,pageSize=PAGE_SIZE,activeOnly=false}={}) {
        const query=String(search||"").trim().slice(0,200), safeSize=Math.max(1,Math.min(100,Number(pageSize)||PAGE_SIZE)), safePage=Math.max(1,Number(page)||1);
        const clauses=[]; const params=[];
        if(activeOnly) clauses.push("s.status='ACTIVE'");
        if(query){clauses.push("(s.supplier_code LIKE ? OR s.name LIKE ? OR COALESCE(s.mobile,'') LIKE ? OR EXISTS(SELECT 1 FROM supplier_relationships sr JOIN supplier_brand_master sb ON sb.id=sr.brand_id WHERE sr.supplier_id=s.id AND sr.status='ACTIVE' AND sb.normalized_name LIKE ?))"); const p=`%${query}%`; params.push(p,p,p,`%${relationshipKey(query)}%`);}
        const where=clauses.length?`WHERE ${clauses.join(" AND ")}`:"";
        const count=await get(`SELECT COUNT(*) AS n FROM supplier_master s ${where}`,params); const totalCount=Number(count?.n||0), totalPages=Math.max(1,Math.ceil(totalCount/safeSize)), current=Math.min(safePage,totalPages);
        const baseRows=await all(`SELECT s.id AS _internal_id,s.supplier_code,s.name,s.supplier_type,s.mobile,s.status,
            (SELECT group_concat(DISTINCT r.business_segment) FROM supplier_relationships r WHERE r.supplier_id=s.id AND r.status='ACTIVE' AND r.effective_to IS NULL) AS business_segments,
            (SELECT group_concat(b.display_name,' · ') FROM (SELECT sb.display_name,sb.normalized_name FROM supplier_relationships r JOIN supplier_brand_master sb ON sb.id=r.brand_id WHERE r.supplier_id=s.id AND r.status='ACTIVE' AND r.effective_to IS NULL GROUP BY sb.normalized_name ORDER BY sb.normalized_name LIMIT 2) b) AS brands_summary,
            (SELECT COUNT(DISTINCT r.brand_id) FROM supplier_relationships r WHERE r.supplier_id=s.id AND r.status='ACTIVE' AND r.effective_to IS NULL) AS brand_count,
            COALESCE((SELECT SUM(i.invoice_total_paise) FROM supplier_invoices i WHERE i.supplier_id=s.id),0) AS purchases_paise,
            COALESCE((SELECT SUM(p.amount_paise) FROM supplier_payments p WHERE p.supplier_id=s.id),0) AS payments_paise,
            COALESCE((SELECT SUM(i.invoice_total_paise) FROM supplier_invoices i WHERE i.supplier_id=s.id),0)-COALESCE((SELECT SUM(a.amount_paise) FROM supplier_payment_allocations a JOIN supplier_invoices i ON i.id=a.invoice_id WHERE i.supplier_id=s.id),0) AS outstanding_paise
            FROM supplier_master s ${where} ORDER BY CASE s.status WHEN 'ACTIVE' THEN 0 ELSE 1 END,s.name,s.supplier_code LIMIT ? OFFSET ?`,[...params,safeSize,(current-1)*safeSize]);
        const rows=await Promise.all(baseRows.map(async row=>{const {_internal_id,...visible}=row,summary=await getSupplierSummary(_internal_id);return {...visible,purchases_paise:summary.total_purchases_paise,payments_paise:summary.total_payments_paise,outstanding_paise:summary.outstanding_paise,open_invoice_count:summary.open_invoice_count,overdue_invoice_count:summary.overdue_invoice_count};}));
        return {rows,totalCount,page:current,pageSize:safeSize,totalPages};
    }
    async function listSupplierAccounts({search="",page=1,pageSize=PAGE_SIZE}={}) {
        const query=String(search||"").trim().slice(0,200),safeSize=Math.max(1,Math.min(100,Number(pageSize)||PAGE_SIZE)),safePage=Math.max(1,Number(page)||1),params=[];
        let where="";
        if(query){const p=`%${query}%`;where="WHERE (s.supplier_code LIKE ? OR s.name LIKE ? OR EXISTS(SELECT 1 FROM supplier_invoices sx WHERE sx.supplier_id=s.id AND sx.supplier_invoice_number LIKE ?))";params.push(p,p,p);}
        const [count,supplierCount]=await Promise.all([get(`SELECT COUNT(*) AS n FROM supplier_master s ${where}`,params),get("SELECT COUNT(*) AS n FROM supplier_master")]),totalCount=Number(count?.n||0),totalSupplierCount=Number(supplierCount?.n||0),totalPages=Math.max(1,Math.ceil(totalCount/safeSize)),current=Math.min(safePage,totalPages);
        const baseRows=await all(`SELECT s.id AS _internal_id,s.supplier_code,s.name,s.status,
            COALESCE((SELECT SUM(i.invoice_total_paise) FROM supplier_invoices i WHERE i.supplier_id=s.id),0) AS purchases_paise,
            COALESCE((SELECT SUM(p.amount_paise) FROM supplier_payments p WHERE p.supplier_id=s.id),0) AS payments_paise,
            COALESCE((SELECT SUM(i.invoice_total_paise) FROM supplier_invoices i WHERE i.supplier_id=s.id),0)-COALESCE((SELECT SUM(a.amount_paise) FROM supplier_payment_allocations a JOIN supplier_invoices i ON i.id=a.invoice_id WHERE i.supplier_id=s.id),0) AS outstanding_paise,
            (SELECT COUNT(*) FROM supplier_invoices i WHERE i.supplier_id=s.id AND i.invoice_total_paise>COALESCE((SELECT SUM(a.amount_paise) FROM supplier_payment_allocations a WHERE a.invoice_id=i.id),0)) AS open_invoice_count,
            (SELECT COUNT(*) FROM supplier_invoices i WHERE i.supplier_id=s.id AND i.due_date<? AND i.invoice_total_paise>COALESCE((SELECT SUM(a.amount_paise) FROM supplier_payment_allocations a WHERE a.invoice_id=i.id),0)) AS overdue_invoice_count
            FROM supplier_master s ${where} ORDER BY s.name,s.supplier_code LIMIT ? OFFSET ?`,[businessDate(),...params,safeSize,(current-1)*safeSize]);
        const rows=await Promise.all(baseRows.map(async row=>{const {_internal_id,...visible}=row,summary=await getSupplierSummary(_internal_id);return {...visible,purchases_paise:summary.total_purchases_paise,payments_paise:summary.total_payments_paise,outstanding_paise:summary.outstanding_paise,open_invoice_count:summary.open_invoice_count,overdue_invoice_count:summary.overdue_invoice_count};}));
        return {rows,totalCount,totalSupplierCount,page:current,pageSize:safeSize,totalPages};
    }
    async function listOpenLiabilitiesById(supplierId) {
        return all("SELECT * FROM ("+
            "SELECT 'OPENING' liability_type,o.opening_code document_code,o.as_on_date liability_date,COALESCE(o.due_date,o.as_on_date) due_date,o.reference,o.amount_paise,"+
            "COALESCE((SELECT SUM(a.amount_paise) FROM supplier_payment_opening_allocations a WHERE a.opening_balance_id=o.id),0) paid_paise,"+
            "COALESCE((SELECT SUM(a.amount_paise) FROM supplier_credit_note_opening_allocations a WHERE a.opening_balance_id=o.id),0) credited_paise,"+
            "o.amount_paise-COALESCE((SELECT SUM(a.amount_paise) FROM supplier_payment_opening_allocations a WHERE a.opening_balance_id=o.id),0)-COALESCE((SELECT SUM(a.amount_paise) FROM supplier_credit_note_opening_allocations a WHERE a.opening_balance_id=o.id),0) outstanding_paise "+
            "FROM supplier_opening_balances o WHERE o.supplier_id=? AND o.status='POSTED' UNION ALL "+
            "SELECT 'INVOICE',i.invoice_code,i.supplier_invoice_date,i.due_date,i.supplier_invoice_number,i.invoice_total_paise,"+
            "COALESCE((SELECT SUM(a.amount_paise) FROM supplier_payment_allocations a WHERE a.invoice_id=i.id),0),"+
            "COALESCE((SELECT SUM(a.amount_paise) FROM supplier_credit_note_invoice_allocations a WHERE a.invoice_id=i.id),0),"+
            "i.invoice_total_paise-COALESCE((SELECT SUM(a.amount_paise) FROM supplier_payment_allocations a WHERE a.invoice_id=i.id),0)-COALESCE((SELECT SUM(a.amount_paise) FROM supplier_credit_note_invoice_allocations a WHERE a.invoice_id=i.id),0) "+
            "FROM supplier_invoices i WHERE i.supplier_id=? AND i.status='POSTED') WHERE outstanding_paise>0 "+
            "ORDER BY liability_date,CASE liability_type WHEN 'OPENING' THEN 0 ELSE 1 END,document_code",[supplierId,supplierId]);
    }
    function allocateOldestFirst(liabilities, amountPaise) {
        let remaining = amountPaise;
        const allocations = [];
        for (const liability of liabilities) {
            if (!remaining) break;
            const amount = Math.min(remaining, Number(liability.outstanding_paise));
            if (amount > 0) allocations.push({ type: liability.liability_type, code: liability.document_code, amount });
            remaining -= amount;
        }
        return allocations;
    }
    async function getSupplierPaymentContext(supplierCode, requestedAmountPaise = null) {
        const supplier = await getSupplierByCode(supplierCode);
        if (!supplier) throw new SupplierAccountError("Supplier was not found.", "SUPPLIER_NOT_FOUND");
        const supplierId = await resolveSupplierId(supplier.supplier_code);
        const openLiabilities = await listOpenLiabilitiesById(supplierId);
        const totalOutstandingPaise = openLiabilities.reduce((sum, row) => sum + Number(row.outstanding_paise), 0);
        const openingOutstandingPaise = openLiabilities.filter(row => row.liability_type === "OPENING").reduce((sum, row) => sum + Number(row.outstanding_paise), 0);
        if (!Number.isSafeInteger(totalOutstandingPaise) || !Number.isSafeInteger(openingOutstandingPaise)) throw new SupplierAccountError("Supplier outstanding exceeds the supported amount range.", "SUPPLIER_AMOUNT_INVALID");
        const amountPaise = requestedAmountPaise == null ? null : Number(requestedAmountPaise);
        const canPreview = Number.isSafeInteger(amountPaise) && amountPaise > 0 && amountPaise <= totalOutstandingPaise;
        const allocationPreview = canPreview ? allocateOldestFirst(openLiabilities, amountPaise).map(item => {
            const liability = openLiabilities.find(row => row.liability_type === item.type && row.document_code === item.code);
            return { liabilityType: item.type, documentCode: item.code, reference: liability?.reference || "", amountPaise: item.amount };
        }) : [];
        return {
            supplierName: supplier.name,
            supplierCode: supplier.supplier_code,
            totalOutstandingPaise,
            openInvoiceCount: openLiabilities.filter(row => row.liability_type === "INVOICE").length,
            openingOutstandingPaise,
            openLiabilities,
            allocationPreview
        };
    }
    async function listOpenLiabilities(supplierCode) { const today=businessDate();return (await listOpenLiabilitiesById(await resolveSupplierId(supplierCode))).map(row=>{const late=dayDifference(row.due_date,today);return {...row,age_days:Math.max(0,late),due_status:late>90?"90+ DAYS OVERDUE":late>60?"61–90 DAYS OVERDUE":late>30?"31–60 DAYS OVERDUE":late>0?"1–30 DAYS OVERDUE":"NOT YET DUE"};}); }
    function dayDifference(earlier,later){return Math.floor((Date.parse(later+"T00:00:00Z")-Date.parse(earlier+"T00:00:00Z"))/86400000);}
    async function getSupplierSummary(supplierId) {
        const today=businessDate(),values=await Promise.all([
            get("SELECT COALESCE((SELECT SUM(invoice_total_paise) FROM supplier_invoices WHERE supplier_id=? AND status='POSTED'),0) total_purchases_paise,"+
                "COALESCE((SELECT SUM(amount_paise) FROM supplier_payments WHERE supplier_id=? AND status='POSTED'),0) total_payments_paise,"+
                "COALESCE((SELECT SUM(amount_paise) FROM supplier_credit_notes WHERE supplier_id=? AND status='POSTED'),0) credit_notes_paise,"+
                "COALESCE((SELECT SUM(amount_paise) FROM supplier_opening_balances WHERE supplier_id=? AND status='POSTED'),0) opening_balance_paise",[supplierId,supplierId,supplierId,supplierId]),
            listOpenLiabilitiesById(supplierId)
        ]),totals=values[0],liabilities=values[1],aging={not_yet_due_paise:0,overdue_1_30_paise:0,overdue_31_60_paise:0,overdue_61_90_paise:0,overdue_90_plus_paise:0},upcoming={due_next_7_days_paise:0,due_next_15_days_paise:0,due_next_30_days_paise:0};
        let overdue=0;for(const row of liabilities){const amount=Number(row.outstanding_paise),late=dayDifference(row.due_date,today),ahead=dayDifference(today,row.due_date);if(late>0){overdue+=amount;if(late<=30)aging.overdue_1_30_paise+=amount;else if(late<=60)aging.overdue_31_60_paise+=amount;else if(late<=90)aging.overdue_61_90_paise+=amount;else aging.overdue_90_plus_paise+=amount;}else aging.not_yet_due_paise+=amount;if(ahead>0&&ahead<=7)upcoming.due_next_7_days_paise+=amount;if(ahead>0&&ahead<=15)upcoming.due_next_15_days_paise+=amount;if(ahead>0&&ahead<=30)upcoming.due_next_30_days_paise+=amount;}
        return {...totals,outstanding_paise:liabilities.reduce((sum,row)=>sum+Number(row.outstanding_paise),0),open_liability_count:liabilities.length,overdue_paise:overdue,overdue_invoice_count:liabilities.filter(row=>row.liability_type==='INVOICE'&&dayDifference(row.due_date,today)>0).length,overdue_opening_count:liabilities.filter(row=>row.liability_type==='OPENING'&&dayDifference(row.due_date,today)>0).length,open_invoice_count:liabilities.filter(row=>row.liability_type==='INVOICE').length,aging,upcoming};
    }
    async function invoiceOutstanding(invoiceId) {
        return get(`SELECT i.invoice_total_paise-COALESCE((SELECT SUM(a.amount_paise) FROM supplier_payment_allocations a WHERE a.invoice_id=i.id),0)-COALESCE((SELECT SUM(c.amount_paise) FROM supplier_credit_note_invoice_allocations c WHERE c.invoice_id=i.id),0) AS outstanding_paise FROM supplier_invoices i WHERE i.id=?`,[invoiceId]);
    }
    async function postInvoice(input, grant) {
        const current=await store(), today=businessDate();
        const supplier=await get("SELECT * FROM supplier_master WHERE supplier_code=? AND status='ACTIVE'",[String(input.supplierCode||"").trim().toUpperCase()]);
        if(!supplier) throw new SupplierAccountError("Select an active Supplier.","SUPPLIER_NOT_FOUND");
        const captureMode=String(input.captureMode||"DETAILED").trim().toUpperCase();
        if(!["DETAILED","SUMMARY"].includes(captureMode))throw new SupplierAccountError("Select DETAILED or SUMMARY invoice capture.","SUPPLIER_INVOICE_CAPTURE_MODE_INVALID");
        const supplierInvoiceDate=validDate(input.supplierInvoiceDate,"Supplier Invoice Date",today), postingDate=captureMode==="SUMMARY"?today:validDate(input.postingDate||today,"Posting Date",today);
        const dueDate=validDate(input.dueDate||addBusinessCalendarDays(supplierInvoiceDate,Number(supplier.default_credit_period_days)),"Due Date");
        const businessSegment=String(input.businessSegment||"").toUpperCase(); if(!BUSINESS_SEGMENTS.includes(businessSegment)) throw new SupplierAccountError("Select a valid Business Segment.","SUPPLIER_SEGMENT_INVALID");
        const invoiceNumber=text(input.supplierInvoiceNumber,"Supplier Invoice Number",128,true), normalizedNo=invoiceNumber.normalize("NFKC").toLocaleUpperCase("en-IN");
        const supplierSegmentRows=await all("SELECT DISTINCT business_segment FROM supplier_relationships WHERE supplier_id=? AND status='ACTIVE' AND effective_to IS NULL AND effective_from<=?",[supplier.id,postingDate]);const supplierSegments=new Set(supplierSegmentRows.map(row=>row.business_segment));
        if(!supplierSegments.size)throw new SupplierAccountError("No active Brand Mapping is available for this supplier. Add an active mapping in Supplier Profile before posting a purchase invoice.","SUPPLIER_ACTIVE_MAPPING_REQUIRED");
        if(!supplierSegments.has(businessSegment))throw new SupplierAccountError("This Business Segment is not supported by an active Supplier Brand Mapping.","SUPPLIER_SEGMENT_NOT_LINKED");
        let normalizedLines=[],totalQuantity=null,taxable=null,discount=null,cgst=null,sgst=null,igst=null,other=null,rounding=null,total;
        if(captureMode==="SUMMARY"){
            if(Array.isArray(input.lines)&&input.lines.length)throw new SupplierAccountError("Summary invoices cannot contain detailed invoice lines.","SUPPLIER_SUMMARY_LINES_NOT_ALLOWED");
            const quantityValue=input.totalQuantity,quantityText=typeof quantityValue==="string"?quantityValue.trim():null;
            totalQuantity=Number(quantityValue);
            if((quantityText!==null&&!/^\d+$/.test(quantityText))||!Number.isSafeInteger(totalQuantity)||totalQuantity<=0)throw new SupplierAccountError("Total Quantity must be a positive whole number.","SUPPLIER_QUANTITY_INVALID");
            total=positivePaise(input.invoiceTotalPaise,"Invoice Total");
        }else{
            const lines=Array.isArray(input.lines)?input.lines:[]; if(!lines.length) throw new SupplierAccountError("Add at least one invoice line.","SUPPLIER_INVOICE_LINES_REQUIRED");
            for(const [index,line] of lines.entries()){
                const segment=String(line.businessSegment||businessSegment).toUpperCase();
                if(!supplierSegments.has(segment))throw new SupplierAccountError("The Supplier is not linked to this invoice line Business Segment.","SUPPLIER_SEGMENT_NOT_LINKED");
                let product=null;if(line.productId){product=await get("SELECT id,barcode,sku,brand,segment,product_name,business_segment FROM products WHERE id=? AND COALESCE(active,1)=1",[Number(line.productId)]);if(!product)throw new SupplierAccountError("The selected Product Master item is unavailable.","SUPPLIER_PRODUCT_NOT_FOUND");}
                normalizedLines.push({line,index:index+1,product,segment,quantity:positivePaise(line.quantityMilli,"Quantity"),unitCost:positivePaise(line.unitCostPaise,"Unit acquisition cost",true),taxable:positivePaise(line.taxablePaise,"Taxable amount",true),cgst:positivePaise(line.cgstPaise||0,"CGST",true),sgst:positivePaise(line.sgstPaise||0,"SGST",true),igst:positivePaise(line.igstPaise||0,"IGST",true),description:text(product?.product_name||line.description,"Product description",200,true)});
            }
            const lineQuantityMilli=normalizedLines.reduce((sum,line)=>sum+line.quantity,0);if(Number.isSafeInteger(lineQuantityMilli)&&lineQuantityMilli>0&&lineQuantityMilli%1000===0)totalQuantity=lineQuantityMilli/1000;
            if(normalizedLines.some(x=>!BUSINESS_SEGMENTS.includes(x.segment))) throw new SupplierAccountError("Every invoice line must identify a valid Business Segment.","SUPPLIER_SEGMENT_INVALID");
            taxable=normalizedLines.reduce((sum,x)=>sum+x.taxable,0);cgst=normalizedLines.reduce((sum,x)=>sum+x.cgst,0);sgst=normalizedLines.reduce((sum,x)=>sum+x.sgst,0);igst=normalizedLines.reduce((sum,x)=>sum+x.igst,0);
            discount=positivePaise(input.discountPaise||0,"Invoice discount",true);rounding=Number(input.roundingAdjustmentPaise||0);
            if(discount>taxable)throw new SupplierAccountError("Invoice discount cannot exceed the taxable amount.","SUPPLIER_INVOICE_DISCOUNT_INVALID");
            if(!Number.isSafeInteger(rounding)||Math.abs(rounding)>500)throw new SupplierAccountError("Rounding adjustment must be between -₹5.00 and ₹5.00.","SUPPLIER_INVOICE_ROUNDING_INVALID");
            other=positivePaise(input.otherChargesPaise||0,"Other charges",true);total=taxable-discount+cgst+sgst+igst+other+rounding;
            if(!Number.isSafeInteger(total)||total<=0) throw new SupplierAccountError("Invoice total must be positive.","SUPPLIER_AMOUNT_INVALID");
        }
        const timestamp=now().toISOString(); await run("BEGIN IMMEDIATE TRANSACTION");
        try {
            const duplicate=await get("SELECT invoice_code FROM supplier_invoices WHERE supplier_id=? AND supplier_invoice_number_normalized=?",[supplier.id,normalizedNo]);
            if(duplicate) throw new SupplierAccountError("This Supplier Invoice Number has already been posted for this Supplier.","SUPPLIER_INVOICE_DUPLICATE");
            authorize(grant,"SUPPLIER_INVOICE_POST");
            const code=await reserveCode("invoice","KLSINV");
            const inserted=await run(`INSERT INTO supplier_invoices(invoice_code,store_id,supplier_id,supplier_code_snapshot,supplier_name_snapshot,legal_name_snapshot,gstin_snapshot,supplier_invoice_number,supplier_invoice_number_normalized,supplier_invoice_date,posting_date,business_segment,capture_mode,total_quantity,taxable_paise,discount_paise,cgst_paise,sgst_paise,igst_paise,other_charges_paise,rounding_adjustment_paise,invoice_total_paise,due_date,reference,notes,status,created_at,posted_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[code,current.id,supplier.id,supplier.supplier_code,supplier.name,supplier.legal_name,supplier.gstin,invoiceNumber,normalizedNo,supplierInvoiceDate,postingDate,businessSegment,captureMode,totalQuantity,taxable,discount,cgst,sgst,igst,other,rounding,total,dueDate,text(input.reference,"Reference",128),text(input.notes,"Notes",2000),"POSTING",timestamp,timestamp]);
            for(const item of normalizedLines){const line=item.line,product=item.product; await run(`INSERT INTO supplier_invoice_lines(invoice_id,line_number,product_id,barcode_snapshot,sku_snapshot,description_snapshot,brand_snapshot,product_segment_snapshot,business_segment,quantity_milli,unit_cost_paise,taxable_paise,cgst_paise,sgst_paise,igst_paise,line_total_paise,cost_provenance_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[inserted.lastID,item.index,product?.id||null,product?.barcode||null,product?.sku||null,item.description,product?.brand||text(line.brand,"Brand",100),product?.segment||text(line.productSegment,"Product Segment",100),item.segment,item.quantity,item.unitCost,item.taxable,item.cgst,item.sgst,item.igst,item.taxable+item.cgst+item.sgst+item.igst,product?"SUPPLIER_INVOICE":"PENDING_MATCH"]);}
            await run("UPDATE supplier_invoices SET status='POSTED' WHERE id=? AND status='POSTING'",[inserted.lastID]);
            await appendActivity(database,{category:"ACCOUNTING",action:"SUPPLIER_INVOICE_POSTED",details:`Supplier invoice ${code} posted for ${supplier.supplier_code}: ${businessSegment}, ${total} paise`,user_name:"MANAGER",status:"SUCCESS",entity_type:"SUPPLIER_INVOICE",reference_no:code},now());
            await run("COMMIT"); return getInvoice(code);
        }catch(error){await run("ROLLBACK").catch(()=>{});throw error;}
    }
    async function postOpeningBalance(input,grant){
        const current=await store(),supplier=await get("SELECT * FROM supplier_master WHERE supplier_code=?",[String(input.supplierCode||"").trim().toUpperCase()]);
        if(!supplier)throw new SupplierAccountError("Supplier was not found.","SUPPLIER_NOT_FOUND");
        const asOnDate=validDate(input.asOnDate,"As On Date",businessDate()),dueDate=input.dueDate?validDate(input.dueDate,"Due Date"):null;
        const amount=positivePaise(input.amountPaise,"Opening outstanding"),reference=text(input.reference,"Reference",128),remarks=text(input.remarks,"Remarks",2000),timestamp=now().toISOString();
        await run("BEGIN IMMEDIATE TRANSACTION");try{
            authorize(grant,"SUPPLIER_OPENING_BALANCE_POST");const code=await reserveSubledgerCode("opening","KLSOB");
            const inserted=await run("INSERT INTO supplier_opening_balances(opening_code,store_id,supplier_id,supplier_code_snapshot,supplier_name_snapshot,as_on_date,reference,amount_paise,due_date,remarks,status,created_at,posted_at) VALUES(?,?,?,?,?,?,?,?,?,?,'POSTING',?,?)",
                [code,current.id,supplier.id,supplier.supplier_code,supplier.name,asOnDate,reference,amount,dueDate,remarks,timestamp,timestamp]);
            await run("UPDATE supplier_opening_balances SET status='POSTED' WHERE id=? AND status='POSTING'",[inserted.lastID]);
            await appendActivity(database,{category:"ACCOUNTING",action:"SUPPLIER_OPENING_BALANCE_POSTED",details:`Opening balance ${code} posted for ${supplier.supplier_code}: ${amount} paise as of ${asOnDate}`,user_name:"MANAGER",status:"SUCCESS",entity_type:"SUPPLIER_OPENING_BALANCE",reference_no:code},now());
            await run("COMMIT");return getOpeningBalance(code);
        }catch(error){await run("ROLLBACK").catch(()=>{});throw error;}
    }
    async function getOpeningBalance(code){return get("SELECT opening_code,supplier_code_snapshot,supplier_name_snapshot,as_on_date,reference,amount_paise,due_date,remarks,status,created_at,posted_at FROM supplier_opening_balances WHERE opening_code=?",[String(code||"").toUpperCase()]);}
    async function listOpeningBalances(supplierCode){const id=await resolveSupplierId(supplierCode);return all("SELECT opening_code,as_on_date,reference,amount_paise,due_date,remarks,posted_at FROM supplier_opening_balances WHERE supplier_id=? AND status='POSTED' ORDER BY as_on_date,opening_code",[id]);}
    async function postCreditNote(input,grant){
        const current=await store(),supplier=await get("SELECT * FROM supplier_master WHERE supplier_code=?",[String(input.supplierCode||"").trim().toUpperCase()]);
        if(!supplier)throw new SupplierAccountError("Supplier was not found.","SUPPLIER_NOT_FOUND");
        const creditDate=validDate(input.creditNoteDate,"Credit Note Date",businessDate()),postingDate=validDate(input.postingDate||businessDate(),"Posting Date",businessDate()),amount=positivePaise(input.amountPaise,"Credit Note amount");
        const reasons=["PURCHASE RETURN","RATE DIFFERENCE","DAMAGED GOODS","COMMERCIAL DISCOUNT","OTHER"],reason=String(input.reason||"").trim().toUpperCase();
        if(!reasons.includes(reason))throw new SupplierAccountError("Select a valid Supplier Credit Note reason.","SUPPLIER_CREDIT_NOTE_REASON_INVALID");
        const external=text(input.externalNumber??input.creditNoteNumber,"Supplier Credit Note Number",128),normalized=external?external.normalize("NFKC").toLocaleUpperCase("en-IN"):null;
        const remarks=text(input.remarks,"Remarks",2000);if(reason==="OTHER"&&!remarks)throw new SupplierAccountError("Remarks are required for OTHER Supplier Credit Notes.","SUPPLIER_CREDIT_NOTE_REMARKS_REQUIRED");
        const referenceInvoiceCode=text(input.referenceInvoiceCode,"Reference Supplier Invoice",12),reference=text(input.reference,"Reference",128),timestamp=now().toISOString();
        await run("BEGIN IMMEDIATE TRANSACTION");try{
            if(normalized&&await get("SELECT credit_note_code FROM supplier_credit_notes WHERE supplier_id=? AND external_number_normalized=?",[supplier.id,normalized]))throw new SupplierAccountError("This Supplier Credit Note Number has already been posted for this Supplier.","SUPPLIER_CREDIT_NOTE_DUPLICATE");
            const liabilities=await listOpenLiabilitiesById(supplier.id),total=liabilities.reduce((sum,row)=>sum+Number(row.outstanding_paise),0);
            if(amount>total)throw new SupplierAccountError("Credit Note exceeds this Supplier's eligible outstanding liability.","SUPPLIER_CREDIT_NOTE_EXCEEDS_OUTSTANDING");
            let targetInvoice=null;if(referenceInvoiceCode){targetInvoice=await get("SELECT id,invoice_code FROM supplier_invoices WHERE supplier_id=? AND invoice_code=? AND status='POSTED'",[supplier.id,referenceInvoiceCode.toUpperCase()]);if(!targetInvoice)throw new SupplierAccountError("The referenced Supplier Invoice was not found for this Supplier.","SUPPLIER_CREDIT_NOTE_INVOICE_INVALID");const row=liabilities.find(item=>item.liability_type==="INVOICE"&&item.document_code===targetInvoice.invoice_code);if(!row||amount>Number(row.outstanding_paise))throw new SupplierAccountError("Credit Note exceeds the referenced invoice's outstanding liability.","SUPPLIER_CREDIT_NOTE_EXCEEDS_OUTSTANDING");}
            authorize(grant,"SUPPLIER_CREDIT_NOTE_POST");const code=await reserveSubledgerCode("creditNote","KLSCN");
            const inserted=await run("INSERT INTO supplier_credit_notes(credit_note_code,store_id,supplier_id,supplier_code_snapshot,supplier_name_snapshot,external_number,external_number_normalized,credit_note_date,posting_date,amount_paise,reason,reference_invoice_id,reference,remarks,status,created_at,posted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'POSTING',?,?)",
                [code,current.id,supplier.id,supplier.supplier_code,supplier.name,external,normalized,creditDate,postingDate,amount,reason,targetInvoice?.id||null,reference,remarks,timestamp,timestamp]);
            let allocations;if(targetInvoice){allocations=[{liability_type:"INVOICE",document_code:targetInvoice.invoice_code,amount}];}else{allocations=[];let remaining=amount;for(const row of liabilities){if(!remaining)break;const allocated=Math.min(remaining,Number(row.outstanding_paise));allocations.push({...row,amount:allocated});remaining-=allocated;}}
            for(const allocation of allocations){if(allocation.liability_type==="OPENING"){const row=await get("SELECT id FROM supplier_opening_balances WHERE opening_code=?",[allocation.document_code]);await run("INSERT INTO supplier_credit_note_opening_allocations(credit_note_id,opening_balance_id,amount_paise) VALUES(?,?,?)",[inserted.lastID,row.id,allocation.amount]);}else{const row=await get("SELECT id FROM supplier_invoices WHERE invoice_code=?",[allocation.document_code]);await run("INSERT INTO supplier_credit_note_invoice_allocations(credit_note_id,invoice_id,amount_paise) VALUES(?,?,?)",[inserted.lastID,row.id,allocation.amount]);}}
            await run("UPDATE supplier_credit_notes SET status='POSTED' WHERE id=? AND status='POSTING'",[inserted.lastID]);
            await appendActivity(database,{category:"ACCOUNTING",action:"SUPPLIER_CREDIT_NOTE_POSTED",details:`Supplier Credit Note ${code} posted for ${supplier.supplier_code}: ${reason}, ${amount} paise`,user_name:"MANAGER",status:"SUCCESS",entity_type:"SUPPLIER_CREDIT_NOTE",reference_no:code},now());
            await run("COMMIT");return getCreditNote(code);
        }catch(error){await run("ROLLBACK").catch(()=>{});throw error;}
    }
    async function getCreditNote(code){return get("SELECT credit_note_code,supplier_code_snapshot,supplier_name_snapshot,external_number,credit_note_date,posting_date,amount_paise,reason,reference,remarks,status,created_at,posted_at FROM supplier_credit_notes WHERE credit_note_code=?",[String(code||"").toUpperCase()]);}
    async function listCreditNotes(supplierCode){const id=await resolveSupplierId(supplierCode);return all("SELECT c.credit_note_code,c.external_number,c.credit_note_date,c.posting_date,c.amount_paise,c.reason,c.reference,c.remarks,i.invoice_code reference_invoice_code FROM supplier_credit_notes c LEFT JOIN supplier_invoices i ON i.id=c.reference_invoice_id WHERE c.supplier_id=? AND c.status='POSTED' ORDER BY c.posting_date,c.credit_note_code",[id]);}
    async function postPayment(input,grant) {
        const current=await store(), today=businessDate();
        const supplier=await get("SELECT * FROM supplier_master WHERE supplier_code=?",[String(input.supplierCode||"").trim().toUpperCase()]); if(!supplier) throw new SupplierAccountError("Supplier was not found.","SUPPLIER_NOT_FOUND");
        const paymentDate=validDate(input.paymentDate,"Payment Date",today),postingDate=validDate(input.postingDate||today,"Posting Date",today),amount=positivePaise(input.amountPaise,"Payment amount");
        const mode=String(input.paymentMode||"");if(!PAYMENT_MODES.includes(mode))throw new SupplierAccountError("Select a valid Payment Mode.","SUPPLIER_PAYMENT_MODE_INVALID");
        const requested=Array.isArray(input.allocations)?input.allocations:[],method=String(input.allocationMethod||(requested.length?"MANUAL":"OLDEST_INVOICE_FIRST")).toUpperCase();
        if(!["MANUAL","OLDEST_INVOICE_FIRST"].includes(method))throw new SupplierAccountError("Select OLDEST INVOICE FIRST or MANUAL allocation.","SUPPLIER_ALLOCATION_METHOD_INVALID");
        const timestamp=now().toISOString();await run("BEGIN IMMEDIATE TRANSACTION");
        try{
            const liabilities=await listOpenLiabilitiesById(supplier.id),totalOutstanding=liabilities.reduce((sum,row)=>sum+Number(row.outstanding_paise),0);
            if(amount>totalOutstanding)throw new SupplierAccountError("Payment exceeds the Supplier's total outstanding. Supplier advances are not supported.","SUPPLIER_PAYMENT_EXCEEDS_OUTSTANDING");
            let normalized=[];
            if(method==="OLDEST_INVOICE_FIRST"){normalized=allocateOldestFirst(liabilities,amount);}
            else {
                const combined = new Map();
                for(const allocation of requested){const code=String(allocation.openingBalanceCode||allocation.invoiceCode||allocation.documentCode||"").toUpperCase(),type=String(allocation.liabilityType||(code.startsWith("KLSOB")?"OPENING":"INVOICE")).toUpperCase(),row=liabilities.find(item=>item.liability_type===type&&item.document_code===code);if(!row)throw new SupplierAccountError("Every manual allocation must target an open liability belonging to this Supplier.","SUPPLIER_ALLOCATION_LIABILITY_INVALID");const paise=positivePaise(allocation.amountPaise,"Allocation"),key=`${type}:${code}`,total=(combined.get(key)?.amount||0)+paise;if(total>Number(row.outstanding_paise))throw new SupplierAccountError(`Allocation exceeds outstanding on ${code}.`,"SUPPLIER_ALLOCATION_EXCEEDS_OUTSTANDING");combined.set(key,{type,code,amount:total});}
                normalized=[...combined.values()];
            }
            if(!normalized.length||normalized.reduce((sum,item)=>sum+item.amount,0)!==amount)throw new SupplierAccountError("Payment allocations must equal the payment amount exactly.","SUPPLIER_ALLOCATION_TOTAL_MISMATCH");
            authorize(grant,"SUPPLIER_PAYMENT_POST");
            const code=await reserveCode("payment","KLSPAY");const inserted=await run(`INSERT INTO supplier_payments(payment_code,store_id,supplier_id,supplier_code_snapshot,supplier_name_snapshot,payment_date,posting_date,amount_paise,payment_mode,reference,remarks,status,created_at,posted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'POSTING',?,?)`,[code,current.id,supplier.id,supplier.supplier_code,supplier.name,paymentDate,postingDate,amount,mode,text(input.reference,"Reference",128),text(input.remarks,"Remarks",2000),timestamp,timestamp]);
            for(const allocation of normalized){if(allocation.type==="OPENING"){const liability=await get("SELECT id FROM supplier_opening_balances WHERE opening_code=?",[allocation.code]);await run("INSERT INTO supplier_payment_opening_allocations(payment_id,opening_balance_id,amount_paise) VALUES(?,?,?)",[inserted.lastID,liability.id,allocation.amount]);}else{const liability=await get("SELECT id FROM supplier_invoices WHERE invoice_code=?",[allocation.code]);await run("INSERT INTO supplier_payment_allocations(payment_id,invoice_id,amount_paise) VALUES(?,?,?)",[inserted.lastID,liability.id,allocation.amount]);}}
            await run("UPDATE supplier_payments SET status='POSTED' WHERE id=? AND status='POSTING'",[inserted.lastID]);
            await appendActivity(database,{category:"ACCOUNTING",action:"SUPPLIER_PAYMENT_POSTED",details:`Supplier payment ${code} posted for ${supplier.supplier_code}: ${amount} paise`,user_name:"MANAGER",status:"SUCCESS",entity_type:"SUPPLIER_PAYMENT",reference_no:code},now());
            await run("COMMIT");return getPayment(code);
        }catch(error){await run("ROLLBACK").catch(()=>{});throw error;}
    }
    async function getInvoice(code){return get(`SELECT i.invoice_code,i.supplier_code_snapshot,i.supplier_name_snapshot,i.legal_name_snapshot,i.gstin_snapshot,i.supplier_invoice_number,i.supplier_invoice_date,i.posting_date,i.business_segment,i.capture_mode,i.total_quantity,i.taxable_paise,i.discount_paise,i.cgst_paise,i.sgst_paise,i.igst_paise,i.other_charges_paise,i.rounding_adjustment_paise,i.invoice_total_paise,i.due_date,i.reference,i.notes,i.status,i.created_at,i.posted_at,COALESCE((SELECT SUM(a.amount_paise) FROM supplier_payment_allocations a WHERE a.invoice_id=i.id),0) paid_paise,COALESCE((SELECT SUM(a.amount_paise) FROM supplier_credit_note_invoice_allocations a WHERE a.invoice_id=i.id),0) credited_paise,i.invoice_total_paise-COALESCE((SELECT SUM(a.amount_paise) FROM supplier_payment_allocations a WHERE a.invoice_id=i.id),0)-COALESCE((SELECT SUM(a.amount_paise) FROM supplier_credit_note_invoice_allocations a WHERE a.invoice_id=i.id),0) outstanding_paise FROM supplier_invoices i WHERE i.invoice_code=?`,[String(code||"").toUpperCase()]);}
    async function getPayment(code){const payment=await get("SELECT payment_code,supplier_code_snapshot,supplier_name_snapshot,payment_date,posting_date,amount_paise,payment_mode,reference,remarks,status,created_at,posted_at FROM supplier_payments WHERE payment_code=?",[String(code||"").toUpperCase()]);if(!payment)return null;const internal=await get("SELECT id FROM supplier_payments WHERE payment_code=?",[String(code||"").toUpperCase()]),allocations=await all("SELECT 'INVOICE' liability_type,i.invoice_code document_code,a.amount_paise FROM supplier_payment_allocations a JOIN supplier_invoices i ON i.id=a.invoice_id WHERE a.payment_id=? UNION ALL SELECT 'OPENING',o.opening_code,a.amount_paise FROM supplier_payment_opening_allocations a JOIN supplier_opening_balances o ON o.id=a.opening_balance_id WHERE a.payment_id=? ORDER BY document_code",[internal.id,internal.id]);return {...payment,allocations};}
    async function resolveSupplierId(code){const row=await get("SELECT id FROM supplier_master WHERE supplier_code=?",[String(code||"").toUpperCase()]);if(!row)throw new SupplierAccountError("Supplier was not found.","SUPPLIER_NOT_FOUND");return Number(row.id);}
    async function listInvoices(supplierCode){const supplierId=await resolveSupplierId(supplierCode),rows=await all(`SELECT i.invoice_code,i.supplier_code_snapshot,i.supplier_name_snapshot,i.supplier_invoice_number,i.supplier_invoice_date,i.posting_date,i.business_segment,i.capture_mode,i.total_quantity,i.taxable_paise,i.discount_paise,i.cgst_paise,i.sgst_paise,i.igst_paise,i.other_charges_paise,i.rounding_adjustment_paise,i.invoice_total_paise,i.due_date,i.reference,i.status,i.posted_at,COALESCE((SELECT SUM(a.amount_paise) FROM supplier_payment_allocations a WHERE a.invoice_id=i.id),0) paid_paise,COALESCE((SELECT SUM(a.amount_paise) FROM supplier_credit_note_invoice_allocations a WHERE a.invoice_id=i.id),0) credited_paise,i.invoice_total_paise-COALESCE((SELECT SUM(a.amount_paise) FROM supplier_payment_allocations a WHERE a.invoice_id=i.id),0)-COALESCE((SELECT SUM(a.amount_paise) FROM supplier_credit_note_invoice_allocations a WHERE a.invoice_id=i.id),0) outstanding_paise FROM supplier_invoices i WHERE i.supplier_id=? AND i.status='POSTED' ORDER BY i.supplier_invoice_date DESC,i.invoice_code DESC`,[supplierId]),today=businessDate();return rows.map(row=>({...row,payment_status:row.outstanding_paise===0?"PAID":row.paid_paise>0?"PARTIALLY PAID":row.credited_paise>0?"CREDITED":"UNPAID",overdue:row.due_date<today&&row.outstanding_paise>0?1:0}));}
    async function listAccountHistory(supplierCode){return listSupplierStatement(supplierCode);}
    async function listSupplierStatement(supplierCode){
        const supplierId=await resolveSupplierId(supplierCode),events=await all(`SELECT * FROM (
            SELECT as_on_date event_date,opening_code event_code,'OPENING OUTSTANDING' event_type,reference,amount_paise,1 event_order FROM supplier_opening_balances WHERE supplier_id=? AND status='POSTED'
            UNION ALL SELECT posting_date,invoice_code,'SUPPLIER INVOICE',supplier_invoice_number,invoice_total_paise,2 FROM supplier_invoices WHERE supplier_id=? AND status='POSTED'
            UNION ALL SELECT posting_date,credit_note_code,'SUPPLIER CREDIT NOTE',COALESCE(external_number,reference),-amount_paise,3 FROM supplier_credit_notes WHERE supplier_id=? AND status='POSTED'
            UNION ALL SELECT posting_date,payment_code,'SUPPLIER PAYMENT',reference,-amount_paise,4 FROM supplier_payments WHERE supplier_id=? AND status='POSTED'
        ) ORDER BY event_date,event_order,event_code`,[supplierId,supplierId,supplierId,supplierId]);
        let balance=0;return events.map(event=>{balance+=Number(event.amount_paise);return {...event,liability_increase_paise:event.amount_paise>0?event.amount_paise:0,liability_reduction_paise:event.amount_paise<0?-event.amount_paise:0,running_balance_paise:balance};});
    }
    async function listPayments(supplierCode){const supplierId=await resolveSupplierId(supplierCode);return all("SELECT payment_code,payment_date,posting_date,payment_mode,reference,amount_paise FROM supplier_payments WHERE supplier_id=? AND status='POSTED' ORDER BY payment_date DESC,payment_code DESC",[supplierId]);}
    async function listInvoiceLines(code){return all("SELECT l.line_number,l.barcode_snapshot,l.sku_snapshot,l.description_snapshot,l.brand_snapshot,l.product_segment_snapshot,l.business_segment,l.quantity_milli,l.unit_cost_paise,l.taxable_paise,l.cgst_paise,l.sgst_paise,l.igst_paise,l.line_total_paise,l.cost_provenance_status FROM supplier_invoice_lines l JOIN supplier_invoices i ON i.id=l.invoice_id WHERE i.invoice_code=? ORDER BY l.line_number",[String(code||"").toUpperCase()]);}
    async function getSupplierExportData(supplierCode){const current=await store();const profile=await getSupplierByCode(supplierCode);if(!profile)throw new SupplierAccountError("Supplier was not found.","SUPPLIER_NOT_FOUND");const [invoiceRows,paymentRows,openingRows,creditRows,statement,liabilities]=await Promise.all([listInvoices(supplierCode),listPayments(supplierCode),listOpeningBalances(supplierCode),listCreditNotes(supplierCode),listSupplierStatement(supplierCode),listOpenLiabilities(supplierCode)]);return {store:{storeCode:current.storeCode,storeName:current.storeName},supplier:profile,invoices:invoiceRows,payments:paymentRows,openings:openingRows,creditNotes:creditRows,statement,liabilities};}
    async function getOptions(){const current=await store();const date=businessDate();const [brands,productSegments,brandSuggestions,productSegmentSuggestions,products]=await Promise.all([all("SELECT display_name AS value FROM supplier_brand_master WHERE status='ACTIVE' ORDER BY normalized_name"),all("SELECT display_name AS value FROM supplier_product_segment_master WHERE status='ACTIVE' ORDER BY normalized_name"),all("SELECT DISTINCT brand AS value FROM products WHERE trim(COALESCE(brand,''))<>'' ORDER BY value"),all("SELECT DISTINCT segment AS value FROM products WHERE trim(COALESCE(segment,''))<>'' ORDER BY value"),all("SELECT id,barcode,sku,brand,segment,product_name,business_segment FROM products WHERE COALESCE(active,1)=1 ORDER BY product_name LIMIT 500")]);return {store:{storeCode:current.storeCode,storeName:current.storeName},businessDate:date,supplierTypes:SUPPLIER_TYPES,businessSegments:BUSINESS_SEGMENTS,paymentModes:PAYMENT_MODES,brands:brands.map(x=>x.value),productSegments:productSegments.map(x=>x.value),brandSuggestions:brandSuggestions.map(x=>x.value),productSegmentSuggestions:productSegmentSuggestions.map(x=>x.value),products};}
    return {getOptions,createSupplierBrand:value=>createVocabulary("brand",value),createSupplierProductSegment:value=>createVocabulary("productSegment",value),createSupplier,updateSupplier,addSupplierRelationship,updateSupplierRelationship,endSupplierRelationship,removeSupplierRelationship,searchSuppliersByBrand,getSupplierByCode,listSuppliers,listSupplierAccounts,getSupplierPaymentContext,postInvoice,postPayment,postOpeningBalance,getOpeningBalance,listOpeningBalances,postCreditNote,getCreditNote,listCreditNotes,listOpenLiabilities,listSupplierStatement,getInvoice,getPayment,listInvoices,listPayments,listAccountHistory,listInvoiceLines,getSupplierSummary,getSupplierExportData};
}

module.exports={createSupplierDistributorService,SupplierAccountError,SUPPLIER_TYPES,BUSINESS_SEGMENTS,PAYMENT_MODES,normalizeSupplier,normalizeRelationships,positivePaise};
