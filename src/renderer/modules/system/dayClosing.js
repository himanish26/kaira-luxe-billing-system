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
    text(
        "dcPaymentCheck",
        summary.settlementDifference === null ||
            summary.settlementDifference === undefined
            ? "—"
            : "OK"
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
        else if (Number.isFinite(Number(summary.settlementDifference))) {
            reconciliationCard.classList.add(
                "dc-reconciliation-ok"
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
        else if (Number.isFinite(Number(summary.settlementDifference))) {
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
                            PAYMENT CHECK
                        </span>

                    </div>


                    <div class="dc-reconciliation-main">

                        <span>
                            Payment Round Off
                        </span>

                        <strong id="dcSettlementDifference">
                            ₹0.00
                        </strong>

                    </div>

                    <div class="dc-reconciliation-main">

                        <span>
                            Payment Check
                        </span>

                        <strong id="dcPaymentCheck">
                            OK
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

                <button id="dayClosingHistoryBtn" class="export-report-btn">
                    DAY CLOSING HISTORY
                </button>

            </div>
        `
    });

    const startButton = document.getElementById("startDayClosingBtn");
    const reopenButton = document.getElementById("reopenDayBtn");
    const historyButton = document.getElementById("dayClosingHistoryBtn");
    startButton.addEventListener("click", startDayClosing);
    reopenButton.addEventListener("click", reopenBusinessDay);
    historyButton.addEventListener("click", () => showDayClosingHistoryPage());

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


let dayClosingLifecycleListenerBound = false;

const DAY_CLOSING_STAGE_ORDER = [
    "FINALIZING_ACCOUNTS",
    "BUSINESS_DAY_CLOSED",
    "CREATING_BACKUP",
    "VERIFYING_BACKUP",
    "UPDATING_DSR",
    "SENDING_EMAIL",
    "COMPLETING_DAY_CLOSING"
];

const DAY_CLOSING_STAGE_LABELS = {
    FINALIZING_ACCOUNTS: "Finalizing accounts",
    BUSINESS_DAY_CLOSED: "Business Day CLOSED",
    CREATING_BACKUP: "Creating backup",
    VERIFYING_BACKUP: "Verifying backup",
    UPDATING_DSR: "Updating DSR",
    SENDING_EMAIL: "Sending email",
    COMPLETING_DAY_CLOSING: "Completing Day Closing"
};

function ensureDayClosingLifecycleOverlay() {
    let overlay = document.getElementById("dayClosingLifecycleOverlay");
    if (overlay) return overlay;

    overlay = document.createElement("div");
    overlay.id = "dayClosingLifecycleOverlay";
    overlay.className = "dc-lifecycle-overlay";
    overlay.setAttribute("aria-live", "polite");
    overlay.innerHTML = `
        <div class="dc-lifecycle-shell">
            <div class="dc-lifecycle-brand">KAIRA LUXE</div>
            <div class="dc-lifecycle-kicker">DAY CLOSING</div>
            <h1 id="dcLifecycleTitle">Closing Business Day</h1>
            <p id="dcLifecycleSubtitle">Please keep KLBS open while the mandatory closing work completes.</p>
            <div id="dcLifecycleStages" class="dc-lifecycle-stages">
                ${DAY_CLOSING_STAGE_ORDER.map((stage, index) => `
                    <div class="dc-lifecycle-stage" data-stage="${stage}">
                        <span class="dc-lifecycle-stage-icon">${index + 1}</span>
                        <span class="dc-lifecycle-stage-label">${DAY_CLOSING_STAGE_LABELS[stage]}</span>
                        <span class="dc-lifecycle-stage-state">Waiting</span>
                    </div>
                `).join("")}
            </div>
            <div id="dcLifecycleNotice" class="dc-lifecycle-notice" hidden></div>
            <div class="dc-lifecycle-actions">
                <button id="dcLifecycleReturnBtn" class="klbs-cancel-btn" hidden>RETURN TO DAY CLOSING</button>
                <button id="dcLifecycleCloseBtn" class="klbs-primary-btn" disabled>CLOSE KLBS</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
        }
    }, true);

    document.getElementById("dcLifecycleReturnBtn").addEventListener("click", async () => {
        overlay.classList.remove("is-visible");
        await showDayClosingPage();
    });

    document.getElementById("dcLifecycleCloseBtn").addEventListener("click", async event => {
        const button = event.currentTarget;
        button.disabled = true;
        button.textContent = "CLOSING KLBS...";
        const result = await window.electronAPI.closeAfterDayClosing();
        if (!result || result.success !== true) {
            button.disabled = false;
            button.textContent = "CLOSE KLBS";
            const notice = document.getElementById("dcLifecycleNotice");
            notice.hidden = false;
            notice.className = "dc-lifecycle-notice is-error";
            notice.textContent = result && result.error || "KLBS could not close safely.";
        }
    });

    if (!dayClosingLifecycleListenerBound) {
        dayClosingLifecycleListenerBound = true;
        window.electronAPI.onDayClosingProgress(payload => {
            if (!payload || !payload.stage) return;
            updateDayClosingLifecycleStage(payload.stage);
        });
        window.electronAPI.onDayClosingExitBlocked(() => {
            const notice = document.getElementById("dcLifecycleNotice");
            if (!notice) return;
            notice.hidden = false;
            notice.className = "dc-lifecycle-notice";
            notice.textContent = "Day Closing is still running. KLBS cannot be closed yet.";
        });
    }
    return overlay;
}

