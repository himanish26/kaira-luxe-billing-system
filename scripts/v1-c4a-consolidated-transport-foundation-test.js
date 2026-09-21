const assert = require("assert");
const crypto = require("crypto");
const {
    TRANSPORT_VERSION,
    DOMAIN_LABEL,
    validateFrozenJob,
    signedMessage,
    signMessage,
    buildEnvelope,
    validateReceiverResponse,
    classifyTransportFailure,
    sha256Utf8
} = require("../src/services/consolidatedReportingTransport");

const TIMESTAMP = "2026-09-21T12:34:56.789Z";
const RECEIVED_AT = "2026-09-21T12:35:01.000Z";
const SECRET = "c4a-placeholder-secret";
const MODES = ["cash", "upi", "card", "storeCreditRedeemed", "giftVoucherRedeemed"];

function makePayload(overrides = {}) {
    return {
        contractVersion: 2,
        snapshotVersion: 2,
        businessDate: "2026-09-21",
        closingId: "7001",
        closeSequence: "3",
        closedAt: "2026-09-21T12:00:00.000Z",
        klbsVersion: "1.1.0",
        reportStatus: "FINAL",
        dataQuality: { status: "COMPLETE", diagnostics: [], affectedBills: [] },
        overall: { totalBills: 0, cashPaise: "0" },
        segments: {
            KL: { bills: 0, qtySold: null, netContributionPaise: null, cashPaise: "0", upiPaise: "0", cardPaise: "0", storeCreditRedeemedPaise: "0", giftVoucherRedeemedPaise: "0" },
            MENS: { bills: 0, qtySold: null, netContributionPaise: null, cashPaise: "0", upiPaise: "0", cardPaise: "0", storeCreditRedeemedPaise: "0", giftVoucherRedeemedPaise: "0" },
            KIDS: { bills: 0, qtySold: null, netContributionPaise: null, cashPaise: "0", upiPaise: "0", cardPaise: "0", storeCreditRedeemedPaise: "0", giftVoucherRedeemedPaise: "0" }
        },
        paymentReconciliation: Object.fromEntries(MODES.map(mode => [mode, { overallPaise: "0", segmentSumPaise: "0", deltaPaise: "0", status: "PASS" }])),
        sourceAudit: { billPopulation: "placeholder", allocationUnit: "INDIVIDUAL_BILL" },
        ...overrides
    };
}

function makeJob(payload = makePayload(), overrides = {}) {
    const payloadJson = JSON.stringify(payload);
    return {
        closing_id: payload.closingId,
        business_date: payload.businessDate,
        close_sequence: payload.closeSequence,
        payload_json: payloadJson,
        payload_hash: sha256Utf8(payloadJson),
        ...overrides
    };
}

function validSubmission() {
    return validateFrozenJob(makeJob());
}

function response(action, submission, overrides = {}) {
    return {
        ok: true,
        transportVersion: TRANSPORT_VERSION,
        action,
        businessDate: submission.businessDate,
        closingId: submission.closingId,
        closeSequence: submission.closeSequence,
        payloadHash: submission.payloadHash,
        receivedAt: RECEIVED_AT,
        ...overrides
    };
}

function assertCode(fn, code) {
    assert.throws(fn, error => error && error.code === code, `expected ${code}`);
}

function testPreflight() {
    const job = makeJob();
    const validated = validateFrozenJob(job);
    assert.strictEqual(validated.payloadJson, job.payload_json);
    assert.strictEqual(validated.payloadHash, job.payload_hash);
    assert.strictEqual(validated.businessDate, "2026-09-21");
    assert.strictEqual(validated.closingId, "7001");
    assert.strictEqual(validated.closeSequence, "3");
    assert.strictEqual(sha256Utf8(job.payload_json), job.payload_hash);
    assertCode(() => validateFrozenJob({ ...job, payload_json: `${job.payload_json} ` }), "PAYLOAD_HASH_MISMATCH");
    assertCode(() => validateFrozenJob({ ...job, payload_hash: "A".repeat(64) }), "INVALID_PAYLOAD_HASH");
    assertCode(() => validateFrozenJob({ ...job, business_date: "2026-09-20" }), "IDENTITY_MISMATCH");
    assertCode(() => validateFrozenJob({ ...job, closing_id: "7002" }), "IDENTITY_MISMATCH");
    assertCode(() => validateFrozenJob({ ...job, close_sequence: "4" }), "IDENTITY_MISMATCH");
    assertCode(() => validateFrozenJob(makeJob({ ...makePayload(), contractVersion: 1 })), "UNSUPPORTED_CONTRACT_VERSION");
    assertCode(() => validateFrozenJob(makeJob({ ...makePayload(), snapshotVersion: 1 })), "UNSUPPORTED_SNAPSHOT_VERSION");
    assertCode(() => validateFrozenJob(makeJob({ ...makePayload(), reportStatus: "INCOMPLETE" })), "REPORT_NOT_FINAL");
    assertCode(() => validateFrozenJob(makeJob({ ...makePayload(), dataQuality: { status: "INCOMPLETE" } })), "DATA_QUALITY_NOT_COMPLETE");
    for (const mode of MODES) {
        const reconciliation = Object.fromEntries(MODES.map(name => [name, { status: "PASS" }]));
        reconciliation[mode] = { status: "FAIL" };
        assertCode(() => validateFrozenJob(makeJob({ ...makePayload(), paymentReconciliation: reconciliation })), "PAYMENT_RECONCILIATION_FAILED");
    }
    assertCode(() => validateFrozenJob({ ...job, payload_json: "not-json" }), "INVALID_PAYLOAD_JSON");
    assertCode(() => validateFrozenJob({ ...job, payload_json: "   " }), "INVALID_PAYLOAD_JSON");
}

