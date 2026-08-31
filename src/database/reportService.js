const db = require("./database");

const {

    exportBusinessReport,

    exportGSTReport,

    exportProductSalesReport,

    exportCustomerPurchaseReport,

    exportBillSummaryReport

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

async function getProductBillSideReport(fromDate, toDate) {

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

                bi.qty AS qty_sold,

                ROUND(
                    bi.mrp * bi.qty,
                    2
                ) AS gross_sales,

                ROUND(
                    bi.discount_amount,
                    2
                ) AS discount_amount,

                ROUND(
                    bi.taxable_amount,
                    2
                ) AS taxable_value,

                ROUND(
                    bi.gst_amount,
                    2
                ) AS gst_amount,

                ROUND(
                    bi.net_amount,
                    2
                ) AS net_sales

            FROM bill_items bi

            LEFT JOIN products p

                ON bi.barcode = p.barcode

            INNER JOIN bills b

                ON bi.bill_no = b.bill_no

            WHERE DATE(b.bill_date)

                BETWEEN ? AND ?

            ORDER BY

                bi.id;

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

function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (error, rows) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(rows || []);
        });
    });
}

function addSafeInteger(current, addition, message) {
    const result = current + addition;
    if (!Number.isSafeInteger(result)) {
        throw new Error(message);
    }
    return result;
}

function productKey(row) {
    return JSON.stringify([
        String(row.barcode || "").trim().toUpperCase(),
        String(row.brand || ""),
        String(row.product_name || ""),
        String(row.style_code || ""),
        String(row.colour || ""),
        String(row.size || ""),
        String(row.category || "")
    ]);
}

function createProductRow(row) {
    return {
        barcode: row.barcode || "",
        brand: row.brand || "",
        product_name: row.product_name || "",
        style_code: row.style_code || "",
        colour: row.colour || "",
        size: row.size || "",
        category: row.category || "",
        qty_sold: 0,
        qty_returned: 0,
        gross_sales_paise: 0,
        discount_amount_paise: 0,
        taxable_value_paise: 0,
        gst_amount_paise: 0,
        net_sales_paise: 0,
        return_cn_value_paise: 0
    };
}

function mergeProductReportData(salesRows, creditRows) {
    const grouped = new Map();
    let expectedNetPaise = 0;

    for (const item of salesRows) {
        const key = productKey(item);
        if (!grouped.has(key)) grouped.set(key, createProductRow(item));
        const row = grouped.get(key);
        row.qty_sold = addSafeInteger(
            row.qty_sold, Number(item.qty_sold || 0),
            "Product report quantity exceeds safe limits."
        );
        for (const [target, source] of [
            ["gross_sales_paise", "gross_sales"],
            ["discount_amount_paise", "discount_amount"],
            ["taxable_value_paise", "taxable_value"],
            ["gst_amount_paise", "gst_amount"],
            ["net_sales_paise", "net_sales"]
        ]) {
            row[target] = addSafeInteger(
                row[target], toPaise(item[source]),
                "Product report monetary total exceeds safe limits."
            );
        }
        expectedNetPaise = addSafeInteger(
            expectedNetPaise, toPaise(item.net_sales),
            "Product report reconciliation total exceeds safe limits."
        );
    }

    for (const item of creditRows) {
        const key = productKey(item);
        if (!grouped.has(key)) grouped.set(key, createProductRow(item));
        const row = grouped.get(key);
        row.qty_returned = addSafeInteger(
            row.qty_returned, Number(item.quantity_returned || 0),
            "Product report returned quantity exceeds safe limits."
        );
        const reversalPaise = toPaise(item.net_reversal);
        row.return_cn_value_paise = addSafeInteger(
            row.return_cn_value_paise, reversalPaise,
            "Product report Credit Note total exceeds safe limits."
        );
        expectedNetPaise = addSafeInteger(
            expectedNetPaise, -reversalPaise,
            "Product report reconciliation total exceeds safe limits."
        );
    }

    const rows = Array.from(grouped.values()).map(row => ({
        barcode: row.barcode,
        brand: row.brand,
        product_name: row.product_name,
        style_code: row.style_code,
        colour: row.colour,
        size: row.size,
        category: row.category,
        qty_sold: row.qty_sold,
        qty_returned: row.qty_returned,
        net_qty_sold: row.qty_sold - row.qty_returned,
        gross_sales: fromPaise(row.gross_sales_paise),
        discount_amount: fromPaise(row.discount_amount_paise),
        taxable_value: fromPaise(row.taxable_value_paise),
        gst_amount: fromPaise(row.gst_amount_paise),
        net_sales: fromPaise(row.net_sales_paise),
        return_cn_value: fromPaise(row.return_cn_value_paise),
        net_sales_after_returns: fromPaise(
            row.net_sales_paise - row.return_cn_value_paise
        )
    }));

    const actualNetPaise = rows.reduce(
        (total, row) => addSafeInteger(
            total, toPaise(row.net_sales_after_returns),
            "Product report reconciliation total exceeds safe limits."
        ),
        0
    );
    if (actualNetPaise !== expectedNetPaise) {
        throw new Error("Product report Credit Note reconciliation failed.");
    }

    return rows.sort((a, b) =>
        b.qty_sold - a.qty_sold || b.net_sales - a.net_sales
    );
}

