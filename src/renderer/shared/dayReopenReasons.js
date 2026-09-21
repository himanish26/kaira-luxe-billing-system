(function (root) {
    const reasons = Object.freeze([
        "Late Night Customer",
        "Payment Mode Correction",
        "Inventory Correction",
        "Other Operational Issue"
    ]);

    root.KLBS_DAY_REOPEN_REASONS = reasons;
    root.KLBS_isValidDayReopenReason = reason =>
        reasons.includes(String(reason || "").trim());

    if (typeof module !== "undefined" && module.exports) {
        module.exports = {
            DAY_REOPEN_REASONS: reasons,
            isValidDayReopenReason: root.KLBS_isValidDayReopenReason
        };
    }
})(typeof window !== "undefined" ? window : globalThis);
