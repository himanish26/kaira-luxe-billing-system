const SEGMENT_ORDER = Object.freeze(["KL", "MENS", "KIDS"]);
const PAYMENT_MODES = Object.freeze([
    "cash",
    "upi",
    "card",
    "storeCreditRedeemed",
    "giftVoucherRedeemed"
]);
const PROPORTIONAL_MODES = Object.freeze(["cash", "upi", "card"]);

const ZERO_PAISA = "0";

function diagnostic(code, message, details = {}) {
    return { code, message, ...details };
}

function valueText(value) {
    if (typeof value === "number") {
        if (!Number.isFinite(value)) return null;
        return String(value);
    }
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "string") return value.trim();
    return null;
}

function parseDecimal(value, field, { allowNegative = true } = {}) {
    const text = valueText(value);
    if (text === null || text === "") {
        return { error: diagnostic("INVALID_ITEM_NET", `${field} is missing or not numeric.`, { field }) };
    }
    const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text);
    if (!match) {
        return { error: diagnostic("INVALID_ITEM_NET", `${field} is malformed.`, { field }) };
    }
    const sign = match[1] === "-" ? -1n : 1n;
    if (!allowNegative && sign < 0n) {
        return { error: diagnostic("INVALID_ITEM_NET", `${field} cannot be negative.`, { field }) };
    }
    const fraction = match[3] || "";
    const exponent = Number(match[4] || 0);
    if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 10000) {
        return { error: diagnostic("INVALID_ITEM_NET", `${field} has an invalid exponent.`, { field }) };
    }
    const digits = (match[2] + fraction).replace(/^0+(?=\d)/, "") || "0";
    const scale = fraction.length - exponent;
    let coefficient = BigInt(digits) * sign;
    if (scale < 0) coefficient *= 10n ** BigInt(-scale);
    return { coefficient, scale: Math.max(0, scale) };
}

function alignDecimal(value, scale) {
    return value.coefficient * 10n ** BigInt(scale - value.scale);
}

function decimalText(coefficient, scale) {
    if (coefficient === 0n) return "0";
    const negative = coefficient < 0n;
    let digits = (negative ? -coefficient : coefficient).toString();
    if (scale > 0) {
        if (digits.length <= scale) digits = digits.padStart(scale + 1, "0");
        const split = digits.length - scale;
        digits = `${digits.slice(0, split)}.${digits.slice(split)}`;
        digits = digits.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
    }
    return negative ? `-${digits}` : digits;
}

function parsePaise(value, field) {
    const parsed = parseDecimal(value, field, { allowNegative: false });
    if (parsed.error) return { error: diagnostic("INVALID_PAYMENT_VALUE", parsed.error.message, { field }) };
    if (parsed.scale > 2) {
        const divisor = 10n ** BigInt(parsed.scale - 2);
        if (parsed.coefficient % divisor !== 0n) {
            return { error: diagnostic("INVALID_PAYMENT_VALUE", `${field} is not representable in integer paise.`, { field }) };
        }
        return { paise: parsed.coefficient / divisor };
    }
    return { paise: parsed.coefficient * 10n ** BigInt(2 - parsed.scale) };
}

function emptyAllocations() {
    const result = {};
    for (const segment of SEGMENT_ORDER) {
        result[segment] = {
            cashPaise: ZERO_PAISA,
            upiPaise: ZERO_PAISA,
            cardPaise: ZERO_PAISA,
            storeCreditRedeemedPaise: ZERO_PAISA,
            giftVoucherRedeemedPaise: ZERO_PAISA
        };
    }
    return result;
}

function allocationField(mode) {
    return `${mode}Paise`;
}

