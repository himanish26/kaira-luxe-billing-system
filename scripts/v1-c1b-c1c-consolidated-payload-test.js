const assert = require("assert");
const {
    buildConsolidatedPayload,
    canonicalizeSemanticPayload,
    hashSemanticPayload,
    formatPaise
} = require("../src/shared/consolidatedDsrBuilder");

function item(segment, netAmount, itemId, qty = undefined) {
    return { itemId, businessSegment: segment, netAmount, ...(qty === undefined ? {} : { qty }) };
}

function makeBill(id, items, payments = {}) {
    return {
        billId: id,
        billNo: `C1-${id}`,
        items,
        payments: {
            cash: payments.cash === undefined ? "0" : payments.cash,
            upi: payments.upi === undefined ? "0" : payments.upi,
            card: payments.card === undefined ? "0" : payments.card,
            storeCreditRedeemed: payments.storeCreditRedeemed === undefined ? "0" : payments.storeCreditRedeemed,
            giftVoucherRedeemed: payments.giftVoucherRedeemed === undefined ? "0" : payments.giftVoucherRedeemed
        }
    };
}

function overall(values = {}) {
    return {
        totalBills: values.totalBills === undefined ? 1 : values.totalBills,
        qtySold: values.qtySold === undefined ? 0 : values.qtySold,
        grossSalesPaise: values.grossSalesPaise === undefined ? "0" : values.grossSalesPaise,
        totalDiscountPaise: values.totalDiscountPaise === undefined ? "0" : values.totalDiscountPaise,
        netBillingPaise: values.netBillingPaise === undefined ? "0" : values.netBillingPaise,
        creditNoteCount: values.creditNoteCount === undefined ? 0 : values.creditNoteCount,
        qtyReturned: values.qtyReturned === undefined ? 0 : values.qtyReturned,
        returnCnValuePaise: values.returnCnValuePaise === undefined ? "0" : values.returnCnValuePaise,
        netSalesAfterReturnsPaise: values.netSalesAfterReturnsPaise === undefined ? "0" : values.netSalesAfterReturnsPaise,
        cashPaise: values.cashPaise === undefined ? "0" : values.cashPaise,
        upiPaise: values.upiPaise === undefined ? "0" : values.upiPaise,
        cardPaise: values.cardPaise === undefined ? "0" : values.cardPaise,
        storeCreditRedeemedPaise: values.storeCreditRedeemedPaise === undefined ? "0" : values.storeCreditRedeemedPaise,
        giftVoucherRedeemedPaise: values.giftVoucherRedeemedPaise === undefined ? "0" : values.giftVoucherRedeemedPaise,
        ...(values.extra || {})
    };
}

function input(bills, payments = {}, metadata = {}, overallValues = {}) {
    return {
        metadata: {
            businessDate: metadata.businessDate || "2026-09-21",
            closingId: metadata.closingId || "10",
            closeSequence: metadata.closeSequence || "1",
            closedAt: metadata.closedAt || "2026-09-21T18:00:00.000Z",
            klbsVersion: metadata.klbsVersion || "1.0.0"
        },
        bills,
        overall: overall({ ...overallValues, ...payments })
    };
}

function assertPass(payload) {
    assert.strictEqual(payload.dataQuality.status, "COMPLETE", JSON.stringify(payload.dataQuality));
    assert.strictEqual(payload.reportStatus, "FINAL");
    for (const value of Object.values(payload.paymentReconciliation)) assert.strictEqual(value.status, "PASS");
}

function testAggregationAndPayload() {
    const bill1 = makeBill("1", [item("KL", "100", "1")], { storeCreditRedeemed: "500" });
    const bill2 = makeBill("2", [item("KL", "100", "2"), item("MENS", "100", "3")], { storeCreditRedeemed: "500" });
    const payload = buildConsolidatedPayload(input([bill1, bill2], {}, {}, {
        totalBills: 2,
        storeCreditRedeemedPaise: "100000",
        netBillingPaise: "30000",
        netSalesAfterReturnsPaise: "30000"
    }));
    assertPass(payload);
    assert.strictEqual(payload.segments.KL.storeCreditRedeemedPaise, "75000");
    assert.strictEqual(payload.segments.MENS.storeCreditRedeemedPaise, "25000");
    assert.strictEqual(payload.segments.KIDS.storeCreditRedeemedPaise, "0");
    assert.notStrictEqual(payload.segments.KL.storeCreditRedeemedPaise, "50000");
    assert.strictEqual(JSON.stringify(payload).includes("undefined"), false);
    assert.doesNotThrow(() => JSON.stringify(payload));

    const allFiveBills = [makeBill("3", [item("KL", "1", "4"), item("MENS", "2", "5"), item("KIDS", "3", "6")], {
        cash: "10", upi: "11", card: "12", storeCreditRedeemed: "13", giftVoucherRedeemed: "14"
    })];
    const allFive = buildConsolidatedPayload(input(allFiveBills, {}, {}, {
        totalBills: 1, cashPaise: "1000", upiPaise: "1100", cardPaise: "1200", storeCreditRedeemedPaise: "1300", giftVoucherRedeemedPaise: "1400"
    }));
    assertPass(allFive);
    assert.strictEqual(allFive.segments.KL.cashPaise, "167");
    assert.strictEqual(allFive.segments.MENS.cashPaise, "333");
    assert.strictEqual(allFive.segments.KIDS.cashPaise, "500");
}

