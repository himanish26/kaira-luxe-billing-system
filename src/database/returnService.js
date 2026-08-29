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

function resolveReturnItemProducts(
    originalBillNo,
    items
) {

    if (!Array.isArray(items) || items.length === 0) {
        return Promise.reject(
            new Error("No return items selected.")
        );
    }

    return Promise.all(
        items.map(item =>
            new Promise((resolve, reject) => {

                const returnQuantity =
                    Number(item.quantity);

                if (
                    !Number.isFinite(returnQuantity) ||
                    returnQuantity <= 0
                ) {
                    reject(
                        new Error(
                            "Returned quantity must be greater than zero."
                        )
                    );
                    return;
                }

                db.get(
                    `
                    SELECT
                        p.id AS product_id,
                        p.barcode AS barcode,
                        bi.product_name AS product_name
                    FROM bill_items bi
                    INNER JOIN products p
                        ON p.barcode = bi.barcode
                    WHERE bi.id = ?
                      AND bi.bill_no = ?
                    LIMIT 1
                    `,
                    [
                        item.original_bill_item_id,
                        originalBillNo
                    ],
                    (resolveErr, product) => {

                        if (resolveErr) {
                            reject(resolveErr);
                            return;
                        }

                        if (!product) {
                            reject(
                                new Error(
                                    "Unable to resolve the returned product from the original bill."
                                )
                            );
                            return;
                        }

                        resolve({
                            ...item,
                            product_id: product.product_id,
                            barcode: product.barcode,
                            product_name:
                                product.product_name ||
                                item.product_name ||
                                "",
                            quantity: returnQuantity
                        });

                    }
                );

            })
        )
    );

}

function insertReturnItemWithInventory(
    returnId,
    returnNo,
    originalBillNo,
    item,
    createdBy
) {

    return new Promise((resolve, reject) => {

        const createdAt = new Date().toISOString();

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
                item.product_id,
                item.barcode,
                item.product_name,
                item.original_bill_item_id,
                item.quantity,
                item.unit_value,
                item.return_value,
                item.remarks || "",
                createdAt
            ],
            itemErr => {

                if (itemErr) {
                    reject(itemErr);
                    return;
                }

                db.run(
                    `
                    INSERT INTO inventory_transactions
                    (
                        product_id,
                        barcode,
                        transaction_type,
                        quantity,
                        reference_type,
                        reference_id,
                        remarks,
                        created_by,
                        created_at
                    )
                    VALUES
                    (?, ?, 'RETURN', ?, 'RETURN', ?, ?, ?, ?)
                    `,
                    [
                        item.product_id,
                        item.barcode,
                        item.quantity,
                        returnNo,
                        `Return against bill ${originalBillNo}`,
                        createdBy,
                        createdAt
                    ],
                    inventoryErr => {

                        if (inventoryErr) {
                            reject(inventoryErr);
                            return;
                        }

                        resolve();

                    }
                );

            }
        );

    });

}

function normalizeCustomerMobile(value) {

    return String(value || "").trim();

}

function insertReturnCreditLedger(
    customerId,
    storeCreditNo,
    returnNo,
    amount,
    createdBy
) {

    return new Promise((resolve, reject) => {

        db.run(
            `
            INSERT INTO customer_credit_transactions
            (
                customer_id,
                transaction_type,
                amount,
                reference_type,
                reference_id,
                remarks,
                created_by,
                created_at
            )
            VALUES (?, 'RETURN_CREDIT', ?, 'RETURN', ?, ?, ?, ?)
            `,
            [
                customerId || null,
                amount,
                returnNo,
                `Store Credit ${storeCreditNo}`,
                createdBy,
                new Date().toISOString()
            ],
            ledgerErr => {
                if (ledgerErr) {
                    reject(ledgerErr);
                    return;
                }
                resolve();
            }
        );

    });

}

