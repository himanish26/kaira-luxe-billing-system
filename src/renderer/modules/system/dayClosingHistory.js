(function () {
    let snapshotDates = [];
    let selectedDate = "";
    let selectedSnapshots = [];
    let selectedSnapshot = null;
    let historyMaximumDate = "";

    function subtractCalendarDay(value) {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
        if (!match) throw new Error("A valid business date is required.");
        return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) - 1))
            .toISOString().slice(0, 10);
    }

    const escapeHtml = value => String(value ?? "-")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
    const money = value => value === null || value === undefined
        ? "—" : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(Number(value));
    const displayDate = value => {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
        return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value || "—");
    };
    const displayDateTime = value => value ? new Date(value).toLocaleString("en-IN") : "—";
    const reference = snapshot => snapshot
        ? `KLDC-${snapshot.businessDate.slice(8, 10)}${snapshot.businessDate.slice(5, 7)}${snapshot.businessDate.slice(0, 4).slice(2)}-${String(snapshot.closeSequence).padStart(2, "0")}`
        : "—";
    const row = (label, value, isMoney = false) => `<div class="summary-row dc-row"><span>${label}</span><strong>${isMoney ? money(value) : escapeHtml(value)}</strong></div>`;
    const sectionClass = {
        "OPERATIONS": "dc-card-operations", "BILLING": "dc-card-billing",
        "RETURNS / CREDIT NOTES": "dc-card-returns", "SETTLEMENT": "dc-card-settlement",
        "COLLECTION": "dc-card-collection", "CUSTOMER CREDIT ACTIVITY": "dc-card-credit",
        "PAYMENT CHECK": "dc-history-reconciliation", "DELIVERY / AUDIT STATUS": "dc-card-delivery"
    };
    const section = (title, rows) => `<section class="day-closing-section dc-section ${sectionClass[title] || ""}"><div class="dc-section-title"><span>${title}</span></div>${rows.join("")}</section>`;

    function renderSnapshot(snapshot) {
        selectedSnapshot = snapshot;
        const content = document.getElementById("dayClosingHistoryContent");
        const print = document.getElementById("dayClosingHistoryPrint");
        const sequence = document.getElementById("dayClosingHistorySequence");
        const status = document.getElementById("dayClosingHistoryStatus");
        const meta = document.getElementById("dayClosingHistoryMeta");
        if (!snapshot) {
            content.innerHTML = `<div class="dc-history-empty">No Day Closing record found for this date.</div>`;
            print.disabled = true;
            status.textContent = "—";
            meta.innerHTML = "";
            return;
        }
        const final = selectedSnapshots[0] && selectedSnapshots[0].snapshotId === snapshot.snapshotId;
        status.textContent = final ? "FINAL CLOSING" : "SUPERSEDED CLOSING";
        print.disabled = !final || snapshot.closeStatus !== "CLOSED";
        meta.innerHTML = [
            ["Snapshot ID", snapshot.snapshotId], ["Snapshot Version", snapshot.snapshotVersion],
            ["Close Sequence", snapshot.closeSequence], ["Closed At", displayDateTime(snapshot.closedAt)],
            ["Closed By", snapshot.closedBy], ["Closing Reference", reference(snapshot)],
            ["Status", final ? "FINAL CLOSING" : "SUPERSEDED CLOSING"]
        ].map(item => `<div><span>${item[0]}</span><strong>${escapeHtml(item[1])}</strong></div>`).join("");
            content.innerHTML = `<div class="dc-grid dc-history-grid">
            ${section("OPERATIONS", [row("Bills Generated", snapshot.totalBills), row("Quantity Sold", snapshot.qtySold)])}
            ${section("BILLING", [row("Gross Sales", snapshot.grossSales, true), row("Total Discount", snapshot.totalDiscount, true), row("Net Billing", snapshot.netBilling, true)])}
            ${section("RETURNS / CREDIT NOTES", [row("Credit Notes", snapshot.creditNoteCount), row("Quantity Returned", snapshot.qtyReturned), row("Return / CN Value", snapshot.returnCnValue, true), row("Net Sales After Returns", snapshot.netSalesAfterReturns, true)])}
            ${section("SETTLEMENT", [row("Cash", snapshot.cash, true), row("UPI", snapshot.upi, true), row("Card", snapshot.card, true), row("Store Credit Redeemed", snapshot.storeCreditRedeemed, true), row("Gift Voucher Redeemed", snapshot.giftVoucherRedeemed, true), row("Total Settlement", snapshot.settlementTotal, true)])}
            ${section("COLLECTION", [row("Actual Money Collection", snapshot.actualMoneyCollection, true)])}
            ${section("CUSTOMER CREDIT ACTIVITY", [row("Store Credit Issued", snapshot.storeCreditIssued, true)])}
            ${section("PAYMENT CHECK", [row("Settlement Difference", snapshot.settlementDifference, true)])}
            ${section("DELIVERY / AUDIT STATUS", [row("Backup Status", snapshot.backupStatus), row("Email Status", snapshot.emailStatus), row("DSR Status", snapshot.dsrSyncStatus)])}
        </div>`;
        sequence.innerHTML = selectedSnapshots.length > 1
            ? selectedSnapshots.map(item => `<option value="${item.snapshotId}">Sequence ${item.closeSequence} — ${item.snapshotId === selectedSnapshots[0].snapshotId ? "FINAL CLOSING" : "SUPERSEDED CLOSING"}</option>`).join("") : "";
        sequence.hidden = selectedSnapshots.length <= 1;
        sequence.value = String(snapshot.snapshotId);
    }

    async function loadDate(value) {
        if (value && historyMaximumDate && value > historyMaximumDate) {
            document.getElementById("dayClosingHistoryDate").value = selectedDate;
            return;
        }
        selectedDate = String(value || "");
        document.getElementById("dayClosingHistoryDate").value = selectedDate;
        selectedSnapshots = selectedDate ? await window.electronAPI.dayClosingHistory.listForDate(selectedDate) : [];
        renderSnapshot(selectedSnapshots[0] || null);
        const index = snapshotDates.indexOf(selectedDate);
        document.getElementById("dayClosingHistoryPrevious").disabled = index <= 0;
        document.getElementById("dayClosingHistoryNext").disabled = index < 0 || index >= snapshotDates.length - 1;
    }

    async function showDayClosingHistoryPage() {
        renderSettingsPage({
            title: "DAY CLOSING HISTORY", icon: "📚", subtitle: "Read-only saved Day Closing snapshots",
            backText: "← Day Closing", backAction: () => showDayClosingPage(),
            content: `<div class="day-closing-container dc-history-container"><div class="dc-history-toolbar">
                <label>BUSINESS DATE <input id="dayClosingHistoryDate" type="date"></label>
                <label>CLOSING SEQUENCE <select id="dayClosingHistorySequence" hidden></select></label>
                <div><span>CLOSING STATUS</span><strong id="dayClosingHistoryStatus">—</strong></div>
            </div>
            <div class="dc-history-meta" id="dayClosingHistoryMeta"></div>
            <div id="dayClosingHistoryContent"></div>
            <div class="dc-history-actions">
                <button id="dayClosingHistoryPrevious" class="export-report-btn">PREVIOUS DAY</button>
                <button id="dayClosingHistoryPrint" class="export-report-btn" disabled>PRINT</button>
                <button id="dayClosingHistoryNext" class="export-report-btn">NEXT DAY</button>
            </div></div>`
        });
        const date = document.getElementById("dayClosingHistoryDate");
        const sequence = document.getElementById("dayClosingHistorySequence");
        date.addEventListener("change", () => loadDate(date.value));
        sequence.addEventListener("change", () => renderSnapshot(selectedSnapshots.find(item => String(item.snapshotId) === sequence.value) || null));
        document.getElementById("dayClosingHistoryPrevious").addEventListener("click", () => {
            const index = snapshotDates.indexOf(selectedDate); if (index > 0) loadDate(snapshotDates[index - 1]);
        });
        document.getElementById("dayClosingHistoryNext").addEventListener("click", () => {
            const index = snapshotDates.indexOf(selectedDate); if (index >= 0 && index < snapshotDates.length - 1) loadDate(snapshotDates[index + 1]);
        });
        document.getElementById("dayClosingHistoryPrint").addEventListener("click", async () => {
            if (!selectedSnapshot) return;
            const result = await window.electronAPI.dayClosingHistory.printSnapshot(selectedSnapshot.snapshotId);
            if (!result.success) await window.electronAPI.showMessageBox({ type: "error", title: "Historical Print Unavailable", message: result.error });
        });
        snapshotDates = await window.electronAPI.dayClosingHistory.listDates();
        const businessDayStatus = await window.electronAPI.getBusinessDayStatus();
        historyMaximumDate = subtractCalendarDay(businessDayStatus.businessDate);
        date.max = historyMaximumDate;
        snapshotDates = snapshotDates.filter(value => value <= historyMaximumDate);
        await loadDate(historyMaximumDate);
    }

    window.showDayClosingHistoryPage = showDayClosingHistoryPage;
})();
