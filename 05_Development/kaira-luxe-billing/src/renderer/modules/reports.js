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

    exportFunction:
        "exportCustomerPurchaseReport",

    serviceFunction:
        "getCustomerPurchaseReport"

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

const exportReportBtn =
    document.getElementById(
        "exportReportBtn"
    );

function initializeReports() {

    console.log("Reports Module Loaded");

    setupReportSelection();

    setupDateRange();

    setupExportButton();

    const defaultReport =
        document.querySelector(
            'input[name="reportType"]:checked'
        );

    updateReportDescription(
        defaultReport.value
    );

    updateSelectedReportCard();

}

function setupReportSelection(){

    reportTypeRadios.forEach(radio => {

    radio.addEventListener("change", () => {

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

function setupDateRange(){

    reportDateRange.addEventListener("change", () => {

        if(reportDateRange.value === "custom"){

            customDateRange.style.display = "block";

        }

        else{

            customDateRange.style.display = "none";

        }

    });

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

    const report =
        reports[request.reportType];

    if (!report) {

        alert("Invalid Report.");

        return;

    }

    const exportAction = async () => {

        const result =
            await window.electronAPI.exportReport(
                request
            );

        console.log(result);

        if (result.success) {

            alert("✅ Report exported successfully.");

        }

        else if (!result.cancelled) {

            alert(result.error || "Unable to export report.");

        }

    };

    if (report.adminOnly) {

        requireAdminAuthorization(exportAction);

    }

    else {

        exportAction();

    }

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
/* =====================================
   INITIALIZE REPORTS
===================================== */

initializeReports();