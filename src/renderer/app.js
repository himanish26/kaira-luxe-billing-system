console.log("Kaira Luxe Dashboard Loaded");

/* =====================================
   SCREEN REFERENCES
===================================== */

console.log(document.getElementById("viewBillScreen"));
console.log(document.getElementById("viewBillNo"));
console.log(document.getElementById("viewBillDate"));
console.log(document.getElementById("viewBillTime"));
console.log(document.getElementById("viewCustomer"));
console.log(document.getElementById("viewMobile"));
console.log(document.getElementById("viewGross"));
console.log(document.getElementById("viewDiscount"));
console.log(document.getElementById("viewNet"));
console.log(document.getElementById("viewItems"));
console.log(document.getElementById("viewQty"));
console.log(document.getElementById("viewTaxable"));
console.log(document.getElementById("viewCash"));
console.log(document.getElementById("viewUPI"));
console.log(document.getElementById("viewCard"));
console.log(document.getElementById("viewBillItems"));

function formatCurrency(value) {

    return new Intl.NumberFormat("en-IN", {

        style: "currency",

        currency: "INR",

        minimumFractionDigits: 2,

        maximumFractionDigits: 2

    }).format(Number(value) || 0);

}

    async function loadDashboardSummary() {

    try {

        const data =
            await window.electronAPI.getDashboardSummary();

        document.getElementById(
            "dashboardProducts"
        ).textContent =
            data.products ?? 0;

        document.getElementById(
            "dashboardCustomers"
        ).textContent =
            data.customers ?? 0;

        document.getElementById(
            "dashboardTodayBills"
        ).textContent =
            data.todayBills ?? 0;

        document.getElementById(
            "dashboardMTDBills"
        ).textContent =
            data.mtdBills ?? 0;

        document.getElementById(
            "dashboardCash"
        ).textContent =
            formatCurrency(
                data.cashToday || 0
            );

        document.getElementById(
            "dashboardUPI"
        ).textContent =
            formatCurrency(
                data.upiToday || 0
            );

        document.getElementById(
            "dashboardCard"
        ).textContent =
            formatCurrency(
                data.cardToday || 0
            );

        document.getElementById(
            "dashboardTotal"
        ).textContent =
            formatCurrency(
                (data.cashToday || 0)
                +
                (data.upiToday || 0)
                +
                (data.cardToday || 0)
            );

        document.getElementById(
            "dashboardTodaySales"
        ).textContent =
            formatCurrency(
                data.todaySales || 0
            );

        document.getElementById(
            "dashboardBusinessTodayBills"
        ).textContent =
            data.todayBills || 0;

        document.getElementById(
            "dashboardTodayQty"
        ).textContent =
            data.todayQtySold || 0;

        document.getElementById(
            "dashboardMTDSales"
        ).textContent =
            formatCurrency(
                data.mtdSales || 0
            );

    }

    

    catch(err){

        console.error(
            err
        );

    }



};

/* =====================================
   SYSTEM STATUS
===================================== */

async function loadSystemStatus() {

    try {

        const status =
            await window.electronAPI.getSystemStatus();

        /* DATABASE */

        document.getElementById(
            "systemDatabase"
        ).textContent =

            status.database.healthy

                ? `🟢 Healthy (${status.database.latency} ms)`
                : "🔴 Error";

        /* INTERNET */

        document.getElementById(
            "systemInternet"
        ).textContent =

            status.internet.online

                ? "🟢 Online"
                : "🔴 Offline";

                
        /* PRINTER */

const printerElement =
    document.getElementById(
        "systemPrinter"
    );

const printerName =
    status.printer.name || "";

switch (status.printer.status) {

    case "Ready":

        printerElement.textContent =
            `🟢 ${printerName}`;

        printerElement.title =
            printerName;

        break;

    case "Offline":

        printerElement.textContent =
            `🔴 ${printerName}`;

        printerElement.title =
            printerName;

        break;

    case "No Default":

        printerElement.textContent =
            "🟡 No Default Printer";

        printerElement.title = "";

        break;

    case "No Printer":

        printerElement.textContent =
            "🔴 No Printer Installed";

        printerElement.title = "";

        break;

    default:

        printerElement.textContent =
            "🔴 Unavailable";

        printerElement.title = "";

}

        /* BACKUP */

        document.getElementById(
            "systemBackup"
        ).textContent =

        status.backup.status === "Never"
            ? "🟡 Never"
            : `🟢 ${status.backup.status}`;

    }

    catch (error) {

        console.error(

            "Unable to load system status:",

            error

        );

    }

}

"use strict";

history.scrollRestoration = "manual";

const dashboardScreen =
    document.getElementById("dashboardScreen");

const newBillScreen =
    document.getElementById("newBillScreen");

const paymentScreen =
    document.getElementById("paymentScreen");

const reportsScreen =
    document.getElementById("reportsScreen");    

const billHistoryScreen =
    document.getElementById("billHistoryScreen");

const settingsScreen =
    document.getElementById("settingsScreen");

const storeCard =
    document.getElementById("storeCard");

const inventoryCard =
    document.getElementById("inventoryCard");

const systemStatusCard =
    document.getElementById("systemStatusCard");

const paymentSummaryCard =
    document.getElementById("paymentSummaryCard");

const storeOverviewCard =
    document.getElementById("storeOverviewCard");

const businessOverviewCard =
    document.getElementById("businessOverviewCard");

let businessOverviewVisible = false;

let f6Timer = null;

    if (inventoryCard) {

    inventoryCard.addEventListener("click", () => {
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   
    showInventory();

});

}
   
const deviceCard =
    document.getElementById("deviceCard");

    if (deviceCard) {

    deviceCard.addEventListener(
        "click",
        showDeviceSettings
    );

}

const systemCard =
    document.getElementById("systemCard");

    console.log(systemCard);

const aboutCard =
    document.getElementById("aboutCard");

const adminCard =
    document.getElementById("adminCard");

if (storeCard){

    storeCard.addEventListener("click", () => {

    settingsScreen.style.display = "none";

    settingsPage.style.display = "block";

    resetScrollPosition();
        
    settingsPageContent.innerHTML = `

<h1 class="settings-title">

🏪 Store Information

</h1>

<div class="store-info-card">

<div class="store-row">

<span class="store-label">

Store Name

</span>

<span
class="store-value"
id="storeNameValue">

KAIRA LUXE

</span>

</div>

<div class="store-row">

<span class="store-label">

GSTIN

</span>

<span
class="store-value"
id="storeGSTValue">

21BBLPP6327G1ZO

</span>

</div>

<div class="store-row">

    <span class="store-label">
        Phone
    </span>

    <span
        class="store-value"
        id="storePhoneValue">

        0680-3596443

    </span>

</div>

<div class="store-row">

<span class="store-label">

Email

</span>

<span
class="store-value"
id="storeEmailValue">

kairaluxe@gmail.com

</span>

</div>

<div class="store-row">

<span class="store-label">

Address

</span>

<span
class="store-value"
id="storeAddressValue">

Shop No.3<br>
Shree Towers<br>
Near Khallikote University<br>
Berhampur-760001

</span>

</div>

<div class="store-row receipt-row">

    <span class="store-label">

        Receipt Footer Message

    </span>

    <div class="receipt-value-area">

        <span
            class="store-value"
            id="storeMessageValue">

            Not Set

        </span>

        <button
            id="editReceiptBtn"
            class="edit-receipt-btn">

            ✏ Edit

        </button>

    </div>

</div>

<div
id="receiptEditor"
style="display:none;">

    <textarea
        id="receiptMessageInput"
        class="receipt-message-editor"
        rows="3"></textarea>

    <div class="receipt-actions">

        <button
            id="saveReceiptBtn"
            class="dashboard-btn">

            💾 Save

        </button>

        <button
            id="cancelReceiptBtn"
            class="dashboard-btn secondary">

            ✖ Cancel

        </button>

    </div>

</div>

<div class="store-update-log">

    <div class="update-title">

        🕒 Last Updated

    </div>

    <div
    id="storeLastUpdated"
    class="update-time">

        Never

    </div>

</div>

<button
id="unlockSettingsBtn"
class="dashboard-btn">

🔒 Unlock Settings

</button>

</div>

`;

unlockBtn =
    document.getElementById("unlockSettingsBtn");

editReceiptBtn =
document.getElementById("editReceiptBtn");

receiptEditor =
document.getElementById("receiptEditor");

receiptMessage =
document.getElementById("storeMessageValue");

receiptMessageInput =
document.getElementById("receiptMessageInput");

console.log({
    editReceiptBtn,
    receiptEditor,
    receiptMessage,
    receiptMessageInput
});

saveReceiptBtn =
document.getElementById("saveReceiptBtn");

cancelReceiptBtn =
document.getElementById("cancelReceiptBtn");

function formatKLBSLastUpdated(value) {

    if (!value || value === "Never") {
        return "Never";
    }

    const date =
        new Date(value);

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    const formattedDate =
        date.toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric"
        });

    const formattedTime =
        date.toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: true
        }).toUpperCase();

    return `${formattedDate} • ${formattedTime}`;
}

