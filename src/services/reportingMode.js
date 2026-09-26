const REPORTING_MODES = Object.freeze({
    LEGACY: "LEGACY",
    CONSOLIDATED_V2: "CONSOLIDATED_V2"
});

function resolveReportingMode(environment = process.env) {
    const requested = String(environment.KLBS_REPORTING_MODE || REPORTING_MODES.CONSOLIDATED_V2)
        .trim()
        .toUpperCase();
    if (!Object.values(REPORTING_MODES).includes(requested)) {
        throw new Error(`Unsupported KLBS reporting mode: ${requested}.`);
    }
    return requested;
}

module.exports = { REPORTING_MODES, resolveReportingMode };