function resetDayClosingLifecycle() {
    const overlay = ensureDayClosingLifecycleOverlay();
    overlay.classList.add("is-visible");
    overlay.tabIndex = -1;
    overlay.focus();

    document.getElementById("dcLifecycleTitle").textContent = "Closing Business Day";
    document.getElementById("dcLifecycleTitle").className = "";
    document.getElementById("dcLifecycleSubtitle").textContent =
        "Please keep KLBS open while the mandatory closing work completes.";
    const notice = document.getElementById("dcLifecycleNotice");
    notice.hidden = true;
    notice.className = "dc-lifecycle-notice";
    notice.textContent = "";
    const closeButton = document.getElementById("dcLifecycleCloseBtn");
    closeButton.disabled = true;
    closeButton.textContent = "CLOSE KLBS";
    document.getElementById("dcLifecycleReturnBtn").hidden = true;

    overlay.querySelectorAll(".dc-lifecycle-stage").forEach((row, index) => {
        row.className = "dc-lifecycle-stage";
        row.querySelector(".dc-lifecycle-stage-icon").textContent = String(index + 1);
        row.querySelector(".dc-lifecycle-stage-state").textContent = "Waiting";
    });
}

function updateDayClosingLifecycleStage(stage) {
    if (stage === "BACKUP_VERIFIED") {
        const verify = document.querySelector('.dc-lifecycle-stage[data-stage="VERIFYING_BACKUP"]');
        if (verify) {
            verify.classList.remove("is-active");
            verify.classList.add("is-complete");
            verify.querySelector(".dc-lifecycle-stage-icon").textContent = "✓";
            verify.querySelector(".dc-lifecycle-stage-state").textContent = "Complete";
        }
        return;
    }
    if (stage === "ONLINE_TASKS_QUEUED" || stage === "DAY_CLOSING_COMPLETE") return;

    const index = DAY_CLOSING_STAGE_ORDER.indexOf(stage);
    if (index < 0) return;
    document.querySelectorAll(".dc-lifecycle-stage").forEach((row, rowIndex) => {
        if (rowIndex < index) {
            row.classList.remove("is-active");
            row.classList.add("is-complete");
            row.querySelector(".dc-lifecycle-stage-icon").textContent = "✓";
            row.querySelector(".dc-lifecycle-stage-state").textContent = "Complete";
        }
        else if (rowIndex === index) {
            row.classList.add("is-active");
            row.querySelector(".dc-lifecycle-stage-state").textContent = "In progress";
        }
    });
}

function finishDayClosingLifecycle(result, warnings = []) {
    const online = result.onlineDelivery && result.onlineDelivery.online;
    const dsrStatus = result.onlineDelivery && result.onlineDelivery.dsrStatus;
    const emailStatus = result.onlineDelivery && result.onlineDelivery.emailStatus;

    const setDeliveryStage = (stage, delivered, label) => {
        const row = document.querySelector('.dc-lifecycle-stage[data-stage="' + stage + '"]');
        if (!row) return;
        row.classList.remove("is-active");
        if (delivered) {
            row.classList.add("is-complete");
            row.querySelector(".dc-lifecycle-stage-icon").textContent = "✓";
            row.querySelector(".dc-lifecycle-stage-state").textContent = "Complete";
        }
        else {
            row.classList.add("is-pending");
            row.querySelector(".dc-lifecycle-stage-icon").textContent = "⏳";
            row.querySelector(".dc-lifecycle-stage-state").textContent = label;
        }
    };

    if (result.consolidatedReportingJob) {
        setDeliveryStage("UPDATING_DSR", dsrStatus === "DELIVERED", online ? "Queued for retry" : "Pending • will update when online");
        setDeliveryStage("SENDING_EMAIL", emailStatus === "DELIVERED", online ? "Queued for retry" : "Pending • will send when online");
    }

    const complete = document.querySelector('.dc-lifecycle-stage[data-stage="COMPLETING_DAY_CLOSING"]');
    if (complete) {
        complete.classList.remove("is-active");
        complete.classList.add("is-complete");
        complete.querySelector(".dc-lifecycle-stage-icon").textContent = "✓";
        complete.querySelector(".dc-lifecycle-stage-state").textContent = "Complete";
    }

    const title = document.getElementById("dcLifecycleTitle");
    title.textContent = "DAY CLOSING SUCCESSFUL";
    title.className = "is-success";
    document.getElementById("dcLifecycleSubtitle").textContent =
        "Business Day is closed and the mandatory backup is verified.";

    const pendingCount = [dsrStatus, emailStatus].filter(status =>
        result.consolidatedReportingJob && status !== "DELIVERED"
    ).length;
    const notice = document.getElementById("dcLifecycleNotice");
    if (pendingCount || warnings.length) {
        notice.hidden = false;
        notice.className = "dc-lifecycle-notice is-warning";
        const queueText = pendingCount
            ? pendingCount + " online task" + (pendingCount === 1 ? " is" : "s are") +
              " safely queued and will continue automatically."
            : "";
        notice.textContent = [queueText, ...warnings].filter(Boolean).join(" ");
    }

    document.getElementById("dcLifecycleCloseBtn").disabled = false;
}

