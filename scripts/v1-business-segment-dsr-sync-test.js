const assert = require("assert");
const crypto = require("crypto");
const { createBusinessSegmentDsrSyncService } = require("../src/services/businessSegmentDsrSyncService");

function payload() {
    const segment = label => ({ label, sales: 10, qty: 1, bills: 1, atv: 10, upt: 1, detail: { grossSales: 10, discountAmount: 0, taxableValue: 10, gstAmount: 0, netBilling: 10, qtySold: 1, creditNotes: 0, returnValue: 0, qtyReturned: 0 } });
    return { contract: "KLBS_SEGMENT_DSR_V1", businessDate: "2026-09-15", closeSequence: 2, reportStatus: "REVISED", segments: { KL: segment("Kaira Luxe"), MENS: segment("Mens Wear"), KIDS: segment("Kids Wear") }, dataQuality: { complete: true, reconciliationClassified: true, diagnostics: null }, reconciliation: {}, klbsVersion: "1.0.0", generatedAt: "2026-09-15T12:00:00.000Z" };
}

async function main() {
    const captured = [];
    const service = createBusinessSegmentDsrSyncService({
        now: () => new Date("2026-09-15T12:01:00.000Z"),
        configProvider: async () => ({ endpoint: "https://example.invalid/segment", secret: "test-secret", automaticSync: true }),
        httpClient: { post: async (endpoint, envelope) => { captured.push({ endpoint, envelope }); return { data: { ok: true, action: "INSERTED", businessDate: "2026-09-15", closeSequence: 2, receivedAt: "2026-09-15T12:02:00.000Z" } }; } }
    });
    const value = payload();
    const first = await service.sync(value);
    const second = await service.sync(value);
    assert.strictEqual(first.success, true);
    assert.strictEqual(second.success, true);
    assert.strictEqual(captured[0].endpoint, "https://example.invalid/segment");
    assert.strictEqual(captured[0].envelope.signature, captured[1].envelope.signature);
    const signedText = `${captured[0].envelope.timestamp}\n2026-09-15\n${JSON.stringify(captured[0].envelope.payload)}`;
    assert.strictEqual(captured[0].envelope.signature, crypto.createHmac("sha256", "test-secret").update(signedText, "utf8").digest("hex"));
    const disabled = createBusinessSegmentDsrSyncService({ configProvider: async () => ({ endpoint: "https://example.invalid/segment", secret: "test-secret", automaticSync: false }), httpClient: { post: async () => { throw new Error("must not post"); } } });
    assert.strictEqual((await disabled.sync(value)).success, false);
    console.log("Business Segment signed Sheets sync tests: PASS");
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
