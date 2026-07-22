const db = require("./database");

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

                                commit();

                            }

                        }

                    );

                });

            }

            function commit(){

                db.run("COMMIT",(err)=>{

                    if(err){

                        reject(err);

                    }

                    else{

                        resolve(true);

                    }

                });

            }

        });

    });

}


function getBills() {

    return new Promise((resolve, reject) => {

        db.all(

            `
            SELECT
                bill_no,
                bill_date,
                bill_time,
                customer_name,
                customer_mobile,
                net_amount,
                payment_status
            FROM bills
            ORDER BY id DESC
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

                                        (err)=>{

                                            if(err){

                                                reject(err);

                                            }

                                            else{

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

module.exports = {
    saveBill,
    getNextBillNumber,
    getBills,
    getBillDetails,
    updatePaymentAllocation
};