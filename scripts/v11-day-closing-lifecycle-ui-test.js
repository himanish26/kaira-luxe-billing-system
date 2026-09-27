const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { createDayClosingLifecycleState, STAGE_ORDER } = require("../src/renderer/modules/system/dayClosingLifecycleState");

const root = path.join(__dirname, "../src");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const ui = read("renderer/modules/system/dayClosing.js");
const helperSource = read("renderer/modules/system/dayClosingLifecycleState.js");
const css = read("renderer/styles/settings.css");
const main = read("main/main.js");
const preload = read("main/preload.js");
const service = read("database/dayClosingService.js");
const worker = read("services/consolidatedSheetDeliveryWorker.js");
const reportingEmail = read("services/consolidatedReportingEmailWorker.js");
const backup = read("services/backupService.js");
const integrations = read("services/integrationStatusService.js");
const html = read("renderer/index.html");
const preview = fs.readFileSync(path.join(__dirname, "day-closing-popup-preview.html"), "utf8");

assert.deepStrictEqual(STAGE_ORDER, [
    "FINALIZING_ACCOUNTS", "BUSINESS_DAY_CLOSED", "CREATING_BACKUP",
    "VERIFYING_BACKUP", "UPDATING_DSR", "SENDING_EMAIL", "COMPLETING_DAY_CLOSING"
]);
assert(html.indexOf("dayClosingLifecycleState.js") < html.indexOf("modules/system/dayClosing.js"));
assert(ui.includes('role="dialog" aria-modal="true"'));
assert(css.includes("width:min(720px, 100%)"));
assert(css.includes("background:rgba(20, 24, 30, .56)"));
assert(ui.includes('document.body.appendChild(overlay)'));
assert(!ui.includes("dcLifecycleCloseX"));
assert(ui.includes('event.key === "Escape"') && ui.includes("event.preventDefault()"));
assert(ui.includes("resetDayClosingLifecycle()") && ui.includes("dayClosingLifecycleState.begin()"));
assert(ui.includes("payload.attemptId !== activeDayClosingAttemptId"));
assert(ui.includes("dayClosingLifecycleState.isCurrent(attemptId)"));
assert(ui.includes("closeAfterDayClosing()"));
assert(preload.includes('"app:close-after-day-closing"'));
assert(!/shutdown\.exe|osascript|systemctl\s+poweroff|reboot\b/i.test(ui + main + preload));
assert(!/electronAPI|sqlite3|fetch\s*\(|axios|https?:\/\//i.test(preview));
assert(preview.includes("LOCAL MOCK PREVIEW") && preview.includes("lifecycle.finish"));
assert(!main.includes("KLBS_C4D_ACCEPTANCE_PROBE"));

const lifecycle = createDayClosingLifecycleState();
const first = lifecycle.begin();
assert.strictEqual(first.stages[0].status, "active");
assert(first.stages.slice(1).every(stage => stage.status === "pending"));
const completed = lifecycle.finish(first.attemptId, {
    success: true, backupStatus: "SUCCESS", consolidatedReportingJob: { jobId: 10 },
    onlineDelivery: { online: true, dsrStatus: "DELIVERED", emailStatus: "DELIVERED" }
});
assert.strictEqual(completed.title, "DAY CLOSING SUCCESSFUL");
assert.strictEqual(completed.closeEnabled, true);
assert.strictEqual(completed.outcome, "success");

// Reclose after reopen begins from a new UI session with no state carried over.
const second = lifecycle.begin();
assert(second.attemptId !== first.attemptId);
assert.strictEqual(second.title, "Closing Business Day");
assert.strictEqual(second.notice, "");
assert.strictEqual(second.closeEnabled, false);
assert.strictEqual(second.outcome, "running");
assert.strictEqual(second.stages[0].status, "active");
assert(second.stages.slice(1).every(stage => stage.status === "pending"));
assert.strictEqual(lifecycle.progress(first.attemptId, "COMPLETING_DAY_CLOSING"), null);
assert.strictEqual(lifecycle.finish(first.attemptId, { success: true, backupStatus: "SUCCESS" }), null);
assert.strictEqual(lifecycle.isCurrent(second.attemptId), true);

const warning = lifecycle.finish(second.attemptId, {
    success: true, backupStatus: "SUCCESS", consolidatedReportingJob: { jobId: 11 },
    onlineDelivery: { online: true, dsrStatus: "FAILED", emailStatus: "PENDING" }
});
assert.strictEqual(warning.outcome, "success");
assert.strictEqual(warning.closeEnabled, true);
assert.strictEqual(warning.stages[4].status, "warning");
assert.match(warning.stages[4].detail, /Queued/);
assert.strictEqual(warning.stages[5].status, "warning");

const failureAttempt = lifecycle.begin();
assert.strictEqual(lifecycle.finish(failureAttempt.attemptId, { success: false, backupStatus: "SUCCESS" }), null);
assert.strictEqual(lifecycle.finish(failureAttempt.attemptId, { success: true, backupStatus: "FAILED" }), null);
const failure = lifecycle.fail(failureAttempt.attemptId, "Backup verification failed", true);
assert.strictEqual(failure.outcome, "failure");
assert.strictEqual(failure.closeEnabled, false);
assert.strictEqual(failure.returnVisible, true);
assert.strictEqual(lifecycle.progress(failureAttempt.attemptId, "FINALIZING_ACCOUNTS").stages[0].status, "active");

for (let cycle = 0; cycle < 50; cycle += 1) {
    const attempt = lifecycle.begin();
    assert.strictEqual(attempt.stages[0].status, "active");
    assert(attempt.stages.slice(1).every(stage => stage.status === "pending"));
    lifecycle.invalidate(attempt.attemptId);
}
assert.strictEqual((ui.match(/if \(!dayClosingLifecycleListenerBound\)/g) || []).length, 1);
assert((ui.match(/onDayClosingProgress\(/g) || []).length <= 1);

// Mandatory boundary and all reporting/backup business implementations are unchanged.
assert(service.includes('onProgressFn("FINALIZING_ACCOUNTS")'));
assert(service.includes('onProgressFn("VERIFYING_BACKUP")'));
assert(service.includes('onProgressFn("BACKUP_VERIFIED")'));
assert(service.includes('backupStatus: "SUCCESS"'));
assert(worker.includes("validateReceiverResponse(response.data, validated)"));
assert(reportingEmail.includes("email_status"));
assert(backup.includes("validateDayClosingBackup"));
assert(integrations.includes("consolidated_reporting_jobs"));

console.log("Day Closing lifecycle UI regression tests: PASS (reset, reclose, attempt isolation, modal and safety boundary)");