(async () => {

    try {

        const settings =
            await window.electronAPI.getSettings();

        receiptMessage.innerText =
            settings.receipt_message || "Not Set";

document.getElementById("storeLastUpdated").innerText =
    formatKLBSLastUpdated(
        settings.last_updated
    );

    }

    catch(err){

        console.error(err);

    }

})();

unlockBtn.addEventListener("click", () => {

    requireAdminAuthorization(() => {

        console.log("Callback Executed");

        unlockBtn.style.display = "none";

        receiptEditor.style.display = "none";

        editReceiptBtn.style.display = "inline-block";

    });

});

if (editReceiptBtn){

    editReceiptBtn.addEventListener("click", () => {

    receiptMessageInput.value =
    receiptMessage.textContent.trim() === "Not Set"
        ? ""
        : receiptMessage.textContent.trim();

    receiptEditor.style.display = "block";

    editReceiptBtn.style.display = "none";

});

}

if (saveReceiptBtn){

    saveReceiptBtn.addEventListener("click", async () => {

    try {

        const msg =
            receiptMessageInput.value
                .replace(/\s+/g, " ")
                .trim();

        const now = new Date();

        const formattedDate =
            now.toLocaleDateString("en-GB", {
                day: "2-digit",
                month: "short",
                year: "numeric"
            });

        const formattedTime =
            now.toLocaleTimeString("en-IN", {
                hour: "2-digit",
                minute: "2-digit",
                hour12: true
            }).toUpperCase();

        const lastUpdated =
            `${formattedDate} • ${formattedTime}`;

        const current =
    await window.electronAPI.getSettings();

await window.electronAPI.saveSettings({

    receipt_message: msg,

    backup_location: current.backup_location,

    auto_backup_time: current.auto_backup_time,

    last_updated: lastUpdated

});

        receiptMessage.innerText =
            msg || "Not Set";

        document.getElementById("storeLastUpdated").innerText =
            lastUpdated;

        receiptEditor.style.display = "none";

        editReceiptBtn.style.display = "inline-block";

        alert("✅ Receipt Footer Message updated successfully.");

    }

    catch(err){

        console.error(err);

        alert(err.message);

    }

});

}

if (cancelReceiptBtn){

    cancelReceiptBtn.addEventListener("click", () => {

        receiptEditor.style.display = "none";

        editReceiptBtn.style.display = "inline-block";

    });

}
    });

    
}

systemCard.addEventListener(
    "click",
    showSystemPage
);

console.log("System listener attached");

    const settingsPage =
    document.getElementById("settingsPage");

const settingsPageContent =
    document.getElementById("settingsPageContent");

const settingsPageBackBtn =
    document.getElementById("settingsPageBackBtn");

const adminDialog =
    document.getElementById("adminDialog");

const adminPassword =
    document.getElementById("adminPassword");

const adminCancelBtn =
    document.getElementById("adminCancelBtn");

const adminUnlockBtn =
    document.getElementById("adminUnlockBtn");

const productNotFoundDialog =
    document.getElementById("productNotFoundDialog");

const productNotFoundMessage =
    document.getElementById("productNotFoundMessage");

const productNotFoundOkBtn =
    document.getElementById("productNotFoundOkBtn");  

const insufficientStockDialog =
    document.getElementById("insufficientStockDialog");

const insufficientStockMessage =
    document.getElementById("insufficientStockMessage");

const insufficientStockOkBtn =
    document.getElementById("insufficientStockOkBtn");

    let unlockBtn;

    let editReceiptBtn;
    let receiptEditor;
    let receiptMessage;
    let receiptMessageInput;

    let saveReceiptBtn;
    let cancelReceiptBtn;

    let isEditMode = false;

    let adminSuccessCallback = null;
    
    if (settingsPageBackBtn){

    settingsPageBackBtn.addEventListener("click", () => {

        settingsPage.style.display = "none";

        settingsScreen.style.display = "block";

        resetScrollPosition();

    });

}

function requireAdminAuthorization(callback){

    adminSuccessCallback = callback;

    adminPassword.value = "";

    document.getElementById("adminError").innerText = "";

    adminDialog.style.display = "flex";

    requestAnimationFrame(() => {

        adminPassword.focus();

        adminPassword.select();

    });

}

function showProcessingDialog(title = "Processing...") {

    document.getElementById("processingTitle").innerText = title;

    document.getElementById("processingStatus").innerText = "Preparing...";

    document.getElementById("progressFill").style.width = "0%";

    document.getElementById("progressPercent").innerText = "0%";

    document.getElementById("processingDialog").style.display = "flex";

}

function updateProgress(percent, status) {

    document.getElementById("progressFill").style.width =
        percent + "%";

    document.getElementById("progressPercent").innerText =
        percent + "%";

    document.getElementById("processingStatus").innerText =
        status;

}

function hideProcessingDialog(){

    document.getElementById("processingDialog").style.display =
        "none";

}

function showProductNotFoundDialog(barcode) {

    productNotFoundOpen = true;

    const barcodeInput =
        document.getElementById("barcodeInput");

    if (barcodeInput) {

        barcodeInput.blur();

        barcodeInput.disabled = true;

    }

    productNotFoundMessage.innerText =
        "Barcode: " + barcode;

    productNotFoundDialog.style.display =
        "flex";

}

if (productNotFoundOkBtn) {

    productNotFoundOkBtn.addEventListener(
        "click",
        () => {

            productNotFoundOpen = false;

            productNotFoundDialog.style.display =
                "none";

            const barcodeInput =
                document.getElementById(
                    "barcodeInput"
                );

            if (barcodeInput) {

                barcodeInput.disabled = false;

                requestAnimationFrame(() => {

                    barcodeInput.focus();
                    barcodeInput.select();

                });

            }

        }
    );

}

/* =====================================
   INSUFFICIENT STOCK DIALOG
===================================== */

function showInsufficientStockDialog(
    productName,
    availableStock,
    currentBillQty
) {

    const barcodeInput =
        document.getElementById("barcodeInput");

    if (barcodeInput) {

        barcodeInput.blur();

        barcodeInput.disabled = true;

    }

    insufficientStockMessage.innerText =
        `${productName}\n\n` +
        `Available Stock: ${availableStock}\n` +
        `Already Added to Bill: ${currentBillQty}`;

    insufficientStockDialog.style.display =
        "flex";

}


if (insufficientStockOkBtn) {

    insufficientStockOkBtn.addEventListener(
        "click",
        () => {

            insufficientStockDialog.style.display =
                "none";

            const barcodeInput =
                document.getElementById(
                    "barcodeInput"
                );

            if (barcodeInput) {

                barcodeInput.disabled = false;

                requestAnimationFrame(() => {

                    barcodeInput.focus();

                    barcodeInput.select();

                });

            }

        }
    );

}

if (adminCancelBtn){

    adminCancelBtn.addEventListener("click", () => {

        adminDialog.style.display = "none";

    });

}

if (adminUnlockBtn){

    adminUnlockBtn.addEventListener("click", () => {

        if (adminPassword.value === "onelove26@L") {

    document.getElementById("adminError").innerText = "";

    adminUnlockBtn.innerText =

        "✔ Access Granted";

    adminUnlockBtn.classList.add("success");

    setTimeout(() => {

    adminDialog.style.display = "none";

    adminPassword.value = "";

    adminUnlockBtn.innerText =
        "Unlock";

    adminUnlockBtn.classList.remove("success");

    isEditMode = true;

if (adminSuccessCallback){

    adminSuccessCallback();

    adminSuccessCallback = null;

}

}, 500);

}
        else{

            document.getElementById("adminError").innerText =
                "❌ Incorrect administrator password.";

            const dialog =

    document.querySelector(".modal-content");

dialog.classList.add("shake");

setTimeout(() => {

    dialog.classList.remove("shake");

},350);

            adminPassword.value = "";

            adminPassword.focus();

        }

    });

}

if (adminPassword){

    adminPassword.addEventListener("keypress", (event) => {

        if(event.key === "Enter"){

            adminUnlockBtn.click();

        }

    });

}

adminPassword.addEventListener("paste", (event) => {

    event.preventDefault();

});

adminPassword.addEventListener("drop", (event) => {

    event.preventDefault();

});

adminPassword.addEventListener("focus", () => {

    adminPassword.select();

});

document.addEventListener("keydown", (event) => {

    if(
        event.key === "Escape" &&
        adminDialog.style.display === "flex"
    ){

        adminDialog.style.display = "none";

    }

});

const reportsBtn =
    document.getElementById("reportsBtn");

const settingsBtn =
    document.getElementById("settingsBtn");

if (reportsBtn) {

    reportsBtn.addEventListener("click", async () => {

    if (!(await guardBusyOperation())) {

        return;

    }

        hideAllScreens();

        reportsScreen.style.display = "block";

    });

}


/* =====================================
   NEW BILL BUTTON
===================================== */

const newBillBtn =
    document.getElementById("newBillBtn");

if (newBillBtn) {

    newBillBtn.addEventListener("click", async () => {

    if (!(await guardBusyOperation())) {

        return;

    }

        hideAllScreens();

        clearCurrentBill();

        newBillScreen.style.display = "block";
        
        const barcodeInput =
            document.getElementById("barcodeInput");

        if (barcodeInput) {

            setTimeout(() => {

                barcodeInput.focus();

            }, 200);

        }

    });

}


