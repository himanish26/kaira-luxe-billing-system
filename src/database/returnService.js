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

function toPaise(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) {
        throw new Error("Invalid monetary value in original bill item.");
    }
    return Math.round((amount + Number.EPSILON) * 100);
}

function fromPaise(value) {
    if (!Number.isSafeInteger(value)) {
        throw new Error("Invalid paise value.");
    }
    return value / 100;
}

function roundHalfUp(numerator, denominator) {
    if (
        !Number.isSafeInteger(numerator) ||
        !Number.isSafeInteger(denominator) ||
        numerator < 0 ||
        denominator <= 0
    ) {
        throw new Error("Invalid accounting allocation.");
    }
    return Math.floor(
        ((numerator * 2) + denominator) /
        (denominator * 2)
    );
}

function allocate(totalPaise, returnedQuantity, soldQuantity) {
    return roundHalfUp(
        totalPaise * returnedQuantity,
        soldQuantity
    );
}

function getDocumentPrefix(type, businessDate) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(businessDate);
    if (!match || !["RT", "CN"].includes(type)) {
        throw new Error("Invalid Return/Credit Note business date.");
    }
    return `${type}${match[3]}${match[2]}${match[1].slice(-2)}`;
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

function resolveAuthoritativeReturnItems(
    originalBillNo,
    items
) {

    if (!Array.isArray(items) || items.length === 0) {
        return Promise.reject(
            new Error("No return items selected.")
        );
    }

    const seenItemIds = new Set();

    return Promise.all(
        items.map(item =>
            new Promise((resolve, reject) => {

                const originalBillItemId =
                    Number(item.original_bill_item_id);
                const returnQuantity =
                    Number(item.quantity);

                if (
                    !Number.isInteger(originalBillItemId) ||
                    originalBillItemId <= 0
                ) {
                    reject(
                        new Error("Invalid original bill item ID.")
                    );
                    return;
                }

                if (seenItemIds.has(originalBillItemId)) {
                    reject(
                        new Error(
                            "Duplicate original bill item in return request."
                        )
                    );
                    return;
                }
                seenItemIds.add(originalBillItemId);

                if (
                    !Number.isFinite(returnQuantity) ||
                    !Number.isInteger(returnQuantity) ||
                    returnQuantity <= 0
                ) {
                    reject(
                        new Error(
                            "Returned quantity must be a positive whole number."
                        )
                    );
                    return;
                }

                db.get(
                    `
                    SELECT
                        p.id AS product_id,
                        p.barcode AS barcode,
                        bi.product_name AS product_name,
                        bi.qty AS sold_quantity,
                        bi.mrp,
                        bi.discount_percent,
                        bi.taxable_amount,
                        bi.gst_rate,
                        bi.net_amount
                    FROM bill_items bi
                    INNER JOIN products p
                        ON p.barcode = bi.barcode
                    WHERE bi.id = ?
                      AND bi.bill_no = ?
                    LIMIT 1
                    `,
                    [
                        originalBillItemId,
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

                        try {
                            const soldQuantity =
                                Number(product.sold_quantity);

                            if (
                                !Number.isInteger(soldQuantity) ||
                                soldQuantity <= 0 ||
                                returnQuantity > soldQuantity
                            ) {
                                throw new Error(
                                    "Returned quantity exceeds the original quantity sold."
                                );
                            }

                            const mrpPaise = toPaise(product.mrp);
                            const originalNetPaise =
                                toPaise(product.net_amount);
                            const originalTaxablePaise =
                                toPaise(product.taxable_amount);
                            const discountPercent =
                                Number(product.discount_percent);
                            const gstRate =
                                Number(product.gst_rate);

                            if (
                                !Number.isFinite(discountPercent) ||
                                discountPercent < 0 ||
                                !Number.isFinite(gstRate) ||
                                gstRate < 0
                            ) {
                                throw new Error(
                                    "Original bill item rates are invalid."
                                );
                            }
                            const grossPaise =
                                mrpPaise * returnQuantity;
                            const netPaise = allocate(
                                originalNetPaise,
                                returnQuantity,
                                soldQuantity
                            );
                            const taxablePaise = allocate(
                                originalTaxablePaise,
                                returnQuantity,
                                soldQuantity
                            );
                            const discountPaise =
                                grossPaise - netPaise;
                            const gstPaise =
                                netPaise - taxablePaise;

                            if (
                                !Number.isSafeInteger(grossPaise) ||
                                discountPaise < 0 ||
                                taxablePaise < 0 ||
                                gstPaise < 0
                            ) {
                                throw new Error(
                                    "Original bill item financial values cannot be reconciled."
                                );
                            }

                            const cgstPaise =
                                roundHalfUp(gstPaise, 2);
                            const sgstPaise =
                                gstPaise - cgstPaise;

                            resolve({
                                original_bill_item_id:
                                    originalBillItemId,
                                product_id: product.product_id,
                                barcode: product.barcode,
                                product_name:
                                    product.product_name || "",
                                quantity: returnQuantity,
                                mrp: fromPaise(mrpPaise),
                                gross_reversal:
                                    fromPaise(grossPaise),
                                discount_percent:
                                    discountPercent,
                                discount_reversal:
                                    fromPaise(discountPaise),
                                taxable_reversal:
                                    fromPaise(taxablePaise),
                                gst_rate:
                                    gstRate,
                                cgst_reversal:
                                    fromPaise(cgstPaise),
                                sgst_reversal:
                                    fromPaise(sgstPaise),
                                gst_reversal:
                                    fromPaise(gstPaise),
                                net_reversal:
                                    fromPaise(netPaise),
                                paise: {
                                    gross: grossPaise,
                                    discount: discountPaise,
                                    taxable: taxablePaise,
                                    cgst: cgstPaise,
                                    sgst: sgstPaise,
                                    gst: gstPaise,
                                    net: netPaise
                                }
                            });
                        }
                        catch (calculationError) {
                            reject(calculationError);
                        }

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
                mrp,
                gross_reversal,
                discount_percent,
                discount_reversal,
                taxable_reversal,
                gst_rate,
                cgst_reversal,
                sgst_reversal,
                gst_reversal,
                net_reversal,
                remarks,
                created_at
            )
            VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                returnId,
                item.product_id,
                item.barcode,
                item.product_name,
                item.original_bill_item_id,
                item.quantity,
                item.mrp,
                item.net_reversal,
                item.mrp,
                item.gross_reversal,
                item.discount_percent,
                item.discount_reversal,
                item.taxable_reversal,
                item.gst_rate,
                item.cgst_reversal,
                item.sgst_reversal,
                item.gst_reversal,
                item.net_reversal,
                "",
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

async function saveReturn(returnData) {

    const canonicalBillNo = normalizeOriginalBillNo(
        returnData.original_bill_no
    );

    if (!canonicalBillNo) {
        throw new Error(
            "Original bill number is required for a return."
        );
    }

    const run = (sql, params = []) =>
        new Promise((resolve, reject) => {
            db.run(sql, params, function(error) {
                if (error) {
                    reject(error);
                    return;
                }
                resolve({
                    lastID: this.lastID,
                    changes: this.changes
                });
            });
        });

    const get = (sql, params = []) =>
        new Promise((resolve, reject) => {
            db.get(sql, params, (error, row) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(row);
            });
        });

    const nextNumber = async (type, businessDate) => {
        const prefix = getDocumentPrefix(type, businessDate);
        const column = type === "RT"
            ? "return_no"
            : "credit_note_no";
        const row = await get(
            `
            SELECT ${column} AS document_no
            FROM returns
            WHERE UPPER(TRIM(${column})) LIKE ?
            ORDER BY UPPER(TRIM(${column})) DESC
            LIMIT 1
            `,
            [`${prefix}%`]
        );
        const next = row && row.document_no
            ? Number(String(row.document_no).slice(-3)) + 1
            : 1;
        if (!Number.isInteger(next) || next < 1 || next > 999) {
            throw new Error(`${type} daily number sequence exhausted.`);
        }
        return prefix + String(next).padStart(3, "0");
    };

    let transactionStarted = false;

    try {
        await run("BEGIN IMMEDIATE TRANSACTION");
        transactionStarted = true;

        const authoritativeBill = await get(
            `
            SELECT bill_no, bill_date
            FROM bills
            WHERE UPPER(TRIM(bill_no)) = ?
            LIMIT 1
            `,
            [canonicalBillNo]
        );

        if (!authoritativeBill) {
            throw new Error("Original bill not found.");
        }

        const authoritativeBillNo = authoritativeBill.bill_no;
        const existingReturn = await get(
            `
            SELECT return_no
            FROM returns
            WHERE UPPER(TRIM(original_bill_no)) = UPPER(TRIM(?))
            LIMIT 1
            `,
            [authoritativeBillNo]
        );

        if (existingReturn) {
            throw new Error(
                "RETURN COMPLETED / FURTHER RETURNS NOT ALLOWED\n\n" +
                "This original bill has already been returned.\n\n" +
                `Return No: ${existingReturn.return_no}`
            );
        }

        const resolvedItems = await resolveAuthoritativeReturnItems(
            authoritativeBillNo,
            returnData.items
        );

        const totals = resolvedItems.reduce(
            (result, item) => {
                for (const key of Object.keys(result)) {
                    result[key] += item.paise[key];
                    if (!Number.isSafeInteger(result[key])) {
                        throw new Error(
                            "Return accounting total exceeds safe limits."
                        );
                    }
                }
                return result;
            },
            {
                gross: 0,
                discount: 0,
                taxable: 0,
                cgst: 0,
                sgst: 0,
                gst: 0,
                net: 0
            }
        );

        if (
            totals.gross - totals.discount !== totals.net ||
            totals.taxable + totals.gst !== totals.net ||
            totals.cgst + totals.sgst !== totals.gst ||
            totals.net <= 0
        ) {
            throw new Error(
                "Return accounting values do not reconcile."
            );
        }

        const businessDate = getBusinessDate();
        const returnNo = await nextNumber("RT", businessDate);
        const creditNoteNo = await nextNumber("CN", businessDate);
        const createdBy =
            returnData.created_by || "Administrator";
        const createdAt = new Date().toISOString();

        const parentInsert = await run(
            `
            INSERT INTO returns
            (
                return_no,
                credit_note_no,
                original_bill_no,
                business_date,
                original_bill_date,
                customer_id,
                customer_name,
                customer_mobile,
                return_reason,
                remarks,
                return_amount,
                gross_reversal,
                discount_reversal,
                taxable_reversal,
                cgst_reversal,
                sgst_reversal,
                gst_reversal,
                net_reversal,
                accounting_status,
                accounting_snapshot_version,
                created_by,
                created_at
            )
            VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             'COMPLETED', 1, ?, ?)
            `,
            [
                returnNo,
                creditNoteNo,
                authoritativeBillNo,
                businessDate,
                authoritativeBill.bill_date,
                returnData.customer_id || null,
                returnData.customer_name,
                returnData.customer_mobile,
                returnData.return_reason,
                returnData.remarks || "",
                fromPaise(totals.net),
                fromPaise(totals.gross),
                fromPaise(totals.discount),
                fromPaise(totals.taxable),
                fromPaise(totals.cgst),
                fromPaise(totals.sgst),
                fromPaise(totals.gst),
                fromPaise(totals.net),
                createdBy,
                createdAt
            ]
        );

        const returnId = parentInsert.lastID;

        for (const item of resolvedItems) {
            await insertReturnItemWithInventory(
                returnId,
                returnNo,
                authoritativeBillNo,
                item,
                createdBy
            );
        }

        const authoritativeReturnData = {
            ...returnData,
            return_no: returnNo,
            return_amount: fromPaise(totals.net)
        };
        const storeCredit = await applyStoreCreditForReturn(
            returnId,
            authoritativeReturnData,
            authoritativeBillNo,
            createdBy
        );

        const verification = await get(
            `
            SELECT
                r.return_amount,
                r.gross_reversal,
                r.discount_reversal,
                r.taxable_reversal,
                r.cgst_reversal,
                r.sgst_reversal,
                r.gst_reversal,
                r.net_reversal,
                SUM(ri.gross_reversal) AS item_gross,
                SUM(ri.discount_reversal) AS item_discount,
                SUM(ri.taxable_reversal) AS item_taxable,
                SUM(ri.cgst_reversal) AS item_cgst,
                SUM(ri.sgst_reversal) AS item_sgst,
                SUM(ri.gst_reversal) AS item_gst,
                SUM(ri.net_reversal) AS item_net
            FROM returns r
            INNER JOIN return_items ri ON ri.return_id = r.id
            WHERE r.id = ?
            GROUP BY r.id
            `,
            [returnId]
        );

        const comparisons = [
            [verification.return_amount, totals.net],
            [verification.gross_reversal, totals.gross],
            [verification.discount_reversal, totals.discount],
            [verification.taxable_reversal, totals.taxable],
            [verification.cgst_reversal, totals.cgst],
            [verification.sgst_reversal, totals.sgst],
            [verification.gst_reversal, totals.gst],
            [verification.net_reversal, totals.net],
            [verification.item_gross, totals.gross],
            [verification.item_discount, totals.discount],
            [verification.item_taxable, totals.taxable],
            [verification.item_cgst, totals.cgst],
            [verification.item_sgst, totals.sgst],
            [verification.item_gst, totals.gst],
            [verification.item_net, totals.net]
        ];

        if (
            !verification ||
            comparisons.some(
                ([value, expected]) => toPaise(value) !== expected
            )
        ) {
            throw new Error(
                "Persisted Return/Credit Note accounting verification failed."
            );
        }

        await run("COMMIT");
        transactionStarted = false;

        return {
            success: true,
            return_id: returnId,
            return_no: returnNo,
            credit_note_no: creditNoteNo,
            return_amount: fromPaise(totals.net),
            gross_reversal: fromPaise(totals.gross),
            discount_reversal: fromPaise(totals.discount),
            taxable_reversal: fromPaise(totals.taxable),
            cgst_reversal: fromPaise(totals.cgst),
            sgst_reversal: fromPaise(totals.sgst),
            gst_reversal: fromPaise(totals.gst),
            net_reversal: fromPaise(totals.net),
            ...storeCredit
        };
    }
    catch (error) {
        if (transactionStarted) {
            await run("ROLLBACK").catch(rollbackError => {
                console.error(
                    "Return rollback failed:",
                    rollbackError.message
                );
            });
        }
        throw mapReturnDatabaseError(error);
    }

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
                r.credit_note_no,
                r.accounting_status,
                r.accounting_snapshot_version,
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

/* ===========================================
   GET AUTHORITATIVE CREDIT NOTE DOCUMENT
=========================================== */

async function getCreditNoteDetails(identifier) {

    const canonicalIdentifier = String(identifier || "")
        .trim()
        .toUpperCase();

    if (!canonicalIdentifier) {
        throw new Error("Credit Note or Return number is required.");
    }

    const get = (sql, params = []) =>
        new Promise((resolve, reject) => {
            db.get(sql, params, (error, row) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(row || null);
            });
        });

    const all = (sql, params = []) =>
        new Promise((resolve, reject) => {
            db.all(sql, params, (error, rows) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(rows || []);
            });
        });

    const creditNote = await get(
        `
        SELECT
            r.id,
            r.credit_note_no,
            r.return_no,
            r.original_bill_no,
            r.business_date,
            r.original_bill_date,
            r.customer_name,
            r.customer_mobile,
            r.return_reason,
            r.remarks,
            r.return_amount,
            r.gross_reversal,
            r.discount_reversal,
            r.taxable_reversal,
            r.cgst_reversal,
            r.sgst_reversal,
            r.gst_reversal,
            r.net_reversal,
            r.accounting_status,
            r.accounting_snapshot_version,
            r.created_by,
            r.created_at,
            sc.store_credit_no
        FROM returns r
        LEFT JOIN store_credits sc ON sc.return_id = r.id
        WHERE UPPER(TRIM(r.credit_note_no)) = ?
           OR UPPER(TRIM(r.return_no)) = ?
        LIMIT 1
        `,
        [canonicalIdentifier, canonicalIdentifier]
    );

    if (!creditNote) {
        return null;
    }

    if (
        creditNote.accounting_status !== "COMPLETED" ||
        creditNote.accounting_snapshot_version !== 1 ||
        !String(creditNote.credit_note_no || "").trim()
    ) {
        return {
            available: false,
            return_no: creditNote.return_no,
            reason:
                "Credit Note is not available for this historical return."
        };
    }

    const items = await all(
        `
        SELECT
            id,
            barcode,
            product_name,
            quantity,
            mrp,
            gross_reversal,
            discount_percent,
            discount_reversal,
            taxable_reversal,
            gst_rate,
            cgst_reversal,
            sgst_reversal,
            gst_reversal,
            net_reversal
        FROM return_items
        WHERE return_id = ?
        ORDER BY id ASC
        `,
        [creditNote.id]
    );

    const moneyFields = [
        "gross_reversal",
        "discount_reversal",
        "taxable_reversal",
        "cgst_reversal",
        "sgst_reversal",
        "gst_reversal",
        "net_reversal"
    ];
    const totals = Object.fromEntries(
        moneyFields.map(field => [field, 0])
    );

    let valid = items.length > 0;
    for (const item of items) {
        if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
            valid = false;
        }
        for (const field of moneyFields) {
            try {
                totals[field] += toPaise(item[field]);
            }
            catch (_) {
                valid = false;
            }
        }
        try {
            const gross = toPaise(item.gross_reversal);
            const discount = toPaise(item.discount_reversal);
            const taxable = toPaise(item.taxable_reversal);
            const cgst = toPaise(item.cgst_reversal);
            const sgst = toPaise(item.sgst_reversal);
            const gst = toPaise(item.gst_reversal);
            const net = toPaise(item.net_reversal);
            if (
                gross - discount !== net ||
                taxable + gst !== net ||
                cgst + sgst !== gst
            ) {
                valid = false;
            }
        }
        catch (_) {
            valid = false;
        }
    }

    for (const field of moneyFields) {
        try {
            if (toPaise(creditNote[field]) !== totals[field]) {
                valid = false;
            }
        }
        catch (_) {
            valid = false;
        }
    }

    try {
        if (
            toPaise(creditNote.return_amount) !==
            toPaise(creditNote.net_reversal)
        ) {
            valid = false;
        }
    }
    catch (_) {
        valid = false;
    }

    if (!valid) {
        throw new Error(
            "Credit Note data could not be verified. Please contact the administrator."
        );
    }

    return {
        available: true,
        credit_note_no: creditNote.credit_note_no,
        credit_note_date: creditNote.business_date,
        return_no: creditNote.return_no,
        return_date: creditNote.business_date,
        original_bill_no: creditNote.original_bill_no,
        original_bill_date: creditNote.original_bill_date,
        customer_name: creditNote.customer_name,
        customer_mobile: creditNote.customer_mobile,
        return_reason: creditNote.return_reason,
        remarks: creditNote.remarks,
        gross_reversal: creditNote.gross_reversal,
        discount_reversal: creditNote.discount_reversal,
        taxable_reversal: creditNote.taxable_reversal,
        cgst_reversal: creditNote.cgst_reversal,
        sgst_reversal: creditNote.sgst_reversal,
        gst_reversal: creditNote.gst_reversal,
        net_reversal: creditNote.net_reversal,
        store_credit_no: creditNote.store_credit_no || null,
        created_by: creditNote.created_by,
        created_at: creditNote.created_at,
        items
    };
}

module.exports = {

    getBillForReturn,

    getNextReturnNumber,

    getNextStoreCreditNumber,

    saveReturn,

    getStoreCreditDetails,

    getAvailableStoreCreditByMobile,

    getStoreCreditForReprint,

    getReturnDetails,

    getCreditNoteDetails

};
