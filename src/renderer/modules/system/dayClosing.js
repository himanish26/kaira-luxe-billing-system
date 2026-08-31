function formatDayClosingMoney(value) {
    if (value === null || value === undefined) return "—";

    return `₹${Math.round(Number(value)).toLocaleString("en-IN")}`;
}

function formatDayClosingDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value || "-");
}

function dayClosingRow(label, id, initial = "₹0.00", rowClass = "") {
    return `
        <div class="summary-row dc-row ${rowClass}">
            <span>${label}</span>
            <strong id="${id}">${initial}</strong>
        </div>
    `;
}

function dayClosingSection(title, rows, sectionClass = "", icon = "") {
    return `
        <section class="day-closing-section dc-section ${sectionClass}">
            <div class="dc-section-title">
                ${icon ? `<span class="dc-section-icon">${icon}</span>` : ""}
                <span>${title}</span>
            </div>

            <div class="dc-section-body">
                ${rows.join("")}
            </div>
        </section>
    `;
}

function renderDayClosingSummary(summary) {
    const text = (id, value) => {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    };
    text("dcBusinessDate", formatDayClosingDate(summary.businessDate));
    text("dcBills", summary.totalBills === null ? "—" : String(summary.totalBills || 0));
    text("dcQtySold", summary.qtySold === null ? "—" : String(summary.qtySold || 0));
    text("dcGross", formatDayClosingMoney(summary.grossSales));
    text("dcDiscount", formatDayClosingMoney(summary.totalDiscount));
    text("dcNetBilling", formatDayClosingMoney(summary.netBilling));
    text("dcCreditNotes", summary.creditNoteCount === null ? "—" : String(summary.creditNoteCount || 0));
    text("dcQtyReturned", summary.qtyReturned === null ? "—" : String(summary.qtyReturned || 0));
    text("dcReturnValue", formatDayClosingMoney(summary.returnCnValue));
    text("dcNetAfterReturns", formatDayClosingMoney(summary.netSalesAfterReturns));
    text("dcCash", formatDayClosingMoney(summary.cash));
    text("dcUPI", formatDayClosingMoney(summary.upi));
    text("dcCard", formatDayClosingMoney(summary.card));
    text("dcStoreCreditRedeemed", formatDayClosingMoney(summary.storeCreditRedeemed));
    text("dcGiftVoucherRedeemed", formatDayClosingMoney(summary.giftVoucherRedeemed));
    text("dcSettlementTotal", formatDayClosingMoney(summary.settlementTotal));
    text("dcActualMoney", formatDayClosingMoney(summary.actualMoneyCollection));
    text("dcStoreCreditIssued", formatDayClosingMoney(summary.storeCreditIssued));
    const settlementDifference =
    Number(summary.settlementDifference || 0);

text(
    "dcSettlementDifference",
    Math.abs(settlementDifference) < 0.005
        ? "₹0.00"
        : `${settlementDifference < 0 ? "-" : ""}₹${Math.abs(settlementDifference).toFixed(2)}`
);
    text("dcBackupStatus", summary.backupStatus || "PENDING");
    text("dcEmailStatus", summary.emailStatus || "PENDING");

        // ---------------------------------------------------------
    // RECONCILIATION VISUAL STATE
    // ---------------------------------------------------------

    const reconciliationCard =
        document.getElementById("dcReconciliationCard");

    if (reconciliationCard) {
        reconciliationCard.classList.remove(
            "dc-reconciliation-ok",
            "dc-reconciliation-error",
            "dc-reconciliation-neutral"
        );

        if (
            summary.settlementDifference === null ||
            summary.settlementDifference === undefined
        ) {
            reconciliationCard.classList.add(
                "dc-reconciliation-neutral"
            );
        }
        else if (
            Math.abs(Number(summary.settlementDifference)) < 0.005
        ) {
            reconciliationCard.classList.add(
                "dc-reconciliation-ok"
            );
        }
        else {
            reconciliationCard.classList.add(
                "dc-reconciliation-error"
            );
        }
    }

    const reconciliationIcon =
        document.getElementById("dcReconciliationIcon");

    if (reconciliationIcon) {
        if (
            summary.settlementDifference === null ||
            summary.settlementDifference === undefined
        ) {
            reconciliationIcon.textContent = "•";
        }
        else if (
            Math.abs(Number(summary.settlementDifference)) < 0.005
        ) {
            reconciliationIcon.textContent = "✓";
        }
        else {
            reconciliationIcon.textContent = "⚠";
        }
    }

    // ---------------------------------------------------------
    // BACKUP / EMAIL VISUAL STATUS
    // ---------------------------------------------------------

    const applyStatusClass = (id, status) => {
        const element = document.getElementById(id);
        if (!element) return;

        element.classList.remove(
            "dc-status-pending",
            "dc-status-success",
            "dc-status-failed"
        );

        const normalized =
            String(status || "PENDING")
                .trim()
                .toLowerCase();

        if (normalized === "success") {
            element.classList.add("dc-status-success");
        }
        else if (normalized === "failed") {
            element.classList.add("dc-status-failed");
        }
        else {
            element.classList.add("dc-status-pending");
        }
    };

    applyStatusClass(
        "dcBackupStatus",
        summary.backupStatus
    );

    applyStatusClass(
        "dcEmailStatus",
        summary.emailStatus
    );

    const notice = document.getElementById("dcSnapshotNotice");

    if (notice) {

        if (summary.legacy) {

            notice.textContent =
                "Legacy closing record — detailed accounting snapshot unavailable.";

            notice.style.display = "";

        }
        else if (summary.source === "SNAPSHOT") {

            notice.textContent =
                `Stored closing snapshot • Close #${summary.closeSequence}`;

            notice.style.display = "";

        }
        else {

            // Live preview needs no technical message.
            notice.textContent = "";
            notice.style.display = "none";

        }

    }
}

