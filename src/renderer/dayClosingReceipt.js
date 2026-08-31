function formatAmount(value) {
    if (value === null || value === undefined) return "—";
    return Number(value).toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function formatCloseTimestamp(value) {
    if (!value) return "-";
    return new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true
    }).format(new Date(value));
}

function formatBusinessDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    if (!match) return value || "—";
    return `${match[3]}/${match[2]}/${match[1]}`;
}

function receiptRow(label, value, money = false) {
    return `
        <div class="row">
            <span>${label}</span>
            <span>${money ? "₹" : ""}${money ? formatAmount(value) : (value ?? "—")}</span>
        </div>
    `;
}

function loadDayClosingReceipt() {
    const data = window.dayClosingData || {};
    const receiptHtml = `
        <div class="header">
            <h1 class="title">KAIRA LUXE</h1>
            <p class="subtitle">DAY CLOSING</p>
        </div>
        <div class="line-dashed"></div>
        ${receiptRow("Business Date", formatBusinessDate(data.businessDate))}
        ${receiptRow("Close #", data.closeSequence)}
        ${receiptRow("Closed At", formatCloseTimestamp(data.closedAt))}
        <div class="line-dashed"></div>
        ${receiptRow("Bills Generated", data.totalBills)}
        ${receiptRow("Qty Sold", data.qtySold)}
        <div class="line-dashed"></div>
        ${receiptRow("Gross Sales", data.grossSales, true)}
        ${receiptRow("Discount", data.totalDiscount, true)}
        ${receiptRow("Net Billing", data.netBilling, true)}
        <div class="line-dashed"></div>
        ${receiptRow("Credit Notes", data.creditNoteCount)}
        ${receiptRow("Qty Returned", data.qtyReturned)}
        ${receiptRow("Return/CN Value", data.returnCnValue, true)}
        <div class="row net-sale">
            <span>Net After Returns</span>
            <span>₹${formatAmount(data.netSalesAfterReturns)}</span>
        </div>
        <div class="line-dashed"></div>
        ${receiptRow("Cash", data.cash, true)}
        ${receiptRow("UPI", data.upi, true)}
        ${receiptRow("Card", data.card, true)}
        ${receiptRow("Store Credit", data.storeCreditRedeemed, true)}
        ${receiptRow("Gift Voucher", data.giftVoucherRedeemed, true)}
        <div class="line-dashed"></div>
        ${receiptRow("Actual Money", data.actualMoneyCollection, true)}
        ${receiptRow("Store Credit Issued", data.storeCreditIssued, true)}
        ${receiptRow("Settlement Difference", data.settlementDifference, true)}
        <div class="line-dashed"></div>
        ${receiptRow("Backup", data.backupStatus || "UNKNOWN")}
        ${receiptRow("Email", data.emailStatus || "UNKNOWN")}
        <div class="line-solid"></div>
        <div class="footer">DAY CLOSED</div>
    `;
    document.getElementById("receipt").innerHTML = receiptHtml;
}

document.addEventListener("DOMContentLoaded", loadDayClosingReceipt);
