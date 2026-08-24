const db = require("./database");


/* ===========================================
   GET BILL FOR RETURN
=========================================== */

function getBillForReturn(billNo) {

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


                if (!bill) {

                    resolve(null);
                    return;

                }


                db.all(

                    `
                    SELECT
                        bi.*,

                        COALESCE(
                            (
                                SELECT SUM(ri.quantity)
                                FROM return_items ri

                                INNER JOIN returns r
                                    ON r.id = ri.return_id

                                WHERE
                                    ri.original_bill_item_id = bi.id
                            ),
                            0
                        ) AS already_returned_qty

                    FROM bill_items bi

                    WHERE bi.bill_no = ?

                    ORDER BY bi.id ASC
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
   SAVE RETURN
=========================================== */

function saveReturn(returnData) {

    return new Promise((resolve, reject) => {

        db.serialize(() => {

            db.run("BEGIN TRANSACTION");


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

                    returnData.original_bill_no,

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

                        db.run("ROLLBACK");

                        reject(err);

                        return;

                    }


                    const returnId =
                        this.lastID;


                    let pending =
                        returnData.items.length;


                    if (pending === 0) {

                        db.run(
                            "ROLLBACK"
                        );

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

                                function(err) {

                                    if (failed) {

                                        return;

                                    }


                                    if (err) {

                                        failed = true;

                                        db.run(
                                            "ROLLBACK"
                                        );

                                        reject(err);

                                        return;

                                    }


                                    pending--;


                                    if (pending === 0) {

                                        db.run(
                                            "COMMIT",
                                            commitErr => {

                                                if (commitErr) {

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
                                                        returnData.return_no

                                                });

                                            }

                                        );

                                    }

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

    getBillForReturn,

    getNextReturnNumber,

    saveReturn

};