const assert = require("assert");
const { allocateBill } = require("../src/shared/segmentPaymentAllocator");

const ZERO = "0";

function bill(items, payments = {}, extra = {}) {
    const paymentInput = value => {
        if (typeof value !== "string" || !/^-?\d+$/.test(value)) return value;
        const paise = BigInt(value);
        const negative = paise < 0n;
        const absolute = negative ? -paise : paise;
        const text = absolute.toString().padStart(3, "0");
        return `${negative ? "-" : ""}${text.slice(0, -2)}.${text.slice(-2)}`;
    };
    return allocateBill({
        billId: extra.billId || "B-C1A",
        billNo: extra.billNo || "C1A-001",
        items,
        payments: {
            cash: paymentInput(payments.cash === undefined ? "0" : payments.cash),
            upi: paymentInput(payments.upi === undefined ? "0" : payments.upi),
            card: paymentInput(payments.card === undefined ? "0" : payments.card),
            storeCreditRedeemed: paymentInput(payments.storeCreditRedeemed === undefined ? "0" : payments.storeCreditRedeemed),
            giftVoucherRedeemed: paymentInput(payments.giftVoucherRedeemed === undefined ? "0" : payments.giftVoucherRedeemed)
        },
        ...(extra.billNet === undefined ? {} : { billNet: extra.billNet })
    });
}

function item(segment, netAmount, itemId = "I") {
    return { itemId, businessSegment: segment, netAmount };
}

function paise(result, segment, mode) {
    return result.allocations[segment][`${mode}Paise`];
}

function assertComplete(result) {
    assert.strictEqual(result.status, "COMPLETE", JSON.stringify(result));
    for (const mode of ["cash", "upi", "card", "storeCreditRedeemed", "giftVoucherRedeemed"]) {
        assert.strictEqual(result.reconciliation[mode].status, "PASS", JSON.stringify(result));
    }
}

function assertMode(result, mode, expected, name = "") {
    for (const [segment, value] of Object.entries(expected)) assert.strictEqual(paise(result, segment, mode), String(value), `${name} ${segment} ${mode}`);
}

