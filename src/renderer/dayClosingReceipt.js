function loadDayClosingReceipt() {

        const data =

            window.dayClosingData || {};

        document.getElementById(

            "receipt"

        ).innerHTML = `

<pre>

================================

        KAIRA LUXE

       DAY CLOSING

================================

Business Date

${data.businessDate || ""}

--------------------------------

Bills Generated

${data.totalBills || 0}

Items Sold

${data.totalItems || 0}

--------------------------------

Gross Sales

₹${Number(data.grossSales || 0).toFixed(2)}

Discount

₹${Number(data.totalDiscount || 0).toFixed(2)}

GST Collected

₹${Number(data.totalGST || 0).toFixed(2)}

Net Sales

₹${Number(data.netSales || 0).toFixed(2)}

--------------------------------

Cash

₹${Number(data.cashSales || 0).toFixed(2)}

UPI

₹${Number(data.upiSales || 0).toFixed(2)}

Card

₹${Number(data.cardSales || 0).toFixed(2)}

================================

</pre>

`;


    }