/* =====================================
   REPORT DEFINITIONS
===================================== */

const reports = {

    business: {

        title: "Business Report",

        description:
            "Complete sales register for business analysis.",

        features: [

            "Bill-wise Sales",
            "Product Details",
            "GST Breakup",
            "Payment Summary",

        ],

        baseFileName:
            "KLBusinessReport",

        adminOnly:false,

        exportFunction:
            "exportBusinessReport",

        serviceFunction:
            "getBusinessReport",

    },

    gst: {

        title: "GST Report",

        description:
            "GST summary for accounting and tax filing.",

        features: [

            "Taxable Amount",
            "GST %",
            "CGST",
            "SGST",
            "HSN Summary"

        ],

        baseFileName:
            "KLGSTReport",
        
        adminOnly: false,

        exportFunction:
            "exportGSTReport",

        serviceFunction:
            "getGSTReport",

    },

    product: {

        title: "Product Sales Report",

        description:
            "Product-wise sales and inventory analysis.",

        features: [

            "Product Sales",
            "Quantity Sold",
            "Brand Summary",
            "Category Summary",
            "Revenue Analysis"

        ],

        baseFileName:
            "KLProductSalesReport",

        adminOnly: false,

        exportFunction:
            "exportProductReport",

        serviceFunction:
            "getProductReport",

    },

    customer: {

    title: "Customer Purchase Report",

    description:
        "Customer-wise purchase history and spending analysis.",

    features: [

        "Customer Summary",
        "Purchase History",
        "Average Bill Value",
        "First Purchase",
        "Last Purchase"

    ],

    baseFileName:
        "KLCustomerPurchaseReport",

    adminOnly: true,

    authorizationPurpose:
        "CUSTOMER_REPORT_EXPORT",

    exportFunction:
        "exportCustomerPurchaseReport",

    serviceFunction:
        "getCustomerPurchaseReport"

},

    billSummary: {

        title: "Bill Summary Report",

        description:
            "Bill-wise transaction and customer data for business analysis.",

        features: [
            "Bill Number & Date",
            "Customer Details",
            "Quantity & Bill Value",
            "Payment Breakdown"
        ],

        baseFileName:
            "KLBillSummaryReport",

        adminOnly: true,

        authorizationPurpose:
            "BILL_SUMMARY_REPORT_EXPORT",

        exportFunction:
            "exportBillSummaryReport",

        serviceFunction:
            "getBillSummaryReport"

    }

};

/* =====================================
   REPORTS MODULE
===================================== */

const reportTypeRadios =
    document.querySelectorAll(
        'input[name="reportType"]'
    );

const reportDateRange =
    document.getElementById(
        "reportDateRange"
    );

const customDateRange =
    document.getElementById(
        "customDateRange"
    );

const reportDescription =
    document.getElementById(
        "reportDescription"
    );

const selectedPeriodText =
    document.getElementById(
        "selectedPeriodText"
    );

const exportReportBtn =
    document.getElementById(
        "exportReportBtn"
    );

let activeProtectedReportAuthorization = null;
let lastAuthorizedReportType = null;

function initializeReports() {

    console.log("Reports Module Loaded");

    setupReportSelection();

    setupDateRange();

    setMaximumReportDate();

    setupExportButton();

    const defaultReport =
        document.querySelector(
            'input[name="reportType"]:checked'
        );

    lastAuthorizedReportType = defaultReport.value;

    updateReportDescription(
        defaultReport.value
    );

    updateSelectedReportCard();

}

function setupReportSelection(){

    reportTypeRadios.forEach(radio => {

    radio.addEventListener("change", async () => {

        const previousType = lastAuthorizedReportType ||
            Array.from(reportTypeRadios).find(option => option !== radio && option.checked)?.value ||
            "business";
        const report = reports[radio.value];

        if (report && report.adminOnly) {
            const grant = await requestAdminAuthorization(report.authorizationPurpose);
            if (!grant) {
                const previousRadio = Array.from(reportTypeRadios)
                    .find(option => option.value === previousType);
                if (previousRadio) previousRadio.checked = true;
                updateSelectedReportCard();
                updateReportDescription(previousType);
                return;
            }
            activeProtectedReportAuthorization = { reportType: radio.value, grant };
        }
        else {
            activeProtectedReportAuthorization = null;
        }

        lastAuthorizedReportType = radio.value;

        updateSelectedReportCard();

        updateReportDescription(radio.value);

    });

});

}

