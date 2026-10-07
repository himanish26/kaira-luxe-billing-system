"use strict";

const HEADS = Object.freeze([
    { code: "INTEREST_INCOME", label: "Interest Income", effect: "INCOME" },
    { code: "OTHER_NON_OPERATING_INCOME", label: "Other Non-Operating Income", effect: "INCOME" },
    { code: "INTEREST_FINANCE_CHARGES", label: "Interest / Finance Charges", effect: "EXPENSE" },
    { code: "DEPRECIATION", label: "Depreciation", effect: "EXPENSE" },
    { code: "AMORTISATION", label: "Amortisation", effect: "EXPENSE" },
    { code: "OTHER_NON_OPERATING_EXPENSE", label: "Other Non-Operating Expense", effect: "EXPENSE" },
    { code: "EXCEPTIONAL_ADJUSTMENT", label: "Exceptional / Adjustment Item", effect: "DIRECTIONAL" },
    { code: "INCOME_TAX_PROVISION", label: "Income Tax / Tax Provision", effect: "EXPENSE" }
]);
const HEAD_BY_CODE = new Map(HEADS.map(head => [head.code, head]));
const SEGMENTS = Object.freeze(["KL", "MENS", "KIDS", "COMMON"]);
const MAX_SEQUENCE = 999999;
const POST_PURPOSE = "P_AND_L_ENTRY_POST";
const REVERSE_PURPOSE = "P_AND_L_ENTRY_REVERSE";

class ManagementAccountingEntryError extends Error {
    constructor(message, code) {
        super(message);
        this.name = "ManagementAccountingEntryError";
        this.code = code;
    }
}

function requiredDate(value, today, label = "Accounting Date", rejectFuture = true) {
    const text = String(value || "").trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) throw new ManagementAccountingEntryError(`Enter a valid ${label}.`, "ACCOUNTING_DATE_INVALID");
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    if (date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) {
        throw new ManagementAccountingEntryError(`Enter a valid ${label}.`, "ACCOUNTING_DATE_INVALID");
    }
    if (rejectFuture && text > today) throw new ManagementAccountingEntryError(`${label} cannot be in the future.`, "ACCOUNTING_DATE_FUTURE");
    return text;
}

function parsePositiveAmountPaise(input) {
    if (input && Object.prototype.hasOwnProperty.call(input, "amountPaise")) {
        if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0) {
            throw new ManagementAccountingEntryError("Amount must be a positive integer number of paise.", "ACCOUNTING_AMOUNT_INVALID");
        }
        return input.amountPaise;
    }
    const raw = String(input && input.amount !== undefined ? input.amount : "").trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) {
        throw new ManagementAccountingEntryError("Enter a positive amount with no more than two decimal places.", "ACCOUNTING_AMOUNT_INVALID");
    }
    const [whole, fraction = ""] = raw.split(".");
    const amount = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
    if (!Number.isSafeInteger(amount) || amount <= 0) {
        throw new ManagementAccountingEntryError("Amount must be positive and within the supported limit.", "ACCOUNTING_AMOUNT_INVALID");
    }
    return amount;
}

function optionalText(value, max, label) {
    const text = String(value ?? "").trim();
    if (text.length > max) throw new ManagementAccountingEntryError(`${label} must be ${max} characters or fewer.`, "ACCOUNTING_TEXT_TOO_LONG");
    return text || null;
}

