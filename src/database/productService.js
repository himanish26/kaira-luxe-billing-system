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
                COUNT(DISTINCT collection) AS collections,
                COALESCE(
                    (
                        SELECT SUM(it.quantity)
                        FROM inventory_transactions it
                        INNER JOIN products live_products
                            ON live_products.id = it.product_id
                    ),
                    0
                ) AS total_inventory
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

            ORDER BY p.product_name, p.id
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

function productSearchClause(keyword) {

    if (!keyword) {
        return {
            sql: "",
            params: []
        };
    }

    const pattern = `%${keyword}%`;

    return {
        sql: `
            WHERE
                p.barcode LIKE ?
                OR p.sku LIKE ?
                OR p.product_name LIKE ?
                OR p.brand LIKE ?
                OR p.segment LIKE ?
                OR p.category LIKE ?
                OR p.season LIKE ?
                OR p.collection LIKE ?
                OR p.style_code LIKE ?
        `,
        params: Array(9).fill(pattern)
    };

}

function getProductPage(options = {}) {

    const requestedPage = Number.parseInt(options.page, 10);
    const requestedPageSize = Number.parseInt(options.pageSize, 10);
    const pageSize = Number.isFinite(requestedPageSize)
        ? Math.min(Math.max(requestedPageSize, 1), 100)
        : 100;
    const keyword = String(options.keyword || "").trim();
    const search = productSearchClause(keyword);

    return new Promise((resolve, reject) => {

        db.get(
            `SELECT COUNT(*) AS total_count FROM products p ${search.sql}`,
            search.params,
            (countError, countRow) => {

                if (countError) {
                    reject(countError);
                    return;
                }

                const totalCount = Number(countRow?.total_count || 0);
                const totalPages = Math.max(
                    1,
                    Math.ceil(totalCount / pageSize)
                );
                const page = Number.isFinite(requestedPage)
                    ? Math.min(Math.max(requestedPage, 1), totalPages)
                    : 1;
                const offset = (page - 1) * pageSize;

                db.all(
                    `
                    SELECT
                        p.*,
                        COALESCE(SUM(it.quantity), 0) AS current_stock
                    FROM products p
                    LEFT JOIN inventory_transactions it
                        ON it.product_id = p.id
                    ${search.sql}
                    GROUP BY p.id
                    ORDER BY p.product_name, p.id
                    LIMIT ? OFFSET ?
                    `,
                    [...search.params, pageSize, offset],
                    (pageError, products) => {

                        if (pageError) {
                            reject(pageError);
                            return;
                        }

                        resolve({
                            products,
                            totalCount,
                            page,
                            pageSize,
                            totalPages
                        });

                    }
                );

            }
        );

    });

}

function searchProductPage(keyword, options = {}) {

    return getProductPage({
        ...options,
        keyword
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

            ORDER BY p.product_name, p.id
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
    getProductPage,
    searchProductPage,
    searchProducts,
    getLastImport

};