async function showDayClosingPage() {
    renderSettingsPage({
        title: "DAY CLOSING",
        icon: "🌙",
        subtitle: "Accounting close and settlement reconciliation",
        backText: "← System",
        backAction: showSystemPage,
        content: `
            <div class="day-closing-container">

                <div
                    id="dcSnapshotNotice"
                    class="dc-preview-note">
                </div>


                <!-- =========================================
                     BUSINESS DATE
                     ========================================= -->

                <div class="dc-business-date">

                    <div class="dc-business-date-info">
                        <span class="dc-date-label">
                            BUSINESS DATE
                        </span>

                    <span class="dc-date-subtitle">
                        Daily accounting date
                    </span>
                    </div>

                    <strong
                        id="dcBusinessDate"
                        class="dc-date-value">
                        -
                    </strong>

                </div>


                <!-- =========================================
                     ACCOUNTING GRID
                     ========================================= -->

                <div class="dc-grid">

                    ${dayClosingSection(
                        "OPERATIONS",
                        [
                            dayClosingRow(
                                "Bills Generated",
                                "dcBills",
                                "0"
                            ),
                            dayClosingRow(
                                "Qty Sold",
                                "dcQtySold",
                                "0"
                            )
                        ],
                        "dc-card-operations",
                        "📋"
                    )}


                    ${dayClosingSection(
                        "BILLING",
                        [
                            dayClosingRow(
                                "Gross Sales",
                                "dcGross"
                            ),
                            dayClosingRow(
                                "Total Discount",
                                "dcDiscount"
                            ),
                            dayClosingRow(
                                "Net Billing",
                                "dcNetBilling",
                                "₹0.00",
                                "dc-total-row"
                            )
                        ],
                        "dc-card-billing",
                        "₹"
                    )}


                    ${dayClosingSection(
                        "RETURNS / CREDIT NOTES",
                        [
                            dayClosingRow(
                                "Credit Notes",
                                "dcCreditNotes",
                                "0"
                            ),
                            dayClosingRow(
                                "Qty Returned",
                                "dcQtyReturned",
                                "0"
                            ),
                            dayClosingRow(
                                "Return / CN Value",
                                "dcReturnValue"
                            ),
                            dayClosingRow(
                                "Net Sales After Returns",
                                "dcNetAfterReturns",
                                "₹0.00",
                                "dc-total-row"
                            )
                        ],
                        "dc-card-returns",
                        "↩"
                    )}


                    ${dayClosingSection(
                        "SETTLEMENT",
                        [
                            dayClosingRow(
                                "Cash",
                                "dcCash"
                            ),
                            dayClosingRow(
                                "UPI",
                                "dcUPI"
                            ),
                            dayClosingRow(
                                "Card",
                                "dcCard"
                            ),
                            dayClosingRow(
                                "Store Credit Redeemed",
                                "dcStoreCreditRedeemed"
                            ),
                            dayClosingRow(
                                "Gift Voucher Redeemed",
                                "dcGiftVoucherRedeemed"
                            ),
                            dayClosingRow(
                                "Settlement Total",
                                "dcSettlementTotal",
                                "₹0.00",
                                "dc-total-row"
                            )
                        ],
                        "dc-card-settlement",
                        "💳"
                    )}


                    ${dayClosingSection(
                        "COLLECTION",
                        [
                            dayClosingRow(
                                "Actual Money Collection",
                                "dcActualMoney",
                                "₹0.00",
                                "dc-highlight-row"
                            )
                        ],
                        "dc-card-collection",
                        "💰"
                    )}


                    ${dayClosingSection(
                        "CUSTOMER CREDIT ACTIVITY",
                        [
                            dayClosingRow(
                                "Store Credit Issued",
                                "dcStoreCreditIssued",
                                "₹0.00",
                                "dc-highlight-row"
                            )
                        ],
                        "dc-card-credit",
                        "🎫"
                    )}

                </div>


                <!-- =========================================
                     RECONCILIATION
                     ========================================= -->

                <section
                    id="dcReconciliationCard"
                    class="
                        dc-reconciliation
                        dc-reconciliation-neutral
                    ">

                    <div class="dc-reconciliation-title">

                        <span
                            id="dcReconciliationIcon"
                            class="dc-reconciliation-icon">
                            •
                        </span>

                        <span>
                            RECONCILIATION
                        </span>

                    </div>


                    <div class="dc-reconciliation-main">

                        <span>
                            Settlement Difference
                        </span>

                        <strong id="dcSettlementDifference">
                            ₹0.00
                        </strong>

                    </div>


                    <div class="dc-status-grid">

                        <div class="dc-status-item">

                            <span>
                                Backup
                            </span>

                            <strong
                                id="dcBackupStatus"
                                class="dc-status-pending">
                                PENDING
                            </strong>

                        </div>


                        <div class="dc-status-item">

                            <span>
                                Email
                            </span>

                            <strong
                                id="dcEmailStatus"
                                class="dc-status-pending">
                                PENDING
                            </strong>

                        </div>

                    </div>

                </section>

            </div>


            <!-- =============================================
                 ACTIONS
                 ============================================= -->

            <div class="dc-actions">

                <button
                    id="startDayClosingBtn"
                    class="export-report-btn">

                    🌙 CLOSE BUSINESS DAY

                </button>


                <button
                    id="reopenDayBtn"
                    class="export-report-btn"
                    disabled>

                    🔓 DAY RE-OPEN

                </button>

            </div>
        `
    });

    const startButton = document.getElementById("startDayClosingBtn");
    const reopenButton = document.getElementById("reopenDayBtn");
    startButton.addEventListener("click", startDayClosing);
    reopenButton.addEventListener("click", reopenBusinessDay);

    try {
        const [summary, status] = await Promise.all([
            window.electronAPI.getDayClosingSummary(),
            window.electronAPI.getBusinessDayStatus()
        ]);
        renderDayClosingSummary(summary);
        if (status.closed) {
            startButton.disabled = true;
            startButton.textContent = "✓ BUSINESS DAY CLOSED";
            reopenButton.disabled = false;
        }
        else if (status.closing) {
            startButton.disabled = true;
            startButton.textContent = "CLOSING IN PROGRESS";
            reopenButton.disabled = true;
        }
        else {
            startButton.disabled = false;
            reopenButton.disabled = true;
        }
    }
    catch (error) {
        console.error("Day Closing Summary Error:", error);
    }
}