/* =====================================
   SETTINGS
===================================== */

if (settingsBtn){

    settingsBtn.addEventListener("click", async () => {

    if (!(await guardBusyOperation())) {

        return;

    }

    hideAllScreens();

    settingsScreen.style.display = "block";

});

}

const settingsDashboardBtn =
    document.getElementById("settingsDashboardBtn");

if (settingsDashboardBtn){

    settingsDashboardBtn.addEventListener("click", async () => {

        settingsScreen.style.display = "none";

        dashboardScreen.style.display = "block";

        resetScrollPosition();

        await loadDashboardSummary();

    });
    

}

const reportsDashboardBtn =
    document.getElementById("reportsDashboardBtn");

if (reportsDashboardBtn){

    reportsDashboardBtn.addEventListener("click", () => {

        reportsScreen.style.display = "none";

        dashboardScreen.style.display = "block";

        resetScrollPosition();

        loadDashboardSummary();

    });

}

const saveBillBtn =
    document.getElementById("saveBillBtn");
const printBillBtn =
    document.getElementById("printBillBtn");

document.getElementById("cashAmount")
    ?.addEventListener("input", calculatePayment);

document.getElementById("upiAmount")
    ?.addEventListener("input", calculatePayment);

document.getElementById("cardAmount")
    ?.addEventListener("input", calculatePayment);
if (saveBillBtn) {

    saveBillBtn.addEventListener(
        "click",
        saveCurrentBill
    );

}

if (printBillBtn) {

    printBillBtn.addEventListener(
        "click",
        saveAndPrintBill
    );

}
async function saveAndPrintBill(){

    const billData =
        await saveCurrentBill();

    if(!billData){

        return;

    }

    const result =
        await window.electronAPI.printBill(billData);

        if(result.success){

    alert(
        `Bill No.: ${billData.bill_no}\n\nPrinted Successfully.`
    );

}
else{

    alert(result.error);

}

}

async function saveCurrentBill(){

    saveBillBtn.disabled = true;
    printBillBtn.disabled = true;

    const now = new Date();

    const net =
        Number(
            document.getElementById("paymentNet")
            .innerText.replace("₹","")
        );

    const discount =
        Number(
            document.getElementById("discountAmount")
            .innerText.replace("₹","")
        );

    const gross =
        Number(
            document.getElementById("grossAmount")
            .innerText.replace("₹","")
        );

    const gst =
        Number(
            document.getElementById("gstAmount")
            .innerText.replace("₹","")
        );

    const totalQty =
        billItems.reduce(
            (sum,item)=>sum+item.qty,
            0
        );

        const mobile =
    document.getElementById("customerMobile").value.trim();

if (mobile !== "" && mobile.length !== 10) {

    alert("Mobile Number must be exactly 10 digits.");

    document.getElementById("customerMobile").focus();

    saveBillBtn.disabled = false;
    printBillBtn.disabled = false;

    return null;

}

    const billData = {

        bill_no:
            document.getElementById("currentBillNo").innerText,

        bill_date:
            now.toLocaleDateString("en-CA"),

        bill_time:
    now.toLocaleTimeString(
        "en-IN",
        {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: true
        }
    ).toUpperCase(),

        customer_name:
            document.getElementById("customerName").value,

        customer_mobile:
            document.getElementById("customerMobile").value,

        total_items:
            billItems.length,

        total_qty:
            totalQty,

        gross_amount:
    Math.round(gross),

discount_amount:
    Math.round(discount),

        taxable_amount:
            Math.round(net - gst),

        cgst_amount:
    Number((gst / 2).toFixed(2)),

sgst_amount:
    Number((gst / 2).toFixed(2)),

gst_amount:
    Number(gst.toFixed(2)),

        net_amount:
            Math.round(net),

        cash_amount:
            Number(
                document.getElementById("cashAmount").value
            ),

        upi_amount:
            Number(
                document.getElementById("upiAmount").value
            ),

        card_amount:
            Number(
                document.getElementById("cardAmount").value
            ),

        items:
    billItems.map(item => {

        const gross =
            item.qty * item.mrp;

        const discountAmount =
            gross * item.discount / 100;

        const net =
            gross - discountAmount;

        return {

            ...item,

            gross_amount: gross,

            discount_amount: discountAmount,

            net_amount: Math.round(net)

        };

    })

    };

    console.log(billData);

    const result =
        await window
            .electronAPI
            .saveBill(billData);

    if(result.success){

    alert("Bill Saved Successfully");

    billItems = [];

    familyFriendsDiscountActive = false;

    ffPinVerified = false;

    if (familyFriendsBtn) {
        familyFriendsBtn.classList.remove("active");
    }

    renderBill();

    document.getElementById("customerName").value = "";

    document.getElementById("customerMobile").value = "";

    paymentScreen.style.display = "none";

    dashboardScreen.style.display = "block";

    resetScrollPosition();

    await loadDashboardSummary();

    loadNextBillNumber();
    return billData;
}
else{

    saveBillBtn.disabled = false;
    printBillBtn.disabled = false;
    alert(result.error);

    return null;

}

}

/* =====================================
   BACK BUTTON
===================================== */

const backBtn =
    document.getElementById("backBtn");

if (backBtn) {

    backBtn.addEventListener("click", () => {

    if (billItems.length === 0){

    document.getElementById("customerName").value = "";

    document.getElementById("customerMobile").value = "";

    document.getElementById("barcodeInput").value = "";

    familyFriendsDiscountActive = false;

    ffPinVerified = false;

    if (familyFriendsBtn) {
        familyFriendsBtn.classList.remove("active");
    }

    loadNextBillNumber();

    newBillScreen.style.display = "none";

    dashboardScreen.style.display = "block";

    resetScrollPosition();

    loadDashboardSummary();

    return;

}

    const confirmDiscard = confirm(

        `Discard Current Bill?\n\n` +
        `This bill contains ${billItems.length} item(s).\n\n` +
        `All scanned items will be removed.`

    );

    if (!confirmDiscard){

        return;

    }

    clearCurrentBill();

    newBillScreen.style.display = "none";
    dashboardScreen.style.display = "block";
    resetScrollPosition();
    loadDashboardSummary();

});
}

/* =====================================
   IMPORT PRODUCTS
===================================== */
/*
const importProductsBtn =
    document.getElementById("importProductsBtn");

if (importProductsBtn) {

    importProductsBtn.addEventListener(
        "click",
        async () => {

            console.log(
                "Import Button Clicked"
            );

            const filePath =
                await window
                    .electronAPI
                    .selectExcelFile();

            if (!filePath) {
                return;
            }

const result =
    await window.electronAPI.importProducts(filePath);

if (result.success) {

    alert(
        `${result.count} Products Imported Successfully`
    );

} else {

    alert(result.error);

}

        }
    );

}

*/

/* =====================================
   GST CUSTOMER
===================================== */

const gstCustomer =
    document.getElementById("gstCustomer");

const gstFields =
    document.getElementById("gstFields");

if (gstCustomer && gstFields) {

    gstCustomer.addEventListener(
        "change",
        function () {

            gstFields.style.display =
                this.checked
                    ? "flex"
                    : "none";

        }
    );

}

/* =====================================
   BILL NUMBER
===================================== */

async function loadNextBillNumber() {

    try {

        const billNo =
            await window
                .electronAPI
                .getNextBillNumber();

        document.getElementById(
            "currentBillNo"
        ).innerText = billNo;

    }

    catch(err){

        console.error(err);

    }

}

/* =====================================
   PAYMENT BUTTON
===================================== */

const paymentBtn =
    document.getElementById("paymentBtn");

