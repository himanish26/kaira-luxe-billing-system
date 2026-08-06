function showDayClosingPage() {

    renderSettingsPage({

        title: "DAY CLOSING",

        icon: "🌙",

        subtitle: "Today's business summary",

        backText: "← System",

        backAction: showSystemPage,

        content: `

<div class="settings-card">

    <div class="day-closing-summary">

        <div class="summary-row">

            <span>Business Date</span>

            <strong id="dcBusinessDate">-</strong>

        </div>

        <div class="summary-row">

            <span>Bills Generated</span>

            <strong id="dcBills">0</strong>

        </div>

        <div class="summary-row">

            <span>Items Sold</span>

            <strong id="dcItems">0</strong>

        </div>

        <div class="summary-row">

            <span>Gross Sales</span>

            <strong id="dcGross">₹0.00</strong>

        </div>

        <div class="summary-row">

            <span>Total Discount</span>

            <strong id="dcDiscount">₹0.00</strong>

        </div>

        <div class="summary-row">

            <span>GST Collected</span>

            <strong id="dcGST">₹0.00</strong>

        </div>

        <div class="summary-row">

            <span>Net Sales</span>

            <strong id="dcNet">₹0.00</strong>

        </div>

        <div class="summary-row">

            <span>Cash Sales</span>

            <strong id="dcCash">₹0.00</strong>

        </div>

        <div class="summary-row">

            <span>UPI Sales</span>

            <strong id="dcUPI">₹0.00</strong>

        </div>

        <div class="summary-row">

            <span>Card Sales</span>

            <strong id="dcCard">₹0.00</strong>

        </div>

    </div>

</div>

`

    });

    (async () => {

    try {

        const summary =

            await window
                .electronAPI
                .getDayClosingSummary();

        document.getElementById("dcBusinessDate").textContent =

            new Date().toLocaleDateString(
                "en-GB",
                {
                    day: "2-digit",
                    month: "short",
                    year: "numeric"
                }
            );

        document.getElementById("dcBills").textContent =
            summary.totalBills;

        document.getElementById("dcItems").textContent =
            summary.totalItems;

        document.getElementById("dcGross").textContent =
            `₹${Number(summary.grossSales).toFixed(2)}`;

        document.getElementById("dcDiscount").textContent =
            `₹${Number(summary.totalDiscount).toFixed(2)}`;

        document.getElementById("dcGST").textContent =
            `₹${Number(summary.totalGST).toFixed(2)}`;

        document.getElementById("dcNet").textContent =
            `₹${Number(summary.netSales).toFixed(2)}`;

        document.getElementById("dcCash").textContent =
            `₹${Number(summary.cashSales).toFixed(2)}`;

        document.getElementById("dcUPI").textContent =
            `₹${Number(summary.upiSales).toFixed(2)}`;

        document.getElementById("dcCard").textContent =
            `₹${Number(summary.cardSales).toFixed(2)}`;

    }

    catch (error) {

        console.error(

            "Day Closing Summary Error:",

            error

        );

    }

})();

}