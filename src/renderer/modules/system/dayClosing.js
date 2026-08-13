async function showDayClosingPage() {

    renderSettingsPage({

        title: "DAY CLOSING",

        icon: "🌙",

        subtitle: "Today's business summary",

        backText: "← System",

        backAction: showSystemPage,

        content: `

<div class="settings-card day-closing-card">

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

</div>

<div style="text-align:center;margin-top:40px;">

    <button
        id="startDayClosingBtn"
        class="export-report-btn">

        🌙 CLOSE BUSINESS DAY

    </button>

    <br>

    <button
        id="reopenDayBtn"
        class="export-report-btn"
        disabled
        style="margin-top:15px;">

        🔓 DAY RE-OPEN

    </button>

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



const startDayClosingBtn =
    document.getElementById(
        "startDayClosingBtn"
    );

const reopenDayBtn =
    document.getElementById(
        "reopenDayBtn"
    );

if (startDayClosingBtn) {

    startDayClosingBtn.addEventListener(
        "click",
        startDayClosing
    );

}

if (reopenDayBtn) {

    reopenDayBtn.addEventListener(
        "click",
        reopenBusinessDay
    );

}

try {

    const status =
        await window.electronAPI
            .getBusinessDayStatus();

    if (status.closed) {

        startDayClosingBtn.disabled =
            true;

        startDayClosingBtn.textContent =
            "✓ BUSINESS DAY CLOSED";

        reopenDayBtn.disabled =
            false;

    }

    else {

        startDayClosingBtn.disabled =
            false;

        startDayClosingBtn.textContent =
            "🌙 CLOSE BUSINESS DAY";

        reopenDayBtn.disabled =
            true;

    }

}

catch (error) {

    console.error(
        "Business Day Status Error:",
        error
    );

}

}

/* ==========================================
   START DAY CLOSING
========================================== */

async function startDayClosing() {

    try {

        /*
         * STEP 1
         * Confirm with operator.
         */

        const confirmation =

            await window
                .electronAPI
                .showMessageBox({

                    type: "warning",

                    title:
                        "Close Business Day",

                    buttons: [

                        "Cancel",

                        "Close Business Day"

                    ],

                    defaultId: 1,

                    cancelId: 0,

                    message:
                        "Are you sure you want to close the current business day?",

                    detail:
                        "Once closed, no new bills can be generated for today."

                });


        if (
            confirmation.response !== 1
        ) {

            return;

        }


        /*
         * STEP 2
         * Close business day.
         *
         * This now performs:
         * - day_closing insert
         * - database backup
         * - backup verification
         * - backup_status update
         * - activity log
         */

        const result =

            await window
                .electronAPI
                .closeBusinessDay();


        if (
            result.alreadyClosed
        ) {

            await window
                .electronAPI
                .showMessageBox({

                    type: "info",

                    title:
                        "Business Day Already Closed",

                    message:
                        "Today's business day has already been closed.",

                    detail:
                        `Closed at: ${result.closedAt}`

                });

            return;

        }


        if (
            !result.success
        ) {

            throw new Error(

                result.error ||
                result.message ||
                "Business Day could not be closed."

            );

        }


        /*
         * STEP 3
         * Get the final summary for printing.
         */

        const summary =

            await window
                .electronAPI
                .getDayClosingSummary();


        summary.businessDate =

            document
                .getElementById(
                    "dcBusinessDate"
                )
                .textContent;


        summary.closingTime =

            new Date().toLocaleTimeString(

                "en-IN",

                {

                    hour: "2-digit",

                    minute: "2-digit",

                    hour12: true

                }

            );


        /*
         * STEP 4
         * Print existing Day Closing receipt.
         *
         * Receipt design is untouched.
         */

        const printResult =

            await window
                .electronAPI
                .printDayClosing(
                    summary
                );


        if (
            !printResult.success
        ) {

            throw new Error(

                printResult.error ||
                "Day Closing completed, but receipt printing failed."

            );

        }


        /*
         * STEP 5
         * Disable button for this session.
         */

        const closeButton =
    document.getElementById(
        "startDayClosingBtn"
    );

const reopenButton =
    document.getElementById(
        "reopenDayBtn"
    );

if (closeButton) {

    closeButton.disabled =
        true;

    closeButton.textContent =
        "✓ BUSINESS DAY CLOSED";

}

if (reopenButton) {

    reopenButton.disabled =
        false;

}


        /*
         * STEP 6
         * Final confirmation.
         */

        await window
            .electronAPI
            .showMessageBox({

                type: "info",

                title:
                    "Day Closing Complete",

                message:
                    "Business Day closed successfully.",

                detail:
                    "Database backup completed and verified.\n\nNo further bills can be generated for today."

            });

    }

    catch (error) {

        console.error(
            "Day Closing Error:",
            error
        );

        await window
            .electronAPI
            .showMessageBox({

                type: "error",

                title:
                    "Day Closing Failed",

                message:
                    error.message

            });

    }

}

/* ==========================================
   RE-OPEN BUSINESS DAY
========================================== */

async function reopenBusinessDay() {

    try {

        requireAdminAuthorization(
            async () => {

                try {

                    const result =
                        await window.electronAPI
                            .reopenBusinessDay();

                    if (!result.success) {

                        await window.electronAPI
                            .showMessageBox({

                                type: "error",

                                title:
                                    "Day Re-open Failed",

                                message:
                                    result.message ||
                                    result.error ||
                                    "Business Day could not be re-opened."

                            });

                        return;

                    }

                    await window.electronAPI
                        .showMessageBox({

                            type: "info",

                            title:
                                "Business Day Re-opened",

                            message:
                                "Business Day re-opened successfully.",

                            detail:
                                "Billing is now available again."

                        });

                    const closeButton =
                        document.getElementById(
                            "startDayClosingBtn"
                        );

                    const reopenButton =
                        document.getElementById(
                            "reopenDayBtn"
                        );

                    if (closeButton) {

                        closeButton.disabled =
                            false;

                        closeButton.textContent =
                            "🌙 CLOSE BUSINESS DAY";

                    }

                    if (reopenButton) {

                        reopenButton.disabled =
                            true;

                    }

                }

                catch (error) {

                    console.error(
                        "Day Re-open Error:",
                        error
                    );

                    await window.electronAPI
                        .showMessageBox({

                            type: "error",

                            title:
                                "Day Re-open Failed",

                            message:
                                error.message

                        });

                }

            }
        );

    }

    catch (error) {

        console.error(
            "Day Re-open Authorization Error:",
            error
        );

    }

}