function testValidCases() {
    const cases = [
        ["01 KL Cash", [item("KL", "100")], { cash: "10" }, "cash", { KL: "10", MENS: ZERO, KIDS: ZERO }],
        ["02 MENS UPI", [item("MENS", "100")], { upi: "11" }, "upi", { KL: ZERO, MENS: "11", KIDS: ZERO }],
        ["03 KIDS Card", [item("KIDS", "100")], { card: "12" }, "card", { KL: ZERO, MENS: ZERO, KIDS: "12" }],
        ["04 KL Cash plus UPI", [item("KL", "100")], { cash: "10", upi: "11" }, "cash", { KL: "10", MENS: ZERO, KIDS: ZERO }],
        ["05 KL MENS Cash", [item("KL", "1"), item("MENS", "2")], { cash: "10" }, "cash", { KL: "3", MENS: "7", KIDS: ZERO }],
        ["06 KL MENS Cash plus UPI", [item("KL", "1"), item("MENS", "2")], { cash: "10", upi: "11" }, "upi", { KL: "4", MENS: "7", KIDS: ZERO }],
        ["07 KL KIDS UPI plus Card", [item("KL", "2"), item("KIDS", "3")], { upi: "11", card: "7" }, "card", { KL: "3", MENS: ZERO, KIDS: "4" }],
        ["08 MENS KIDS Cash plus Card", [item("MENS", "2"), item("KIDS", "3")], { cash: "11", card: "7" }, "cash", { KL: ZERO, MENS: "4", KIDS: "7" }],
        ["09 all Cash", [item("KL", "1"), item("MENS", "1"), item("KIDS", "1")], { cash: "10" }, "cash", { KL: "4", MENS: "3", KIDS: "3" }],
        ["10 all three modes", [item("KL", "1"), item("MENS", "1"), item("KIDS", "1")], { cash: "10", upi: "11", card: "12" }, "card", { KL: "4", MENS: "4", KIDS: "4" }],
        ["11 KL MENS SC", [item("KL", "100"), item("MENS", "100")], { storeCreditRedeemed: "100" }, "storeCreditRedeemed", { KL: "50", MENS: "50", KIDS: ZERO }],
        ["12 KL KIDS GV", [item("KL", "100"), item("KIDS", "100")], { giftVoucherRedeemed: "101" }, "giftVoucherRedeemed", { KL: "51", MENS: ZERO, KIDS: "50" }],
        ["13 MENS KIDS Cash plus SC", [item("MENS", "2"), item("KIDS", "3")], { cash: "11", storeCreditRedeemed: "10" }, "storeCreditRedeemed", { KL: ZERO, MENS: "5", KIDS: "5" }],
        ["14 all SC", [item("KL", "1"), item("MENS", "1"), item("KIDS", "1")], { storeCreditRedeemed: "10000" }, "storeCreditRedeemed", { KL: "3334", MENS: "3333", KIDS: "3333" }],
        ["15 all GV", [item("KL", "1"), item("MENS", "1"), item("KIDS", "1")], { giftVoucherRedeemed: "10000" }, "giftVoucherRedeemed", { KL: "3334", MENS: "3333", KIDS: "3333" }],
        ["16 all five", [item("KL", "1"), item("MENS", "2"), item("KIDS", "3")], { cash: "10", upi: "11", card: "12", storeCreditRedeemed: "13", giftVoucherRedeemed: "14" }, "giftVoucherRedeemed", { KL: "5", MENS: "5", KIDS: "4" }],
        ["17 uneven two-way", [item("KL", "2"), item("MENS", "3")], { cash: "1" }, "cash", { KL: ZERO, MENS: "1", KIDS: ZERO }],
        ["18 uneven three-way", [item("KL", "1"), item("MENS", "2"), item("KIDS", "3")], { cash: "10" }, "cash", { KL: "2", MENS: "3", KIDS: "5" }],
        ["19 highly unequal", [item("KL", "1"), item("MENS", "999")], { cash: "100" }, "cash", { KL: ZERO, MENS: "100", KIDS: ZERO }],
        ["20 tiny plus large", [item("KL", "1"), item("KIDS", "1000000")], { card: "1" }, "card", { KL: ZERO, MENS: ZERO, KIDS: "1" }],
        ["21 fully SC", [item("KL", "100"), item("MENS", "200")], { storeCreditRedeemed: "300" }, "storeCreditRedeemed", { KL: "150", MENS: "150", KIDS: ZERO }],
        ["22 fully GV", [item("KL", "100"), item("KIDS", "200")], { giftVoucherRedeemed: "300" }, "giftVoucherRedeemed", { KL: "150", MENS: ZERO, KIDS: "150" }],
        ["23 SC plus GV only", [item("KL", "100"), item("MENS", "200")], { storeCreditRedeemed: "101", giftVoucherRedeemed: "99" }, "giftVoucherRedeemed", { KL: "50", MENS: "49", KIDS: ZERO }],
        ["24 zero-net beside positive", [item("KL", "100"), item("KL", "0"), item("MENS", "100")], { cash: "10" }, "cash", { KL: "5", MENS: "5", KIDS: ZERO }],
        ["25 one paise two", [item("KL", "1"), item("MENS", "1")], { cash: "0.01" }, "cash", { KL: "1", MENS: ZERO, KIDS: ZERO }],
        ["26 one paise three", [item("KL", "1"), item("MENS", "1"), item("KIDS", "1")], { cash: "0.01" }, "cash", { KL: "1", MENS: ZERO, KIDS: ZERO }],
        ["27 two paise three", [item("KL", "1"), item("MENS", "1"), item("KIDS", "1")], { upi: "0.02" }, "upi", { KL: "1", MENS: "1", KIDS: ZERO }],
        ["28 equal tie", [item("KL", "1"), item("MENS", "1"), item("KIDS", "1")], { cash: "0.02" }, "cash", { KL: "1", MENS: "1", KIDS: ZERO }],
        ["29 MENS largest remainder", [item("KL", "2"), item("MENS", "3")], { cash: "0.01" }, "cash", { KL: ZERO, MENS: "1", KIDS: ZERO }],
        ["30 KIDS largest remainder", [item("KL", "2"), item("KIDS", "3")], { cash: "0.01" }, "cash", { KL: ZERO, MENS: ZERO, KIDS: "1" }],
        ["31 SC one paise three", [item("KL", "1"), item("MENS", "1"), item("KIDS", "1")], { storeCreditRedeemed: "0.01" }, "storeCreditRedeemed", { KL: "1", MENS: ZERO, KIDS: ZERO }],
        ["32 GV two paise three", [item("KL", "1"), item("MENS", "1"), item("KIDS", "1")], { giftVoucherRedeemed: "0.02" }, "giftVoucherRedeemed", { KL: "1", MENS: "1", KIDS: ZERO }],
        ["33 MENS KIDS SC residual", [item("MENS", "1"), item("KIDS", "1")], { storeCreditRedeemed: "0.01" }, "storeCreditRedeemed", { KL: ZERO, MENS: "1", KIDS: ZERO }]
    ];
    for (const [name, items, payments, mode, expected] of cases) {
        const result = bill(items, payments, { billId: name });
        assertComplete(result);
        assertMode(result, mode, expected, name);
    }
    const allFive = bill([item("KL", "1"), item("MENS", "2"), item("KIDS", "3")], { cash: "10", upi: "11", card: "12", storeCreditRedeemed: "13", giftVoucherRedeemed: "14" });
    assertComplete(allFive);
    for (const mode of ["cash", "upi", "card", "storeCreditRedeemed", "giftVoucherRedeemed"]) assert.strictEqual(allFive.reconciliation[mode].status, "PASS");
    const billA = bill([item("KL", "100")], { storeCreditRedeemed: "500" }, { billId: "A" });
    const billB = bill([item("KL", "100"), item("MENS", "100")], { storeCreditRedeemed: "500" }, { billId: "B" });
    assertComplete(billA); assertComplete(billB);
    assert.strictEqual(paise(billA, "KL", "storeCreditRedeemed"), "500");
    assert.strictEqual(paise(billB, "KL", "storeCreditRedeemed"), "250");
    assert.strictEqual(paise(billB, "MENS", "storeCreditRedeemed"), "250");
}