if (paymentBtn) {

paymentBtn.addEventListener("click", async () => {

    if (billItems.length === 0) {

        alert("Please select at least one product before proceeding.");

        return;

    }

const mobile =
    document.getElementById(
        "customerMobile"
    ).value.trim();

if (saleType === "RETURN") {

    if (!mobile) {

        alert(
            "Customer Mobile Number is mandatory for a return."
        );

        document.getElementById(
            "customerMobile"
        ).focus();

        return;

    }

    if (mobile.length !== 10) {

        alert(
            "Customer Mobile Number must be exactly 10 digits."
        );

        document.getElementById(
            "customerMobile"
        ).focus();

        return;

    }

} else if (
    mobile !== "" &&
    mobile.length !== 10
) {

    alert(
        "Mobile Number must be exactly 10 digits."
    );

    document.getElementById(
        "customerMobile"
    ).focus();

    return;

}

    /* =====================================
       RETURN → CREATE STORE CREDIT DIRECTLY
    ===================================== */

    if (saleType === "RETURN") {

        const originalBillNo =
            document.getElementById(
                "originalBillNo"
            ).value.trim();

        if (!originalBillNo) {

            alert(
                "Please load the original bill before processing the return."
            );

            return;

        }

        const activeReturnItems =
            billItems.filter(
                item => Number(item.qty || 0) > 0
            );

        if (activeReturnItems.length === 0) {

            alert(
                "Please enter a return quantity for at least one item."
            );

            return;

        }

        try {

            paymentBtn.disabled = true;

            const returnNo =
                await window.electronAPI
                    .getNextReturnNumber();

            const returnAmount =
                activeReturnItems.reduce(
                    (total, item) => {

                        const gross =
                            Number(item.qty || 0) *
                            Number(item.mrp || 0);

                        const discount =
                            Number(item.discount || 0);

                        return total +
                            (
                                gross -
                                (gross * discount / 100)
                            );

                    },
                    0
                );

            const result =
                await window.electronAPI.saveReturn({

                    return_no:
                        returnNo,

                    original_bill_no:
                        originalBillNo,

                    customer_name:
                        document.getElementById(
                            "customerName"
                        ).value.trim(),

                    customer_mobile:
                        mobile,

                    return_reason:
                        "Customer Return",

                    remarks:
                        "",

                    return_amount:
                        returnAmount,

                    items:
                        activeReturnItems.map(
                            item => {

                                const gross =
                                    Number(item.qty || 0) *
                                    Number(item.mrp || 0);

                                const discount =
                                    Number(item.discount || 0);

                                const returnValue =
                                    gross -
                                    (
                                        gross *
                                        discount /
                                        100
                                    );

                                return {

                                    product_id:
                                        item.product_id || null,

                                    barcode:
                                        item.barcode,

                                    product_name:
                                        item.product_name,

                                    original_bill_item_id:
                                        item.original_bill_item_id,

                                    quantity:
                                        Number(item.qty),

                                    unit_value:
                                        Number(item.mrp || 0),

                                    return_value:
                                        returnValue,

                                    remarks:
                                        ""

                                };

                            }
                        )

                });

            if (!result || !result.success) {

                throw new Error(
                    result?.error ||
                    "Unable to save return."
                );

            }

            alert(
                `Return processed successfully.\n\n` +
                `Store Credit: ${result.store_credit_no}\n` +
                `Valid Until: ${result.valid_until}`
            );

            /*
             * NEXT:
             * Print Store Credit Receipt here.
             * We will add this after the save flow
             * is confirmed working.
             */

            clearCurrentBill();

        }

        catch (error) {

            console.error(
                "Return processing error:",
                error
            );

            alert(
                error.message ||
                "Unable to process return."
            );

        }

        finally {

            paymentBtn.disabled = false;

        }

        return;

    }

    /* =====================================
       NORMAL SALE → PAYMENT SCREEN
    ===================================== */

    newBillScreen.style.display = "none";

    paymentScreen.style.display = "block";

    resetScrollPosition();

    document.getElementById("paymentBillNo").innerText =
        document.getElementById("currentBillNo").innerText;

    document.getElementById("cashAmount").value = 0;
    document.getElementById("upiAmount").value = 0;
    document.getElementById("cardAmount").value = 0;

    loadPaymentSummary();

    calculatePayment();

});

}
const paymentBackBtn =
    document.getElementById("paymentBackBtn");

if (paymentBackBtn) {

    paymentBackBtn.addEventListener("click", () => {

        paymentScreen.style.display = "none";

        newBillScreen.style.display = "block";

        resetScrollPosition();

    });

}

/* =====================================
   BILL HISTORY
===================================== */

const billHistoryBtn =
    document.getElementById("billHistoryBtn");

const historyBackBtn =
    document.getElementById("historyBackBtn");

if (historyBackBtn) {

    historyBackBtn.addEventListener(
        "click",
        () => {

            document.getElementById("billSearch").value = "";

renderBillHistory(allBills);

billHistoryScreen.style.display = "none";

dashboardScreen.style.display = "block";

resetScrollPosition();

loadDashboardSummary();
        }
    );

}

const viewBillBackBtn =
    document.getElementById("viewBillBackBtn");

if (viewBillBackBtn) {

    viewBillBackBtn.addEventListener("click", () => {

        document.getElementById("viewBillScreen").style.display = "none";

        billHistoryScreen.style.display = "block";

        resetScrollPosition();

    });

}

if (billHistoryBtn) {

    billHistoryBtn.addEventListener("click", async () => {

        if (!(await guardBusyOperation())) {

            return;

        }

        hideAllScreens();

        billHistoryScreen.style.display = "block";

        await loadBills();

    });

}

function openSettingsPage(title, html){

    settingsScreen.style.display = "none";

    settingsPage.style.display = "block";

    resetScrollPosition();

}

/* =====================================
   DATE & TIME
===================================== */

function updateDateTime() {

    const now = new Date();

    const currentDate =
        document.getElementById("currentDate");

    const currentTime =
        document.getElementById("currentTime");

    const billDate =
        document.getElementById("billDate");

    if (currentDate) {

        currentDate.innerText =
            now.toLocaleDateString(
                "en-IN",
                {
                    weekday: "short",
                    day: "2-digit",
                    month: "short",
                    year: "numeric"
                }
            );

    }

    if (currentTime) {

        currentTime.innerText =
    now.toLocaleTimeString(
        "en-IN",
        {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: true
        }
    ).toUpperCase();

    }

    if (billDate) {

        billDate.innerText =
            now.toLocaleDateString(
                "en-IN",
                {
                    day: "2-digit",
                    month: "short",
                    year: "numeric"
                }
            );

    }

}

updateDateTime();

setInterval(updateDateTime, 1000);

function formatTime(time){

    return new Date(
        "2000-01-01 " + time
    ).toLocaleTimeString(
        "en-IN",
        {
            hour: "2-digit",
            minute: "2-digit",
            hour12: true
        }
    ).toUpperCase();

}

/* =====================================
   BILL ITEMS
===================================== */

let billItems = [];
let allBills = [];
let currentViewedBill = null;

let ffPinVerified = false;

let productNotFoundOpen = false;

let saleType = "SALE";
let familyFriendsDiscountActive = false;

const barcodeInput =
    document.getElementById(
        "barcodeInput"
    );

const customerName =
    document.getElementById("customerName");

const customerMobile =
    document.getElementById("customerMobile");

const saleReturnType =
    document.getElementById("saleTypeDropdown");

const familyFriendsBtn =
    document.getElementById("familyFriendsBtn");

function applyBillingMode(mode) {

    saleType = mode;

    if (saleReturnType) {

        saleReturnType.value = mode;

    }

    const newBillScreen =
        document.getElementById(
            "newBillScreen"
        );

    if (newBillScreen) {

        newBillScreen.classList.toggle(
            "return-mode",
            mode === "RETURN"
        );

    }


    const returnLookupPanel =
        document.getElementById(
            "returnLookupPanel"
        );

    if (returnLookupPanel) {

        returnLookupPanel.style.display =
            mode === "RETURN"
                ? "block"
                : "none";

    }


    const billingPageTitle =
        document.querySelector(
            ".billing-page-title"
        );

    if (billingPageTitle) {

        billingPageTitle.innerText =
            mode === "RETURN"
                ? "RETURN / EXCHANGE"
                : "NEW BILL";

    }


    const originalBillNo =
        document.getElementById(
            "originalBillNo"
        );

    if (
        mode === "RETURN" &&
        originalBillNo
    ) {

        setTimeout(() => {

            originalBillNo.focus();

        }, 100);

    }

}

if (saleReturnType) {

    saleReturnType.addEventListener(
        "change",
        () => {

            const requestedMode =
                saleReturnType.value;

            if (requestedMode === saleType) {

                return;

            }

            if (billItems.length > 0) {

                const confirmed =
                    window.confirm(
                        `Switching to ${requestedMode} mode will discard the current bill items.\n\nContinue?`
                    );

                if (!confirmed) {

                    saleReturnType.value =
                        saleType;

                    return;

                }

                billItems = [];

            }

            // Clear customer details
            document.getElementById("customerName").value = "";
            document.getElementById("customerMobile").value = "";

            // Clear return lookup details
            const originalBillNo =
                document.getElementById("originalBillNo");

            const returnBillStatus =
                document.getElementById("returnBillStatus");

            if (originalBillNo) {
                originalBillNo.value = "";
            }

            if (returnBillStatus) {
                returnBillStatus.innerText = "";
            }

            applyBillingMode(
                requestedMode
            );

            renderBill();

        }
    );

}

/* =====================================
   RETURN BILL LOOKUP
===================================== */

const originalBillNo =
    document.getElementById("originalBillNo");

const loadReturnBillBtn =
    document.getElementById("loadReturnBillBtn");

const returnBillStatus =
    document.getElementById("returnBillStatus");


