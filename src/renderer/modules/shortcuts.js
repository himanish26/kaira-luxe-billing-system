/* =====================================
   KEYBOARD SHORTCUT MANAGER
===================================== */

function initializeKeyboardShortcuts() {

    document.addEventListener(
        "keydown",
        handleKeyboardShortcut
    );

    document.addEventListener(
        "contextmenu",
        handleKLBSContextMenu
    );

}

/* =====================================
   RIGHT-CLICK CONTEXT MENU
===================================== */

let klbsContextMenu = null;
let klbsContextTarget = null;

function initializeKLBSContextMenu() {

    klbsContextMenu =
        document.createElement("div");

    klbsContextMenu.id =
        "klbsContextMenu";

    klbsContextMenu.innerHTML = `
        <button data-action="undo">
            Undo
        </button>

        <button data-action="redo">
            Redo
        </button>

        <div class="klbs-context-divider"></div>

        <button data-action="cut">
            Cut
        </button>

        <button data-action="copy">
            Copy
        </button>

        <button data-action="paste">
            Paste
        </button>

        <button data-action="delete">
            Delete
        </button>

        <div class="klbs-context-divider"></div>

        <button data-action="selectAll">
            Select All
        </button>
    `;

    klbsContextMenu.style.display =
        "none";

    document.body.appendChild(
        klbsContextMenu
    );

    klbsContextMenu.addEventListener(
        "click",
        handleKLBSContextMenuAction
    );

    document.addEventListener(
        "mousedown",
        (event) => {

            if (
                event.button !== 2 &&
                !klbsContextMenu.contains(
                    event.target
                )
            ) {

                hideKLBSContextMenu();

            }

        }
    );

    document.addEventListener(
        "scroll",
        hideKLBSContextMenu,
        true
    );

}

function handleKLBSContextMenu(event) {

    const target =
        event.target.closest(
            "input, textarea"
        );

    if (!target) {

        hideKLBSContextMenu();

        return;

    }

    event.preventDefault();

if (!klbsContextMenu) {

    initializeKLBSContextMenu();

}

    klbsContextTarget =
        target;

    updateKLBSContextMenuState();

    showKLBSContextMenu(
        event.clientX,
        event.clientY
    );

}

function showKLBSContextMenu(x, y) {

    klbsContextMenu.style.display =
        "block";
  
    const menuWidth =
        klbsContextMenu.offsetWidth;

    const menuHeight =
        klbsContextMenu.offsetHeight;

    const maxX =
        window.innerWidth - menuWidth - 5;

    const maxY =
        window.innerHeight - menuHeight - 5;

    klbsContextMenu.style.left =
        `${Math.max(5, Math.min(x, maxX))}px`;

    klbsContextMenu.style.top =
        `${Math.max(5, Math.min(y, maxY))}px`;

}

function hideKLBSContextMenu() {

    if (klbsContextMenu) {

        klbsContextMenu.style.display =
            "none";

    }

    klbsContextTarget =
        null;

}

function updateKLBSContextMenuState() {

    if (
        !klbsContextMenu ||
        !klbsContextTarget
    ) {

        return;

    }

    const target =
        klbsContextTarget;

    const hasSelection =
        target.selectionStart !==
        target.selectionEnd;

    const isReadOnly =
        target.readOnly === true;

    const isDisabled =
        target.disabled === true;

    const buttons =
        klbsContextMenu.querySelectorAll(
            "button[data-action]"
        );

    buttons.forEach((button) => {

        const action =
            button.dataset.action;

        let disabled =
            false;

        switch (action) {

            case "cut":

                disabled =
                    !hasSelection ||
                    isReadOnly ||
                    isDisabled;

                break;

            case "copy":

                disabled =
                    !hasSelection;

                break;

            case "paste":

                disabled =
                    isReadOnly ||
                    isDisabled;

                break;

            case "delete":

                disabled =
                    !hasSelection ||
                    isReadOnly ||
                    isDisabled;

                break;

            case "selectAll":

                disabled =
                    isDisabled ||
                    target.value.length === 0;

                break;

            case "undo":

            case "redo":

                disabled =
                    isReadOnly ||
                    isDisabled;

                break;

        }

        button.disabled =
            disabled;

    });

}

