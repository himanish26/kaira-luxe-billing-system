const db = require("./database");

const {
    getBusinessDate,
    addBusinessCalendarDays
} = require("./businessDate");

function normalizeOriginalBillNo(value) {

    return String(value || "")
        .trim()
        .toUpperCase();

}

function mapReturnDatabaseError(error) {

    const message =
        error && error.message
            ? error.message
            : String(error || "");

    if (
        message.includes(
            "KLBS_RETURN_ALREADY_COMPLETED"
        )
    ) {
        return new Error(
            "RETURN COMPLETED / FURTHER RETURNS NOT ALLOWED\n\n" +
            "This original bill has already been returned."
        );
    }

    if (
        message.includes(
            "KLBS_RETURN_ORIGINAL_BILL_REQUIRED"
        )
    ) {
        return new Error(
            "Original bill number is required for a return."
        );
    }

    if (
        message.includes(
            "KLBS_RETURN_ORIGINAL_BILL_IMMUTABLE"
        )
    ) {
        return new Error(
            "Return integrity error: the original bill reference cannot be changed."
        );
    }

    return error;

}


/* ===========================================
   GET BILL FOR RETURN
=========================================== */

function getBillForReturn(billNo) {

    return new Promise((resolve, reject) => {

        const canonicalBillNo =
            normalizeOriginalBillNo(billNo);

        if (!canonicalBillNo) {
            resolve(null);
            return;
        }

        db.get(

            `
            SELECT *
            FROM bills
            WHERE UPPER(TRIM(bill_no)) = ?
            LIMIT 1
            `,

            [canonicalBillNo],

            (err, bill) => {

                if (err) {

                    reject(err);
                    return;

                }

                if (!bill) {

                    resolve(null);
                    return;

                }

                /*
                ============================================
                CHECK WHETHER THIS BILL HAS ALREADY
                BEEN RETURNED

                LOCKED RULE:
                ONE BILL CAN HAVE ONLY ONE RETURN
                ============================================
                */

                db.get(

                    `
                    SELECT
                        return_no,
                        created_at
                    FROM returns
                    WHERE
                        UPPER(TRIM(original_bill_no)) =
                        UPPER(TRIM(?))
                    ORDER BY id DESC
                    LIMIT 1
                    `,

                    [bill.bill_no],

                    (returnErr, existingReturn) => {

                        if (returnErr) {

                            reject(returnErr);
                            return;

                        }

                        if (existingReturn) {

                            resolve({

                                alreadyReturned: true,

                                return_no:
                                    existingReturn.return_no,

                                returned_at:
                                    existingReturn.created_at,

                                bill: null,

                                items: []

                            });

                            return;

                        }

                        /*
                        ========================================
                        BILL HAS NOT BEEN RETURNED
                        LOAD RETURNABLE ITEMS
                        ========================================
                        */

                        db.all(

                            `
                            SELECT
                                bi.*,

                                0 AS already_returned_qty

                            FROM bill_items bi

                            WHERE bi.bill_no = ?

                            ORDER BY bi.id ASC
                            `,

                            [bill.bill_no],

                            (itemsErr, items) => {

                                if (itemsErr) {

                                    reject(itemsErr);
                                    return;

                                }

                                resolve({

                                    alreadyReturned: false,

                                    bill,

                                    items

                                });

                            }

                        );

                    }

                );

            }

        );

    });

}


/* ===========================================
   GET NEXT RETURN NUMBER
=========================================== */

function getNextReturnNumber() {

    return new Promise((resolve, reject) => {

        const today = new Date();

        const dd =
            String(today.getDate()).padStart(2, "0");

        const mm =
            String(today.getMonth() + 1).padStart(2, "0");

        const yy =
            String(today.getFullYear()).slice(-2);


        const prefix =
            `RT${dd}${mm}${yy}`;


        db.get(

            `
            SELECT return_no
            FROM returns

            WHERE return_no LIKE ?

            ORDER BY return_no DESC

            LIMIT 1
            `,

            [`${prefix}%`],

            (err, row) => {

                if (err) {

                    reject(err);
                    return;

                }


                let next = 1;


                if (row) {

                    next =
                        Number(
                            row.return_no.slice(-3)
                        ) + 1;

                }


                resolve(

                    prefix +
                    String(next).padStart(3, "0")

                );

            }

        );

    });

}

