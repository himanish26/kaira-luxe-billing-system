function buildDayClosingEmailText(summary) {
    const money = value => `\u20B9${Number(value || 0).toFixed(2)}`;
    return ["KAIRA LUXE", "Business Day Closing Report", "",
        `Business Date: ${summary.businessDate}`, `Bills Generated: ${summary.totalBills}`, `Qty Sold: ${summary.qtySold}`,
        `Gross Sales: ${money(summary.grossSales)}`, `Total Discount: ${money(summary.totalDiscount)}`, `Net Billing: ${money(summary.netBilling)}`,
        `Credit Notes: ${summary.creditNoteCount}`, `Qty Returned: ${summary.qtyReturned}`, `Return / CN Value: ${money(summary.returnCnValue)}`,
        `Net Sales After Returns: ${money(summary.netSalesAfterReturns)}`, `Cash: ${money(summary.cash)}`, `UPI: ${money(summary.upi)}`, `Card: ${money(summary.card)}`,
        `Store Credit Redeemed: ${money(summary.storeCreditRedeemed)}`, `Gift Voucher Redeemed: ${money(summary.giftVoucherRedeemed)}`,
        `Actual Money Collection: ${money(summary.actualMoneyCollection)}`, `Store Credit Issued: ${money(summary.storeCreditIssued)}`,
        `Settlement Difference: ${money(summary.settlementDifference)}`, `Backup: ${summary.backupStatus} (${summary.backupReference || "-"})`,
        "Email outcome: dispatch in progress; final status is persisted after this message.", "",
        "The accounting snapshot and mandatory backup are complete."].join("\n");
}
module.exports = { buildDayClosingEmailText };
