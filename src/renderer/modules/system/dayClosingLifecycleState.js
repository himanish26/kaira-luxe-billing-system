(function(root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root) root.createDayClosingLifecycleState = api.createDayClosingLifecycleState;
})(typeof window !== "undefined" ? window : globalThis, function() {
    const ORDER = Object.freeze([
        "FINALIZING_ACCOUNTS", "BUSINESS_DAY_CLOSED", "CREATING_BACKUP",
        "VERIFYING_BACKUP", "UPDATING_DSR", "SENDING_EMAIL",
        "COMPLETING_DAY_CLOSING", "PRINTING_DAY_CLOSING_SUMMARY"
    ]);
    const LABELS = Object.freeze({
        FINALIZING_ACCOUNTS: "Finalizing accounts",
        BUSINESS_DAY_CLOSED: "Closing Business Day",
        CREATING_BACKUP: "Creating backup",
        VERIFYING_BACKUP: "Verifying backup",
        UPDATING_DSR: "Updating DSR",
        SENDING_EMAIL: "Sending email",
        COMPLETING_DAY_CLOSING: "Completing Day Closing",
        PRINTING_DAY_CLOSING_SUMMARY: "Printing Day Closing summary"
    });
    const START_DETAILS = Object.freeze({
        FINALIZING_ACCOUNTS: "Processing...",
        BUSINESS_DAY_CLOSED: "Closing...",
        CREATING_BACKUP: "Creating...",
        VERIFYING_BACKUP: "Verifying...",
        UPDATING_DSR: "Updating...",
        SENDING_EMAIL: "Sending...",
        COMPLETING_DAY_CLOSING: "Finalizing...",
        PRINTING_DAY_CLOSING_SUMMARY: "Printing..."
    });
    const TERMINAL = new Set(["complete", "warning", "error"]);

    function stageRows() {
        return ORDER.map((stage, index) => ({
            stage,
            label: LABELS[stage],
            status: index === 0 ? "active" : "pending",
            detail: index === 0 ? START_DETAILS[stage] : "Waiting"
        }));
    }

    function createDayClosingLifecycleState() {
        let sequence = Date.now() * 1000;
        let current = null;
        const row = stage => current.stages.find(item => item.stage === stage);
        function set(stage, status, detail) {
            const target = row(stage);
            target.status = status;
            target.detail = detail;
        }
        function activate(stage) {
            const index = ORDER.indexOf(stage);
            if (index < 0 || (index > 0 && !TERMINAL.has(row(ORDER[index - 1]).status))) return false;
            const target = row(stage);
            if (TERMINAL.has(target.status)) return true;
            set(stage, "active", START_DETAILS[stage]);
            return true;
        }
        function delivery(stage, detail) {
            if ((row(stage).status !== "active" && !(detail.refresh && TERMINAL.has(row(stage).status))) ||
                detail.durable !== true) return false;
            if (detail.status === "DELIVERED") {
                set(stage, "complete", stage === "SENDING_EMAIL" ? "Sent" : "Complete");
            } else if (detail.status === "PENDING") {
                set(stage, "warning", "Retry queued");
            } else if (detail.status === "FAILED") {
                set(stage, "error", "Failed");
            } else return false;
            return true;
        }
        function begin() {
            sequence += 1;
            current = {
                attemptId: sequence,
                title: "Closing Business Day",
                subtitle: "Please keep KLBS open while the mandatory closing work completes.",
                notice: "",
                noticeType: "",
                stages: stageRows(),
                closeEnabled: false,
                returnVisible: false,
                outcome: "running"
            };
            return current;
        }
        function isCurrent(attemptId) { return Boolean(current && attemptId === current.attemptId); }
        function progress(attemptId, stage, detail = {}) {
            if (!isCurrent(attemptId)) return null;
            if (current.outcome !== "running") {
                if (detail.refresh && current.finalContext &&
                    (stage === "DSR_RESULT" || stage === "EMAIL_RESULT")) {
                    const target = stage === "DSR_RESULT" ? "UPDATING_DSR" : "SENDING_EMAIL";
                    const wasQueued = row(target).status === "warning";
                    if (!delivery(target, detail)) return null;
                    if (wasQueued && detail.status === "DELIVERED") current.lateDelivery = true;
                    return applyFinalOutcome(...current.finalContext);
                }
                return null;
            }
            if (stage === "FINALIZING_ACCOUNTS") return current;
            if (stage === "CLOSING_BUSINESS_DAY") {
                set("FINALIZING_ACCOUNTS", "complete", "Complete");
                return activate("BUSINESS_DAY_CLOSED") ? current : null;
            }
            if (stage === "BUSINESS_DAY_CLOSED") {
                if (row(stage).status !== "active") return null;
                set(stage, "complete", "CLOSED");
                return current;
            }
            if (stage === "CREATING_BACKUP") return activate(stage) ? current : null;
            if (stage === "VERIFYING_BACKUP") {
                if (row("CREATING_BACKUP").status !== "active") return null;
                set("CREATING_BACKUP", "complete", "Complete");
                return activate(stage) ? current : null;
            }
            if (stage === "BACKUP_VERIFIED") {
                if (row("VERIFYING_BACKUP").status !== "active") return null;
                set("VERIFYING_BACKUP", "complete", "Verified");
                return current;
            }
            if (stage === "UPDATING_DSR" || stage === "SENDING_EMAIL" ||
                stage === "COMPLETING_DAY_CLOSING" || stage === "PRINTING_DAY_CLOSING_SUMMARY") {
                return activate(stage) ? current : null;
            }
            if (stage === "DSR_RETRYING" || stage === "EMAIL_RETRYING") {
                const target = stage === "DSR_RETRYING" ? "UPDATING_DSR" : "SENDING_EMAIL";
                if (row(target).status !== "active") return null;
                set(target, "active", "Retrying...");
                return current;
            }
            if (stage === "DSR_RESULT" || stage === "EMAIL_RESULT") {
                return delivery(stage === "DSR_RESULT" ? "UPDATING_DSR" : "SENDING_EMAIL", detail) ? current : null;
            }
            if (stage === "DAY_CLOSING_COMPLETE") {
                if (row("COMPLETING_DAY_CLOSING").status !== "active") return null;
                set("COMPLETING_DAY_CLOSING", "complete", "Complete");
                return current;
            }
            if (stage === "PRINT_RESULT") {
                if (row("PRINTING_DAY_CLOSING_SUMMARY").status !== "active") return null;
                set("PRINTING_DAY_CLOSING_SUMMARY", detail.success === true ? "complete" : "error",
                    detail.success === true ? "Printed" : "Print failed");
                return current;
            }
            return null;
        }
        function applyFinalOutcome(result, printResult, warnings) {
            const dsr = row("UPDATING_DSR");
            const email = row("SENDING_EMAIL");
            const failedDelivery = dsr.status === "error" || email.status === "error";
            const queued = dsr.status === "warning" || email.status === "warning";
            const printFailed = printResult.success !== true;
            current.title = failedDelivery || printFailed ? "DAY CLOSING REQUIRES ATTENTION"
                : queued ? "DAY CLOSING COMPLETED WITH PENDING TASK" : "DAY CLOSING SUCCESSFUL";
            current.subtitle = "Business Day is CLOSED and the mandatory backup is verified.";
            current.notice = [
                queued ? "Online delivery is durably queued for automatic retry." : "",
                failedDelivery ? "An online delivery failed and needs attention." : "",
                printFailed ? "Day Closing summary print failed; Day Closing History can reprint the saved snapshot." : "",
                current.lateDelivery ? "Online delivery completed after the receipt was printed." : "",
                ...warnings
            ].filter(Boolean).join(" ");
            current.noticeType = failedDelivery || printFailed ? "error" : queued ? "warning" : "";
            current.closeEnabled = !failedDelivery;
            current.outcome = failedDelivery || printFailed ? "attention" : queued ? "pending" : "success";
            return current;
        }
        function finish(attemptId, result, printResult, warnings = []) {
            if (!isCurrent(attemptId) || !result || result.success !== true ||
                result.backupStatus !== "SUCCESS" || !printResult ||
                !TERMINAL.has(row("PRINTING_DAY_CLOSING_SUMMARY").status)) return null;
            if (!TERMINAL.has(row("UPDATING_DSR").status) ||
                !TERMINAL.has(row("SENDING_EMAIL").status)) return null;
            current.finalContext = [result, printResult, warnings];
            return applyFinalOutcome(result, printResult, warnings);
        }
        function fail(attemptId, message, dayClosed = false) {
            if (!isCurrent(attemptId)) return null;
            current.title = dayClosed ? "DAY CLOSING REQUIRES ATTENTION" : "DAY CLOSING FAILED";
            current.subtitle = dayClosed
                ? "The Business Day is CLOSED, but mandatory closing work needs attention."
                : "The Business Day was not closed safely.";
            current.notice = message || "Day Closing could not be completed.";
            current.noticeType = "error";
            current.closeEnabled = false;
            current.returnVisible = true;
            current.outcome = "failure";
            const active = current.stages.find(item => item.status === "active");
            if (active) { active.status = "error"; active.detail = "Failed"; }
            return current;
        }
        function invalidate(attemptId) {
            if (!isCurrent(attemptId)) return false;
            current = null;
            sequence += 1;
            return true;
        }
        return { begin, isCurrent, progress, finish, fail, invalidate, getCurrent: () => current, order: ORDER };
    }

    return { createDayClosingLifecycleState, STAGE_ORDER: ORDER };
});
