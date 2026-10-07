"use strict";

const RETURN_COST_METHOD = "ORIGINAL_SALE_TIME_COST_REVERSAL";

function deriveReturnCostSnapshot(original, returnedQuantity) {
    if (!Number.isInteger(returnedQuantity) || returnedQuantity <= 0) {
        throw new Error("Return cost quantity must be a positive whole number.");
    }

    const status = String(original?.cost_basis_status || "UNKNOWN");
    if (status === "UNKNOWN" || status === "NOT_APPLICABLE") {
        return {
            return_unit_cost_paise: null,
            return_cost_paise: null,
            return_cost_basis_status: status,
            return_cost_source: null,
            return_cost_method: null
        };
    }
    if (status !== "CAPTURED") {
        throw new Error("Original bill item has an unsupported cost basis status.");
    }

    const unitCostPaise = Number(original.unit_cost_paise);
    const source = String(original.cost_source || "").trim();
    if (!Number.isSafeInteger(unitCostPaise) || unitCostPaise < 0 || !source) {
        throw new Error("Original captured sale cost snapshot is incomplete.");
    }
    const returnCostPaise = unitCostPaise * returnedQuantity;
    if (!Number.isSafeInteger(returnCostPaise)) {
        throw new Error("Return cost reversal exceeds safe integer-paise limits.");
    }

    return {
        return_unit_cost_paise: unitCostPaise,
        return_cost_paise: returnCostPaise,
        return_cost_basis_status: "CAPTURED",
        return_cost_source: source,
        return_cost_method: RETURN_COST_METHOD
    };
}

module.exports = { RETURN_COST_METHOD, deriveReturnCostSnapshot };
