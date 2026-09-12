const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => db.run(sql, params, function (error) {
        error ? reject(error) : resolve(this);
    }));
}

function get(db, sql, params = []) {
    return new Promise((resolve, reject) => db.get(sql, params, (error, row) => {
        error ? reject(error) : resolve(row);
    }));
}

function close(db) {
    return new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
}

async function insertProduct(db, barcode, mrp) {
    await run(db, `INSERT INTO products
        (barcode, sku, brand, product_name, mrp, discount, selling_price, gst_rate, opening_stock, active)
        VALUES (?, ?, 'ROUNDING', ?, ?, 0, ?, 12, 50, 1)`,
    [barcode, barcode, barcode, mrp, mrp]);
    await run(db, `INSERT INTO inventory_transactions
        (product_id, barcode, transaction_type, quantity, reference_type, reference_id, remarks, created_by, created_at)
        SELECT id, barcode, 'OPENING', 50, 'ROUNDING_TEST', ?, 'Disposable rounding test', 'TEST', datetime('now')
        FROM products WHERE barcode = ?`, [barcode, barcode]);
}

async function insertStoreCredit(db, storeCreditNo, mobile, amount, options = {}) {
    const returnNo = `RETURN-${storeCreditNo}`;
    const originalBillNo = `ORIGINAL-${storeCreditNo}`;
    await run(db, `INSERT INTO returns
        (return_no, original_bill_no, business_date, original_bill_date, customer_name,
         customer_mobile, return_reason, return_amount, created_at)
        VALUES (?, ?, date('now'), date('now'), 'Rounding Test', ?, 'Disposable test', ?, datetime('now'))`,
    [returnNo, originalBillNo, mobile, amount]);
    await run(db, `INSERT INTO store_credits
        (store_credit_no, return_id, original_bill_no, customer_name, customer_mobile,
         issue_date, valid_until, original_amount, remaining_balance, status, created_at)
        VALUES (?, (SELECT id FROM returns WHERE return_no = ?), ?, 'Rounding Test', ?,
                date('now'), ?, ?, ?, ?, datetime('now'))`,
    [
        storeCreditNo,
        returnNo,
        originalBillNo,
        mobile,
        options.validUntil || "2099-12-31",
        amount,
        amount,
        options.status || "ISSUED"
    ]);
}

function payload(billNo, barcode, mobile, payment = {}) {
    return {
        bill_no: billNo,
        bill_time: "10:00:00 AM",
        customer_name: "Rounding Test",
        customer_mobile: mobile,
        cash_amount: payment.cash || 0,
        upi_amount: payment.upi || 0,
        card_amount: payment.card || 0,
        gift_voucher_amount: payment.giftVoucher || 0,
        store_credit: payment.storeCredit || null,
        items: [{
            barcode,
            product_name: "Renderer values are not authoritative",
            qty: 1,
            mrp: 1,
            discount: 0,
            gst_rate: 1,
            ff_discount: ["P-518", "P-615"].includes(barcode) ? 12 : null
        }]
    };
}

async function assertBill(db, billNo, expected) {
    const bill = await get(db, `SELECT net_amount, cash_amount, upi_amount, card_amount,
        store_credit_amount, gift_voucher_amount FROM bills WHERE bill_no = ?`, [billNo]);
    assert.deepStrictEqual(bill, {
        net_amount: expected.net,
        cash_amount: expected.cash || 0,
        upi_amount: expected.upi || 0,
        card_amount: expected.card || 0,
        store_credit_amount: expected.storeCredit || 0,
        gift_voucher_amount: expected.giftVoucher || 0
    });
}

async function assertRedeemed(db, billNo, storeCreditNo, expected) {
    const credit = await get(db, `SELECT status, remaining_balance FROM store_credits
        WHERE store_credit_no = ?`, [storeCreditNo]);
    assert.deepStrictEqual(credit, { status: "REDEEMED", remaining_balance: 0 });
    const ledger = await get(db, `SELECT transaction_type, amount, reference_type, reference_id
        FROM customer_credit_transactions WHERE reference_id = ?`, [billNo]);
    assert.deepStrictEqual(ledger, {
        transaction_type: "CREDIT_REDEEMED",
        amount: -expected,
        reference_type: "BILL",
        reference_id: billNo
    });
}

async function assertRejectedUntouched(db, billNo, storeCreditNo, amount) {
    assert.strictEqual(await get(db, "SELECT 1 AS found FROM bills WHERE bill_no = ?", [billNo]), undefined);
    if (storeCreditNo) {
        assert.deepStrictEqual(await get(db, `SELECT status, remaining_balance FROM store_credits
            WHERE store_credit_no = ?`, [storeCreditNo]), { status: "ISSUED", remaining_balance: amount });
    }
    assert.strictEqual((await get(db, `SELECT COUNT(*) AS count FROM inventory_transactions
        WHERE reference_type = 'BILL' AND reference_id = ?`, [billNo])).count, 0);
}

