const db = require("./database");

const { sendEmail } =
    require("../services/emailService");

const {
    createBackup,
    validateBackup
} = require("../services/backupService");

const {
    logBusinessDayClosed
} = require("./logService");

/* ===========================================
   GET DAY CLOSING SUMMARY
=========================================== */

async function getDayClosingSummary() {

    return new Promise((resolve, reject) => {

        db.get(

            `
            SELECT

                COUNT(*) AS totalBills,

                COALESCE(
                    SUM(total_qty),
                    0
                ) AS totalItems,

                COALESCE(
                    SUM(gross_amount),
                    0
                ) AS grossSales,

                COALESCE(
                    SUM(discount_amount),
                    0
                ) AS totalDiscount,

                COALESCE(
                    SUM(gst_amount),
                    0
                ) AS totalGST,

                COALESCE(
                    SUM(net_amount),
                    0
                ) AS netSales,

                COALESCE(
                    SUM(cash_amount),
                    0
                ) AS cashSales,

                COALESCE(
                    SUM(upi_amount),
                    0
                ) AS upiSales,

                COALESCE(
                    SUM(card_amount),
                    0
                ) AS cardSales

            FROM bills

            WHERE DATE(bill_date) =
                  DATE('now','localtime')
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
   CLOSE BUSINESS DAY
=========================================== */

async function closeBusinessDay() {

    const businessDate = new Date()
        .toLocaleDateString(
            "en-CA"
        );


    /*
     * CHECK WHETHER TODAY IS ALREADY CLOSED
     */

    const existingClosure =
        await isBusinessDayClosed();


    if (existingClosure) {

        return {

            success: false,

            alreadyClosed: true,

            businessDate:
                existingClosure.business_date,

            closedAt:
                existingClosure.closed_at,

            closedBy:
                existingClosure.closed_by

        };

    }


    const closedAt =
        new Date().toISOString();

    const summary =
        await getDayClosingSummary();

    return new Promise((resolve, reject) => {

        db.run(
            `
            INSERT INTO day_closing
            (
                business_date,
                closed_at,
                total_bills,
                total_items,
                net_sales,
                cash_sales,
                upi_sales,
                card_sales,
                backup_status,
                email_status,
                closed_by
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 'PENDING', 'Administrator')
            `,

            [
                businessDate,
                closedAt,
                summary.totalBills || 0,
                summary.totalItems || 0,
                summary.netSales || 0,
                summary.cashSales || 0,
                summary.upiSales || 0,
                summary.cardSales || 0
            ],

            async function (error) {

                if (error) {

                    reject(error);

                    return;

                }

                try {

                    const backup =
                        await createBackup();

                    const verification =
                        await validateBackup(
                            backup.backupFilePath
                        );

                    if (!verification.success) {

                        throw new Error(
                            verification.message ||
                            "Backup verification failed."
                        );

                    }

/* ===========================================
   SEND DAY CLOSING EMAIL
=========================================== */

let emailStatus = "FAILED";

try {

    await sendEmail({

        to:
            process.env.DAY_CLOSING_EMAIL,

        subject:
            `KAIRA LUXE - Day Closing - ${businessDate}`,

        text:
            `
KAIRA LUXE
Business Day Closing Report

Business Date: ${businessDate}
Closed At: ${closedAt}

Total Bills: ${summary.totalBills || 0}
Total Items: ${summary.totalItems || 0}

Net Sales: ₹${(summary.netSales || 0).toFixed(2)}
Cash Sales: ₹${(summary.cashSales || 0).toFixed(2)}
UPI Sales: ₹${(summary.upiSales || 0).toFixed(2)}
Card Sales: ₹${(summary.cardSales || 0).toFixed(2)}

Backup: ${backup.backupFileName}

The business day has been successfully closed.
            `,

        attachments: [

            {
                filename:
                    backup.backupFileName,

                path:
                    backup.backupFilePath

            }

        ]

    });

    emailStatus = "SUCCESS";

    console.log(
        "✓ Day Closing email sent successfully."
    );

}

catch (emailError) {

    console.error(
        "✗ Day Closing email failed:",
        emailError.message
    );

}

                    db.run(
    `
    UPDATE day_closing
SET
    backup_status = 'SUCCESS',
    email_status = ?
WHERE id = ?
    `,

    [emailStatus, this.lastID],

    async error => {

    if (error) {

        reject(error);

        return;

    }

    /*
     * RECORD ACTIVITY LOG
     */

    try {

        await logBusinessDayClosed(
            businessDate
        );

    }

    catch (activityError) {

        console.error(
            "Day Closing Activity Log Error:",
            activityError
        );

    }


    resolve({

    success: true,

    backupStatus:
        "SUCCESS",

    emailStatus:
        emailStatus,

    backupFileName:
        backup.backupFileName,

    backupFilePath:
        backup.backupFilePath,

    businessDate,

    closedAt

});

                        }

                    );

                }

                catch (backupError) {

                    db.run(
                        `
                        UPDATE day_closing
                        SET backup_status = 'FAILED',
                            remarks = ?
                        WHERE id = ?
                        `,

                        [
                            backupError.message,
                            this.lastID
                        ],

                        () => {

                            reject(
                                backupError
                            );

                        }

                    );

                }

            }

        );

    });

}


/* ===========================================
   CHECK WHETHER TODAY IS ALREADY CLOSED
=========================================== */

async function isBusinessDayClosed() {

    return new Promise((resolve, reject) => {

        db.get(

            `
            SELECT
                id,
                business_date,
                closed_at,
                closed_by

            FROM day_closing

            WHERE business_date =
                  strftime(
                      '%Y-%m-%d',
                      'now',
                      'localtime'
                  )

            LIMIT 1
            `,

            [],

            (error, row) => {

                if (error) {

                    return reject(error);

                }

                resolve(row || null);

            }

        );

    });

}

/* ===========================================
   MODULE EXPORTS
=========================================== */

module.exports = {

    getDayClosingSummary,

    closeBusinessDay,

    isBusinessDayClosed

};