function updateSelectedReportCard() {

    document
        .querySelectorAll(".report-option")
        .forEach(option => {

            option.classList.remove("selected");

            if (option.querySelector("input").checked) {

                option.classList.add("selected");

            }

        });

}

function setMaximumReportDate() {

    const today = new Date()
        .toISOString()
        .split("T")[0];

    document
        .getElementById("fromDate")
        .max = today;

    document
        .getElementById("toDate")
        .max = today;

}

function setupDateRange(){

    reportDateRange.addEventListener("change", () => {

        if(reportDateRange.value === "custom"){

            customDateRange.style.display = "flex";

        }

        else{

            customDateRange.style.display = "none";

        }

        updateSelectedPeriod();

    });

    const fromDate =
    document.getElementById("fromDate");

const toDate =
    document.getElementById("toDate");

fromDate.addEventListener("change", () => {

    if (toDate.value && fromDate.value > toDate.value) {

        toDate.value = fromDate.value;

    }

    updateSelectedPeriod();

});

toDate.addEventListener("change", () => {

    if (fromDate.value && toDate.value < fromDate.value) {

        alert("To Date cannot be earlier than From Date.");

        toDate.value = fromDate.value;

    }

    updateSelectedPeriod();

});

    updateSelectedPeriod();

}

function setupExportButton() {

    exportReportBtn.addEventListener("click", () => {

        startReportExport();

    });

}

async function startReportExport() {

    console.log("Starting Report Export...");

    const request = validateReportRequest();

    if (!request) {

        return;

    }

    const report = reports[request.reportType];

    if (!report) {

        alert("Invalid Report.");

        return;

    }

    const exportAction = async grant => {

        exportReportBtn.disabled = true;

        exportReportBtn.innerHTML = "⏳ EXPORTING...";

        try {

            const result =
                await window.electronAPI.exportReport(request, grant);

            console.log(result);

            if (result.success) {

                alert("✅ Report exported successfully.");

            }

            else if (!result.cancelled) {

                alert(result.error || "Unable to export report.");

            }

        }

        finally {

            exportReportBtn.disabled = false;

            exportReportBtn.innerHTML = "📊 EXPORT TO EXCEL";

        }

    };

    if (report.adminOnly) {
        let grant = activeProtectedReportAuthorization &&
            activeProtectedReportAuthorization.reportType === request.reportType
            ? activeProtectedReportAuthorization.grant
            : null;
        if (!grant) grant = await requestAdminAuthorization(report.authorizationPurpose);
        if (!grant) return;
        activeProtectedReportAuthorization = null;
        await exportAction(grant);
        return;
    }

    await exportAction();

}