/* ===========================================
   GET NEXT STORE CREDIT NUMBER
=========================================== */

function getNextStoreCreditNumber() {

    return new Promise((resolve, reject) => {

        const today = new Date();

        const dd =
            String(today.getDate()).padStart(2, "0");

        const mm =
            String(today.getMonth() + 1).padStart(2, "0");

        const yy =
            String(today.getFullYear()).slice(-2);

        const prefix =
            `SC${dd}${mm}${yy}`;

        db.get(

            `
            SELECT store_credit_no
            FROM store_credits

            WHERE store_credit_no LIKE ?

            ORDER BY store_credit_no DESC
            LIMIT 1
            `,

            [`${prefix}%`],

            (err, row) => {

                if (err) {

                    reject(err);
                    return;

                }

                let next = 1;

                if (row) {

                    next =
                        Number(
                            row.store_credit_no.slice(-3)
                        ) + 1;

                }

                resolve(

                    prefix +
                    String(next).padStart(3, "0")

                );

            }

        );

    });

}


/* ===========================================
   SAVE RETURN
=========================================== */

function saveReturn(returnData) {

    return new Promise((resolve, reject) => {

        const canonicalBillNo =
            normalizeOriginalBillNo(
                returnData.original_bill_no
            );

        if (!canonicalBillNo) {
            reject(
                new Error(
                    "Original bill number is required for a return."
                )
            );
            return;
        }

        db.get(
            `
            SELECT bill_no
            FROM bills
            WHERE UPPER(TRIM(bill_no)) = ?
            LIMIT 1
            `,
            [canonicalBillNo],
            (billErr, authoritativeBill) => {

                if (billErr) {
                    reject(billErr);
                    return;
                }

                if (!authoritativeBill) {
                    reject(
                        new Error(
                            "Original bill not found."
                        )
                    );
                    return;
                }

                const authoritativeBillNo =
                    authoritativeBill.bill_no;

        db.serialize(() => {

            db.run(
                "BEGIN IMMEDIATE TRANSACTION",
                beginErr => {

                    if (beginErr) {
                        reject(beginErr);
                        return;
                    }

            db.get(
                `
                SELECT
                    return_no
                FROM returns
                WHERE
                    UPPER(TRIM(original_bill_no)) =
                    UPPER(TRIM(?))
                LIMIT 1
                `,
                [
                    authoritativeBillNo
                ],
                (checkErr, existingReturn) => {

                    if (checkErr) {

                        db.run("ROLLBACK");
                        reject(checkErr);
                        return;

                    }

                    /*
                    ============================================
                    HARD LOCK
                    ONE ORIGINAL BILL CAN HAVE ONLY ONE RETURN
                    ============================================
                    */

                    if (existingReturn) {

                        db.run("ROLLBACK");

                        reject(
                            new Error(
                                "RETURN COMPLETED / FURTHER RETURNS NOT ALLOWED\n\n" +
                                "This original bill has already been returned.\n\n" +
                                "Return No: " +
                                existingReturn.return_no
                            )
                        );

                        return;

                    }

                    db.run(
                        `
                        INSERT INTO returns
                        (
                            return_no,
                            original_bill_no,
                            customer_id,
                            customer_name,
                            customer_mobile,
                            return_reason,
                            remarks,
                            return_amount,
                            created_by,
                            created_at
                        )

                        VALUES
                        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `,
                        [
                            returnData.return_no,
                            authoritativeBillNo,
                            returnData.customer_id || null,
                            returnData.customer_name,
                            returnData.customer_mobile,
                            returnData.return_reason,
                            returnData.remarks || "",
                            returnData.return_amount,
                            returnData.created_by ||
                                "Administrator",
                            new Date().toISOString()
                        ],
                        function(err) {

                            if (err) {

                                db.run(
                                    "ROLLBACK",
                                    rollbackErr => {

                                        if (rollbackErr) {
                                            console.error(
                                                "Return rollback failed:",
                                                rollbackErr.message
                                            );
                                        }

                                        reject(
                                            mapReturnDatabaseError(
                                                err
                                            )
                                        );

                                    }
                                );
                                return;

                            }

                            const returnId =
                                this.lastID;

                            let pending =
                                returnData.items.length;

                            if (pending === 0) {

                                db.run("ROLLBACK");

                                reject(
                                    new Error(
                                        "No return items selected."
                                    )
                                );

                                return;

                            }

                            let failed = false;

                            returnData.items.forEach(
                                item => {

                                    db.run(
                                        `
                                        INSERT INTO return_items
                                        (
                                            return_id,
                                            product_id,
                                            barcode,
                                            product_name,
                                            original_bill_item_id,
                                            quantity,
                                            unit_value,
                                            return_value,
                                            remarks,
                                            created_at
                                        )

                                        VALUES
                                        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                                        `,
                                        [
                                            returnId,
                                            item.product_id || null,
                                            item.barcode || "",
                                            item.product_name || "",
                                            item.original_bill_item_id,
                                            item.quantity,
                                            item.unit_value,
                                            item.return_value,
                                            item.remarks || "",
                                            new Date().toISOString()
                                        ],
                                        function(itemErr) {

                                            if (failed) {

                                                return;

                                            }

                                            if (itemErr) {

                                                failed = true;

                                                db.run(
                                                    "ROLLBACK"
                                                );

                                                reject(itemErr);

                                                return;

                                            }

                                            pending--;

                                            if (pending !== 0) {

                                                return;

                                            }

                                            getNextStoreCreditNumber()

                                                .then(
                                                    storeCreditNo => {

                                                        const issueDateText =
                                                            getBusinessDate();

                                                        const validUntilText =
                                                            addBusinessCalendarDays(
                                                                issueDateText,
                                                                180
                                                            );

                                                        db.run(
                                                            `
                                                            INSERT INTO store_credits
                                                            (
                                                                store_credit_no,
                                                                return_id,
                                                                original_bill_no,
                                                                customer_id,
                                                                customer_name,
                                                                customer_mobile,
                                                                issue_date,
                                                                valid_until,
                                                                original_amount,
                                                                remaining_balance,
                                                                status,
                                                                created_by,
                                                                created_at
                                                            )

                                                            VALUES
                                                            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                                                            `,
                                                            [
                                                                storeCreditNo,
                                                                returnId,
                                                                authoritativeBillNo,
                                                                returnData.customer_id || null,
                                                                returnData.customer_name,
                                                                returnData.customer_mobile,
                                                                issueDateText,
                                                                validUntilText,
                                                                returnData.return_amount,
                                                                returnData.return_amount,
                                                                "ISSUED",
                                                                returnData.created_by ||
                                                                    "Administrator",
                                                                new Date().toISOString()
                                                            ],
                                                            function(
                                                                storeCreditErr
                                                            ) {

                                                                if (
                                                                    storeCreditErr
                                                                ) {

                                                                    db.run(
                                                                        "ROLLBACK"
                                                                    );

                                                                    reject(
                                                                        storeCreditErr
                                                                    );

                                                                    return;

                                                                }

                                                                db.run(
                                                                    "COMMIT",
                                                                    commitErr => {

                                                                        if (
                                                                            commitErr
                                                                        ) {

                                                                            db.run(
                                                                                "ROLLBACK"
                                                                            );

                                                                            reject(
                                                                                commitErr
                                                                            );

                                                                            return;

                                                                        }

                                                                        resolve({
                                                                            success: true,

                                                                            return_id:
                                                                                returnId,

                                                                            return_no:
                                                                                returnData.return_no,

                                                                            store_credit_no:
                                                                                storeCreditNo,

                                                                            valid_until:
                                                                                validUntilText
                                                                        });

                                                                    }
                                                                );

                                                            }
                                                        );

                                                    }
                                                )

                                                .catch(error => {

                                                    db.run(
                                                        "ROLLBACK"
                                                    );

                                                    reject(error);

                                                });

                                        }
                                    );

                                }
                            );

                        }
                    );

                }
            );

                }
            );

        });

            }
        );

    });

}

