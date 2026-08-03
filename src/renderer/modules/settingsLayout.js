/* =====================================
   SETTINGS PAGE LAYOUT
===================================== */

function renderSettingsPage({

    title,

    icon,

    subtitle,

    backText,

    backAction,

    content

}) {

    /* Hide Settings Dashboard */

    settingsScreen.style.display = "none";

    /* Show Settings Content Page */

    settingsPage.style.display = "block";

    /* Render Page */

    settingsPageContent.innerHTML = `

<div class="settings-layout">

    <div class="settings-header">

        <h1>

            ${icon} ${title}

        </h1>

        <p class="page-subtitle">

            ${subtitle}

        </p>

    </div>

    ${content}

</div>



`;

    const backButton =
    document.getElementById(
        "settingsPageBackBtn"
    );

backButton.textContent = backText;

backButton.onclick = () => {

    settingsPage.style.display = "none";

    if (typeof backAction === "function") {

        backAction();

    } else {

        settingsScreen.style.display = "block";

    }

};

}

function showDeviceSettings() {

    settingsScreen.style.display = "none";

    settingsPage.style.display = "block";

    settingsPageContent.innerHTML = `

<h1 class="settings-title">
🖨 Device Settings
</h1>

<div class="settings-group">

    <div class="settings-card-large">

        <h2>🖨 Printer</h2>

        <div class="settings-field">

            <label>Default Printer</label>

            <select id="printerSelect">

                <option>
                    Loading printers...
                </option>

            </select>

        </div>

        <div class="settings-field">

            <label>Status</label>

            <div id="printerStatus">

                🟡 No Printer Selected

            </div>

        </div>

        <div class="settings-actions">

            <button
                id="testPrinterBtn"
                class="dashboard-btn">

                🧾 Test Print

            </button>

            <button
                id="savePrinterBtn"
                class="dashboard-btn">

                💾 Save

            </button>

        </div>

    </div>

    <div class="settings-card-large">

    <h2>📷 Scanner</h2>

    <div class="settings-field">

        <label>Test Type</label>

        <select id="scannerTestType">

            <option value="barcode">

                Barcode

            </option>

            <option value="qr">

                QR Code

            </option>

        </select>

    </div>

    <div class="settings-field">

        <label>Test Code</label>

        <div
            id="scannerCodePreview"
            style="text-align:center;padding:20px;background:#fff;border-radius:10px;">

        </div>

    </div>

    <div class="settings-field">

        <label>Expected Scan</label>

        <input
            id="expectedScan"
            type="text"
            readonly>

    </div>

    <div class="settings-field">

        <label>Scanner Output</label>

        <input
            id="scannerOutput"
            type="text"
            autocomplete="off">

    </div>

    <div class="settings-field">

        <label>Status</label>

        <div id="scannerStatus">

            🟡 Waiting for Scan

        </div>

    </div>

    <div class="settings-actions">

        <button
            id="clearScannerBtn"
            class="dashboard-btn">

            🗑 Clear

        </button>

        <button
            id="saveScannerBtn"
            class="dashboard-btn">

            💾 Save

        </button>

    </div>

</div>

`;

const printerSelect =
    document.getElementById("printerSelect");

const printerStatus =
    document.getElementById("printerStatus");

window.electronAPI
    .getPrinters()
    .then(result => {

        console.log(result);

        if (!result.success) {
            printerStatus.textContent =
                "🔴 Unable to load printers";
            return;
        }

        printerSelect.innerHTML = "";

        result.printers.forEach(printer => {

            const option =
                document.createElement("option");

            option.value = printer.name;

            option.textContent =
                printer.displayName || printer.name;

            if (printer.isDefault) {
                option.selected = true;
            }

            if (printer.isDefault) {

    printerStatus.textContent =
        "🟢 Ready";

}

            printerSelect.appendChild(option);

        });

    

    })
    .catch(err => {
        console.error(err);
        printerStatus.textContent =
            "🔴 Unable to load printers";
    });

document
    .getElementById("testPrinterBtn")
    .addEventListener(

        "click",

        async () => {

            const printerName =
                printerSelect.value;

            if (!printerName) {

                alert("Please select a printer.");

                return;

            }

            const result =
                await window.electronAPI
                    .testPrinter(printerName);

            if (result.success) {

                alert("Test print sent successfully.");

            }

            else {

                alert(
                    result.error ||
                    "Printing failed."
                );

            }

        }

    );

const backButton =
    document.getElementById("settingsPageBackBtn");

if (backButton) {

    backButton.textContent = "← Settings";

    backButton.onclick = () => {

        settingsPage.style.display = "none";
        settingsScreen.style.display = "block";

    };

}

/* =====================================
   SCANNER TEST
===================================== */

const TEST_CODES = {

    barcode: "8901234567890",

    qr: "KL-SCANNER-TEST"

};

const scannerType =
    document.getElementById("scannerTestType");

const expectedScan =
    document.getElementById("expectedScan");

const scannerOutput =
    document.getElementById("scannerOutput");

const scannerStatus =
    document.getElementById("scannerStatus");

const scannerPreview =
    document.getElementById("scannerCodePreview");

function updateScannerUI() {

    const type =
        scannerType.value;

    expectedScan.value =
        TEST_CODES[type];

    scannerOutput.focus();

    scannerStatus.textContent =
        "🟡 Waiting for Scan";

    scannerPreview.innerHTML = `
    <svg id="barcodeSvg"></svg>
    `;

if (type === "barcode") {

    scannerPreview.innerHTML =
        '<svg id="barcodeSvg"></svg>';

    JsBarcode(

        "#barcodeSvg",

        TEST_CODES.barcode,

        {

            format: "CODE128",

            width: 2,

            height: 60,

            displayValue: true,

            margin: 10

        }

    );

}

else {

    scannerPreview.innerHTML =
        '<div id="qrCode"></div>';

    new QRCode(

        document.getElementById("qrCode"),

        {

            text: TEST_CODES.qr,

            width: 180,

            height: 180

        }

    );

}

}

function validateScanner() {

    const scannedValue =
        scannerOutput.value.trim();

    const expectedValue =
        expectedScan.value.trim();

    if (scannedValue === expectedValue) {

        scannerStatus.innerHTML =
            "🟢 Scanner Test Passed";

    } else {

        scannerStatus.innerHTML =
            "🔴 Invalid Scan";

    }

}

updateScannerUI();

scannerType.addEventListener(

    "change",

    updateScannerUI

);

scannerOutput.addEventListener(

    "keydown",

    function(event){

        if(event.key==="Enter"){

            event.preventDefault();

            validateScanner();

        }

    }

);
    
}