function testSignedMessageAndHmac() {
    const submission = validSubmission();
    const expected = [DOMAIN_LABEL, "1", TIMESTAMP, "2026-09-21", "7001", "3", submission.payloadHash].join("\n");
    const actual = signedMessage({ transportVersion: 1, timestamp: TIMESTAMP, payload: submission.payload, payloadHash: submission.payloadHash });
    assert.strictEqual(actual, expected);
    assert.strictEqual(actual.endsWith("\n"), false);
    assert.strictEqual(actual.split("\n").length, 7);
    assert.strictEqual(signMessage("The quick brown fox jumps over the lazy dog", "key"), "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
    assertCode(() => signMessage(actual, ""), "MISSING_SECRET");
    assertCode(() => signedMessage({ transportVersion: 1, timestamp: "2026-09-21", payload: submission.payload, payloadHash: submission.payloadHash }), "INVALID_TIMESTAMP");
}

function testEnvelope() {
    const submission = validSubmission();
    const envelope = buildEnvelope(submission, TIMESTAMP, SECRET);
    assert.deepStrictEqual(Object.keys(envelope), ["transportVersion", "timestamp", "payload", "payloadHash", "signature"]);
    assert.strictEqual(envelope.transportVersion, 1);
    assert.strictEqual(envelope.timestamp, TIMESTAMP);
    assert.strictEqual(envelope.payload, submission.payload);
    assert.strictEqual(envelope.payloadHash, submission.payloadHash);
    assert.match(envelope.signature, /^[0-9a-f]{64}$/);
    assertCode(() => buildEnvelope(submission, "2026-09-21T12:34:56Z", SECRET), "INVALID_TIMESTAMP");
}

function testResponses() {
    const submission = validSubmission();
    for (const action of ["INSERTED", "UPDATED", "UNCHANGED"]) {
        const result = validateReceiverResponse(response(action, submission), submission);
        assert.strictEqual(result.classification, "DELIVERED");
        assert.strictEqual(result.retryable, false);
        assert.strictEqual(result.delivered, true);
    }
    const stale = validateReceiverResponse(response("STALE", submission), submission);
    assert.strictEqual(stale.code, "STALE_SUPERSEDED");
    assert.strictEqual(stale.retryable, false);
    assert.strictEqual(stale.delivered, false);
    for (const [action, code] of [["CONFLICT", "CONFLICT"], ["REJECTED", "REJECTED"], ["AUTHENTICATION_FAILED", "AUTHENTICATION_FAILED"]]) {
        const result = validateReceiverResponse({ ok: false, transportVersion: 1, action, errorCode: code, message: "safe placeholder" }, submission);
        assert.strictEqual(result.code, code);
        assert.strictEqual(result.retryable, false);
        assert.strictEqual(result.delivered, false);
    }
    assert.strictEqual(validateReceiverResponse({ ok: true, transportVersion: 1, action: "INSERTED" }, submission).code, "INVALID_RESPONSE");
    assert.strictEqual(validateReceiverResponse(response("UPDATED", submission, { businessDate: "2026-09-20" }), submission).code, "INVALID_RESPONSE");
    assert.strictEqual(validateReceiverResponse(response("UPDATED", submission, { payloadHash: "0".repeat(64) }), submission).code, "INVALID_RESPONSE");
    const secretResult = validateReceiverResponse({ ok: false, transportVersion: 1, action: "REJECTED", errorCode: "REJECTED", message: SECRET }, submission);
    assert.strictEqual(secretResult.message.includes(SECRET), false);
}

function testTransportClassification() {
    for (const status of [408, 429, 500, 502, 599]) assert.strictEqual(classifyTransportFailure({ status }).retryable, true);
    for (const status of [400, 401, 403, 404, 405, 409, 415, 422, 499]) assert.strictEqual(classifyTransportFailure({ status }).retryable, false);
    assert.strictEqual(classifyTransportFailure({ status: 409 }).code, "CONFLICT");
    for (const error of [{ code: "ECONNABORTED" }, { code: "ETIMEDOUT" }, { code: "ECONNRESET" }, { code: "ERR_TLS_CERT_ALTNAME_INVALID" }, { message: "network unavailable" }]) {
        assert.strictEqual(classifyTransportFailure({ error }).code, "RETRYABLE_TRANSPORT_FAILURE");
        assert.strictEqual(classifyTransportFailure({ error }).retryable, true);
    }
    assert.strictEqual(classifyTransportFailure({ error: { message: SECRET } }).message.includes(SECRET), false);
}

testPreflight();
testSignedMessageAndHmac();
testEnvelope();
testResponses();
testTransportClassification();
console.log("C4A consolidated transport foundation tests: PASS");