async function getProductSalesReport(fromDate, toDate) {
    const creditSql = `
        SELECT
            COALESCE(obi.barcode, ri.barcode) AS barcode,
            COALESCE(obi.brand, '') AS brand,
            COALESCE(obi.product_name, ri.product_name, '') AS product_name,
            p.style_code,
            COALESCE(obi.colour, '') AS colour,
            COALESCE(obi.size, '') AS size,
            COALESCE(obi.category, '') AS category,
            ri.quantity AS quantity_returned,
            ri.net_reversal
        FROM returns r
        INNER JOIN return_items ri ON ri.return_id = r.id
        LEFT JOIN bill_items obi ON obi.id = ri.original_bill_item_id
        LEFT JOIN products p ON p.barcode = COALESCE(obi.barcode, ri.barcode)
        WHERE r.accounting_status = 'COMPLETED'
          AND r.credit_note_no IS NOT NULL
          AND TRIM(r.credit_note_no) <> ''
          AND r.accounting_snapshot_version = 1
          AND DATE(r.business_date) BETWEEN ? AND ?
        ORDER BY r.business_date, UPPER(TRIM(r.credit_note_no)), ri.id
    `;
    const [salesRows, creditRows] = await Promise.all([
        getProductBillSideReport(fromDate, toDate),
        all(creditSql, [fromDate, toDate])
    ]);
    return mergeProductReportData(salesRows, creditRows);
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

        case "billSummary": {

            const data = await getBillSummaryReport(
                request.fromDate,
                request.toDate
            );

            return await exportBillSummaryReport(
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

async function getCustomerBillSideReport(fromDate, toDate) {

    return new Promise((resolve, reject) => {

        const sql = `

            SELECT

                COALESCE((
                    SELECT candidate.customer_name
                    FROM bills candidate
                    WHERE TRIM(IFNULL(candidate.customer_mobile, '')) =
                          TRIM(IFNULL(b.customer_mobile, ''))
                      AND DATE(candidate.bill_date) BETWEEN ? AND ?
                      AND TRIM(IFNULL(candidate.customer_name, '')) <> ''
                    ORDER BY
                        DATE(candidate.bill_date) DESC,
                        candidate.id DESC
                    LIMIT 1
                ), '') AS customer_name,

                TRIM(b.customer_mobile) AS customer_mobile,

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

                AND TRIM(IFNULL(b.customer_mobile,'')) <> ''

                GROUP BY
                TRIM(b.customer_mobile)

                ORDER BY

                total_purchase DESC,
                total_bills DESC;
        `;

        db.all(

            sql,

            [

                fromDate,

                toDate,

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

function customerKey(row) {
    return String(
        row.customer_mobile || ""
    ).trim();
}

function createCustomerRow(row) {
    return {
        customer_name: row.customer_name || "",
        customer_mobile: row.customer_mobile || "",
        total_bills: 0,
        quantity_purchased: 0,
        total_purchase_paise: 0,
        average_bill_paise: 0,
        first_purchase: null,
        last_purchase: null,
        quantity_returned: 0,
        return_cn_value_paise: 0
    };
}

function mergeCustomerReportData(salesRows, creditRows) {
    const grouped = new Map();
    const unattributable = {
        item_count: 0,
        quantity_returned: 0,
        return_cn_value_paise: 0
    };

    for (const item of salesRows) {
        const key = customerKey(item);
        const row = createCustomerRow(item);
        row.total_bills = Number(item.total_bills || 0);
        row.quantity_purchased = Number(item.quantity_purchased || 0);
        row.total_purchase_paise = toPaise(item.total_purchase);
        row.average_bill_paise = toPaise(item.average_bill);
        row.first_purchase = item.first_purchase || null;
        row.last_purchase = item.last_purchase || null;
        grouped.set(key, row);
    }

    for (const item of creditRows) {
        const hasCustomer =
            String(item.customer_mobile || "").trim() !== "";
        const quantity = Number(item.quantity_returned || 0);
        const reversalPaise = toPaise(item.net_reversal);

        if (!hasCustomer || !item.original_bill_id) {
            unattributable.item_count = addSafeInteger(
                unattributable.item_count, 1,
                "Customer report unattributable item count exceeds safe limits."
            );
            unattributable.quantity_returned = addSafeInteger(
                unattributable.quantity_returned, quantity,
                "Customer report unattributable quantity exceeds safe limits."
            );
            unattributable.return_cn_value_paise = addSafeInteger(
                unattributable.return_cn_value_paise, reversalPaise,
                "Customer report unattributable value exceeds safe limits."
            );
            continue;
        }

        const key = customerKey(item);
        if (!grouped.has(key)) grouped.set(key, createCustomerRow(item));
        const row = grouped.get(key);
        row.quantity_returned = addSafeInteger(
            row.quantity_returned, quantity,
            "Customer report returned quantity exceeds safe limits."
        );
        row.return_cn_value_paise = addSafeInteger(
            row.return_cn_value_paise, reversalPaise,
            "Customer report Credit Note total exceeds safe limits."
        );
    }

    const rows = Array.from(grouped.values()).map(row => ({
        customer_name: row.customer_name,
        customer_mobile: row.customer_mobile,
        total_bills: row.total_bills,
        quantity_purchased: row.quantity_purchased,
        total_purchase: fromPaise(row.total_purchase_paise),
        average_bill: fromPaise(row.average_bill_paise),
        first_purchase: row.first_purchase,
        last_purchase: row.last_purchase,
        quantity_returned: row.quantity_returned,
        net_quantity_purchased:
            row.quantity_purchased - row.quantity_returned,
        return_cn_value: fromPaise(row.return_cn_value_paise),
        net_purchase_after_returns: fromPaise(
            row.total_purchase_paise - row.return_cn_value_paise
        )
    }));

    rows.sort((a, b) =>
        b.total_purchase - a.total_purchase ||
        b.total_bills - a.total_bills
    );
    rows.unattributable = {
        item_count: unattributable.item_count,
        quantity_returned: unattributable.quantity_returned,
        return_cn_value: fromPaise(unattributable.return_cn_value_paise)
    };
    return rows;
}

async function getCustomerPurchaseReport(fromDate, toDate) {
    const creditSql = `
        SELECT
            ob.id AS original_bill_id,
            ob.customer_name,
            ob.customer_mobile,
            ri.quantity AS quantity_returned,
            ri.net_reversal
        FROM returns r
        INNER JOIN return_items ri ON ri.return_id = r.id
        LEFT JOIN bills ob
          ON UPPER(TRIM(ob.bill_no)) = UPPER(TRIM(r.original_bill_no))
        WHERE r.accounting_status = 'COMPLETED'
          AND r.credit_note_no IS NOT NULL
          AND TRIM(r.credit_note_no) <> ''
          AND r.accounting_snapshot_version = 1
          AND DATE(r.business_date) BETWEEN ? AND ?
        ORDER BY r.business_date, UPPER(TRIM(r.credit_note_no)), ri.id
    `;
    const [salesRows, creditRows] = await Promise.all([
        getCustomerBillSideReport(fromDate, toDate),
        all(creditSql, [fromDate, toDate])
    ]);
    return mergeCustomerReportData(salesRows, creditRows);
}

async function getBillSummaryReport(fromDate, toDate) {
    return all(
        `
        SELECT
            bill_no,
            bill_date,
            bill_time,
            customer_name,
            customer_mobile,
            total_qty,
            gross_amount,
            discount_amount,
            net_amount,
            cash_amount,
            upi_amount,
            card_amount,
            store_credit_amount,
            gift_voucher_amount
        FROM bills
        WHERE DATE(bill_date) BETWEEN ? AND ?
        ORDER BY bill_date, bill_time, bill_no
        `,
        [fromDate, toDate]
    );
}

module.exports = {

    exportReport,

    getBusinessReport,

    getGSTReport,

    getCompletedCreditNoteItems,

    groupCreditNoteGSTReversals,

    getProductSalesReport,

    getCustomerPurchaseReport,

    getBillSummaryReport,

    mergeProductReportData,

    mergeCustomerReportData

};
