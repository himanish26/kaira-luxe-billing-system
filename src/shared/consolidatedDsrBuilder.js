const crypto = require("crypto");
const { allocateBill, SEGMENT_ORDER, PAYMENT_MODES } = require("./segmentPaymentAllocator");

const CONTRACT_VERSION = 2;
const SNAPSHOT_VERSION = 2;
const REQUIRED_PAYMENT_FIELDS = Object.freeze(PAYMENT_MODES.map(mode => `${mode}Paise`));
const SEGMENT_PAYMENT_FIELDS = Object.freeze(REQUIRED_PAYMENT_FIELDS);

function stableValue(value, parentKey = null) {
    if (typeof value === "bigint") throw new TypeError("BigInt is not JSON-safe in a semantic payload.");
    if (Array.isArray(value)) return value.map(item => stableValue(item, parentKey));
    if (value && typeof value === "object") {
        const result = {};
        const keys = Object.keys(value);
        const preferred = parentKey === "segments" ? ["KL", "MENS", "KIDS"] : null;
        keys.sort((left, right) => {
            if (preferred) {
                const li = preferred.indexOf(left);
                const ri = preferred.indexOf(right);
                if (li !== -1 || ri !== -1) return (li === -1 ? 99 : li) - (ri === -1 ? 99 : ri);
            }
            return left < right ? -1 : left > right ? 1 : 0;
        });
        for (const key of keys) result[key] = stableValue(value[key], key);
        return result;
    }
    return value;
}

function canonicalizeSemanticPayload(payload) {
    return JSON.stringify(stableValue(payload));
}

function hashSemanticPayload(payload) {
    return crypto.createHash("sha256").update(canonicalizeSemanticPayload(payload), "utf8").digest("hex");
}

function canonicalInteger(value, field, { allowNegative = false } = {}) {
    if (typeof value === "bigint") value = value.toString();
    if (typeof value === "number") {
        if (!Number.isSafeInteger(value)) return { error: `${field} must be an integer.` };
        value = String(value);
    }
    if (typeof value !== "string" || !/^-?\d+$/.test(value.trim())) return { error: `${field} must be a decimal integer string.` };
    const text = value.trim();
    if (!allowNegative && text.startsWith("-")) return { error: `${field} cannot be negative.` };
    const negative = text.startsWith("-");
    const digits = (negative ? text.slice(1) : text).replace(/^0+(?=\d)/, "") || "0";
    return { value: `${negative ? "-" : ""}${digits}` };
}

function formatPaise(value) {
    const parsed = canonicalInteger(value, "paise", { allowNegative: true });
    if (parsed.error) throw new TypeError(parsed.error);
    const negative = parsed.value.startsWith("-");
    const digits = negative ? parsed.value.slice(1) : parsed.value;
    const whole = digits.length > 2 ? digits.slice(0, -2) : "0";
    const fraction = digits.padStart(3, "0").slice(-2);
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `${negative ? "-" : ""}\u20B9${grouped}.${fraction}`;
}

function emptySegment() {
    return {
        bills: 0,
        qtySold: null,
        netContributionPaise: null,
        cashPaise: "0",
        upiPaise: "0",
        cardPaise: "0",
        storeCreditRedeemedPaise: "0",
        giftVoucherRedeemedPaise: "0"
    };
}

function emptySegments() {
    return Object.fromEntries(SEGMENT_ORDER.map(segment => [segment, emptySegment()]));
}

function addPaise(left, right) {
    return (BigInt(left) + BigInt(right)).toString();
}

function sortDiagnostics(diagnostics) {
    return diagnostics
        .map(value => ({ ...value }))
        .sort((left, right) => JSON.stringify(stableValue(left)).localeCompare(JSON.stringify(stableValue(right))));
}

function normalizeOverall(input, diagnostics) {
    const overall = input && typeof input === "object" ? { ...input } : {};
    for (const key of Object.keys(overall)) {
        if (!key.endsWith("Paise")) continue;
        const parsed = canonicalInteger(overall[key], `overall.${key}`, { allowNegative: key === "settlementDifferencePaise" });
        if (parsed.error) {
            diagnostics.push({ code: "INVALID_OVERALL_VALUE", field: key, message: parsed.error });
            overall[key] = null;
        } else overall[key] = parsed.value;
    }
    return overall;
}

