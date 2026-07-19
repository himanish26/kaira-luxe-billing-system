const db = require("./database");

/* ===========================================
   GET PRODUCT BY BARCODE
=========================================== */

function getProductByBarcode(barcode) {

    return new Promise((resolve, reject) => {

        db.get(
            `
            SELECT *
            FROM products
            WHERE barcode = ?
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
                COUNT(DISTINCT category) AS categories
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
            SELECT *
            FROM products
            ORDER BY product_name
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
            SELECT *
            FROM products
            WHERE
                barcode LIKE ?
                OR product_name LIKE ?
                OR brand LIKE ?
                OR style_code LIKE ?
            ORDER BY product_name
            `,
            [
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