if (loadReturnBillBtn) {

    loadReturnBillBtn.addEventListener(
        "click",
        async () => {

            const billNo =
                originalBillNo.value.trim().toUpperCase();

            if (!billNo) {

                returnBillStatus.innerText =
                    "Enter the original bill number.";

                return;

            }


            loadReturnBillBtn.disabled = true;

            returnBillStatus.innerText =
                "Loading bill...";


            try {

                const result =
                    await window.electronAPI.getBillForReturn(
                        billNo
                    );


                if (!result || !result.bill) {

                    returnBillStatus.innerText =
                        "Original bill not found.";

                    return;

                }


                console.log(
                    "RETURN BILL LOADED:",
                    result
                );

                document.getElementById(
                    "customerName"
                ).value =
                    result.bill.customer_name || "";

                document.getElementById(
                    "customerMobile"
                ).value =
                    result.bill.customer_mobile || "";

                billItems = result.items
                    .map((item) => {

                        const remainingQty =
                            Number(item.qty || 0) -
                            Number(
                                item.already_returned_qty || 0
                            );

                        if (remainingQty <= 0) {
                            return null;
                        }

return {
    ...item,

    original_qty:
        Number(item.qty || 0),

    already_returned_qty:
        Number(
            item.already_returned_qty || 0
        ),

    available_qty:
        remainingQty,

    qty: 0,

    mrp:
        Number(item.mrp || 0),

    discount:
        Number(
            item.discount_percent || 0
        ),

    discount_percent:
        Number(
            item.discount_percent || 0
        ),

    discount_amount:
        Number(
            item.discount_amount || 0
        ),

    original_bill_item_id:
        item.id
};

                    })
                    .filter((item) => item !== null);

                renderBill();

                returnBillStatus.innerText =
                    `Bill ${result.bill.bill_no} loaded successfully. ${billItems.length} item(s) available for return.`;

            }

            catch (error) {

                console.error(
                    "RETURN BILL LOOKUP ERROR:",
                    error
                );

                returnBillStatus.innerText =
                    "Unable to load the original bill.";

            }

            finally {

                loadReturnBillBtn.disabled = false;

            }

        }
    );

}

if (originalBillNo) {

    originalBillNo.addEventListener(
        "keydown",
        (event) => {

            if (event.key === "Enter") {

                event.preventDefault();

                if (loadReturnBillBtn) {

                    loadReturnBillBtn.click();

                }

            }

        }
    );

}

const ffPinDialog =
    document.getElementById("ffPinDialog");

const ffPinInput =
    document.getElementById("ffPinInput");

const ffPinError =
    document.getElementById("ffPinError");

const ffPinCancelBtn =
    document.getElementById("ffPinCancelBtn");

const ffPinVerifyBtn =
    document.getElementById("ffPinVerifyBtn");


if (familyFriendsBtn) {

    familyFriendsBtn.addEventListener(
        "click",
        async () => {

            /*
             * If F&F is already active for this bill,
             * switch it OFF and restore original discounts.
             */
            if (familyFriendsDiscountActive) {

                familyFriendsDiscountActive = false;

                ffPinVerified = false;

                familyFriendsBtn.classList.remove(
                    "active"
                );

                removeFamilyFriendsDiscount();

                return;

            }


            /*
             * Do not allow F&F without scanned products.
             */
            if (!billItems.length) {

                alert(
                    "Please add at least one product before applying Family & Friends Discount."
                );

                return;

            }


            /*
             * Open PIN authorization popup.
             */
            ffPinInput.value = "";

            ffPinError.innerText = "";

            ffPinDialog.style.display = "flex";

            setTimeout(() => {

                ffPinInput.focus();

            }, 50);

        }
    );

}


/* CANCEL PIN ENTRY */

if (ffPinCancelBtn) {

    ffPinCancelBtn.addEventListener(
        "click",
        () => {

            ffPinInput.value = "";

            ffPinError.innerText = "";

            ffPinDialog.style.display = "none";

        }
    );

}


/* VERIFY F&F PIN */

async function verifyFamilyFriendsPin() {

    const enteredPin =
        ffPinInput.value.trim();


    if (!/^\d{4}$/.test(enteredPin)) {

        ffPinError.innerText =
            "Please enter a valid 4-digit PIN.";

        return;

    }


    try {

        const settings =
            await window.electronAPI.getSettings();


        if (
            !settings ||
            enteredPin !== String(settings.ff_pin || "")
        ) {

            ffPinError.innerText =
                "Incorrect PIN.";

            ffPinInput.value = "";

            ffPinInput.focus();

            return;

        }


/*
 * PIN verified.
 * Never log or store the entered PIN.
 */
ffPinVerified = true;

ffPinInput.value = "";

ffPinError.innerText = "";

ffPinDialog.style.display = "none";


/*
 * Open the brand-wise F&F discount popup.
 */
openFamilyFriendsDiscountDialog();


    }

    catch (error) {

        console.error(
            "F&F PIN verification error:",
            error
        );

        ffPinError.innerText =
            "Unable to verify PIN.";

    }

}


if (ffPinVerifyBtn) {

    ffPinVerifyBtn.addEventListener(
        "click",
        verifyFamilyFriendsPin
    );

}


/* ALLOW ENTER KEY TO VERIFY */

if (ffPinInput) {

    ffPinInput.addEventListener(
        "keydown",
        (event) => {

            if (event.key === "Enter") {

                verifyFamilyFriendsPin();

            }

        }
    );

}

const ffDiscountDialog =
    document.getElementById("ffDiscountDialog");

const ffDiscountError =
    document.getElementById("ffDiscountError");

const ffDiscountCancelBtn =
    document.getElementById("ffDiscountCancelBtn");

const ffDiscountApplyBtn =
    document.getElementById("ffDiscountApplyBtn");

const ffDiscountTableBody =
    document.getElementById(
        "ffDiscountTableBody"
    );

function escapeHtml(value) {

    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

}

function openFamilyFriendsDiscountDialog() {

    if (!ffDiscountTableBody) {
        return;
    }


    /*
     * Clear previous popup rows.
     */
    ffDiscountTableBody.innerHTML = "";


    /*
     * Add every currently billed item.
     */
    billItems.forEach((item, index) => {

        const productName =
            String(
                item.product_name || ""
            );

        const size =
            String(
                item.size || "-"
            );

        const brand =
            String(
                item.brand || "Other"
            );

        const qty =
            Number(
                item.qty || 0
            );

        const mrp =
            Number(
                item.mrp || 0
            );

        const currentDiscount =
            Number(
                item.master_discount || 0
            );

        const currentFinalDiscount =
            Number(
                item.discount || 0
            );

        const netAmount =
            (
                mrp *
                qty *
                (
                    1 -
                    currentFinalDiscount / 100
                )
            );


        const row =
            document.createElement("tr");


row.innerHTML = `

    <td>
        ${escapeHtml(productName)}
    </td>

    <td>
        ${escapeHtml(size)}
    </td>

    <td>
        ${escapeHtml(brand)}
    </td>

    <td class="ff-center-cell">
        ${qty}
    </td>

    <td class="ff-money-cell">
        ₹${mrp.toFixed(2)}
    </td>

    <td class="ff-center-cell">
        ${currentDiscount}%
    </td>

    <td class="ff-discount-input-cell">

        <input
            type="number"
            class="ff-final-discount-input"
            data-index="${index}"
            min="0"
            max="30"
            step="1"
            value="${currentFinalDiscount}"
        >

        <span class="ff-percent-symbol">
            %
        </span>

    </td>

    <td
        class="ff-money-cell ff-net-preview"
        data-net-index="${index}"
    >
        ₹${netAmount.toFixed(2)}
    </td>

`;


        ffDiscountTableBody.appendChild(
            row
        );

        const discountInput =
    row.querySelector(
        ".ff-final-discount-input"
    );


const netPreview =
    row.querySelector(
        ".ff-net-preview"
    );


if (
    discountInput &&
    netPreview
) {

    discountInput.addEventListener(
        "input",
        function () {

            let finalDiscount =
                Number(
                    this.value
                );


            /*
             * Prevent invalid values
             * from affecting preview.
             */
            if (
                !Number.isFinite(
                    finalDiscount
                )
            ) {

                finalDiscount = 0;

            }


            /*
             * Keep preview calculation
             * within allowed F&F range.
             */
            finalDiscount =
                Math.max(
                    0,
                    Math.min(
                        30,
                        finalDiscount
                    )
                );


            /*
             * Calculate item Net using
             * F&F Final Discount.
             */
            const updatedNet =
                mrp *
                qty *
                (
                    1 -
                    finalDiscount / 100
                );


            netPreview.textContent =
                `₹${updatedNet.toFixed(2)}`;

        }
    );

}

    });


    /*
     * Clear previous error.
     */
    ffDiscountError.innerText = "";


    /*
     * Open dialog.
     */
    ffDiscountDialog.style.display =
        "flex";


    /*
     * Focus first discount field.
     */
    setTimeout(() => {

        const firstInput =
            document.querySelector(
                ".ff-final-discount-input"
            );

        if (firstInput) {

            firstInput.focus();

            firstInput.select();

        }

    }, 100);

}

if (ffDiscountCancelBtn) {

    ffDiscountCancelBtn.addEventListener(
        "click",
        () => {

            /*
             * Cancel means no changes.
             */
            ffDiscountDialog.style.display =
                "none";


            ffPinVerified = false;

            ffDiscountError.innerText = "";

        }
    );

}




