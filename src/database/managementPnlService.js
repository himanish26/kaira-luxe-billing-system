"use strict";

const { BUSINESS_SEGMENT_CODES, normalizeBusinessSegment } = require("../shared/businessSegment");
const { EXPENSE_HEADERS } = require("./expenseTrackerService");
const { createReturnCogsService } = require("./returnCogsService");
const { getBusinessDate } = require("./businessDate");
const { parseDate, comparisonPeriod, getFinancialYearStart, monthRange } = require("./managementPnlPeriods");
const { createManagementAccountingEntryService } = require("./managementAccountingEntryService");

const CATEGORY_GROUPS = Object.freeze([
    { name: "Employee Costs", categories: ["Salary & Wages", "Staff Welfare"] },
    { name: "Occupancy", categories: ["Rent", "Security & Surveillance", "Insurance"] },
    { name: "Utilities & Communications", categories: ["Electricity", "Internet & Communication"] },
    { name: "Marketing", categories: ["Marketing & Advertising"] },
    { name: "Operating / Store Support", categories: ["Maintenance & Repairs", "Cleaning & Housekeeping", "Packaging", "Transport & Local Conveyance", "Freight & Courier"] },
    { name: "Administrative & Professional", categories: ["Stationery & Printing", "Software & Subscriptions", "Professional Fees", "Licences & Statutory Fees", "Petty Cash / General Expense", "Miscellaneous"] },
    { name: "Payment Charges", categories: ["Bank & Payment Charges"] }
]);
const VALID_SEGMENTS = new Set(["ALL", ...BUSINESS_SEGMENT_CODES]);

function dbAll(database, sql, params = []) {
    return new Promise((resolve, reject) => database.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
}

function safeAdd(left, right, label) {
    const result = left + right;
    if (!Number.isSafeInteger(result)) throw new Error(`Management P&L ${label} exceeds safe integer-paise limits.`);
    return result;
}

function invalidateProfitability(summary, reason) {
    if (!summary?.profitability) return;
    summary.profitability.available = false;
    summary.profitability.unavailableReason = reason;
    for (const key of ["interestIncomePaise", "otherNonOperatingIncomePaise", "financeCostsPaise", "depreciationPaise",
        "amortisationPaise", "otherNonOperatingExpensePaise", "exceptionalIncomePaise", "exceptionalExpensePaise",
        "exceptionalAdjustmentPaise", "incomeTaxProvisionPaise", "ebitdaPaise", "ebitdaMarginPercent", "ebitaPaise",
        "ebitaMarginPercent", "ebitPaise", "ebitMarginPercent", "totalOtherIncomePaise", "pbtPaise", "pbtMarginPercent",
        "patPaise", "netProfitMarginPercent"]) {
        summary.profitability[key] = null;
    }
}

function moneyPaise(value, label, warnings, context = {}) {
    if (value === null || value === undefined || value === "") {
        warnings.push({ code: "ACCOUNTING_AMOUNT_MISSING", severity: "ERROR", message: `A persisted ${label} is missing.`, affectedCount: 1, affectedValuePaise: null, ...context });
        return null;
    }
    const number = Number(value);
    if (!Number.isFinite(number)) {
        warnings.push({ code: "ACCOUNTING_AMOUNT_INVALID", severity: "ERROR", message: `A persisted ${label} is invalid.`, affectedCount: 1, affectedValuePaise: null, ...context });
        return null;
    }
    const paise = Math.round((number + Number.EPSILON) * 100);
    if (!Number.isSafeInteger(paise)) throw new Error(`Management P&L ${label} exceeds safe integer-paise limits.`);
    return paise;
}

function addField(total, row, field, label, warnings, context) {
    const value = moneyPaise(row[field], label, warnings, context);
    if (value === null) return { total, missing: true, invalid: false };
    const invalid = value < 0;
    if (invalid) warnings.push({ code: "ACCOUNTING_AMOUNT_NEGATIVE", severity: "ERROR",
        message: `A persisted ${label} is negative.`, affectedCount: 1, affectedValuePaise: value, ...context });
    return { total: safeAdd(total, value, label), missing: false, invalid };
}

function addWarning(warnings, code, severity, message, count, value = null) {
    if (count > 0) warnings.push({ code, severity, message, affectedCount: count, affectedValuePaise: value });
}

function deriveLegacyGrossPaise(row) {
    const toPaise = value => {
        const number = Number(value);
        if (value === null || value === undefined || value === "" || !Number.isFinite(number) || number < 0) return null;
        const paise = Math.round((number + Number.EPSILON) * 100);
        return Number.isSafeInteger(paise) ? paise : null;
    };
    const net = toPaise(row.net_amount);
    const discount = toPaise(row.discount_amount);
    const taxable = toPaise(row.taxable_amount);
    const gst = toPaise(row.gst_amount);
    if ([net, discount, taxable, gst].some(value => value === null) || Math.abs(net - taxable - gst) > 1) return null;
    const gross = net + discount;
    return Number.isSafeInteger(gross) ? gross : null;
}

function compactWarnings(warnings) {
    const grouped = new Map();
    for (const warning of warnings) {
        const key = `${warning.code}\u0000${warning.severity}\u0000${warning.message}`;
        const existing = grouped.get(key);
        if (!existing) {
            grouped.set(key, { ...warning, affectedCount: Number(warning.affectedCount || 0),
                affectedValuePaise: Number.isSafeInteger(warning.affectedValuePaise) ? warning.affectedValuePaise : null });
            continue;
        }
        existing.affectedCount += Number(warning.affectedCount || 0);
        if (Number.isSafeInteger(warning.affectedValuePaise)) {
            existing.affectedValuePaise = (existing.affectedValuePaise || 0) + warning.affectedValuePaise;
        }
        delete existing.billNo;
        delete existing.billItemId;
        delete existing.returnNo;
        delete existing.returnItemId;
    }
    return [...grouped.values()];
}

function percent(numerator, denominator) {
    if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator === 0) return null;
    return numerator * 100 / denominator;
}

function statusOfCost(row, warnings, type) {
    const status = row.cost_basis_status;
    if (status === "CAPTURED") {
        const unitCost = Number(row.unit_cost_paise);
        const valid = row.unit_cost_paise != null && Number.isSafeInteger(unitCost) && unitCost >= 0 && Boolean(String(row.cost_source || "").trim()) &&
            String(row.cost_method || "").trim() === "SALE_TIME_COST_PRICE_PAISE";
        if (valid) return "CAPTURED";
        addWarning(warnings, "COST_SNAPSHOT_INCONSISTENT", "ERROR", `A ${type} line marked CAPTURED has an incomplete or invalid immutable cost snapshot.`, 1);
        return "CONTRADICTORY";
    }
    if (status === "UNKNOWN" || status === "NOT_APPLICABLE") {
        if (row.unit_cost_paise == null && row.cost_source == null && row.cost_method == null) return status;
        addWarning(warnings, "COST_SNAPSHOT_INCONSISTENT", "ERROR", `A ${type} line marked ${status} contains cost values that should be absent.`, 1);
        return "CONTRADICTORY";
    }
    addWarning(warnings, "COST_STATUS_INVALID", "ERROR", `A ${type} line has an unsupported cost status.`, 1);
    return "CONTRADICTORY";
}

