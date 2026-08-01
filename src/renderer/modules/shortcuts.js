/* =====================================
   KEYBOARD SHORTCUT MANAGER
===================================== */

function initializeKeyboardShortcuts() {

    console.log("Keyboard Shortcuts Loaded");

    document.addEventListener(
        "keydown",
        handleKeyboardShortcut
    );

}

function openNewBill() {

    if (
        document.getElementById("paymentScreen")?.style.display === "block"
    ) {

        if (!window.confirmDiscardCurrentBill()) {

            return;

        }

    }

    document.getElementById("newBillBtn")?.click();

}

function openBillHistory() {

    if (
        document.getElementById("paymentScreen")?.style.display === "block"
    ) {

        if (!window.confirmDiscardCurrentBill()) {

            return;

        }

    }

    document.getElementById("billHistoryBtn")?.click();

}

function openReports() {

    if (
        document.getElementById("paymentScreen")?.style.display === "block"
    ) {

        if (!window.confirmDiscardCurrentBill()) {

            return;

        }

    }

    document.getElementById("reportsBtn")?.click();

}

function openSettings() {

    if (
        document.getElementById("paymentScreen")?.style.display === "block"
    ) {

        if (!window.confirmDiscardCurrentBill()) {

            return;

        }

    }

    document.getElementById("settingsBtn")?.click();

}

function handleEscape() {

    // Admin Dialog
    if (document.getElementById("adminDialog")?.style.display === "flex") {

        document.getElementById("adminCancelBtn")?.click();

        return;

    }

    // Payment Correction
    if (document.getElementById("paymentCorrectionModal")?.style.display === "flex") {

        document.getElementById("cancelPaymentCorrectionBtn")?.click();

        return;

    }

    // View Bill
    if (document.getElementById("viewBillScreen")?.style.display === "block") {

        document.getElementById("viewBillBackBtn")?.click();

        return;

    }

    // Payment Screen
    if (document.getElementById("paymentScreen")?.style.display === "block") {

        document.getElementById("paymentBackBtn")?.click();

        return;

    }

    // New Bill
    if (document.getElementById("newBillScreen")?.style.display === "block") {

        document.getElementById("backBtn")?.click();

        return;

    }

    // Bill History
    if (document.getElementById("billHistoryScreen")?.style.display === "block") {

        document.getElementById("historyBackBtn")?.click();

        return;

    }

    // Reports
    if (document.getElementById("reportsScreen")?.style.display === "block") {

        document.getElementById("reportsDashboardBtn")?.click();

        return;

    }

    // Settings Page
    if (document.getElementById("settingsPage")?.style.display === "block") {

        document.getElementById("settingsPageBackBtn")?.click();

        return;

    }

    // Settings Home
    if (document.getElementById("settingsScreen")?.style.display === "block") {

        document.getElementById("settingsDashboardBtn")?.click();

        return;

    }

}

function saveBillShortcut() {

    if (
        document.getElementById("paymentScreen")?.style.display !== "block"
    ) {
        return;
    }

    const saveBtn =
        document.getElementById("saveBillBtn");

    if (
        saveBtn &&
        !saveBtn.disabled
    ) {

        saveBtn.click();

    }

}

function saveAndPrintShortcut() {

    if (
        document.getElementById("paymentScreen")?.style.display !== "block"
    ) {
        return;
    }

    const printBtn =
        document.getElementById("printBillBtn");

    if (
        printBtn &&
        !printBtn.disabled
    ) {

        printBtn.click();

    }

}

function handleKeyboardShortcut(event) {

    switch (event.code) {

        case "F2":

    event.preventDefault();

    openNewBill();

    break;

        case "F3":

    event.preventDefault();

    openBillHistory();

    break;

        case "F4":

    event.preventDefault();

    openReports();

    break;

        case "F5":

    event.preventDefault();

    openSettings();

    break;


        case "F8":

            event.preventDefault();

            console.log("F8");

            break;

        case "F10":

    event.preventDefault();

    saveBillShortcut();

    break;

        case "F12":

    event.preventDefault();

    saveAndPrintShortcut();

    break;

        case "Escape":

    event.preventDefault();

    handleEscape();

    break;

    }

}

window.initializeKeyboardShortcuts =
    initializeKeyboardShortcuts;