const db = require("./database");

const {

    exportBusinessReport,

    exportGSTReport,

    exportProductSalesReport,

    exportCustomerPurchaseReport

} = require("./excelExporter");

function toPaise(value) {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount)) {
        throw new Error("Invalid Credit Note accounting value in report data.");
    }
    return Math.round((amount + Number.EPSILON) * 100);
}

function fromPaise(value) {
    if (!Number.isSafeInteger(value)) {
        throw new Error("Credit Note report total exceeds safe limits.");
    }
    return value / 100;
}

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
   AUTHORITATIVE CREDIT NOTE REPORT DATA
=========================================== */

async function getCompletedCreditNoteItems(fromDate, toDate) {

    return new Promise((resolve, reject) => {

        const sql = `
            SELECT
                r.credit_note_no,
                r.business_date AS credit_note_date,
                r.return_no,
                r.original_bill_no,
                r.original_bill_date,
                r.customer_name,
                r.customer_mobile,
                ri.id AS return_item_id,
                ri.barcode,
                obi.brand,
                ri.product_name,
                NULL AS style_code,
                obi.colour,
                obi.size,
                obi.category,
                ri.quantity AS quantity_returned,
                ri.mrp,
                ri.gross_reversal,
                ri.discount_percent,
                ri.discount_reversal,
                ri.taxable_reversal,
                ri.gst_rate,
                ri.cgst_reversal,
                ri.sgst_reversal,
                ri.gst_reversal,
                ri.net_reversal
            FROM returns r
            INNER JOIN return_items ri
                ON ri.return_id = r.id
            LEFT JOIN bill_items obi
                ON obi.id = ri.original_bill_item_id
            WHERE r.accounting_status = 'COMPLETED'
              AND r.credit_note_no IS NOT NULL
              AND TRIM(r.credit_note_no) <> ''
              AND r.accounting_snapshot_version = 1
              AND DATE(r.business_date) BETWEEN ? AND ?
            ORDER BY
                r.business_date,
                UPPER(TRIM(r.credit_note_no)),
                ri.id
        `;

        db.all(sql, [fromDate, toDate], (error, rows) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(rows || []);
        });

    });

}

function groupCreditNoteGSTReversals(items) {

    const grouped = new Map();

    for (const item of items) {
        const key = [
            String(item.credit_note_no || "").trim().toUpperCase(),
            String(item.gst_rate)
        ].join("|");

        if (!grouped.has(key)) {
            grouped.set(key, {
                credit_note_no: item.credit_note_no,
                credit_note_date: item.credit_note_date,
                return_no: item.return_no,
                original_bill_no: item.original_bill_no,
                original_bill_date: item.original_bill_date,
                gst_rate: item.gst_rate,
                taxable_reversal_paise: 0,
                cgst_reversal_paise: 0,
                sgst_reversal_paise: 0,
                gst_reversal_paise: 0,
                net_reversal_paise: 0
            });
        }

        const row = grouped.get(key);
        row.taxable_reversal_paise += toPaise(item.taxable_reversal);
        row.cgst_reversal_paise += toPaise(item.cgst_reversal);
        row.sgst_reversal_paise += toPaise(item.sgst_reversal);
        row.gst_reversal_paise += toPaise(item.gst_reversal);
        row.net_reversal_paise += toPaise(item.net_reversal);

        for (const value of [
            row.taxable_reversal_paise,
            row.cgst_reversal_paise,
            row.sgst_reversal_paise,
            row.gst_reversal_paise,
            row.net_reversal_paise
        ]) {
            if (!Number.isSafeInteger(value)) {
                throw new Error("Credit Note GST report total exceeds safe limits.");
            }
        }
    }

    return Array.from(grouped.values()).map(row => ({
        credit_note_no: row.credit_note_no,
        credit_note_date: row.credit_note_date,
        return_no: row.return_no,
        original_bill_no: row.original_bill_no,
        original_bill_date: row.original_bill_date,
        gst_rate: row.gst_rate,
        taxable_reversal: fromPaise(row.taxable_reversal_paise),
        cgst_reversal: fromPaise(row.cgst_reversal_paise),
        sgst_reversal: fromPaise(row.sgst_reversal_paise),
        gst_reversal: fromPaise(row.gst_reversal_paise),
        net_reversal: fromPaise(row.net_reversal_paise)
    }));

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

    const [data, creditNoteItems] =
        await Promise.all([
            getBusinessReport(
            request.fromDate,
            request.toDate
            ),
            getCompletedCreditNoteItems(
                request.fromDate,
                request.toDate
            )
        ]);

    return await exportBusinessReport(
        data,
        creditNoteItems,
        filePath,
        request.fromDate,
        request.toDate
    );

}

        case "gst": {

            const [data, creditNoteItems] =
                await Promise.all([
                    getGSTReport(
                    request.fromDate,
                    request.toDate
                    ),
                    getCompletedCreditNoteItems(
                        request.fromDate,
                        request.toDate
                    )
                ]);

            return await exportGSTReport(
    data,
    groupCreditNoteGSTReversals(creditNoteItems),
    filePath,
    request.fromDate,
    request.toDate
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
    filePath,
    request.fromDate,
    request.toDate
);

        }

        case "customer": {

    const data =
        await getCustomerPurchaseReport(
            request.fromDate,
            request.toDate
        );

    return await exportCustomerPurchaseReport(
    data,
    filePath,
    request.fromDate,
    request.toDate
);

}

        default:

            throw new Error(
                "Invalid Report Type"
            );

    }

}

async function getCustomerPurchaseReport(fromDate, toDate) {

    return new Promise((resolve, reject) => {

        const sql = `

            SELECT

                b.customer_name,

                b.customer_mobile,

                COUNT(*) AS total_bills,

                SUM(q.total_qty) AS quantity_purchased,

                ROUND(SUM(b.net_amount), 2) AS total_purchase,

                ROUND(AVG(b.net_amount), 2) AS average_bill,

                MIN(b.bill_date) AS first_purchase,

                MAX(b.bill_date) AS last_purchase

                FROM bills b

                INNER JOIN (

                    SELECT

                        bill_no,

                        SUM(qty) AS total_qty

                    FROM bill_items

                    GROUP BY bill_no

                ) q

                ON b.bill_no = q.bill_no

                WHERE

                DATE(b.bill_date) BETWEEN ? AND ?

                AND TRIM(IFNULL(b.customer_name,'')) <> ''

                AND TRIM(IFNULL(b.customer_mobile,'')) <> ''

                GROUP BY

                b.customer_name,
                b.customer_mobile

                ORDER BY

                total_purchase DESC,
                total_bills DESC;
        `;

        db.all(

            sql,

            [

                fromDate,

                toDate

            ],

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

module.exports = {

    exportReport,

    getBusinessReport,

    getGSTReport,

    getCompletedCreditNoteItems,

    groupCreditNoteGSTReversals,

    getProductSalesReport,

    getCustomerPurchaseReport

};
