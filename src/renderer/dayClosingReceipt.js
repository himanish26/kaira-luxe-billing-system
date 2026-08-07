function formatAmount(value) {
    return Math.round(
        Number(value || 0)
    ).toLocaleString("en-IN");
}

// Helper to format current time as "09:18 PM" if no time property exists in data
function getFormattedTime(timeValue) {
    if (timeValue) return timeValue;
    
    return new Date().toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
    });
}

function loadDayClosingReceipt() {
    const d = window.dayClosingData || {};

    // 1. Check common key names for date and time
    const date = d.businessDate || d.date || "";
    const time = getFormattedTime(d.closingTime || d.time || d.closing_time);

    // 2. Combine Date & Time cleanly
    const dateTimeDisplay = date && time ? `${date} ${time}` : (date || time);

    const receiptHtml = `
        <div class="header">
            <h1 class="title">KAIRA LUXE</h1>
            <p class="subtitle">DAY CLOSING</p>
        </div>

        <div class="line-dashed"></div>

        <div class="row bold">
            <span>Date : ${dateTimeDisplay}</span>
        </div>

        <div class="row">
            <span>Bills : <strong>${d.totalBills || 0}</strong></span>
            <span>Items : <strong>${d.totalItems || 0}</strong></span>
        </div>

        <div class="line-dashed"></div>

        <div class="row net-sale">
            <span>Net Sale</span>
            <span>₹${formatAmount(d.netSales)}</span>
        </div>

        <div class="line-dashed"></div>

        <div class="row">
            <span>Cash</span>
            <span>₹${formatAmount(d.cashSales)}</span>
        </div>

        <div class="row">
            <span>UPI</span>
            <span>₹${formatAmount(d.upiSales)}</span>
        </div>

        <div class="row">
            <span>Card</span>
            <span>₹${formatAmount(d.cardSales)}</span>
        </div>

        <div class="line-dashed"></div>

        <div class="row status-row">
            <span>Backup : ✓</span>
            <span>Email : ✓</span>
        </div>

        <div class="line-solid"></div>

        <div class="footer">
            DAY CLOSED
        </div>
    `;

    document.getElementById("receipt").innerHTML = receiptHtml;
}

document.addEventListener("DOMContentLoaded", loadDayClosingReceipt);