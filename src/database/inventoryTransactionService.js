const db = require("./database");


/* ============================================================
   GET PRODUCT WITH LIVE STOCK
============================================================ */

function getInventoryProductByBarcode(barcode) {

    return new Promise((resolve, reject) => {

        const cleanBarcode =
            String(barcode).trim();

        console.log(
            "INVENTORY LOOKUP BARCODE:",
            cleanBarcode
        );

        db.get(
            `
            SELECT
                *
            FROM products
            WHERE TRIM(CAST(barcode AS TEXT)) = ?
            LIMIT 1
            `,
            [cleanBarcode],
            (err, product) => {

                if (err) {

                    console.error(
                        "INVENTORY PRODUCT LOOKUP ERROR:",
                        err
                    );

                    reject(err);

                    return;
                }

                console.log(
                    "INVENTORY PRODUCT FOUND:",
                    product
                );

                if (!product) {

                    resolve(null);

                    return;
                }

                db.get(
                    `
                    SELECT
                        COALESCE(
                            SUM(quantity),
                            0
                        ) AS current_stock
                    FROM inventory_transactions
                    WHERE product_id = ?
                    `,
                    [product.id],
                    (stockErr, stockRow) => {

                        if (stockErr) {

                            console.error(
                                "INVENTORY STOCK LOOKUP ERROR:",
                                stockErr
                            );

                            reject(stockErr);

                            return;
                        }

                        product.current_stock =
                            Number(
                                stockRow?.current_stock || 0
                            );

                        resolve(product);

                    }
                );

            }
        );

    });

}


/* ============================================================
   GET LIVE STOCK BY PRODUCT ID
============================================================ */

function getLiveStock(productId) {

    return new Promise((resolve, reject) => {

        db.get(
            `
            SELECT
                COALESCE(
                    SUM(quantity),
                    0
                ) AS current_stock

            FROM inventory_transactions

            WHERE product_id = ?
            `,
            [productId],
            (err, row) => {

                if (err) {

                    reject(err);
                    return;

                }

                resolve(
                    Number(row?.current_stock || 0)
                );

            }
        );

    });

}


/* ============================================================
   STOCK INWARD
============================================================ */

async function stockInward(data) {

    const {

        barcode,
        quantity,
        supplierId = null,
        invoiceNo = null,
        remarks = null,
        createdBy = "Administrator"

    } = data;


    const inwardQty = Number(quantity);


    if (
        !barcode ||
        !Number.isFinite(inwardQty) ||
        inwardQty <= 0
    ) {

        throw new Error(
            "Invalid stock inward quantity."
        );

    }


    const product =
        await getInventoryProductByBarcode(barcode);


    if (!product) {

        throw new Error(
            "Product not found for the scanned barcode. Contact ADMINISTRATOR."
        );

    }


    return new Promise((resolve, reject) => {

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
                supplier_id,
                invoice_no,
                remarks,
                created_by,
                created_at
            )

            VALUES
            (
                ?,
                ?,
                'INWARD',
                ?,
                'STOCK_INWARD',
                NULL,
                ?,
                ?,
                ?,
                ?,
                datetime('now')
            )
            `,
            [
                product.id,
                product.barcode,
                inwardQty,
                supplierId,
                invoiceNo,
                remarks,
                createdBy
            ],
            async function (err) {

                if (err) {

                    reject(err);
                    return;

                }


                try {

                    const newStock =
                        await getLiveStock(
                            product.id
                        );


                    resolve({

                        success: true,

                        transactionId: this.lastID,

                        product,

                        quantity: inwardQty,

                        currentStock: newStock

                    });

                }

                catch (error) {

                    reject(error);

                }

            }
        );

    });

}


/* ============================================================
   STOCK OUTWARD
============================================================ */

async function stockOutward(data) {

    const {

        barcode,
        quantity,
        reason,
        remarks = null,
        createdBy = "Administrator"

    } = data;


    const outwardQty = Number(quantity);


    if (
        !barcode ||
        !Number.isFinite(outwardQty) ||
        outwardQty <= 0
    ) {

        throw new Error(
            "Invalid stock outward quantity."
        );

    }


    const allowedReasons = {

        DAMAGE: "DAMAGE",

        SUPPLIER_RETURN:
            "SUPPLIER_RETURN",

        ADJUSTMENT:
            "ADJUSTMENT"

    };


    const transactionType =
        allowedReasons[reason];


    if (!transactionType) {

        throw new Error(
            "Invalid stock outward reason."
        );

    }


    const product =
        await getInventoryProductByBarcode(barcode);


    if (!product) {

        throw new Error(
            "Product not found for the scanned barcode. Contact ADMINISTRATOR."
        );

    }


    const currentStock =
        await getLiveStock(product.id);


    if (outwardQty > currentStock) {

        throw new Error(
            `Insufficient stock. Available stock: ${currentStock}`
        );

    }


    return new Promise((resolve, reject) => {

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
                ?,
                ?,
                'STOCK_OUTWARD',
                NULL,
                ?,
                ?,
                datetime('now')
            )
            `,
            [
                product.id,
                product.barcode,
                transactionType,
                -outwardQty,
                remarks,
                createdBy
            ],
            async function (err) {

                if (err) {

                    reject(err);
                    return;

                }


                try {

                    const newStock =
                        await getLiveStock(
                            product.id
                        );


                    resolve({

                        success: true,

                        transactionId: this.lastID,

                        product,

                        quantity: outwardQty,

                        transactionType,

                        currentStock: newStock

                    });

                }

                catch (error) {

                    reject(error);

                }

            }
        );

    });

}


/* ============================================================
   MODULE EXPORTS
============================================================ */

module.exports = {

    getInventoryProductByBarcode,

    getLiveStock,

    stockInward,

    stockOutward

};