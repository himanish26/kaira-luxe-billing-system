const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { createDayClosingLifecycleState, STAGE_ORDER } = require("../src/renderer/modules/system/dayClosingLifecycleState");

const root = path.join(__dirname, "../src");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const ui = read("renderer/modules/system/dayClosing.js");
const css = read("renderer/styles/settings.css");
const main = read("main/main.js");
const preload = read("main/preload.js");
const service = read("database/dayClosingService.js");
const receipt = read("renderer/dayClosingReceipt.js");
const html = read("renderer/index.html");
const preview = fs.readFileSync(path.join(__dirname, "day-closing-popup-preview.html"), "utf8");

assert.deepStrictEqual(STAGE_ORDER, [
    "FINALIZING_ACCOUNTS", "BUSINESS_DAY_CLOSED", "CREATING_BACKUP", "VERIFYING_BACKUP",
    "SENDING_EMAIL", "UPDATING_DSR", "COMPLETING_DAY_CLOSING", "PRINTING_DAY_CLOSING_SUMMARY"
]);
assert(html.indexOf("dayClosingLifecycleState.js") < html.indexOf("modules/system/dayClosing.js"));
assert(ui.includes('role="dialog" aria-modal="true"'));
assert(css.includes("width:min(720px, 100%)"));
assert(/\.dc-lifecycle-stage\.is-pending\s*\{\s*display:none;/.test(css),
    "future stages stay hidden until their real operation starts");
assert(ui.includes('document.body.appendChild(overlay)'));
assert(!ui.includes("dcLifecycleCancelBtn"));
assert(ui.includes('event.key === "Escape"') && ui.includes("event.preventDefault()"));
assert(ui.includes('payload.attemptId !== activeDayClosingAttemptId'));
assert(ui.includes('closeAfterDayClosing()'));
assert(preload.includes('"app:close-after-day-closing"'));
assert(!/shutdown\.exe|osascript|systemctl\s+poweroff|reboot\b/i.test(ui + main + preload));
assert(!/electronAPI|sqlite3|fetch\s*\(|axios|https?:\/\//i.test(preview));
assert(!main.includes("KLBS_C4D_ACCEPTANCE_PROBE"));

function advanceToBackup(lifecycle, attemptId) {
    assert.strictEqual(lifecycle.progress(attemptId, "CLOSING_BUSINESS_DAY").stages[0].detail, "Complete");
    assert.strictEqual(lifecycle.progress(attemptId, "BUSINESS_DAY_CLOSED").stages[1].detail, "CLOSED");
    assert.strictEqual(lifecycle.progress(attemptId, "CREATING_BACKUP").stages[2].detail, "Creating...");
}
function advanceToOnline(lifecycle, attemptId) {
    advanceToBackup(lifecycle, attemptId);
    assert.strictEqual(lifecycle.progress(attemptId, "VERIFYING_BACKUP").stages[2].detail, "Complete");
    assert.strictEqual(lifecycle.progress(attemptId, "BACKUP_VERIFIED").stages[3].detail, "Verified");
    assert.strictEqual(lifecycle.progress(attemptId, "SENDING_EMAIL").stages[4].detail, "Sending...");
}
function closeWithDelivery(lifecycle, attemptId, dsr, email) {
    advanceToOnline(lifecycle, attemptId);
    assert(lifecycle.progress(attemptId, "EMAIL_RESULT", { status: email, durable: true }));
    assert(lifecycle.progress(attemptId, "UPDATING_DSR"));
    assert(lifecycle.progress(attemptId, "DSR_RESULT", { status: dsr, durable: true }));
    assert(lifecycle.progress(attemptId, "COMPLETING_DAY_CLOSING"));
    assert(lifecycle.progress(attemptId, "DAY_CLOSING_COMPLETE"));
    assert(lifecycle.progress(attemptId, "PRINTING_DAY_CLOSING_SUMMARY"));
}
const successResult = { success: true, backupStatus: "SUCCESS" };
const lifecycle = createDayClosingLifecycleState();
const first = lifecycle.begin();
assert.strictEqual(first.stages[0].detail, "Processing...");
assert(first.stages.slice(1).every(stage => stage.status === "pending"));
assert.strictEqual(lifecycle.progress(first.attemptId, "CREATING_BACKUP"), null);
advanceToBackup(lifecycle, first.attemptId);
assert.strictEqual(lifecycle.progress(first.attemptId, "UPDATING_DSR"), null, "slow backup must block DSR");
assert.strictEqual(lifecycle.progress(first.attemptId, "BACKUP_VERIFIED"), null, "verification cannot complete before it starts");
assert.strictEqual(first.stages[2].status, "active");
assert(lifecycle.progress(first.attemptId, "VERIFYING_BACKUP"));
assert.strictEqual(first.stages[3].status, "active");
assert.strictEqual(lifecycle.progress(first.attemptId, "UPDATING_DSR"), null, "slow verification must block DSR");
assert(lifecycle.progress(first.attemptId, "BACKUP_VERIFIED"));
assert(lifecycle.progress(first.attemptId, "SENDING_EMAIL"));
assert.strictEqual(lifecycle.progress(first.attemptId, "UPDATING_DSR"), null, "slow email must block DSR stage");
assert.strictEqual(lifecycle.progress(first.attemptId, "EMAIL_RESULT", { status: "PROCESSING", durable: true }), null);
assert.strictEqual(first.stages[4].status, "active");
assert.strictEqual(lifecycle.progress(first.attemptId, "EMAIL_RESULT", { status: "DELIVERED", durable: false }), null);
assert(lifecycle.progress(first.attemptId, "EMAIL_RESULT", { status: "DELIVERED", durable: true }));
assert.strictEqual(first.stages[4].detail, "Sent");
assert(lifecycle.progress(first.attemptId, "UPDATING_DSR"));
assert.strictEqual(lifecycle.progress(first.attemptId, "COMPLETING_DAY_CLOSING"), null, "slow DSR must block completion");
assert(lifecycle.progress(first.attemptId, "DSR_RESULT", { status: "DELIVERED", durable: true }));
assert(lifecycle.progress(first.attemptId, "COMPLETING_DAY_CLOSING"));
assert(lifecycle.progress(first.attemptId, "DAY_CLOSING_COMPLETE"));
assert.strictEqual(lifecycle.finish(first.attemptId, successResult, { success: true }), null, "printing is required");
assert(lifecycle.progress(first.attemptId, "PRINTING_DAY_CLOSING_SUMMARY"));
assert.strictEqual(lifecycle.finish(first.attemptId, successResult, { success: true }), null, "print result is required");
assert(lifecycle.progress(first.attemptId, "PRINT_RESULT", { success: true }));
const completed = lifecycle.finish(first.attemptId, successResult, { success: true });
assert.strictEqual(completed.title, "DAY CLOSING SUCCESSFUL");
assert.strictEqual(completed.closeEnabled, true);
assert.deepStrictEqual(completed.stages.map(stage => stage.detail), [
    "Complete", "CLOSED", "Complete", "Verified", "Sent", "Complete", "Complete", "Printed"
]);

const second = lifecycle.begin();
assert(second.attemptId !== first.attemptId);
assert.strictEqual(lifecycle.progress(first.attemptId, "PRINT_RESULT", { success: true }), null);
assert.strictEqual(lifecycle.finish(first.attemptId, successResult, { success: true }), null);
closeWithDelivery(lifecycle, second.attemptId, "PENDING", "PENDING");
assert.strictEqual(second.stages[4].detail, "Retry queued");
assert.strictEqual(second.stages[5].detail, "Retry queued");
assert(lifecycle.progress(second.attemptId, "PRINT_RESULT", { success: true }));
const queued = lifecycle.finish(second.attemptId, successResult, { success: true });
assert.strictEqual(queued.title, "DAY CLOSING COMPLETED WITH PENDING TASK");
assert.strictEqual(queued.closeEnabled, true);
assert(lifecycle.progress(second.attemptId, "EMAIL_RESULT", { status: "DELIVERED", durable: true, refresh: true }));
assert.strictEqual(queued.stages[4].detail, "Sent", "later persisted email success updates the open lifecycle");
assert(lifecycle.progress(second.attemptId, "DSR_RESULT", { status: "DELIVERED", durable: true, refresh: true }));
assert.strictEqual(queued.title, "DAY CLOSING SUCCESSFUL");
assert.match(queued.notice, /after the receipt was printed/);

const third = lifecycle.begin();
closeWithDelivery(lifecycle, third.attemptId, "DELIVERED", "FAILED");
assert(lifecycle.progress(third.attemptId, "PRINT_RESULT", { success: true }));
const failedEmail = lifecycle.finish(third.attemptId, successResult, { success: true });
assert.strictEqual(failedEmail.title, "DAY CLOSING REQUIRES ATTENTION");
assert.strictEqual(failedEmail.closeEnabled, true, "failed online work cannot block safe local exit");
assert.strictEqual(failedEmail.retryVisible, true);
assert.strictEqual(third.stages[4].detail, "Failed");
assert.strictEqual(third.stages[4].status, "error");
assert(lifecycle.progress(third.attemptId, "EMAIL_RESULT", { status: "PENDING", durable: true, refresh: true }));
assert.strictEqual(third.stages[4].status, "warning");
assert.strictEqual(third.retryVisible, false);
assert.strictEqual(third.closeEnabled, true);
assert(lifecycle.progress(third.attemptId, "EMAIL_RESULT", { status: "FAILED", lastError: "STALE_SUPERSEDED: newer close", durable: true, refresh: true }));
assert.strictEqual(third.retryVisible, false, "superseded work does not offer manual retry");

const fourth = lifecycle.begin();
closeWithDelivery(lifecycle, fourth.attemptId, "DELIVERED", "DELIVERED");
assert(lifecycle.progress(fourth.attemptId, "PRINT_RESULT", { success: false }));
const printFailed = lifecycle.finish(fourth.attemptId, successResult, { success: false });
assert.strictEqual(printFailed.title, "DAY CLOSING REQUIRES ATTENTION");
assert.strictEqual(printFailed.closeEnabled, false, "required printing must complete before lifecycle exit");
assert.strictEqual(fourth.stages[7].detail, "Print failed");

const backupFailureAttempt = lifecycle.begin();
advanceToBackup(lifecycle, backupFailureAttempt.attemptId);
const backupFailure = lifecycle.fail(backupFailureAttempt.attemptId, "Backup failed", true);
assert.strictEqual(backupFailure.title, "DAY CLOSING REQUIRES ATTENTION");
assert.strictEqual(backupFailure.closeEnabled, false);
assert.strictEqual(lifecycle.progress(backupFailureAttempt.attemptId, "UPDATING_DSR"), null);
assert.strictEqual(backupFailure.stages[7].status, "pending");
const closeFailureAttempt = lifecycle.begin();
const closeFailure = lifecycle.fail(closeFailureAttempt.attemptId, "Commit failed", false);
assert.strictEqual(closeFailure.title, "DAY CLOSING FAILED");
assert.strictEqual(closeFailure.closeEnabled, false);
assert.strictEqual(closeFailure.stages[7].status, "pending");

assert(ui.indexOf('updateDayClosingLifecycleStage("PRINTING_DAY_CLOSING_SUMMARY"') < ui.indexOf("await window.electronAPI.printDayClosing(result.snapshotId)"));
assert(ui.indexOf("await window.electronAPI.printDayClosing(result.snapshotId)") < ui.indexOf('updateDayClosingLifecycleStage("PRINT_RESULT"'));
assert(ui.indexOf('updateDayClosingLifecycleStage("PRINT_RESULT"') < ui.lastIndexOf("finishDayClosingLifecycle(result, printResult"));
assert(main.includes("dayClosingDeliveryCoordinator.observeForPrint(dayClosingPrintPending.jobId)"));
assert(main.indexOf("dayClosingDeliveryCoordinator.observeForPrint(dayClosingPrintPending.jobId)") < main.indexOf("await printDayClosingReceipt(dayClosingReceiptWithDelivery"));
assert(main.includes("dayClosingPrintPending.printStarted"));
assert(main.includes("dayClosingCriticalInProgress || dayClosingPrintPending"));
assert.strictEqual((main.match(/remoteDashboard\.queueDayClosed\(result\)/g) || []).length, 1, "DAY_CLOSED call remains in its existing success path");
assert(service.includes('onProgressFn("CLOSING_BUSINESS_DAY")'));
assert(service.indexOf('onProgressFn("CLOSING_BUSINESS_DAY")') < service.indexOf("SET close_status = 'CLOSED'"));
assert(receipt.includes('receiptRow("DSR", data.dsrDeliveryStatus'));
assert(receipt.includes('receiptRow("Email", data.emailStatus'));
console.log("Day Closing eight-stage lifecycle regression tests: PASS");
