const XLSX = require("xlsx");
const db = require("./database");

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
                    category,
                    product_name,
                    style_code,
                    size,
                    colour,
                    mrp,
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
                (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                `,
                [
                    product.barcode,
                    product.sku,
                    product.brand,
                    product.category,
                    product.product_name,
                    product.style_code,
                    product.size,
                    product.colour,
                    product.mrp,
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

                    if(completed === products.length){

                        resolve({

                            success:true,

                            imported,

                            skipped,

                            total:products.length

                        });


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
    ]
);
                    }

                }

            );

        });

    });

}

module.exports = importProducts;