async function handleKLBSContextMenuAction(event) {

    const button =
        event.target.closest(
            "button[data-action]"
        );

    if (
        !button ||
        button.disabled ||
        !klbsContextTarget
    ) {

        return;

    }

    const action =
        button.dataset.action;

    klbsContextTarget.focus();

    switch (action) {

        case "undo":

            document.execCommand(
                "undo"
            );

            break;

        case "redo":

            document.execCommand(
                "redo"
            );

            break;

        case "cut":

            document.execCommand(
                "cut"
            );

            break;

        case "copy":

            document.execCommand(
                "copy"
            );

            break;

case "paste": {

    try {

        const clipboardText =
            await navigator.clipboard.readText();

        if (!clipboardText) {
            break;
        }

        const target =
            klbsContextTarget;

        const start =
            target.selectionStart;

        const end =
            target.selectionEnd;

        const currentValue =
            target.value;

        target.value =
            currentValue.substring(
                0,
                start
            ) +
            clipboardText +
            currentValue.substring(
                end
            );

        const newCursorPosition =
            start +
            clipboardText.length;

        target.selectionStart =
            newCursorPosition;

        target.selectionEnd =
            newCursorPosition;

        target.dispatchEvent(
            new Event(
                "input",
                {
                    bubbles: true
                }
            )
        );

        target.dispatchEvent(
            new Event(
                "change",
                {
                    bubbles: true
                }
            )
        );

    } catch (error) {

        console.error(
            "KLBS Paste Failed:",
            error
        );

    }

    break;
}

            break;

        case "delete":

            document.execCommand(
                "delete"
            );

            break;

        case "selectAll":

            klbsContextTarget.select();

            break;

    }

    hideKLBSContextMenu();

}

async function openNewBill() {

    const newBillButton =
        document.getElementById("newBillBtn");

    if (newBillButton?.disabled) {
        const allowed =
            await window.guardNewBillBusinessDay?.();

        if (!allowed) {
            return;
        }

        await window.refreshNewBillBusinessDayState?.();
    }

    newBillButton?.click();

}

function openBillHistory() {

    abandonNewBillDraftBeforeNavigation();

    document.getElementById("billHistoryBtn")?.click();

}

function openBusinessWorkspace() {

    abandonNewBillDraftBeforeNavigation();

    document.getElementById("reportsBtn")?.click();

}

function openSettings() {

    abandonNewBillDraftBeforeNavigation();

    document.getElementById("settingsBtn")?.click();

}

function abandonNewBillDraftBeforeNavigation() {
    if (
        document.getElementById("newBillScreen")?.style.display === "block" &&
        document.getElementById("paymentScreen")?.style.display !== "block"
    ) {
        window.abandonNewBillSession?.();
    }
}