/* ===========================================
   GET STORE CREDIT DETAILS
=========================================== */

function getStoreCreditDetails(storeCreditNo) {

    return new Promise((resolve, reject) => {

        db.get(

            `
            SELECT

                sc.store_credit_no,

                r.return_no,

                sc.original_bill_no,

                sc.customer_name,

                sc.customer_mobile,

                sc.issue_date,

                sc.valid_until,

                sc.original_amount,

                sc.status

            FROM store_credits sc

            INNER JOIN returns r
                ON r.id = sc.return_id

            WHERE sc.store_credit_no = ?
            `,

            [storeCreditNo],

            (err, row) => {

                if (err) {

                    reject(err);

                    return;

                }

                if (!row) {

                    resolve(null);

                    return;

                }

                const today = getBusinessDate();

                if (

                    row.status === "ISSUED" &&

                    row.valid_until < today

                ) {

                    db.run(

                        `
                        UPDATE store_credits
                        SET status = 'EXPIRED'
                        WHERE store_credit_no = ?
                        `,

                        [storeCreditNo],

                        updateErr => {

                            if (updateErr) {

                                reject(updateErr);

                                return;

                            }

                            row.status =
                                "EXPIRED";

                            resolve(row);

                        }

                    );

                    return;

                }

                resolve(row);

            }

        );

    });

}