function settlementInput({ net = 615, sc = 0, gv = 0, cash = 0, upi = 0, card = 0 }) {
    return {
        net_amount: net,
        exact_net_amount: 615.12,
        cash_amount: cash,
        upi_amount: upi,
        card_amount: card,
        gift_voucher_amount: gv,
        store_credit: sc ? { store_credit_no: "TEST", amount: sc } : null
    };
}

async function child(tempRoot) {
    const { app } = require("electron");
    app.setPath("userData", path.join(tempRoot, "user-data"));

    const db = require("../src/database/database");
    await db.databaseReady;
    const { getBusinessDate } = require("../src/database/businessDate");
    const { createDayClosingService } = require("../src/database/dayClosingService");
    const {
        saveBill,
        validateBillSettlement,
        updatePaymentAllocation
    } = require("../src/database/billService");
    const {
        calculatePaymentSettlement,
        calculatePaymentSettlementForBill
    } = require("../src/shared/paymentSettlement");

    await insertProduct(db, "P-518", 589);
    await insertProduct(db, "P-615", 699);
    await insertProduct(db, "P-500", 500);

    // 1. Normal rounded billing is unchanged.
    await saveBill(payload("NORMAL-ROUND", "P-518", "", { cash: 518 }));
    await assertBill(db, "NORMAL-ROUND", { net: 518, cash: 518 });

    // 2. Exact SC may exceed rounded payable, but never the exact bill.
    await insertStoreCredit(db, "SC-EXACT-51832", "9000000001", 518.32);
    await saveBill(payload("SC-EXACT-51832", "P-518", "9000000001", {
        storeCredit: { store_credit_no: "SC-EXACT-51832", amount: 518.32 }
    }));
    await assertBill(db, "SC-EXACT-51832", { net: 518, storeCredit: 518.32 });
    await assertRedeemed(db, "SC-EXACT-51832", "SC-EXACT-51832", 518.32);
    assert.strictEqual(calculatePaymentSettlementForBill(await get(db,
        "SELECT * FROM bills WHERE bill_no = ?", ["SC-EXACT-51832"])).paymentRoundOffPaise, -32);

    // 3-7. One-paise/sub-rupee residual boundary contract.
    for (const testCase of [
        { suffix: "01", sc: 614.99, cash: 0, roundOff: 1 },
        { suffix: "32", sc: 614.68, cash: 0, roundOff: 32 },
        { suffix: "49", sc: 614.51, cash: 0, roundOff: 49 },
        { suffix: "50", sc: 614.50, cash: 1, roundOff: -50 },
        { suffix: "51", sc: 614.49, cash: 1, roundOff: -49 }
    ]) {
        const mobile = `91000000${testCase.suffix}`;
        const creditNo = `SC-RESIDUAL-${testCase.suffix}`;
        const billNo = `BILL-RESIDUAL-${testCase.suffix}`;
        await insertStoreCredit(db, creditNo, mobile, testCase.sc);
        await saveBill(payload(billNo, "P-615", mobile, {
            storeCredit: { store_credit_no: creditNo, amount: testCase.sc },
            cash: testCase.cash
        }));
        await assertBill(db, billNo, { net: 615, storeCredit: testCase.sc, cash: testCase.cash });
        await assertRedeemed(db, billNo, creditNo, testCase.sc);
        assert.strictEqual(calculatePaymentSettlementForBill(await get(db,
            "SELECT * FROM bills WHERE bill_no = ?", [billNo])).paymentRoundOffPaise, testCase.roundOff);
    }

    // 8-11. Locked scenarios A-D.
    for (const scenario of [
        { suffix: "A", sc: 509.52, gv: 100, cash: 5, roundOff: 48 },
        { suffix: "B", sc: 509.12, gv: 100, cash: 6, roundOff: -12 },
        { suffix: "C", sc: 509.50, gv: 100, cash: 6, roundOff: -50 },
        { suffix: "D", sc: 509.72, gv: 100, cash: 5, roundOff: 28 }
    ]) {
        const mobile = `920000000${scenario.suffix.charCodeAt(0) - 64}`;
        const creditNo = `SC-SCENARIO-${scenario.suffix}`;
        const billNo = `BILL-SCENARIO-${scenario.suffix}`;
        await insertStoreCredit(db, creditNo, mobile, scenario.sc);
        await saveBill(payload(billNo, "P-615", mobile, {
            storeCredit: { store_credit_no: creditNo, amount: scenario.sc },
            giftVoucher: scenario.gv,
            cash: scenario.cash
        }));
        await assertBill(db, billNo, {
            net: 615, storeCredit: scenario.sc, giftVoucher: scenario.gv, cash: scenario.cash
        });
        await assertRedeemed(db, billNo, creditNo, scenario.sc);
        assert.strictEqual(calculatePaymentSettlementForBill(await get(db,
            "SELECT * FROM bills WHERE bill_no = ?", [billNo])).paymentRoundOffPaise, scenario.roundOff);
    }

    // 12-19. Existing tender combinations, including all five tenders.
    const combinations = [
        { suffix: "CASH", payment: { cash: 105 } },
        { suffix: "UPI", payment: { upi: 105 } },
        { suffix: "CARD", payment: { card: 105 } },
        { suffix: "GV", sc: 509.52, payment: { giftVoucher: 105.48 } },
        { suffix: "GV-CASH", payment: { giftVoucher: 100, cash: 5 } },
        { suffix: "GV-UPI", payment: { giftVoucher: 100, upi: 5 } },
        { suffix: "GV-CARD", payment: { giftVoucher: 100, card: 5 } },
        { suffix: "ALL", payment: { giftVoucher: 100, cash: 1, upi: 2, card: 2 } }
    ];
    for (let index = 0; index < combinations.length; index++) {
        const item = combinations[index];
        const sc = item.sc === undefined ? 509.52 : item.sc;
        const mobile = `93000000${String(index + 10).padStart(2, "0")}`;
        const creditNo = `SC-COMBO-${item.suffix}`;
        const billNo = `BILL-COMBO-${item.suffix}`;
        await insertStoreCredit(db, creditNo, mobile, sc);
        await saveBill(payload(billNo, "P-615", mobile, {
            ...item.payment,
            storeCredit: { store_credit_no: creditNo, amount: sc }
        }));
        await assertRedeemed(db, billNo, creditNo, sc);
    }

    // 20. GV-only decimal stored value leaves a whole-rupee customer tender.
    await saveBill(payload("GV-ONLY-DECIMAL", "P-615", "", {
        giftVoucher: 609.52,
        cash: 5
    }));
    await assertBill(db, "GV-ONLY-DECIMAL", { net: 615, giftVoucher: 609.52, cash: 5 });

    // 21-29. Rejection, H-05, and rollback protections.
    await insertStoreCredit(db, "SC-TOO-HIGH", "9400000001", 518.33);
    await assert.rejects(saveBill(payload("SC-TOO-HIGH", "P-518", "9400000001", {
        storeCredit: { store_credit_no: "SC-TOO-HIGH", amount: 518.33 }
    })), error => error.code === "KLBS_STORE_CREDIT_EXCEEDS_PAYABLE");
    await assertRejectedUntouched(db, "SC-TOO-HIGH", "SC-TOO-HIGH", 518.33);

    await insertStoreCredit(db, "SC-PARTIAL", "9400000002", 509.52);
    await assert.rejects(saveBill(payload("SC-PARTIAL", "P-615", "9400000002", {
        storeCredit: { store_credit_no: "SC-PARTIAL", amount: 400 }, cash: 215
    })), /Full active balance redemption is required/);
    await assertRejectedUntouched(db, "SC-PARTIAL", "SC-PARTIAL", 509.52);

    await insertStoreCredit(db, "SC-FAILED", "9400000003", 509.52);
    await assert.rejects(saveBill(payload("SC-FAILED", "P-615", "9400000003", {
        storeCredit: { store_credit_no: "SC-FAILED", amount: 509.52 }, giftVoucher: 100, cash: 4
    })), error => error.code === "KLBS_BILL_SETTLEMENT_MISMATCH");
    await assertRejectedUntouched(db, "SC-FAILED", "SC-FAILED", 509.52);

    await insertStoreCredit(db, "SC-EXPIRED", "9400000004", 509.52, {
        validUntil: "2000-01-01"
    });
    await assert.rejects(saveBill(payload("SC-EXPIRED", "P-615", "9400000004", {
        storeCredit: { store_credit_no: "SC-EXPIRED", amount: 509.52 }, cash: 105
    })), /invalid, expired, already redeemed, or does not belong/);
    await assertRejectedUntouched(db, "SC-EXPIRED", "SC-EXPIRED", 509.52);

    await insertStoreCredit(db, "SC-MISMATCH", "9400000005", 509.52);
    await assert.rejects(saveBill(payload("SC-MISMATCH", "P-615", "9400000006", {
        storeCredit: { store_credit_no: "SC-MISMATCH", amount: 509.52 }, cash: 105
    })), /invalid, expired, already redeemed, or does not belong/);
    await assertRejectedUntouched(db, "SC-MISMATCH", "SC-MISMATCH", 509.52);

    await insertStoreCredit(db, "SC-REDEEMED", "9400000007", 509.52, {
        status: "REDEEMED"
    });
    await assert.rejects(saveBill(payload("SC-REDEEMED", "P-615", "9400000007", {
        storeCredit: { store_credit_no: "SC-REDEEMED", amount: 509.52 }, cash: 105
    })), /invalid, expired, already redeemed, or does not belong/);
    assert.deepStrictEqual(await get(db, `SELECT status, remaining_balance FROM store_credits
        WHERE store_credit_no = ?`, ["SC-REDEEMED"]), {
        status: "REDEEMED", remaining_balance: 509.52
    });

    for (const field of ["cash_amount", "upi_amount", "card_amount"]) {
        assert.throws(() => validateBillSettlement({
            ...settlementInput({ cash: 615 }), [field]: -1
        }), error => error.code === "KLBS_BILL_SETTLEMENT_INVALID_AMOUNT");
        assert.throws(() => validateBillSettlement({
            ...settlementInput({ cash: 615 }), [field]: 1.01
        }), error => error.code === "KLBS_BILL_SETTLEMENT_INVALID_AMOUNT");
    }

    // 30. Payment correction must preserve the generated customer-tender target.
    await updatePaymentAllocation({
        bill_no: "BILL-SCENARIO-A", cash_amount: 0, upi_amount: 5, card_amount: 0,
        remarks: "Move whole-rupee tender to UPI", corrected_by: "TEST"
    });
    await assertBill(db, "BILL-SCENARIO-A", {
        net: 615, storeCredit: 509.52, giftVoucher: 100, upi: 5
    });
    await assert.rejects(updatePaymentAllocation({
        bill_no: "BILL-SCENARIO-A", cash_amount: 5.48, upi_amount: 0, card_amount: 0,
        remarks: "Invalid paise tender", corrected_by: "TEST"
    }), error => error.code === "KLBS_BILL_SETTLEMENT_INVALID_AMOUNT");

    // 31-34. Receipt/reprint use persisted bill amounts; Day Closing/DSR retain exact paise.
    const receiptSource = fs.readFileSync(path.join(__dirname, "../src/renderer/receipt.js"), "utf8");
    const receiptHtml = fs.readFileSync(path.join(__dirname, "../src/renderer/receipt.html"), "utf8");
    const dsrSource = fs.readFileSync(path.join(__dirname, "../deployment/google-apps-script/KLBS_DSR_WebApp.gs"), "utf8");
    assert(receiptSource.includes("calculatePaymentSettlementForBill"));
    assert(receiptHtml.includes("Payment Round Off") && receiptHtml.includes("Payment Settled"));
    assert(dsrSource.includes("Payment Round Off"));

    const closing = createDayClosingService({ database: db });
    const accounting = await closing.calculateAccounting(getBusinessDate());
    assert.strictEqual(
        accounting.settlementDifferencePaise,
        accounting.netBillingPaise - accounting.settlementTotalPaise
    );
    assert.notStrictEqual(accounting.settlementDifferencePaise, 0);

    assert.deepStrictEqual(calculatePaymentSettlement({
        roundedPayablePaise: 61500,
        storeCreditPaise: 50952,
        giftVoucherPaise: 10000,
        cashPaise: 500,
        upiPaise: 0,
        cardPaise: 0
    }), {
        roundedPayablePaise: 61500,
        storedValuePaise: 60952,
        rawResidualPaise: 548,
        customerTenderRequiredPaise: 500,
        customerTenderPaise: 500,
        actualSettlementPaise: 61452,
        paymentRoundOffPaise: 48
    });

    await close(db);
    process.stdout.write("Store Credit exact-value / payment round-off regression tests: PASS\n");
    app.exit(0);
}

if (process.argv.includes("--child")) {
    child(process.argv[process.argv.indexOf("--child") + 1]).catch(error => {
        console.error(error);
        try { require("electron").app.exit(1); } catch (_) {}
        process.exitCode = 1;
    });
}
else {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "klbs-payment-roundoff-"));
    const result = spawnSync(require("electron"), ["--disable-gpu", "--in-process-gpu", __filename, "--child", tempRoot], {
        cwd: path.resolve(__dirname, ".."),
        env: { ...process.env, KLBS_DEV_DATABASE_PATH: path.join(tempRoot, "billing.db") },
        encoding: "utf8",
        timeout: 120000,
        windowsHide: true
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        process.stdout.write(result.stdout || "");
        process.stderr.write(result.stderr || "");
        process.exit(result.status || 1);
    }
    process.stdout.write(result.stdout);
}
