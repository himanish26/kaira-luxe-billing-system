function toPaise(value, fieldName = "Payment") {

    const amount = Number(value || 0);

    if (!Number.isFinite(amount) || amount < 0) {
        throw new Error(`Invalid ${fieldName} amount.`);
    }

    const paise = Math.round((amount + Number.EPSILON) * 100);

    if (!Number.isSafeInteger(paise)) {
        throw new Error(`Invalid ${fieldName} amount.`);
    }

    return paise;

}

function calculatePaymentSettlement({
    roundedPayablePaise,
    storeCreditPaise = 0,
    giftVoucherPaise = 0,
    cashPaise = 0,
    upiPaise = 0,
    cardPaise = 0
}) {

    const values = [
        roundedPayablePaise,
        storeCreditPaise,
        giftVoucherPaise,
        cashPaise,
        upiPaise,
        cardPaise
    ];

    if (!values.every(Number.isSafeInteger)) {
        throw new Error("Invalid payment settlement value.");
    }

    const storedValuePaise = storeCreditPaise + giftVoucherPaise;
    const rawResidualPaise = roundedPayablePaise - storedValuePaise;
    const customerTenderRequiredPaise = rawResidualPaise <= 0
        ? 0
        : Math.round(rawResidualPaise / 100) * 100;
    const customerTenderPaise = cashPaise + upiPaise + cardPaise;
    const actualSettlementPaise = storedValuePaise + customerTenderPaise;
    const paymentRoundOffPaise = roundedPayablePaise - actualSettlementPaise;

    if (![storedValuePaise, rawResidualPaise, customerTenderRequiredPaise,
        customerTenderPaise, actualSettlementPaise, paymentRoundOffPaise]
        .every(Number.isSafeInteger)) {
        throw new Error("Payment settlement exceeds safe limits.");
    }

    return {
        roundedPayablePaise,
        storedValuePaise,
        rawResidualPaise,
        customerTenderRequiredPaise,
        customerTenderPaise,
        actualSettlementPaise,
        paymentRoundOffPaise
    };

}

function calculatePaymentSettlementForBill(bill) {

    return calculatePaymentSettlement({
        roundedPayablePaise: toPaise(bill.net_amount, "Net Amount"),
        storeCreditPaise: toPaise(bill.store_credit_amount, "Store Credit"),
        giftVoucherPaise: toPaise(bill.gift_voucher_amount, "Gift Voucher"),
        cashPaise: toPaise(bill.cash_amount, "Cash"),
        upiPaise: toPaise(bill.upi_amount, "UPI"),
        cardPaise: toPaise(bill.card_amount, "Card")
    });

}

module.exports = {
    calculatePaymentSettlement,
    calculatePaymentSettlementForBill,
    toPaise
};
