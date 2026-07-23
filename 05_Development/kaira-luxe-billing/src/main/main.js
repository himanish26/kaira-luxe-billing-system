const {

    getProductByBarcode,
    getInventorySummary,
    getAllProducts,
    searchProducts,
    getLastImport

} = require("../database/productService");

const resetInventory =
    require("../database/resetInventory");

const {
    saveBill,
    getNextBillNumber,
    getBills,
    getBillDetails,
    updatePaymentAllocation
} = require("../database/billService");

const {

    getSettings,

    saveSettings

} = require("../database/settingsService");

const importProducts =
    require('../database/importProducts');

const {
    app,
    BrowserWindow,
    ipcMain,
    dialog
} = require('electron');

const path = require('path');

const ExcelJS = require("exceljs");
const fs = require("fs");

const {
    printBill,
    saveBillPdf
} = require("./printer");

require('../database/database');

function createWindow() {

    const win = new BrowserWindow({

        width: 1400,

        height: 900,

        title: 'Kaira Luxe Billing System',

        webPreferences: {

            preload: path.join(
                __dirname,
                'preload.js'
            )

        }

    });

    win.loadFile(
        path.join(
            __dirname,
            '../renderer/index.html'
        )
    );

}

app.whenReady().then(() => {

    createWindow();

});
ipcMain.handle(
    'select-excel-file',
    async () => {

        const result =
            await dialog.showOpenDialog({

                properties: ['openFile'],

                filters: [
                    {
                        name: 'Excel Files',
                        extensions: [
                            'xlsx',
                            'xls'
                        ]
                    }
                ]

            });

        if (result.canceled) {

            return null;

        }

        return result.filePaths[0];

    }
);

ipcMain.handle(
    'import-products',
    async (event, filePath) => {

        try {

            const result = await importProducts(filePath);

return result;

        } catch (error) {

            return {

                success: false,

                error: error.message

            };

        }

    }
);

ipcMain.handle(
    'get-product',
    async (event, barcode) => {

        try {

            const product =
                await getProductByBarcode(
                    barcode
                );

            return product;

        } catch (error) {

            console.error(error);

            return null;

        }

    }
);

/* ===========================================
   INVENTORY SUMMARY
=========================================== */

ipcMain.handle(
    "get-inventory-summary",
    async () => {

        return await getInventorySummary();

    }
);


/* ===========================================
   GET ALL PRODUCTS
=========================================== */

ipcMain.handle(
    "get-products",
    async () => {

        return await getAllProducts();

    }
);


/* ===========================================
   SEARCH PRODUCTS
=========================================== */

ipcMain.handle(
    "search-products",
    async (event, keyword) => {

        return await searchProducts(keyword);

    }
);

ipcMain.handle(
    "get-last-import",
    async () => {

        return await getLastImport();

    }
);

ipcMain.handle(
    "reset-inventory",
    async () => {

        try{

            return await resetInventory();

        }

        catch(error){

            console.error(error);

            return{

                success:false,

                error:error.message

            };

        }

    }
);

ipcMain.handle(
    "save-bill",
    async (event, billData) => {

        try {

            await saveBill(billData);

            return {
                success: true
            };

        } catch (error) {

            console.error(error);

            return {
                success: false,
                error: error.message
            };

        }

    }
);

ipcMain.handle(
    "get-next-bill-number",
    async () => {

        try {

            return await getNextBillNumber();

        } catch (error) {

            console.error(error);

            return null;

        }

    }
);
ipcMain.handle(
    "get-bills",
    async () => {

        return await getBills();

    }
);


ipcMain.handle(
    "get-bill-details",
    async (event, billNo) => {

        return await getBillDetails(billNo);

    }
);

ipcMain.handle(
    "update-payment-allocation",
    async (event, data) => {

        try {

            await updatePaymentAllocation(data);

            return {

                success: true

            };

        }

        catch(error){

            console.error(error);

            return {

                success: false,

                error: error.message

            };

        }

    }
);

ipcMain.handle(
    "print-bill",
    async (event, billData) => {

        try{

            await printBill(billData);

            return {
                success:true
            };

        }

        catch(error){

            console.error(error);

            return{
                success:false,
                error:error.message
            };

        }

    }
);

ipcMain.handle(
    "save-bill-pdf",
    async (event, billData) => {

        try{

            await saveBillPdf(billData);

            return{
                success:true
            };

        }

        catch(error){

            console.error(error);

            return{
                success:false,
                error:error.message
            };

        }

    }
);

ipcMain.handle(

    "get-settings",

    async () => {

        return await getSettings();

    }

);

ipcMain.handle(

    "save-settings",

    async (event, settings) => {

        await saveSettings(settings);

        return true;

    }

);

ipcMain.handle(
    "export-inventory",
    async () => {

        try {

            const products =
                await getAllProducts();

            const workbook =
                new ExcelJS.Workbook();

            const sheet =
                workbook.addWorksheet("Inventory");

            sheet.columns = [

                { header: "Barcode", key: "barcode", width: 18 },
                { header: "SKU", key: "sku", width: 18 },
                { header: "Brand", key: "brand", width: 18 },
                { header: "Category", key: "category", width: 20 },
                { header: "Product", key: "product_name", width: 35 },
                { header: "Style Code", key: "style_code", width: 18 },
                { header: "Size", key: "size", width: 12 },
                { header: "Colour", key: "colour", width: 15 },
                { header: "MRP", key: "mrp", width: 12 },
                { header: "Selling Price", key: "selling_price", width: 15 },
                { header: "Cost Price", key: "cost_price", width: 15 },
                { header: "GST", key: "gst_rate", width: 10 },
                { header: "HSN", key: "hsn_code", width: 15 },
                { header: "Opening Stock", key: "opening_stock", width: 15 },
                { header: "Reorder Level", key: "reorder_level", width: 15 },
                { header: "Supplier", key: "supplier", width: 20 },
                { header: "Active", key: "active", width: 10 }

            ];

            products.forEach(product => {

                sheet.addRow(product);

            });

            const result =
                await dialog.showSaveDialog({

                    defaultPath:
                        `Inventory_${new Date().toISOString().slice(0,10)}.xlsx`

                });

            if(result.canceled){

                return {
                    success:false
                };

            }

            await workbook.xlsx.writeFile(
                result.filePath
            );

            return{

                success:true

            };

        }

        catch(error){

            console.error(error);

            return{

                success:false,

                error:error.message

            };

        }

});

const packageInfo = require("../../package.json");

ipcMain.handle("get-app-info", async () => {

    return {

        appName: packageInfo.productName || packageInfo.description,

        version: packageInfo.version,

        author: packageInfo.author,

        license: packageInfo.license,

        electron: process.versions.electron,

        node: process.versions.node,

        chrome: process.versions.chrome,

        platform: process.platform,

        architecture: process.arch,

        database: "SQLite",

        schema: "v1"

    };

});

