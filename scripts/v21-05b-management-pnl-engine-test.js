"use strict";

const assert = require("assert");
const sqlite3 = require("sqlite3").verbose();
const { migrateExpenseTracker } = require("../src/database/expenseTrackerMigration");
const { migrateReturnCogsReversal } = require("../src/database/returnCogsReversalMigration");
const { CATEGORY_GROUPS, createManagementPnlService } = require("../src/database/managementPnlService");
const { resolveManagementPnlPeriod, comparisonPeriod } = require("../src/database/managementPnlPeriods");

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
        assert.strictEqual(sep.selected.unsupportedAccountingLines.depreciation.status, "NOT_TRACKED");
        assert.strictEqual(sep.selected.unsupportedAccountingLines.depreciation.amountPaise, null);
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

        const noRows = await service.getManagementPnl({ fromDate: "2026-08-01", toDate: "2026-08-31" });
        assert.strictEqual(noRows.selected.cogs.costCoveragePercent, null);
        assert.strictEqual(noRows.selected.cogs.coverageStatus, "NO_ELIGIBLE_SALES");
        assert.strictEqual(noRows.selected.cogs.fullGrossProfitPaise, 0);
        assert.strictEqual(noRows.selected.cogs.fullGrossMarginPercent, null);
        assert.strictEqual(noRows.selected.operatingResult.operatingMarginPercent, null);

        await run(db, "DROP TRIGGER trg_expense_batches_immutable");
        await run(db, "UPDATE expense_batches SET total_amount_paise=total_amount_paise+1 WHERE batch_code='KLEXPB000003'");
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
    } finally {
        await close(db);
    }
    console.log("PASS V21-05B period/FY/comparison helpers, GST-exclusive revenue bridge, return-date recognition, immutable sale/return cost, coverage and profit availability, OPEX posted/store/segment filters and grouping, COMMON separation, data-quality warnings, reconciliation, zero-sales and negative-return periods, and deterministic aggregation");
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