function makeExpenseGroups(rows, segment) {
    const byKey = new Map();
    const unclassified = [];
    for (const category of EXPENSE_HEADERS) {
        for (const businessSegment of ["KL", "MENS", "KIDS", "COMMON"]) {
            if (segment !== "ALL" && businessSegment !== segment && businessSegment !== "COMMON") continue;
            byKey.set(`${category}\u0000${businessSegment}`, { category, businessSegment, amountPaise: 0, expenseCount: 0 });
        }
    }
    for (const row of rows) {
        const key = `${row.category}\u0000${row.business_segment}`;
        if (!byKey.has(key)) {
            unclassified.push({ category: row.category, businessSegment: row.business_segment,
                amountPaise: Number(row.total_amount_paise || 0), expenseCount: Number(row.expense_count || 0) });
            continue;
        }
        const item = byKey.get(key);
        item.amountPaise = safeAdd(item.amountPaise, Number(row.total_amount_paise || 0), "expense category total");
        item.expenseCount = safeAdd(item.expenseCount, Number(row.expense_count || 0), "expense count");
    }
    const values = [...byKey.values()];
    const directValues = values.filter(row => row.businessSegment !== "COMMON");
    const commonValues = values.filter(row => row.businessSegment === "COMMON");
    const reportValues = segment === "ALL" ? values : directValues;
    const categories = EXPENSE_HEADERS.map(category => {
        const matching = reportValues.filter(row => row.category === category);
        return { category, amountPaise: matching.reduce((sum, row) => safeAdd(sum, row.amountPaise, "expense category total"), 0), expenseCount: matching.reduce((sum, row) => safeAdd(sum, row.expenseCount, "expense count"), 0) };
    });
    const groups = CATEGORY_GROUPS.map(group => {
        const matching = categories.filter(row => group.categories.includes(row.category));
        return { name: group.name, categories: [...group.categories], amountPaise: matching.reduce((sum, row) => safeAdd(sum, row.amountPaise, "expense group total"), 0), expenseCount: matching.reduce((sum, row) => safeAdd(sum, row.expenseCount, "expense count"), 0) };
    });
    const directCategories = EXPENSE_HEADERS.map(category => {
        const matching = directValues.filter(row => row.category === category);
        return { category, amountPaise: matching.reduce((sum, row) => safeAdd(sum, row.amountPaise, "direct expense category total"), 0), expenseCount: matching.reduce((sum, row) => safeAdd(sum, row.expenseCount, "expense count"), 0) };
    });
    const commonCategories = EXPENSE_HEADERS.map(category => {
        const matching = commonValues.filter(row => row.category === category);
        return { category, amountPaise: matching.reduce((sum, row) => safeAdd(sum, row.amountPaise, "COMMON expense category total"), 0), expenseCount: matching.reduce((sum, row) => safeAdd(sum, row.expenseCount, "expense count"), 0) };
    });
    const unclassifiedOperatingExpensesPaise = unclassified.reduce((sum, row) => safeAdd(sum, row.amountPaise, "unclassified expenses"), 0);
    const unclassifiedExpenseCount = unclassified.reduce((sum, row) => safeAdd(sum, row.expenseCount, "unclassified expense count"), 0);
    const total = safeAdd(categories.reduce((sum, row) => safeAdd(sum, row.amountPaise, "total operating expenses"), 0),
        unclassifiedOperatingExpensesPaise, "total operating expenses");
    const directTotal = directCategories.reduce((sum, row) => safeAdd(sum, row.amountPaise, "direct operating expenses"), 0);
    const commonTotal = commonCategories.reduce((sum, row) => safeAdd(sum, row.amountPaise, "COMMON expenses"), 0);
    return { available: true, categories, managementGroups: groups, totalOperatingExpensesPaise: total,
        commonCategories,
        commonOperatingExpensesPaise: commonTotal,
        directCategories,
        directOperatingExpensesPaise: directTotal,
        unclassified, unclassifiedExpenseCount, unclassifiedOperatingExpensesPaise,
        byCategoryAndSegment: values };
}