function buildReconciliation(overall, segments) {
    const result = {};
    for (const field of SEGMENT_PAYMENT_FIELDS) {
        const mode = field.slice(0, -5);
        const overallValue = overall[field];
        const segmentSum = SEGMENT_ORDER.reduce((sum, segment) => sum + BigInt(segments[segment][field]), 0n).toString();
        if (overallValue === undefined || overallValue === null) {
            result[mode] = { overallPaise: null, segmentSumPaise: segmentSum, deltaPaise: null, status: "NOT_APPLICABLE" };
            continue;
        }
        const delta = (BigInt(segmentSum) - BigInt(overallValue)).toString();
        result[mode] = {
            overallPaise: overallValue,
            segmentSumPaise: segmentSum,
            deltaPaise: delta,
            status: delta === "0" ? "PASS" : "FAIL"
        };
    }
    return result;
}

function canonicalBillId(bill, index) {
    if (!bill || bill.billId === undefined || bill.billId === null || String(bill.billId).trim() === "") return `__missing_${index}`;
    return String(bill.billId);
}

function quantityForBill(bill) {
    if (!Array.isArray(bill.items)) return { available: false, value: null };
    let total = 0;
    for (const item of bill.items) {
        if (item.qty === undefined || item.qty === null || !Number.isSafeInteger(item.qty) || item.qty < 0) return { available: false, value: null };
        total += item.qty;
    }
    return { available: Number.isSafeInteger(total), value: total };
}

function segmentNetPaise(result, segment) {
    const coefficient = BigInt(result.weights[segment]);
    const scale = result.weightScale;
    if (scale <= 2) return (coefficient * 10n ** BigInt(2 - scale)).toString();
    const divisor = 10n ** BigInt(scale - 2);
    if (coefficient % divisor !== 0n) return null;
    return (coefficient / divisor).toString();
}

