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

<div class="device-settings-container">

    <div class="device-card printer-card">

        <h2 class="device-card-title">

            🖨 Printer

        </h2>

        <div class="settings-field">

    <label>

        Default Printer

    </label>

    <select id="printerSelect">

        <option>

            Loading printers...

        </option>

    </select>

</div>

        <!-- Existing Printer HTML starts here -->

        <div class="settings-field">

            <label>Status</label>

            <div

    id="printerStatus"

    class="status-badge status-warning"

>

    🟡 Loading...

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

    <div class="device-card scanner-card">

    <h2 class="device-card-title">

            📷 Scanner

        </h2>

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

        <div

        id="expectedScan"

        class="expected-scan"

        >

        8901234567890

        </div>

    </div>

    <div class="settings-field">

        <label>Scanner Output</label>

        <input

id="scannerOutput"

placeholder="Scan a barcode..."

autocomplete="off"

>

    </div>

    <div class="settings-field">

        <label>Status</label>

        <div id="scannerStatus" class="status-badge status-warning">

            🟡 Waiting for Scan

        </div>

    </div>

    <div class="settings-actions">

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

    async function refreshPrinterStatus() {

    try {

        const status =
            await window.electronAPI.getSystemStatus();

        switch (status.printer.status) {

            case "Ready":

                printerStatus.textContent =
                    `🟢 ${status.printer.name}`;

                printerStatus.className =
                    "status-badge status-success";

                break;

            case "Offline":

                printerStatus.textContent =
                    `🟡 ${status.printer.name} (Offline)`;

                printerStatus.className =
                    "status-badge status-warning";

                break;

            case "No Default":

                printerStatus.textContent =
                    "🟡 No Default Printer";

                printerStatus.className =
                    "status-badge status-warning";

                break;

            case "No Printer":

                printerStatus.textContent =
                    "🔴 No Printer Installed";

                printerStatus.className =
                    "status-badge status-error";

                break;

            default:

                printerStatus.textContent =
                    "🔴 Unavailable";

                printerStatus.className =
                    "status-badge status-error";

        }

    }

    catch (err) {

        console.error(err);

        printerStatus.textContent =
            "🔴 Unable to Detect Printer";

        printerStatus.className =
            "status-badge status-error";

    }

}

window.electronAPI
    .getPrinters()
    .then(result => {

        console.log(result);

        if (!result.success) {

    printerStatus.textContent =
        "🔴 Unable to load printers";

    printerStatus.className =
        "status-badge status-error";

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


            printerSelect.appendChild(option);

        });

        refreshPrinterStatus();

    if (

    !result.printers.some(

        p => p.isDefault

    )

) {

    printerStatus.textContent =
        "🟢 Ready";

    printerStatus.className =
        "status-badge status-success";

}

    })
    .catch(err => {

    console.error(err);

    printerStatus.textContent =
        "🔴 Unable to load printers";

    printerStatus.className =
        "status-badge status-error";

});

document
    .getElementById("savePrinterBtn")
    .addEventListener(

        "click",

        async () => {

            try {

                await window.electronAPI.saveSettings({

                    default_printer:
                        printerSelect.value

                });

                await refreshPrinterStatus();

                alert(
                    "✅ Printer settings saved successfully."
                );

            }

            catch (err) {

                console.error(err);

                alert(
                    "Unable to save printer settings."
                );

            }

        }

    );

document
    .getElementById("testPrinterBtn")
    .addEventListener("click", async () => {
        try {
            const selectedPrinter = printerSelect.value;
            const result = await window.electronAPI.testPrinter(selectedPrinter); // or ipcRenderer.invoke("printer:test", selectedPrinter)
            if (result && result.success) {
                alert("✅ Test print sent successfully.");
            } else {
                alert("🔴 Print failed: " + (result?.error || "Unknown error"));
            }
        } catch (err) {
            console.error(err);
            alert("🔴 Failed to trigger test print.");
        }
    });

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

    expectedScan.textContent =
        TEST_CODES[type];

    scannerOutput.disabled =
        false;

    scannerOutput.value = "";

    scannerStatus.textContent =
        "🟡 Waiting for Scan";

    scannerStatus.className =
        "status-badge status-warning";

    scannerOutput.focus();

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

    if (scannerOutput.disabled) {

        return;

    }

    const scannedValue =
        scannerOutput.value.trim();

    const expectedValue =
        expectedScan.textContent.trim();

    if (scannedValue === expectedValue) {

        scannerStatus.innerHTML =
            "🟢 Scanner Test Passed";

        scannerStatus.className =
            "status-badge status-success";

        scannerOutput.disabled =
            true;

        setTimeout(

            () => {

                updateScannerUI();

            },

            3000

        );

    }

    else {

        scannerStatus.innerHTML =
            "🔴 Invalid Scan";

        scannerStatus.className =
            "status-badge status-error";

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