function createManagementPnlService(database, options = {}) {
    if (!database || typeof database.all !== "function") throw new TypeError("A SQLite database connection is required.");
    const getCurrentStore = options.getCurrentStore || (() => require("./storeIdentityService").getCurrentStore());
    const returnCogs = options.returnCogsService || createReturnCogsService(database);
    const now = options.now || (() => new Date());
    const accountingEntries = options.accountingEntryService || createManagementAccountingEntryService(database, { getCurrentStore, now });

    async function querySales(period, segment) {
        const params = [period.fromDate, period.toDate];
        return dbAll(database, `
            SELECT b.id AS bill_id, b.bill_no, b.bill_date, b.payment_status,
                   bi.id AS bill_item_id, bi.qty, bi.business_segment,
                   bi.gross_amount, bi.discount_amount, bi.taxable_amount, bi.gst_amount, bi.net_amount,
                   bi.unit_cost_paise, bi.cost_basis_status, bi.cost_source, bi.cost_method
            FROM bills b
            JOIN bill_items bi ON bi.bill_no = b.bill_no
            WHERE b.bill_date >= ? AND b.bill_date <= ?
            ORDER BY b.bill_date, b.id, bi.id
        `, params);
    }

    async function queryExpenses(period, store, segment) {
        if (!store) return [];
        const params = [period.fromDate, period.toDate, store.id];
        const segmentFilter = segment === "ALL" ? "" : " AND e.business_segment IN (?, 'COMMON')";
        if (segment !== "ALL") params.push(segment);
        return dbAll(database, `
            SELECT e.category, e.business_segment, COUNT(*) AS expense_count,
                   SUM(e.amount_paise) AS total_amount_paise
            FROM expenses e
            JOIN expense_batches b ON b.id = e.batch_id
            JOIN stores s ON s.id = e.store_id AND s.id = b.store_id
            WHERE e.expense_date >= ? AND e.expense_date <= ?
              AND e.store_id = ? AND b.status = 'POSTED'
              AND e.lifecycle_status = 'ACTIVE'
              AND e.expense_code IS NOT NULL AND e.batch_id IS NOT NULL AND e.posted_at IS NOT NULL
              AND b.expense_count = (SELECT COUNT(*) FROM expenses bx WHERE bx.batch_id = b.id)
              AND b.total_amount_paise = (SELECT COALESCE(SUM(bx.amount_paise),0) FROM expenses bx WHERE bx.batch_id = b.id)
              AND NOT EXISTS (SELECT 1 FROM expenses bx WHERE bx.batch_id = b.id AND
                  (bx.lifecycle_status <> 'ACTIVE' OR bx.expense_code IS NULL OR bx.posted_at IS NULL OR bx.store_id <> b.store_id))
              ${segmentFilter}
            GROUP BY e.category, e.business_segment
            ORDER BY e.category, e.business_segment
        `, params);
    }

    async function queryExpenseBatchIssues(period, store, segment) {
        if (!store) return { count: 0, amountPaise: 0 };
        const params = [period.fromDate, period.toDate, store.id];
        const segmentFilter = segment === "ALL" ? "" : " AND scoped.business_segment IN (?, 'COMMON')";
        if (segment !== "ALL") params.push(segment);
        const rows = await dbAll(database, `
            SELECT COUNT(*) AS issue_count,
                   COALESCE(SUM(b.total_amount_paise),0) AS issue_amount_paise
            FROM expense_batches b
            WHERE EXISTS (SELECT 1 FROM expenses scoped WHERE scoped.batch_id=b.id
                AND scoped.expense_date >= ? AND scoped.expense_date <= ? AND scoped.store_id = ?${segmentFilter})
              AND (b.status <> 'POSTED'
                OR b.expense_count <> (SELECT COUNT(*) FROM expenses bx WHERE bx.batch_id = b.id)
                OR b.total_amount_paise <> (SELECT COALESCE(SUM(bx.amount_paise),0) FROM expenses bx WHERE bx.batch_id = b.id)
                OR EXISTS (SELECT 1 FROM expenses bx WHERE bx.batch_id = b.id AND
                    (bx.lifecycle_status <> 'ACTIVE' OR bx.expense_code IS NULL OR bx.posted_at IS NULL OR bx.store_id <> b.store_id)))
        `, params);
        return { count: Number(rows[0]?.issue_count || 0), amountPaise: Number(rows[0]?.issue_amount_paise || 0) };
    }

    async function queryPostedExpenseDetails(period, segment, store) {
        if (!store) return { rows: [], totalCount: 0, totalAmountPaise: 0 };
        const params = [period.fromDate, period.toDate, store.id];
        const segmentFilter = segment === "ALL" ? "" : " AND e.business_segment IN (?, 'COMMON')";
        if (segment !== "ALL") params.push(segment);
        const rows = await dbAll(database, `
            SELECT e.expense_code, b.batch_code, e.expense_date, e.category,
                   e.business_segment, e.payment_mode, e.reference, e.amount_paise,
                   e.remarks, e.posted_at, s.store_code, s.store_name
            FROM expenses e
            JOIN expense_batches b ON b.id = e.batch_id
            JOIN stores s ON s.id = e.store_id AND s.id = b.store_id
            WHERE e.expense_date >= ? AND e.expense_date <= ? AND e.store_id = ?
              AND b.status = 'POSTED' AND e.lifecycle_status = 'ACTIVE'
              AND e.expense_code IS NOT NULL AND e.batch_id IS NOT NULL AND e.posted_at IS NOT NULL
              AND b.expense_count = (SELECT COUNT(*) FROM expenses bx WHERE bx.batch_id = b.id)
              AND b.total_amount_paise = (SELECT COALESCE(SUM(bx.amount_paise),0) FROM expenses bx WHERE bx.batch_id = b.id)
              AND NOT EXISTS (SELECT 1 FROM expenses bx WHERE bx.batch_id = b.id AND
                  (bx.lifecycle_status <> 'ACTIVE' OR bx.expense_code IS NULL OR bx.posted_at IS NULL OR bx.store_id <> b.store_id))
              ${segmentFilter}
            ORDER BY e.expense_date, e.expense_code
        `, params);
        const totalAmountPaise = rows.reduce((sum, row) => safeAdd(sum, Number(row.amount_paise), "exported posted expense amount"), 0);
        return { rows: rows.map(row => ({ ...row, management_group:
            CATEGORY_GROUPS.find(group => group.categories.includes(row.category))?.name || "Unclassified" })),
            totalCount: rows.length, totalAmountPaise };
    }

    async function calculatePeriod(period, segment, store) {
        const warnings = [];
        const saleRowsPromise = querySales(period, segment);
        const returnRowsPromise = returnCogs.listCompletedReturnCogsReversals({
            fromDate: period.fromDate, toDate: period.toDate, businessSegment: null
        });
        const expenseRowsPromise = queryExpenses(period, store, segment);
        const expenseBatchIssuesPromise = queryExpenseBatchIssues(period, store, segment);
        const accountingEntriesPromise = store ? accountingEntries.listEntries({ fromDate: period.fromDate, toDate: period.toDate }) : Promise.resolve([]);
        const unassessedParams = [period.fromDate, period.toDate];
        const unassessedPromise = dbAll(database, `SELECT COUNT(*) AS row_count, COALESCE(SUM(net_reversal),0) AS net_value FROM returns r
            WHERE r.business_date >= ? AND r.business_date <= ?
              AND (r.accounting_status <> 'COMPLETED' OR r.accounting_snapshot_version IS NOT 1
                   OR r.credit_note_no IS NULL OR TRIM(r.credit_note_no) NOT GLOB 'CN[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]')`, unassessedParams);
        const [sales, returns, expenseRows, expenseBatchIssues, unassessedRows, accountingEntryRows] = await Promise.all([saleRowsPromise, returnRowsPromise, expenseRowsPromise, expenseBatchIssuesPromise, unassessedPromise, accountingEntriesPromise]);
        const allSales = sales;
        const allReturns = returns;
        const scopedSales = segment === "ALL" ? allSales : allSales.filter(row => row.business_segment === segment);
        const scopedReturns = segment === "ALL" ? allReturns : allReturns.filter(row => row.business_segment === segment);

        const HEAD_KEYS = {
            INTEREST_INCOME: "interestIncomePaise",
            OTHER_NON_OPERATING_INCOME: "otherNonOperatingIncomePaise",
            INTEREST_FINANCE_CHARGES: "financeCostsPaise",
            DEPRECIATION: "depreciationPaise",
            AMORTISATION: "amortisationPaise",
            OTHER_NON_OPERATING_EXPENSE: "otherNonOperatingExpensePaise",
            INCOME_TAX_PROVISION: "incomeTaxProvisionPaise"
        };
        const makeEntryTotals = () => ({ interestIncomePaise: 0, otherNonOperatingIncomePaise: 0,
            financeCostsPaise: 0, depreciationPaise: 0, amortisationPaise: 0,
            otherNonOperatingExpensePaise: 0, incomeTaxProvisionPaise: 0,
            exceptionalIncomePaise: 0, exceptionalExpensePaise: 0,
            entryCount: 0 });
        const accounting = { selected: makeEntryTotals(), common: makeEntryTotals(), all: makeEntryTotals(), rows: [] };
        for (const entry of accountingEntryRows) {
            if (!['KL', 'MENS', 'KIDS', 'COMMON'].includes(entry.business_segment) || entry.status !== 'POSTED' ||
                !Number.isSafeInteger(Number(entry.amount_paise)) || Number(entry.amount_paise) <= 0 ||
                ![-1, 1].includes(Number(entry.accounting_sign))) continue;
            const sign = Number(entry.accounting_sign);
            const target = entry.accounting_head === 'EXCEPTIONAL_ADJUSTMENT'
                ? (entry.adjustment_effect === 'INCOME' ? 'exceptionalIncomePaise' : entry.adjustment_effect === 'EXPENSE' ? 'exceptionalExpensePaise' : null)
                : HEAD_KEYS[entry.accounting_head];
            if (!target) continue;
            const signed = safeAdd(0, Number(entry.amount_paise) * sign, 'management accounting entry');
            accounting.all[target] = safeAdd(accounting.all[target], signed, 'management accounting entries');
            accounting.all.entryCount += 1;
            if (entry.business_segment === 'COMMON') {
                accounting.common[target] = safeAdd(accounting.common[target], signed, 'COMMON management accounting entries');
                accounting.common.entryCount += 1;
            }
            if (entry.business_segment === segment || segment === 'ALL') {
                accounting.selected[target] = safeAdd(accounting.selected[target], signed, 'selected management accounting entries');
                accounting.selected.entryCount += 1;
            }
            const naturalSign = entry.accounting_head === 'EXCEPTIONAL_ADJUSTMENT'
                ? (entry.adjustment_effect === 'INCOME' ? 1 : -1)
                : ['INTEREST_INCOME', 'OTHER_NON_OPERATING_INCOME'].includes(entry.accounting_head) ? 1 : -1;
            accounting.rows.push({ ...entry, pnl_effect_paise: safeAdd(0, Number(entry.amount_paise) * sign * naturalSign, 'management accounting P&L effect') });
        }
        if (segment === 'ALL') accounting.selected = accounting.all;

        const revenue = { grossBillingsInclGstPaise: 0, grossCompatibilityAppliedCount: 0, grossCompatibilityAppliedPaise: 0, discountsInclGstEffectPaise: 0,
            salesTaxableBeforeReturnsPaise: 0, salesGstPaise: 0, salesNetInclGstPaise: 0,
            completedReturnGrossReversalPaise: 0, completedReturnDiscountReversalPaise: 0,
            completedReturnTaxableReversalPaise: 0, completedReturnGstReversalPaise: 0,
            completedReturnNetReversalPaise: 0, netGstOnSalesPaise: 0,
            netBillingsInclGstAfterReturnsPaise: 0, netSalesExGstPaise: 0,
            saleLineCount: scopedSales.length, saleBillCount: new Set(scopedSales.map(row => String(row.bill_id))).size,
            returnLineCount: scopedReturns.length, returnCount: new Set(scopedReturns.map(row => String(row.return_id))).size,
            available: true };
        const revenueFields = [
            ["gross_amount", "grossBillingsInclGstPaise", "gross billing"],
            ["discount_amount", "discountsInclGstEffectPaise", "discount"],
            ["taxable_amount", "salesTaxableBeforeReturnsPaise", "taxable sales"],
            ["gst_amount", "salesGstPaise", "sales GST"],
            ["net_amount", "salesNetInclGstPaise", "GST-inclusive sales"]
        ];
        for (const row of scopedSales) {
            for (const [field, target, label] of revenueFields) {
                if (field === "gross_amount" && (row.gross_amount === null || row.gross_amount === undefined || row.gross_amount === "")) {
                    const derived = deriveLegacyGrossPaise(row);
                    if (derived !== null) {
                        revenue.grossBillingsInclGstPaise = safeAdd(revenue.grossBillingsInclGstPaise, derived, "legacy gross billing");
                        revenue.grossCompatibilityAppliedCount += 1;
                        revenue.grossCompatibilityAppliedPaise = safeAdd(revenue.grossCompatibilityAppliedPaise, derived, "legacy gross billing compatibility total");
                        continue;
                    }
                }
                const result = addField(revenue[target], row, field, label, warnings, { billNo: row.bill_no, billItemId: row.bill_item_id });
                revenue[target] = result.total;
                if (result.missing || result.invalid) revenue.available = false;
            }
        }
        if (revenue.grossCompatibilityAppliedCount > 0) {
            warnings.push({ code: "HISTORICAL_GROSS_COMPATIBILITY_APPLIED", severity: "INFO",
                message: "Historical gross billing was reconstructed from persisted line snapshots.",
                affectedCount: revenue.grossCompatibilityAppliedCount,
                affectedValuePaise: revenue.grossCompatibilityAppliedPaise });
        }

        const returnsByStatus = { CAPTURED: { taxable: 0, cogs: 0, count: 0 }, UNKNOWN: { taxable: 0, cogs: 0, count: 0 }, NOT_APPLICABLE: { taxable: 0, cogs: 0, count: 0 } };
        let returnRevenueAvailable = true;
        let returnCostContradictions = 0;
        for (const row of scopedReturns) {
            for (const [field, target, label] of [
                ["gross_reversal", "completedReturnGrossReversalPaise", "return gross reversal"],
                ["discount_reversal", "completedReturnDiscountReversalPaise", "return discount reversal"],
                ["taxable_reversal", "completedReturnTaxableReversalPaise", "return taxable reversal"],
                ["gst_reversal", "completedReturnGstReversalPaise", "return GST reversal"],
                ["net_reversal", "completedReturnNetReversalPaise", "return net reversal"]
            ]) {
                const result = addField(revenue[target], row, field, label, warnings, { returnNo: row.return_no, returnItemId: row.return_item_id });
                revenue[target] = result.total;
                if (result.missing || result.invalid) returnRevenueAvailable = false;
            }
            const status = row.return_cost_basis_status;
            let validStatus = status === row.original_cost_basis_status && ["CAPTURED", "UNKNOWN", "NOT_APPLICABLE"].includes(status);
            if (validStatus && status === "CAPTURED") {
                validStatus = row.original_unit_cost_paise != null && Number.isSafeInteger(Number(row.original_unit_cost_paise)) && Number(row.original_unit_cost_paise) >= 0 &&
                    row.return_unit_cost_paise != null && row.return_cost_paise != null &&
                    Number.isSafeInteger(Number(row.return_unit_cost_paise)) &&
                    Number(row.return_unit_cost_paise) >= 0 &&
                    Number(row.return_unit_cost_paise) === Number(row.original_unit_cost_paise) &&
                    Number.isSafeInteger(Number(row.return_cost_paise)) &&
                    Number(row.return_cost_paise) >= 0 &&
                    Number(row.return_cost_paise) === Number(row.return_unit_cost_paise) * Number(row.returned_quantity) &&
                    Number(row.returned_quantity) > 0 && Number.isInteger(Number(row.returned_quantity)) &&
                    Number(row.returned_quantity) <= Number(row.original_sold_quantity) &&
                    Number(row.return_cost_paise) <= Number(row.original_unit_cost_paise) * Number(row.original_sold_quantity) &&
                    row.return_cost_method === "ORIGINAL_SALE_TIME_COST_REVERSAL" &&
                    row.return_cost_source === row.original_cost_source &&
                    row.original_cost_method === "SALE_TIME_COST_PRICE_PAISE";
            }
            if (validStatus && status !== "CAPTURED") {
                validStatus = row.return_unit_cost_paise == null && row.return_cost_paise == null &&
                    row.return_cost_source == null && row.return_cost_method == null &&
                    row.original_unit_cost_paise == null && row.original_cost_source == null && row.original_cost_method == null;
            }
            if (!validStatus) {
                returnCostContradictions += 1;
                addWarning(warnings, "RETURN_COGS_STATUS_INCONSISTENT", "ERROR", "A completed return cost snapshot does not agree with its original sale cost basis.", 1, null);
                continue;
            }
            const taxable = moneyPaise(row.taxable_reversal, "return taxable reversal", warnings, { returnItemId: row.return_item_id });
            if (taxable === null) { returnRevenueAvailable = false; continue; }
            const bucket = returnsByStatus[status];
            bucket.taxable = safeAdd(bucket.taxable, taxable, "return cost coverage value");
            bucket.count += 1;
            if (status === "CAPTURED") {
                const cost = Number(row.return_cost_paise);
                bucket.cogs = safeAdd(bucket.cogs, cost, "captured return COGS reversal");
            }
        }
        revenue.available = revenue.available && returnRevenueAvailable;
        revenue.netGstOnSalesPaise = revenue.salesGstPaise - revenue.completedReturnGstReversalPaise;
        revenue.netBillingsInclGstAfterReturnsPaise = revenue.salesNetInclGstPaise - revenue.completedReturnNetReversalPaise;
        revenue.netSalesExGstPaise = revenue.salesTaxableBeforeReturnsPaise - revenue.completedReturnTaxableReversalPaise;
        const grossBridgePaise = revenue.grossBillingsInclGstPaise - revenue.discountsInclGstEffectPaise;
        const salesBridgeDifferencePaise = grossBridgePaise - revenue.salesNetInclGstPaise;
        const taxBridgeDifferencePaise = revenue.salesNetInclGstPaise - revenue.salesTaxableBeforeReturnsPaise - revenue.salesGstPaise;
        const returnBridgeDifferencePaise = revenue.completedReturnNetReversalPaise - revenue.completedReturnTaxableReversalPaise - revenue.completedReturnGstReversalPaise;
        const netSalesBridgeDifferencePaise = revenue.netBillingsInclGstAfterReturnsPaise - revenue.netGstOnSalesPaise - revenue.netSalesExGstPaise;
        let revenueBridgeValid = true;
        for (const [name, difference] of [["sales gross/discount/net", salesBridgeDifferencePaise], ["sales taxable/GST", taxBridgeDifferencePaise], ["return taxable/GST", returnBridgeDifferencePaise], ["net sales/GST", netSalesBridgeDifferencePaise]]) {
            if (Math.abs(difference) > 1) {
                revenueBridgeValid = false;
                addWarning(warnings, "REVENUE_GST_RECONCILIATION_MISMATCH", "ERROR", `Persisted revenue snapshots do not reconcile for ${name}.`, 1, difference);
            }
        }
        revenue.available = revenue.available && revenueBridgeValid;

        let capturedSaleCogsPaise = 0;
        let capturedSaleTaxableValuePaise = 0;
        let unknownSaleTaxableValuePaise = 0;
        let notApplicableSaleTaxableValuePaise = 0;
        let capturedSaleLineCount = 0;
        let unknownSaleLineCount = 0;
        let notApplicableSaleLineCount = 0;
        let costContradictions = 0;
        for (const row of scopedSales) {
            const status = statusOfCost(row, warnings, "sale");
            let taxable = moneyPaise(row.taxable_amount, "taxable sale value", warnings, { billNo: row.bill_no, billItemId: row.bill_item_id });
            if (taxable === null) { revenue.available = false; continue; }
            if (status === "CAPTURED") {
                const quantity = Number(row.qty);
                const cost = Number(row.unit_cost_paise) * quantity;
                if (!Number.isInteger(quantity) || quantity <= 0 || !Number.isSafeInteger(cost)) {
                    costContradictions += 1;
                    addWarning(warnings, "SALE_COGS_INCONSISTENT", "ERROR", "A captured sale line has invalid quantity or exceeds safe integer-paise cost limits.", 1);
                    unknownSaleTaxableValuePaise = safeAdd(unknownSaleTaxableValuePaise, taxable, "unknown-cost sales value");
                    unknownSaleLineCount += 1;
                    continue;
                }
                capturedSaleCogsPaise = safeAdd(capturedSaleCogsPaise, cost, "captured sale COGS");
                capturedSaleTaxableValuePaise = safeAdd(capturedSaleTaxableValuePaise, taxable, "captured sale taxable value");
                capturedSaleLineCount += 1;
            } else if (status === "NOT_APPLICABLE") {
                notApplicableSaleTaxableValuePaise = safeAdd(notApplicableSaleTaxableValuePaise, taxable, "not-applicable sales value");
                notApplicableSaleLineCount += 1;
            } else {
                unknownSaleTaxableValuePaise = safeAdd(unknownSaleTaxableValuePaise, taxable, "unknown-cost sales value");
                unknownSaleLineCount += 1;
                if (status === "CONTRADICTORY") costContradictions += 1;
            }
        }

        const saleCostByStatus = {
            CAPTURED: { taxable: capturedSaleTaxableValuePaise, cogs: capturedSaleCogsPaise, count: capturedSaleLineCount },
            UNKNOWN: { taxable: unknownSaleTaxableValuePaise, cogs: 0, count: unknownSaleLineCount },
            NOT_APPLICABLE: { taxable: notApplicableSaleTaxableValuePaise, cogs: 0, count: notApplicableSaleLineCount }
        };
        const returnBucketFor = status => returnsByStatus[status];
        const capturedNetSalesPaise = saleCostByStatus.CAPTURED.taxable - returnBucketFor("CAPTURED").taxable;
        const unknownNetSalesPaise = saleCostByStatus.UNKNOWN.taxable - returnBucketFor("UNKNOWN").taxable;
        const notApplicableNetSalesPaise = saleCostByStatus.NOT_APPLICABLE.taxable - returnBucketFor("NOT_APPLICABLE").taxable;
        const eligibleNetSalesPaise = capturedNetSalesPaise + unknownNetSalesPaise;
        const capturedReturnCogsReversalPaise = returnBucketFor("CAPTURED").cogs;
        const netCapturedCogsPaise = capturedSaleCogsPaise - capturedReturnCogsReversalPaise;
        if ([capturedNetSalesPaise, unknownNetSalesPaise, notApplicableNetSalesPaise, netCapturedCogsPaise].some(value => !Number.isSafeInteger(value))) {
            throw new Error("Management P&L cost coverage or net COGS exceeded safe integer-paise limits.");
        }
        const coverageStatus = eligibleNetSalesPaise !== 0
            ? (unknownNetSalesPaise === 0 ? "COMPLETE" : "INCOMPLETE")
            : "NO_ELIGIBLE_SALES";
        const costCoveragePercent = eligibleNetSalesPaise !== 0
            ? percent(capturedNetSalesPaise, eligibleNetSalesPaise) : null;
        const returnCostStatusBad = returnCostContradictions > 0;
        const saleStatusBad = costContradictions > 0;
        const coveredGrossProfitPaise = capturedNetSalesPaise - netCapturedCogsPaise;
        const coveredGrossProfitAvailable = !saleStatusBad && !returnCostStatusBad && revenue.available;
        const hasNotApplicableActivity = notApplicableSaleTaxableValuePaise !== 0 || returnsByStatus.NOT_APPLICABLE.taxable !== 0;
        const fullGrossProfitAvailable = revenue.available && !saleStatusBad && !returnCostStatusBad &&
            unknownNetSalesPaise === 0 && unknownSaleLineCount === 0 && returnsByStatus.UNKNOWN.count === 0 &&
            notApplicableNetSalesPaise === 0 && !hasNotApplicableActivity;

        addWarning(warnings, "UNKNOWN_COST_SALES", "WARNING", "Some eligible sale value has no reliable immutable cost snapshot.", unknownSaleLineCount + returnsByStatus.UNKNOWN.count, unknownNetSalesPaise);
        addWarning(warnings, "NOT_APPLICABLE_VVP_SALES", "WARNING", "Variable Value / not-applicable sales are disclosed separately and are not treated as zero-cost profit.", notApplicableSaleLineCount + returnsByStatus.NOT_APPLICABLE.count, notApplicableNetSalesPaise);

        const unclassifiedSales = allSales.filter(row => !normalizeBusinessSegment(row.business_segment, { allowLabels: false }));
        const unclassifiedReturns = allReturns.filter(row => !normalizeBusinessSegment(row.business_segment, { allowLabels: false }));
        addWarning(warnings, "UNCLASSIFIED_BUSINESS_SEGMENT_SALES", "WARNING", "Some sale lines have no recognized Business Segment attribution.", unclassifiedSales.length,
            unclassifiedSales.reduce((sum, row) => sum + (moneyPaise(row.taxable_amount, "unclassified taxable sale", [], {}) || 0), 0));
        addWarning(warnings, "UNCLASSIFIED_RETURN_ATTRIBUTION", "WARNING", "Some completed return lines have no original Business Segment attribution.", unclassifiedReturns.length,
            unclassifiedReturns.reduce((sum, row) => sum + (moneyPaise(row.taxable_reversal, "unclassified return taxable reversal", [], {}) || 0), 0));
        const unassessedCount = Number(unassessedRows[0]?.row_count || 0);
        addWarning(warnings, "LEGACY_RETURNS_EXCLUDED", "WARNING", "Legacy, unassessed, or invalid completed returns are excluded from accounting totals.", unassessedCount,
            unassessedCount ? Math.round(Number(unassessedRows[0].net_value || 0) * 100) : null);

        const reconciliation = {
            revenue: { grossLessDiscountPaise: grossBridgePaise, salesNetInclGstPaise: revenue.salesNetInclGstPaise,
                netSalesBridgeDifferencePaise, withinOnePaise: Math.abs(netSalesBridgeDifferencePaise) <= 1 },
            cogs: { capturedSaleCogsPaise, capturedReturnCogsReversalPaise, netCapturedCogsPaise,
                reconciles: capturedSaleCogsPaise - capturedReturnCogsReversalPaise === netCapturedCogsPaise },
            costCoverage: { capturedNetSalesPaise, unknownNetSalesPaise, notApplicableNetSalesPaise,
                netSalesExGstPaise: revenue.netSalesExGstPaise,
                differencePaise: capturedNetSalesPaise + unknownNetSalesPaise + notApplicableNetSalesPaise - revenue.netSalesExGstPaise },
            expense: null
        };
        if (Math.abs(reconciliation.costCoverage.differencePaise) > 1) addWarning(warnings, "COST_COVERAGE_POPULATION_MISMATCH", "ERROR", "Cost-status populations do not reconcile to GST-exclusive Net Sales.", 1, reconciliation.costCoverage.differencePaise);

        const expenses = makeExpenseGroups(expenseRows, segment);
        addWarning(warnings, "EXPENSE_POSTED_BATCH_INVALID", "ERROR", "One or more expense batches do not reconcile to their posted expense rows or Store attribution.", expenseBatchIssues.count, expenseBatchIssues.amountPaise);
        const categoryTotal = expenses.categories.reduce((sum, row) => safeAdd(sum, row.amountPaise, "expense category reconciliation"), 0);
        const groupTotal = expenses.managementGroups.reduce((sum, row) => safeAdd(sum, row.amountPaise, "expense group reconciliation"), 0);
        const commonCategoryTotal = expenses.commonCategories.reduce((sum, row) => safeAdd(sum, row.amountPaise, "COMMON expense reconciliation"), 0);
        const expectedExpenseTotal = segment === "ALL" ? expenses.totalOperatingExpensesPaise : expenses.directOperatingExpensesPaise;
        reconciliation.expense = { categoryTotalPaise: categoryTotal, managementGroupTotalPaise: groupTotal,
            totalOperatingExpensesPaise: expenses.totalOperatingExpensesPaise, directOperatingExpensesPaise: expenses.directOperatingExpensesPaise,
            commonCategoryTotalPaise: commonCategoryTotal, commonOperatingExpensesPaise: expenses.commonOperatingExpensesPaise,
            categoryDifferencePaise: categoryTotal - expectedExpenseTotal, groupDifferencePaise: groupTotal - expectedExpenseTotal,
            commonDifferencePaise: commonCategoryTotal - expenses.commonOperatingExpensesPaise,
            reconciles: categoryTotal === expectedExpenseTotal && groupTotal === expectedExpenseTotal && commonCategoryTotal === expenses.commonOperatingExpensesPaise };
        if (!reconciliation.expense.reconciles || expenses.unclassifiedExpenseCount > 0) addWarning(warnings, "EXPENSE_AGGREGATION_MISMATCH", "ERROR", "Expense categories and management groups do not reconcile to the operating expense total.", expenses.unclassifiedExpenseCount || 1, expenses.unclassifiedOperatingExpensesPaise || null);
        if (expenseBatchIssues.count > 0) {
            expenses.available = false;
            expenses.totalOperatingExpensesPaise = null;
        }

        const gpAvailable = fullGrossProfitAvailable;
        const expenseSummaryAvailable = expenses.unclassifiedExpenseCount === 0 && expenseBatchIssues.count === 0 && reconciliation.expense.reconciles;
        const segmentResultAvailable = segment !== "ALL" && fullGrossProfitAvailable && expenseSummaryAvailable;
        const directOperatingResultPaise = segmentResultAvailable
            ? coveredGrossProfitPaise - expenses.directOperatingExpensesPaise : null;
        const allOperatingProfitPaise = segment === "ALL" && gpAvailable && expenseSummaryAvailable
            ? coveredGrossProfitPaise - expenses.totalOperatingExpensesPaise : null;
        const operatingResult = segment === "ALL" ? {
            operatingProfitAvailable: allOperatingProfitPaise !== null,
            operatingProfitPaise: allOperatingProfitPaise,
            operatingMarginPercent: allOperatingProfitPaise === null ? null : percent(allOperatingProfitPaise, revenue.netSalesExGstPaise),
            unavailableReason: allOperatingProfitPaise !== null ? null : "FULL_GROSS_PROFIT_UNAVAILABLE"
        } : {
            segmentDirectOperatingResultAvailable: segmentResultAvailable,
            segmentDirectOperatingResultPaise: directOperatingResultPaise,
            segmentDirectOperatingMarginPercent: directOperatingResultPaise === null ? null : percent(directOperatingResultPaise, revenue.netSalesExGstPaise),
            label: "Operating Result Before COMMON Expenses",
            commonOperatingExpensesPaise: expenses.commonOperatingExpensesPaise,
            unavailableReason: segmentResultAvailable ? null : "FULL_SEGMENT_GROSS_PROFIT_UNAVAILABLE"
        };
        const baseProfitAvailable = (operatingResult.operatingProfitAvailable === true || operatingResult.segmentDirectOperatingResultAvailable === true) &&
            expenses.available !== false;
        const ebitdaPaise = baseProfitAvailable ? safeAdd(coveredGrossProfitPaise, -expectedExpenseTotal, "EBITDA") : null;
        const ebitaPaise = ebitdaPaise === null ? null : safeAdd(ebitdaPaise, -accounting.selected.depreciationPaise, "EBITA");
        const ebitPaise = ebitaPaise === null ? null : safeAdd(ebitaPaise, -accounting.selected.amortisationPaise, "EBIT");
        const totalOtherIncomePaise = safeAdd(accounting.selected.interestIncomePaise, accounting.selected.otherNonOperatingIncomePaise, "other income");
        const pbtPaise = ebitPaise === null ? null : safeAdd(
            safeAdd(safeAdd(safeAdd(ebitPaise, totalOtherIncomePaise, "PBT"), -accounting.selected.financeCostsPaise, "PBT"),
                -accounting.selected.otherNonOperatingExpensePaise, "PBT"),
            safeAdd(accounting.selected.exceptionalIncomePaise, -accounting.selected.exceptionalExpensePaise, "exceptional adjustment"), "PBT");
        const patPaise = pbtPaise === null ? null : safeAdd(pbtPaise, -accounting.selected.incomeTaxProvisionPaise, "PAT");
        const profitability = {
            available: baseProfitAvailable,
            ebitdaPaise, ebitdaMarginPercent: ebitdaPaise === null ? null : percent(ebitdaPaise, revenue.netSalesExGstPaise),
            depreciationPaise: accounting.selected.depreciationPaise,
            ebitaPaise, ebitaMarginPercent: ebitaPaise === null ? null : percent(ebitaPaise, revenue.netSalesExGstPaise),
            amortisationPaise: accounting.selected.amortisationPaise,
            ebitPaise, ebitMarginPercent: ebitPaise === null ? null : percent(ebitPaise, revenue.netSalesExGstPaise),
            interestIncomePaise: accounting.selected.interestIncomePaise,
            otherNonOperatingIncomePaise: accounting.selected.otherNonOperatingIncomePaise,
            totalOtherIncomePaise,
            financeCostsPaise: accounting.selected.financeCostsPaise,
            otherNonOperatingExpensePaise: accounting.selected.otherNonOperatingExpensePaise,
            exceptionalIncomePaise: accounting.selected.exceptionalIncomePaise,
            exceptionalExpensePaise: accounting.selected.exceptionalExpensePaise,
            exceptionalAdjustmentPaise: safeAdd(accounting.selected.exceptionalIncomePaise, -accounting.selected.exceptionalExpensePaise, "exceptional adjustment"),
            pbtPaise, pbtMarginPercent: pbtPaise === null ? null : percent(pbtPaise, revenue.netSalesExGstPaise),
            incomeTaxProvisionPaise: accounting.selected.incomeTaxProvisionPaise,
            patPaise, netProfitMarginPercent: patPaise === null ? null : percent(patPaise, revenue.netSalesExGstPaise),
            unavailableReason: baseProfitAvailable ? null : operatingResult.unavailableReason
        };
        if (accounting.selected.entryCount > 0) warnings.push({ code: "MANAGEMENT_ACCOUNTING_ENTRIES_MANUAL", severity: "INFO",
            message: "Below-operating accounting values are management-entered and may be incomplete.",
            affectedCount: accounting.selected.entryCount, affectedValuePaise: null });
        return {
            revenue,
            cogs: {
                capturedSaleCogsPaise, capturedSaleTaxableValuePaise, capturedSaleLineCount,
                capturedReturnCogsReversalPaise, capturedReturnTaxableReversalPaise: returnsByStatus.CAPTURED.taxable,
                capturedReturnLineCount: returnsByStatus.CAPTURED.count,
                unknownSaleTaxableValuePaise, unknownSaleLineCount,
                unknownReturnTaxableReversalPaise: returnsByStatus.UNKNOWN.taxable,
                unknownReturnLineCount: returnsByStatus.UNKNOWN.count,
                notApplicableSaleTaxableValuePaise, notApplicableSaleLineCount,
                notApplicableReturnTaxableReversalPaise: returnsByStatus.NOT_APPLICABLE.taxable,
                notApplicableReturnLineCount: returnsByStatus.NOT_APPLICABLE.count,
                capturedNetSalesPaise, unknownNetSalesPaise, notApplicableNetSalesPaise,
                eligibleNetSalesPaise, costCoveragePercent, coverageStatus, netCapturedCogsPaise,
                coveredGrossProfitPaise: coveredGrossProfitAvailable ? coveredGrossProfitPaise : null,
                coveredGrossProfitAvailable,
                coveredGrossMarginPercent: coveredGrossProfitAvailable ? percent(coveredGrossProfitPaise, capturedNetSalesPaise) : null,
                fullGrossProfitAvailable: gpAvailable,
                fullGrossProfitPaise: gpAvailable ? coveredGrossProfitPaise : null,
                fullGrossMarginPercent: gpAvailable ? percent(coveredGrossProfitPaise, revenue.netSalesExGstPaise) : null,
                fullGrossProfitUnavailableReason: gpAvailable ? null :
                    (returnCostStatusBad || saleStatusBad ? "ACCOUNTING_DATA_QUALITY" :
                        hasNotApplicableActivity ? "NOT_APPLICABLE_COST_BASIS" :
                            unknownNetSalesPaise !== 0 || unknownSaleLineCount > 0 || returnsByStatus.UNKNOWN.count > 0 ? "INCOMPLETE_COST_COVERAGE" : !revenue.available ? "REVENUE_SNAPSHOT_INCOMPLETE" : "NO_ELIGIBLE_COST_BASIS")
            },
            expenses,
            operatingResult,
            otherAccounting: { available: Boolean(store), selected: accounting.selected, common: accounting.common, entryCount: accounting.selected.entryCount,
                commonEntryCount: accounting.common.entryCount, rows: accounting.rows },
            profitability,
            dataQuality: { warnings: compactWarnings(warnings), errorCount: warnings.filter(row => row.severity === "ERROR").length,
                warningCount: warnings.filter(row => row.severity === "WARNING").length },
            reconciliation
        };
    }

    async function getManagementPnl({ fromDate, toDate, comparison = "NONE", businessSegment = "ALL" } = {}) {
        parseDate(fromDate, "period start date");
        parseDate(toDate, "period end date");
        if (fromDate > toDate) throw new Error("P&L period start date must not be after its end date.");
        if (fromDate > getBusinessDate(now())) throw new Error("Future P&L periods are not available.");
        const segment = String(businessSegment || "ALL").toUpperCase();
        if (!VALID_SEGMENTS.has(segment)) throw new Error("Select ALL, KL, MENS, or KIDS for the P&L Business Segment.");
        const selectedPeriod = { fromDate, toDate, label: `${fromDate} to ${toDate}` };
        const comparedPeriod = comparisonPeriod(selectedPeriod, comparison);
        let store = null;
        let storeWarning = null;
        try { store = await getCurrentStore(); }
        catch (error) {
            storeWarning = { code: "STORE_IDENTITY_UNAVAILABLE", severity: "ERROR",
                message: error.message || "Current Store identity is unavailable.", affectedCount: 1, affectedValuePaise: null };
        }
        if (store && (!Number.isSafeInteger(Number(store.id)) || store.status !== "ACTIVE")) {
            store = null;
            storeWarning = { code: "STORE_IDENTITY_UNAVAILABLE", severity: "ERROR",
                message: "Current Store identity is invalid or inactive.", affectedCount: 1, affectedValuePaise: null };
        }
        const selected = await calculatePeriod(selectedPeriod, segment, store);
        if (storeWarning) {
            selected.dataQuality.warnings.unshift(storeWarning);
            selected.dataQuality.errorCount += 1;
            selected.expenses = { ...makeExpenseGroups([], segment), available: false,
                totalOperatingExpensesPaise: null, directOperatingExpensesPaise: null, commonOperatingExpensesPaise: null };
            selected.reconciliation.expense = { categoryTotalPaise: null, managementGroupTotalPaise: null,
                totalOperatingExpensesPaise: null, directOperatingExpensesPaise: null, commonOperatingExpensesPaise: null,
                commonCategoryTotalPaise: null, categoryDifferencePaise: null, groupDifferencePaise: null, commonDifferencePaise: null, reconciles: null };
            if (segment !== "ALL") {
                selected.operatingResult.segmentDirectOperatingResultAvailable = false;
                selected.operatingResult.segmentDirectOperatingResultPaise = null;
                selected.operatingResult.segmentDirectOperatingMarginPercent = null;
                selected.operatingResult.unavailableReason = "STORE_IDENTITY_UNAVAILABLE";
            } else {
                selected.operatingResult.operatingProfitAvailable = false;
                selected.operatingResult.operatingProfitPaise = null;
                selected.operatingResult.operatingMarginPercent = null;
                selected.operatingResult.unavailableReason = "STORE_IDENTITY_UNAVAILABLE";
            }
            invalidateProfitability(selected, "STORE_IDENTITY_UNAVAILABLE");
        }
        const comparisonResult = comparedPeriod ? await calculatePeriod(comparedPeriod, segment, store) : null;
        if (storeWarning && comparisonResult) invalidateProfitability(comparisonResult, "STORE_IDENTITY_UNAVAILABLE");
        const variance = comparisonResult ? deriveVariance(selected, comparisonResult) : null;
        return {
            metadata: {
                store: store ? { storeCode: store.storeCode, storeName: store.storeName } : null,
                selectedPeriod,
                comparisonPeriod: comparedPeriod,
                comparison,
                businessSegment: segment,
                generatedAt: now().toISOString(),
                accountingBasis: "Management view; persisted GST-exclusive sales snapshots; immutable sale-time Product Master cost snapshots; V21-05A return cost reversals; posted Expense Tracker OPEX. Not audited/statutory financial statements."
            },
            selected,
            comparison: comparisonResult,
            variance
        };
    }

    async function getManagementPnlFinancialYear({ financialYearStart, businessSegment = "ALL" } = {}) {
        const startYear = Number(financialYearStart);
        if (!Number.isInteger(startYear) || startYear < 1900 || startYear > 9998) {
            throw new Error("Select a valid Financial Year.");
        }
        const today = getBusinessDate(now());
        const currentYearStart = getFinancialYearStart(today);
        if (startYear > currentYearStart) throw new Error("Future Financial Years are not available.");
        const segment = String(businessSegment || "ALL").toUpperCase();
        if (!VALID_SEGMENTS.has(segment)) throw new Error("Select ALL, KL, MENS, or KIDS for the P&L Business Segment.");
        const active = startYear === currentYearStart;
        const fyStartDate = `${startYear}-04-01`;
        const fyEndDate = `${startYear + 1}-03-31`;
        const asOfDate = active ? today : fyEndDate;
        const comparisonStartDate = `${startYear - 1}-04-01`;
        let comparisonEndDate = `${startYear}-03-31`;
        if (active) {
            const asOf = parseDate(asOfDate);
            const comparisonEnd = new Date(Date.UTC(startYear - 1, asOf.getUTCMonth(), 1));
            const lastDay = new Date(Date.UTC(comparisonEnd.getUTCFullYear(), comparisonEnd.getUTCMonth() + 1, 0)).getUTCDate();
            comparisonEnd.setUTCDate(Math.min(asOf.getUTCDate(), lastDay));
            comparisonEndDate = `${comparisonEnd.getUTCFullYear()}-${String(comparisonEnd.getUTCMonth() + 1).padStart(2, "0")}-${String(comparisonEnd.getUTCDate()).padStart(2, "0")}`;
        }
        const selectedEnd = active ? asOfDate : fyEndDate;
        const [selectedSummaryResult, comparisonSummaryResult] = await Promise.all([
            getManagementPnl({ fromDate: fyStartDate, toDate: selectedEnd, comparison: "NONE", businessSegment: segment }),
            getManagementPnl({ fromDate: comparisonStartDate, toDate: comparisonEndDate, comparison: "NONE", businessSegment: segment })
        ]);
        const months = await Promise.all(Array.from({ length: 12 }, async (_, index) => {
            const year = startYear + Math.floor((index + 3) / 12);
            const monthIndex = (index + 3) % 12;
            const range = monthRange(year, monthIndex);
            if (range.fromDate > selectedEnd) return { index, label: new Date(Date.UTC(year, monthIndex, 1)).toLocaleString("en", { month: "short", timeZone: "UTC" }), fromDate: range.fromDate, toDate: range.toDate, future: true, result: null };
            const endDate = range.toDate > selectedEnd ? selectedEnd : range.toDate;
            const result = await getManagementPnl({ fromDate: range.fromDate, toDate: endDate, comparison: "NONE", businessSegment: segment });
            const monthSummary = result.selected;
            return { index, label: new Date(Date.UTC(year, monthIndex, 1)).toLocaleString("en", { month: "short", timeZone: "UTC" }), fromDate: range.fromDate, toDate: endDate, future: false,
                result: { ...monthSummary, otherAccounting: { ...monthSummary.otherAccounting, rows: [] } } };
        }));
        const selectedSummary = selectedSummaryResult.selected;
        const comparisonSummary = comparisonSummaryResult.selected;
        let storeForExpenseDetails = null;
        try { storeForExpenseDetails = await getCurrentStore(); } catch (_error) { /* The P&L summary already reports Store identity failure. */ }
        const postedExpenseDetails = await queryPostedExpenseDetails({ fromDate: fyStartDate, toDate: selectedEnd }, segment, storeForExpenseDetails);
        const expectedPostedExpenseTotal = segment === "ALL" ? selectedSummary.expenses.totalOperatingExpensesPaise :
            selectedSummary.expenses.directOperatingExpensesPaise + selectedSummary.expenses.commonOperatingExpensesPaise;
        if (selectedSummary.expenses.available !== false && selectedSummary.reconciliation.expense.reconciles === true &&
            (postedExpenseDetails.totalAmountPaise !== expectedPostedExpenseTotal || postedExpenseDetails.totalCount !== selectedSummary.expenses.managementGroups.reduce((sum, group) => sum + group.expenseCount, 0) +
                (segment === "ALL" ? 0 : selectedSummary.expenses.commonCategories.reduce((sum, category) => sum + category.expenseCount, 0)))) {
            throw new Error("Posted Expense export details do not reconcile to the selected Management P&L expense summary.");
        }
        const varianceByKey = buildFinancialYearVariances(selectedSummary, comparisonSummary);
        return {
            metadata: {
                store: selectedSummaryResult.metadata.store,
                financialYearStart: startYear,
                financialYearLabel: `FY ${startYear}-${String(startYear + 1).slice(-2)}`,
                currentFinancialYearStart: currentYearStart,
                asOfDate,
                businessSegment: segment,
                activeFinancialYear: active,
                comparisonLabel: active ? `LAST FYTD · ${startYear - 1}-${String(startYear).slice(-2)}` : `LAST FY · ${startYear - 1}-${String(startYear).slice(-2)}`,
                comparisonFromDate: comparisonStartDate,
                comparisonToDate: comparisonEndDate,
                generatedAt: selectedSummaryResult.metadata.generatedAt
            },
            months,
            selectedSummary,
            comparisonSummary,
            varianceByKey,
            postedExpenseDetails
        };
    }

    return { getManagementPnl, getManagementPnlFinancialYear };
}