function allocateProportionally(tender, weights) {
    const totalWeight = SEGMENT_ORDER.reduce((sum, segment) => sum + (weights[segment] || 0n), 0n);
    const allocations = {};
    const remainders = [];
    let baseTotal = 0n;
    for (const segment of SEGMENT_ORDER) {
        const weight = weights[segment] || 0n;
        if (weight <= 0n) continue;
        const numerator = tender * weight;
        const base = numerator / totalWeight;
        allocations[segment] = base;
        baseTotal += base;
        remainders.push({ segment, remainder: numerator % totalWeight });
    }
    const residual = tender - baseTotal;
    remainders.sort((left, right) => {
        if (left.remainder > right.remainder) return -1;
        if (left.remainder < right.remainder) return 1;
        return SEGMENT_ORDER.indexOf(left.segment) - SEGMENT_ORDER.indexOf(right.segment);
    });
    for (let index = 0; index < Number(residual); index += 1) {
        allocations[remainders[index].segment] += 1n;
    }
    return allocations;
}

function allocateEqually(tender, participatingSegments) {
    const count = BigInt(participatingSegments.length);
    const base = tender / count;
    let residual = tender % count;
    const allocations = {};
    for (const segment of participatingSegments) allocations[segment] = base;
    for (const segment of participatingSegments) {
        if (residual === 0n) break;
        allocations[segment] += 1n;
        residual -= 1n;
    }
    return allocations;
}

function modeReconciliation(authoritative, allocations, mode) {
    const field = allocationField(mode);
    const allocated = SEGMENT_ORDER.reduce((sum, segment) => sum + BigInt(allocations[segment][field]), 0n);
    return {
        authoritativePaise: authoritative.toString(),
        allocatedPaise: allocated.toString(),
        status: allocated === authoritative ? "PASS" : "FAIL"
    };
}

