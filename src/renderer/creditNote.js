function creditNoteMoney(value) {
    return `₹${Number(value || 0).toFixed(2)}`;
}

function creditNoteDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
    return match ? `${match[3]}-${match[2]}-${match[1]}` : "-";
}

function setCreditNoteText(id, value) {
    document.getElementById(id).textContent = value || "-";
}

function loadCreditNote() {
    const data = window.creditNoteData || {};
    const settings = window.storeSettings || {};

    setCreditNoteText("storeName", settings.store_name || "KAIRA LUXE");
    setCreditNoteText("storeAddress", settings.address);
    setCreditNoteText("storePhone", settings.phone);
    setCreditNoteText("storeGstin", settings.gstin);
    setCreditNoteText("creditNoteNo", data.credit_note_no);
    setCreditNoteText("creditNoteDate", creditNoteDate(data.credit_note_date));
    setCreditNoteText("returnNo", data.return_no);
    setCreditNoteText("originalBillNo", data.original_bill_no);
    setCreditNoteText("originalBillDate", creditNoteDate(data.original_bill_date));
    setCreditNoteText("customerName", data.customer_name);
    setCreditNoteText("customerMobile", data.customer_mobile);
    setCreditNoteText("returnReason", data.return_reason);
    setCreditNoteText("remarks", data.remarks);

    const items = document.getElementById("creditNoteItems");
    items.replaceChildren();
    (data.items || []).forEach(item => {
        const row = document.createElement("div");
        row.className = "credit-note-item";
        const name = document.createElement("div");
        name.className = "name";
        name.textContent = `${item.product_name || "Product"} (${item.barcode || "-"})`;
        const detail = document.createElement("div");
        detail.className = "detail";
        detail.textContent =
            `Qty ${item.quantity} | MRP ${creditNoteMoney(item.mrp)} | ` +
            `Disc ${Number(item.discount_percent || 0).toFixed(2)}%`;
        const tax = document.createElement("div");
        tax.className = "detail";
        tax.innerHTML =
            `<span>Taxable ${creditNoteMoney(item.taxable_reversal)} + ` +
            `GST ${Number(item.gst_rate || 0).toFixed(2)}%</span>` +
            `<b>${creditNoteMoney(item.net_reversal)}</b>`;
        row.append(name, detail, tax);
        items.appendChild(row);
    });

    for (const [id, field] of [
        ["grossReversal", "gross_reversal"],
        ["discountReversal", "discount_reversal"],
        ["taxableReversal", "taxable_reversal"],
        ["cgstReversal", "cgst_reversal"],
        ["sgstReversal", "sgst_reversal"],
        ["gstReversal", "gst_reversal"],
        ["netReversal", "net_reversal"]
    ]) {
        setCreditNoteText(id, creditNoteMoney(data[field]));
    }

    const settlementLine = document.getElementById("settlementLine");
    if (data.store_credit_no) {
        setCreditNoteText("storeCreditNo", data.store_credit_no);
    }
    else {
        settlementLine.style.display = "none";
    }
}

window.loadCreditNote = loadCreditNote;
