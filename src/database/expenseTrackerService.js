"use strict";

const EXPENSE_HEADERS = Object.freeze([
    "Rent", "Electricity", "Internet & Communication", "Salary & Wages",
    "Staff Welfare", "Marketing & Advertising", "Maintenance & Repairs",
    "Cleaning & Housekeeping", "Packaging", "Stationery & Printing",
    "Transport & Local Conveyance", "Freight & Courier", "Bank & Payment Charges",
    "Software & Subscriptions", "Professional Fees", "Licences & Statutory Fees",
    "Security & Surveillance", "Insurance", "Petty Cash / General Expense", "Miscellaneous"
]);
const BUSINESS_SEGMENTS = Object.freeze(["KL", "MENS", "KIDS", "COMMON"]);
const PAYMENT_MODES = Object.freeze(["Cash", "UPI", "Card", "Bank Transfer", "Other"]);
const PAGE_SIZE = 100;
const MAX_SEQUENCE = 999999;

class ExpenseTrackerError extends Error {
    constructor(message, code, details = {}) {
        super(message);
        this.name = "ExpenseTrackerError";
        this.code = code;
        Object.assign(this, details);
    }
}

function localDateString(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function normalizeExpenseEntry(input = {}, today = localDateString()) {
    const expenseDate = String(input.expenseDate ?? input.expense_date ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)) {
        throw new ExpenseTrackerError("Enter a valid expense date.", "EXPENSE_DATE_INVALID");
    }
    const date = new Date(`${expenseDate}T00:00:00`);
    if (!Number.isFinite(date.getTime()) || localDateString(date) !== expenseDate) {
        throw new ExpenseTrackerError("Enter a valid expense date.", "EXPENSE_DATE_INVALID");
    }
    if (expenseDate > today) {
        throw new ExpenseTrackerError("Future expense dates are not allowed.", "EXPENSE_DATE_FUTURE");
    }

    const category = String(input.category ?? input.expenseHeader ?? "").trim();
    if (!EXPENSE_HEADERS.includes(category)) {
        throw new ExpenseTrackerError("Select an Expense Header.", "EXPENSE_HEADER_REQUIRED");
    }
    const businessSegment = String(input.businessSegment ?? input.business_segment ?? "").trim();
    if (!BUSINESS_SEGMENTS.includes(businessSegment)) {
        throw new ExpenseTrackerError("Select a Business Segment.", "EXPENSE_SEGMENT_REQUIRED");
    }
    const paymentMode = String(input.paymentMode ?? input.payment_mode ?? "").trim();
    if (!PAYMENT_MODES.includes(paymentMode)) {
        throw new ExpenseTrackerError("Select a Transaction Type.", "EXPENSE_PAYMENT_MODE_REQUIRED");
    }

    const rawAmount = String(input.amount ?? "").trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(rawAmount)) {
        throw new ExpenseTrackerError("Enter a positive amount with no more than two decimal places.", "EXPENSE_AMOUNT_INVALID");
    }
    const [whole, fraction = ""] = rawAmount.split(".");
    const amountPaise = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
    if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
        throw new ExpenseTrackerError("Expense amount must be greater than zero and within the supported limit.", "EXPENSE_AMOUNT_INVALID");
    }

    const reference = String(input.reference ?? input.receiptReference ?? "").trim();
    if (reference.length > 128) {
        throw new ExpenseTrackerError("Receipt / Reference No. must be 128 characters or fewer.", "EXPENSE_REFERENCE_TOO_LONG");
    }
    const remarks = String(input.remarks ?? "").trim();
    if (remarks.length > 2000) {
        throw new ExpenseTrackerError("Remarks must be 2000 characters or fewer.", "EXPENSE_REMARKS_TOO_LONG");
    }
    if (category === "Miscellaneous" && !remarks) {
        throw new ExpenseTrackerError("Remarks are required for Miscellaneous expenses.", "EXPENSE_MISC_REMARKS_REQUIRED");
    }

    return {
        expenseDate,
        category,
        businessSegment,
        paymentMode,
        reference: reference || null,
        amountPaise,
        amount: amountPaise / 100,
        remarks: remarks || null,
        particulars: remarks || category
    };
}