function applyFamilyFriendsDiscountsFromDialog() {

    const inputs =
        document.querySelectorAll(
            ".ff-final-discount-input"
        );


    /*
     * Validate all discounts first.
     */
    for (const input of inputs) {

        const finalDiscount =
            Number(
                input.value
            );


        if (
            !Number.isFinite(
                finalDiscount
            ) ||
            finalDiscount < 0 ||
            finalDiscount > 30
        ) {

            ffDiscountError.innerText =
                "F&F Final Discount must be between 0% and 30%.";

            input.focus();

            return;
        }

    }


    /*
     * Apply item-wise FINAL discount.
     *
     * IMPORTANT:
     * F&F discount overrides the Product Master
     * discount.
     *
     * It NEVER stacks with it.
     */
    inputs.forEach(input => {

        const index =
            Number(
                input.dataset.index
            );


        const finalDiscount =
            Number(
                input.value
            );


        if (!billItems[index]) {
            return;
        }


        billItems[index].ff_discount =
            finalDiscount;


        billItems[index].discount =
            finalDiscount;

    });


    /*
     * Mark F&F active.
     */
    familyFriendsDiscountActive =
        true;


    ffPinVerified =
        true;


    /*
     * Update button state.
     */
    if (familyFriendsBtn) {

        familyFriendsBtn.classList.add(
            "active"
        );

    }


    /*
     * Close popup.
     */
    ffDiscountError.innerText =
        "";


    ffDiscountDialog.style.display =
        "none";


    /*
     * Refresh billing calculations.
     */
    renderBill();

    loadPaymentSummary();

    calculatePayment();

}

/* APPLY F&F DISCOUNTS */

if (ffDiscountApplyBtn) {

    ffDiscountApplyBtn.addEventListener(
        "click",
        applyFamilyFriendsDiscountsFromDialog
    );

}


function removeFamilyFriendsDiscount() {

    billItems.forEach(item => {

        item.ff_discount = null;

        item.discount =
            Number(item.master_discount || 0);

    });

    renderBill();

    loadPaymentSummary();

    calculatePayment();

}

