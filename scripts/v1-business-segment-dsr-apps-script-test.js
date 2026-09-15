const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const vm = require("vm");

class FakeSheet {
    constructor(name) { this.name = name; this.rows = []; this.parent = null; }
    getName() { return this.name; }
    getLastRow() { return this.rows.length; }
    getLastColumn() { return this.rows.reduce((n, row) => Math.max(n, row.length), 0); }
    getParent() { return this.parent; }
    getRange(row, column, rowCount = 1, columnCount = 1) {
        const sheet = this;
        return {
            getValues() { return Array.from({ length: rowCount }, (_, r) => Array.from({ length: columnCount }, (_, c) => (sheet.rows[row - 1 + r] || [])[column - 1 + c] ?? "")); },
            setValues(values) { values.forEach((valuesRow, r) => { while (sheet.rows.length < row + r) sheet.rows.push([]); valuesRow.forEach((value, c) => { sheet.rows[row - 1 + r][column - 1 + c] = value; }); }); },
            setNumberFormat() {},
            setFrozenRows() {}
        };
    }
    appendRow(values) { this.rows.push(values.slice()); }
    setFrozenRows() {}
}

class FakeSpreadsheet {
    constructor() { this.sheets = {}; this.timeZone = "Asia/Kolkata"; }
    getSheetByName(name) { return this.sheets[name] || null; }
    insertSheet(name) { const sheet = new FakeSheet(name); sheet.parent = this; this.sheets[name] = sheet; return sheet; }
    getSpreadsheetTimeZone() { return this.timeZone; }
}

function loadAppsScript() {
    const source = fs.readFileSync("deployment/google-apps-script/KLBS_DSR_WebApp.gs", "utf8") + "\n" + fs.readFileSync("deployment/google-apps-script/KLBS_Segment_DSR_WebApp.gs", "utf8");
    const spreadsheet = new FakeSpreadsheet();
    const context = {
        Date, JSON, Math, Number, String, Object, Array, isFinite, isNaN,
        PropertiesService: { getScriptProperties: () => ({ getProperty: key => key === "KLBS_SPREADSHEET_ID" ? "test-sheet" : key === "KLBS_DSR_SYNC_SECRET" ? "test-secret" : null }) },
        SpreadsheetApp: { openById: () => spreadsheet },
        LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
        ContentService: { MimeType: { JSON: "application/json" }, createTextOutput: body => ({ getContent: () => body, setMimeType() { return this; } }) },
        Utilities: { computeHmacSha256Signature: (text, secret) => Array.from(crypto.createHmac("sha256", secret).update(text, "utf8").digest()), formatDate: (value, zone, format) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(value) },
        Session: { getScriptTimeZone: () => "Asia/Kolkata" },
        console
    };
    vm.createContext(context);
    vm.runInContext(source, context);
    return { context, spreadsheet };
}

function payload(date, sequence = 1) {
    const segment = (label, sales, qty, bills, atv, upt) => ({ label, sales, qty, bills, atv, upt, detail: { grossSales: Math.abs(sales), discountAmount: 0, taxableValue: Math.abs(sales), gstAmount: 0, netBilling: Math.max(sales, 0), qtySold: Math.max(qty, 0), returnValue: sales < 0 ? Math.abs(sales) : 0, qtyReturned: qty < 0 ? Math.abs(qty) : 0 } });
    return { contract: "KLBS_SEGMENT_DSR_V1", businessDate: date, closeSequence: sequence, reportStatus: sequence === 1 ? "FINAL" : "REVISED", segments: { KL: segment("Kaira Luxe", 100, 1, 1, 100, 1), MENS: segment("Mens Wear", 200, 2, 1, 200, 2), KIDS: segment("Kids Wear", 300, 3, 1, 300, 3) }, dataQuality: { complete: true, reconciliationClassified: true, diagnostics: null }, reconciliation: {}, klbsVersion: "1.0.0", generatedAt: new Date().toISOString() };
}

function request(context, value, timestamp = new Date().toISOString(), secret = "test-secret", signingValue = value) {
    const canonical = context.segmentDsrCanonicalPayloadJson_(signingValue);
    const signature = crypto.createHmac("sha256", secret).update(`${timestamp}\n${value.businessDate}\n${canonical}`, "utf8").digest("hex");
    const response = context.doPost({ postData: { type: "application/json", contents: JSON.stringify({ timestamp, payload: value, signature }) } });
    return JSON.parse(response.getContent());
}

function main() {
    const { context, spreadsheet } = loadAppsScript();
    const firstPayload = payload("2026-09-15");
    let result = request(context, firstPayload);
    assert.deepStrictEqual({ ok: result.ok, action: result.action, authoritative: result.authoritative }, { ok: true, action: "INSERTED", authoritative: true });
    const sheet = spreadsheet.getSheetByName("KLBS_Segment_Daily_Data");
    assert.deepStrictEqual(sheet.rows[0].slice(0, 5), ["Received At", "Contract", "Business Date", "Close Sequence", "Report Status"]);
    assert.strictEqual(sheet.getLastRow(), 2);
    result = request(context, firstPayload);
    assert.strictEqual(result.action, "UNCHANGED", JSON.stringify(result));
    assert.strictEqual(sheet.getLastRow(), 2);
    const conflict = payload("2026-09-15"); conflict.segments.KL.sales = 101;
    assert(String(request(context, conflict).error).includes("immutable-contract conflict"));
    result = request(context, payload("2026-09-15", 2));
    assert.strictEqual(result.action, "INSERTED");
    assert.strictEqual(sheet.getLastRow(), 3);
    const outOfOrder = request(context, payload("2026-09-16", 2));
    assert.strictEqual(outOfOrder.authoritative, true);
    assert.strictEqual(request(context, payload("2026-09-16", 1)).action, "RETAINED");
    const negative = payload("2026-09-17");
    negative.segments.KL = { label: "Kaira Luxe", sales: -100, qty: -2, bills: 0, atv: 0, upt: 0, detail: { grossSales: 0, discountAmount: 0, taxableValue: 0, gstAmount: 0, netBilling: 0, qtySold: 0, returnValue: 100, qtyReturned: 2 } };
    assert.strictEqual(request(context, negative).ok, true);
    const badSignature = request(context, payload("2026-09-18"), new Date().toISOString(), "wrong-secret");
    assert(String(badSignature.error).includes("authentication failed"));
    assert(String(request(context, payload("2026-09-19"), new Date(Date.now() - 6 * 60 * 1000).toISOString()).error).includes("replay window"));
    const unknown = payload("2026-09-20"); unknown.contract = "OTHER_V1";
    assert(String(request(context, unknown, new Date().toISOString(), "test-secret", payload("2026-09-20")).error).length > 0);
    const missing = payload("2026-09-21"); delete missing.segments.KIDS;
    assert(String(request(context, missing, new Date().toISOString(), "test-secret", payload("2026-09-21")).error).includes("exactly KL, MENS, and KIDS"));
    const incomplete = payload("2026-09-22"); incomplete.dataQuality.complete = false;
    assert(String(request(context, incomplete).error).includes("data quality"));
    const nonNumeric = payload("2026-09-23"); nonNumeric.segments.MENS.sales = NaN;
    assert(String(request(context, nonNumeric).error).includes("Invalid numeric field"));
    assert.strictEqual(spreadsheet.getSheetByName("Form responses 1"), null);
    assert.strictEqual(spreadsheet.getSheetByName("KLBS_Daily_Data"), null);
    console.log("Business Segment Apps Script receiver tests: PASS");
}

try { main(); } catch (error) { console.error(error.stack || error.message); process.exitCode = 1; }
