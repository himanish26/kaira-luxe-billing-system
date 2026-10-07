"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const { migrateExpenseTracker } = require("../src/database/expenseTrackerMigration");
const { migrateReturnCogsReversal } = require("../src/database/returnCogsReversalMigration");
const { migrateManagementAccountingEntries } = require("../src/database/managementAccountingEntryMigration");
const { CATEGORY_GROUPS, createManagementPnlService } = require("../src/database/managementPnlService");
const { resolveManagementPnlPeriod, comparisonPeriod } = require("../src/database/managementPnlPeriods");
const { createManagementPnlWorkbook, exportManagementPnlFinancialYear, managementPnlFilename } = require("../src/database/managementPnlExcelExporter");

const run = (db, sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function(error) {
    error ? reject(error) : resolve({ lastID: this.lastID, changes: this.changes });
}));
const get = (db, sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
const exec = (db, sql) => new Promise((resolve, reject) => db.exec(sql, error => error ? reject(error) : resolve()));
const close = db => new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));

async function fixture() {
    const db = new sqlite3.Database(":memory:");
    await run(db, "PRAGMA foreign_keys=ON");
    await exec(db, `CREATE TABLE stores(id INTEGER PRIMARY KEY,store_code TEXT NOT NULL UNIQUE,store_name TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
        CREATE TABLE store_context(id INTEGER PRIMARY KEY CHECK(id=1),current_store_id INTEGER NOT NULL);
        CREATE TABLE bills(id INTEGER PRIMARY KEY,bill_no TEXT UNIQUE,bill_date TEXT,payment_status TEXT);
        CREATE TABLE products(id INTEGER PRIMARY KEY,barcode TEXT UNIQUE,cost_price REAL,variable_value INTEGER,business_segment TEXT);
        CREATE TABLE bill_items(id INTEGER PRIMARY KEY,bill_no TEXT,barcode TEXT,qty INTEGER,business_segment TEXT,
            gross_amount REAL,discount_amount REAL,taxable_amount REAL,gst_amount REAL,net_amount REAL,
            unit_cost_paise INTEGER,cost_basis_status TEXT,cost_source TEXT,cost_method TEXT);
        CREATE TABLE returns(id INTEGER PRIMARY KEY,return_no TEXT,credit_note_no TEXT,original_bill_no TEXT,
            business_date TEXT,accounting_status TEXT,accounting_snapshot_version INTEGER,
            gross_reversal REAL,discount_reversal REAL,taxable_reversal REAL,gst_reversal REAL,net_reversal REAL);
        CREATE TABLE return_items(id INTEGER PRIMARY KEY,return_id INTEGER,original_bill_item_id INTEGER,quantity INTEGER,
            gross_reversal REAL,discount_reversal REAL,taxable_reversal REAL,gst_reversal REAL,net_reversal REAL,
            return_unit_cost_paise INTEGER,return_cost_paise INTEGER,return_cost_basis_status TEXT DEFAULT 'UNKNOWN',
            return_cost_source TEXT,return_cost_method TEXT);
        CREATE TABLE expenses(id INTEGER PRIMARY KEY,expense_date TEXT,category TEXT,particulars TEXT,
            expense_class TEXT,amount_paise INTEGER,payment_mode TEXT,paid_to TEXT,reference TEXT,
            business_segment TEXT,remarks TEXT,lifecycle_status TEXT,entered_by TEXT,last_modified_by TEXT,
            correction_reason TEXT,corrects_expense_id INTEGER,created_at TEXT,updated_at TEXT,
            voided_by TEXT,voided_at TEXT,void_reason TEXT);
    `);
    await run(db, "INSERT INTO stores VALUES(1,'KL001','Kaira Luxe','ACTIVE','test','test')");
    await run(db, "INSERT INTO stores VALUES(2,'TEST02','Test Store','ACTIVE','test','test')");
    await run(db, "INSERT INTO store_context VALUES(1,1)");
    await migrateExpenseTracker(db);
    await migrateReturnCogsReversal(db);
    await migrateManagementAccountingEntries(db);
    return db;
}

