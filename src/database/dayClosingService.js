const db = require("./database");

/* ===========================================
   GET DAY CLOSING SUMMARY
=========================================== */

async function getDayClosingSummary() {

    return new Promise((resolve, reject) => {

        db.get(

            `
            SELECT

                COUNT(*)                       AS totalBills,

                COALESCE(SUM(total_qty),0)     AS totalItems,

                COALESCE(SUM(gross_amount),0)  AS grossSales,

                COALESCE(SUM(discount_amount),0)      AS totalDiscount,

                COALESCE(SUM(gst_amount),0)    AS totalGST,

                COALESCE(SUM(net_amount),0)    AS netSales,

                COALESCE(SUM(cash_amount),0)   AS cashSales,

                COALESCE(SUM(upi_amount),0)    AS upiSales,

                COALESCE(SUM(card_amount),0)   AS cardSales

            FROM bills

            WHERE DATE(bill_date) = DATE('now','localtime')
            `,

            [],

            (error, row) => {

                if (error) {

                    return reject(error);

                }

                resolve(row);

            }

        );

    });

}

/* ===========================================
   MODULE EXPORTS
=========================================== */

module.exports = {

    getDayClosingSummary

};