function testInvalidAndEdgeCases() {
    const invalidCases = [
        ["unknown segment", [item("WOMEN", "100")], { cash: "1" }, "INVALID_SEGMENT"],
        ["null segment", [item(null, "100")], { cash: "1" }, "MISSING_SEGMENT"],
        ["blank segment", [item("   ", "100")], { cash: "1" }, "MISSING_SEGMENT"],
        ["null item net", [item("KL", null)], { cash: "1" }, "INVALID_ITEM_NET"],
        ["malformed item net", [item("KL", "abc")], { cash: "1" }, "INVALID_ITEM_NET"],
        ["negative item net", [item("KL", "-1")], { cash: "1" }, "INVALID_ITEM_NET"],
        ["null payment", [item("KL", "100")], { cash: null }, "INVALID_PAYMENT_VALUE"],
        ["malformed payment", [item("KL", "100")], { cash: "abc" }, "INVALID_PAYMENT_VALUE"],
        ["negative payment", [item("KL", "100")], { cash: "-1" }, "INVALID_PAYMENT_VALUE"]
    ];
    for (const [name, items, payments, code] of invalidCases) {
        const result = bill(items, payments, { billId: name });
        assert.strictEqual(result.status, "INCOMPLETE", name);
        assert(result.diagnostics.some(diagnosticValue => diagnosticValue.code === code), name);
    }
    const zeroWeight = bill([item("KL", "0")], { cash: "1" });
    assert.strictEqual(zeroWeight.status, "INCOMPLETE");
    assert(zeroWeight.diagnostics.some(value => value.code === "ZERO_ALLOCATION_WEIGHT"));
    const zeroCash = bill([item("KL", "0")], { cash: "0" });
    assertComplete(zeroCash);
    assert(zeroCash.diagnostics.some(value => value.code === "NO_POSITIVE_CONTRIBUTION"));
    const allZero = bill([item("KL", "0")], {});
    assertComplete(allZero);
    const precision = bill([item("KL", "1.2345"), item("MENS", "2.3456")], { cash: "1.00" });
    assertComplete(precision);
    assert.strictEqual(precision.weightScale, 4);
    assert.deepStrictEqual(precision.weights, { KL: "12345", MENS: "23456", KIDS: "0" });
    assert.strictEqual(precision.itemNetTotal, "3.5801");
    assert.strictEqual(paise(precision, "KL", "cash"), "34");
    assert.strictEqual(paise(precision, "MENS", "cash"), "66");
    const roundingDiagnostic = bill([item("KL", "10.005"), item("MENS", "20.005")], { cash: "1" }, { billNet: "30.01" });
    assertComplete(roundingDiagnostic);
    assert.strictEqual(roundingDiagnostic.itemNetTotal, "30.01");
    assert.strictEqual(roundingDiagnostic.billNetDifference, "0");
    const zeroTender = bill([item("KL", "100"), item("MENS", "100")], { cash: "0", upi: "0", card: "0" });
    assertComplete(zeroTender);
    assertMode(zeroTender, "cash", { KL: ZERO, MENS: ZERO, KIDS: ZERO });
}

function testDeterminism() {
    const ordered = bill([item("KL", "1.25", "1"), item("MENS", "2.50", "2"), item("KIDS", "3.75", "3")], { cash: "10.01", upi: "8.02", card: "7.03", storeCreditRedeemed: "5.04", giftVoucherRedeemed: "6.05" });
    const shuffled = bill([item("KIDS", "3.75", "3"), item("KL", "1.25", "1"), item("MENS", "2.50", "2")], { cash: "10.01", upi: "8.02", card: "7.03", storeCreditRedeemed: "5.04", giftVoucherRedeemed: "6.05" });
    assert.deepStrictEqual(shuffled, ordered);
    assert.deepStrictEqual(bill([item("KL", "1.25"), item("MENS", "2.50"), item("KIDS", "3.75")], { cash: "10.01", upi: "8.02", card: "7.03", storeCreditRedeemed: "5.04", giftVoucherRedeemed: "6.05" }), ordered);
}

testValidCases();
testInvalidAndEdgeCases();
testDeterminism();
console.log("C1A Segment Payment Allocator tests: PASS (50 focused assertions/case groups)");