function validMonth(month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ""))) {
        throw new ExpenseTrackerError("Select a valid expense-history month.", "EXPENSE_MONTH_INVALID");
    }
    const [year, number] = month.split("-").map(Number);
    const nextYear = number === 12 ? year + 1 : year;
    const nextMonth = number === 12 ? 1 : number + 1;
    return { start: `${month}-01`, end: `${nextYear}-${String(nextMonth).padStart(2, "0")}-01` };
}

function historyFilters(options = {}, currentMonth = localDateString().slice(0, 7)) {
    if (String(options.month || "") > currentMonth) {
        throw new ExpenseTrackerError("Future Expense History months are not available.", "EXPENSE_MONTH_FUTURE");
    }
    const { start, end } = validMonth(options.month);
    const clauses = [
        "e.expense_date >= ?", "e.expense_date < ?",
        "e.lifecycle_status = 'ACTIVE'", "e.expense_code IS NOT NULL",
        "e.batch_id IS NOT NULL", "e.posted_at IS NOT NULL"
    ];
    const params = [start, end];
    if (options.category) {
        if (!EXPENSE_HEADERS.includes(options.category)) throw new ExpenseTrackerError("Invalid Expense Header filter.", "EXPENSE_FILTER_INVALID");
        clauses.push("e.category = ?"); params.push(options.category);
    }
    if (options.businessSegment) {
        if (!BUSINESS_SEGMENTS.includes(options.businessSegment)) throw new ExpenseTrackerError("Invalid Business Segment filter.", "EXPENSE_FILTER_INVALID");
        clauses.push("e.business_segment = ?"); params.push(options.businessSegment);
    }
    if (options.paymentMode) {
        if (!PAYMENT_MODES.includes(options.paymentMode)) throw new ExpenseTrackerError("Invalid Transaction Type filter.", "EXPENSE_FILTER_INVALID");
        clauses.push("e.payment_mode = ?"); params.push(options.paymentMode);
    }
    const search = String(options.search || "").trim().slice(0, 200);
    if (search) {
        const escaped = search.replace(/[\\%_]/g, "\\$&");
        const pattern = `%${escaped}%`;
        clauses.push(`(
            e.expense_code LIKE ? ESCAPE '\\' OR b.batch_code LIKE ? ESCAPE '\\' OR
            COALESCE(e.reference, '') LIKE ? ESCAPE '\\' OR COALESCE(e.remarks, '') LIKE ? ESCAPE '\\'
        )`);
        params.push(pattern, pattern, pattern, pattern);
    }
    return { where: clauses.join(" AND "), params, search };
}