function validateReportRequest() {

    const reportType =
        document.querySelector(
            'input[name="reportType"]:checked'
        )?.value;

    const dateRange =
        reportDateRange.value;

        let fromDate = "";

let toDate = "";

const today = new Date();

const formatDate = (date) => {

    const year = date.getFullYear();

    const month = String(date.getMonth() + 1)
        .padStart(2, "0");

    const day = String(date.getDate())
        .padStart(2, "0");

    return `${year}-${month}-${day}`;

};

switch (dateRange) {

    case "today":

        fromDate = formatDate(today);
        toDate = formatDate(today);

        break;

    case "yesterday": {

        const yesterday = new Date(today);

        yesterday.setDate(
            yesterday.getDate() - 1
        );

        fromDate = formatDate(yesterday);
        toDate = formatDate(yesterday);

        break;

    }

    case "thisMonth": {

        const firstDay =
            new Date(
                today.getFullYear(),
                today.getMonth(),
                1
            );

        fromDate = formatDate(firstDay);

        toDate = formatDate(today);

        break;

    }

    case "lastMonth": {

        const firstDay =
            new Date(
                today.getFullYear(),
                today.getMonth() - 1,
                1
            );

        const lastDay =
            new Date(
                today.getFullYear(),
                today.getMonth(),
                0
            );

        fromDate = formatDate(firstDay);

        toDate = formatDate(lastDay);

        break;

    }

    case "currentFY": {

        const fyStartYear =
            today.getMonth() >= 3
                ? today.getFullYear()
                : today.getFullYear() - 1;

        fromDate =
            `${fyStartYear}-04-01`;

        toDate =
            formatDate(today);

        break;

    }

    case "previousFY": {

        const fyStartYear =
            today.getMonth() >= 3
                ? today.getFullYear() - 1
                : today.getFullYear() - 2;

        fromDate =
            `${fyStartYear}-04-01`;

        toDate =
            `${fyStartYear + 1}-03-31`;

        break;

    }

    case "custom":

        fromDate =
            document.getElementById("fromDate").value;

        toDate =
            document.getElementById("toDate").value;

        break;

}

    if (!reportType) {

        alert("Please select a report.");

        return null;

    }

    if (dateRange === "custom") {

        if (!fromDate || !toDate) {

            alert(
                "Please select both From Date and To Date."
            );

            return null;

        }

        if (fromDate > toDate) {

            alert(
                "From Date cannot be after To Date."
            );

            return null;

        }

    }

    return {

        reportType,

        dateRange,

        fromDate,

        toDate

    };

}

function updateReportDescription(type){

    const report = reports[type];

    if(!report) return;

    reportDescription.innerHTML = `

<h3>${report.title}</h3>

<p>${report.description}</p>

<ul>

${report.features.map(item => `

<li>

<span class="report-check">

✔

</span>

${item}

</li>

`).join("")}

</ul>

`;

}

function updateSelectedPeriod(){

    const option = reportDateRange.value;

    const today = new Date();

    const formatDisplayDate = (date) => {

        return date.toLocaleDateString("en-IN", {

            day: "numeric",

            month: "long",

            year: "numeric"

        });

    };

    let text = "";

    switch(option){

        case "today":

            text = formatDisplayDate(today);

            break;

        case "yesterday":{

            const yesterday = new Date(today);

            yesterday.setDate(today.getDate() - 1);

            text = formatDisplayDate(yesterday);

            break;

        }

        case "thisMonth":{

            const firstDay = new Date(
                today.getFullYear(),
                today.getMonth(),
                1
            );

            text =
                `${formatDisplayDate(firstDay)} to Till Date`;

            break;

        }

        case "lastMonth":{

            const firstDay = new Date(
                today.getFullYear(),
                today.getMonth() - 1,
                1
            );

            const lastDay = new Date(
                today.getFullYear(),
                today.getMonth(),
                0
            );

            text =
                `${formatDisplayDate(firstDay)} to ${formatDisplayDate(lastDay)}`;

            break;

        }

        case "currentFY":{

            const fyYear =
                today.getMonth() >= 3
                    ? today.getFullYear()
                    : today.getFullYear() - 1;

            text =
                `1 April ${fyYear} to Till Date`;

            break;

        }

        case "previousFY":{

            const fyYear =
                today.getMonth() >= 3
                    ? today.getFullYear() - 1
                    : today.getFullYear() - 2;

            text =
                `1 April ${fyYear} to 31 March ${fyYear + 1}`;

            break;

        }

        case "custom":{

            const from =
                document.getElementById("fromDate").value;

            const to =
                document.getElementById("toDate").value;

            if(from && to){

                text =
                    `${formatDisplayDate(new Date(from))} to ${formatDisplayDate(new Date(to))}`;

            }

            else{

                text =
                    "Please select both dates.";

            }

            break;

        }

    }

    selectedPeriodText.textContent = text;

}

/* =====================================
   INITIALIZE REPORTS
===================================== */

initializeReports();
