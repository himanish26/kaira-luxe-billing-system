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

    const result =
    await window.electronAPI.exportReport(
        request
    );

console.log(result);

}

function validateReportRequest() {

    const reportType =
        document.querySelector(
            'input[name="reportType"]:checked'
        )?.value;

    const dateRange =
        reportDateRange.value;

    const fromDate =
        document.getElementById("fromDate").value;

    const toDate =
        document.getElementById("toDate").value;

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