function normalizeEntryInput(input, today) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new ManagementAccountingEntryError("Accounting entry details are required.", "ACCOUNTING_ENTRY_INVALID");
    }
    const accountingDate = requiredDate(input.accountingDate ?? input.accounting_date, today);
    const accountingHead = String(input.accountingHead ?? input.accounting_head ?? "").trim().toUpperCase();
    if (!HEAD_BY_CODE.has(accountingHead)) throw new ManagementAccountingEntryError("Select one of the approved accounting heads.", "ACCOUNTING_HEAD_INVALID");
    const businessSegment = String(input.businessSegment ?? input.business_segment ?? "").trim().toUpperCase();
    if (!SEGMENTS.includes(businessSegment)) throw new ManagementAccountingEntryError("Select KL, MENS, KIDS, or COMMON.", "ACCOUNTING_SEGMENT_INVALID");
    const amountPaise = parsePositiveAmountPaise(input);
    const effectInput = input.adjustmentEffect ?? input.adjustment_effect ?? null;
    const adjustmentEffect = effectInput === null || effectInput === "" ? null : String(effectInput).trim().toUpperCase();
    if (accountingHead === "EXCEPTIONAL_ADJUSTMENT") {
        if (!new Set(["INCOME", "EXPENSE"]).has(adjustmentEffect)) {
            throw new ManagementAccountingEntryError("Select whether the adjustment increases or reduces profit.", "ACCOUNTING_ADJUSTMENT_EFFECT_REQUIRED");
        }
    } else if (adjustmentEffect !== null) {
        throw new ManagementAccountingEntryError("Adjustment direction is only valid for Exceptional / Adjustment Item.", "ACCOUNTING_ADJUSTMENT_EFFECT_NOT_ALLOWED");
    }
    const referenceNo = optionalText(input.referenceNo ?? input.reference_no, 128, "Reference No.");
    const remarks = optionalText(input.remarks, 2000, "Remarks");
    if (accountingHead === "EXCEPTIONAL_ADJUSTMENT" && !remarks) {
        throw new ManagementAccountingEntryError("Remarks are required for Exceptional / Adjustment Item.", "ACCOUNTING_REMARKS_REQUIRED");
    }
    return { accountingDate, accountingHead, businessSegment, amountPaise, adjustmentEffect, referenceNo, remarks };
}

