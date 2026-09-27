const assert = require("assert");
const {
    classifyTransportFailure,
    validateReceiverResponse
} = require("../src/services/consolidatedReportingTransport");

const submitted = {
    payload: { businessDate: "2026-09-27", closingId: "14", closeSequence: "3" },
    payloadHash: "4277a6521806a768e0c0835bf46d4541c3d965f86c96b400856c3315107537c1"
};
const response = (action, extra = {}) => ({
    ok: true,
    transportVersion: 1,
    action,
    businessDate: submitted.payload.businessDate,
    closingId: submitted.payload.closingId,
    closeSequence: submitted.payload.closeSequence,
    payloadHash: submitted.payloadHash,
    receivedAt: "2026-09-27T12:13:04.589Z",
    ...extra
});

for (const action of ["INSERTED", "UPDATED", "UNCHANGED"]) {
    assert.strictEqual(validateReceiverResponse(response(action), submitted).code, "DELIVERED");
}
assert.strictEqual(validateReceiverResponse(response("STALE"), submitted).code, "STALE_SUPERSEDED");
for (const mutate of [
    { businessDate: "2026-09-26" }, { closingId: "13" }, { closeSequence: "2" }, { payloadHash: "0".repeat(64) }
]) assert.strictEqual(validateReceiverResponse(response("UNCHANGED", mutate), submitted).code, "INVALID_RESPONSE");

const v18 = validateReceiverResponse({
    ok: false, transportVersion: 1, action: "REJECTED", errorCode: "REJECTED", message: "Rejected"
}, submitted);
assert.strictEqual(v18.code, "REJECTED");
const v19 = validateReceiverResponse({
    ok: false, transportVersion: 1, action: "CONFLICT", errorCode: "CONFLICT",
    reasonCode: "C4D_E_PERSISTED_IDENTITY_MISMATCH", message: "Conflict"
}, submitted);
assert.strictEqual(v19.code, "CONFLICT");
assert.strictEqual(v19.reasonCode, "C4D_E_PERSISTED_IDENTITY_MISMATCH");
assert.strictEqual(validateReceiverResponse({
    ok: false, transportVersion: 1, action: "REJECTED", errorCode: "REJECTED",
    reasonCode: "unsafe value", message: "Rejected"
}, submitted).code, "INVALID_RESPONSE");
assert.strictEqual(validateReceiverResponse({
    ok: false, transportVersion: 1, action: "REJECTED", errorCode: "REJECTED",
    message: "Rejected", unexpected: true
}, submitted).code, "INVALID_RESPONSE");
assert.strictEqual(validateReceiverResponse(response("UNCHANGED", { reasonCode: "C4D_E_UNEXPECTED" }), submitted).code, "INVALID_RESPONSE");
assert.strictEqual(classifyTransportFailure({ error: Object.assign(new Error("opaque"), { code: "ERR_NOT_SUPPORT" }) }).code, "INVALID_RESPONSE");
console.log("C4D response contract regression tests: PASS (V18/V19, success identity, actions, and failures)");
