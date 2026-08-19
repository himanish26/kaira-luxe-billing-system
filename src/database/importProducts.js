const XLSX = require("xlsx");
const path = require("path");
const db = require("./database");

const {

    logProductImport

} = require("./logService");

function importProducts(filePath) {

    return new Promise((resolve, reject) => {

        const workbook = XLSX.readFile(filePath);

        const sheet = workbook.Sheets[workbook.SheetNames[0]];

        const products = XLSX.utils.sheet_to_json(sheet);

        let imported = 0;
        let skipped = 0;
        let completed = 0;

        products.forEach(product => {

            db.run(
                `
                INSERT OR IGNORE INTO products
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
                (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                `,
                [
                    product.barcode,
                    product.sku,
                    product.brand,

                    product.segment || "Women",

                    product.category,

                    product.season || "All Season",

                    product.collection || "",

                    product.product_name,
                    product.style_code,
                    product.size,
                    product.colour,
                    product.mrp,
                    product.discount ?? 0,
                    product.selling_price,
                    product.cost_price,
                    product.gst_rate,
                    product.hsn_code,
                    product.opening_stock,
                    product.reorder_level,
                    product.supplier,
                    product.active ?? 1
                ],

                function(err){

                    completed++;

                    if(err){

                        console.error(err);

                    }
                    else if(this.changes === 1){

                        imported++;

                    }
                    else{

                        skipped++;

                    }

                    if (completed === products.length) {

    db.run(

        `
        INSERT OR REPLACE INTO inventory_import_log
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
            require("path").basename(filePath),
            new Date().toLocaleString(),
            imported
        ],

        async function (err) {

            if (err) {

                return reject(err);

            }

            await logProductImport(imported);

            resolve({

                success: true,

                imported,

                skipped,

                total: products.length

            });

        }

    );

}
                    }

                

            );

        });

    });

}

module.exports = importProducts;