function createManagementAccountingEntryService(database, options = {}) {
    if (!database || typeof database.run !== "function" || typeof database.get !== "function" || typeof database.all !== "function") {
        throw new TypeError("A SQLite database connection is required.");
    }
    const getCurrentStore = options.getCurrentStore || (() => require("./storeIdentityService").getCurrentStore());
    const appendActivity = options.appendActivityInTransaction ||
        ((db, event, instant) => require("./activityService").appendActivityInTransaction(db, event, instant));
    const getBusinessDate = options.getBusinessDate || require("./businessDate").getBusinessDate;
    const now = options.now || (() => new Date());
    const security = options.security || null;

    const run = (sql, params = []) => new Promise((resolve, reject) => database.run(sql, params, function(error) {
        error ? reject(error) : resolve({ lastID: this.lastID, changes: this.changes });
    }));
    const get = (sql, params = []) => new Promise((resolve, reject) => database.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
    const all = (sql, params = []) => new Promise((resolve, reject) => database.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));

    function currentDate() { return getBusinessDate(now()); }
    async function resolveStore() {
        const store = await getCurrentStore();
        if (!store || !Number.isSafeInteger(Number(store.id)) || store.status !== "ACTIVE") {
            throw new ManagementAccountingEntryError("The active Store identity could not be resolved.", "ACCOUNTING_STORE_UNAVAILABLE");
        }
        return { id: Number(store.id), storeCode: store.storeCode, storeName: store.storeName };
    }
    async function reserveAuthorization(grant, purpose) {
        if (!security || typeof security.reserveGrants !== "function" ||
            !security.reserveGrants([{ token: grant, purpose }])) {
            throw new ManagementAccountingEntryError("Manager authorization is missing, invalid, or expired.", "ACCOUNTING_MANAGER_AUTH_REQUIRED");
        }
    }
    function settleAuthorization(grant, purpose, success) {
        if (!security) return;
        const requirement = [{ token: grant, purpose }];
        if (success) {
            if (!security.commitGrants(requirement)) throw new Error("Reserved accounting authorization could not be committed.");
        } else {
            security.releaseGrants(requirement);
        }
    }
    async function allocateCode() {
        const row = await get("SELECT next_sequence FROM management_accounting_entry_sequences WHERE id=1");
        const sequence = Number(row?.next_sequence);
        if (!Number.isInteger(sequence) || sequence < 1 || sequence > MAX_SEQUENCE) {
            throw new ManagementAccountingEntryError("KLPAE ID sequence is exhausted or unavailable. No ID was reused.", "ACCOUNTING_ID_SEQUENCE_EXHAUSTED");
        }
        const update = await run("UPDATE management_accounting_entry_sequences SET next_sequence=? WHERE id=1 AND next_sequence=?", [sequence + 1, sequence]);
        if (update.changes !== 1) throw new Error("KLPAE identity sequence changed unexpectedly.");
        return `KLPAE${String(sequence).padStart(6, "0")}`;
    }
    function amountLabel(amountPaise) {
        return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amountPaise / 100);
    }
    async function insertPostedEntry({ normalized, store, reversesEntryId = null, reversalReason = null, originalEntryCode = null }) {
        const code = await allocateCode();
        const timestamp = now().toISOString();
        const inserted = await run(`
            INSERT INTO management_accounting_entries (
                entry_code, store_id, accounting_date, accounting_head, business_segment,
                amount_paise, adjustment_effect, reference_no, remarks, status,
                created_at, created_by, posted_at, posted_by, source,
                reverses_entry_id, reversal_reason
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'POSTED', ?, 'MANAGER', ?, 'MANAGER', 'MANUAL', ?, ?)
        `, [code, store.id, normalized.accountingDate, normalized.accountingHead, normalized.businessSegment,
            normalized.amountPaise, normalized.adjustmentEffect, normalized.referenceNo, normalized.remarks,
            timestamp, timestamp, reversesEntryId, reversalReason]);
        const isReversal = reversesEntryId !== null;
        const action = isReversal ? "MANAGEMENT_ACCOUNTING_ENTRY_REVERSED" : "MANAGEMENT_ACCOUNTING_ENTRY_POSTED";
        const details = isReversal
            ? `Accounting entry ${code} reversed ${originalEntryCode}: ${normalized.accountingHead}, ${normalized.businessSegment}, ${normalized.accountingDate}, ₹${amountLabel(normalized.amountPaise)}. Reason: ${reversalReason}`
            : `Accounting entry ${code} posted: ${normalized.accountingHead}, ${normalized.businessSegment}, ${normalized.accountingDate}, ₹${amountLabel(normalized.amountPaise)}`;
        await appendActivity(database, {
            category: "ACCOUNTING", action, details, user_name: "MANAGER", status: "SUCCESS",
            entity_type: "MANAGEMENT_ACCOUNTING_ENTRY", reference_no: code
        }, now());
        return getEntryByCode(code);
    }
    async function getEntryByCode(entryCode) {
        const code = String(entryCode || "").trim().toUpperCase();
        if (!/^KLPAE\d{6}$/.test(code)) return null;
        return get(`
            SELECT e.entry_code, s.store_code, s.store_name, e.accounting_date,
                   e.accounting_head, e.business_segment, e.amount_paise,
                   e.adjustment_effect, e.reference_no, e.remarks, e.status,
                   e.created_at, e.created_by, e.posted_at, e.posted_by, e.source,
                   original.entry_code AS reverses_entry_code, e.reversal_reason,
                   reversing.entry_code AS reversed_by_entry_code
            FROM management_accounting_entries e
            JOIN stores s ON s.id=e.store_id
            LEFT JOIN management_accounting_entries original ON original.id=e.reverses_entry_id
            LEFT JOIN management_accounting_entries reversing ON reversing.reverses_entry_id=e.id
            WHERE e.entry_code=?
        `, [code]);
    }
    async function validateEntry(input) { return normalizeEntryInput(input, currentDate()); }

    async function postEntry(input, authorizationGrant) {
        const normalized = normalizeEntryInput(input, currentDate());
        const store = await resolveStore();
        await reserveAuthorization(authorizationGrant, POST_PURPOSE);
        let transaction = false;
        let committed = false;
        try {
            await run("BEGIN IMMEDIATE TRANSACTION"); transaction = true;
            const inserted = await insertPostedEntry({ normalized, store });
            await run("COMMIT"); transaction = false; committed = true;
            settleAuthorization(authorizationGrant, POST_PURPOSE, true);
            return inserted;
        } catch (error) {
            if (transaction) await run("ROLLBACK").catch(() => {});
            if (!committed) settleAuthorization(authorizationGrant, POST_PURPOSE, false);
            throw error;
        }
    }

    async function reverseEntry(entryCode, { reason } = {}, authorizationGrant) {
        const code = String(entryCode || "").trim().toUpperCase();
        if (!/^KLPAE\d{6}$/.test(code)) throw new ManagementAccountingEntryError("Select a valid KLPAE entry to reverse.", "ACCOUNTING_ENTRY_NOT_FOUND");
        const reversalReason = String(reason || "").trim();
        if (!reversalReason) throw new ManagementAccountingEntryError("A reason is required to reverse an accounting entry.", "ACCOUNTING_REVERSAL_REASON_REQUIRED");
        if (reversalReason.length > 1000) throw new ManagementAccountingEntryError("Reversal reason must be 1000 characters or fewer.", "ACCOUNTING_REVERSAL_REASON_TOO_LONG");
        const store = await resolveStore();
        const accountingDate = currentDate();
        await reserveAuthorization(authorizationGrant, REVERSE_PURPOSE);
        let transaction = false;
        let committed = false;
        try {
            await run("BEGIN IMMEDIATE TRANSACTION"); transaction = true;
            const original = await get(`SELECT * FROM management_accounting_entries WHERE entry_code=?`, [code]);
            if (!original || Number(original.store_id) !== store.id || original.status !== "POSTED") {
                throw new ManagementAccountingEntryError("The posted accounting entry was not found for the current Store.", "ACCOUNTING_ENTRY_NOT_FOUND");
            }
            if (original.reverses_entry_id !== null) {
                throw new ManagementAccountingEntryError("A reversal entry cannot itself be reversed.", "ACCOUNTING_REVERSAL_NOT_ALLOWED");
            }
            const prior = await get("SELECT entry_code FROM management_accounting_entries WHERE reverses_entry_id=?", [original.id]);
            if (prior) throw new ManagementAccountingEntryError("This accounting entry has already been reversed.", "ACCOUNTING_ENTRY_ALREADY_REVERSED");
            const normalized = {
                accountingDate, accountingHead: original.accounting_head, businessSegment: original.business_segment,
                amountPaise: Number(original.amount_paise), adjustmentEffect: original.adjustment_effect,
                referenceNo: original.reference_no, remarks: `Reversal of ${code}: ${reversalReason}`.slice(0, 2000)
            };
            const reversed = await insertPostedEntry({ normalized, store, reversesEntryId: original.id,
                reversalReason, originalEntryCode: code });
            await run("COMMIT"); transaction = false; committed = true;
            settleAuthorization(authorizationGrant, REVERSE_PURPOSE, true);
            return reversed;
        } catch (error) {
            if (transaction) await run("ROLLBACK").catch(() => {});
            if (!committed) settleAuthorization(authorizationGrant, REVERSE_PURPOSE, false);
            throw error;
        }
    }

    async function listEntries({ fromDate, toDate, accountingHead, businessSegment, search, includeReversals = true } = {}) {
        const today = currentDate();
        const clauses = ["e.store_id=?", "e.status='POSTED'", "e.accounting_date<=?"];
        const params = [(await resolveStore()).id, today];
        if (fromDate) { requiredDate(fromDate, today, "start date", false); clauses.push("e.accounting_date>=?"); params.push(fromDate); }
        if (toDate) { requiredDate(toDate, today, "end date", false); clauses.push("e.accounting_date<=?"); params.push(toDate); }
        if (fromDate && toDate && fromDate > toDate) throw new ManagementAccountingEntryError("Start date cannot be after end date.", "ACCOUNTING_DATE_RANGE_INVALID");
        if (accountingHead) {
            const head = String(accountingHead).trim().toUpperCase();
            if (!HEAD_BY_CODE.has(head)) throw new ManagementAccountingEntryError("Select an approved accounting head.", "ACCOUNTING_HEAD_INVALID");
            clauses.push("e.accounting_head=?"); params.push(head);
        }
        if (businessSegment) {
            const segment = String(businessSegment).trim().toUpperCase();
            if (!SEGMENTS.includes(segment)) throw new ManagementAccountingEntryError("Select KL, MENS, KIDS, or COMMON.", "ACCOUNTING_SEGMENT_INVALID");
            clauses.push("e.business_segment=?"); params.push(segment);
        }
        if (search !== undefined && search !== null && String(search).trim()) {
            const query = String(search).trim();
            if (query.length > 128) throw new ManagementAccountingEntryError("Search must be 128 characters or fewer.", "ACCOUNTING_SEARCH_TOO_LONG");
            clauses.push("(e.entry_code LIKE ? OR e.reference_no LIKE ? OR e.remarks LIKE ?)");
            const pattern = `%${query}%`;
            params.push(pattern, pattern, pattern);
        }
        if (!includeReversals) clauses.push("e.reverses_entry_id IS NULL");
        return all(`
            SELECT e.entry_code, s.store_code, s.store_name, e.accounting_date,
                   e.accounting_head, e.business_segment, e.amount_paise,
                   e.adjustment_effect, e.reference_no, e.remarks, e.status,
                   e.created_at, e.created_by, e.posted_at, e.posted_by, e.source,
                   original.entry_code AS reverses_entry_code, e.reversal_reason,
                   reversing.entry_code AS reversed_by_entry_code,
                   CASE WHEN e.reverses_entry_id IS NULL THEN 1 ELSE -1 END AS accounting_sign
            FROM management_accounting_entries e JOIN stores s ON s.id=e.store_id
            LEFT JOIN management_accounting_entries original ON original.id=e.reverses_entry_id
            LEFT JOIN management_accounting_entries reversing ON reversing.reverses_entry_id=e.id
            WHERE ${clauses.join(" AND ")}
            ORDER BY e.accounting_date, e.entry_code
        `, params);
    }

    async function getEntryDataQuality({ fromDate, toDate } = {}) {
        const today = currentDate();
        const store = await resolveStore();
        const clauses = [];
        const dateParams = [];
        if (fromDate) { requiredDate(fromDate, today, "start date", false); clauses.push("e.accounting_date>=?"); dateParams.push(fromDate); }
        if (toDate) { requiredDate(toDate, today, "end date", false); clauses.push("e.accounting_date<=?"); dateParams.push(toDate); }
        if (fromDate && toDate && fromDate > toDate) throw new ManagementAccountingEntryError("Start date cannot be after end date.", "ACCOUNTING_DATE_RANGE_INVALID");
        const rows = await get(`
            SELECT COUNT(*) AS row_count,
                   SUM(CASE WHEN e.reverses_entry_id IS NOT NULL THEN 1 ELSE 0 END) AS reversal_count,
                   SUM(CASE WHEN e.status <> 'POSTED' OR typeof(e.amount_paise) <> 'integer' OR e.amount_paise <= 0
                         OR e.accounting_head NOT IN (${HEADS.map(() => "?").join(",")})
                         OR e.business_segment NOT IN (${SEGMENTS.map(() => "?").join(",")})
                         OR (e.accounting_head='EXCEPTIONAL_ADJUSTMENT' AND e.adjustment_effect NOT IN ('INCOME','EXPENSE'))
                         OR (e.accounting_head<>'EXCEPTIONAL_ADJUSTMENT' AND e.adjustment_effect IS NOT NULL)
                         THEN 1 ELSE 0 END) AS invalid_count,
                   SUM(CASE WHEN store.id IS NULL OR e.store_id <> ? THEN 1 ELSE 0 END) AS store_issue_count,
                   SUM(CASE WHEN e.reverses_entry_id IS NOT NULL AND
                         (original.id IS NULL OR original.reverses_entry_id IS NOT NULL
                          OR e.reversal_reason IS NULL OR e.store_id <> original.store_id
                          OR e.accounting_head <> original.accounting_head
                          OR e.business_segment <> original.business_segment
                          OR e.amount_paise <> original.amount_paise
                          OR e.adjustment_effect IS NOT original.adjustment_effect)
                         THEN 1 ELSE 0 END) AS reversal_issue_count
            FROM management_accounting_entries e
            LEFT JOIN stores store ON store.id=e.store_id
            LEFT JOIN management_accounting_entries original ON original.id=e.reverses_entry_id
            ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
        `, [...HEADS.map(head => head.code), ...SEGMENTS, store.id, ...dateParams]);
        const warnings = [];
        if (Number(rows?.invalid_count || 0)) warnings.push({ code: "ACCOUNTING_ENTRY_INVALID", severity: "ERROR", affectedCount: Number(rows.invalid_count) });
        if (Number(rows?.store_issue_count || 0)) warnings.push({ code: "ACCOUNTING_ENTRY_STORE_ATTRIBUTION", severity: "ERROR", affectedCount: Number(rows.store_issue_count) });
        if (Number(rows?.reversal_issue_count || 0)) warnings.push({ code: "ACCOUNTING_ENTRY_REVERSAL_INCONSISTENT", severity: "ERROR", affectedCount: Number(rows.reversal_issue_count) });
        return { postedEntryCount: Number(rows?.row_count || 0), reversalCount: Number(rows?.reversal_count || 0),
            noEntriesRecorded: Number(rows?.row_count || 0) === 0, warnings };
    }

    async function getEffectivePostedEntries(options = {}) {
        if (typeof options.fromDate !== "string" || typeof options.toDate !== "string") {
            throw new ManagementAccountingEntryError("A bounded accounting-date range is required.", "ACCOUNTING_DATE_RANGE_REQUIRED");
        }
        return listEntries(options);
    }

    function getOptions() { return { heads: HEADS.map(head => ({ ...head })), businessSegments: [...SEGMENTS] }; }

    return { getOptions, validateEntry, postEntry, reverseEntry, getEntryByCode, listEntries,
        getEffectivePostedEntries, getEntryDataQuality };
}

module.exports = { HEADS, SEGMENTS, MAX_SEQUENCE, POST_PURPOSE, REVERSE_PURPOSE,
    ManagementAccountingEntryError, normalizeEntryInput, createManagementAccountingEntryService };