function buildFinancialYearVariances(selected, comparison) {
    const revenueAvailable = selected.revenue.available && comparison.revenue.available;
    const values = {
        gross: [revenueAvailable ? selected.revenue.grossBillingsInclGstPaise : null, revenueAvailable ? comparison.revenue.grossBillingsInclGstPaise : null, "HIGHER"],
        discounts: [revenueAvailable ? selected.revenue.discountsInclGstEffectPaise : null, revenueAvailable ? comparison.revenue.discountsInclGstEffectPaise : null, "LOWER"],
        returns: [revenueAvailable ? selected.revenue.completedReturnNetReversalPaise : null, revenueAvailable ? comparison.revenue.completedReturnNetReversalPaise : null, "LOWER"],
        netGst: [revenueAvailable ? selected.revenue.netGstOnSalesPaise : null, revenueAvailable ? comparison.revenue.netGstOnSalesPaise : null, "LOWER"],
        netSales: [revenueAvailable ? selected.revenue.netSalesExGstPaise : null, revenueAvailable ? comparison.revenue.netSalesExGstPaise : null, "HIGHER"],
        saleCogs: [selected.cogs.capturedSaleCogsPaise, comparison.cogs.capturedSaleCogsPaise, "LOWER"],
        returnCogs: [selected.cogs.capturedReturnCogsReversalPaise, comparison.cogs.capturedReturnCogsReversalPaise, "LOWER"],
        netCogs: [selected.cogs.netCapturedCogsPaise, comparison.cogs.netCapturedCogsPaise, "LOWER"],
        capturedSales: [selected.cogs.capturedNetSalesPaise, comparison.cogs.capturedNetSalesPaise, "HIGHER"],
        unknownSales: [selected.cogs.unknownNetSalesPaise, comparison.cogs.unknownNetSalesPaise, "LOWER"],
        vvpSales: [selected.cogs.notApplicableNetSalesPaise, comparison.cogs.notApplicableNetSalesPaise, "LOWER"],
        coverage: [selected.cogs.costCoveragePercent, comparison.cogs.costCoveragePercent, "HIGHER", true],
        grossProfit: [selected.cogs.fullGrossProfitPaise, comparison.cogs.fullGrossProfitPaise, "HIGHER", false, selected.cogs.fullGrossProfitAvailable && comparison.cogs.fullGrossProfitAvailable],
        grossMargin: [selected.cogs.fullGrossMarginPercent, comparison.cogs.fullGrossMarginPercent, "HIGHER", true, selected.cogs.fullGrossProfitAvailable && comparison.cogs.fullGrossProfitAvailable],
        totalExpenses: [selected.expenses.available === false ? null : selected.expenses.totalOperatingExpensesPaise,
            comparison.expenses.available === false ? null : comparison.expenses.totalOperatingExpensesPaise, "LOWER"],
        commonExpenses: [selected.expenses.available === false ? null : selected.expenses.commonOperatingExpensesPaise,
            comparison.expenses.available === false ? null : comparison.expenses.commonOperatingExpensesPaise, "LOWER"],
        operatingResult: [selected.operatingResult.operatingProfitPaise ?? selected.operatingResult.segmentDirectOperatingResultPaise,
            comparison.operatingResult.operatingProfitPaise ?? comparison.operatingResult.segmentDirectOperatingResultPaise, "HIGHER",
            false, selected.operatingResult.operatingProfitAvailable === true || selected.operatingResult.segmentDirectOperatingResultAvailable === true]
    };
    values.operatingMargin = [selected.operatingResult.operatingMarginPercent ?? selected.operatingResult.segmentDirectOperatingMarginPercent,
        comparison.operatingResult.operatingMarginPercent ?? comparison.operatingResult.segmentDirectOperatingMarginPercent,
        "HIGHER", true,
        selected.operatingResult.operatingProfitAvailable === true || selected.operatingResult.segmentDirectOperatingResultAvailable === true];
    const profitFields = [
        ["ebitda", "ebitdaPaise", "HIGHER", false, true], ["ebitdaMargin", "ebitdaMarginPercent", "HIGHER", true, true],
        ["depreciation", "depreciationPaise", "LOWER", false, false], ["ebita", "ebitaPaise", "HIGHER", false, true],
        ["ebitaMargin", "ebitaMarginPercent", "HIGHER", true, true], ["amortisation", "amortisationPaise", "LOWER", false, false],
        ["ebit", "ebitPaise", "HIGHER", false, true], ["ebitMargin", "ebitMarginPercent", "HIGHER", true, true],
        ["interestIncome", "interestIncomePaise", "HIGHER", false, false], ["otherIncome", "otherNonOperatingIncomePaise", "HIGHER", false, false],
        ["totalOtherIncome", "totalOtherIncomePaise", "HIGHER", false, false], ["financeCosts", "financeCostsPaise", "LOWER", false, false],
        ["totalFinanceCosts", "financeCostsPaise", "LOWER", false, false], ["otherNonOperatingExpense", "otherNonOperatingExpensePaise", "LOWER", false, false],
        ["exceptionalAdjustment", "exceptionalAdjustmentPaise", "HIGHER", false, false], ["pbt", "pbtPaise", "HIGHER", false, true],
        ["pbtMargin", "pbtMarginPercent", "HIGHER", true, true], ["taxProvision", "incomeTaxProvisionPaise", "LOWER", false, false],
        ["pat", "patPaise", "HIGHER", false, true], ["netProfitMargin", "netProfitMarginPercent", "HIGHER", true, true]
    ];
    for (const [key, field, favorableWhen, percentagePoint, requiresProfitAvailability] of profitFields) {
        values[key] = [selected.profitability[field], comparison.profitability[field], favorableWhen, percentagePoint,
            requiresProfitAvailability ? selected.profitability.available === true && comparison.profitability.available === true : true];
    }
    for (const group of selected.expenses.managementGroups) {
        const prior = comparison.expenses.managementGroups.find(row => row.name === group.name);
        values[`group:${group.name}`] = [selected.expenses.available === false ? null : group.amountPaise,
            comparison.expenses.available === false ? null : prior?.amountPaise ?? null, "LOWER"];
    }
    for (const category of selected.expenses.categories) {
        const prior = comparison.expenses.categories.find(row => row.category === category.category);
        values[`category:${category.category}`] = [selected.expenses.available === false ? null : category.amountPaise,
            comparison.expenses.available === false ? null : prior?.amountPaise ?? null, "LOWER"];
    }
    return Object.fromEntries(Object.entries(values).map(([key, [current, prior, favorableWhen, percentagePoint = false, permitted = true]]) => {
        const valid = permitted && Number.isFinite(current) && Number.isFinite(prior);
        const delta = valid ? current - prior : null;
        const deltaPercent = valid && prior !== 0 ? delta * 100 / Math.abs(prior) : null;
        const favorable = delta === null || delta === 0 || favorableWhen === "NEUTRAL" ? null : (favorableWhen === "HIGHER" ? delta > 0 : delta < 0);
        return [key, { amount: delta, percent: deltaPercent, favorable, percentagePoint }];
    }));
}

