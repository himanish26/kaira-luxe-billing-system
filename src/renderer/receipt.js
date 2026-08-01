function loadReceipt() {

    const bill = window.receiptData;

    if (!bill) return;

    document.getElementById("billNo").innerText =
        bill.bill_no;

        document.getElementById("customer").innerText =
    bill.customer_name || "-";

document.getElementById("mobile").innerText =
    bill.customer_mobile || "-";

    const d = new Date(bill.bill_date);

document.getElementById("billDate").innerText =
    d.toLocaleDateString("en-IN",{
        day:"2-digit",
        month:"short",
        year:"numeric"
    });

    document.getElementById("billTime").innerText =
    formatTime(bill.bill_time);

function formatTime(time){

    return time.substring(0,5) +
           " " +
           time.substring(9);

}

const customerRow = document.getElementById("customerRow");
const mobileRow = document.getElementById("mobileRow");

if (bill.customer_name && bill.customer_name.trim() !== "") {

    document.getElementById("customer").innerText =
        bill.customer_name;

    customerRow.style.display = "block";

} else {

    customerRow.style.display = "none";

}

if (bill.customer_mobile && bill.customer_mobile.trim() !== "") {

    document.getElementById("mobile").innerText =
        bill.customer_mobile;

    mobileRow.style.display = "block";

} else {

    mobileRow.style.display = "none";

}

    document.getElementById("gross").innerText =
        "₹" + Math.round(Number(bill.gross_amount) || 0);

    document.getElementById("discount").innerText =
        "₹" + Math.round(Number(bill.discount_amount) || 0);

    document.getElementById("gst").innerText =
        "₹" + Math.round(Number(bill.gst_amount) || 0);

    document.getElementById("net").innerText =
        "₹" + Math.round(Number(bill.net_amount) || 0);

    const payments = [

    {
        row: "cashRow",
        value: Number(bill.cash_amount) || 0,
        span: "cash"
    },

    {
        row: "upiRow",
        value: Number(bill.upi_amount) || 0,
        span: "upi"
    },

    {
        row: "cardRow",
        value: Number(bill.card_amount) || 0,
        span: "card"
    }

];

payments.forEach(payment => {

    const row =
        document.getElementById(payment.row);

    if (payment.value > 0) {

        row.style.display = "flex";

        document.getElementById(payment.span).innerText =
            "₹" + Math.round(payment.value);

    } else {

        row.style.display = "none";

    }

});

    const tbody =
        document.getElementById("items");

    tbody.innerHTML = "";

    bill.items.forEach(item => {

        const tr =
            document.createElement("tr");

const net =
    isNaN(Number(item.net_amount))
        ? 0
        : Number(item.net_amount);

tr.innerHTML = `

<td>

<div style="font-size:13px;font-weight:700;">

${item.product_name}

</div>

<div style="font-size:11px;"
color="#555";
margin-top:1px;
">

${item.brand} • ${item.size} • ${item.colour}

</div>

</td>

<td>${item.qty}</td>

<td>₹${Math.round(item.mrp)}</td>

<td>₹${Math.round(net)}</td>

`;

        tbody.appendChild(tr);

    });

    const settings = window.storeSettings;

const footer =
    document.getElementById("receiptFooterMessage");

if (
    settings &&
    settings.receipt_message &&
    settings.receipt_message.trim() !== ""
) {

    footer.innerHTML =
        settings.receipt_message.replace(/\n/g, "<br>");

    footer.style.display = "block";

} else {

    footer.style.display = "none";

}

}

window.loadReceipt = loadReceipt;