async function addSale(db, { billNo, date, lines }) {
    await run(db, "INSERT INTO bills(bill_no,bill_date,payment_status) VALUES(?,?,'PAID')", [billNo, date]);
    for (const [index, line] of lines.entries()) {
        const barcode = `${billNo}-${index}`;
        await run(db, "INSERT INTO products(barcode,cost_price,variable_value,business_segment) VALUES(?,?,0,?)",
            [barcode, line.currentCost ?? null, line.segment]);
        await run(db, `INSERT INTO bill_items(bill_no,barcode,qty,business_segment,gross_amount,discount_amount,
            taxable_amount,gst_amount,net_amount,unit_cost_paise,cost_basis_status,cost_source,cost_method)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, [billNo, barcode, line.qty, line.segment, line.gross, line.discount,
            line.taxable, line.gst, line.net, line.unitCostPaise, line.status,
            line.status === "CAPTURED" ? "PRODUCT_MASTER" : null,
            line.status === "CAPTURED" ? "SALE_TIME_COST_PRICE_PAISE" : null]);
    }
}

async function addExpense(db, { date, category, segment, paise, posted = true, storeId = 1 }) {
    let batchId = null;
    let expenseCode = null;
    let postedAt = null;
    if (posted) {
        const sequence = Number((await get(db, "SELECT COUNT(*) AS count FROM expense_batches")).count) + 1;
        const timestamp = "2026-10-07T12:00:00+05:30";
        const batch = await run(db, `INSERT INTO expense_batches(batch_code,store_id,status,expense_count,
            total_amount_paise,posted_by,created_at,posted_at) VALUES(?,?,'POSTED',1,?,'MANAGER',?,?)`,
            [`KLEXPB${String(sequence).padStart(6, "0")}`, storeId, paise, timestamp, timestamp]);
        batchId = batch.lastID;
        expenseCode = `KLEXP${String(batchId).padStart(6, "0")}`;
        postedAt = "2026-10-07T12:00:00+05:30";
    }
    await run(db, `INSERT INTO expenses(expense_date,category,business_segment,amount_paise,lifecycle_status,
        expense_code,batch_id,store_id,posted_at) VALUES(?,?,?,?,'ACTIVE',?,?,?,?)`,
    [date, category, segment, paise, expenseCode, batchId, storeId, postedAt]);
}

async function addAccountingEntry(db, { date, head, segment = "KL", paise, effect = null, code, reversalOf = null, remarks = "golden fixture" }) {
    const next = Number((await get(db, "SELECT next_sequence FROM management_accounting_entry_sequences WHERE id=1")).next_sequence);
    if (code) assert.strictEqual(code, `KLPAE${String(next).padStart(6, "0")}`);
    await run(db, "UPDATE management_accounting_entry_sequences SET next_sequence=? WHERE id=1", [next + 1]);
    const original = reversalOf ? await get(db, "SELECT id FROM management_accounting_entries WHERE entry_code=?", [reversalOf]) : null;
    const entryCode = code || `KLPAE${String(next).padStart(6, "0")}`;
    const stamp = `${date}T12:00:00.000Z`;
    await run(db, `INSERT INTO management_accounting_entries(entry_code,store_id,accounting_date,accounting_head,business_segment,
        amount_paise,adjustment_effect,reference_no,remarks,status,created_at,created_by,posted_at,posted_by,source,reverses_entry_id,reversal_reason)
        VALUES(?,1,?,?,?,?,?,NULL,?,'POSTED',?,'MANAGER',?,'MANAGER','MANUAL',?,?)`,
    [entryCode, date, head, segment, paise, effect, remarks, stamp, stamp, original?.id || null, reversalOf ? "correction fixture" : null]);
    return entryCode;
}

async function main() {
    const fixedNow = () => new Date("2026-10-07T08:00:00.000Z");
    const periods = resolveManagementPnlPeriod;
    assert.deepStrictEqual(periods({ preset: "CURRENT_MONTH", now: fixedNow() }), {
        fromDate: "2026-10-01", toDate: "2026-10-31", preset: "CURRENT_MONTH", label: "October 2026"
    });
    assert.deepStrictEqual(periods({ preset: "PREVIOUS_MONTH", now: fixedNow() }).fromDate, "2026-09-01");
    assert.deepStrictEqual(periods({ preset: "MONTH", month: "2026-10", now: fixedNow() }).toDate, "2026-10-31");
    assert.deepStrictEqual(periods({ preset: "FY", financialYear: "2026-27", now: fixedNow() }).toDate, "2027-03-31");
    assert.deepStrictEqual(periods({ preset: "FYTD", now: fixedNow() }).fromDate, "2026-04-01");
    assert.deepStrictEqual(periods({ preset: "CUSTOM_RANGE", fromDate: "2026-02-01", toDate: "2026-02-28", now: fixedNow() }).toDate, "2026-02-28");
    assert.deepStrictEqual(comparisonPeriod({ fromDate: "2026-10-01", toDate: "2026-10-31" }, "PREVIOUS_MONTH"), {
        fromDate: "2026-09-01", toDate: "2026-09-30", label: "Previous month"
    });
    assert.strictEqual(comparisonPeriod({ fromDate: "2026-10-01", toDate: "2026-10-31" }, "SAME_MONTH_PREVIOUS_YEAR").fromDate, "2025-10-01");
    assert.deepStrictEqual(comparisonPeriod({ fromDate: "2026-04-01", toDate: "2026-10-07" }, "PREVIOUS_FYTD"), {
        fromDate: "2025-04-01", toDate: "2025-10-07", label: "Previous FYTD"
    });
    assert.deepStrictEqual(comparisonPeriod({ fromDate: "2026-04-01", toDate: "2027-03-31" }, "PREVIOUS_FY"), {
        fromDate: "2025-04-01", toDate: "2026-03-31", label: "Previous FY 2025-26"
    });
    assert.strictEqual(comparisonPeriod({ fromDate: "2024-04-01", toDate: "2025-02-28" }, "PREVIOUS_FYTD").toDate, "2024-02-28");
    assert.deepStrictEqual(comparisonPeriod({ fromDate: "2026-12-01", toDate: "2026-12-31" }, "PREVIOUS_MONTH"), {
        fromDate: "2026-11-01", toDate: "2026-11-30", label: "Previous month"
    });
    assert.strictEqual(comparisonPeriod({ fromDate: "2024-02-01", toDate: "2024-02-29" }, "SAME_MONTH_PREVIOUS_YEAR").toDate, "2023-02-28");
    assert.deepStrictEqual(comparisonPeriod({ fromDate: "2024-02-01", toDate: "2024-02-29" }, "PREVIOUS_PERIOD"), {
        fromDate: "2024-01-03", toDate: "2024-01-31", label: "Previous equal-length period"
    });
    assert.strictEqual(CATEGORY_GROUPS.length, 7);
    assert.strictEqual(new Set(CATEGORY_GROUPS.flatMap(group => group.categories)).size, 20);

    const db = await fixture();
    try {
        await addSale(db, { billNo: "SEP-1", date: "2026-09-29", lines: [
            { qty: 2, segment: "KL", gross: 120, discount: 12, taxable: 90, gst: 18, net: 108, unitCostPaise: 2000, status: "CAPTURED", currentCost: 20 },
            { qty: 1, segment: "MENS", gross: 60, discount: 0, taxable: 50, gst: 10, net: 60, unitCostPaise: null, status: "UNKNOWN", currentCost: 999 },
            { qty: 1, segment: "KIDS", gross: 36, discount: 0, taxable: 30, gst: 6, net: 36, unitCostPaise: null, status: "NOT_APPLICABLE", currentCost: null },
            { qty: 1, segment: null, gross: 12, discount: 0, taxable: 10, gst: 2, net: 12, unitCostPaise: null, status: "UNKNOWN", currentCost: null }
        ] });
        await addSale(db, { billNo: "OCT-1", date: "2026-10-02", lines: [
            { qty: 1, segment: "MENS", gross: 120, discount: 0, taxable: 100, gst: 20, net: 120, unitCostPaise: 3000, status: "CAPTURED", currentCost: 30 }
        ] });
        await addSale(db, { billNo: "LEGACY-GROSS", date: "2026-07-15", lines: [
            { qty: 1, segment: "KL", gross: 110, discount: 10, taxable: 83.33, gst: 16.67, net: 100, unitCostPaise: null, status: "UNKNOWN" }
        ] });
        await run(db, "UPDATE bill_items SET gross_amount=NULL WHERE bill_no='LEGACY-GROSS'");
        await addSale(db, { billNo: "AUG-ZERO-PROFIT", date: "2026-08-12", lines: [
            { qty: 1, segment: "KL", gross: 100, discount: 0, taxable: 100, gst: 0, net: 100, unitCostPaise: 10000, status: "CAPTURED", currentCost: 100 }
        ] });
        await addSale(db, { billNo: "PRIOR-FY", date: "2025-09-29", lines: [
            { qty: 1, segment: "MENS", gross: 240, discount: 20, taxable: 200, gst: 20, net: 220, unitCostPaise: 5000, status: "CAPTURED", currentCost: 50 }
        ] });
        await addSale(db, { billNo: "OLDER-FY", date: "2024-09-29", lines: [
            { qty: 1, segment: "KL", gross: 120, discount: 0, taxable: 100, gst: 20, net: 120, unitCostPaise: 3000, status: "CAPTURED", currentCost: 30 }
        ] });
        await addSale(db, { billNo: "E3-GOLDEN-APR", date: "2026-04-10", lines: [
            { qty: 1, segment: "KL", gross: 1200, discount: 120, taxable: 900, gst: 180, net: 1080, unitCostPaise: 30000, status: "CAPTURED", currentCost: 300 }
        ] });
        for (const [category, paise] of [["Salary & Wages",1000],["Rent",2000],["Electricity",3000],["Marketing & Advertising",4000],
            ["Packaging",5000],["Stationery & Printing",6000],["Bank & Payment Charges",7000]]) {
            await addExpense(db, { date: "2026-04-10", category, segment: "KL", paise });
        }
        const goldenEntries = [
            ["INTEREST_INCOME",3000,null],["OTHER_NON_OPERATING_INCOME",1500,null],["INTEREST_FINANCE_CHARGES",2500,null],
            ["DEPRECIATION",5000,null],["AMORTISATION",2000,null],["OTHER_NON_OPERATING_EXPENSE",1000,null],
            ["EXCEPTIONAL_ADJUSTMENT",4000,"INCOME"],["EXCEPTIONAL_ADJUSTMENT",1500,"EXPENSE"],["INCOME_TAX_PROVISION",3500,null]
        ];
        for (const [head, paise, effect] of goldenEntries) await addAccountingEntry(db, { date: "2026-04-10", head, paise, effect });
        const depreciationOriginal = await addAccountingEntry(db, { date: "2026-04-20", head: "DEPRECIATION", paise: 1200 });
        await addAccountingEntry(db, { date: "2026-05-02", head: "DEPRECIATION", segment: "KL", paise: 1200, reversalOf: depreciationOriginal });
        const exceptionalOriginal = await addAccountingEntry(db, { date: "2026-04-21", head: "EXCEPTIONAL_ADJUSTMENT", paise: 800, effect: "INCOME" });
        await addAccountingEntry(db, { date: "2026-05-03", head: "EXCEPTIONAL_ADJUSTMENT", paise: 800, effect: "INCOME", reversalOf: exceptionalOriginal });
        await addAccountingEntry(db, { date: "2026-05-04", head: "INTEREST_INCOME", segment: "COMMON", paise: 200 });
        await addAccountingEntry(db, { date: "2026-05-04", head: "INTEREST_INCOME", segment: "MENS", paise: 100 });
        await addAccountingEntry(db, { date: "2025-05-15", head: "DEPRECIATION", paise: 700 });
        await run(db, `INSERT INTO returns(return_no,credit_note_no,original_bill_no,business_date,accounting_status,
            accounting_snapshot_version,gross_reversal,discount_reversal,taxable_reversal,gst_reversal,net_reversal)
            VALUES('RET-1','CN000000001','SEP-1','2026-10-03','COMPLETED',1,60,6,45,9,54)`);
        const sepCaptured = await get(db, "SELECT id,barcode FROM bill_items WHERE bill_no='SEP-1' AND business_segment='KL'");
        await run(db, `INSERT INTO return_items(return_id,original_bill_item_id,quantity,gross_reversal,discount_reversal,
            taxable_reversal,gst_reversal,net_reversal,return_unit_cost_paise,return_cost_paise,
            return_cost_basis_status,return_cost_source,return_cost_method)
            VALUES(1,?,1,60,6,45,9,54,2000,2000,'CAPTURED','PRODUCT_MASTER','ORIGINAL_SALE_TIME_COST_REVERSAL')`, [sepCaptured.id]);
        await run(db, `INSERT INTO returns(return_no,credit_note_no,original_bill_no,business_date,accounting_status,
            accounting_snapshot_version,taxable_reversal,net_reversal) VALUES('OLD-RET','', 'SEP-1','2026-10-04','LEGACY_UNASSESSED',NULL,5,6)`);
        await addExpense(db, { date: "2026-09-30", category: "Rent", segment: "COMMON", paise: 2000 });
        await addExpense(db, { date: "2026-09-30", category: "Salary & Wages", segment: "KL", paise: 1000 });
        await addExpense(db, { date: "2026-10-01", category: "Electricity", segment: "MENS", paise: 250 });
        await addExpense(db, { date: "2026-09-30", category: "Miscellaneous", segment: "KL", paise: 9000, posted: false });
        await addExpense(db, { date: "2026-09-30", category: "Rent", segment: "COMMON", paise: 5000, storeId: 2 });
        await run(db, "UPDATE products SET cost_price=999 WHERE barcode=?", [sepCaptured.barcode]);

        const service = createManagementPnlService(db, {
            getCurrentStore: async () => ({ id: 1, storeCode: "KL001", storeName: "Kaira Luxe", status: "ACTIVE" }),
            now: fixedNow
        });
        const sep = await service.getManagementPnl({ fromDate: "2026-09-01", toDate: "2026-09-30", businessSegment: "ALL" });
        assert.strictEqual(sep.metadata.store.storeCode, "KL001");
        assert.strictEqual(sep.selected.revenue.netSalesExGstPaise, 18000);
        assert.strictEqual(sep.selected.revenue.salesGstPaise, 3600);
        assert.strictEqual(sep.selected.revenue.discountsInclGstEffectPaise, 1200);
        assert.strictEqual(sep.selected.cogs.capturedSaleCogsPaise, 4000);
        assert.strictEqual(sep.selected.cogs.unknownSaleTaxableValuePaise, 6000);
        assert.strictEqual(sep.selected.cogs.notApplicableSaleTaxableValuePaise, 3000);
        assert.strictEqual(sep.selected.cogs.costCoveragePercent, 60);
        assert.strictEqual(sep.selected.cogs.coveredGrossProfitPaise, 5000);
        assert.strictEqual(sep.selected.cogs.fullGrossProfitAvailable, false);
        assert.strictEqual(sep.selected.operatingResult.operatingProfitPaise, null);
        assert.strictEqual(sep.selected.profitability.depreciationPaise, 0);
        assert.strictEqual(sep.selected.profitability.pbtPaise, null, "incomplete COGS prevents PBT even when manual heads are zero");
        assert.strictEqual(sep.selected.expenses.totalOperatingExpensesPaise, 3000);
        assert.strictEqual(sep.selected.expenses.commonOperatingExpensesPaise, 2000);
        assert.strictEqual(sep.selected.expenses.categories.length, 20);
        assert.strictEqual(sep.selected.expenses.managementGroups.length, 7);
        assert(sep.selected.dataQuality.warnings.some(row => row.code === "UNCLASSIFIED_BUSINESS_SEGMENT_SALES"));
        assert(sep.selected.reconciliation.revenue.withinOnePaise);
        assert(sep.selected.reconciliation.expense.reconciles);

        const oct = await service.getManagementPnl({ fromDate: "2026-10-01", toDate: "2026-10-31", comparison: "PREVIOUS_MONTH", businessSegment: "ALL" });
        assert.strictEqual(oct.selected.revenue.salesTaxableBeforeReturnsPaise, 10000);
        assert.strictEqual(oct.selected.revenue.completedReturnTaxableReversalPaise, 4500);
        assert.strictEqual(oct.selected.revenue.netSalesExGstPaise, 5500);
        assert.strictEqual(oct.selected.cogs.capturedReturnCogsReversalPaise, 2000);
        assert.strictEqual(oct.selected.cogs.capturedSaleCogsPaise, 3000);
        assert.strictEqual(oct.selected.cogs.netCapturedCogsPaise, 1000);
        assert.strictEqual(oct.selected.cogs.fullGrossProfitAvailable, true);
        assert.strictEqual(oct.selected.cogs.fullGrossProfitPaise, 4500);
        assert.strictEqual(oct.selected.operatingResult.operatingProfitAvailable, true);
        assert.strictEqual(oct.comparison.revenue.netSalesExGstPaise, 18000);
        assert.strictEqual(oct.variance.netSalesExGstPaise, -12500);
        assert.strictEqual(oct.variance.fullGrossProfitPaise, null, "variance remains null when comparison Gross Profit is unavailable");
        assert.strictEqual(oct.selected.expenses.totalOperatingExpensesPaise, 250);
        assert(oct.selected.dataQuality.warnings.some(row => row.code === "LEGACY_RETURNS_EXCLUDED"));

        const mens = await service.getManagementPnl({ fromDate: "2026-10-01", toDate: "2026-10-31", businessSegment: "MENS" });
        assert.strictEqual(mens.selected.revenue.netSalesExGstPaise, 10000);
        assert.strictEqual(mens.selected.expenses.directOperatingExpensesPaise, 250);
        assert.strictEqual(mens.selected.expenses.commonOperatingExpensesPaise, 0);
        assert.strictEqual(mens.selected.operatingResult.segmentDirectOperatingResultPaise, 6750);
        const kids = await service.getManagementPnl({ fromDate: "2026-09-01", toDate: "2026-09-30", businessSegment: "KIDS" });
        assert.strictEqual(kids.selected.cogs.notApplicableNetSalesPaise, 3000);
        assert.strictEqual(kids.selected.cogs.fullGrossProfitAvailable, false);
        const mensSeptember = await service.getManagementPnl({ fromDate: "2026-09-01", toDate: "2026-09-30", businessSegment: "MENS" });
        assert.strictEqual(mensSeptember.selected.expenses.directOperatingExpensesPaise, 0);
        assert.strictEqual(mensSeptember.selected.expenses.commonOperatingExpensesPaise, 2000);
        assert.strictEqual(mensSeptember.selected.operatingResult.segmentDirectOperatingResultPaise, null);

        const kl = await service.getManagementPnl({ fromDate: "2026-10-01", toDate: "2026-10-31", businessSegment: "KL" });
        assert.strictEqual(kl.selected.revenue.netSalesExGstPaise, -4500);
        assert.strictEqual(kl.selected.cogs.netCapturedCogsPaise, -2000);
        assert.strictEqual(kl.selected.cogs.fullGrossProfitPaise, -2500);
        assert.strictEqual(kl.selected.operatingResult.segmentDirectOperatingResultPaise, -2500);
        assert.strictEqual(kl.selected.operatingResult.commonOperatingExpensesPaise, 0);
        const repeat = await service.getManagementPnl({ fromDate: "2026-10-01", toDate: "2026-10-31" });
        assert.deepStrictEqual(repeat.selected, (await service.getManagementPnl({ fromDate: "2026-10-01", toDate: "2026-10-31" })).selected);

        const noRows = await service.getManagementPnl({ fromDate: "2026-05-01", toDate: "2026-05-31" });
        assert.strictEqual(noRows.selected.cogs.costCoveragePercent, null);
        assert.strictEqual(noRows.selected.cogs.coverageStatus, "NO_ELIGIBLE_SALES");
        assert.strictEqual(noRows.selected.cogs.fullGrossProfitPaise, 0);
        assert.strictEqual(noRows.selected.cogs.fullGrossMarginPercent, null);
        assert.strictEqual(noRows.selected.operatingResult.operatingMarginPercent, null);

        const golden = await service.getManagementPnl({ fromDate: "2026-04-01", toDate: "2026-04-30", businessSegment: "ALL" });
        const g = golden.selected;
        assert.strictEqual(g.revenue.netSalesExGstPaise, 90000);
        assert.strictEqual(g.cogs.netCapturedCogsPaise, 30000);
        assert.strictEqual(g.cogs.fullGrossProfitPaise, 60000);
        assert.strictEqual(g.cogs.fullGrossMarginPercent, 60000 * 100 / 90000);
        assert.strictEqual(g.expenses.totalOperatingExpensesPaise, 28000);
        assert.deepStrictEqual(g.expenses.managementGroups.map(group => group.amountPaise), [1000, 2000, 3000, 4000, 5000, 6000, 7000]);
        assert.strictEqual(g.profitability.ebitdaPaise, 32000);
        assert.strictEqual(g.profitability.ebitdaMarginPercent, 32000 * 100 / 90000);
        assert.strictEqual(g.profitability.depreciationPaise, 6200);
        assert.strictEqual(g.profitability.ebitaPaise, 25800);
        assert.strictEqual(g.profitability.ebitaMarginPercent, 25800 * 100 / 90000);
        assert.strictEqual(g.profitability.amortisationPaise, 2000);
        assert.strictEqual(g.profitability.ebitPaise, 23800);
        assert.strictEqual(g.profitability.ebitdaPaise, g.operatingResult.operatingProfitPaise, "EBITDA reconciles to the established gross-profit-less-OPEX result");
        assert.strictEqual(g.profitability.ebitMarginPercent, 23800 * 100 / 90000);
        assert.strictEqual(g.profitability.interestIncomePaise, 3000);
        assert.strictEqual(g.profitability.otherNonOperatingIncomePaise, 1500);
        assert.strictEqual(g.profitability.totalOtherIncomePaise, 4500);
        assert.strictEqual(g.profitability.financeCostsPaise, 2500);
        assert.strictEqual(g.profitability.otherNonOperatingExpensePaise, 1000);
        assert.strictEqual(g.profitability.exceptionalAdjustmentPaise, 3300);
        assert.strictEqual(g.profitability.pbtPaise, 28100);
        assert.strictEqual(g.profitability.pbtMarginPercent, 28100 * 100 / 90000);
        assert.strictEqual(g.profitability.incomeTaxProvisionPaise, 3500);
        assert.strictEqual(g.profitability.patPaise, 24600);
        assert.strictEqual(g.profitability.netProfitMarginPercent, 24600 * 100 / 90000);
        const may = await service.getManagementPnl({ fromDate: "2026-05-01", toDate: "2026-05-31", businessSegment: "ALL" });
        assert.strictEqual(may.selected.profitability.depreciationPaise, -1200, "reversal is reported on its own accounting date");
        assert.strictEqual(may.selected.profitability.exceptionalAdjustmentPaise, -800, "exceptional reversal offsets on its accounting date");
        assert.strictEqual(may.selected.profitability.interestIncomePaise, 300, "ALL includes direct and COMMON accounting entries");
        const mensMay = await service.getManagementPnl({ fromDate: "2026-05-01", toDate: "2026-05-31", businessSegment: "MENS" });
        assert.strictEqual(mensMay.selected.profitability.interestIncomePaise, 100, "segment result includes direct entries only");
        assert.strictEqual(mensMay.selected.otherAccounting.common.interestIncomePaise, 200, "COMMON stays separately disclosed and unallocated");
        const klMay = await service.getManagementPnl({ fromDate: "2026-05-01", toDate: "2026-05-31", businessSegment: "KL" });
        assert.strictEqual(klMay.selected.profitability.interestIncomePaise, 0, "COMMON is not allocated into KL");
        const goldenFy = await service.getManagementPnlFinancialYear({ financialYearStart: 2026, businessSegment: "ALL" });
        assert.strictEqual(goldenFy.months[0].result.profitability.patPaise, 24600);
        assert.strictEqual(goldenFy.months[1].result.profitability.depreciationPaise, -1200);
        assert.strictEqual(goldenFy.selectedSummary.profitability.patPaise, null, "FY population with UNKNOWN/VVP cost keeps downstream PAT unavailable");
        assert.strictEqual(goldenFy.selectedSummary.otherAccounting.rows.length, 15);
        assert.strictEqual(goldenFy.comparisonSummary.profitability.depreciationPaise, 700, "Last FYTD includes management entries by accounting date");
        assert.strictEqual(goldenFy.varianceByKey.depreciation.amount, 4300);
        const incompletePnl = await service.getManagementPnl({ fromDate: "2026-09-01", toDate: "2026-09-30", businessSegment: "ALL" });
        assert.strictEqual(incompletePnl.selected.profitability.available, false);
        assert.strictEqual(incompletePnl.selected.profitability.ebitdaPaise, null);
        assert.strictEqual(incompletePnl.selected.profitability.pbtPaise, null);
        assert.strictEqual(incompletePnl.selected.profitability.patPaise, null);
        const zeroActivity = await service.getManagementPnl({ fromDate: "2026-06-01", toDate: "2026-06-30", businessSegment: "ALL" });
        assert.strictEqual(zeroActivity.selected.profitability.interestIncomePaise, 0);
        assert.strictEqual(zeroActivity.selected.profitability.depreciationPaise, 0);
        assert.strictEqual(zeroActivity.selected.profitability.patPaise, 0, "a zero-activity month with no manual entries is a valid zero result");
        assert.strictEqual(zeroActivity.selected.profitability.netProfitMarginPercent, null, "zero Net Sales has no margin denominator");
        const march = await service.getManagementPnl({ fromDate: "2026-03-01", toDate: "2026-03-31", businessSegment: "ALL" });
        assert.strictEqual(march.selected.profitability.patPaise, 0, "March remains in the prior Indian FY");
        assert.strictEqual(goldenFy.metadata.comparisonFromDate, "2025-04-01", "April starts the next FY and its comparable period uses the preceding FY");
        const reinitialized = createManagementPnlService(db, {
            getCurrentStore: async () => ({ id: 1, storeCode: "KL001", storeName: "Kaira Luxe", status: "ACTIVE" }), now: fixedNow
        });
        assert.deepStrictEqual((await reinitialized.getManagementPnl({ fromDate: "2026-04-01", toDate: "2026-04-30" })).selected, g,
            "reinitializing the service against the same persisted facts is deterministic");
        const workbook = await createManagementPnlWorkbook(goldenFy, { version: "2.0.0", schemaVersion: 9 });
        const pnlSheet = workbook.getWorksheet("Management P&L");
        const findRow = label => {
            for (let row = 9; row <= pnlSheet.rowCount; row += 1) if (pnlSheet.getCell(row, 1).value === label) return row;
            throw new Error(`Workbook row missing: ${label}`);
        };
        const excelSourceChecks = [
            ["Gross Billings (incl. GST)", g.revenue.grossBillingsInclGstPaise], ["Less: Discounts", g.revenue.discountsInclGstEffectPaise],
            ["Less: Sales Returns", g.revenue.completedReturnNetReversalPaise], ["Less: Net GST", g.revenue.netGstOnSalesPaise],
            ["Captured Sale COGS", g.cogs.capturedSaleCogsPaise], ["Less: Return COGS Reversal", g.cogs.capturedReturnCogsReversalPaise],
            ["Captured-cost Net Sales", g.cogs.capturedNetSalesPaise], ["Unknown-cost Net Sales", g.cogs.unknownNetSalesPaise],
            ["VVP / Cost Pending Net Sales", g.cogs.notApplicableNetSalesPaise],
            ["Depreciation", g.profitability.depreciationPaise],
            ["Amortisation", g.profitability.amortisationPaise], ["Interest Income", g.profitability.interestIncomePaise],
            ["Other Non-Operating Income", g.profitability.otherNonOperatingIncomePaise],
            ["Interest / Finance Charges", g.profitability.financeCostsPaise],
            ["Other Non-Operating Expense", g.profitability.otherNonOperatingExpensePaise],
            ["Exceptional / Adjustment Items", g.profitability.exceptionalAdjustmentPaise],
            ["Income Tax / Tax Provision", g.profitability.incomeTaxProvisionPaise]
        ];
        for (const [label, paise] of excelSourceChecks) {
            assert.strictEqual(pnlSheet.getCell(`B${findRow(label)}`).value, paise / 100,
                `Excel April source value for ${label} reconciles to central engine paise`);
        }
        assert.strictEqual(g.expenses.totalOperatingExpensesPaise, 28000);
        for (const [index, group] of g.expenses.managementGroups.entries()) {
            const groupRow = findRow(group.name);
            assert.match(pnlSheet.getCell(`B${groupRow}`).value.formula, /SUM\(B\d+:B\d+\)/,
                `Excel ${group.name} subtotal is a formula over underlying categories`);
            assert.strictEqual(group.amountPaise, [1000, 2000, 3000, 4000, 5000, 6000, 7000][index]);
        }
        assert.match(pnlSheet.getCell(`B${findRow("TOTAL OPERATING EXPENSES")}`).value.formula, /SUM\(/,
            "Excel total OPEX is a formula over the seven management groups");
        assert.strictEqual(g.profitability.ebitdaPaise, 32000);
        assert.strictEqual(g.profitability.ebitaPaise, 25800);
        assert.strictEqual(g.profitability.ebitPaise, 23800);
        assert.strictEqual(g.profitability.pbtPaise, 28100);
        assert.strictEqual(g.profitability.patPaise, 24600);
        assert.strictEqual(pnlSheet.getCell(`O${findRow("Depreciation")}`).value, goldenFy.comparisonSummary.profitability.depreciationPaise / 100,
            "Last FYTD depreciation input reconciles to the central comparison summary");
        assert.match(pnlSheet.getCell(`N${findRow("NET SALES (EXCL. GST)")}`).value.formula, /COUNT\(N\d+,N\d+,N\d+,N\d+\)=4/);
        assert.match(pnlSheet.getCell(`P${findRow("NET SALES (EXCL. GST)")}`).value.formula, /N\d+-O\d+/);
        assert.match(pnlSheet.getCell(`Q${findRow("NET SALES (EXCL. GST)")}`).value.formula, /O\d+=0/);
        assert.match(pnlSheet.getCell(`B${findRow("EBITDA")}`).value.formula, /COGS Coverage/);
        assert.match(pnlSheet.getCell(`B${findRow("EBITA")}`).value.formula, /COGS Coverage/);
        assert.match(pnlSheet.getCell(`B${findRow("EBIT / OPERATING PROFIT")}`).value.formula, /COGS Coverage/);
        assert.match(pnlSheet.getCell(`B${findRow("PBT")}`).value.formula, /COGS Coverage/);
        assert.match(pnlSheet.getCell(`B${findRow("PAT / NET PROFIT")}`).value.formula, /COGS Coverage/);
        assert.match(pnlSheet.getCell(`N${findRow("EBITDA")}`).value.formula, /N\d+/);
        const financeDetailsRow = findRow("Interest / Finance Charges");
        const financeTotalRow = findRow("TOTAL FINANCE COSTS");
        assert.strictEqual(pnlSheet.getCell(`B${financeTotalRow}`).value.formula, `B${financeDetailsRow}`,
            "finance-cost total references its detail row, never itself");
        assert.match(pnlSheet.getCell(`B${findRow("PBT")}`).value.formula, new RegExp(`B${findRow("EBIT / OPERATING PROFIT")}\\+B${findRow("TOTAL OTHER INCOME")}-B${financeTotalRow}`));
        const accountingSheet = workbook.getWorksheet("Other Accounting Entries");
        assert.strictEqual(accountingSheet.getCell("A9").value, "KLPAE000001");
        const accountingRow = code => {
            for (let row = 9; row <= accountingSheet.rowCount; row += 1) if (accountingSheet.getCell(row, 1).value === code) return row;
            throw new Error(`Accounting workbook row missing: ${code}`);
        };
        assert.strictEqual(accountingSheet.getCell(`J${accountingRow("KLPAE000011")}`).value, "REVERSAL");
        assert.strictEqual(accountingSheet.getCell(`K${accountingRow("KLPAE000011")}`).value, "KLPAE000010");
        assert.strictEqual(accountingSheet.getCell(`L${accountingRow("KLPAE000010")}`).value, "KLPAE000011");

        await run(db, "DROP TRIGGER trg_expense_batches_immutable");
        await run(db, "UPDATE expense_batches SET total_amount_paise=total_amount_paise+1 WHERE id=(SELECT batch_id FROM expenses WHERE expense_date='2026-10-01' AND category='Electricity')");
        const invalidExpenseBatch = await service.getManagementPnl({ fromDate: "2026-10-01", toDate: "2026-10-31" });
        assert(invalidExpenseBatch.selected.dataQuality.warnings.some(row => row.code === "EXPENSE_POSTED_BATCH_INVALID"));
        assert.strictEqual(invalidExpenseBatch.selected.operatingResult.operatingProfitAvailable, false);
        const missingStoreService = createManagementPnlService(db, {
            getCurrentStore: async () => { throw new Error("test missing Store"); }, now: fixedNow
        });
        const missingStore = await missingStoreService.getManagementPnl({ fromDate: "2026-10-01", toDate: "2026-10-31" });
        assert.strictEqual(missingStore.metadata.store, null);
        assert(missingStore.selected.dataQuality.warnings.some(row => row.code === "STORE_IDENTITY_UNAVAILABLE"));
        assert.strictEqual(missingStore.selected.expenses.totalOperatingExpensesPaise, null);
        assert.strictEqual(missingStore.selected.operatingResult.operatingProfitAvailable, false);
        assert.strictEqual(missingStore.selected.profitability.available, false);
        assert.strictEqual(missingStore.selected.profitability.patPaise, null);
        assert.strictEqual(missingStore.selected.profitability.depreciationPaise, null);

        await run(db, "UPDATE expense_batches SET total_amount_paise=total_amount_paise-1 WHERE id=(SELECT batch_id FROM expenses WHERE expense_date='2026-10-01' AND category='Electricity')");
        const beforeFyCounts = await get(db, "SELECT (SELECT COUNT(*) FROM bills) bills,(SELECT COUNT(*) FROM expenses) expenses,(SELECT COUNT(*) FROM returns) returns");
        const fy = await service.getManagementPnlFinancialYear({ financialYearStart: 2026, businessSegment: "ALL" });
        assert.strictEqual(fy.postedExpenseDetails.totalCount, 10, "FY export detail source includes posted current-Store expenses only");
        assert.strictEqual(fy.postedExpenseDetails.totalAmountPaise, 31250, "FY export detail amount reconciles to posted expense totals");
        assert(fy.postedExpenseDetails.rows.every(row => row.management_group), "posted export rows carry the approved management group");
        assert.deepStrictEqual(fy.months.map(row => row.label), ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"]);
        assert.strictEqual(fy.metadata.financialYearLabel, "FY 2026-27");
        assert.strictEqual(fy.metadata.asOfDate, "2026-10-07");
        assert.strictEqual(fy.metadata.activeFinancialYear, true);
        assert.strictEqual(fy.metadata.currentFinancialYearStart, 2026);
        const julyResult = fy.months[3].result;
        assert.strictEqual(julyResult.cogs.fullGrossProfitAvailable, false, "July UNKNOWN cost prevents complete monthly Gross Profit");
        assert.strictEqual(julyResult.operatingResult.operatingProfitAvailable, false, "zero OPEX cannot make incomplete July Operating Profit available");
        assert.strictEqual(julyResult.operatingResult.operatingProfitPaise, null, "incomplete July Operating Profit stays null");
        assert.strictEqual(julyResult.operatingResult.operatingMarginPercent, null, "incomplete July Operating Margin stays null");
        assert.strictEqual(julyResult.expenses.totalOperatingExpensesPaise, 0, "July fixture has zero OPEX while cost remains incomplete");
        const augustResult = fy.months[4].result;
        assert.strictEqual(augustResult.cogs.fullGrossProfitAvailable, true, "complete August cost supports full monthly Gross Profit");
        assert.strictEqual(augustResult.cogs.fullGrossProfitPaise, 0, "complete-cost zero-profit month preserves valid zero Gross Profit");
        assert.strictEqual(augustResult.operatingResult.operatingProfitAvailable, true, "complete-cost August Operating Profit is available");
        assert.strictEqual(augustResult.operatingResult.operatingProfitPaise, 0, "complete-cost zero-profit month renders as numeric zero");
        assert.strictEqual(augustResult.operatingResult.operatingMarginPercent, 0, "complete-cost zero-profit month has valid zero margin");
        assert.strictEqual(fy.months[5].result.cogs.fullGrossProfitAvailable, false, "September VVP/UNKNOWN cost remains incomplete independently");
        assert.strictEqual(fy.months[5].result.operatingResult.operatingProfitPaise, null);
        assert.strictEqual(fy.months[6].result.cogs.fullGrossProfitAvailable, true, "October completeness is evaluated independently");
        assert.strictEqual(fy.months[6].result.operatingResult.operatingProfitAvailable, true);
        assert.strictEqual(fy.selectedSummary.cogs.fullGrossProfitAvailable, false, "mixed FYTD remains incomplete as a whole");
        assert.strictEqual(fy.selectedSummary.operatingResult.operatingProfitPaise, null, "incomplete FYTD Operating Profit remains unavailable");
        assert.strictEqual(fy.selectedSummary.operatingResult.operatingMarginPercent, null, "incomplete FYTD Operating Margin remains unavailable");
        assert.deepStrictEqual(fy.months.slice(7).map(row => row.future), [true, true, true, true, true]);
        assert.strictEqual(fy.months[6].toDate, "2026-10-07");
        assert.strictEqual(fy.months[3].result.revenue.grossBillingsInclGstPaise, 11000);
        assert.strictEqual(fy.months[3].result.revenue.grossCompatibilityAppliedCount, 1);
        assert(fy.months[3].result.dataQuality.warnings.some(row => row.code === "HISTORICAL_GROSS_COMPATIBILITY_APPLIED" && row.severity === "INFO"));
        assert(!fy.months[3].result.dataQuality.warnings.some(row => row.code === "REVENUE_GST_RECONCILIATION_MISMATCH"));
        const monthlyNetSales = fy.months.filter(row => row.result).reduce((sum, row) => sum + row.result.revenue.netSalesExGstPaise, 0);
        assert.strictEqual(monthlyNetSales, fy.selectedSummary.revenue.netSalesExGstPaise, "monthly values reconcile to FYTD summary");
        const monthlyGross = fy.months.filter(row => row.result).reduce((sum, row) => sum + row.result.revenue.grossBillingsInclGstPaise, 0);
        assert.strictEqual(monthlyGross, fy.selectedSummary.revenue.grossBillingsInclGstPaise, "monthly gross values reconcile to FYTD summary");
        const monthlyOpex = fy.months.filter(row => row.result).reduce((sum, row) => sum + row.result.expenses.totalOperatingExpensesPaise, 0);
        assert.strictEqual(monthlyOpex, fy.selectedSummary.expenses.totalOperatingExpensesPaise, "monthly posted OPEX reconciles to FYTD summary");
        for (const field of ["discountsInclGstEffectPaise", "salesTaxableBeforeReturnsPaise", "salesGstPaise", "salesNetInclGstPaise",
            "completedReturnGrossReversalPaise", "completedReturnDiscountReversalPaise", "completedReturnTaxableReversalPaise",
            "completedReturnGstReversalPaise", "completedReturnNetReversalPaise", "netGstOnSalesPaise", "netBillingsInclGstAfterReturnsPaise"]) {
            const sum = fy.months.filter(row => row.result).reduce((total, row) => total + row.result.revenue[field], 0);
            assert.strictEqual(sum, fy.selectedSummary.revenue[field], `monthly revenue ${field} reconciles to FYTD`);
        }
        for (const field of ["capturedSaleCogsPaise", "capturedSaleTaxableValuePaise", "capturedReturnCogsReversalPaise",
            "capturedReturnTaxableReversalPaise", "unknownSaleTaxableValuePaise", "unknownReturnTaxableReversalPaise",
            "notApplicableSaleTaxableValuePaise", "notApplicableReturnTaxableReversalPaise", "capturedNetSalesPaise",
            "unknownNetSalesPaise", "notApplicableNetSalesPaise", "eligibleNetSalesPaise", "netCapturedCogsPaise"]) {
            const sum = fy.months.filter(row => row.result).reduce((total, row) => total + row.result.cogs[field], 0);
            assert.strictEqual(sum, fy.selectedSummary.cogs[field], `monthly cost population ${field} reconciles to FYTD`);
        }
        for (const group of fy.selectedSummary.expenses.managementGroups) {
            const sum = fy.months.filter(row => row.result).reduce((total, row) => total + row.result.expenses.managementGroups.find(item => item.name === group.name).amountPaise, 0);
            assert.strictEqual(sum, group.amountPaise, `monthly OPEX group ${group.name} reconciles to FYTD`);
        }
        assert.strictEqual(fy.comparisonSummary.revenue.netSalesExGstPaise, 20000);
        assert.strictEqual(fy.metadata.comparisonToDate, "2025-10-07");
        assert.strictEqual(fy.varianceByKey.netSales.amount,
            fy.selectedSummary.revenue.netSalesExGstPaise - fy.comparisonSummary.revenue.netSalesExGstPaise);
        assert.strictEqual(fy.varianceByKey.netSales.percent,
            fy.varianceByKey.netSales.amount * 100 / Math.abs(fy.comparisonSummary.revenue.netSalesExGstPaise));
        assert.strictEqual(fy.varianceByKey.netSales.favorable, fy.varianceByKey.netSales.amount > 0);
        assert.strictEqual(fy.varianceByKey.discounts.favorable, fy.varianceByKey.discounts.amount < 0);
        assert.notStrictEqual(fy.varianceByKey.returns.amount, 0, "return variance amount remains available against a zero prior period");
        assert.strictEqual(fy.varianceByKey.returns.percent, null, "zero comparison denominator keeps variance percent unavailable");
        assert.strictEqual(fy.varianceByKey.grossProfit.amount, null, "full-profit variance unavailable when cost basis is incomplete");
        assert.strictEqual(fy.varianceByKey.grossProfit.percent, null, "unavailable comparison percentage remains null");
        const completedFy = await service.getManagementPnlFinancialYear({ financialYearStart: 2025, businessSegment: "ALL" });
        assert.strictEqual(completedFy.metadata.activeFinancialYear, false);
        assert.strictEqual(completedFy.months[11].toDate, "2026-03-31");
        assert.strictEqual(completedFy.metadata.comparisonLabel, "LAST FY · 2024-25");
        assert.strictEqual(completedFy.comparisonSummary.revenue.netSalesExGstPaise, 10000);
        const completedMonthlyNet = completedFy.months.reduce((sum, row) => sum + (row.result?.revenue.netSalesExGstPaise || 0), 0);
        assert.strictEqual(completedMonthlyNet, completedFy.selectedSummary.revenue.netSalesExGstPaise, "completed monthly values reconcile to FY total");
        assert.strictEqual(completedFy.selectedSummary.cogs.fullGrossProfitAvailable, true);
        assert.strictEqual(completedFy.comparisonSummary.cogs.fullGrossProfitAvailable, true);
        assert.strictEqual(completedFy.varianceByKey.grossProfit.amount,
            completedFy.selectedSummary.cogs.fullGrossProfitPaise - completedFy.comparisonSummary.cogs.fullGrossProfitPaise);
        const mensFy = await service.getManagementPnlFinancialYear({ financialYearStart: 2026, businessSegment: "MENS" });
        assert.strictEqual(mensFy.selectedSummary.expenses.commonOperatingExpensesPaise, 2000);
        assert.strictEqual(mensFy.selectedSummary.operatingResult.segmentDirectOperatingResultAvailable, false);
        assert.strictEqual(mensFy.postedExpenseDetails.totalCount, 2, "segment export retains its direct and COMMON expense detail");
        assert.strictEqual(mensFy.postedExpenseDetails.totalAmountPaise, 2250);
        const afterFyCounts = await get(db, "SELECT (SELECT COUNT(*) FROM bills) bills,(SELECT COUNT(*) FROM expenses) expenses,(SELECT COUNT(*) FROM returns) returns");
        assert.deepStrictEqual(afterFyCounts, beforeFyCounts, "FY read API performs no accounting writes");
        await assert.rejects(() => service.getManagementPnlFinancialYear({ financialYearStart: 2027, businessSegment: "ALL" }), /Future Financial Years/);

        await run(db, "DROP TRIGGER trg_return_items_cost_basis_insert_valid");
        await run(db, `INSERT INTO returns(return_no,credit_note_no,original_bill_no,business_date,accounting_status,
            accounting_snapshot_version,gross_reversal,discount_reversal,taxable_reversal,gst_reversal,net_reversal)
            VALUES('MISSING-LINK','CN000000003','SEP-1','2026-10-06','COMPLETED',1,0,0,0,0,0)`);
        await run(db, `INSERT INTO return_items(return_id,original_bill_item_id,quantity,gross_reversal,discount_reversal,
            taxable_reversal,gst_reversal,net_reversal,return_cost_basis_status)
            VALUES(3,99999,1,0,0,0,0,0,'UNKNOWN')`);
        const missingAttribution = await service.getManagementPnl({ fromDate: "2026-10-01", toDate: "2026-10-31", businessSegment: "KL" });
        assert(missingAttribution.selected.dataQuality.warnings.some(row => row.code === "UNCLASSIFIED_RETURN_ATTRIBUTION"));

        await run(db, `INSERT INTO returns(return_no,credit_note_no,original_bill_no,business_date,accounting_status,
            accounting_snapshot_version,gross_reversal,discount_reversal,taxable_reversal,gst_reversal,net_reversal)
            VALUES('BAD-RET','CN000000002','SEP-1','2026-10-05','COMPLETED',1,1,0,1,0,1)`);
        await run(db, `INSERT INTO return_items(return_id,original_bill_item_id,quantity,gross_reversal,discount_reversal,
            taxable_reversal,gst_reversal,net_reversal,return_unit_cost_paise,return_cost_paise,
            return_cost_basis_status,return_cost_source,return_cost_method)
            VALUES(4,?,1,1,0,1,0,1,2000,1,'CAPTURED','PRODUCT_MASTER','ORIGINAL_SALE_TIME_COST_REVERSAL')`, [sepCaptured.id]);
        const bad = await service.getManagementPnl({ fromDate: "2026-10-01", toDate: "2026-10-31" });
        assert(bad.selected.dataQuality.warnings.some(row => row.code === "RETURN_COGS_STATUS_INCONSISTENT"));
        assert.strictEqual(bad.selected.cogs.fullGrossProfitAvailable, false);

        await assert.rejects(() => service.getManagementPnl({ fromDate: "2026-10-30", toDate: "2026-10-01" }), /must not be after/);
        await assert.rejects(() => service.getManagementPnl({ fromDate: "2026-10-01", toDate: "2026-10-31", businessSegment: "COMMON" }), /Select ALL/);

        if (process.env.KLBS_E3_OWNER_RETEST_DIR) {
            const outputDirectory = path.resolve(process.env.KLBS_E3_OWNER_RETEST_DIR);
            fs.mkdirSync(outputDirectory, { recursive: true });
            const filename = managementPnlFilename(goldenFy.metadata.store.storeCode, goldenFy.metadata.financialYearLabel, goldenFy.metadata.asOfDate);
            const outputPath = path.join(outputDirectory, filename);
            const exported = await exportManagementPnlFinancialYear(goldenFy, outputPath, { version: "2.0.0", schemaVersion: 9 });
            assert.strictEqual(exported.success, true);
            console.log(`OWNER RETEST WORKBOOK ${exported.filePath}`);
        }
    } finally {
        await close(db);
    }
    console.log("PASS V21-05B period/FY/comparison helpers, GST-exclusive revenue bridge, return-date recognition, immutable sale/return cost, coverage and profit availability, OPEX posted/store/segment filters and grouping, COMMON separation, data-quality warnings, reconciliation, zero-sales and negative-return periods, and deterministic aggregation");
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