function deriveVariance(selected, comparison) {
    const metrics = [
        ["netSalesExGstPaise", value => value.revenue.netSalesExGstPaise],
        ["capturedSaleCogsPaise", value => value.cogs.capturedSaleCogsPaise],
        ["netCapturedCogsPaise", value => value.cogs.netCapturedCogsPaise],
        ["coveredGrossProfitPaise", value => value.cogs.coveredGrossProfitPaise],
        ["fullGrossProfitPaise", value => value.cogs.fullGrossProfitPaise],
        ["costCoveragePercentagePoints", value => value.cogs.costCoveragePercent],
        ["coveredGrossMarginPercentagePoints", value => value.cogs.coveredGrossMarginPercent],
        ["fullGrossMarginPercentagePoints", value => value.cogs.fullGrossMarginPercent],
        ["totalOperatingExpensesPaise", value => value.expenses.totalOperatingExpensesPaise],
        ["operatingProfitPaise", value => value.operatingResult.operatingProfitPaise ?? value.operatingResult.segmentDirectOperatingResultPaise],
        ["operatingMarginPercentagePoints", value => value.operatingResult.operatingMarginPercent ?? value.operatingResult.segmentDirectOperatingMarginPercent]
    ];
    const result = {};
    for (const [name, getValue] of metrics) {
        const current = getValue(selected);
        const previous = getValue(comparison);
        const isPercentagePoint = name.endsWith("PercentagePoints");
        const delta = current - previous;
        result[name] = isPercentagePoint
            ? (Number.isFinite(current) && Number.isFinite(previous) ? delta : null)
            : (Number.isSafeInteger(current) && Number.isSafeInteger(previous) && Number.isSafeInteger(delta) ? delta : null);
    }
    return result;
}

let defaultService;
function getDefaultService() {
    if (!defaultService) defaultService = createManagementPnlService(require("./database"));
    return defaultService;
}

module.exports = { CATEGORY_GROUPS, createManagementPnlService,
    getManagementPnl: options => getDefaultService().getManagementPnl(options),
    getManagementPnlFinancialYear: options => getDefaultService().getManagementPnlFinancialYear(options),
    deriveVariance };
