const XLSX = require("xlsx");
const path = require("path");
const db = require("./database");

const {

    logProductImport

} = require("./logService");


const PRODUCT_MASTER_FIELDS = new Set([
    "barcode",
    "sku",
    "brand",
    "segment",
    "category",
    "season",
    "collection",
    "product_name",
    "style_code",
    "size",
    "colour",
    "mrp",
    "discount",
    "selling_price",
    "cost_price",
    "gst_rate",
    "hsn_code",
    "opening_stock",
    "reorder_level",
    "supplier",
    "active"
]);


function normalizeProductMasterRow(row) {

    const normalized = {};

    Object.entries(row).forEach(([header, value]) => {

        const field = String(header)
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "");

        if (PRODUCT_MASTER_FIELDS.has(field)) {
            normalized[field] = value;
        }

    });

    return normalized;

}


function importProducts(filePath) {

    return new Promise((resolve, reject) => {

        try {

            /* ===========================================
               READ EXCEL FILE
            =========================================== */

            const workbook =
                XLSX.readFile(filePath);

            const sheet =
                workbook.Sheets[
                    workbook.SheetNames[0]
                ];

            const products =
                XLSX.utils
                    .sheet_to_json(sheet)
                    .map(normalizeProductMasterRow);


            /* ===========================================
               EMPTY FILE CHECK
            =========================================== */

            if (!products || products.length === 0) {

                resolve({
                    success: false,
                    error:
                        "The selected Product Master file is empty."
                });

                return;

            }


            /* ===========================================
               DUPLICATE BARCODE CHECK

               Same barcode appearing twice in one Excel
               file is blocked before any database change.
            =========================================== */

            const seenBarcodes =
                new Set();

            const duplicateBarcodes =
                [];

            products.forEach((product) => {

                const barcode =
                    String(
                        product.barcode || ""
                    ).trim();

                if (!barcode) {

                    return;

                }

                if (seenBarcodes.has(barcode)) {

                    duplicateBarcodes.push(
                        barcode
                    );

                }

                else {

                    seenBarcodes.add(
                        barcode
                    );

                }

            });


            if (duplicateBarcodes.length > 0) {

                resolve({

                    success: false,

                    error:
                        "Duplicate barcode(s) found in the Product Master: " +

                        duplicateBarcodes
                            .slice(0, 10)
                            .join(", ") +

                        (
                            duplicateBarcodes.length > 10
                                ? "..."
                                : ""
                        )

                });

                return;

            }


            let imported = 0;
            let updated = 0;
            let skipped = 0;

            const now =
                new Date().toISOString();


            /* ===========================================
               START SAFE DATABASE TRANSACTION
            =========================================== */

            db.serialize(() => {

                db.run(
                    "BEGIN TRANSACTION",
                    (beginError) => {

                        if (beginError) {

                            reject(
                                beginError
                            );

                            return;

                        }


                        let completed = 0;

                        let transactionFailed =
                            false;


                        /* =======================================
                           ROLLBACK IMPORT
                        ======================================= */

                        function failImport(error) {

                            if (
                                transactionFailed
                            ) {

                                return;

                            }

                            transactionFailed =
                                true;

                            db.run(
                                "ROLLBACK",
                                () => {

                                    console.error(
                                        "Product Import Failed:",
                                        error
                                    );

                                    reject(
                                        error
                                    );

                                }
                            );

                        }


                        /* =======================================
                           COMPLETE IMPORT
                        ======================================= */

                        function completeImport() {

                            if (
                                transactionFailed ||
                                completed !== products.length
                            ) {

                                return;

                            }


                            /* ===================================
                               UPDATE IMPORT LOG
                            =================================== */

                            db.run(
                                `
                                INSERT OR REPLACE INTO
                                inventory_import_log
                                (
                                    id,
                                    file_name,
                                    imported_on,
                                    products_imported
                                )
                                VALUES
                                (
                                    1,
                                    ?,
                                    ?,
                                    ?
                                )
                                `,
                                [
                                    path.basename(
                                        filePath
                                    ),

                                    new Date()
                                        .toLocaleString(),

                                    imported +
                                    updated
                                ],

                                (logError) => {

                                    if (logError) {

                                        failImport(
                                            logError
                                        );

                                        return;

                                    }


                                    /* ===========================
                                       COMMIT EVERYTHING
                                    =========================== */

                                    db.run(
                                        "COMMIT",

                                        (
                                            commitError
                                        ) => {

                                            if (
                                                commitError
                                            ) {

                                                failImport(
                                                    commitError
                                                );

                                                return;

                                            }


                                            /* ===================
                                               ACTIVITY LOG

                                               Runs only after
                                               successful commit.
                                            =================== */

                                            Promise
                                                .resolve()
                                                .then(
                                                    async () => {

                                                        try {

                                                            await logProductImport(
                                                                path.basename(
                                                                    filePath
                                                                ),

                                                                imported +
                                                                updated
                                                            );

                                                        }

                                                        catch (
                                                            logError
                                                        ) {

                                                            console.error(
                                                                "Product Import Log Error:",
                                                                logError
                                                            );

                                                        }


                                                        resolve({

                                                            success:
                                                                true,

                                                            imported,

                                                            updated,

                                                            skipped,

                                                            total:
                                                                products.length

                                                        });

                                                    }
                                                );

                                        }
                                    );

                                }
                            );

                        }


                        /* ===========================================
                           PROCESS EACH PRODUCT
                        =========================================== */

                        products.forEach(
                            (product) => {

                                const barcode =
                                    String(
                                        product.barcode ||
                                        ""
                                    ).trim();


                                /* ===============================
                                   MISSING BARCODE

                                   Skip the row safely.
                                =============================== */

                                if (!barcode) {

                                    skipped++;

                                    completed++;

                                    completeImport();

                                    return;

                                }


                                /* ===============================
                                   SAFE OPENING STOCK
                                =============================== */

                                const openingStock =
                                    Number(
                                        product.opening_stock
                                    );

                                const safeOpeningStock =
                                    Number.isFinite(
                                        openingStock
                                    )
                                        ? openingStock
                                        : 0;


                                /* ===============================
                                   NEGATIVE OPENING STOCK

                                   Do not allow negative opening
                                   stock from Product Master.
                                =============================== */

                                if (
                                    safeOpeningStock < 0
                                ) {

                                    skipped++;

                                    completed++;

                                    completeImport();

                                    return;

                                }


                                /* ===================================
                                   CHECK EXISTING PRODUCT
                                =================================== */

                                db.get(
                                    `
                                    SELECT
                                        id
                                    FROM products
                                    WHERE barcode = ?
                                    `,
                                    [
                                        barcode
                                    ],

                                    (
                                        findError,
                                        existingProduct
                                    ) => {

                                        if (
                                            findError
                                        ) {

                                            failImport(
                                                findError
                                            );

                                            return;

                                        }


                                        /* ===================================
                                           NEW PRODUCT

                                           A new product receives exactly
                                           ONE initial OPENING transaction.
                                        =================================== */

                                        if (
                                            !existingProduct
                                        ) {

                                            db.run(
                                                `
                                                INSERT INTO products
                                                (
                                                    barcode,
                                                    sku,
                                                    brand,
                                                    segment,
                                                    category,
                                                    season,
                                                    collection,
                                                    product_name,
                                                    style_code,
                                                    size,
                                                    colour,
                                                    mrp,
                                                    discount,
                                                    selling_price,
                                                    cost_price,
                                                    gst_rate,
                                                    hsn_code,
                                                    opening_stock,
                                                    reorder_level,
                                                    supplier,
                                                    active
                                                )
                                                VALUES
                                                (
                                                    ?,?,?,?,?,?,?,?,?,?,
                                                    ?,?,?,?,?,?,?,?,?,?,?
                                                )
                                                `,
                                                [
                                                    barcode,

                                                    product.sku,

                                                    product.brand,

                                                    product.segment ||
                                                    "Women",

                                                    product.category,

                                                    product.season ||
                                                    "All Season",

                                                    product.collection ||
                                                    "",

                                                    product.product_name,

                                                    product.style_code,

                                                    product.size,

                                                    product.colour,

                                                    product.mrp,

                                                    product.discount ??
                                                    0,

                                                    product.selling_price,

                                                    product.cost_price,

                                                    product.gst_rate,

                                                    product.hsn_code,

                                                    safeOpeningStock,

                                                    product.reorder_level,

                                                    product.supplier,

                                                    product.active ??
                                                    1
                                                ],

                                                function(
                                                    insertError
                                                ) {

                                                    if (
                                                        insertError
                                                    ) {

                                                        failImport(
                                                            insertError
                                                        );

                                                        return;

                                                    }


                                                    const productId =
                                                        this.lastID;


                                                    function finishNewProduct() {

                                                        imported++;

                                                        completed++;

                                                        completeImport();

                                                    }


                                                    /* =======================
                                                       ZERO OPENING STOCK

                                                       No inventory movement
                                                       is required.
                                                    ======================= */

                                                    if (
                                                        safeOpeningStock === 0
                                                    ) {

                                                        finishNewProduct();

                                                        return;

                                                    }


                                                    /* =======================
                                                       CREATE INITIAL OPENING
                                                       TRANSACTION

                                                       This is the ONLY
                                                       OPENING transaction
                                                       created by Product
                                                       Master import.
                                                    ======================= */

                                                    db.run(
                                                        `
                                                        INSERT INTO
                                                        inventory_transactions
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
                                                            'OPENING',
                                                            ?,
                                                            'PRODUCT_IMPORT',
                                                            ?,
                                                            ?,
                                                            'Administrator',
                                                            ?
                                                        )
                                                        `,
                                                        [
                                                            productId,

                                                            barcode,

                                                            safeOpeningStock,

                                                            path.basename(
                                                                filePath
                                                            ),

                                                            "Initial opening stock from Product Master import",

                                                            now
                                                        ],

                                                        (
                                                            stockError
                                                        ) => {

                                                            if (
                                                                stockError
                                                            ) {

                                                                failImport(
                                                                    stockError
                                                                );

                                                                return;

                                                            }


                                                            finishNewProduct();

                                                        }
                                                    );

                                                }
                                            );

                                            return;

                                        }


                                        /* ===================================
                                           EXISTING PRODUCT

                                           PRODUCT MASTER RULE:
                                           --------------------
                                           Update product details only.

                                           NEVER:
                                           - modify opening_stock
                                           - create another OPENING
                                           - create an ADJUSTMENT
                                             from a Product Master upload

                                           Inventory ledger is the
                                           permanent source of truth.
                                        =================================== */

                                        db.run(
                                            `
                                            UPDATE products
                                            SET

                                                sku = ?,

                                                brand = ?,

                                                segment = ?,

                                                category = ?,

                                                season = ?,

                                                collection = ?,

                                                product_name = ?,

                                                style_code = ?,

                                                size = ?,

                                                colour = ?,

                                                mrp = ?,

                                                discount = ?,

                                                selling_price = ?,

                                                cost_price = ?,

                                                gst_rate = ?,

                                                hsn_code = ?,

                                                reorder_level = ?,

                                                supplier = ?,

                                                active = ?

                                            WHERE barcode = ?
                                            `,
                                            [
                                                product.sku,

                                                product.brand,

                                                product.segment ||
                                                "Women",

                                                product.category,

                                                product.season ||
                                                "All Season",

                                                product.collection ||
                                                "",

                                                product.product_name,

                                                product.style_code,

                                                product.size,

                                                product.colour,

                                                product.mrp,

                                                product.discount ??
                                                0,

                                                product.selling_price,

                                                product.cost_price,

                                                product.gst_rate,

                                                product.hsn_code,

                                                product.reorder_level,

                                                product.supplier,

                                                product.active ??
                                                1,

                                                barcode
                                            ],

                                            (
                                                updateError
                                            ) => {

                                                if (
                                                    updateError
                                                ) {

                                                    failImport(
                                                        updateError
                                                    );

                                                    return;

                                                }


                                                updated++;

                                                completed++;

                                                completeImport();

                                            }
                                        );

                                    }
                                );

                            }
                        );

                    }
                );

            });

        }

        catch (error) {

            console.error(
                "Product Import Read Error:",
                error
            );

            reject(
                error
            );

        }

    });

}


module.exports = {

    importProducts

};