function applyStoreCreditForReturn(
    returnId,
    returnData,
    originalBillNo,
    createdBy
) {

    return new Promise((resolve, reject) => {

        const customerMobile =
            normalizeCustomerMobile(
                returnData.customer_mobile
            );
        const creditAmount =
            Number(returnData.return_amount);
        const businessDate = getBusinessDate();

        if (!customerMobile) {
            reject(
                new Error(
                    "Customer mobile number is required for Store Credit."
                )
            );
            return;
        }

        if (
            !Number.isFinite(creditAmount) ||
            creditAmount <= 0
        ) {
            reject(
                new Error(
                    "Store Credit amount must be greater than zero."
                )
            );
            return;
        }

        db.get(
            `
            SELECT
                id,
                store_credit_no,
                customer_id,
                issue_date,
                valid_until,
                original_amount,
                remaining_balance
            FROM store_credits
            WHERE TRIM(customer_mobile) = ?
              AND status = 'ISSUED'
              AND remaining_balance > 0
              AND valid_until >= ?
            ORDER BY id ASC
            LIMIT 1
            `,
            [customerMobile, businessDate],
            (lookupErr, activeCredit) => {

                if (lookupErr) {
                    reject(lookupErr);
                    return;
                }

                if (activeCredit) {

                    db.run(
                        `
                        UPDATE store_credits
                        SET
                            original_amount =
                                original_amount + ?,
                            remaining_balance =
                                remaining_balance + ?
                        WHERE id = ?
                          AND status = 'ISSUED'
                          AND remaining_balance > 0
                          AND valid_until >= ?
                        `,
                        [
                            creditAmount,
                            creditAmount,
                            activeCredit.id,
                            businessDate
                        ],
                        function(updateErr) {

                            if (updateErr) {
                                reject(updateErr);
                                return;
                            }

                            if (this.changes !== 1) {
                                reject(
                                    new Error(
                                        "Active Store Credit changed before accumulation completed."
                                    )
                                );
                                return;
                            }

                            insertReturnCreditLedger(
                                activeCredit.customer_id ||
                                    returnData.customer_id ||
                                    null,
                                activeCredit.store_credit_no,
                                returnData.return_no,
                                creditAmount,
                                createdBy
                            )
                                .then(() => resolve({
                                    store_credit_no:
                                        activeCredit.store_credit_no,
                                    issue_date:
                                        activeCredit.issue_date,
                                    valid_until:
                                        activeCredit.valid_until,
                                    available_balance:
                                        Number(
                                            activeCredit.remaining_balance
                                        ) + creditAmount
                                }))
                                .catch(reject);

                        }
                    );

                    return;
                }

                getNextStoreCreditNumber()
                    .then(storeCreditNo => {

                        const validUntil =
                            addBusinessCalendarDays(
                                businessDate,
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
                            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ISSUED', ?, ?)
                            `,
                            [
                                storeCreditNo,
                                returnId,
                                originalBillNo,
                                returnData.customer_id || null,
                                returnData.customer_name,
                                customerMobile,
                                businessDate,
                                validUntil,
                                creditAmount,
                                creditAmount,
                                createdBy,
                                new Date().toISOString()
                            ],
                            insertErr => {

                                if (insertErr) {
                                    reject(insertErr);
                                    return;
                                }

                                insertReturnCreditLedger(
                                    returnData.customer_id || null,
                                    storeCreditNo,
                                    returnData.return_no,
                                    creditAmount,
                                    createdBy
                                )
                                    .then(() => resolve({
                                        store_credit_no:
                                            storeCreditNo,
                                        issue_date:
                                            businessDate,
                                        valid_until:
                                            validUntil,
                                        available_balance:
                                            creditAmount
                                    }))
                                    .catch(reject);

                            }
                        );

                    })
                    .catch(reject);

            }
        );

    });

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

                            const createdBy =
                                returnData.created_by ||
                                "Administrator";

                            resolveReturnItemProducts(
                                authoritativeBillNo,
                                returnData.items
                            )
                                .then(resolvedItems =>
                                    resolvedItems.reduce(
                                        (chain, item) =>
                                            chain.then(() =>
                                                insertReturnItemWithInventory(
                                                    returnId,
                                                    returnData.return_no,
                                                    authoritativeBillNo,
                                                    item,
                                                    createdBy
                                                )
                                            ),
                                        Promise.resolve()
                                    )
                                )
                                .then(() =>
                                    applyStoreCreditForReturn(
                                        returnId,
                                        returnData,
                                        authoritativeBillNo,
                                        createdBy
                                    )
                                )
                                .then(storeCredit => {

                                    db.run(
                                        "COMMIT",
                                        commitErr => {

                                            if (commitErr) {
                                                db.run("ROLLBACK");
                                                reject(commitErr);
                                                return;
                                            }

                                            resolve({
                                                success: true,
                                                return_id: returnId,
                                                return_no:
                                                    returnData.return_no,
                                                ...storeCredit
                                            });

                                        }
                                    );

                                })

                                                .catch(error => {

                                                    db.run(
                                                        "ROLLBACK",
                                                        rollbackErr => {

                                                            if (rollbackErr) {
                                                                console.error(
                                                                    "Return rollback failed:",
                                                                    rollbackErr.message
                                                                );
                                                            }

                                                            reject(error);

                                                        }
                                                    );

                                                });

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
