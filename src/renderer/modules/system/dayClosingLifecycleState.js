(function(root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root) root.createDayClosingLifecycleState = api.createDayClosingLifecycleState;
})(typeof window !== "undefined" ? window : globalThis, function() {
    const ORDER = Object.freeze([
        "FINALIZING_ACCOUNTS", "BUSINESS_DAY_CLOSED", "CREATING_BACKUP",
        "VERIFYING_BACKUP", "UPDATING_DSR", "SENDING_EMAIL", "COMPLETING_DAY_CLOSING"
    ]);
    const LABELS = Object.freeze({
        FINALIZING_ACCOUNTS: "Finalizing accounts",
        BUSINESS_DAY_CLOSED: "Business Day CLOSED",
        CREATING_BACKUP: "Creating backup",
        VERIFYING_BACKUP: "Verifying backup",
        UPDATING_DSR: "Updating DSR",
        SENDING_EMAIL: "Sending email",
        COMPLETING_DAY_CLOSING: "Completing Day Closing"
    });
    const WAITING = "Please keep KLBS open while the mandatory closing work completes.";

    function stageRows(activeFirst = false) {
        return ORDER.map((stage, index) => ({
            stage,
            label: LABELS[stage],
            status: activeFirst && index === 0 ? "active" : "pending",
            detail: activeFirst && index === 0 ? "In progress" : "Waiting"
        }));
    }

    function createDayClosingLifecycleState() {
        let sequence = Date.now() * 1000;
        let current = null;
        function begin() {
            sequence += 1;
            current = {
                attemptId: sequence,
                title: "Closing Business Day",
                subtitle: WAITING,
                notice: "",
                noticeType: "",
                stages: stageRows(true),
                closeEnabled: false,
                returnVisible: false,
                outcome: "running"
            };
            return current;
        }
        function isCurrent(attemptId) { return Boolean(current && attemptId === current.attemptId); }
        function progress(attemptId, stage) {
            if (!isCurrent(attemptId)) return null;
            if (stage === "BACKUP_VERIFIED") {
                const row = current.stages.find(item => item.stage === "VERIFYING_BACKUP");
                row.status = "complete"; row.detail = "Complete";
                return current;
            }
            if (stage === "ONLINE_TASKS_QUEUED" || stage === "DAY_CLOSING_COMPLETE" || stage === "COMPLETING_DAY_CLOSING") return current;
            const index = ORDER.indexOf(stage);
            if (index < 0) return null;
            current.stages.forEach((row, rowIndex) => {
                if (rowIndex < index) { row.status = "complete"; row.detail = "Complete"; }
                else if (rowIndex === index) { row.status = "active"; row.detail = "In progress"; }
                else { row.status = "pending"; row.detail = "Waiting"; }
            });
            return current;
        }
        function finish(attemptId, result, warnings = []) {
            if (!isCurrent(attemptId) || !result || result.success !== true || result.backupStatus !== "SUCCESS") return null;
            const onlineDelivery = result.onlineDelivery || {};
            const online = onlineDelivery.online;
            const setDelivery = (stage, delivered, queuedLabel) => {
                if (!result.consolidatedReportingJob) return;
                const row = current.stages.find(item => item.stage === stage);
                row.status = delivered ? "complete" : "warning";
                row.detail = delivered ? "Complete" : queuedLabel;
            };
            setDelivery("UPDATING_DSR", onlineDelivery.dsrStatus === "DELIVERED", online ? "Queued for automatic retry" : "Queued until online");
            setDelivery("SENDING_EMAIL", onlineDelivery.emailStatus === "DELIVERED", online ? "Queued for automatic retry" : "Queued until online");
            const final = current.stages.find(item => item.stage === "COMPLETING_DAY_CLOSING");
            final.status = "complete"; final.detail = "Complete";
            current.title = "DAY CLOSING SUCCESSFUL";
            current.subtitle = "Business Day is closed and the mandatory backup is verified.";
            const pending = result.consolidatedReportingJob
                ? [onlineDelivery.dsrStatus, onlineDelivery.emailStatus].filter(status => status !== "DELIVERED").length : 0;
            const queueNotice = pending ? `${pending} online task${pending === 1 ? " is" : "s are"} safely queued and will continue automatically.` : "";
            current.notice = [queueNotice, ...warnings].filter(Boolean).join(" ");
            current.noticeType = current.notice ? "warning" : "";
            current.closeEnabled = true;
            current.outcome = "success";
            return current;
        }
        function fail(attemptId, message, dayClosed = false) {
            if (!isCurrent(attemptId)) return null;
            current.title = dayClosed ? "BACKUP VERIFICATION FAILED" : "DAY CLOSING FAILED";
            current.subtitle = dayClosed
                ? "The accounting day is CLOSED, but Safe Exit is blocked until a verified backup is available."
                : "The Business Day was not closed safely.";
            current.notice = message || "Day Closing could not be completed.";
            current.noticeType = "error";
            current.closeEnabled = false;
            current.returnVisible = true;
            current.outcome = "failure";
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
