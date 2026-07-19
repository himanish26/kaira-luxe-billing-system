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

const dashboardScreen =
    document.getElementById("dashboardScreen");

const newBillScreen =
    document.getElementById("newBillScreen");

const paymentScreen =
    document.getElementById("paymentScreen");

const billHistoryScreen =
    document.getElementById("billHistoryScreen");

const settingsScreen =
    document.getElementById("settingsScreen");

const storeCard =
    document.getElementById("storeCard");

const inventoryCard =
    document.getElementById("inventoryCard");

    if (inventoryCard) {

    inventoryCard.addEventListener("click", () => {
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   
    showInventory();

});

}
   
const deviceCard =
    document.getElementById("deviceCard");

const systemCard =
    document.getElementById("systemCard");

const aboutCard =
    document.getElementById("aboutCard");

const adminCard =
    document.getElementById("adminCard");

if (storeCard){

    storeCard.addEventListener("click", () => {

        settingsScreen.style.display = "none";

        settingsPage.style.display = "block";
        
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

(async () => {

    try {

        const settings =
            await window.electronAPI.getSettings();

        receiptMessage.innerText =
            settings.receipt_message || "Not Set";

        document.getElementById("storeLastUpdated").innerText =
            settings.last_updated || "Never";

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

        await window.electronAPI.saveSettings({

            receipt_message: msg,

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

    });

}

function requireAdminAuthorization(callback){

    adminSuccessCallback = callback;

    adminPassword.value = "";

    document.getElementById("adminError").innerText = "";

    adminDialog.style.display = "flex";

    adminPassword.focus();

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


/* =====================================
   NEW BILL BUTTON
===================================== */

const newBillBtn =
    document.getElementById("newBillBtn");

if (newBillBtn) {

    newBillBtn.addEventListener("click", () => {

        dashboardScreen.style.display = "none";
        newBillScreen.style.display = "block";
        loadNextBillNumber();
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

    settingsBtn.addEventListener("click", () => {

    dashboardScreen.style.display = "none";

    settingsScreen.style.display = "block";

});

}

const settingsDashboardBtn =
    document.getElementById("settingsDashboardBtn");

if (settingsDashboardBtn){

    settingsDashboardBtn.addEventListener("click", () => {

        settingsScreen.style.display = "none";

        dashboardScreen.style.display = "block";

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

    renderBill();

    document.getElementById("customerName").value = "";

    document.getElementById("customerMobile").value = "";

    paymentScreen.style.display = "none";

    dashboardScreen.style.display = "block";
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

    loadNextBillNumber();

    newBillScreen.style.display = "none";

    dashboardScreen.style.display = "block";

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

paymentBtn.addEventListener("click", () => {

    if (billItems.length === 0) {

    alert("Please scan at least one product before proceeding to payment.");

    return;

}

    newBillScreen.style.display = "none";

    paymentScreen.style.display = "block";

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
        }
    );

}

const viewBillBackBtn =
    document.getElementById("viewBillBackBtn");

if (viewBillBackBtn) {

    viewBillBackBtn.addEventListener("click", () => {

        document.getElementById("viewBillScreen").style.display = "none";

        billHistoryScreen.style.display = "block";

    });

}

if (historyBackBtn) {

billHistoryBtn.addEventListener(
    "click",
    async () => {

        dashboardScreen.style.display = "none";

        billHistoryScreen.style.display = "block";

        await loadBills();

    }
);

}

function openSettingsPage(title, html){

    settingsScreen.style.display = "none";

    settingsPage.style.display = "block";

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

const barcodeInput =
    document.getElementById(
        "barcodeInput"
    );
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

            const barcode =
                barcodeInput.value.trim();

            if (!barcode) {
                return;
            }

            const product =
                await window
                    .electronAPI
                    .getProduct(barcode);

            console.log(product);

            if (!product) {

    alert(
        "Product Not Found"
    );
            
    barcodeInput.value = "";

    return;

}

addProductToBill(product);

barcodeInput.value = "";

barcodeInput.focus();

}
);

}
function addProductToBill(product){

    const existingItem =
        billItems.find(item =>
            item.barcode === product.barcode
        );

    if(existingItem){

        existingItem.qty++;

    }

    else{

        billItems.push({

             barcode: product.barcode,

            brand: product.brand,

            category: product.category,

            product_name: product.product_name,

             size: product.size,

             colour: product.colour,

             mrp: Number(product.mrp),

             qty: 1,

             discount: 0,

             gst_rate: Number(product.gst_rate)

        });

    }

    renderBill();

loadPaymentSummary();

document.getElementById("cashAmount").value = 0;
document.getElementById("upiAmount").value = 0;
document.getElementById("cardAmount").value = 0;

calculatePayment();
}

function renderBill(){

    const tbody =
        document.getElementById("billTableBody");

    tbody.innerHTML = "";

    billItems.forEach((item,index)=>{

        const row =
            document.createElement("tr");

        const gross =
    item.qty * item.mrp;

const net =
    gross -
    (gross * item.discount / 100);

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
max="10"
value="${item.discount}"
class="discount-input"
onchange="updateDiscount(${index}, this.value)"
>

</td>

<td>₹${Math.round(net)}</td>

<td>

<button
class="delete-btn"
onclick="removeItem(${index})">

🗑

</button>

</td>

`;

        tbody.appendChild(row);

    });

    updateSummary();

}

function clearCurrentBill(){

    billItems = [];

    renderBill();

    document.getElementById("customerName").value = "";

    document.getElementById("customerMobile").value = "";

    document.getElementById("barcodeInput").value = "";

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
window.removeItem = removeItem;

function updateSummary(){

    let totalQty = 0;
    let gross = 0;
    let discount = 0;
    let gst = 0;

    billItems.forEach(item=>{

        totalQty += item.qty;

        const lineGross =
            item.qty * item.mrp;

        const lineDiscount =
            lineGross * item.discount / 100;

        const net =
            lineGross - lineDiscount;

        const taxable =
            net * 100 /
            (100 + item.gst_rate);

        gross += lineGross;
        discount += lineDiscount;
        gst += net - taxable;

    });

    document.getElementById("itemCount").innerText =
    billItems.length;

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

        console.log(details);

        currentViewedBill = {

    ...details.bill,

    items: details.items

};

        
    // Hide Bill History
    billHistoryScreen.style.display = "none";

    // Show View Bill Screen
    document.getElementById("viewBillScreen").style.display = "block";

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
