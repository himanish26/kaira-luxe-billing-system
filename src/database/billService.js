const db = require("./database");

const {
    getBusinessDate
} = require("./businessDate");

const {

    logInvoiceGenerated,

    logPaymentCorrected,

    logStoreCreditRedeemed

} = require("./logService");

function billAmountToPaise(value, fieldName, optional = false) {

    if (optional && (value === null || value === undefined)) {
        return 0;
    }

    if (
        value === null ||
        value === undefined ||
        (typeof value === "string" && value.trim() === "")
    ) {
        const error = new Error(`Invalid ${fieldName} amount.`);
        error.code = "KLBS_BILL_SETTLEMENT_INVALID_AMOUNT";
        throw error;
    }

    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) {
        const error = new Error(`Invalid ${fieldName} amount.`);
        error.code = "KLBS_BILL_SETTLEMENT_INVALID_AMOUNT";
        throw error;
    }

    const paise = Math.round((amount + Number.EPSILON) * 100);
    if (!Number.isSafeInteger(paise)) {
        const error = new Error(`Invalid ${fieldName} amount.`);
        error.code = "KLBS_BILL_SETTLEMENT_INVALID_AMOUNT";
        throw error;
    }

    return paise;

}

function validateBillSettlement(billData) {

    const hasNestedStoreCredit = Boolean(billData.store_credit);
    const storeCreditValue = hasNestedStoreCredit
        ? billData.store_credit.amount
        : billData.store_credit_amount;

    const amounts = {
        netPaise: billAmountToPaise(billData.net_amount, "Net Amount"),
        cashPaise: billAmountToPaise(billData.cash_amount, "Cash"),
        upiPaise: billAmountToPaise(billData.upi_amount, "UPI"),
        cardPaise: billAmountToPaise(billData.card_amount, "Card"),
        storeCreditPaise: billAmountToPaise(
            storeCreditValue,
            "Store Credit",
            !hasNestedStoreCredit &&
                (storeCreditValue === null || storeCreditValue === undefined)
        ),
        giftVoucherPaise: billAmountToPaise(
            billData.gift_voucher_amount,
            "Gift Voucher",
            billData.gift_voucher_amount === null ||
                billData.gift_voucher_amount === undefined
        )
    };

    const settlementPaise = [
        amounts.cashPaise,
        amounts.upiPaise,
        amounts.cardPaise,
        amounts.storeCreditPaise,
        amounts.giftVoucherPaise
    ].reduce((total, amount) => {
        const result = total + amount;
        if (!Number.isSafeInteger(result)) {
            const error = new Error("Invalid total payment allocation.");
            error.code = "KLBS_BILL_SETTLEMENT_INVALID_AMOUNT";
            throw error;
        }
        return result;
    }, 0);

    const differencePaise = amounts.netPaise - settlementPaise;
    if (differencePaise !== 0) {
        const difference = (Math.abs(differencePaise) / 100).toFixed(2);
        const error = new Error(
            differencePaise > 0
                ? `Payment allocation is short by ₹${difference}.`
                : `Payment allocation exceeds bill amount by ₹${difference}.`
        );
        error.code = "KLBS_BILL_SETTLEMENT_MISMATCH";
        error.differencePaise = differencePaise;
        throw error;
    }

    return {
        ...amounts,
        settlementPaise,
        differencePaise
    };

}