async function startDayClosing() {
    const closeButton = document.getElementById("startDayClosingBtn");
    try {
        const confirmation = await window.electronAPI.showMessageBox({
            type: "warning",
            title: "Close Business Day",
            buttons: ["Cancel", "Close Business Day"],
            defaultId: 1,
            cancelId: 0,
            message: "Close the authoritative current business day?",
            detail: "Billing is paused while the mandatory backup is created. A verified backup is required before the day becomes CLOSED."
        });
        if (confirmation.response !== 1) return;

        closeButton.disabled = true;
        closeButton.textContent = "CLOSING IN PROGRESS";
        const result = await window.electronAPI.closeBusinessDay();
        if (result.alreadyClosed || result.alreadyClosing) {
            await window.electronAPI.showMessageBox({
                type: "info",
                title: result.alreadyClosed
                    ? "Business Day Already Closed"
                    : "Day Closing In Progress",
                message: result.message ||
                    (result.alreadyClosed
                        ? "The business day is already closed."
                        : "Another Day Closing request is already running.")
            });
            await showDayClosingPage();
            return;
        }
        if (!result.success) {
            await window.electronAPI.showMessageBox({
                type: "error",
                title: "Day Closing Not Completed",
                message: result.error || "Mandatory backup failed. The business day remains open."
            });
            await showDayClosingPage();
            return;
        }

        renderDayClosingSummary(result.snapshot);
        let printWarning = null;
        const printResult = await window.electronAPI.printDayClosing(result.snapshotId);
        if (!printResult.success) {
            printWarning = printResult.error || "Receipt printing failed.";
        }

        const warnings = [];
        if (result.emailStatus === "FAILED") {
            warnings.push(`Email failed: ${result.emailWarning || "See closing snapshot."}`);
        }
        if (printWarning) warnings.push(`Receipt printing failed: ${printWarning}`);
        if (result.activityWarning) {
            warnings.push(`Activity Log failed: ${result.activityWarning}`);
        }

        await window.electronAPI.showMessageBox({
            type: warnings.length ? "warning" : "info",
            title: warnings.length
                ? "Day Closing Complete With Warning"
                : "Day Closing Complete",
            message: "Business Day closed successfully.",
            detail: warnings.length
                ? warnings.join("\n")
                : "Mandatory backup completed and verified. No further bills can be generated today."
        });
        await showDayClosingPage();
    }
    catch (error) {
        console.error("Day Closing Error:", error);
        if (closeButton) closeButton.disabled = false;
        await window.electronAPI.showMessageBox({
            type: "error",
            title: "Day Closing Failed",
            message: error.message
        });
    }
}

