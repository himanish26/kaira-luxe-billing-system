const BYPASS_ENVIRONMENT_VARIABLE = "KLBS_DEV_BYPASS_BUSINESS_DAY_GATE";

function isDevelopmentBusinessDayGateBypassEnabled({ isPackaged, env = process.env } = {}) {
    return isPackaged === false && env[BYPASS_ENVIRONMENT_VARIABLE] === "1";
}

function isPendingPreviousBusinessDayFailure(check) {
    return Boolean(
        check &&
        check.id === "businessDay" &&
        check.critical === true &&
        check.state === "failed" &&
        check.action === "closePreviousBusinessDay" &&
        /^\d{4}-\d{2}-\d{2}$/.test(String(check.pendingPreviousBusinessDate || ""))
    );
}

function areStartupChecksBlocked(checks, bypassActive = false) {
    return (checks || []).some(check =>
        check.critical && check.state === "failed" &&
        !(bypassActive && isPendingPreviousBusinessDayFailure(check))
    );
}

module.exports = {
    BYPASS_ENVIRONMENT_VARIABLE,
    isDevelopmentBusinessDayGateBypassEnabled,
    isPendingPreviousBusinessDayFailure,
    areStartupChecksBlocked
};
