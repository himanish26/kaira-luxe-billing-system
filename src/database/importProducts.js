const XLSX = require("xlsx");
const path = require("path");
const db = require("./database");

const {

    logProductImport,
    logProductImportFailed

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


function importProductsAttempt(filePath) {

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
                    .map((row, index) => {
                        const normalized = normalizeProductMasterRow(row);
                        normalized.__rowNumber = index + 2;
                        return normalized;
                    });


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
               PRE-MUTATION PRODUCT VALIDATION

               All workbook rows are validated before any
               duplicate check or database transaction begins.
            =========================================== */

            const validationErrors = [];
            const requiredTextFields = [
                "barcode",
                "brand",
                "category",
                "product_name"
            ];

            function isBlank(value) {
                return value === undefined ||
                    value === null ||
                    String(value).trim() === "";
            }

            function validateNonNegativeNumber(value, field, rowNumber) {
                if (isBlank(value)) {
                    validationErrors.push(
                        `Row ${rowNumber}: ${field} is required.`
                    );
                    return;
                }

                const numericValue = Number(value);
                if (!Number.isFinite(numericValue) || numericValue < 0) {
                    validationErrors.push(
                        `Row ${rowNumber}: ${field} must be numeric and >= 0.`
                    );
                }
            }

            products.forEach((product) => {
                const rowNumber = product.__rowNumber;

                requiredTextFields.forEach((field) => {
                    if (isBlank(product[field])) {
                        validationErrors.push(
                            `Row ${rowNumber}: ${field} is required.`
                        );
                    }
                });

                validateNonNegativeNumber(product.mrp, "mrp", rowNumber);
                validateNonNegativeNumber(product.gst_rate, "gst_rate", rowNumber);

                if (!isBlank(product.opening_stock)) {
                    const openingStock = Number(product.opening_stock);
                    if (!Number.isFinite(openingStock) || openingStock < 0) {
                        validationErrors.push(
                            `Row ${rowNumber}: opening_stock must be numeric and >= 0.`
                        );
                    }
                }
            });

            if (validationErrors.length > 0) {
                resolve({
                    success: false,
                    error:
                        "Product Master validation failed:\n" +
                        validationErrors.slice(0, 50).join("\n") +
                        (validationErrors.length > 50 ? "\n..." : "")
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

            let openingTransactionsCreated = 0;
            let openingQuantityCreated = 0;

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


                                    function commitImport() {

                                        /* =======================
                                           COMMIT EVERYTHING
                                        ======================= */

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

                                                                {
                                                                    imported,
                                                                    updated,
                                                                    skipped,
                                                                    total:
                                                                        products.length
                                                                }
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


                                    if (
                                        openingTransactionsCreated === 0
                                    ) {

                                        commitImport();
                                        return;

                                    }


                                    db.run(
                                        `
                                        INSERT INTO inventory_initialization
                                        (
                                            initialization_type,
                                            status,
                                            initialized_at,
                                            initialized_by,
                                            remarks
                                        )
                                        VALUES
                                        (
                                            'OPENING_STOCK',
                                            'COMPLETED',
                                            ?,
                                            'Administrator',
                                            ?
                                        )
                                        ON CONFLICT(initialization_type)
                                        DO UPDATE SET
                                            status = excluded.status,
                                            initialized_at = excluded.initialized_at,
                                            initialized_by = excluded.initialized_by,
                                            remarks = excluded.remarks
                                        `,
                                        [
                                            now,
                                            `${openingTransactionsCreated} products / ${openingQuantityCreated} units from Product Master import`
                                        ],
                                        (initializationError) => {

                                            if (initializationError) {

                                                failImport(
                                                    initializationError
                                                );
                                                return;

                                            }

                                            commitImport();

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


                                                            openingTransactionsCreated++;

                                                            openingQuantityCreated +=
                                                                safeOpeningStock;


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

function safeImportFailureReason(error) {
    const raw = String(error?.message || error || "Unexpected import error")
        .split(/[\r\n]+/)[0]
        .replace(/(?:[A-Za-z]:\\|\/)[^\s|]+/g, "[PATH]")
        .replace(/\b(?:SQLITE|Error:).*?(?=\s{2,}|$)/i, "Import transaction failed")
        .trim();
    return raw.slice(0, 500) || "Unexpected import error";
}

function importProducts(filePath) {
    const fileName = path.basename(String(filePath || ""));
    const recordFailure = async error => {
        try {
            await logProductImportFailed(fileName, safeImportFailureReason(error));
        } catch (logError) {
            console.error("Product Import Failure Log Error:", logError);
        }
    };
    return importProductsAttempt(filePath).then(async result => {
        if (!result || result.success !== true) {
            await recordFailure(result?.error);
        }
        return result;
    }).catch(async error => {
        await recordFailure(error);
        throw error;
    });
}


module.exports = {

    importProducts

};
