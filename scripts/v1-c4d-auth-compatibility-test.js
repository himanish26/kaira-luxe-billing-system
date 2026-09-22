const assert = require("assert");
const crypto = require("crypto");
const {
    canonicalizeSemanticPayload,
    buildConsolidatedPayload
} = require("../src/shared/consolidatedDsrBuilder");
const {
    DOMAIN_LABEL,
    buildEnvelope,
    sha256Utf8,
    signedMessage,
    validateFrozenJob
} = require("../src/services/consolidatedReportingTransport");

const FAKE_SECRET = "C4D_TEST_SECRET_DO_NOT_USE_IN_PRODUCTION";
const TIMESTAMP = "2026-09-22T10:20:30.000Z";

function googleCanonicalize(value, parentKey = null) {
    if (value === null) return "null";
    if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
    if (typeof value === "number") {
        assert(Number.isFinite(value), "test vector contains a non-finite number");
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) return `[${value.map(item => googleCanonicalize(item, parentKey)).join(",")}]`;
    assert(value && typeof value === "object", "test vector contains an unsupported value");
    const preferred = parentKey === "segments" ? ["KL", "MENS", "KIDS"] : [];
    const keys = Object.keys(value).sort((left, right) => {
        const leftIndex = preferred.indexOf(left);
        const rightIndex = preferred.indexOf(right);
        if (leftIndex !== -1 || rightIndex !== -1) {
            return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex);
        }
        return left < right ? -1 : left > right ? 1 : 0;
    });
    return `{${keys.map(key => `${JSON.stringify(key)}:${googleCanonicalize(value[key], key)}`).join(",")}}`;
}

function googlePayloadHash(payload) {
    return crypto.createHash("sha256").update(googleCanonicalize(payload), "utf8").digest("hex");
}

function googleSignedMessage(payload, payloadHash) {
    return [
        DOMAIN_LABEL,
        "1",
        TIMESTAMP,
        payload.businessDate,
        String(payload.closingId),
        String(payload.closeSequence),
        payloadHash
    ].join("\n");
}

function googleSignature(message) {
    return crypto.createHmac("sha256", FAKE_SECRET).update(message, "utf8").digest("hex");
}

function representativePayload() {
    return buildConsolidatedPayload({
        metadata: {
            businessDate: "2026-09-22",
            closingId: "9107",
            closeSequence: "4",
            closedAt: "2026-09-22T10:00:00.000Z",
            klbsVersion: "1.1.0"
        },
        overall: {
            totalBills: 0,
            cashPaise: "0",
            upiPaise: "0",
            cardPaise: "0",
            storeCreditRedeemedPaise: "0",
            giftVoucherRedeemedPaise: "0"
        },
        bills: []
    });
}

function run() {
    const payload = representativePayload();
    const windowsCanonical = canonicalizeSemanticPayload(payload);
    const googleCanonical = googleCanonicalize(payload);
    const windowsHash = sha256Utf8(windowsCanonical);
    const googleHash = googlePayloadHash(payload);
    const job = {
        payload_json: windowsCanonical,
        payload_hash: windowsHash,
        business_date: payload.businessDate,
        closing_id: payload.closingId,
        close_sequence: payload.closeSequence
    };
    const validated = validateFrozenJob(job);
    const windowsEnvelope = buildEnvelope(validated, TIMESTAMP, FAKE_SECRET);
    const windowsMessage = signedMessage({
        transportVersion: windowsEnvelope.transportVersion,
        timestamp: TIMESTAMP,
        payload,
        payloadHash: windowsEnvelope.payloadHash
    });
    const googleMessage = googleSignedMessage(payload, googleHash);
    const googleSignatureValue = googleSignature(googleMessage);

    assert.strictEqual(windowsCanonical, googleCanonical, "A: canonical payload string mismatch");
    assert.strictEqual(windowsHash, googleHash, "B: payloadHash mismatch");
    assert.strictEqual(windowsMessage, googleMessage, "C: signed message mismatch");
    assert.strictEqual(windowsEnvelope.signature, googleSignatureValue, "D: HMAC signature mismatch");
    assert.deepStrictEqual({
        canonicalPayload: windowsCanonical,
        payloadHash: windowsHash,
        signedMessage: windowsMessage,
        signature: windowsEnvelope.signature
    }, {
        canonicalPayload: googleCanonical,
        payloadHash: googleHash,
        signedMessage: googleMessage,
        signature: googleSignatureValue
    });
    console.log("C4D offline cross-implementation authentication vector: PASS");
    console.log(JSON.stringify({
        canonicalPayload: windowsCanonical,
        payloadHash: windowsHash,
        signedMessage: windowsMessage,
        signature: windowsEnvelope.signature
    }, null, 2));
}

run();
