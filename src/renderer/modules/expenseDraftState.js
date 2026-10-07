"use strict";

(function installExpenseDraftState(root) {
    function createExpenseDraftState() {
        const entries = [];
        let nextDraftKey = 1;
        return Object.freeze({
            add(entry) {
                const value = { ...entry, draftKey: nextDraftKey++ };
                entries.push(value);
                return { ...value };
            },
            remove(draftKey) {
                const index = entries.findIndex(entry => entry.draftKey === draftKey);
                if (index < 0) return false;
                entries.splice(index, 1);
                return true;
            },
            clear() {
                entries.length = 0;
            },
            getEntries() {
                return entries.map(entry => ({ ...entry }));
            },
            summarize(paymentModes) {
                const result = { count: entries.length, grand: 0 };
                for (const mode of paymentModes) result[mode] = 0;
                for (const entry of entries) {
                    if (Object.prototype.hasOwnProperty.call(result, entry.paymentMode)) {
                        result[entry.paymentMode] += entry.amountPaise;
                    }
                    result.grand += entry.amountPaise;
                }
                return result;
            }
        });
    }

    const api = Object.freeze({ createExpenseDraftState });
    if (root) root.KLBSExpenseDraftState = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