function buildConsolidatedPayload(input = {}) {
    const diagnostics = [];
    const affectedBills = new Set();
    const metadata = input.metadata && typeof input.metadata === "object" ? input.metadata : {};
    const bills = Array.isArray(input.bills) ? input.bills : null;
    const overall = normalizeOverall(input.overall, diagnostics);

    const metadataFields = ["businessDate", "closingId", "closeSequence", "closedAt"];
    for (const field of metadataFields) {
        if (metadata[field] === undefined || metadata[field] === null || String(metadata[field]).trim() === "") {
            diagnostics.push({ code: "INVALID_METADATA", field, message: `${field} is required.` });
        }
    }
    const requiredOverallPayments = REQUIRED_PAYMENT_FIELDS;
    for (const field of requiredOverallPayments) {
        if (overall[field] === undefined || overall[field] === null) diagnostics.push({ code: "INVALID_OVERALL_VALUE", field, message: `${field} is required for reconciliation.` });
    }

    const segments = emptySegments();
    const groups = new Map();
    if (bills) {
        bills.forEach((bill, index) => {
            const id = canonicalBillId(bill, index);
            if (!groups.has(id)) groups.set(id, []);
            groups.get(id).push({ bill, index });
        });
    } else diagnostics.push({ code: "UNAVAILABLE_BILL_POPULATION", message: "bills must be an explicit array." });

    const billEntries = [];
    if (bills) {
        for (const [id, entries] of groups.entries()) {
            if (entries.length > 1) {
                affectedBills.add(id);
                diagnostics.push({ code: "DUPLICATE_BILL", billId: id, message: "Duplicate bill identity was supplied; no duplicate entry was aggregated." });
                continue;
            }
            billEntries.push({ id, ...entries[0] });
        }
    }
    billEntries.sort((left, right) => left.id.localeCompare(right.id));

    for (const entry of billEntries) {
        const result = allocateBill(entry.bill);
        if (result.status !== "COMPLETE") {
            affectedBills.add(entry.id);
            for (const item of result.diagnostics.filter(value => value.severity !== "INFO")) diagnostics.push({ ...item, billId: entry.id });
            diagnostics.push({ code: "INCOMPLETE_ALLOCATION", billId: entry.id, message: "Bill allocation is not authoritative." });
            continue;
        }
        const quantity = quantityForBill(entry.bill);
        for (const segment of result.participatingSegments) {
            const target = segments[segment];
            target.bills += 1;
            if (quantity.available) target.qtySold = (target.qtySold === null ? 0 : target.qtySold) + entry.bill.items.reduce((sum, item) => sum + (item.businessSegment === segment ? item.qty : 0), 0);
            const netPaise = segmentNetPaise(result, segment);
            if (netPaise === null) target.netContributionPaise = null;
            else if (target.netContributionPaise !== null) target.netContributionPaise = addPaise(target.netContributionPaise, netPaise);
            for (const field of SEGMENT_PAYMENT_FIELDS) target[field] = addPaise(target[field], result.allocations[segment][field]);
        }
        billEntries.find(value => value.id === entry.id).result = result;
    }

    if (bills && bills.length === 0) diagnostics.push({ code: "EMPTY_BILL_POPULATION", message: "An explicit empty bill population was supplied.", severity: "INFO" });
    const paymentReconciliation = buildReconciliation(overall, segments);
    for (const [mode, reconciliation] of Object.entries(paymentReconciliation)) {
        if (reconciliation.status === "FAIL") diagnostics.push({ code: "OVERALL_RECONCILIATION_FAILED", mode, message: `${mode} does not reconcile to Overall authority.` });
    }

    const blockingDiagnostics = diagnostics.filter(value => value.severity !== "INFO");
    const hasUnavailable = !bills || blockingDiagnostics.some(value => value.code === "UNAVAILABLE_BILL_POPULATION");
    const hasFailedReconciliation = Object.values(paymentReconciliation).some(value => value.status === "FAIL");
    const allReconciliationsApplicable = Object.values(paymentReconciliation).every(value => value.status === "PASS");
    const status = hasUnavailable ? "UNAVAILABLE" : blockingDiagnostics.length || hasFailedReconciliation || !allReconciliationsApplicable ? "INCOMPLETE" : "COMPLETE";
    const reportStatus = status === "COMPLETE" ? "FINAL" : status;
    const orderedDiagnostics = sortDiagnostics(diagnostics);
    const orderedAffectedBills = [...affectedBills].sort((left, right) => left.localeCompare(right));

    return {
        contractVersion: CONTRACT_VERSION,
        snapshotVersion: SNAPSHOT_VERSION,
        businessDate: metadata.businessDate == null ? null : String(metadata.businessDate),
        closingId: metadata.closingId == null ? null : String(metadata.closingId),
        closeSequence: metadata.closeSequence == null ? null : String(metadata.closeSequence),
        closedAt: metadata.closedAt == null ? null : String(metadata.closedAt),
        ...(metadata.klbsVersion == null ? {} : { klbsVersion: String(metadata.klbsVersion) }),
        reportStatus,
        dataQuality: { status, diagnostics: orderedDiagnostics, affectedBills: orderedAffectedBills },
        overall,
        segments,
        paymentReconciliation,
        sourceAudit: {
            billPopulation: "explicit supplied authoritative bills",
            allocationUnit: "INDIVIDUAL_BILL",
            itemWeightSource: "bill_items.net_amount",
            operationalSegmentSource: "bill_items.business_segment",
            paymentSources: {
                cash: "bills.cash_amount",
                upi: "bills.upi_amount",
                card: "bills.card_amount",
                storeCreditRedeemed: "bills.store_credit_amount",
                giftVoucherRedeemed: "bills.gift_voucher_amount"
            },
            deferredSegmentMetrics: ["gross", "discount", "returns", "creditNotes"]
        }
    };
}

module.exports = {
    CONTRACT_VERSION,
    SNAPSHOT_VERSION,
    buildConsolidatedPayload,
    canonicalizeSemanticPayload,
    hashSemanticPayload,
    formatPaise
};