function getNextBillNumber() {

    return new Promise((resolve, reject) => {

        const [year, month, day] = getBusinessDate().split("-");
        const dd = day;
        const mm = month;
        const yy = year.slice(-2);

        const prefix = `KL${dd}${mm}${yy}`;

        db.get(

            `
            SELECT bill_no
            FROM bills
            WHERE bill_no LIKE ?
            ORDER BY bill_no DESC
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
                            row.bill_no.slice(-3)
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

function saveBill(billData) {

    return new Promise((resolve, reject) => {

        billData.bill_date = getBusinessDate();

        db.serialize(() => {

            db.run(
                "BEGIN IMMEDIATE TRANSACTION",
                beginErr => {

                    if(beginErr){
                        reject(beginErr);
                        return;
                    }

                    try {
                        const settlement = validateBillSettlement(billData);
                        billData.net_amount = settlement.netPaise / 100;
                        billData.cash_amount = settlement.cashPaise / 100;
                        billData.upi_amount = settlement.upiPaise / 100;
                        billData.card_amount = settlement.cardPaise / 100;
                        billData.gift_voucher_amount =
                            settlement.giftVoucherPaise / 100;
                        if (billData.store_credit) {
                            billData.store_credit.amount =
                                settlement.storeCreditPaise / 100;
                        }
                    }
                    catch (error) {
                        db.run("ROLLBACK", () => reject(error));
                        return;
                    }

                    verifyBusinessDayOpen();

                }
            );

            function verifyBusinessDayOpen(){

                db.get(
                    `
                    SELECT close_status
                    FROM day_closing_snapshots
                    WHERE business_date = ?
                      AND close_status IN ('PREPARING', 'CLOSED')
                    LIMIT 1
                    `,
                    [getBusinessDate()],
                    (statusErr, closing) => {

                        if(statusErr){
                            db.run("ROLLBACK");
                            reject(statusErr);
                            return;
                        }

                        if(closing){
                            db.run("ROLLBACK");
                            reject(new Error(
                                closing.close_status === "PREPARING"
                                    ? "KLBS_BUSINESS_DAY_CLOSING"
                                    : "KLBS_BUSINESS_DAY_CLOSED"
                            ));
                            return;
                        }

                        insertBill();

                    }
                );

            }

            function insertBill(){

                db.run(

                `
                INSERT INTO bills
                (
                    bill_no,
                    bill_date,
                    bill_time,
                    customer_name,
                    customer_mobile,
                    total_items,
                    total_qty,
                    gross_amount,
                    discount_amount,
                    taxable_amount,
                    cgst_amount,
                    sgst_amount,
                    gst_amount,
                    net_amount,
                    cash_amount,
                    upi_amount,
                    card_amount,
                    store_credit_amount,
                    gift_voucher_amount,
                    payment_status,
                    created_at
                )
                VALUES
                (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `,

                [

                    billData.bill_no,
                    billData.bill_date,
                    billData.bill_time,
                    billData.customer_name,
                    billData.customer_mobile,
                    billData.total_items,
                    billData.total_qty,
                    billData.gross_amount,
                    billData.discount_amount,
                    billData.taxable_amount,
                    billData.cgst_amount,
                    billData.sgst_amount,
                    billData.gst_amount,
                    billData.net_amount,
                    billData.cash_amount,
                    billData.upi_amount,
                    billData.card_amount,

                    billData.store_credit
                        ? Number(
                            billData.store_credit.amount
                        ) || 0
                        : 0,

                    Number(
                        billData.gift_voucher_amount
                    ) || 0,

                    "PAID",
                    new Date().toISOString()

                ],

                function(err){

                    if(err){

                        db.run("ROLLBACK");

                        reject(err);

                        return;

                    }

                    insertItems();

                }

                );

            }

            function insertItems(){

                let pending =
                    billData.items.length;

                if(pending === 0){

                    commit();

                    return;

                }

                billData.items.forEach(item=>{

                    const gross =
                        item.qty * item.mrp;

                    const discountAmount =
                        gross * item.discount / 100;

                    const net =
                        gross - discountAmount;

                    const taxable =
                        net * 100 /
                        (100 + item.gst_rate);

                    const gst =
                        net - taxable;

                    db.run(

                        `
                        INSERT INTO bill_items
                        (
                            bill_no,
                            barcode,
                            product_name,
                            brand,
                            category,
                            size,
                            colour,
                            qty,
                            mrp,
                            discount_percent,
                            discount_amount,
                            taxable_amount,
                            gst_rate,
                            gst_amount,
                            net_amount
                        )
                        VALUES
                        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `,

                        [

                            billData.bill_no,

                            item.barcode,

                            item.product_name,

                            item.brand || "",

                            item.category || "",

                            item.size || "",

                            item.colour || "",

                            item.qty,

                            item.mrp,

                            item.discount,

                            discountAmount,

                            taxable,

                            item.gst_rate,

                            gst,

                            net

                        ],

                        function(err){

                            if(err){

                                db.run("ROLLBACK");

                                reject(err);

                                return;

                            }

                            pending--;

                            if(pending===0){

                                createSaleInventoryTransactions();

                            }

                        }

                    );

                });

            }

function createSaleInventoryTransactions(){

    const items = billData.items || [];
    const now = new Date().toISOString();

    function insertMovement(index){

        if(index >= items.length){
            redeemStoreCreditAndCommit();
            return;
        }

        const item = items[index];
        const saleQuantity = Number(item.qty);

        if(
            !Number.isFinite(saleQuantity) ||
            saleQuantity <= 0
        ){
            db.run("ROLLBACK");
            reject(
                new Error(
                    `Invalid sale quantity for barcode: ${item.barcode}`
                )
            );
            return;
        }

        db.get(
            `
            SELECT
                p.id,
                p.barcode,
                COALESCE(SUM(it.quantity), 0) AS current_stock
            FROM products p
            LEFT JOIN inventory_transactions it
                ON it.product_id = p.id
            WHERE p.barcode = ?
            GROUP BY p.id
            `,
            [item.barcode],
            (err, product) => {

                if(err){
                    db.run("ROLLBACK");
                    reject(err);
                    return;
                }

                if(!product){
                    db.run("ROLLBACK");
                    reject(
                        new Error(
                            `Product not found for barcode: ${item.barcode}`
                        )
                    );
                    return;
                }

                if(saleQuantity > Number(product.current_stock)){
                    db.run("ROLLBACK");
                    reject(
                        new Error(
                            `Insufficient stock for barcode ${product.barcode}. Available stock: ${product.current_stock}`
                        )
                    );
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
                    (?, ?, 'SALE', ?, 'BILL', ?, ?, 'Administrator', ?)
                    `,
                    [
                        product.id,
                        product.barcode,
                        -saleQuantity,
                        billData.bill_no,
                        `Sale against bill ${billData.bill_no}`,
                        now
                    ],
                    insertErr => {

                        if(insertErr){
                            db.run("ROLLBACK");
                            reject(insertErr);
                            return;
                        }

                        insertMovement(index + 1);

                    }
                );

            }
        );

    }

    insertMovement(0);

}

