const db = require("./database");

/* ===========================================
   BUSINESS REPORT
=========================================== */

async function getBusinessReport(fromDate, toDate) {

    return new Promise((resolve, reject) => {

        const sql = `
            SELECT

                b.bill_no,
                b.bill_date,
                b.bill_time,

                b.customer_name,
                b.customer_mobile,

                bi.barcode,
                bi.brand,
                bi.product_name,

                p.style_code,

                bi.colour,
                bi.size,

                p.supplier,

                bi.category,

                p.hsn_code,

                bi.qty               AS quantity,
                bi.mrp               AS mrp,
                bi.discount_amount   AS discount_amount,
                bi.taxable_amount    AS taxable_amount,

                bi.gst_rate,

                ROUND(bi.gst_amount / 2, 2) AS cgst_amount,

                ROUND(bi.gst_amount / 2, 2) AS sgst_amount,

                bi.net_amount,

                b.cash_amount,

                b.upi_amount,

                b.card_amount

            FROM bills b

            INNER JOIN bill_items bi
                ON b.bill_no = bi.bill_no

            LEFT JOIN products p
                ON bi.barcode = p.barcode

            WHERE DATE(b.bill_date)
                  BETWEEN ? AND ?

            ORDER BY

                b.bill_date,

                b.bill_time,

                b.bill_no,

                bi.id;
        `;

        db.all(sql, [fromDate, toDate], (err, rows) => {

            if (err) {
                reject(err);
                return;
            }

            resolve(rows);

        });

    });

}

/* ===========================================
   GST REPORT
=========================================== */

async function getGSTReport(fromDate, toDate) {

    return [];

}

/* ===========================================
   PRODUCT SALES REPORT
=========================================== */

async function getProductSalesReport(fromDate, toDate) {

    return [];

}

module.exports = {

    getBusinessReport,

    getGSTReport,

    getProductSalesReport

};