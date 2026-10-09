"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const ExcelJS = require("exceljs");
const {
    CURRENT_DB_SCHEMA_VERSION, prepareDatabaseSchema, readSchemaVersion
} = require("../src/database/schemaVersion");
const {
    EXPENSE_HEADERS, BUSINESS_SEGMENTS, PAYMENT_MODES, PAGE_SIZE,
    ExpenseTrackerError, normalizeExpenseEntry, createExpenseTrackerService, getExpenseTrackerOptions
} = require("../src/database/expenseTrackerService");
const { migrateStoreIdentity } = require("../src/database/storeIdentityMigration");
const { exportPostedExpenseBatch, exportExpenseHistory } = require("../src/database/expenseExcelExporter");
const { AUTHORIZATION_POLICY } = require("../src/services/administratorSecurityService");
const { createExpenseDraftState } = require("../src/renderer/modules/expenseDraftState");
const { stepMonth } = require("../src/renderer/modules/expenseHistoryCalendar");

const EXPECTED_HEADERS = [
    "Rent", "Electricity", "Internet & Communication", "Salary & Wages", "Staff Welfare",
    "Marketing & Advertising", "Maintenance & Repairs", "Cleaning & Housekeeping", "Packaging",
    "Stationery & Printing", "Transport & Local Conveyance", "Freight & Courier", "Bank & Payment Charges",
    "Software & Subscriptions", "Professional Fees", "Licences & Statutory Fees", "Security & Surveillance",
    "Insurance", "Petty Cash / General Expense", "Miscellaneous"
];
const run = (db, sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function(error) {
    error ? reject(error) : resolve({ lastID: this.lastID, changes: this.changes });
}));
const get = (db, sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
const all = (db, sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
const exec = (db, sql) => new Promise((resolve, reject) => db.exec(sql, error => error ? reject(error) : resolve()));
const close = db => new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
const appendTestActivity = (db, event, instant) => run(db, `INSERT INTO activities
    (activity_date, activity_time, category, action, details, user_name, status,
     entity_type, reference_no, change_data, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    "07-Oct-2026", "12:00:00", event.category, event.action, event.details,
    event.user_name, event.status, event.entity_type, event.reference_no,
    null, instant.toISOString()
]);

const BASE = `
    PRAGMA foreign_keys = ON;
    CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE bills (id INTEGER PRIMARY KEY, bill_no TEXT UNIQUE);
    CREATE TABLE bill_items (id INTEGER PRIMARY KEY, bill_no TEXT, business_segment TEXT,
        unit_cost_paise INTEGER, cost_basis_status TEXT DEFAULT 'UNKNOWN', cost_source TEXT, cost_method TEXT);
    CREATE TABLE returns (id INTEGER PRIMARY KEY, original_bill_no TEXT,
        accounting_status TEXT DEFAULT 'LEGACY_UNASSESSED', business_date TEXT,
        accounting_snapshot_version INTEGER);
    CREATE TABLE return_items (id INTEGER PRIMARY KEY, return_id INTEGER,
        original_bill_item_id INTEGER, quantity INTEGER);
    CREATE TABLE settings (id INTEGER PRIMARY KEY, store_name TEXT, gstin TEXT);
    CREATE TABLE inventory_transactions (id INTEGER PRIMARY KEY, quantity INTEGER);
    CREATE TABLE day_closing (id INTEGER PRIMARY KEY, business_date TEXT);
    CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE stock_movements (id INTEGER PRIMARY KEY, movement_no TEXT);
    CREATE TABLE stock_movement_lines (id INTEGER PRIMARY KEY, movement_id INTEGER);
    CREATE TABLE klbs_schema_metadata (id INTEGER PRIMARY KEY CHECK(id=1), schema_version INTEGER NOT NULL);
    CREATE TABLE expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT, expense_date TEXT NOT NULL, category TEXT NOT NULL,
        particulars TEXT NOT NULL, expense_class TEXT NOT NULL DEFAULT 'OPERATING' CHECK(expense_class='OPERATING'),
        amount_paise INTEGER NOT NULL CHECK(amount_paise > 0), payment_mode TEXT NOT NULL, paid_to TEXT,
        reference TEXT, business_segment TEXT NOT NULL CHECK(business_segment IN ('KL','MENS','KIDS','COMMON')),
        remarks TEXT, lifecycle_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(lifecycle_status IN ('ACTIVE','VOID')),
        entered_by TEXT NOT NULL, last_modified_by TEXT, correction_reason TEXT,
        corrects_expense_id INTEGER UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        voided_by TEXT, voided_at TEXT, void_reason TEXT
    );
    CREATE TABLE activities (
        id INTEGER PRIMARY KEY AUTOINCREMENT, activity_date TEXT NOT NULL, activity_time TEXT NOT NULL,
        category TEXT NOT NULL, action TEXT NOT NULL, details TEXT NOT NULL, user_name TEXT NOT NULL,
        status TEXT NOT NULL, entity_type TEXT, reference_no TEXT, change_data TEXT, created_at TEXT NOT NULL
    );
`;

async function makeDb() {
    const db = new sqlite3.Database(":memory:");
    await exec(db, BASE);
    await run(db, "INSERT INTO klbs_schema_metadata VALUES (1, 6)");
    await migrateStoreIdentity(db);
    const legacy = await run(db, `INSERT INTO expenses
        (expense_date,category,particulars,amount_paise,payment_mode,business_segment,entered_by,created_at,updated_at)
        VALUES ('2026-09-30','Rent','Legacy Rent',10000,'Cash','COMMON','OPERATOR','old','old')`);
    await prepareDatabaseSchema({ database: db, runCurrentMigrations: async () => {} });
    assert.strictEqual(legacy.lastID, 1);
    assert.strictEqual(await readSchemaVersion(db), CURRENT_DB_SCHEMA_VERSION,
        "the isolated V6 fixture completes the registered V7→V10 migrations");
    assert.deepStrictEqual(await all(db, `SELECT name FROM sqlite_master WHERE type='table'
        AND name IN ('management_accounting_entries','management_accounting_entry_sequences') ORDER BY name`), [
        { name: "management_accounting_entries" }, { name: "management_accounting_entry_sequences" }
    ], "V9 foundation tables exist in the isolated current-schema fixture");
    return db;
}

function validEntry(overrides = {}) {
    return {
        expenseDate: "2026-10-07", category: "Rent", businessSegment: "KL",
        paymentMode: "Cash", reference: "", amount: "100.00", remarks: "Monthly premises",
        ...overrides
    };
}

async function main() {
    assert.strictEqual(CURRENT_DB_SCHEMA_VERSION, 13);
    assert.deepStrictEqual(EXPENSE_HEADERS, EXPECTED_HEADERS);
    assert.deepStrictEqual(getExpenseTrackerOptions(), {
        expenseHeaders: EXPECTED_HEADERS,
        businessSegments: ["KL", "MENS", "KIDS", "COMMON"],
        transactionTypes: ["Cash", "UPI", "Card", "Bank Transfer", "Other"]
    });
    assert.deepStrictEqual(BUSINESS_SEGMENTS, ["KL", "MENS", "KIDS", "COMMON"]);
    assert.deepStrictEqual(PAYMENT_MODES, ["Cash", "UPI", "Card", "Bank Transfer", "Other"]);
    assert.strictEqual(PAGE_SIZE, 100);
    assert.strictEqual(AUTHORIZATION_POLICY.EXPENSE_POST, "MANAGER");

    const draftState = createExpenseDraftState();
    const rent = draftState.add({ expenseDate: "2026-10-07", category: "Rent", paymentMode: "UPI", amountPaise: 2500000 });
    assert.deepStrictEqual(draftState.summarize(PAYMENT_MODES), {
        count: 1, grand: 2500000, Cash: 0, UPI: 2500000, Card: 0, "Bank Transfer": 0, Other: 0
    });
    draftState.clear();
    let draftTotals = draftState.summarize(PAYMENT_MODES);
    assert.strictEqual(draftState.getEntries().length, 0, "Clear All clears the authoritative draft collection");
    assert.strictEqual(draftTotals.count, 0);
    assert.strictEqual(draftTotals.grand, 0);
    for (const mode of PAYMENT_MODES) assert.strictEqual(draftTotals[mode], 0, `${mode} total resets after Clear All`);
    assert.strictEqual(draftState.remove(rent.draftKey), false);
    const finalRow = draftState.add({ expenseDate: "2026-10-07", category: "Rent", paymentMode: "UPI", amountPaise: 2500000 });
    assert.strictEqual(draftState.remove(finalRow.draftKey), true);
    draftTotals = draftState.summarize(PAYMENT_MODES);
    assert.strictEqual(draftTotals.count, 0, "deleting the final row produces the zero summary");
    assert.strictEqual(draftTotals.grand, 0);
    for (const mode of PAYMENT_MODES) assert.strictEqual(draftTotals[mode], 0);
    const afterClear = draftState.add({ expenseDate: "2026-10-07", category: "Electricity", paymentMode: "Cash", amountPaise: 12500 });
    draftTotals = draftState.summarize(PAYMENT_MODES);
    assert.strictEqual(draftTotals.count, 1, "an add after Clear All starts with fresh totals");
    assert.strictEqual(draftTotals.Cash, 12500);
    assert.strictEqual(draftTotals.UPI, 0);
    draftState.remove(afterClear.draftKey);

    assert.strictEqual(stepMonth("2026-10", -1, "2026-10"), "2026-09");
    assert.strictEqual(stepMonth("2026-09", 1, "2026-10"), "2026-10", "Next advances exactly one calendar month");
    assert.strictEqual(stepMonth("2026-10", 1, "2026-10"), null, "future month cannot be reached");
    assert.strictEqual(stepMonth("2026-12", 1, "2027-01"), "2027-01", "December → January rolls the year forward");
    assert.strictEqual(stepMonth("2027-01", -1, "2027-01"), "2026-12", "January → December rolls the year backward");
    assert.strictEqual(stepMonth("invalid", 1, "2026-10"), null);

    const migrationRollbackDb = new sqlite3.Database(":memory:");
    try {
        await exec(migrationRollbackDb, BASE);
        await run(migrationRollbackDb, "INSERT INTO klbs_schema_metadata VALUES (1, 6)");
        await migrateStoreIdentity(migrationRollbackDb);
        await run(migrationRollbackDb, "CREATE TABLE expense_batches (id INTEGER PRIMARY KEY)");
        await assert.rejects(() => prepareDatabaseSchema({
            database: migrationRollbackDb, currentVersion: 7, runCurrentMigrations: async () => {}
        }));
        assert.strictEqual(await readSchemaVersion(migrationRollbackDb), 6,
            "V7 schema version advances only after the entire migration succeeds");
        const expenseColumns = await all(migrationRollbackDb, "PRAGMA table_info(expenses)");
        assert(!expenseColumns.some(column => column.name === "expense_code"),
            "failed V7 migration rolls back partial expense table changes");
        assert.strictEqual((await get(migrationRollbackDb, "PRAGMA integrity_check")).integrity_check, "ok");
    } finally {
        await close(migrationRollbackDb);
    }

    const invalidInputs = [
        [{}, "EXPENSE_DATE_INVALID"],
        [validEntry({ expenseDate: "2026-10-08" }), "EXPENSE_DATE_FUTURE"],
        [validEntry({ category: "Made Up" }), "EXPENSE_HEADER_REQUIRED"],
        [validEntry({ businessSegment: "" }), "EXPENSE_SEGMENT_REQUIRED"],
        [validEntry({ businessSegment: "ALL" }), "EXPENSE_SEGMENT_REQUIRED"],
        [validEntry({ paymentMode: "Cheque" }), "EXPENSE_PAYMENT_MODE_REQUIRED"],
        [validEntry({ amount: "0" }), "EXPENSE_AMOUNT_INVALID"],
        [validEntry({ amount: "-1" }), "EXPENSE_AMOUNT_INVALID"],
        [validEntry({ amount: "1.001" }), "EXPENSE_AMOUNT_INVALID"],
        [validEntry({ amount: "not money" }), "EXPENSE_AMOUNT_INVALID"],
        [validEntry({ category: "Miscellaneous", remarks: "   " }), "EXPENSE_MISC_REMARKS_REQUIRED"]
    ];
    for (const [input, code] of invalidInputs) {
        assert.throws(() => normalizeExpenseEntry(input, "2026-10-07"), error => error instanceof ExpenseTrackerError && error.code === code);
    }
    assert.strictEqual(normalizeExpenseEntry(validEntry({ amount: "12.3", reference: "  R-1  " }), "2026-10-07").amountPaise, 1230);
    assert.strictEqual(normalizeExpenseEntry(validEntry({ amount: "1", category: "Miscellaneous", remarks: "Reason" }), "2026-10-07").remarks, "Reason");

    const db = await makeDb();
    const store = { id: 1, storeCode: "KL001", storeName: "Kaira Luxe", status: "ACTIVE" };
    const service = createExpenseTrackerService(db, {
        getCurrentStore: async () => store,
        appendActivityInTransaction: appendTestActivity,
        now: () => new Date("2026-10-07T12:00:00+05:30")
    });
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "klbs-v21-04-expense-test-"));
    try {
        assert.strictEqual(await readSchemaVersion(db), CURRENT_DB_SCHEMA_VERSION);
        assert.deepStrictEqual(await all(db, "PRAGMA foreign_key_check"), []);
        const legacy = await get(db, "SELECT category, expense_code, batch_id, store_id FROM expenses WHERE id=1");
        assert.deepStrictEqual(legacy, { category: "Rent", expense_code: null, batch_id: null, store_id: null },
            "V8 preserves existing expense rows without classifying them as posted V2.1 records");
        const legacyHistory = await service.listPostedExpenses({ month: "2026-09", page: 1 });
        assert.strictEqual(legacyHistory.totalCount, 0, "legacy expense rows are excluded from posted V2.1 history");
        await assert.rejects(() => service.listPostedExpenses({ month: "2026-11", page: 1 }),
            error => error.code === "EXPENSE_MONTH_FUTURE", "future history months fail closed at the DB service");
        await assert.rejects(() => run(db, "UPDATE expense_identity_sequences SET next_expense_sequence=0 WHERE id=1"),
            /KLBS_EXPENSE_ID_SEQUENCE_CANNOT_REWIND/);
        await assert.rejects(() => run(db, "DELETE FROM expense_identity_sequences WHERE id=1"),
            /KLBS_EXPENSE_ID_SEQUENCE_DELETE_PROHIBITED/);

        await assert.rejects(() => service.postExpenseBatch([], {}), error => error.code === "EXPENSE_BATCH_EMPTY");
        const beforeFailedPost = await get(db, "SELECT next_batch_sequence, next_expense_sequence FROM expense_identity_sequences WHERE id=1");
        const rollbackService = createExpenseTrackerService(db, {
            getCurrentStore: async () => store,
            appendActivityInTransaction: async () => { throw new Error("injected audit write failure"); },
            now: () => new Date("2026-10-07T12:00:00+05:30")
        });
        await assert.rejects(() => rollbackService.postExpenseBatch([validEntry()], {}), /injected audit write failure/);
        assert.strictEqual(Number((await get(db, "SELECT COUNT(*) AS n FROM expense_batches")).n), 0,
            "activity failure rolls back the batch and all expenses");
        assert.deepStrictEqual(await get(db, "SELECT next_batch_sequence, next_expense_sequence FROM expense_identity_sequences WHERE id=1"), beforeFailedPost,
            "failed atomic posting does not consume permanent IDs");
        assert.strictEqual(Number((await get(db, "SELECT COUNT(*) AS n FROM activities")).n), 0,
            "failed posting creates no success Activity Log event");

        const first = await service.postExpenseBatch([validEntry({ reference: "RECEIPT-1" })], {});
        assert.strictEqual(first.batch_code, "KLEXPB000001");
        assert.strictEqual(first.expenses[0].expense_code, "KLEXP000001");
        assert.strictEqual(first.store_code, "KL001");
        assert.strictEqual(first.expenses[0].store_code, "KL001");
        const inactiveStoreService = createExpenseTrackerService(db, {
            getCurrentStore: async () => ({ ...store, status: "INACTIVE" }),
            appendActivityInTransaction: appendTestActivity,
            now: () => new Date("2026-10-07T12:00:00+05:30")
        });
        await assert.rejects(() => inactiveStoreService.postExpenseBatch([validEntry()], {}), error => error.code === "EXPENSE_STORE_UNAVAILABLE");
        assert.strictEqual(first.status, "POSTED");
        assert.strictEqual(Number((await get(db, "SELECT COUNT(*) AS n FROM activities WHERE action='EXPENSE_BATCH_POSTED'")).n), 1);
        const firstActivity = await get(db, "SELECT category, details, user_name, reference_no FROM activities WHERE action='EXPENSE_BATCH_POSTED'");
        assert.strictEqual(firstActivity.category, "EXPENSE");
        assert.match(firstActivity.details, /Expense Batch KLEXPB000001 posted: 1 expenses/);
        assert.strictEqual(firstActivity.user_name, "MANAGER");
        assert.strictEqual(firstActivity.reference_no, "KLEXPB000001");
        assert.deepStrictEqual(await service.getPostedExpenseDetails("KLEXP000001"), {
            expense_code: "KLEXP000001", batch_code: "KLEXPB000001", expense_date: "2026-10-07",
            category: "Rent", business_segment: "KL", payment_mode: "Cash", reference: "RECEIPT-1",
            amount_paise: 10000, remarks: "Monthly premises", posted_at: first.posted_at,
            store_code: "KL001", store_name: "Kaira Luxe"
        });
        await assert.rejects(() => run(db, "UPDATE expenses SET amount_paise=1 WHERE expense_code='KLEXP000001'"), /KLBS_POSTED_EXPENSE_IMMUTABLE/);

        const duplicate = await service.findPostedDuplicates([validEntry({ reference: "RECEIPT-1" })]);
        assert.strictEqual(duplicate.length, 1, "matching date/header/amount/nonblank reference triggers warning");
        assert.strictEqual((await service.findPostedDuplicates([validEntry({ reference: "" })])).length, 0,
            "blank references never trigger duplicate warnings");
        await assert.rejects(() => service.postExpenseBatch([validEntry({ reference: "RECEIPT-1" })], {}),
            error => error.code === "EXPENSE_DUPLICATE_ACK_REQUIRED" && error.duplicates.length === 1);

        const entries = [];
        const modes = [...PAYMENT_MODES];
        for (let index = 0; index < 105; index += 1) {
            entries.push(validEntry({
                category: EXPECTED_HEADERS[index % EXPECTED_HEADERS.length],
                businessSegment: BUSINESS_SEGMENTS[index % BUSINESS_SEGMENTS.length],
                paymentMode: modes[index % modes.length],
                reference: `REF-${String(index).padStart(3, "0")}`,
                amount: `${(index % 99) + 1}.25`,
                remarks: index % EXPECTED_HEADERS.length === 19 ? "Miscellaneous reason" : `Line ${index}`
            }));
        }
        const largeBatch = await service.postExpenseBatch(entries, {});
        assert.strictEqual(largeBatch.batch_code, "KLEXPB000002");
        assert.strictEqual(largeBatch.expense_count, 105);
        assert.strictEqual(largeBatch.expenses[0].expense_code, "KLEXP000002");
        assert.strictEqual(largeBatch.expenses[104].expense_code, "KLEXP000106");
        assert.strictEqual(largeBatch.expenses.every(expense => expense.store_code === "KL001"), true);
        assert.strictEqual(largeBatch.expenses.reduce((total, expense) => total + expense.amount_paise, 0), largeBatch.total_amount_paise);
        assert.strictEqual(Number((await get(db, "SELECT COUNT(*) AS n FROM activities WHERE action='EXPENSE_BATCH_POSTED'")).n), 2);
        await assert.rejects(() => run(db, "UPDATE expense_batches SET status='VOID' WHERE batch_code='KLEXPB000002'"), /KLBS_POSTED_EXPENSE_BATCH_IMMUTABLE/);

        const page1 = await service.listPostedExpenses({ month: "2026-10", page: 1 });
        const page2 = await service.listPostedExpenses({ month: "2026-10", page: 2 });
        assert.strictEqual(page1.totalCount, 106);
        assert.strictEqual(page1.totalPages, 2);
        assert.strictEqual(page1.pageSize, 100);
        assert.strictEqual(page1.rows.length, 100);
        assert.strictEqual(page2.rows.length, 6);
        assert.strictEqual(page1.rows[0].expense_code, "KLEXP000106", "history sorts newest date then permanent ID descending");
        assert.strictEqual((await service.listPostedExpenses({ month: "2026-10", page: 999 })).page, 2, "out-of-range page clamps to final page");
        const filtered = await service.listPostedExpenses({ month: "2026-10", category: "Rent", businessSegment: "KL", paymentMode: "Cash", search: "REF-000", page: 2 });
        assert(filtered.totalCount >= 1 && filtered.rows.every(row => row.category === "Rent" && row.business_segment === "KL" && row.payment_mode === "Cash"));
        const filteredExport = await service.getPostedExpensesForExport({ month: "2026-10", category: "Rent", businessSegment: "KL", paymentMode: "Cash", search: "REF-000", page: 2 });
        assert.strictEqual(filteredExport.totalCount, filtered.totalCount);
        assert.strictEqual(filteredExport.rows.length, filtered.totalCount,
            "history export applies all active filters and ignores the UI page number");
        const summary = await service.getExpenseSummaryByHeader({ month: "2026-10" });
        assert.strictEqual(summary.reduce((total, row) => total + Number(row.expense_count), 0), 106);
        const pAndLContract = await service.getPostedOpexSummary({ fromDate: "2026-10-01", toDate: "2026-10-31" });
        assert.strictEqual(pAndLContract.reduce((total, row) => total + Number(row.expense_count), 0), 106,
            "future P&L contract returns posted OPEX only and excludes legacy/unposted rows");
        const allForExport = await service.getPostedExpensesForExport({ month: "2026-10" });
        assert.strictEqual(allForExport.rows.length, 106, "export query returns the complete matching set, not page 2");
        assert.strictEqual(allForExport.totalCount, 106);
        assert.strictEqual(allForExport.totalAmountPaise, first.total_amount_paise + largeBatch.total_amount_paise);
        const batchData = await service.getPostedExpenseBatch(largeBatch.batch_code);
        const batchPath = path.join(tempDir, "batch.xlsx");
        const historyPath = path.join(tempDir, "history.xlsx");
        await exportPostedExpenseBatch(batchData, batchPath);
        await exportExpenseHistory(allForExport, { month: "2026-10" }, store, historyPath);
        const batchWorkbook = new ExcelJS.Workbook();
        await batchWorkbook.xlsx.readFile(batchPath);
        assert.strictEqual(batchWorkbook.getWorksheet("Expense Batch").rowCount, 113,
            "batch XLSX has six metadata rows, heading row and exactly 105 posted expense rows");
        const historyWorkbook = new ExcelJS.Workbook();
        await historyWorkbook.xlsx.readFile(historyPath);
        assert.strictEqual(historyWorkbook.getWorksheet("Expense History").rowCount, 117,
            "history XLSX contains the full 106 matching rows while the UI was on page 2");
        assert.strictEqual(historyWorkbook.getWorksheet("Expense History").getCell("B1").value, "KL001");
        assert.strictEqual(historyWorkbook.getWorksheet("Expense History").getCell("B3").value, "2026-10");

        const renderer = fs.readFileSync(path.join(__dirname, "../src/renderer/modules/expenseTracker.js"), "utf8");
        const html = fs.readFileSync(path.join(__dirname, "../src/renderer/index.html"), "utf8");
        const mainSource = fs.readFileSync(path.join(__dirname, "../src/main/main.js"), "utf8");
        const preload = fs.readFileSync(path.join(__dirname, "../src/main/preload.js"), "utf8");
        const shortcuts = fs.readFileSync(path.join(__dirname, "../src/renderer/modules/shortcuts.js"), "utf8");
        const businessCss = fs.readFileSync(path.join(__dirname, "../src/renderer/styles/business.css"), "utf8");
        const billingCss = fs.readFileSync(path.join(__dirname, "../src/renderer/styles/billing.css"), "utf8");
        const expenseCss = fs.readFileSync(path.join(__dirname, "../src/renderer/styles/expense.css"), "utf8");
        assert.match(html, /id="expenseBatchExportBtn"[^>]*disabled/);
        for (const id of ["expenseHistoryExportBtn", "expenseHistorySummaryBtn", "expenseHistoryPrevious", "expenseHistoryPageJump", "expenseHistoryNext"]) {
            assert.match(html, new RegExp(`id="${id}"[^>]*disabled`), `${id} starts disabled before matching history is loaded`);
        }
        assert.match(renderer, /const draftState = window\.KLBSExpenseDraftState\.createExpenseDraftState\(\)/,
            "one session-only state collection drives draft rows and totals");
        assert.match(renderer, /draftState\.remove\(entry\.draftKey\)/);
        assert.match(renderer, /draftState\.clear\(\)/);
        assert.match(renderer, /const totals = draftState\.summarize\(paymentModes\)/);
        assert(!/if\s*\(hasRows\)\s*\{[\s\S]{0,900}expenseDraftSummary/.test(renderer),
            "the zero summary is recalculated and rendered, not retained from prior rows");
        assert.match(renderer, /Clear all \$\{totals\.count\} unposted expenses totaling/,
            "Clear All confirmation identifies count and total");
        assert.match(html, /No expenses have been added to this draft batch/);
        assert.match(renderer, /expenseHistoryPrevious[\s\S]*?expenseHistoryNext/);
        assert.match(renderer, /historyPage = 1/);
        assert.match(renderer, /expenseHistoryExportBtn"\)\.disabled = !hasRows/);
        assert.match(renderer, /expenseHistorySummaryBtn"\)\.disabled = !hasRows/);
        assert.match(renderer, /expenseHistoryPageJump"\)\.disabled = !hasRows/);
        assert.match(renderer, /expenseHistoryPrevious"\)\.disabled = true[\s\S]*?expenseHistoryNext"\)\.disabled = true/);
        assert.match(renderer, /getPostedExpenseHistory\(options\)[\s\S]*?exportPostedExpenseHistory\(historyOptions\(\)\)/);
        assert.match(mainSource, /requireSecurityGrant\(grant, "EXPENSE_POST"\)/);
        assert.match(preload, /ipcRenderer\.invoke\("expenses:history", options\)/);
        assert.match(preload, /ipcRenderer\.invoke\("expenses:export-history", options\)/);
        assert.match(renderer, /const rowsNode = \$\("expenseDraftRows"\)/);
        assert.match(renderer, /expenseDetailOverlay"\)\.hidden = false/);
        assert.match(renderer, /event\.stopImmediatePropagation\(\)[\s\S]*?closeExpenseDetails\(\)/,
            "detail ESC is consumed at the overlay without leaving its history context");
        assert.match(renderer, /showHistory\(\)[\s\S]*?renderHistory\(\)/);
        assert.match(billingCss, /\.back-btn\s*\{[\s\S]*?padding:\s*16px 30px[\s\S]*?font-size:\s*22px[\s\S]*?border-radius:\s*12px/);
        assert.match(billingCss, /\.page-top-bar\s*\{[\s\S]*?margin-bottom:\s*30px/);
        assert(!businessCss.includes(".business-page-topbar"), "Business-specific Back-row override is retired");
        assert.match(businessCss, /\.business-page-after-topbar\s*>\s*\.business-page-header\s*\{\s*margin-top:\s*0/,
            "content retains its former vertical position after the page-level bar is moved outside the centered content container");
        assert.match(expenseCss, /\.expense-page-topbar\s*\{[\s\S]*?height:\s*42px[\s\S]*?align-items:\s*flex-start/,
            "restoring canonical Back size does not change the Expense toolbar or content flow height");
        for (const [id, label, screenId, barClass] of [
            ["businessDashboardBtn", "Dashboard", "businessScreen", "bill-top-bar"],
            ["customersBusinessBtn", "Business", "customersScreen", "bill-top-bar"],
            ["customerProfileBackToDirectory", "Customers", "customersScreen", "page-top-bar customer-profile-toolbar"],
            ["accountingBusinessBtn", "Business", "accountingDataScreen", "bill-top-bar"],
            ["expenseTrackerBackBtn", "Accounting &amp; Data", "expenseTrackerScreen", "bill-top-bar expense-page-topbar"],
            ["expenseHistoryBackBtn", "Expense Tracker", "expenseHistoryScreen", "bill-top-bar expense-page-topbar"]
        ]) {
            const button = html.match(new RegExp(`<button id="${id}"[^>]*>[\\s\\S]*?<\\/button>`))?.[0] || "";
            assert(button.includes("back-btn") && button.includes(`← ${label}`), `${id} retains canonical Back styling and destination`);
            const topbarClassPattern = barClass.replace(/ /g, "\\s+");
            const topbar = html.match(new RegExp(`<div id="${screenId}"[^>]*>\\s*<div class="${topbarClassPattern}">[\\s\\S]*?id="${id}"`))?.[0] || "";
            if (id !== "customerProfileBackToDirectory") assert(topbar, `${id} uses the legacy topbar directly under its screen, outside the centered content wrapper`);
        }
        const reportsBack = html.match(/<button\s+id="reportsDashboardBtn"[^>]*>[\s\S]*?<\/button>/)?.[0] || "";
        assert(reportsBack.includes("back-btn") && !reportsBack.includes("v21-page-back-anchor"), "Reports stays a visual reference and is not modified");
        assert(!expenseCss.includes(".expense-page-topbar > button,"), "Expense toolbar no longer overrides the canonical Back size");
        assert.match(expenseCss, /\.expense-page-topbar > button:not\(\.back-btn\)/, "History/Export action sizing remains separate from Back buttons");
        assert.match(shortcuts, /expenseHistoryScreen[\s\S]*?expenseHistoryBackBtn[\s\S]*?expenseTrackerScreen[\s\S]*?expenseTrackerBackBtn/);
        assert.match(expenseCss, /\.expense-month-nav:disabled[\s\S]*?background:\s*#c7cbd1[\s\S]*?color:\s*#68707a/);
        assert.match(expenseCss, /\.expense-page-topbar > button:disabled[\s\S]*?#expenseHistoryPageJump:disabled/,
            "empty-result export and jump controls use KLBS disabled styling");
        assert.match(expenseCss, /\.expense-month-nav:hover:not\(:disabled\)[\s\S]*?var\(--primary-dark\)/);
        assert.match(expenseCss, /\.expense-month-nav:focus-visible[\s\S]*?outline:/);
        assert.match(html, /id="expenseHistoryNextMonth"[^>]*aria-label="Next month"/);

        assert.strictEqual((await get(db, "PRAGMA integrity_check")).integrity_check, "ok");
        assert.deepStrictEqual(await all(db, "PRAGMA foreign_key_check"), []);
        console.log("PASS V21-04 expense master/validation, draft-vs-posted contract, V6→V7 migration preservation, atomic posting/rollback, Manager purpose, immutable IDs, Store attribution, duplicate warning, DB pagination/totals/summary, full-result Excel exports, and UI/IPC wiring");
    } finally {
        await close(db);
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