function redeemStoreCreditAndCommit(){

    if (
        !billData.store_credit ||
        !billData.store_credit.store_credit_no
    ) {

        commit();
        return;

    }

    const storeCreditNo =
        billData.store_credit.store_credit_no;

    const storeCreditAmount =
        Number(
            billData.store_credit.amount
        );

    db.get(
        `
        SELECT
            id,
            customer_id,
            remaining_balance
        FROM store_credits
        WHERE store_credit_no = ?
          AND TRIM(customer_mobile) = TRIM(?)
          AND status = 'ISSUED'
          AND remaining_balance > 0
          AND valid_until >= ?
        `,
        [
            storeCreditNo,
            billData.customer_mobile,
            getBusinessDate()
        ],
        (lookupErr, storeCredit) => {

            if(lookupErr){
                db.run("ROLLBACK");
                reject(lookupErr);
                return;
            }

            if(!storeCredit){
                db.run("ROLLBACK");
                reject(
                    new Error(
                        "Store Credit redemption failed. The credit may be invalid, expired, already redeemed, or does not belong to this customer."
                    )
                );
                return;
            }

            const redeemedAmount =
                Number(storeCredit.remaining_balance);

            let redeemedAmountPaise;
            let requestedAmountPaise;
            try {
                redeemedAmountPaise = billAmountToPaise(
                    redeemedAmount,
                    "Store Credit"
                );
                requestedAmountPaise = billAmountToPaise(
                    storeCreditAmount,
                    "Store Credit"
                );
            }
            catch (error) {
                db.run("ROLLBACK", () => reject(error));
                return;
            }

            if (redeemedAmountPaise !== requestedAmountPaise) {
                db.run("ROLLBACK");
                reject(new Error(
                    "Store Credit redemption failed. Full active balance redemption is required."
                ));
                return;
            }

            db.run(
                `
                UPDATE store_credits
                SET
                    remaining_balance = 0,
                    status = 'REDEEMED'
                WHERE id = ?
                  AND status = 'ISSUED'
                  AND remaining_balance = ?
                `,
                [storeCredit.id, redeemedAmount],
                function(updateErr){

                    if(updateErr){
                        db.run("ROLLBACK");
                        reject(updateErr);
                        return;
                    }

                    if(this.changes !== 1){
                        db.run("ROLLBACK");
                        reject(
                            new Error(
                                "Store Credit redemption failed. The credit changed before redemption completed."
                            )
                        );
                        return;
                    }

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
                        VALUES
                        (?, 'CREDIT_REDEEMED', ?, 'BILL', ?, ?, 'Administrator', ?)
                        `,
                        [
                            storeCredit.customer_id || null,
                            -Math.abs(redeemedAmount),
                            billData.bill_no,
                            `Store Credit ${storeCreditNo}`,
                            new Date().toISOString()
                        ],
                        ledgerErr => {

                            if(ledgerErr){
                                db.run("ROLLBACK");
                                reject(ledgerErr);
                                return;
                            }

                            commit();

                        }
                    );

                }
            );

        }
    );

}

            function commit(){

    db.run(

        "COMMIT",

        async (err)=>{

                if(err){

                    reject(err);
                    return;

                }

                else{

                    try {
                        await logInvoiceGenerated(
                            billData.bill_no,
                            billData.net_amount,
                            billData.total_qty
                        );
                    }
                    catch (logError) {
                        console.error(
                            "Invoice activity logging failed:",
                            logError.message
                        );
                    }

                    if (
    billData.store_credit &&
    billData.store_credit.store_credit_no
) {
    try {
        await logStoreCreditRedeemed(
            billData.store_credit.store_credit_no,
            billData.bill_no,
            Number(billData.store_credit.amount),
            "OPERATOR"
        );
    }
    catch (logError) {
        console.error(
            "Store Credit redemption activity logging failed:",
            logError.message
        );
    }
}

                    resolve(true);

                }

        }

    );

}

        });

    });

}

function getBills() {

    return new Promise((resolve, reject) => {

        db.all(

            `
            SELECT
    b.bill_no,
    b.bill_date,
    b.bill_time,
    b.customer_name,
    b.customer_mobile,
    b.net_amount,
    b.payment_status,

    EXISTS (
        SELECT 1
        FROM payment_corrections pc
        WHERE pc.bill_no = b.bill_no
    ) AS payment_corrected

FROM bills b

ORDER BY b.id DESC
            `,

            [],

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

function getTransactionHistory() {

    return new Promise((resolve, reject) => {

        db.all(

            `
            SELECT *
            FROM (

                /* =====================
                   BILLS
                ===================== */

                SELECT

                    'BILL' AS category,

                    b.bill_no AS reference_no,

                    b.bill_date AS transaction_date,

                    b.bill_time AS transaction_time,

                    b.customer_name,

                    b.customer_mobile,

                    b.net_amount AS amount,

                    b.payment_status AS status,

                    EXISTS (
                        SELECT 1
                        FROM payment_corrections pc
                        WHERE pc.bill_no = b.bill_no
                    ) AS payment_corrected,

                    b.created_at AS sort_timestamp,
                    b.id AS sort_id

                FROM bills b


                UNION ALL


                /* =====================
                   RETURNS
                ===================== */

                SELECT

                    'RETURN' AS category,

                    r.return_no AS reference_no,

date(r.created_at, 'localtime') AS transaction_date,

time(r.created_at, 'localtime') AS transaction_time,

                    r.customer_name,

                    r.customer_mobile,

r.return_amount AS amount,

'COMPLETED' AS status,

0 AS payment_corrected,

r.created_at AS sort_timestamp,

r.id AS sort_id

                FROM returns r


                UNION ALL


                /* =====================
                   STORE CREDITS
                ===================== */

                SELECT

                    'STORE CREDIT' AS category,

                    sc.store_credit_no AS reference_no,

date(sc.created_at, 'localtime') AS transaction_date,

time(sc.created_at, 'localtime') AS transaction_time,

                    sc.customer_name,

                    sc.customer_mobile,

sc.original_amount AS amount,

sc.status,

0 AS payment_corrected,

sc.created_at AS sort_timestamp,

sc.id AS sort_id

                FROM store_credits sc

            )

ORDER BY
    sort_timestamp DESC,
    sort_id DESC
            `,

            [],

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

function getBillDetails(billNo) {

    return new Promise((resolve, reject) => {

        db.get(

            `
            SELECT *
            FROM bills
            WHERE bill_no = ?
            `,

            [billNo],

            (err, bill) => {

                if (err) {

                    reject(err);

                    return;

                }

                db.all(

                    `
                    SELECT *
                    FROM bill_items
                    WHERE bill_no = ?
                    `,

                    [billNo],

                    (err, items) => {

                        if (err) {

                            reject(err);

                            return;

                        }

                        resolve({

                            bill,
                            items

                        });

                    }

                );

            }

        );

    });

}



function updatePaymentAllocation(data) {

    return new Promise((resolve, reject) => {

        db.serialize(() => {

            db.run("BEGIN TRANSACTION");

            db.get(

                `
                SELECT
                    cash_amount,
                    upi_amount,
                    card_amount,
                    net_amount
                FROM bills
                WHERE bill_no = ?
                `,

                [data.bill_no],

                (err, bill) => {

                    if (err) {

                        db.run("ROLLBACK");

                        reject(err);

                        return;

                    }

                    if (!bill) {

                        db.run("ROLLBACK");

                        reject(new Error("Bill not found."));

                        return;

                    }

                    if (

    Number(bill.cash_amount) === Number(data.cash_amount) &&

    Number(bill.upi_amount) === Number(data.upi_amount) &&

    Number(bill.card_amount) === Number(data.card_amount)

) {

    db.run("ROLLBACK");

    reject(

        new Error(
            "No payment changes detected."
        )

    );

    return;

}

                    const total =

                        Number(data.cash_amount) +
                        Number(data.upi_amount) +
                        Number(data.card_amount);

                    if (

                        Math.abs(
                            total - Number(bill.net_amount)
                        ) > 0.01

                    ) {

                        db.run("ROLLBACK");

                        reject(
                            new Error(
                                "Payment total does not match Bill Amount."
                            )
                        );

                        return;

                    }

                    db.run(

                        `
                        INSERT INTO payment_corrections
                        (
                            bill_no,

                            old_cash,
                            old_upi,
                            old_card,

                            new_cash,
                            new_upi,
                            new_card,

                            remarks,

                            corrected_by,

                            corrected_at
                        )
                        VALUES
                        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `,

                        [

                            data.bill_no,

                            bill.cash_amount,
                            bill.upi_amount,
                            bill.card_amount,

                            data.cash_amount,
                            data.upi_amount,
                            data.card_amount,

                            data.remarks,

                            data.corrected_by,

                            new Date().toISOString()

                        ],

                        function(err){

                            if(err){

                                db.run("ROLLBACK");

                                reject(err);

                                return;

                            }

                            db.run(

                                `
                                UPDATE bills
                                SET

                                    cash_amount = ?,

                                    upi_amount = ?,

                                    card_amount = ?

                                WHERE bill_no = ?
                                `,

                                [

                                    data.cash_amount,

                                    data.upi_amount,

                                    data.card_amount,

                                    data.bill_no

                                ],

                                function(err){

                                    if(err){

                                        db.run("ROLLBACK");

                                        reject(err);

                                        return;

                                    }

                                    db.run(

    "COMMIT",

    async (err) => {

        if (err) {

            reject(err);

        }

        else {

            let activityWarning = null;

            try {

                await logPaymentCorrected(

                    data.bill_no

                );

            }

            catch (logError) {

                activityWarning =
                    "Activity Log could not be recorded.";

                console.error(
                    "Payment correction activity logging failed:",
                    logError.message
                );

            }

            resolve({

                success: true,

                activityWarning

            });

        }

    }

);

                                }

                            );

                        }

                    );

                }

            );

        });

    });

}

function getPaymentCorrections(billNo) {

    return new Promise((resolve, reject) => {

        db.all(

            `
            SELECT

                old_cash,
                old_upi,
                old_card,

                new_cash,
                new_upi,
                new_card,

                remarks,

                corrected_by,

                corrected_at

            FROM payment_corrections

            WHERE bill_no = ?

            ORDER BY corrected_at DESC
            `,

            [billNo],

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

function getDashboardSummary() {

    return new Promise((resolve, reject) => {

        const businessDate = getBusinessDate();
        const businessMonth = businessDate.slice(0, 7);

        const sql = `

            SELECT

                (SELECT COUNT(*) FROM products) AS products,

                (
                    SELECT COUNT(DISTINCT customer_mobile)

                    FROM bills

                    WHERE customer_mobile IS NOT NULL
                    AND customer_mobile <> ''

                ) AS customers,

                (

                    SELECT COUNT(*)

                    FROM bills

                    WHERE bill_date = ?

                ) AS todayBills,

                (

                    SELECT IFNULL(SUM(net_amount),0)

                    FROM bills

                    WHERE bill_date = ?

                ) AS todaySales,
                
                (

                    SELECT IFNULL(SUM(total_qty),0)

                    FROM bills

                    WHERE bill_date = ?

                ) AS todayQtySold,

                (

                    SELECT COUNT(*)

                    FROM bills

                    WHERE substr(bill_date, 1, 7) = ?

                ) AS mtdBills,

                (

                    SELECT IFNULL(SUM(net_amount),0)

                    FROM bills

                    WHERE substr(bill_date, 1, 7) = ?

                ) AS mtdSales,

                (

                    SELECT IFNULL(SUM(cash_amount),0)

                    FROM bills

                    WHERE bill_date = ?

                ) AS cashToday,

                (

                    SELECT IFNULL(SUM(upi_amount),0)

                    FROM bills

                    WHERE bill_date = ?

                ) AS upiToday,

                (

                    SELECT IFNULL(SUM(card_amount),0)

                    FROM bills

                    WHERE bill_date = ?

                ) AS cardToday,

                (

                    SELECT IFNULL(SUM(store_credit_amount),0)

                    FROM bills

                    WHERE bill_date = ?

                ) AS storeCreditToday,

                (

                    SELECT IFNULL(SUM(gift_voucher_amount),0)

                    FROM bills

                    WHERE bill_date = ?

                ) AS giftVoucherToday

        `;

        db.get(

            sql,

            [
                businessDate,
                businessDate,
                businessDate,
                businessMonth,
                businessMonth,
                businessDate,
                businessDate,
                businessDate,
                businessDate,
                businessDate
            ],

            (err,row)=>{

                if(err){

                    reject(err);

                    return;

                }

                resolve(row);

            }

        );

    });

}

module.exports = {

    saveBill,
    validateBillSettlement,
    getNextBillNumber,
    getBills,
    getTransactionHistory,
    getBillDetails,
    updatePaymentAllocation,
    getPaymentCorrections,
    getDashboardSummary

};