if (customerName) {

    customerName.addEventListener("input", function () {

        this.value = this.value
            .replace(/[^A-Za-z.' ]/g, "")
            .replace(/\s+/g, " ")
            .replace(/^\s/, "");

    });

}

if (customerMobile) {

    customerMobile.addEventListener("input", function () {

        this.value = this.value
            .replace(/\D/g, "")
            .slice(0, 10);

    });

}

barcodeInput.addEventListener("input", () => {

    barcodeInput.value =
        barcodeInput.value.replace(/\D/g, "");

});
if (barcodeInput) {

    barcodeInput.addEventListener(
        "keypress",
        async (event) => {

            if (event.key !== "Enter") {
                return;
            }

            if (productNotFoundOpen) {
                return;
            }

            const barcode =
                barcodeInput.value.trim();

            if (!barcode) {
                return;
            }

            const product =
                await window
                    .electronAPI
                    .getProduct(barcode);


if (!product) {

    barcodeInput.value = "";

    showProductNotFoundDialog(
        barcode
    );

    return;

}


addProductToBill(product);

barcodeInput.value = "";

requestAnimationFrame(() => {

    barcodeInput.focus();

    barcodeInput.select();

});

}
);

}
function addProductToBill(product) {

    const availableStock =
        Number(
            product.current_stock ??
            product.opening_stock ??
            0
        );

    const existingItem =
        billItems.find(
            item =>
                item.barcode === product.barcode
        );

    const currentBillQty =
        existingItem
            ? Number(existingItem.qty)
            : 0;

if (currentBillQty >= availableStock) {

    showInsufficientStockDialog(
        product.product_name,
        availableStock,
        currentBillQty
    );

    return false;

}

    if (existingItem) {

        existingItem.qty++;

    }

    else {

        billItems.push({

            barcode: product.barcode,

            brand: product.brand,

            category: product.category,

            product_name: product.product_name,

            size: product.size,

            colour: product.colour,

mrp: Number(product.mrp),

qty: 1,

master_discount:
    Number(product.discount || 0),

ff_discount: null,

discount:
    Number(product.discount || 0),

gst_rate: Number(product.gst_rate)

        });

    }

    renderBill();

    loadPaymentSummary();

    document.getElementById("cashAmount").value = 0;
    document.getElementById("upiAmount").value = 0;
    document.getElementById("cardAmount").value = 0;

    calculatePayment();

    return true;
}

function renderBill(){

    const tbody =
        document.getElementById("billTableBody");

    tbody.innerHTML = "";

    const tableHead =
    document.getElementById("billTableHead");

if (tableHead) {

    if (saleType === "RETURN") {

        tableHead.innerHTML = `
            <tr>
                <th>Barcode</th>
                <th>Product</th>
                <th>Size</th>
                <th>Brand</th>
                <th>Original Qty</th>
<!--
<th>Already Returned</th>
<th>Available Qty</th>
-->
                <th>Return Qty</th>
                <th>MRP</th>
                <th>Disc%</th>
                <th>Return Amount</th>
            </tr>
        `;

    } else {

        tableHead.innerHTML = `
            <tr>
                <th>Barcode</th>
                <th>Product</th>
                <th>Size</th>
                <th>Brand</th>
                <th>Qty</th>
                <th>MRP</th>
                <th>Disc%</th>
                <th>Net</th>
                <th>🗑️</th>
            </tr>
        `;

    }

}

    billItems.forEach((item,index)=>{

        const row =
            document.createElement("tr");

        const gross =
    item.qty * item.mrp;

const net =
    gross -
    (gross * item.discount / 100);

if (saleType === "RETURN") {

    row.innerHTML = `

<td>${item.barcode}</td>

<td>${item.product_name}</td>

<td>${item.size}</td>

<td>${item.brand}</td>

<td>${Number(item.original_qty || 0)}</td>

<!--
<td>${Number(item.already_returned_qty || 0)}</td>

<td>${Number(item.available_qty || 0)}</td>
-->

<td>

<input
    type="number"
    min="0"
    max="${Number(item.available_qty || 0)}"
    value="${item.qty}"
    class="qty-input"
    onchange="updateQuantity(${index}, this.value)"
>

</td>

<td>₹${Number(item.mrp || 0).toFixed(2)}</td>

<td>${Number(item.discount || 0)}%</td>

<td>₹${Math.round(net)}</td>

`;

} else {

    row.innerHTML = `

<td>${item.barcode}</td>

<td>${item.product_name}</td>

<td>${item.size}</td>

<td>${item.brand}</td>

<td>${item.qty}</td>

<td>₹${item.mrp.toFixed(2)}</td>

<td>

<input
type="number"
min="0"
max="${Number(item.discount) > 0 ? Number(item.discount) : 10}"
value="${item.discount}"
class="discount-input"
${Number(item.discount) > 0 ? "disabled" : ""}
onchange="updateDiscount(${index}, this.value)"
>

</td>

<td>₹${Math.round(net)}</td>

<td>

<button
class="delete-btn"
onclick="removeItem(${index})">

🗑️

</button>

</td>

`;

}

        tbody.appendChild(row);

    });

    updateSummary();

}

function clearCurrentBill(){

    billItems = [];

    applyBillingMode("SALE");

    renderBill();

    document.getElementById("customerName").value = "";

    document.getElementById("customerMobile").value = "";

    document.getElementById("barcodeInput").value = "";
familyFriendsDiscountActive = false;

const originalBillNo =
    document.getElementById(
        "originalBillNo"
    );

if (originalBillNo) {

    originalBillNo.value = "";

}


const returnBillStatus =
    document.getElementById(
        "returnBillStatus"
    );

if (returnBillStatus) {

    returnBillStatus.innerText = "";

}

const familyFriendsBtn =
    document.getElementById("familyFriendsBtn");

if (familyFriendsBtn) {

    familyFriendsBtn.classList.remove("active");

}

    loadPaymentSummary();

    calculatePayment();

    loadNextBillNumber();


}

function removeItem(index){

    billItems.splice(index,1);

    renderBill();
    loadPaymentSummary();calculatePayment();

}

function updateDiscount(index, value){

    const existingDiscount =
        Number(billItems[index].discount || 0);

    if(existingDiscount > 0){

        alert(
            `Maximum Discount Already Applied: ${existingDiscount}%`
        );

        renderBill();

        return;

    }

    let discount =
        Number(value);

    if(discount < 0){

        discount = 0;

    }

    if(discount > 10){

        alert(
            "Maximum Discount Allowed is 10%"
        );

        discount = 10;

    }

    billItems[index].discount =
        discount;

    renderBill();
    loadPaymentSummary();calculatePayment();

}

window.updateDiscount = updateDiscount;
window.updateQuantity = updateQuantity;
window.removeItem = removeItem;

function updateQuantity(index, value){

    if (saleType !== "RETURN") {

        return;

    }

    const item =
        billItems[index];

    if (!item) {

        return;

    }

const maxQty =
    Math.max(
        0,
        Number(item.available_qty || 0)
    );

    let qty =
        Number(value);

    if (!Number.isFinite(qty)) {

        qty = 0;

    }

    qty =
        Math.floor(qty);

    if (qty < 0) {

        qty = 0;

    }

    if (qty > maxQty) {

        qty = maxQty;

    }

    item.qty = qty;

    renderBill();

    loadPaymentSummary();

    calculatePayment();

}

function updateSummary(){

    let totalQty = 0;
    let gross = 0;
    let discount = 0;
    let gst = 0;

    billItems.forEach(item => {

        const qty =
            Number(item.qty || 0);

        const mrp =
            Number(item.mrp || 0);

        const discountPercent =
            Number(item.discount || 0);

        const gstRate =
            Number(item.gst_rate || 0);

        totalQty += qty;

        const lineGross =
            qty * mrp;

        const lineDiscount =
            lineGross *
            discountPercent / 100;

        const net =
            lineGross - lineDiscount;

        const taxable =
            gstRate > 0
                ? net * 100 /
                  (100 + gstRate)
                : net;

        gross += lineGross;
        discount += lineDiscount;
        gst += net - taxable;

    });

    const activeItems =
        billItems.filter(
            item => Number(item.qty || 0) > 0
        );

    document.getElementById("itemCount").innerText =
        activeItems.length;

    document.getElementById("itemQty").innerText =
        totalQty;

    document.getElementById("grossAmount").innerText =
        "₹" + gross.toFixed(2);

    document.getElementById("discountAmount").innerText =
        "₹" + discount.toFixed(2);

    document.getElementById("gstAmount").innerText =
        "₹" + gst.toFixed(2);

    document.getElementById("netAmount").innerText =
        "₹" + (gross - discount).toFixed(2);

    const payableLabel =
        document.querySelector(".payable-label");

    if (payableLabel) {

        payableLabel.innerText =
            saleType === "RETURN"
                ? "STORE CREDIT TO ISSUE"
                : "AMOUNT PAYABLE";

    }

}


function loadPaymentSummary(){

    const gross =
        Number(
            document.getElementById("grossAmount")
            .innerText.replace("₹","")
        );

    const discount =
        Number(
            document.getElementById("discountAmount")
            .innerText.replace("₹","")
        );

    const gst =
        Number(
            document.getElementById("gstAmount")
            .innerText.replace("₹","")
        );

    const net =
        Number(
            document.getElementById("netAmount")
            .innerText.replace("₹","")
        );
    let totalQty = 0;

        billItems.forEach(item=>{

    totalQty += item.qty;

});

document.getElementById("paymentItems").innerText =
    billItems.length;

document.getElementById("paymentQty").innerText =
    totalQty;

    document.getElementById("paymentGross").innerText =
        "₹" + gross.toFixed(2);

    document.getElementById("paymentDiscount").innerText =
        "₹" + discount.toFixed(2);

    document.getElementById("paymentGST").innerText =
        "₹" + gst.toFixed(2);

    document.getElementById("paymentNet").innerText =
        "₹" + Math.round(net)

}
function calculatePayment(){

const cash =
parseFloat(
document.getElementById("cashAmount").value
) || 0;

const upi =
parseFloat(
document.getElementById("upiAmount").value
) || 0;

const card =
parseFloat(
document.getElementById("cardAmount").value
) || 0;
    const total =
        cash + upi + card;

  const payable =
Math.round(
Number(
document.getElementById("paymentNet")
.innerText.replace("₹","")
)
);
   

const label =
    document.getElementById("balanceLabel");

    document.getElementById("totalReceived").innerText =
        "₹" + total.toFixed(2);

    const balance =
    total - payable;

document.getElementById("balanceAmount").innerText =
    "₹" + Math.abs(balance).toFixed(2);

if(balance < -0.01){

    label.innerText =
        "Balance Due";


}
else if(balance > 0.01){

    label.innerText =
        "Change";
}

else{

    label.innerText =
        "Change";



}

    const difference =
    Math.abs(total - payable);

const enable =
    difference <= 0.01;

document.getElementById("saveBillBtn").disabled =
    !enable;

document.getElementById("printBillBtn").disabled =
    !enable;

}

function renderBillHistory(bills){

    const tbody =
        document.getElementById("historyTableBody");

    tbody.innerHTML = "";

    bills.forEach(bill => {

        const row =
            document.createElement("tr");

        row.innerHTML = `

<td>${bill.bill_no}</td>

<td>${
new Date(bill.bill_date)
.toLocaleDateString("en-GB")
.replace(/\//g,"-")
} ${formatTime(bill.bill_time)}</td>

<td>${bill.customer_name || "-"}</td>

<td>${bill.customer_mobile || "-"}</td>

<td>₹${Math.round(bill.net_amount)}</td>

<td>

<span class="status-paid">

${bill.payment_status}

</span>

${
    bill.payment_corrected
        ? `
        <br>
        <span class="status-corrected">
            🟠 Payment Corrected
        </span>
        `
        : ""
}

</td>

<td>
<button
class="view-btn"
onclick="viewBill('${bill.bill_no}')">
👁 View
</button>
</td>

<td>
<button
class="print-btn"
onclick="reprintBill('${bill.bill_no}')">
🖨 Reprint
</button>
</td>

`;

        tbody.appendChild(row);

    });

}

async function loadBills(){

    try{

        allBills =
            await window.electronAPI.getBills();

        renderBillHistory(allBills);

    }

    catch(error){

        console.error(error);

        alert("Unable to load bills.");

    }

}
async function viewBill(billNo){



    console.log("VIEW FUNCTION");

    const details =
        await window.electronAPI.getBillDetails(billNo);

        const corrections =
    await window.electronAPI.getPaymentCorrections(
        billNo
    );

        console.log(corrections);

        console.log(details);

        currentViewedBill = {

    ...details.bill,

    items: details.items

};

        
    // Hide Bill History
    billHistoryScreen.style.display = "none";

    // Show View Bill Screen
    document.getElementById("viewBillScreen").style.display = "block";

    resetScrollPosition();

    // Bill Details
    document.getElementById("viewBillNo").innerText =
        details.bill.bill_no;

    document.getElementById("viewBillDate").innerText =
    new Date(details.bill.bill_date)
        .toLocaleDateString("en-GB")
        .replace(/\//g,"-");

    document.getElementById("viewBillTime").innerText =
        formatTime(details.bill.bill_time);

    document.getElementById("viewCustomer").innerText =
        details.bill.customer_name || "-";

    document.getElementById("viewMobile").innerText =
        details.bill.customer_mobile || "-";

    document.getElementById("viewGross").innerText =
        Number(details.bill.gross_amount).toFixed(2);

    document.getElementById("viewDiscount").innerText =
        Number(details.bill.discount_amount).toFixed(2);

    
    document.getElementById("viewNet").innerText =
Math.round(details.bill.net_amount);
    document.getElementById("viewItems").innerText =
        details.bill.total_items;

    document.getElementById("viewQty").innerText =
        details.bill.total_qty;

    document.getElementById("viewTaxable").innerText =
        Number(details.bill.taxable_amount).toFixed(2);
    
    document.getElementById("viewCash").innerText =
        Number(details.bill.cash_amount).toFixed(2);

    document.getElementById("viewUPI").innerText =
        Number(details.bill.upi_amount).toFixed(2);

    document.getElementById("viewCard").innerText =
        Number(details.bill.card_amount).toFixed(2);

        document.getElementById("viewTaxableGST").innerText =
    Number(details.bill.taxable_amount).toFixed(2);

document.getElementById("viewCGST").innerText =
    Number(details.bill.cgst_amount).toFixed(2);

document.getElementById("viewSGST").innerText =
    Number(details.bill.sgst_amount).toFixed(2);

document.getElementById("viewTotalGST").innerText =
    Number(details.bill.gst_amount).toFixed(2);
    
    const tbody =
        document.getElementById("viewBillItems");

    tbody.innerHTML = "";

details.items.forEach(item => {

    const row =
        document.createElement("tr");


    row.innerHTML = `

    <td>${item.barcode}</td>

    <td>${item.brand}</td>

    <td>${item.product_name}</td>

    <td>${item.size}</td>

    <td>${item.qty}</td>

    <td>₹${Math.round(item.mrp)}</td>

    <td>₹${Math.round(item.net_amount)}</td>
`;

    tbody.appendChild(row);

});

const historySection =
    document.getElementById(
        "paymentCorrectionHistory"
    );

const historyList =
    document.getElementById(
        "paymentCorrectionList"
    );

historyList.innerHTML = "";

if (corrections.length === 0) {

    historySection.style.display = "none";

}
else {

    historySection.style.display = "block";

    corrections.forEach((correction, index) => {

});
        
corrections.forEach((correction, index) => {

    let html = `

<div class="payment-history-card">

    <div class="payment-history-title">

        🟠 PAYMENT CORRECTION #${corrections.length - index}

    </div>

`;

    if (
        Number(correction.old_cash) !==
        Number(correction.new_cash)
    ) {

        html += `

<div>

<b>Cash</b>

₹${Number(correction.old_cash).toFixed(2)}

→

₹${Number(correction.new_cash).toFixed(2)}

</div>

`;

    }

    if (
        Number(correction.old_upi) !==
        Number(correction.new_upi)
    ) {

        html += `

<div>

<b>UPI</b>

₹${Number(correction.old_upi).toFixed(2)}

→

₹${Number(correction.new_upi).toFixed(2)}

</div>

`;

    }

    if (
        Number(correction.old_card) !==
        Number(correction.new_card)
    ) {

        html += `

<div>

<b>Card</b>

₹${Number(correction.old_card).toFixed(2)}

→

₹${Number(correction.new_card).toFixed(2)}

</div>

`;

    }

    html += `

<div>

<b>Reason</b>

${correction.remarks}

</div>

<div>

<b>Updated By</b>

${correction.corrected_by}

</div>

<div>

<b>Correction Date</b>

${new Date(correction.corrected_at)
    .toLocaleDateString(
        "en-GB",
        {
            day: "2-digit",
            month: "short",
            year: "numeric"
        }
    )}

•

${new Date(correction.corrected_at)
    .toLocaleTimeString(
        "en-IN",
        {
            hour: "2-digit",
            minute: "2-digit",
            hour12: true
        }
    ).toUpperCase()}

</div>

</div>

`;

    historyList.innerHTML += html;

});

}

}

window.viewBill = viewBill;

async function reprintBill(billNo){

    const details =
        await window.electronAPI.getBillDetails(billNo);

    if(!details){

        alert("Unable to load bill.");

        return;

    }

    const billData = {

        ...details.bill,

        items: details.items

    };

    console.log("REPRINT DATA");
    console.log(billData);

    const result =
        await window.electronAPI.printBill(billData);

        if(result.success){

    alert(
        `Bill No.: ${billData.bill_no}\n\nPrinted Successfully.`
    );

}
else{

    alert(result.error);

}

}

const billSearch =
    document.getElementById("billSearch");

if (billSearch){

    billSearch.addEventListener("input", () => {

        const text =
            billSearch.value
            .toLowerCase()
            .trim();

        const filtered =
            allBills.filter(bill =>

                bill.bill_no
                    .toLowerCase()
                    .includes(text)

                ||

                String(
                    bill.customer_mobile || ""
                ).includes(text)

            );

        renderBillHistory(filtered);

    });

}

window.reprintBill = reprintBill;

const pdfInvoiceBtn =
    document.getElementById("pdfInvoiceBtn");

if (pdfInvoiceBtn) {

    pdfInvoiceBtn.disabled = false;

    pdfInvoiceBtn.addEventListener(
        "click",
        async () => {

            if (!currentViewedBill){

                return;

            }

            const result =
                await window.electronAPI.saveBillPdf(
                    currentViewedBill
                );

            if(result.success){

                alert(

                    `Bill No.: ${currentViewedBill.bill_no}\n\nPDF Saved Successfully.`

                );

            }

            else if(result !== false){

                alert(result.error);

            }

        }

    );

}

const printInvoiceBtn =
    document.getElementById("printInvoiceBtn");

if (printInvoiceBtn) {

    printInvoiceBtn.addEventListener(
        "click",
        async () => {

            if (!currentViewedBill){

                return;

            }

            const result =
                await window.electronAPI.printBill(
                    currentViewedBill
                );

            if(result.success){

                alert(

                    `Bill No.: ${currentViewedBill.bill_no}\n\nPrinted Successfully.`

                );

            }

            else{

                alert(result.error);

            }

        }

    );

}

document.addEventListener("keydown", (event) => {

    if (event.code !== "F6")
        return;

    if (f6Timer)
        return;

    f6Timer = setTimeout(() => {

    systemStatusCard.style.display = "none";
    paymentSummaryCard.style.display = "block";

    storeOverviewCard.style.display = "none";
    businessOverviewCard.style.display = "block";

    f6Timer = null;

}, 2000);

});

document.addEventListener("keyup", (event) => {

    if (event.code !== "F6")
        return;

    if (f6Timer) {

        clearTimeout(f6Timer);
        f6Timer = null;

    systemStatusCard.style.display = "block";
paymentSummaryCard.style.display = "none";

storeOverviewCard.style.display = "block";
businessOverviewCard.style.display = "none";

    }

});

const correctPaymentBtn =
    document.getElementById("correctPaymentBtn");

const paymentCorrectionModal =
    document.getElementById("paymentCorrectionModal");

const paymentBillNo =
    document.getElementById("correctionBillNo");

const paymentCash =
    document.getElementById("paymentCash");

const paymentUpi =
    document.getElementById("paymentUpi");

const paymentCard =
    document.getElementById("paymentCard");

const paymentRemarks =
    document.getElementById("paymentRemarks");

const paymentTotal =
    document.getElementById("paymentTotal");

const savePaymentCorrectionBtn =
    document.getElementById("savePaymentCorrectionBtn");

const cancelPaymentCorrectionBtn =
    document.getElementById("cancelPaymentCorrectionBtn");

    console.log({
    paymentCorrectionModal,
    paymentBillNo,
    paymentCash,
    paymentUpi,
    paymentCard,
    paymentRemarks,
    paymentTotal,
    savePaymentCorrectionBtn,
    cancelPaymentCorrectionBtn
});

correctPaymentBtn.onclick = () => {

    if (!currentViewedBill){

        return;

    }

    requireAdminAuthorization(() => {

        console.log("Modal:", paymentCorrectionModal);
        console.log("Bill No:", paymentBillNo);
        console.log("Cash:", paymentCash);
        console.log("UPI:", paymentUpi);
        console.log("Card:", paymentCard);
        console.log("Remarks:", paymentRemarks);
        console.log("Total:", paymentTotal);

        paymentBillNo.textContent =
            currentViewedBill.bill_no;

        paymentCash.value =
            currentViewedBill.cash_amount;

        paymentUpi.value =
            currentViewedBill.upi_amount;

        paymentCard.value =
            currentViewedBill.card_amount;

        paymentRemarks.value = "";

        paymentCorrectionModal.style.display =
            "flex";

        calculatePaymentTotal();

    });

};

function calculatePaymentTotal(){

const total =

        Number(paymentCash.value || 0)

        +

        Number(paymentUpi.value || 0)

        +

        Number(paymentCard.value || 0);

    if(!paymentTotal){

    return;

}

paymentTotal.textContent =

        "Total : ₹" +

        total.toFixed(2);

    if(

        Math.abs(

            total -

            currentViewedBill.net_amount

        ) > 0.01

    ){

        paymentTotal.style.color = "red";

        savePaymentCorrectionBtn.disabled = true;

    }

    else{

        paymentTotal.style.color = "green";

        savePaymentCorrectionBtn.disabled = false;

    }

}

if (

    paymentCorrectionModal &&

    paymentCash &&

    paymentUpi &&

    paymentCard &&

    paymentTotal &&

    savePaymentCorrectionBtn &&

    cancelPaymentCorrectionBtn

){

    paymentCash.oninput = calculatePaymentTotal;

    paymentUpi.oninput = calculatePaymentTotal;

    paymentCard.oninput = calculatePaymentTotal;

    cancelPaymentCorrectionBtn.onclick = () => {

        paymentCorrectionModal.style.display = "none";

    };

}

savePaymentCorrectionBtn.onclick =
async () => {

    if (!currentViewedBill){

    alert("No bill loaded.");

    return;

}

    if (paymentRemarks.value.trim() === "") {

    alert("Remarks are mandatory.");

    paymentRemarks.focus();

    return;

}

const cash =
    Number(paymentCash.value);

const upi =
    Number(paymentUpi.value);

const card =
    Number(paymentCard.value);

const total =
    cash + upi + card;

// ADD THIS BLOCK HERE
if (Math.abs(total - currentViewedBill.net_amount) > 0.01){

    alert("Payment total must equal Net Amount.");

    return;

}

if (

    cash < 0 ||

    upi < 0 ||

    card < 0

){

    alert("Payment amounts cannot be negative.");

    return;

}

    const result =
        await window.electronAPI
        .updatePaymentAllocation({

            bill_no:
                currentViewedBill.bill_no,

            cash_amount:
                Number(paymentCash.value),

            upi_amount:
                Number(paymentUpi.value),

            card_amount:
                Number(paymentCard.value),

            remarks:
                paymentRemarks.value.trim(),

            corrected_by:
                "Administrator"

        });

        

    if(result.success){

        paymentCorrectionModal.style.display =
            "none";

            paymentCash.value = "";

            paymentUpi.value = "";

            paymentCard.value = "";

            paymentRemarks.value = "";

            paymentTotal.innerText = "";

        await viewBill(
    currentViewedBill.bill_no
);

await loadBills();

alert(
    "Payment allocation updated successfully."
);

}

else{

    alert(result.error);

}

}

/* =====================================
   INITIAL DASHBOARD LOAD
===================================== */

loadDashboardSummary();
loadSystemStatus();

setInterval(() => {

    loadDashboardSummary();
    loadSystemStatus();

}, 10000);

initializeKeyboardShortcuts();

/* =====================================
   SCREEN NAVIGATION
===================================== */

function resetScrollPosition() {

    window.scrollTo(0, 0);

    document.documentElement.scrollTop = 0;

    document.body.scrollTop = 0;

}

function hideAllScreens() {

    dashboardScreen.style.display = "none";

    newBillScreen.style.display = "none";

    paymentScreen.style.display = "none";

    reportsScreen.style.display = "none";

    billHistoryScreen.style.display = "none";

    settingsScreen.style.display = "none";

    settingsPage.style.display = "none";

    document.getElementById("viewBillScreen").style.display = "none";

    resetScrollPosition();

}

function showScreen(screen) {

    hideAllScreens();

    screen.style.display = "block";

}