function requestDayReopenReason() {

    return new Promise(resolve => {

        // Remove any stale instance first.
        const existing =
            document.getElementById("dayReopenReasonModal");

        if (existing) {
            existing.remove();
        }


        const modal = document.createElement("div");

        modal.id = "dayReopenReasonModal";
        modal.className = "day-reopen-modal-overlay";

        modal.innerHTML = `
            <div class="day-reopen-modal">

                <div class="day-reopen-modal-header">
                    🔓 DAY RE-OPEN
                </div>

                <div class="day-reopen-modal-body">

                    <div class="day-reopen-modal-title">
                        Reason for Re-opening
                    </div>

                    <div class="day-reopen-modal-help">
                        Enter a reason for re-opening the current business day.
                        This will be preserved in the Day Closing audit history.
                    </div>

                    <textarea
                        id="dayReopenReasonInput"
                        class="day-reopen-reason-input"
                        rows="4"
                        maxlength="250"
                        placeholder="Enter reason..."></textarea>

                    <div
                        id="dayReopenReasonError"
                        class="day-reopen-reason-error">
                    </div>

                </div>

                <div class="day-reopen-modal-actions">

                    <button
                        id="cancelDayReopenReasonBtn"
                        class="day-reopen-modal-btn secondary">

                        CANCEL

                    </button>

                    <button
                        id="continueDayReopenReasonBtn"
                        class="day-reopen-modal-btn primary">

                        CONTINUE

                    </button>

                </div>

            </div>
        `;


        document.body.appendChild(modal);


        const input =
            document.getElementById("dayReopenReasonInput");

        const error =
            document.getElementById("dayReopenReasonError");

        const continueButton =
            document.getElementById(
                "continueDayReopenReasonBtn"
            );

        const cancelButton =
            document.getElementById(
                "cancelDayReopenReasonBtn"
            );


        const closeModal = value => {

            modal.remove();

            resolve(value);

        };


        const submitReason = () => {

            const reason =
                String(input.value || "").trim();

            if (!reason) {

                error.textContent =
                    "Please enter a reason for Day Re-open.";

                input.focus();

                return;

            }

            closeModal(reason);

        };


        continueButton.addEventListener(
            "click",
            submitReason
        );


        cancelButton.addEventListener(
            "click",
            () => closeModal(null)
        );


        input.addEventListener(
            "keydown",
            event => {

                if (
                    event.key === "Enter" &&
                    (event.ctrlKey || event.metaKey)
                ) {

                    event.preventDefault();

                    submitReason();

                }

                if (event.key === "Escape") {

                    event.preventDefault();

                    closeModal(null);

                }

            }
        );


        modal.addEventListener(
            "click",
            event => {

                if (event.target === modal) {

                    closeModal(null);

                }

            }
        );


        requestAnimationFrame(() => {

            input.focus();

        });

    });

}

async function reopenBusinessDay(options = {}) {

    const reason =

        await requestDayReopenReason();

    if (!reason) {

        return { success: false, cancelled: true };

    }

    const grant = await requestAdminAuthorization("DAY_REOPEN");
    if (!grant) {
        return { success: false, cancelled: true };
    }

    try {
        const result = await window.electronAPI.reopenBusinessDay(grant, reason);
        if (!result.success) {
            await window.electronAPI.showMessageBox({
                type: "error",
                title: "Day Re-open Failed",
                message: result.message || result.error ||
                    "Business Day could not be re-opened."
            });
            return result;
        }
        await window.electronAPI.showMessageBox({
            type: result.activityWarning ? "warning" : "info",
            title: result.activityWarning
                ? "Business Day Re-opened With Warning"
                : "Business Day Re-opened",
            message: "Business Day re-opened successfully.",
            detail: result.activityWarning
                ? `The snapshot was preserved, but Activity Log failed: ${result.activityWarning}`
                : "The prior snapshot was preserved. Billing is available and the next close will create a new snapshot."
        });

        if (typeof options.afterSuccess === "function") {
            await options.afterSuccess(result);
        }
        else {
            await showDayClosingPage();
        }

        return result;
    }
    catch (error) {
        console.error("Day Re-open Error:", error);
        await window.electronAPI.showMessageBox({
            type: "error",
            title: "Day Re-open Failed",
            message: error.message
        });
        return { success: false, error: error.message };
    }
}
