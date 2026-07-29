const db = require("./database");

const {

    exportBusinessReport,

    exportGSTReport,

    exportProductSalesReport

} = require("./excelExporter");

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

    return new Promise((resolve, reject) => {

        const sql = `

            SELECT

                b.bill_no,

                b.bill_date,

                bi.gst_rate,

                ROUND(
                    SUM(bi.taxable_amount),
                    2
                ) AS taxable_value,

                ROUND(
                    SUM(bi.gst_amount) / 2,
                    2
                ) AS cgst_amount,

                ROUND(
                    SUM(bi.gst_amount) / 2,
                    2
                ) AS sgst_amount,

                ROUND(
                    SUM(bi.gst_amount),
                    2
                ) AS gst_total,

                ROUND(
                    SUM(bi.net_amount),
                    2
                ) AS net_amount

            FROM bills b

            INNER JOIN bill_items bi

                ON b.bill_no = bi.bill_no

            WHERE DATE(b.bill_date)

                BETWEEN ? AND ?

            GROUP BY

                b.bill_no,

                b.bill_date,

                bi.gst_rate

            ORDER BY

                b.bill_date,

                b.bill_time,

                b.bill_no,

                bi.gst_rate;

        `;

        db.all(

            sql,

            [fromDate, toDate],

            (err, rows) => {

                if (err) {

                    reject(err);

                    return;

                }

                resolve(rows);

            }

        );

    });

}

/* ===========================================
   PRODUCT SALES REPORT
=========================================== */

async function getProductSalesReport(fromDate, toDate) {

    return new Promise((resolve, reject) => {

        const sql = `

            SELECT

                bi.barcode,

                bi.brand,

                bi.product_name,

                p.style_code,

                bi.colour,

                bi.size,

                bi.category,

                SUM(bi.qty) AS qty_sold,

                ROUND(
                    SUM(bi.mrp * bi.qty),
                    2
                ) AS gross_sales,

                ROUND(
                    SUM(bi.discount_amount),
                    2
                ) AS discount_amount,

                ROUND(
                    SUM(bi.taxable_amount),
                    2
                ) AS taxable_value,

                ROUND(
                    SUM(bi.gst_amount),
                    2
                ) AS gst_amount,

                ROUND(
                    SUM(bi.net_amount),
                    2
                ) AS net_sales

            FROM bill_items bi

            LEFT JOIN products p

                ON bi.barcode = p.barcode

            INNER JOIN bills b

                ON bi.bill_no = b.bill_no

            WHERE DATE(b.bill_date)

                BETWEEN ? AND ?

            GROUP BY

                bi.barcode,
                bi.brand,
                bi.product_name,
                p.style_code,
                bi.colour,
                bi.size,
                bi.category

            ORDER BY

                qty_sold DESC,
                net_sales DESC;

        `;

        db.all(

            sql,

            [fromDate, toDate],

            (err, rows) => {

                if (err) {

                    reject(err);

                    return;

                }

                resolve(rows);

            }

        );

    });

}

async function exportReport(
    request,
    filePath
) {

    switch (request.reportType) {

        case "business": {

            const data =
                await getBusinessReport(
                    request.fromDate,
                    request.toDate
                );

            return await exportBusinessReport(
                data,
                filePath
            );

        }

        case "gst": {

            const data =
                await getGSTReport(
                    request.fromDate,
                    request.toDate
                );

            return await exportGSTReport(
                data,
                filePath
            );

        }

        case "product": {

            const data =
                await getProductSalesReport(
                    request.fromDate,
                    request.toDate
                );

            return await exportProductSalesReport(
                data,
                filePath
            );

        }

        default:

            throw new Error(
                "Invalid Report Type"
            );

    }

}

module.exports = {

    exportReport,

    getBusinessReport,

    getGSTReport,

    getProductSalesReport

};