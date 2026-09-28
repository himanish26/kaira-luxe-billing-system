const assert = require("assert");
const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const root = path.join(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

const app = read("src/renderer/app.js");
const html = read("src/renderer/index.html");
const css = read("src/renderer/styles/billing.css");
const theme = read("src/renderer/styles/variables.css");
const dayService = read("src/database/dayClosingService.js");
const billService = read("src/database/billService.js");
const logService = read("src/database/logService.js");
const dayRenderer = read("src/renderer/modules/system/dayClosing.js");
const startup = read("src/renderer/startupSplash.js");
const reasons = require(path.join(root, "src/renderer/shared/dayReopenReasons.js"));

// Variable-Value modal structure and strong, opaque, accessible presentation.
assert.match(html, /class="custom-dialog-box variable-value-dialog-box"/);
assert.match(html, /id="variableValueProductName" class="variable-value-product-name"/);
assert.match(html, /id="variableValueAvailableStock" class="variable-value-available-stock"/);
assert.match(html, /id="variableValueQuantity" type="text" inputmode="numeric" min="1" max="99" step="1"/);
assert.match(html, /id="variableValueAmount" type="text" inputmode="numeric" min="1" max="9999" step="1"/);
assert.match(css, /\.variable-value-dialog-box\s*\{[^}]*background:\s*#fff\s*!important/s);
assert.match(css, /\.variable-value-dialog-box h2\s*\{[^}]*font-size:\s*25px[^}]*font-weight:\s*800/s);
assert.match(css, /\.variable-value-product-name\s*\{[^}]*font-size:\s*27px[^}]*font-weight:\s*800/s);
assert.match(css, /\.variable-value-dialog-box #variableValueError\s*\{[^}]*flex:\s*0 0 22px[^}]*height:\s*22px[^}]*min-height:\s*22px[^}]*max-height:\s*22px/s);
assert.match(css, /\.variable-value-product-name\s*\{[^}]*color:\s*var\(--primary\)/s);
assert.match(css, /\.variable-value-dialog-box label\s*\{[^}]*font-size:\s*18px[^}]*font-weight:\s*800/s);
assert.match(css, /\.variable-value-dialog-box input\s*\{[^}]*font-size:\s*22px/s);
assert.match(css, /\.variable-value-dialog-box input:focus\s*\{[^}]*border-color:\s*var\(--primary\)[^}]*outline:/s);
assert.match(css, /\.variable-value-dialog-box \.dialog-actions button\s*\{[^}]*min-height:\s*50px/s);
assert.match(css, /\.variable-value-dialog-box \.dialog-actions\s*\{[^}]*justify-content:\s*center/s);
assert.match(css, /\.variable-value-dialog-box #variableValueConfirmBtn\s*\{[^}]*background:\s*var\(--primary\)/s);
assert.match(theme, /--primary:\s*#8B004B/);
assert.match(theme, /--primary-dark:\s*#6D0033/);
assert.match(app, /productName\.textContent = product\.product_name/);
assert.match(app, /availableStockNode\.textContent = `Available stock: \$\{availableStock\}`/);

// Existing quantity/stock check stays before any cart mutation. A stock error
// remains in the modal, then focuses and selects the complete Quantity value.
const validatorStart = app.indexOf("function validateVariableValueEntry(");
const validatorEnd = app.indexOf("function showVariableValueDialog(", validatorStart);
const validator = app.slice(validatorStart, validatorEnd);
assert.match(validator, /if \(quantity > stock\)\s*\{\s*return\s*\{\s*field: "quantity",\s*error: `Insufficient stock/s);
assert.match(validator, /if \(quantity > 99\)[\s\S]*?Maximum Quantity is 99/);
assert.match(validator, /grossAmount > 9999[\s\S]*?₹1 to ₹9,999/);
const dialogStart = app.indexOf("function showVariableValueDialog(");
const dialogEnd = app.indexOf("function applyVariableValueEntry(", dialogStart);
const dialog = app.slice(dialogStart, dialogEnd);
assert(dialog.includes("errorNode.textContent = result.error"));
assert(dialog.includes("invalidInput.focus();"));
assert(dialog.includes("invalidInput.select();"));
assert(dialog.includes('if (event.target === qtyInput)'));
assert(dialog.includes("amountInput.focus();"));
const applyStart = app.indexOf("function applyVariableValueEntry(");
const applyEnd = app.indexOf("function ", applyStart + 10);
const apply = app.slice(applyStart, applyEnd);
const validationIndex = apply.indexOf("validateVariableValueEntry(");
const rejectedIndex = apply.indexOf("return false;", validationIndex);
const cartMutationIndex = apply.indexOf("billItems.push(");
assert(validationIndex >= 0 && rejectedIndex > validationIndex && cartMutationIndex > rejectedIndex,
    "rejected stock quantity returns before any cart mutation");
assert.match(app, /showInsufficientStockDialog\(product\.product_name, availableStock, Number\(entry\.quantity\) \|\| 0\);/);
assert.doesNotMatch(app, /double.?scan|scanner.?timing|barcode.?intercept/i);

// Day Re-open continues to persist its normalized selected reason, and now
// passes the same value to Activity Log after commit. Both routes remain wired.
assert.match(dayService, /reopen_reason = \?/);
assert.match(dayService, /await logReopenedFn\(businessDate, normalizedReason\)/);
assert.match(dayRenderer, /window\.electronAPI\.reopenBusinessDay\(grant, reason\)/);
assert.match(startup, /startupAPI\.reopenClosedDay\(\{ reason, pin \}\)/);
assert.deepStrictEqual(reasons.DAY_REOPEN_REASONS, [
    "Late Night Customer",
    "Payment Mode Correction",
    "Inventory Correction",
    "Other Operational Issue"
]);
assert.match(dayRenderer, /<select\s+id="dayReopenReasonInput"/);
assert.doesNotMatch(dayRenderer, /<textarea[^>]*dayReopenReasonInput/);
assert.match(logService, /const logBusinessDayReopened = \(date, reason\) => write\([\s\S]*?Business Day Reopened: \$\{date\} \| Reason: \$\{String\(reason \|\| ""\)\.trim\(\)\}/);

// Payment Correction still persists the required remarks and passes the same
// validated value to Activity Log without changing the correction transaction.
assert.match(billService, /INSERT INTO payment_corrections[\s\S]*?remarks,[\s\S]*?data\.remarks/);
assert.match(billService, /await logPaymentCorrected\([\s\S]*?data\.bill_no,[\s\S]*?data\.remarks/);
assert.match(logService, /const logPaymentCorrected = \(billNumber, reason\) => write\([\s\S]*?Bill \$\{billNumber\} \| Reason: \$\{String\(reason \|\| ""\)\.trim\(\)\}/);
assert.match(billService, /SET\s+cash_amount = \?,\s+upi_amount = \?,\s+card_amount = \?/);

// Previously complete reason workflows remain on their existing paths.
assert.match(logService, /RETURN_COMPLETED/);
assert.match(logService, /Return Reason: \$\{extra\.return_reason\}/);
assert.match(read("src/database/inventoryTransactionService.js"), /STOCK_INWARD/);
assert.match(read("src/database/inventoryTransactionService.js"), /STOCK_OUTWARD/);

(async () => {
    const capturedActivity = [];
    const logModule = { exports: {} };
    const loadLogService = new Function("require", "module", "exports", logService);
    loadLogService(request => request === "path"
        ? require("path")
        : { logActivity: async event => capturedActivity.push(event) }, logModule, logModule.exports);
    await logModule.exports.logBusinessDayReopened("2026-09-27", "Payment Mode Correction");
    await logModule.exports.logPaymentCorrected("KL280926002", "Cash entered instead of UPI");
    assert(capturedActivity[0].details.includes("2026-09-27"));
    assert(capturedActivity[0].details.includes("Reason: Payment Mode Correction"));
    assert(capturedActivity[1].details.includes("Bill KL280926002"));
    assert(capturedActivity[1].details.includes("Reason: Cash entered instead of UPI"));

    // Exercise the post-commit service callback using an in-memory SQLite DB.
    const db = new sqlite3.Database(":memory:");
    const exec = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, error => error ? reject(error) : resolve()));
    const get = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row)));
    await exec(`CREATE TABLE day_closing_snapshots (
        id INTEGER PRIMARY KEY, business_date TEXT, close_sequence INTEGER,
        close_status TEXT, reopened_at TEXT, reopened_by TEXT,
        reopen_reason TEXT, updated_at TEXT
    )`);
    await exec(`CREATE TABLE business_day_state (
        business_date TEXT PRIMARY KEY, state TEXT, closed_at TEXT, updated_at TEXT
    )`);
    await exec(`INSERT INTO day_closing_snapshots
        (id,business_date,close_sequence,close_status) VALUES (1,'2026-09-27',1,'CLOSED')`);
    await exec(`INSERT INTO business_day_state (business_date,state,updated_at)
        VALUES ('2026-09-27','CLOSED','before')`);
    let reopenLogArgs;
    const serviceModule = { exports: {} };
    const loadDayClosingService = new Function(
        "require", "module", "exports",
        read("src/database/dayClosingService.js")
    );
    loadDayClosingService(request => {
        if (request === "./dayClosingDsrService") return { readClosedDsrPayload: async () => null };
        if (request === "../services/dsrSyncService") return { createDsrSyncService: () => ({}) };
        if (request === "./businessDate") return { getBusinessDate: () => "2026-09-27", formatBusinessDateDisplay: value => value };
        if (request === "./dayClosingMigration") return { SNAPSHOT_VERSION: 1 };
        if (request === "../services/technicalLogger") return { error() {}, warn() {}, info() {} };
        if (request === "../services/dayClosingEmail") return { buildDayClosingEmailText: () => "" };
        throw new Error(`Unexpected Day Closing dependency: ${request}`);
    }, serviceModule, serviceModule.exports);
    const { createDayClosingService } = serviceModule.exports;
    const dayClosing = createDayClosingService({
        database: db,
        now: () => new Date("2026-09-28T06:00:00.000Z"),
        getBusinessDate: () => "2026-09-27",
        createBackup: async () => ({}),
        validateBackup: async () => ({ success: true }),
        sendEmail: async () => {},
        dsrSyncService: {},
        logBusinessDayReopened: async (...args) => { reopenLogArgs = args; }
    });
    const reopenResult = await dayClosing.reopenBusinessDay("Payment Mode Correction");
    assert.strictEqual(reopenResult.success, true);
    assert.deepStrictEqual(reopenLogArgs, ["2026-09-27", "Payment Mode Correction"]);
    assert.strictEqual((await get("SELECT reopen_reason FROM day_closing_snapshots WHERE id=1")).reopen_reason, "Payment Mode Correction");
    await new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
    console.log("VVP accessibility and Activity Log reason repair tests: PASS");
})().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