function createExpenseTrackerService(database, options = {}) {
    const getCurrentStore = options.getCurrentStore ||
        (() => require("./storeIdentityService").getCurrentStore());
    const appendActivity = options.appendActivityInTransaction ||
        ((db, event, instant) => require("./activityService").appendActivityInTransaction(db, event, instant));
    const now = options.now || (() => new Date());
    const filtersFor = options => historyFilters(options, localDateString(now()).slice(0, 7));

    const run = (sql, params = []) => new Promise((resolve, reject) => database.run(sql, params, function(error) {
        if (error) reject(error);
        else resolve({ lastID: this.lastID, changes: this.changes });
    }));
    const get = (sql, params = []) => new Promise((resolve, reject) => database.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
    const all = (sql, params = []) => new Promise((resolve, reject) => database.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));

    async function validateEntry(input) {
        return normalizeExpenseEntry(input, localDateString(now()));
    }

    async function findPostedDuplicates(inputs) {
        const entries = inputs.map(input => normalizeExpenseEntry(input, localDateString(now())));
        const duplicates = [];
        for (let index = 0; index < entries.length; index += 1) {
            const entry = entries[index];
            if (!entry.reference) continue;
            const rows = await all(`
                SELECT e.expense_code, b.batch_code
                FROM expenses e JOIN expense_batches b ON b.id = e.batch_id
                WHERE e.lifecycle_status = 'ACTIVE' AND e.expense_code IS NOT NULL
                  AND e.expense_date = ? AND e.category = ? AND e.amount_paise = ?
                  AND e.reference = ?
                ORDER BY e.expense_code DESC
            `, [entry.expenseDate, entry.category, entry.amountPaise, entry.reference]);
            if (rows.length) duplicates.push({ draftIndex: index, ...entry, matches: rows });
        }
        return duplicates;
    }

    async function postExpenseBatch(inputs, { duplicateAcknowledged = false } = {}) {
        if (!Array.isArray(inputs) || inputs.length === 0) {
            throw new ExpenseTrackerError("Add at least one expense before posting.", "EXPENSE_BATCH_EMPTY");
        }
        const entries = inputs.map(input => normalizeExpenseEntry(input, localDateString(now())));
        const totalPaise = entries.reduce((sum, entry) => sum + entry.amountPaise, 0);
        if (!Number.isSafeInteger(totalPaise) || totalPaise <= 0) {
            throw new ExpenseTrackerError("Expense batch total exceeds the supported limit.", "EXPENSE_BATCH_TOTAL_INVALID");
        }
        const store = await getCurrentStore();
        if (!store || !Number.isSafeInteger(Number(store.id)) || store.status !== "ACTIVE") {
            throw new ExpenseTrackerError("The active Store identity could not be resolved. Posting was stopped.", "EXPENSE_STORE_UNAVAILABLE");
        }

        let started = false;
        let batchCode;
        try {
            await run("BEGIN IMMEDIATE TRANSACTION");
            started = true;

            const duplicates = await findPostedDuplicates(entries);
            if (duplicates.length && !duplicateAcknowledged) {
                throw new ExpenseTrackerError(
                    "One or more draft expenses match previously posted expenses and require acknowledgement.",
                    "EXPENSE_DUPLICATE_ACK_REQUIRED", { duplicates }
                );
            }

            const sequence = await get(`
                SELECT next_batch_sequence, next_expense_sequence
                FROM expense_identity_sequences WHERE id = 1
            `);
            if (!sequence) throw new Error("Expense identity sequence is unavailable. Posting was stopped.");
            const batchSequence = Number(sequence.next_batch_sequence);
            const expenseSequence = Number(sequence.next_expense_sequence);
            if (batchSequence > MAX_SEQUENCE || expenseSequence + entries.length - 1 > MAX_SEQUENCE) {
                throw new ExpenseTrackerError("Expense ID sequence is exhausted. No IDs were reused.", "EXPENSE_ID_SEQUENCE_EXHAUSTED");
            }
            const nextBatchSequence = batchSequence + 1;
            const nextExpenseSequence = expenseSequence + entries.length;
            await run(`UPDATE expense_identity_sequences
                       SET next_batch_sequence = ?, next_expense_sequence = ? WHERE id = 1`,
                [nextBatchSequence, nextExpenseSequence]);

            batchCode = `KLEXPB${String(batchSequence).padStart(6, "0")}`;
            const postedAt = now().toISOString();
            const batch = await run(`
                INSERT INTO expense_batches (
                    batch_code, store_id, status, expense_count, total_amount_paise,
                    posted_by, created_at, posted_at
                ) VALUES (?, ?, 'POSTED', ?, ?, 'MANAGER', ?, ?)
            `, [batchCode, Number(store.id), entries.length, totalPaise, postedAt, postedAt]);

            for (let index = 0; index < entries.length; index += 1) {
                const entry = entries[index];
                const expenseCode = `KLEXP${String(expenseSequence + index).padStart(6, "0")}`;
                await run(`
                    INSERT INTO expenses (
                        expense_date, category, particulars, expense_class, amount_paise,
                        payment_mode, paid_to, reference, business_segment, remarks,
                        lifecycle_status, entered_by, created_at, updated_at,
                        expense_code, batch_id, store_id, posted_at
                    ) VALUES (?, ?, ?, 'OPERATING', ?, ?, NULL, ?, ?, ?, 'ACTIVE', 'MANAGER', ?, ?, ?, ?, ?, ?)
                `, [entry.expenseDate, entry.category, entry.particulars, entry.amountPaise,
                    entry.paymentMode, entry.reference, entry.businessSegment, entry.remarks,
                    postedAt, postedAt, expenseCode, batch.lastID, Number(store.id), postedAt]);
            }

            const amountText = new Intl.NumberFormat("en-IN", {
                minimumFractionDigits: 2, maximumFractionDigits: 2
            }).format(totalPaise / 100);
            await appendActivity(database, {
                category: "EXPENSE",
                action: "EXPENSE_BATCH_POSTED",
                details: `Expense Batch ${batchCode} posted: ${entries.length} expenses, ₹${amountText}`,
                user_name: "MANAGER",
                status: "SUCCESS",
                entity_type: "EXPENSE_BATCH",
                reference_no: batchCode
            }, now());

            await run("COMMIT");
            started = false;
        }
        catch (error) {
            if (started) await run("ROLLBACK").catch(() => {});
            throw error;
        }
        return getPostedExpenseBatch(batchCode);
    }

    async function getPostedExpenseBatch(batchCode) {
        const batch = await get(`
            SELECT b.batch_code, b.status, b.expense_count, b.total_amount_paise,
                   b.posted_by, b.created_at, b.posted_at,
                   s.store_code, s.store_name
            FROM expense_batches b JOIN stores s ON s.id = b.store_id
            WHERE b.batch_code = ?
        `, [String(batchCode || "").trim()]);
        if (!batch) return null;
        const expenses = await all(`
            SELECT e.expense_code, b.batch_code, e.expense_date, e.category,
                   e.business_segment, e.payment_mode, e.reference, e.amount_paise,
                   e.remarks, e.posted_at, s.store_code, s.store_name
            FROM expenses e
            JOIN expense_batches b ON b.id = e.batch_id
            JOIN stores s ON s.id = e.store_id
            WHERE b.batch_code = ? AND e.expense_code IS NOT NULL
            ORDER BY e.expense_code
        `, [String(batchCode || "").trim()]);
        return { ...batch, expenses };
    }

    async function getPostedExpenseDetails(expenseCode) {
        return get(`
            SELECT e.expense_code, b.batch_code, e.expense_date, e.category,
                   e.business_segment, e.payment_mode, e.reference, e.amount_paise,
                   e.remarks, e.posted_at, s.store_code, s.store_name
            FROM expenses e
            JOIN expense_batches b ON b.id = e.batch_id
            JOIN stores s ON s.id = e.store_id
            WHERE e.expense_code = ? AND e.lifecycle_status = 'ACTIVE'
        `, [String(expenseCode || "").trim()]);
    }

    async function listPostedExpenses(options = {}) {
        const { where, params, search } = filtersFor(options);
        const requestedPage = Number.parseInt(options.page, 10);
        const countRow = await get(`
            SELECT COUNT(*) AS total_count, COALESCE(SUM(e.amount_paise), 0) AS total_amount_paise
            FROM expenses e JOIN expense_batches b ON b.id = e.batch_id
            WHERE ${where}
        `, params);
        const totalCount = Number(countRow?.total_count || 0);
        const totalAmountPaise = Number(countRow?.total_amount_paise || 0);
        const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
        const page = Number.isFinite(requestedPage) ? Math.min(Math.max(requestedPage, 1), totalPages) : 1;
        const offset = (page - 1) * PAGE_SIZE;
        const rows = await all(`
            SELECT e.expense_code, b.batch_code, e.expense_date, e.category,
                   e.business_segment, e.payment_mode, e.reference, e.amount_paise,
                   e.remarks, e.posted_at
            FROM expenses e JOIN expense_batches b ON b.id = e.batch_id
            WHERE ${where}
            ORDER BY e.expense_date DESC, e.expense_code DESC
            LIMIT ? OFFSET ?
        `, [...params, PAGE_SIZE, offset]);
        return { rows, totalCount, totalAmountPaise, page, pageSize: PAGE_SIZE, totalPages, search };
    }

    async function getPostedExpensesForExport(options = {}) {
        const { where, params, search } = filtersFor(options);
        const [rows, totals] = await Promise.all([
            all(`
                SELECT e.expense_code, b.batch_code, e.expense_date, e.category,
                       e.business_segment, e.payment_mode, e.reference, e.amount_paise,
                       e.remarks, e.posted_at
                FROM expenses e JOIN expense_batches b ON b.id = e.batch_id
                WHERE ${where}
                ORDER BY e.expense_date DESC, e.expense_code DESC
            `, params),
            get(`
                SELECT COUNT(*) AS total_count, COALESCE(SUM(e.amount_paise), 0) AS total_amount_paise
                FROM expenses e JOIN expense_batches b ON b.id = e.batch_id
                WHERE ${where}
            `, params)
        ]);
        return { rows, totalCount: Number(totals?.total_count || 0),
            totalAmountPaise: Number(totals?.total_amount_paise || 0), search };
    }

    async function getExpenseSummaryByHeader(options = {}) {
        const { where, params } = filtersFor(options);
        return all(`
            SELECT e.category, COUNT(*) AS expense_count,
                   COALESCE(SUM(e.amount_paise), 0) AS total_amount_paise
            FROM expenses e JOIN expense_batches b ON b.id = e.batch_id
            WHERE ${where}
            GROUP BY e.category
            ORDER BY CASE e.category ${EXPENSE_HEADERS.map((_, i) => `WHEN '${EXPENSE_HEADERS[i].replace(/'/g, "''")}' THEN ${i}`).join(" ")} ELSE 999 END
        `, params);
    }

    async function getPostedOpexSummary(options = {}) {
        const clauses = [
            "lifecycle_status = 'ACTIVE'", "expense_code IS NOT NULL",
            "batch_id IS NOT NULL", "posted_at IS NOT NULL"
        ];
        const params = [];
        if (options.fromDate) { clauses.push("expense_date >= ?"); params.push(options.fromDate); }
        if (options.toDate) { clauses.push("expense_date <= ?"); params.push(options.toDate); }
        if (options.businessSegment) {
            if (!BUSINESS_SEGMENTS.includes(options.businessSegment)) throw new ExpenseTrackerError("Invalid Business Segment.", "EXPENSE_FILTER_INVALID");
            clauses.push("business_segment = ?"); params.push(options.businessSegment);
        }
        return all(`
            SELECT category, business_segment, COUNT(*) AS expense_count,
                   SUM(amount_paise) AS total_amount_paise
            FROM expenses WHERE ${clauses.join(" AND ")}
            GROUP BY category, business_segment ORDER BY category, business_segment
        `, params);
    }

    return {
        validateEntry,
        findPostedDuplicates,
        postExpenseBatch,
        getPostedExpenseBatch,
        getPostedExpenseDetails,
        listPostedExpenses,
        getPostedExpensesForExport,
        getExpenseSummaryByHeader,
        getPostedOpexSummary
    };
}

function getExpenseTrackerOptions() {
    return {
        expenseHeaders: [...EXPENSE_HEADERS],
        businessSegments: [...BUSINESS_SEGMENTS],
        transactionTypes: [...PAYMENT_MODES]
    };
}

let defaultService;
function getDefaultService() {
    if (!defaultService) defaultService = createExpenseTrackerService(require("./database"));
    return defaultService;
}

module.exports = {
    EXPENSE_HEADERS,
    BUSINESS_SEGMENTS,
    PAYMENT_MODES,
    PAGE_SIZE,
    ExpenseTrackerError,
    localDateString,
    normalizeExpenseEntry,
    historyFilters,
    createExpenseTrackerService,
    getExpenseTrackerOptions,
    validateEntry: (...args) => getDefaultService().validateEntry(...args),
    findPostedDuplicates: (...args) => getDefaultService().findPostedDuplicates(...args),
    postExpenseBatch: (...args) => getDefaultService().postExpenseBatch(...args),
    getPostedExpenseBatch: (...args) => getDefaultService().getPostedExpenseBatch(...args),
    getPostedExpenseDetails: (...args) => getDefaultService().getPostedExpenseDetails(...args),
    listPostedExpenses: (...args) => getDefaultService().listPostedExpenses(...args),
    getPostedExpensesForExport: (...args) => getDefaultService().getPostedExpensesForExport(...args),
    getExpenseSummaryByHeader: (...args) => getDefaultService().getExpenseSummaryByHeader(...args),
    getPostedOpexSummary: (...args) => getDefaultService().getPostedOpexSummary(...args)
};
