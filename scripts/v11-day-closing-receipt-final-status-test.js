const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const mainSource = fs.readFileSync("src/main/main.js", "utf8");
const helperStart = mainSource.indexOf("function dayClosingReceiptWithDelivery(");
const helperEnd = mainSource.indexOf("\nlet splashShownAt", helperStart);
assert(helperStart >= 0 && helperEnd > helperStart);
const mapStatus = vm.runInNewContext(`${mainSource.slice(helperStart, helperEnd)}\ndayClosingReceiptWithDelivery`);
const receiptSource = fs.readFileSync("src/renderer/dayClosingReceipt.js", "utf8");
const receipt = { innerHTML: "" };
const context = {
    window: { dayClosingData: null },
    document: {
        addEventListener: () => {},
        getElementById: id => id === "receipt" ? receipt : null
    },
    Intl,
    Date,
    Number
};
vm.createContext(context);
vm.runInContext(receiptSource, context);

const snapshot = {
    businessDate: "2026-09-28", closeSequence: 1,
    closedAt: "2026-09-28T12:00:00.000Z", backupStatus: "SUCCESS",
    emailStatus: "PENDING", dsrSyncStatus: "NOT_ATTEMPTED"
};
function render(dsrStatus, emailStatus) {
    const delivery = { dsrStatus, emailStatus, durable: true };
    context.window.dayClosingData = mapStatus(snapshot, delivery);
    context.loadDayClosingReceipt();
    return receipt.innerHTML;
}
const delivered = render("DELIVERED", "DELIVERED");
assert.match(delivered, /DSR<\/span>\s*<span>Complete<\/span>/);
assert.match(delivered, /Email<\/span>\s*<span>Sent<\/span>/);
assert.doesNotMatch(delivered, /Email<\/span>\s*<span>PENDING<\/span>/);
const queued = render("PENDING", "PENDING");
assert.match(queued, /DSR<\/span>\s*<span>Retry queued<\/span>/);
assert.match(queued, /Email<\/span>\s*<span>Retry queued<\/span>/);
assert.doesNotMatch(queued, /Email<\/span>\s*<span>PENDING<\/span>/);
const failed = render("FAILED", "FAILED");
assert.match(failed, /Email<\/span>\s*<span>Failed<\/span>/);
assert(mainSource.includes("await dayClosingDeliveryCoordinator.observeForPrint(dayClosingPrintPending.jobId)"));
assert(mainSource.includes("await printDayClosingReceipt(dayClosingReceiptWithDelivery(dayClosingData, onlineDelivery))"));
assert(mainSource.includes("await printDayClosingReceipt(dayClosingReceiptWithDelivery(snapshot, delivery))"));
console.log("Day Closing thermal final-status and history reprint tests: PASS");
