const db = require("./database");

/* ===========================================
   GET PRODUCT BY BARCODE
=========================================== */

function getProductByBarcode(barcode) {

    return new Promise((resolve, reject) => {

        db.get(
            `
            SELECT
                p.*,

                COALESCE(
                    SUM(it.quantity),
                    0
                ) AS current_stock

            FROM products p

            LEFT JOIN inventory_transactions it
                ON it.product_id = p.id

            WHERE p.barcode = ?

            GROUP BY p.id
            `,
            [barcode],
            (err, row) => {

                if (err)
                    reject(err);
                else
                    resolve(row);

            }
        );

    });

}


/* ===========================================
   INVENTORY SUMMARY
=========================================== */

function getInventorySummary() {

    return new Promise((resolve, reject) => {

        db.get(
            `
            SELECT
                COUNT(*) AS products,
                COUNT(DISTINCT brand) AS brands,
                COUNT(DISTINCT segment) AS segments,
                COUNT(DISTINCT category) AS categories,
                COUNT(DISTINCT season) AS seasons,
                COUNT(DISTINCT collection) AS collections
            FROM products
            `,
            [],
            (err, row) => {

                if (err)
                    reject(err);
                else
                    resolve(row);

            }
        );

    });

}


/* ===========================================
   GET ALL PRODUCTS
=========================================== */

function getAllProducts() {

    return new Promise((resolve, reject) => {

        db.all(
            `
            SELECT
                p.*,

COALESCE(
    SUM(it.quantity),
    0
) AS current_stock

            FROM products p

            LEFT JOIN inventory_transactions it
                ON it.product_id = p.id

            GROUP BY p.id

            ORDER BY p.product_name
            `,
            [],
            (err, rows) => {

                if (err)
                    reject(err);
                else
                    resolve(rows);

            }
        );
    });
}


/* ===========================================
   SEARCH PRODUCTS
=========================================== */

function searchProducts(keyword) {

    return new Promise((resolve, reject) => {

        db.all(
            `
            SELECT
                p.*,

COALESCE( 
    SUM(it.quantity), 
    0 
) AS current_stock
            FROM products p

            LEFT JOIN inventory_transactions it
                ON it.product_id = p.id

            WHERE
                p.barcode LIKE ?
                OR p.product_name LIKE ?
                OR p.brand LIKE ?
                OR p.segment LIKE ?
                OR p.category LIKE ?
                OR p.season LIKE ?
                OR p.collection LIKE ?
                OR p.style_code LIKE ?

            GROUP BY p.id

            ORDER BY p.product_name
            `,
            [
                `%${keyword}%`,
                `%${keyword}%`,
                `%${keyword}%`,
                `%${keyword}%`,
                `%${keyword}%`,
                `%${keyword}%`,
                `%${keyword}%`,
                `%${keyword}%`
            ],
            (err, rows) => {

                if (err)
                    reject(err);
                else
                    resolve(rows);

            }
        );
    });
}

/* ===========================================
   LAST IMPORT
=========================================== */

function getLastImport() {

    return new Promise((resolve, reject) => {

        db.get(
            `
            SELECT *
            FROM inventory_import_log
            WHERE id = 1
            `,
            [],
            (err, row) => {

                if (err)
                    reject(err);
                else
                    resolve(row);

            }
        );

    });

}


module.exports = {

    getProductByBarcode,
    getInventorySummary,
    getAllProducts,
    searchProducts,
    getLastImport

};

