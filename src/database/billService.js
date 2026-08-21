const db = require("./database");

const {

    logInvoiceGenerated,

    logPaymentCorrected

} = require("./logService");

function getNextBillNumber() {

    return new Promise((resolve, reject) => {

        const today = new Date();

        const dd = String(today.getDate()).padStart(2, "0");
        const mm = String(today.getMonth() + 1).padStart(2, "0");
        const yy = String(today.getFullYear()).slice(-2);

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

        db.serialize(() => {

            db.run("BEGIN TRANSACTION");

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
                    payment_status,
                    created_at
                )
                VALUES
                (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

    let pending =
        billData.items.length;

    if(pending === 0){

        commit();

        return;

    }

    const now =
        new Date().toISOString();

    billData.items.forEach(item => {

        db.get(

            `
            SELECT id
            FROM products
            WHERE barcode = ?
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
                    (
                        ?,
                        ?,
                        'SALE',
                        ?,
                        'BILL',
                        ?,
                        ?,
                        'Administrator',
                        ?
                    )
                    `,

                    [
                        product.id,
                        item.barcode,
                        -Math.abs(Number(item.qty)),
                        billData.bill_no,
                        `Sale against bill ${billData.bill_no}`,
                        now
                    ],

                    (insertErr) => {

                        if(insertErr){

                            db.run("ROLLBACK");

                            reject(insertErr);

                            return;

                        }

                        pending--;

                        if(pending === 0){

                            commit();

                        }

                    }

                );

            }

        );

    });

}

            function commit(){

    db.run(

        "COMMIT",

        async (err)=>{

            if(err){

                reject(err);

            }

            else{

                await logInvoiceGenerated(

                    billData.bill_no,

                    billData.net_amount,

                    billData.total_qty

                );

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

            await logPaymentCorrected(

                data.bill_no

            );

            resolve(true);

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

                    WHERE DATE(bill_date)=DATE('now','localtime')

                ) AS todayBills,

                (

                    SELECT IFNULL(SUM(net_amount),0)

                    FROM bills

                    WHERE DATE(bill_date)=DATE('now','localtime')

                ) AS todaySales,
                
                (

                    SELECT IFNULL(SUM(total_qty),0)

                    FROM bills

                    WHERE DATE(bill_date)=DATE('now','localtime')

                ) AS todayQtySold,

                (

                    SELECT COUNT(*)

                    FROM bills

                    WHERE strftime('%Y-%m',bill_date)=strftime('%Y-%m','now','localtime')

                ) AS mtdBills,

                (

                    SELECT IFNULL(SUM(net_amount),0)

                    FROM bills

                    WHERE strftime('%Y-%m',bill_date)=strftime('%Y-%m','now','localtime')

                ) AS mtdSales,

                (

                    SELECT IFNULL(SUM(cash_amount),0)

                    FROM bills

                    WHERE DATE(bill_date)=DATE('now','localtime')

                ) AS cashToday,

                (

                    SELECT IFNULL(SUM(upi_amount),0)

                    FROM bills

                    WHERE DATE(bill_date)=DATE('now','localtime')

                ) AS upiToday,

                (

                    SELECT IFNULL(SUM(card_amount),0)

                    FROM bills

                    WHERE DATE(bill_date)=DATE('now','localtime')

                ) AS cardToday

        `;

        db.get(

            sql,

            [],

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
    getNextBillNumber,
    getBills,
    getBillDetails,
    updatePaymentAllocation,
    getPaymentCorrections,
    getDashboardSummary

};