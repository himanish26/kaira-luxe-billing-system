"use strict";

(function installExpenseHistoryCalendar(root) {
    function stepMonth(month, delta, currentMonth) {
        const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(month || ""));
        if (!match || !Number.isInteger(delta)) return null;
        const target = new Date(Number(match[1]), Number(match[2]) - 1 + delta, 1);
        const result = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}`;
        return result > currentMonth ? null : result;
    }

    const api = Object.freeze({ stepMonth });
    if (root) root.KLBSExpenseHistoryCalendar = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
