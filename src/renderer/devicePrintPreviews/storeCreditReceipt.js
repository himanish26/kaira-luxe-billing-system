/* =====================================
   STORE CREDIT RECEIPT
===================================== */

function formatDate(value) {

    if (!value) {

        return "-";

    }

    const date =
        new Date(
            value + "T00:00:00"
        );

    return date.toLocaleDateString(
        "en-IN",
        {
            day: "2-digit",
            month: "2-digit",
            year: "numeric"
        }
    );

}


function formatCurrency(value) {

    return new Intl.NumberFormat(
        "en-IN",
        {
            style: "currency",
            currency: "INR",
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }
    ).format(
        Number(value || 0)
    );

}


/* =====================================
   LOAD STORE CREDIT RECEIPT
===================================== */

function loadStoreCreditReceipt() {

    const data =
        window.storeCreditData;

    if (!data) {

        console.error(
            "Store Credit receipt data is missing."
        );

        return;

    }

    /* =========================
       STORE CREDIT DETAILS
    ========================== */

    document.getElementById(
        "storeCreditNo"
    ).innerText =
        data.store_credit_no ||
        "-";

    document.getElementById(
        "returnNo"
    ).innerText =
        data.return_no ||
        data.return_number ||
        "-";

document.getElementById(
    "originalBillNo"
).innerText =
    (
        data.original_bill_no ||
        "-"
    ).toUpperCase();

    document.getElementById(
        "issueDate"
    ).innerText =
        formatDate(
            data.issue_date
        );

    document.getElementById(
        "validUntil"
    ).innerText =
        formatDate(
            data.valid_until
        );


    /* =========================
       CUSTOMER DETAILS
    ========================== */

    document.getElementById(
        "customerName"
    ).innerText =
        data.customer_name ||
        "-";

    document.getElementById(
        "customerMobile"
    ).innerText =
        data.customer_mobile ||
        "-";


    /* =========================
       CREDIT AMOUNT
    ========================== */

    document.getElementById(
        "storeCreditAmount"
    ).innerText =

formatCurrency(
    data.amount ||
    data.original_amount ||
    data.return_amount
);


    /* =========================
       TERMS & CONDITIONS
    ========================== */

    const termsConditions =
        document.getElementById(
            "termsConditions"
        );

    termsConditions.innerHTML = `
        <ol>

            <li>
                This Store Credit is valid until
                ${formatDate(data.valid_until)}
                and cannot be redeemed after
                the expiry date.
            </li>

            <li>
                It can be redeemed only at
                Kaira Luxe in accordance with
                our applicable return and
                redemption policy.
            </li>

            <li>
                Please present this Store Credit
                receipt or quote your registered
                mobile number at the time of
                redemption.
            </li>

            <li>
                Store Credit is non-refundable
                and cannot be redeemed for cash.
            </li>

            <li>
                Any unredeemed Store Credit value
                will expire after the validity date.
            </li>

        </ol>
    `;

}


/* =====================================
   EXPOSE TO PRINTER
===================================== */

window.loadStoreCreditReceipt =
    loadStoreCreditReceipt;