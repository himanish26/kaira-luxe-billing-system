"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const sqlite3 = require("sqlite3").verbose();
const ExcelJS = require("exceljs");
const { createSupplierAccountsReportService } = require("../src/database/supplierAccountsReportService");
const { exportSupplierAccountsReport } = require("../src/database/excelExporter");
const { AUTHORIZATION_POLICY, ADMIN_PIN_AUDIT_POLICY, AUTHORIZATION_LEVELS } = require("../src/services/administratorSecurityService");
const { createAdministratorSecurityService } = require("../src/services/administratorSecurityService");
const { hashCredential } = require("../src/services/credentialCrypto");

const run = (db, sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function (error) { error ? reject(error) : resolve({ lastID: this.lastID }); }));
const all = (db, sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
const exec = (db, sql) => new Promise((resolve, reject) => db.exec(sql, error => error ? reject(error) : resolve()));
const close = db => new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));

function makeElement(value = "") {
    const listeners = new Map();
    return {
        value, checked: false, style: {}, classList: { add() {}, remove() {} },
        addEventListener(type, listener) { listeners.set(type, listener); },
        dispatch(type, event = {}) { return listeners.get(type)?.(event); },
        querySelector(selector) { return selector === "input" ? this.radio : null; },
        max: "", textContent: "", innerHTML: "", disabled: false
    };
}