function failDayClosingLifecycle(message, dayClosed = false) {
    const title = document.getElementById("dcLifecycleTitle");
    title.textContent = dayClosed ? "BACKUP VERIFICATION FAILED" : "DAY CLOSING FAILED";
    title.className = "is-error";
    document.getElementById("dcLifecycleSubtitle").textContent = dayClosed
        ? "The accounting day is CLOSED, but Safe Exit is blocked until a verified backup is available."
        : "The Business Day was not closed safely.";
    const notice = document.getElementById("dcLifecycleNotice");
    notice.hidden = false;
    notice.className = "dc-lifecycle-notice is-error";
    notice.textContent = message || "Day Closing could not be completed.";
    document.getElementById("dcLifecycleCloseBtn").disabled = true;
    document.getElementById("dcLifecycleReturnBtn").hidden = false;
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
            detail: "The day becomes CLOSED before the mandatory post-close backup is created and verified. Online DSR/email work will complete now when possible or remain safely queued for retry."
        });
        if (confirmation.response !== 1) return;

        closeButton.disabled = true;
        closeButton.textContent = "CLOSING IN PROGRESS";
        resetDayClosingLifecycle();

        const result = await window.electronAPI.closeBusinessDay();
        if (result.alreadyClosed || result.alreadyClosing) {
            ensureDayClosingLifecycleOverlay().classList.remove("is-visible");
            await window.electronAPI.showMessageBox({
                type: "info",
                title: result.alreadyClosed ? "Business Day Already Closed" : "Day Closing In Progress",
                message: result.message || (result.alreadyClosed
                    ? "The business day is already closed."
                    : "Another Day Closing request is already running.")
            });
            await showDayClosingPage();
            return;
        }

        if (!result.success) {
            failDayClosingLifecycle(
                result.error || "Mandatory Day Closing work failed.",
                Boolean(result.dayClosed)
            );
            await window.refreshNewBillBusinessDayState?.();
            return;
        }

        renderDayClosingSummary(result.snapshot);
        let printWarning = null;
        const printResult = await window.electronAPI.printDayClosing(result.snapshotId);
        if (!printResult.success) {
            printWarning = "Receipt printing failed: " + (printResult.error || "Printer unavailable.");
        }

        const warnings = [];
        if (printWarning) warnings.push(printWarning);
        if (result.activityWarning) warnings.push("Activity Log warning: " + result.activityWarning);
        finishDayClosingLifecycle(result, warnings);
        await window.refreshNewBillBusinessDayState?.();
    }
    catch (error) {
        console.error("Day Closing Error:", error);
        if (closeButton) closeButton.disabled = false;
        ensureDayClosingLifecycleOverlay();
        failDayClosingLifecycle(error.message, false);
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

                    <select
                        id="dayReopenReasonInput"
                        class="day-reopen-reason-select"
                        required>
                        <option value="">Select Reopen Reason</option>
                        ${window.KLBS_DAY_REOPEN_REASONS
                            .map(reason => `<option value="${reason}">${reason}</option>`)
                            .join("")}
                    </select>

                    <div
                        id="dayReopenReasonError"
                        class="day-reopen-reason-error">
                    </div>

                </div>

                <div class="day-reopen-modal-actions">

                    <button
                        id="cancelDayReopenReasonBtn"
                        class="day-reopen-modal-btn secondary klbs-cancel-btn">

                        CANCEL

                    </button>

                    <button
                        id="continueDayReopenReasonBtn"
                        class="day-reopen-modal-btn primary klbs-primary-btn">

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

            if (!window.KLBS_isValidDayReopenReason(reason)) {

                error.textContent =
                    "Please select a reason for Day Re-open.";

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
                    event.stopPropagation();

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

        await window.refreshNewBillBusinessDayState?.();

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