function testIncompleteAndDuplicate() {
    const valid = makeBill("1", [item("KL", "100", "1")], { cash: "10" });
    const invalid = makeBill("2", [item(null, "100", "2")], { cash: "10" });
    const incomplete = buildConsolidatedPayload(input([valid, invalid], {}, {}, { totalBills: 2, cashPaise: "2000" }));
    assert.strictEqual(incomplete.dataQuality.status, "INCOMPLETE");
    assert(incomplete.dataQuality.affectedBills.includes("2"));
    assert(incomplete.dataQuality.diagnostics.some(value => value.code === "MISSING_SEGMENT"));
    assert(incomplete.dataQuality.diagnostics.some(value => value.code === "INCOMPLETE_ALLOCATION"));

    const duplicate = buildConsolidatedPayload(input([valid, valid], {}, {}, { totalBills: 2, cashPaise: "2000" }));
    assert.strictEqual(duplicate.dataQuality.status, "INCOMPLETE");
    assert(duplicate.dataQuality.diagnostics.some(value => value.code === "DUPLICATE_BILL"));
    assert.strictEqual(duplicate.segments.KL.cashPaise, "0");

    const mismatch = buildConsolidatedPayload(input([valid], {}, {}, { cashPaise: "9999" }));
    assert.strictEqual(mismatch.dataQuality.status, "INCOMPLETE");
    assert.strictEqual(mismatch.overall.cashPaise, "9999");
    assert(mismatch.dataQuality.diagnostics.some(value => value.code === "OVERALL_RECONCILIATION_FAILED"));

    const unavailable = buildConsolidatedPayload({ metadata: {}, overall: {}, bills: null });
    assert.strictEqual(unavailable.dataQuality.status, "UNAVAILABLE");
}

function testDeterminismAndHash() {
    const a = makeBill("1", [item("KL", "1", "1"), item("MENS", "2", "2")], { cash: "10" });
    const b = makeBill("2", [item("KIDS", "3", "3")], { upi: "10" });
    const baseInput = input([a, b], {}, {}, { totalBills: 2, cashPaise: "1000", upiPaise: "1000" });
    const first = buildConsolidatedPayload(baseInput);
    const shuffled = buildConsolidatedPayload(input([b, { ...a, items: [...a.items].reverse() }], {}, {}, { totalBills: 2, cashPaise: "1000", upiPaise: "1000" }));
    assert.strictEqual(canonicalizeSemanticPayload(first), canonicalizeSemanticPayload(shuffled));
    assert.strictEqual(hashSemanticPayload(first), hashSemanticPayload(shuffled));
    assert.strictEqual(hashSemanticPayload(first), hashSemanticPayload(buildConsolidatedPayload(baseInput)));
    assert.notStrictEqual(hashSemanticPayload(first), hashSemanticPayload(buildConsolidatedPayload(input([a, b], {}, { closingId: "11" }, { totalBills: 2, cashPaise: "1000", upiPaise: "1000" }))));
    assert.notStrictEqual(hashSemanticPayload(first), hashSemanticPayload(buildConsolidatedPayload(input([a, b], {}, { closeSequence: "2" }, { totalBills: 2, cashPaise: "1000", upiPaise: "1000" }))));
    const changed = makeBill("2", [item("KIDS", "3", "3")], { upi: "10.01" });
    assert.notStrictEqual(hashSemanticPayload(first), hashSemanticPayload(buildConsolidatedPayload(input([a, changed], {}, {}, { totalBills: 2, cashPaise: "1000", upiPaise: "1001" }))));
    assert.strictEqual(first.dataQuality.diagnostics.length, 0);
    assert.strictEqual(first.deliveryStatus, undefined);
}

function testFormatter() {
    assert.strictEqual(formatPaise("0"), "₹0.00");
    assert.strictEqual(formatPaise("1"), "₹0.01");
    assert.strictEqual(formatPaise("100"), "₹1.00");
    assert.strictEqual(formatPaise("3334"), "₹33.34");
    assert.strictEqual(formatPaise("123450"), "₹1,234.50");
    assert.strictEqual(formatPaise("12345678901234567890"), "₹123,456,789,012,345,678.90");
    assert.strictEqual(formatPaise("-1"), "-₹0.01");
}

testAggregationAndPayload();
testIncompleteAndDuplicate();
testDeterminismAndHash();
testFormatter();
console.log("C1B/C1C consolidated payload tests: PASS (50 focused assertions/case groups)");
