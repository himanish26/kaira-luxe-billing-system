"use strict";

(function publishSupplierContactValidation(root, createValidation) {
    const validation = createValidation();
    if (typeof module === "object" && module.exports) module.exports = validation;
    if (root) root.KLBSSupplierContactValidation = validation;
})(typeof globalThis === "undefined" ? null : globalThis, () => {
    const INDIAN_MOBILE_PATTERN = /^[6-9][0-9]{9}$/;

    function validateIndianMobile(value, required = false) {
        const normalized = String(value ?? "").trim();
        if (!normalized) return { valid: !required, value: "" };
        return { valid: INDIAN_MOBILE_PATTERN.test(normalized), value: normalized };
    }

    return Object.freeze({ INDIAN_MOBILE_PATTERN, validateIndianMobile });
});