/* ===========================================
   GET AVAILABLE STORE CREDIT BY MOBILE
=========================================== */

function getAvailableStoreCreditByMobile(
    customerMobile
) {

    return new Promise((resolve, reject) => {

        const today = getBusinessDate();

        db.get(

            `
            SELECT
                sc.store_credit_no,
                sc.customer_name,
                sc.customer_mobile,
                sc.issue_date,
                sc.valid_until,
                sc.original_amount,
                sc.remaining_balance,
                sc.status

            FROM store_credits sc

            WHERE
                sc.customer_mobile = ?
                AND sc.status = 'ISSUED'
                AND sc.remaining_balance > 0
                AND sc.valid_until >= ?

            ORDER BY
                sc.issue_date ASC,
                sc.id ASC

            LIMIT 1
            `,

            [
                customerMobile,
                today
            ],

            (err, row) => {

                if (err) {

                    reject(err);
                    return;

                }

                resolve(row || null);

            }

        );

    });

}

/* ===========================================
   GET STORE CREDIT FOR REPRINT
=========================================== */

function getStoreCreditForReprint(storeCreditNo) {

    const today = getBusinessDate();

    return new Promise((resolve, reject) => {

        db.get(

            `
            SELECT

                sc.store_credit_no,

                r.return_no,

                sc.original_bill_no,

                sc.customer_name,

                sc.customer_mobile,

                sc.issue_date,

                sc.valid_until,

                sc.original_amount,

                sc.status

            FROM store_credits sc

            LEFT JOIN returns r
                ON r.id = sc.return_id

            WHERE
                sc.store_credit_no = ?
                AND sc.status = 'ISSUED'
                AND sc.valid_until >= ?
            `,

            [
                storeCreditNo,
                today
            ],

            (err, row) => {

                if (err) {

                    reject(err);
                    return;

                }

                resolve(row || null);

            }

        );

    });

}

/* ===========================================
   GET RETURN DETAILS
=========================================== */

function getReturnDetails(returnNo) {

    return new Promise((resolve, reject) => {

        db.get(

            `
            SELECT
                r.return_no,
                r.original_bill_no,
                r.customer_name,
                r.customer_mobile,
                r.return_reason,
                r.remarks,
                r.return_amount,
                r.created_by,
                r.created_at,

sc.store_credit_no,
sc.status AS store_credit_status,
sc.issue_date,
sc.valid_until

            FROM returns r

            LEFT JOIN store_credits sc
                ON sc.return_id = r.id

            WHERE r.return_no = ?
            `,

            [
                returnNo
            ],

            (err, returnRow) => {

                if (err) {

                    reject(err);
                    return;

                }

                if (!returnRow) {

                    resolve(null);
                    return;

                }

                db.all(

                    `
                    SELECT
                        product_id,
                        barcode,
                        product_name,
                        quantity,
                        unit_value,
                        return_value,
                        remarks

                    FROM return_items

                    WHERE return_id = (
                        SELECT id
                        FROM returns
                        WHERE return_no = ?
                    )

                    ORDER BY id ASC
                    `,

                    [
                        returnNo
                    ],

                    (itemErr, items) => {

                        if (itemErr) {

                            reject(itemErr);
                            return;

                        }

                        resolve({

                            ...returnRow,

                            items: items || []

                        });

                    }

                );

            }

        );

    });

}

module.exports = {

    getBillForReturn,

    getNextReturnNumber,

    getNextStoreCreditNumber,

    saveReturn,

    getStoreCreditDetails,

    getAvailableStoreCreditByMobile,

    getStoreCreditForReprint,

    getReturnDetails

};