function handleEscape() {

    if (window.isAuthorizationPresentationPending?.()) {
        document.getElementById("adminCancelBtn")?.click();
        return;
    }

    if (window.isNewBillCustomerDrawerOpen?.()) {
        window.closeNewBillCustomerDrawer?.();
        return;
    }

    // Customer dialogs own Escape before the New Bill page can navigate away.
    for (const [modalId, closeId] of [
        ["customerProfileModal", "customerProfileCancel"]
    ]) {
        const modal = document.getElementById(modalId);
        if (!modal) continue;
        const style = window.getComputedStyle(modal);
        if (style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0") {
            document.getElementById(closeId)?.click();
            return;
        }
    }

    // Dialogs own Cancel; never navigate the page beneath an active modal.
    for (const modalId of ["processingDialog", "appLockOverlay", "dayClosingLifecycleOverlay"]) {
        const modal = document.getElementById(modalId);
        if (!modal) continue;
        const style = window.getComputedStyle(modal);
        if (style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0") {
            return;
        }
    }
    if (window.isManagementAccountingEntryDetailOpen?.()) {
        window.closeManagementAccountingEntryDetail?.();
        return;
    }
    for (const [modalId, cancelId] of [
        ["storeCreditModal", "cancelStoreCreditBtn"],
        ["giftVoucherDialog", "giftVoucherCancelBtn"],
        ["returnReasonDialog", "returnReasonCancelBtn"],
        ["variableValueDialog", "variableValueCancelBtn"],
        ["dayReopenReasonModal", "cancelDayReopenReasonBtn"]
    ]) {
        const modal = document.getElementById(modalId);
        if (!modal) continue;
        const style = window.getComputedStyle(modal);
        if (style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0") {
            document.getElementById(cancelId)?.click();
            return;
        }
    }

    // Processing Dialog
    if (
        document.getElementById("processingDialog")
            ?.style.display === "flex"
    ) {

        return;

    }

        // Coming Soon Dialog
    if (
        document.querySelector(
            ".klbs-coming-soon-overlay"
        )
    ) {

        document.getElementById(
            "comingSoonOkBtn"
        )?.click();

        return;

    }

    // Family & Friends Discount Dialog
    if (
        document.getElementById("ffDiscountDialog")
            ?.style.display === "flex"
    ) {

        document.getElementById(
            "ffDiscountCancelBtn"
        )?.click();

        return;

    }

    // Product Not Found Dialog
    if (
        document.getElementById("productNotFoundDialog")
            ?.style.display === "flex"
    ) {

        document.getElementById(
            "productNotFoundOkBtn"
        )?.click();

        return;

    }

    // Insufficient Stock Dialog
    if (
        document.getElementById("insufficientStockDialog")
            ?.style.display === "flex"
    ) {

        document.getElementById(
            "insufficientStockOkBtn"
        )?.click();

        return;

    }

    // Stock Transaction Modal
    if (
        document.getElementById("stockTransactionModal")
            ?.style.display === "flex"
    ) {

        document.getElementById(
            "cancelStockTransactionBtn"
        )?.click();

        return;

    }

    // Admin Dialog
    if (
        document.getElementById("adminDialog")
            ?.style.display === "flex"
    ) {

        document.getElementById(
            "adminCancelBtn"
        )?.click();

        return;

    }

    // Payment Correction
    if (
        document.getElementById("paymentCorrectionModal")
            ?.style.display === "flex"
    ) {

        document.getElementById(
            "cancelPaymentCorrectionBtn"
        )?.click();

        return;

    }

    // View Bill
    if (
        document.getElementById("viewBillScreen")
            ?.style.display === "block"
    ) {

        document.getElementById(
            "viewBillBackBtn"
        )?.click();

        return;

    }

    // Payment Screen
    if (
        document.getElementById("paymentScreen")
            ?.style.display === "block"
    ) {

        document.getElementById(
            "paymentBackBtn"
        )?.click();

        return;

    }

    // New Bill
    if (
        document.getElementById("newBillScreen")
            ?.style.display === "block"
    ) {

        document.getElementById(
            "backBtn"
        )?.click();

        return;

    }

    // Bill History
    if (
        document.getElementById("billHistoryScreen")
            ?.style.display === "block"
    ) {

        document.getElementById(
            "historyBackBtn"
        )?.click();

        return;

    }

    // Reports
    if (
        document.getElementById("reportsScreen")
            ?.style.display === "block"
    ) {

        document.getElementById(
            "reportsDashboardBtn"
        )?.click();

        return;

    }

    // Customers and Accounting & Data return to Business.
    if (document.getElementById("customerManagementProfile")?.hidden === false) {
        document.getElementById("customerProfileBackToDirectory")?.click();
        return;
    }
    if (document.getElementById("managementAccountingEntriesScreen")?.style.display === "block") {
        document.getElementById("managementAccountingEntriesBackBtn")?.click();
        return;
    }
    for (const [screenId, backId] of [
        ["expenseHistoryScreen", "expenseHistoryBackBtn"],
        ["expenseTrackerScreen", "expenseTrackerBackBtn"],
        ["managementPnlScreen", "managementPnlBackBtn"],
        ["customersScreen", "customersBusinessBtn"],
        ["accountingDataScreen", "accountingBusinessBtn"]
    ]) {
        if (document.getElementById(screenId)?.style.display === "block") {
            document.getElementById(backId)?.click();
            return;
        }
    }

    // Business returns to Dashboard.
    if (document.getElementById("businessScreen")?.style.display === "block") {
        document.getElementById("businessDashboardBtn")?.click();
        return;
    }

    // Settings Page
    if (
        document.getElementById("settingsPage")
            ?.style.display === "block"
    ) {

        document.getElementById(
            "settingsPageBackBtn"
        )?.click();

        return;

    }

    // Settings Home
    if (
        document.getElementById("settingsScreen")
            ?.style.display === "block"
    ) {

        document.getElementById(
            "settingsDashboardBtn"
        )?.click();

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

/* =====================================
   KLBS MODAL DETECTION
===================================== */

function isKLBSModalOpen() {

    if (window.isAuthorizationPresentationPending?.()) return true;

    if (window.isNewBillCustomerDrawerOpen?.()) return true;

    const modalIds = [
        "processingDialog",
        "productNotFoundDialog",
        "insufficientStockDialog",
        "adminDialog",
        "paymentCorrectionModal",
        "ffDiscountDialog",
        "stockTransactionModal",
        "storeCreditModal",
        "giftVoucherDialog",
        "returnReasonDialog",
        "variableValueDialog",
        "customerProfileModal",
        "dayReopenReasonModal",
        "dayClosingLifecycleOverlay",
        "appLockOverlay"
    ];

    const idModalOpen = modalIds.some((id) => {

        const modal =
            document.getElementById(id);

        if (!modal) {

            return false;

        }

        const style =
            window.getComputedStyle(modal);

        return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            style.opacity !== "0"
        );

    });

    if (idModalOpen) {

        return true;

    }

    const dynamicModal =
        document.querySelector(
            ".klbs-coming-soon-overlay"
        );

    if (!dynamicModal) {

        return false;

    }

    const dynamicStyle =
        window.getComputedStyle(dynamicModal);

    return (
        dynamicStyle.display !== "none" &&
        dynamicStyle.visibility !== "hidden" &&
        dynamicStyle.opacity !== "0"
    );

}

function handleKeyboardShortcut(event) {
    /* =====================================
       BLOCK PAGE SHORTCUTS WHEN
       KLBS MODAL IS OPEN
    ===================================== */

    if (isKLBSModalOpen()) {

        // Allow ESC only so the active modal
        // can be cancelled or closed
        if (event.code === "Escape") {

            event.preventDefault();

            event.stopPropagation();

            event.stopImmediatePropagation?.();

            handleEscape();

            return;

        }

        // Block all KLBS function shortcuts
        if (
            [
                "F2",
                "F3",
                "F4",
                "F5",
                "F8",
                "F10",
                "F12"
            ].includes(event.code)
        ) {

            event.preventDefault();

            event.stopPropagation();

            return;

        }

    }

    // Let existing KLBS dialogs own Escape before Supplier page navigation.
    if (event.code === "Escape" && window.handleSupplierEscape?.()) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        return;
    }

    /* =====================================
       NORMAL KEYBOARD SHORTCUTS
    ===================================== */

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

            openBusinessWorkspace();

            break;


        case "F5":

            event.preventDefault();

            openSettings();

            break;


        case "F8":

            event.preventDefault();

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