function allocateBill(input) {
    const diagnostics = [];
    const billId = input && input.billId !== undefined && input.billId !== null
        ? String(input.billId)
        : "";
    if (!billId) diagnostics.push(diagnostic("INVALID_BILL_ID", "billId is required.", { field: "billId" }));

    const items = Array.isArray(input && input.items) ? input.items : null;
    if (!items) diagnostics.push(diagnostic("INVALID_ITEMS", "items must be an array.", { field: "items" }));

    const parsedPayments = {};
    const payments = input && input.payments && typeof input.payments === "object" ? input.payments : {};
    for (const mode of PAYMENT_MODES) {
        const parsed = parsePaise(payments[mode], `payments.${mode}`);
        if (parsed.error) diagnostics.push(parsed.error);
        else parsedPayments[mode] = parsed.paise;
    }

    const parsedItems = [];
    let maximumScale = 0;
    if (items) {
        for (let index = 0; index < items.length; index += 1) {
            const item = items[index] || {};
            const segmentValue = item.businessSegment;
            const segmentText = segmentValue == null ? "" : String(segmentValue).trim();
            if (!segmentText) {
                diagnostics.push(diagnostic("MISSING_SEGMENT", `Item ${index + 1} has no business Segment.`, { itemIndex: index }));
            } else if (!SEGMENT_ORDER.includes(segmentText)) {
                diagnostics.push(diagnostic("INVALID_SEGMENT", `Item ${index + 1} has an invalid business Segment.`, { itemIndex: index, value: segmentText }));
            }
            const parsedNet = parseDecimal(item.netAmount, `items[${index}].netAmount`, { allowNegative: false });
            if (parsedNet.error) diagnostics.push(parsedNet.error);
            else {
                maximumScale = Math.max(maximumScale, parsedNet.scale);
                parsedItems.push({ index, segment: segmentText, net: parsedNet });
            }
        }
    }

    const allocations = emptyAllocations();
    const authoritativePayments = {};
    for (const mode of PAYMENT_MODES) {
        if (parsedPayments[mode] !== undefined) authoritativePayments[`${mode}Paise`] = parsedPayments[mode].toString();
    }

    const weights = { KL: 0n, MENS: 0n, KIDS: 0n };
    let itemNetCoefficient = 0n;
    for (const item of parsedItems) {
        const aligned = alignDecimal(item.net, maximumScale);
        itemNetCoefficient += aligned;
        if (SEGMENT_ORDER.includes(item.segment) && aligned > 0n) weights[item.segment] += aligned;
    }
    const participatingSegments = SEGMENT_ORDER.filter(segment => weights[segment] > 0n);
    const totalWeight = participatingSegments.reduce((sum, segment) => sum + weights[segment], 0n);

    let billNetDifference = null;
    if (input && input.billNet !== undefined && input.billNet !== null) {
        const parsedBillNet = parseDecimal(input.billNet, "billNet", { allowNegative: false });
        if (parsedBillNet.error) diagnostics.push(diagnostic("INVALID_BILL_NET", parsedBillNet.error.message, { field: "billNet" }));
        else {
            const comparisonScale = Math.max(maximumScale, parsedBillNet.scale);
            billNetDifference = decimalText(
                itemNetCoefficient * 10n ** BigInt(comparisonScale - maximumScale) -
                parsedBillNet.coefficient * 10n ** BigInt(comparisonScale - parsedBillNet.scale),
                comparisonScale
            );
        }
    }
    const itemNetTotal = decimalText(itemNetCoefficient, maximumScale);

    const hasError = diagnostics.length > 0;
    const positiveProportionalTender = PROPORTIONAL_MODES.some(mode => parsedPayments[mode] > 0n);
    const positiveEqualTender = parsedPayments.storeCreditRedeemed > 0n || parsedPayments.giftVoucherRedeemed > 0n;
    if (!hasError && (positiveProportionalTender || positiveEqualTender) && totalWeight === 0n) {
        diagnostics.push(diagnostic("ZERO_ALLOCATION_WEIGHT", "A positive payment requires a positive participating Segment weight."));
    }
    if (!hasError && !positiveProportionalTender && !positiveEqualTender && totalWeight === 0n) {
        diagnostics.push(diagnostic("NO_POSITIVE_CONTRIBUTION", "No positive item contribution was present; all payment modes are confirmed zero.", { severity: "INFO" }));
    }

    let reconciliation = {};
    const hasBlockingDiagnostic = diagnostics.some(item => item.severity !== "INFO");
    if (!hasBlockingDiagnostic && totalWeight > 0n) {
        for (const mode of PROPORTIONAL_MODES) {
            const modeAllocations = allocateProportionally(parsedPayments[mode], weights);
            for (const segment of SEGMENT_ORDER) allocations[segment][allocationField(mode)] = (modeAllocations[segment] || 0n).toString();
        }
        for (const mode of ["storeCreditRedeemed", "giftVoucherRedeemed"]) {
            const modeAllocations = allocateEqually(parsedPayments[mode], participatingSegments);
            for (const segment of SEGMENT_ORDER) allocations[segment][allocationField(mode)] = (modeAllocations[segment] || 0n).toString();
        }
        for (const mode of PAYMENT_MODES) {
            reconciliation[mode] = modeReconciliation(parsedPayments[mode], allocations, mode);
            if (reconciliation[mode].status !== "PASS") {
                diagnostics.push(diagnostic("PAYMENT_RECONCILIATION_FAILED", `${mode} allocation did not reconcile exactly.`, { mode }));
            }
        }
    } else if (!hasBlockingDiagnostic) {
        for (const mode of PAYMENT_MODES) {
            reconciliation[mode] = modeReconciliation(parsedPayments[mode], allocations, mode);
        }
    } else {
        for (const mode of PAYMENT_MODES) {
            if (parsedPayments[mode] !== undefined) {
                reconciliation[mode] = { authoritativePaise: parsedPayments[mode].toString(), allocatedPaise: ZERO_PAISA, status: "UNAVAILABLE" };
            }
        }
    }

    const errorDiagnostics = diagnostics.filter(item => item.severity !== "INFO");
    const status = errorDiagnostics.length ? "INCOMPLETE" : "COMPLETE";
    return {
        billId,
        ...(input && input.billNo !== undefined ? { billNo: String(input.billNo) } : {}),
        status,
        participatingSegments,
        weights: Object.fromEntries(SEGMENT_ORDER.map(segment => [segment, weights[segment].toString()])),
        weightScale: maximumScale,
        itemNetTotal,
        ...(billNetDifference !== null ? { billNetDifference } : {}),
        authoritativePayments,
        allocations,
        reconciliation,
        diagnostics
    };
}

module.exports = {
    SEGMENT_ORDER,
    PAYMENT_MODES,
    allocateBill
};