async function qualifyRendererAuthorizationFlow(security) {
    const types = ["business", "gst", "product", "customer", "billSummary", "supplierAccounts"];
    const radios = types.map(value => Object.assign(makeElement(), { value, checked: value === "business" }));
    const options = radios.map(radio => Object.assign(makeElement(), { radio }));
    const ids = {
        reportDateRange: makeElement("thisMonth"), customDateRange: makeElement(),
        reportDescription: makeElement(), selectedPeriodText: makeElement(),
        exportReportBtn: makeElement(), fromDate: makeElement(), toDate: makeElement()
    };
    const document = {
        querySelectorAll(selector) {
            if (selector === 'input[name="reportType"]') return radios;
            if (selector === ".report-option") return options;
            return [];
        },
        querySelector(selector) {
            if (selector === 'input[name="reportType"]:checked') return radios.find(radio => radio.checked) || null;
            return null;
        },
        getElementById(id) { return ids[id] || null; }
    };
    const source = fs.readFileSync(path.join(__dirname, "../src/renderer/modules/reports.js"), "utf8");
    let authorizationCalls = 0;
    let ipcCalls = 0;
    let workbooks = 0;
    let selectedType = "supplierAccounts";
    let returnedGrant;
    const alerts = [];
    const context = {
        document, Date, Intl, Promise, Array, String, Number,
        alert: message => alerts.push(String(message)),
        requestAdminAuthorization: async purpose => {
            authorizationCalls++;
            assert(["CUSTOMER_REPORT_EXPORT", "BILL_SUMMARY_REPORT_EXPORT"].includes(purpose), "only the approved protected Reports request authorization");
            assert.equal(security.getAuthorizationRole(purpose), "ADMINISTRATOR", "canonical modal must present Administrator role");
            const result = await security.authorizePin("2468", purpose);
            assert.equal(result.success, true);
            assert.ok(result.grant);
            returnedGrant = result.grant;
            return result.grant;
        },
        window: { electronAPI: {
            exportReport: async (request, grant) => {
                ipcCalls++;
                assert.equal(request.reportType, selectedType);
                if (request.reportType === "supplierAccounts") {
                    assert.equal(grant, undefined, "Supplier export sends no cached security grant");
                } else {
                    const purpose = request.reportType === "customer" ? "CUSTOMER_REPORT_EXPORT" : "BILL_SUMMARY_REPORT_EXPORT";
                    if (!security.consumeGrant(grant, purpose)) return { success: false, error: "Required authorization is missing, invalid, or has expired." };
                }
                workbooks++;
                return { success: true };
            }
        } }
    };
    vm.runInNewContext(source, context, { filename: "src/renderer/modules/reports.js" });
    const supplierRadio = radios.find(radio => radio.value === "supplierAccounts");
    radios.forEach(radio => { radio.checked = false; });
    supplierRadio.checked = true;
    await supplierRadio.dispatch("change", { target: supplierRadio });
    assert.equal(authorizationCalls, 0, "Supplier Accounts selection does not request Administrator authorization");
    await ids.exportReportBtn.dispatch("click");
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(authorizationCalls, 0, "Supplier Accounts Export click does not request Administrator authorization");
    assert.equal(ipcCalls, 1, "Supplier Accounts generic export IPC runs with no grant");
    assert.equal(workbooks, 1, "Supplier Accounts export succeeds without authorization token");

    radios.forEach(radio => { radio.checked = false; });
    const customerRadio = radios.find(radio => radio.value === "customer");
    customerRadio.checked = true;
    await customerRadio.dispatch("change", { target: customerRadio });
    selectedType = "customer";
    assert.equal(authorizationCalls, 1, "Customer Purchase Report retains selection-time Administrator authorization");
    await ids.exportReportBtn.dispatch("click");
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(workbooks, 2, "Administrator grant permits Customer Purchase Report export");

    radios.forEach(radio => { radio.checked = false; });
    const billSummaryRadio = radios.find(radio => radio.value === "billSummary");
    billSummaryRadio.checked = true;
    selectedType = "billSummary";
    await billSummaryRadio.dispatch("change", { target: billSummaryRadio });
    assert.equal(authorizationCalls, 2, "Bill Summary Report retains selection-time Administrator authorization");
    await ids.exportReportBtn.dispatch("click");
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(workbooks, 3, "Administrator grant permits Bill Summary Report export");
    radios.forEach(radio => { radio.checked = false; });
    supplierRadio.checked = true;
    selectedType = "supplierAccounts";
    await supplierRadio.dispatch("change", { target: supplierRadio });
    assert.equal(authorizationCalls, 2, "switching from a cached protected-report grant to Supplier Accounts requests no authorization");
    await ids.exportReportBtn.dispatch("click");
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(workbooks, 4, "Supplier export after a protected report does not reuse a grant and proceeds without one");

    const appSource = fs.readFileSync(path.join(__dirname, "../src/renderer/app.js"), "utf8");
    assert.match(appSource, /getAuthorizationRole\(purpose\)/);
    assert.match(appSource, /role !== "ADMINISTRATOR" && role !== "MANAGER"/);
    assert.match(appSource, /adminDialog\.style\.display = "flex"/);
    const preloadSource = fs.readFileSync(path.join(__dirname, "../src/main/preload.js"), "utf8");
    assert.match(preloadSource, /exportReport:\s*\(request, grant\)\s*=>\s*ipcRenderer\.invoke\([\s\S]{0,100}"export-report",\s*request,\s*grant/s);
    const mainSource = fs.readFileSync(path.join(__dirname, "../src/main/main.js"), "utf8");
    assert.doesNotMatch(mainSource, /request\.reportType\s*===\s*"supplierAccounts"[\s\S]{0,140}requireSecurityGrant/);
    assert.equal(AUTHORIZATION_POLICY.SUPPLIER_ACCOUNTS_REPORT_EXPORT, undefined, "Supplier report purpose removed from canonical authorization policy");
    assert.equal(ADMIN_PIN_AUDIT_POLICY.SUPPLIER_ACCOUNTS_REPORT_EXPORT, undefined, "Supplier report purpose removed from authorization audit policy");
    assert.equal(AUTHORIZATION_POLICY.CUSTOMER_REPORT_EXPORT, AUTHORIZATION_LEVELS.ADMINISTRATOR);
    assert.equal(AUTHORIZATION_POLICY.BILL_SUMMARY_REPORT_EXPORT, AUTHORIZATION_LEVELS.ADMINISTRATOR);
    const html = fs.readFileSync(path.join(__dirname, "../src/renderer/index.html"), "utf8");
    assert.match(html, /🏭 Supplier Accounts Report[\s\S]{0,100}Supplier Financial Activity &amp; Outstanding/);
    assert.match(html, /🔒 Customer Purchase Report[\s\S]{0,100}Administrator Access Required/);
    assert.match(html, /🔒 Bill Summary Report[\s\S]{0,100}Administrator Access Required/);
}

async function qualifyExactJpsAndDoraReconciliation() {
    const db=new sqlite3.Database(":memory:");
    try {
        await exec(db,`CREATE TABLE supplier_master(id INTEGER PRIMARY KEY,supplier_code TEXT,name TEXT,status TEXT);
            CREATE TABLE supplier_opening_balances(id INTEGER PRIMARY KEY,opening_code TEXT,store_id INTEGER,supplier_id INTEGER,supplier_code_snapshot TEXT,supplier_name_snapshot TEXT,as_on_date TEXT,due_date TEXT,reference TEXT,amount_paise INTEGER,status TEXT);
            CREATE TABLE supplier_invoices(id INTEGER PRIMARY KEY,invoice_code TEXT,store_id INTEGER,supplier_id INTEGER,supplier_code_snapshot TEXT,supplier_name_snapshot TEXT,supplier_invoice_number TEXT,supplier_invoice_date TEXT,posting_date TEXT,business_segment TEXT,capture_mode TEXT,total_quantity INTEGER,due_date TEXT,invoice_total_paise INTEGER,status TEXT);
            CREATE TABLE supplier_payments(id INTEGER PRIMARY KEY,payment_code TEXT,store_id INTEGER,supplier_id INTEGER,supplier_code_snapshot TEXT,supplier_name_snapshot TEXT,payment_date TEXT,posting_date TEXT,payment_mode TEXT,reference TEXT,amount_paise INTEGER,status TEXT);
            CREATE TABLE supplier_credit_notes(id INTEGER PRIMARY KEY,credit_note_code TEXT,store_id INTEGER,supplier_id INTEGER,supplier_code_snapshot TEXT,supplier_name_snapshot TEXT,credit_note_date TEXT,posting_date TEXT,external_number TEXT,reference TEXT,reason TEXT,amount_paise INTEGER,status TEXT);
            CREATE TABLE supplier_payment_allocations(id INTEGER PRIMARY KEY,payment_id INTEGER,invoice_id INTEGER,amount_paise INTEGER);
            CREATE TABLE supplier_payment_opening_allocations(id INTEGER PRIMARY KEY,payment_id INTEGER,opening_balance_id INTEGER,amount_paise INTEGER);
            CREATE TABLE supplier_credit_note_invoice_allocations(id INTEGER PRIMARY KEY,credit_note_id INTEGER,invoice_id INTEGER,amount_paise INTEGER);
            CREATE TABLE supplier_credit_note_opening_allocations(id INTEGER PRIMARY KEY,credit_note_id INTEGER,opening_balance_id INTEGER,amount_paise INTEGER);
            INSERT INTO supplier_master VALUES(1,'KLSUP000001','JPS & CO','ACTIVE'),(2,'KLSUP000002','Dora Distributors','ACTIVE');
            INSERT INTO supplier_opening_balances VALUES(1,'KLSOB000001',1,1,'KLSUP000001','JPS & CO','2026-10-08',NULL,NULL,2000000,'POSTED');
            INSERT INTO supplier_opening_balances VALUES(2,'KLSOB000002',1,2,'KLSUP000002','Dora Distributors','2026-10-01',NULL,NULL,500000,'POSTED');
            INSERT INTO supplier_payments VALUES(1,'KLSPAY000001',1,1,'KLSUP000001','JPS & CO','2026-10-08','2026-10-08','UPI','Owner payment',500000,'POSTED');
            INSERT INTO supplier_payment_opening_allocations VALUES(1,1,1,500000);`);
        const service=createSupplierAccountsReportService(db,{storeIdentityService:{getCurrentStore:async()=>({id:1,storeCode:"KL001",storeName:"Kaira Luxe",status:"ACTIVE"})}});
        return await service.getSupplierAccountsReportData("2026-10-01","2026-10-08");
    } finally { await close(db); }
}

async function main() {
    const db = new sqlite3.Database(":memory:");
    const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "klbs-supplier-report-")), "supplier.xlsx");
    try {
        await exec(db, `
            CREATE TABLE stores(id INTEGER PRIMARY KEY,store_code TEXT,store_name TEXT,status TEXT);
            CREATE TABLE store_context(id INTEGER PRIMARY KEY,current_store_id INTEGER);
            INSERT INTO stores VALUES(1,'KL001','Kaira Luxe','ACTIVE');
            INSERT INTO stores VALUES(2,'KL002','Other Store','ACTIVE');
            INSERT INTO store_context VALUES(1,1);
            CREATE TABLE supplier_master(id INTEGER PRIMARY KEY,supplier_code TEXT,name TEXT,status TEXT);
            CREATE TABLE supplier_opening_balances(id INTEGER PRIMARY KEY,opening_code TEXT,store_id INTEGER,supplier_id INTEGER,supplier_code_snapshot TEXT,supplier_name_snapshot TEXT,as_on_date TEXT,due_date TEXT,reference TEXT,amount_paise INTEGER,status TEXT);
            CREATE TABLE supplier_invoices(id INTEGER PRIMARY KEY,invoice_code TEXT,store_id INTEGER,supplier_id INTEGER,supplier_code_snapshot TEXT,supplier_name_snapshot TEXT,supplier_invoice_number TEXT,supplier_invoice_date TEXT,posting_date TEXT,business_segment TEXT,capture_mode TEXT,total_quantity INTEGER,due_date TEXT,invoice_total_paise INTEGER,status TEXT);
            CREATE TABLE supplier_payments(id INTEGER PRIMARY KEY,payment_code TEXT,store_id INTEGER,supplier_id INTEGER,supplier_code_snapshot TEXT,supplier_name_snapshot TEXT,payment_date TEXT,posting_date TEXT,payment_mode TEXT,reference TEXT,amount_paise INTEGER,status TEXT);
            CREATE TABLE supplier_credit_notes(id INTEGER PRIMARY KEY,credit_note_code TEXT,store_id INTEGER,supplier_id INTEGER,supplier_code_snapshot TEXT,supplier_name_snapshot TEXT,credit_note_date TEXT,posting_date TEXT,external_number TEXT,reference TEXT,reason TEXT,amount_paise INTEGER,status TEXT);
            CREATE TABLE supplier_payment_allocations(id INTEGER PRIMARY KEY,payment_id INTEGER,invoice_id INTEGER,amount_paise INTEGER);
            CREATE TABLE supplier_payment_opening_allocations(id INTEGER PRIMARY KEY,payment_id INTEGER,opening_balance_id INTEGER,amount_paise INTEGER);
            CREATE TABLE supplier_credit_note_invoice_allocations(id INTEGER PRIMARY KEY,credit_note_id INTEGER,invoice_id INTEGER,amount_paise INTEGER);
            CREATE TABLE supplier_credit_note_opening_allocations(id INTEGER PRIMARY KEY,credit_note_id INTEGER,opening_balance_id INTEGER,amount_paise INTEGER);
        `);
        const suppliers = [
            [1, "KLSUP000001", "Historical Due", "ACTIVE"],
            [2, "KLSUP000002", "Opening Only", "INACTIVE"],
            [3, "KLSUP000003", "Not Yet Due", "ACTIVE"],
            [4, "KLSUP000004", "Cleared", "ACTIVE"],
            [5, "KLSUP000005", "Future Only", "ACTIVE"],
            [6, "KLSUP000006", "In-period Opening", "ACTIVE"],
            [7, "KLSUP000007", "Opening on Start", "ACTIVE"],
            [8, "KLSUP000008", "Opening After End", "ACTIVE"],
            [9, "KLSUP000009", "Invoice No Due Date", "ACTIVE"]
        ];
        for (const row of suppliers) await run(db, "INSERT INTO supplier_master VALUES(?,?,?,?)", row);
        await run(db, "INSERT INTO supplier_opening_balances VALUES(1,'KLSOB000001',1,2,'KLSUP000002','Opening Only','2026-09-30','2026-10-30','Old balance',200000,'POSTED')");
        await run(db, "INSERT INTO supplier_invoices VALUES(1,'KLSINV000001',1,1,'KLSUP000001','Historical Due','A-1','2026-10-02','2026-10-02','MENS','SUMMARY',45,'2026-10-05',1000000,'POSTED')");
        await run(db, "INSERT INTO supplier_invoices VALUES(2,'KLSINV000002',1,3,'KLSUP000003','Not Yet Due','C-1','2026-10-03','2026-10-03','KL','DETAILED',2,'2026-10-30',500000,'POSTED')");
        await run(db, "INSERT INTO supplier_invoices VALUES(3,'KLSINV000003',1,4,'KLSUP000004','Cleared','D-1','2026-10-04','2026-10-04','KIDS','DETAILED',1,'2026-10-06',400000,'POSTED')");
        await run(db, "INSERT INTO supplier_invoices VALUES(4,'KLSINV000004',1,5,'KLSUP000005','Future Only','F-1','2026-10-15','2026-10-15','KL','SUMMARY',3,'2026-11-01',900000,'POSTED')");
        await run(db, "INSERT INTO supplier_invoices VALUES(5,'KLSINV000005',2,1,'KLSUP000001','Historical Due','OTHER-STORE','2026-10-02','2026-10-02','KL','SUMMARY',7,'2026-10-05',999999,'POSTED')");
        await run(db, "INSERT INTO supplier_payments VALUES(1,'KLSPAY000001',1,4,'KLSUP000004','Cleared','2026-10-07','2026-10-07','UPI','PAY-1',400000,'POSTED')");
        await run(db, "INSERT INTO supplier_payment_allocations VALUES(1,1,3,400000)");
        await run(db, "INSERT INTO supplier_payments VALUES(2,'KLSPAY000002',1,1,'KLSUP000001','Historical Due','2026-10-15','2026-10-15','CASH','FUTURE-PAY',400000,'POSTED')");
        await run(db, "INSERT INTO supplier_payment_allocations VALUES(2,2,1,400000)");
        await run(db, "INSERT INTO supplier_credit_notes VALUES(1,'KLSCN000001',1,1,'KLSUP000001','Historical Due','2026-10-15','2026-10-15','CN-FUTURE',NULL,'Future reduction',100000,'POSTED')");
        await run(db, "INSERT INTO supplier_credit_note_invoice_allocations VALUES(1,1,1,100000)");
        await run(db, "INSERT INTO supplier_credit_notes VALUES(2,'KLSCN000002',2,1,'KLSUP000001','Historical Due','2026-10-08','2026-10-08','OTHER-CN',NULL,'Other Store',90000,'POSTED')");

        const reportService = createSupplierAccountsReportService(db, { storeIdentityService: { getCurrentStore: async () => ({ id: 1, storeCode: "KL001", storeName: "Kaira Luxe", status: "ACTIVE" }) } });
        const data = await reportService.getSupplierAccountsReportData("2026-10-01", "2026-10-10");
        assert.deepStrictEqual(data.suppliers.map(row => row.supplierCode), ["KLSUP000001", "KLSUP000002", "KLSUP000003", "KLSUP000004"], "overview includes as-of historical accounts, excludes future-only and other-store-only facts");
        const byCode = Object.fromEntries(data.suppliers.map(row => [row.supplierCode, row]));
        assert.equal(byCode.KLSUP000001.currentOutstandingPaise, 1000000, "future payment and Credit Note do not change historical cutoff");
        assert.equal(byCode.KLSUP000001.accountStatus, "OVERDUE", "overdue takes priority over due");
        assert.equal(byCode.KLSUP000001.totalPurchasesPaise, 1000000);
        assert.equal(byCode.KLSUP000001.totalPaidPaise, 0);
        assert.equal(byCode.KLSUP000001.totalCreditNotesPaise, 0);
        assert.equal(byCode.KLSUP000001.openInvoices, 1);
        assert.equal(byCode.KLSUP000001.overdueInvoices, 1);
        assert.equal(byCode.KLSUP000002.currentOutstandingPaise, 200000, "opening balance contributes to outstanding but not purchases");
        assert.equal(byCode.KLSUP000002.totalPurchasesPaise, 0);
        assert.equal(byCode.KLSUP000002.openingOutstandingPaise, 200000, "opening before fromDate remains in opening outstanding");
        assert.equal(byCode.KLSUP000002.openingBalancesPostedPaise, 0, "pre-period opening is not a period opening movement");
        assert.equal(byCode.KLSUP000002.accountStatus, "DUE");
        assert.equal(byCode.KLSUP000003.accountStatus, "DUE");
        assert.equal(byCode.KLSUP000004.accountStatus, "CLEARED");
        assert.equal(data.invoices.length, 3, "posting-date period includes only current-store invoices inclusive through end date");
        assert.equal(data.invoices[0].captureMode, "SUMMARY");
        assert.equal(data.invoices[0].totalQuantity, 45);
        assert.equal(data.payments.length, 1, "payment rows are not duplicated by allocations and future payment excluded");
        assert.equal(data.creditNotes.length, 0, "future and other-store Credit Notes excluded");
        assert.equal(data.outstanding.length, 3, "as-of liability details exclude settled and future liabilities");
        assert.equal(data.outstanding.find(row => row.supplierCode === "KLSUP000001").outstandingPaise, 1000000);
        for (const supplier of data.suppliers) {
            assert.equal(supplier.openingOutstandingPaise + supplier.openingBalancesPostedPaise + supplier.invoicesPostedPaise - supplier.creditNotesPaise - supplier.paymentsPaise, supplier.closingOutstandingPaise, "per-Supplier period reconciliation");
        }

        await exportSupplierAccountsReport(data, output);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(output);
        assert.deepStrictEqual(workbook.worksheets.map(sheet => sheet.name), ["SUPPLIER OVERVIEW", "SUMMARY", "INVOICES", "PAYMENTS", "CREDIT NOTES", "OUTSTANDING"], "exact six-sheet order");
        const overview = workbook.getWorksheet("SUPPLIER OVERVIEW");
        assert.equal(overview.getCell("B1").value, "Kaira Luxe");
        assert.equal(overview.getCell("B2").value, "KL001");
        assert.equal(overview.getCell("A10").value, "As Of");
        assert.equal(overview.getCell("A13").value, "KLSUP000001");
        assert.equal(overview.getCell("J13").value, "OVERDUE");
        assert.equal(overview.getCell("G13").value, 10000, "money remains a numeric Excel cell");
        assert.equal(overview.getCell("G13").fill.fgColor.argb, "FFFCE5E5", "overdue outstanding has red semantic fill");
        assert.equal(overview.getCell("I13").fill.fgColor.argb, "FFFCE5E5", "nonzero overdue invoice count is red");
        assert.equal(overview.getCell("J13").fill.fgColor.argb, "FFFCE5E5");
        assert.equal(overview.getCell("J14").value, "DUE");
        assert.equal(overview.getCell("G14").fill.fgColor.argb, "FFFFF1D6", "non-overdue due balance is amber");
        assert.equal(overview.getCell("H15").fill.fgColor.argb, "FFFFF1D6", "open invoice count is amber when not overdue");
        assert.equal(overview.getCell("J16").value, "CLEARED");
        assert.equal(overview.getCell("G16").fill.fgColor.argb, "FFE5F2E8", "cleared balance is green");
        assert.equal(overview.getCell("E16").fill.fgColor.argb, "FFE5F2E8", "Total Paid is green");
        assert.equal(overview.getCell("F13").fill.fgColor.argb, "FFE6F0FA", "Credit Notes use blue semantic treatment");
        assert.equal(overview.getCell("J17").value, null, "TOTAL account status stays blank");
        assert.equal(overview.getCell("J17").fill.fgColor.argb, "FF4F3428", "TOTAL row has report total styling, no account status fill");
        assert.equal(overview.getCell("D17").value, 19000, "overview total purchases is numeric and reconciled");
        const summary = workbook.getWorksheet("SUMMARY");
        assert.equal(summary.getCell("A10").value, "Report Period");
        assert.equal(summary.getCell("E12").value, "OPENING BALANCES POSTED");
        assert.equal(summary.getCell("E17").value, 0, "pre-period opening is not included in period-opening total");
        assert.equal(summary.getCell("I17").value, 17000, "summary total closing outstanding includes opening liability");
        assert.equal(workbook.getWorksheet("INVOICES").getCell("H13").value, "SUMMARY", "capture mode is explicit and tax/product details are not fabricated");
        assert.equal(workbook.getWorksheet("INVOICES").getCell("K13").value, 10000);
        assert.equal(workbook.getWorksheet("OUTSTANDING").getCell("L13").value, "1–30 DAYS OVERDUE", "aging is relative to report end date");

        await run(db, "INSERT INTO supplier_opening_balances VALUES(2,'KLSOB000002',1,6,'KLSUP000006','JPS & CO','2026-10-08',NULL,NULL,2000000,'POSTED')");
        await run(db, "INSERT INTO supplier_payments VALUES(3,'KLSPAY000003',1,6,'KLSUP000006','Owner Repro','2026-10-08','2026-10-08','UPI','Owner retest payment',500000,'POSTED')");
        await run(db, "INSERT INTO supplier_payment_opening_allocations VALUES(2,3,2,500000)");
        await run(db, "INSERT INTO supplier_opening_balances VALUES(3,'KLSOB000003',1,7,'KLSUP000007','Dora Distributors','2026-10-01',NULL,NULL,500000,'POSTED')");
        await run(db, "INSERT INTO supplier_opening_balances VALUES(4,'KLSOB000004',1,8,'KLSUP000008','Opening After End','2026-10-09',NULL,'After boundary',300000,'POSTED')");
        await run(db, "INSERT INTO supplier_invoices VALUES(6,'KLSINV000006',1,9,'KLSUP000009','Invoice No Due Date','NULL-DUE','2026-10-07','2026-10-07','KL','SUMMARY',1,NULL,25000,'POSTED')");
        const ownerCaseCountsBefore = await all(db, `SELECT
            (SELECT COUNT(*) FROM supplier_opening_balances WHERE supplier_id=6) openings,
            (SELECT COUNT(*) FROM supplier_invoices WHERE supplier_id=6) invoices,
            (SELECT COUNT(*) FROM supplier_payments WHERE supplier_id=6) payments,
            (SELECT COUNT(*) FROM supplier_credit_notes WHERE supplier_id=6) credits`);
        const ownerData = await reportService.getSupplierAccountsReportData("2026-10-01", "2026-10-08");
        const ownerRows = Object.fromEntries(ownerData.suppliers.map(row => [row.supplierCode, row]));
        assert.deepStrictEqual(ownerData.suppliers.map(row => row.supplierCode), ["KLSUP000001", "KLSUP000002", "KLSUP000003", "KLSUP000004", "KLSUP000006", "KLSUP000007", "KLSUP000009"], "opening on fromDate/toDate is included; after toDate is excluded");
        const ownerRow = ownerRows.KLSUP000006;
        assert.deepStrictEqual({
            openingOutstandingPaise: ownerRow.openingOutstandingPaise,
            openingBalancesPostedPaise: ownerRow.openingBalancesPostedPaise,
            invoicesPostedPaise: ownerRow.invoicesPostedPaise,
            creditNotesPaise: ownerRow.creditNotesPaise,
            paymentsPaise: ownerRow.paymentsPaise,
            closingOutstandingPaise: ownerRow.closingOutstandingPaise
        }, { openingOutstandingPaise: 0, openingBalancesPostedPaise: 2000000, invoicesPostedPaise: 0, creditNotesPaise: 0, paymentsPaise: 500000, closingOutstandingPaise: 1500000 }, "KLSUP000001-equivalent operands reconcile in integer paise");
        assert.equal(0 + 2000000 + 0 - 0 - 500000, 1500000, "approved exact equation: 0 + 20,000 + 0 - 0 - 5,000 = 15,000");
        assert.equal(ownerRow.totalPurchasesPaise, 0, "opening movement never contributes to purchases");
        assert.equal(ownerRow.openInvoices, 0, "opening liability never contributes to open invoice count");
        assert.equal(ownerRows.KLSUP000007.openingOutstandingPaise, 0);
        assert.equal(ownerRows.KLSUP000007.openingBalancesPostedPaise, 500000, "opening on fromDate is included");
        assert.equal(ownerRows.KLSUP000008, undefined, "opening after toDate is excluded");
        assert.equal(ownerRows.KLSUP000007.openingOutstandingPaise, 0);
        assert.equal(ownerRows.KLSUP000007.currentOutstandingPaise, 500000, "Dora remains outstanding by the full opening liability");
        assert.equal(ownerRows.KLSUP000006.currentOutstandingPaise + ownerRows.KLSUP000007.currentOutstandingPaise, 2000000, "JPS and Dora aggregate closing outstanding is ₹20,000");
        assert.equal(ownerRows.KLSUP000006.openingBalancesPostedPaise + ownerRows.KLSUP000007.openingBalancesPostedPaise, 2500000, "JPS and Dora aggregate posted openings are ₹25,000");
        assert.equal(ownerRows.KLSUP000006.paymentsPaise + ownerRows.KLSUP000007.paymentsPaise, 500000, "JPS and Dora aggregate payments are ₹5,000");
        assert.equal(ownerRows.KLSUP000007.totalPurchasesPaise, 0);
        assert.equal(ownerRows.KLSUP000007.openInvoices, 0);
        assert.equal(ownerRow.currentOutstandingPaise, 1500000, "historical allocation cutoff applies payment posted through toDate");
        assert.equal(ownerData.invoices.some(row => row.captureMode === "SUMMARY"), true);
        assert.equal(ownerData.invoices.some(row => row.captureMode === "DETAILED"), true);
        const openingOutputRow = ownerData.outstanding.find(row => row.documentId === "KLSOB000002");
        assert.equal(openingOutputRow.documentReference, "", "opening with no reference remains blank in report data");
        assert.equal(openingOutputRow.agingStatus, "NO DUE DATE", "Opening Outstanding NULL Due Date does not infer aging from as_on_date");
        const nullDueInvoice = ownerData.outstanding.find(row => row.documentId === "KLSINV000006");
        assert.equal(nullDueInvoice.agingStatus, "NO DUE DATE", "invoice NULL Due Date does not enter an overdue bucket");
        assert.equal(ownerData.outstanding.find(row => row.documentId === "KLSINV000001").agingStatus, "1–30 DAYS OVERDUE", "genuine overdue due date retains its aging bucket");
        assert.equal(ownerData.outstanding.find(row => row.documentId === "KLSINV000002").agingStatus, "NOT YET DUE", "genuine future due date retains its aging state");
        const ownerOutput = path.join(path.dirname(output), "owner-opening.xlsx");
        await exportSupplierAccountsReport(ownerData, ownerOutput);
        const ownerWorkbook = new ExcelJS.Workbook();
        await ownerWorkbook.xlsx.readFile(ownerOutput);
        assert.deepStrictEqual(ownerWorkbook.worksheets.map(sheet => sheet.name), ["SUPPLIER OVERVIEW", "SUMMARY", "INVOICES", "PAYMENTS", "CREDIT NOTES", "OUTSTANDING"], "six worksheets retain exact order");
        const ownerSummary = ownerWorkbook.getWorksheet("SUMMARY");
        const ownerSummaryHeader = ownerSummary.getRow(12).values;
        assert.ok(ownerSummaryHeader.includes("OPENING BALANCES POSTED"));
        const openingColumn = ownerSummaryHeader.indexOf("OPENING BALANCES POSTED");
        const closingColumn = ownerSummaryHeader.indexOf("CLOSING OUTSTANDING");
        const ownerExcelRow = ownerSummary.getRows(13, ownerSummary.rowCount - 13).find(row => row.getCell(1).value === "KLSUP000006");
        assert.equal(ownerExcelRow.getCell(openingColumn).value, 20000);
        assert.equal(ownerExcelRow.getCell(openingColumn).numFmt, '"₹"#,##0.00;[Red]("₹"#,##0.00);-');
        assert.equal(ownerExcelRow.getCell(closingColumn).value, 15000);
        const ownerTotal = ownerSummary.getRow(ownerSummary.rowCount);
        assert.equal(ownerTotal.getCell(openingColumn).value, 25000, "Summary TOTAL aggregates in-period openings numerically");
        assert.equal(ownerTotal.getCell(openingColumn).numFmt, '"₹"#,##0.00;[Red]("₹"#,##0.00);-', "currency format survives save/reload");
        const outstandingSheet = ownerWorkbook.getWorksheet("OUTSTANDING");
        const openingExcelRow = outstandingSheet.getRows(13, outstandingSheet.rowCount - 12).find(row => row.getCell(4).value === "KLSOB000002");
        assert(openingExcelRow, "Opening liability row exists in saved XLSX");
        assert([null, ""].includes(openingExcelRow.getCell(5).value), `saved XLSX DOCUMENT / REFERENCE is blank (actual=${String(openingExcelRow.getCell(5).value)})`);
        assert.equal(openingExcelRow.getCell(8).value, null, "saved XLSX Due Date remains blank");
        assert.equal(openingExcelRow.getCell(12).value, "NO DUE DATE");
        const nullDueExcelRow = outstandingSheet.getRows(13, outstandingSheet.rowCount - 12).find(row => row.getCell(4).value === "KLSINV000006");
        assert.equal(nullDueExcelRow.getCell(12).value, "NO DUE DATE");
        assert.deepEqual(await all(db, `SELECT o.id,o.opening_code,o.as_on_date,o.amount_paise,p.id payment_id,p.payment_code,p.posting_date,a.amount_paise allocation_paise
            FROM supplier_opening_balances o JOIN supplier_payment_opening_allocations a ON a.opening_balance_id=o.id
            JOIN supplier_payments p ON p.id=a.payment_id WHERE o.supplier_id=6 ORDER BY p.id`), [
            { id: 2, opening_code: "KLSOB000002", as_on_date: "2026-10-08", amount_paise: 2000000, payment_id: 3, payment_code: "KLSPAY000003", posting_date: "2026-10-08", allocation_paise: 500000 }
        ]);
        assert.deepEqual(await all(db, `SELECT
            (SELECT COUNT(*) FROM supplier_opening_balances WHERE supplier_id=6) openings,
            (SELECT COUNT(*) FROM supplier_invoices WHERE supplier_id=6) invoices,
            (SELECT COUNT(*) FROM supplier_payments WHERE supplier_id=6) payments,
            (SELECT COUNT(*) FROM supplier_credit_notes WHERE supplier_id=6) credits`), ownerCaseCountsBefore, "report generation does not mutate Supplier financial facts");

        const exactOwnerCases=await qualifyExactJpsAndDoraReconciliation();
        const exactRows=Object.fromEntries(exactOwnerCases.suppliers.map(row=>[row.supplierCode,row]));
        assert.deepStrictEqual([exactRows.KLSUP000001.openingOutstandingPaise,exactRows.KLSUP000001.openingBalancesPostedPaise,exactRows.KLSUP000001.invoicesPostedPaise,exactRows.KLSUP000001.creditNotesPaise,exactRows.KLSUP000001.paymentsPaise,exactRows.KLSUP000001.closingOutstandingPaise],[0,2000000,0,0,500000,1500000],"real JPS & CO period operands exactly reconcile");
        assert.equal(exactRows.KLSUP000001.openingOutstandingPaise+exactRows.KLSUP000001.openingBalancesPostedPaise+exactRows.KLSUP000001.invoicesPostedPaise-exactRows.KLSUP000001.creditNotesPaise-exactRows.KLSUP000001.paymentsPaise,1500000);
        assert.equal(exactRows.KLSUP000002.openingBalancesPostedPaise,500000,"Dora in-period opening is ₹5,000");
        assert.equal(exactRows.KLSUP000002.closingOutstandingPaise,500000,"Dora closing is ₹5,000");
        assert.equal(exactOwnerCases.suppliers.reduce((sum,row)=>sum+row.openingBalancesPostedPaise,0),2500000,"aggregate in-period openings are ₹25,000");
        assert.equal(exactOwnerCases.suppliers.reduce((sum,row)=>sum+row.paymentsPaise,0),500000,"aggregate payments are ₹5,000");
        assert.equal(exactOwnerCases.suppliers.reduce((sum,row)=>sum+row.closingOutstandingPaise,0),2000000,"aggregate closing outstanding is ₹20,000");
        assert.equal(exactRows.KLSUP000001.totalPurchasesPaise,0);assert.equal(exactRows.KLSUP000001.openInvoices,0,"opening never contributes to Purchases or Open Invoices");

        assert.equal(AUTHORIZATION_POLICY.SUPPLIER_ACCOUNTS_REPORT_EXPORT, undefined);
        assert.equal(ADMIN_PIN_AUDIT_POLICY.SUPPLIER_ACCOUNTS_REPORT_EXPORT, undefined);
        assert.equal(AUTHORIZATION_POLICY.SUPPLIER_INVOICE_POST, AUTHORIZATION_LEVELS.MANAGER);
        const mainSource = fs.readFileSync(path.join(__dirname, "../src/main/main.js"), "utf8");
        assert.doesNotMatch(mainSource, /request\.reportType\s*===\s*"supplierAccounts"[\s\S]{0,140}requireSecurityGrant/);
        const rendererSource = fs.readFileSync(path.join(__dirname, "../src/renderer/modules/reports.js"), "utf8");
        assert.match(rendererSource, /supplierAccounts:[\s\S]*?adminOnly:\s*false/);
        assert.doesNotMatch(rendererSource, /supplierAccounts:[\s\S]{0,350}authorizationPurpose/);
        await exec(db, `CREATE TABLE settings(id INTEGER PRIMARY KEY,admin_pin_hash TEXT,admin_security_initialized INTEGER,manager_pin_hash TEXT,manager_security_initialized INTEGER)`);
        await run(db, "INSERT INTO settings VALUES(1,?,1,?,1)", [await hashCredential("2468"), await hashCredential("1357")]);
        const security = createAdministratorSecurityService(db, { logEvent: async () => {} });
        await qualifyRendererAuthorizationFlow(security);
        process.stdout.write("V21-09 Supplier Accounts Report historical/workbook/auth contracts: PASS; in-period Opening Outstanding movement reconciles and exports\n");
    } finally {
        await close(db);
        fs.rmSync(path.dirname(output), { recursive: true, force: true });
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
