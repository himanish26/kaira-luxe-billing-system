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
    exportReport
} = require(
    "../database/reportService"
);

const {

    saveBill,
    getNextBillNumber,
    getBills,
    getBillDetails,
    updatePaymentAllocation,
    getPaymentCorrections,
    getDashboardSummary

} = require("../database/billService");

const {

    getSettings,

    saveSettings

} = require("../database/settingsService");

const {

    logActivity,
    getActivities,
    searchActivities,
    archiveActivities

} = require("../database/activityService");

const {

    exportActivityLog

} = require("../database/activityExporter");

const importProducts =
    require('../database/importProducts');

const {
    downloadProductMasterTemplate
} = require("../database/productMasterExporter");

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
    saveBillPdf,
    printTestReceipt
} = require("./printer");

const {
    getSystemStatus
} = require("./statusService");

require('../database/database');

const {

    createBackup,

    getBackupHistory,

    validateBackup,

    restoreBackup

} = require("../services/backupService");

const {

    connectGoogleDrive

} = require(

    "../services/googleDriveService"

);

const {
    checkForUpdates
} = require("../services/updateService");

const {

    downloadFile

} = require(

    "../services/downloadService"

);

const {

    launchInstaller

} = require(

    "../services/installerService"

);

const {

    verifyChecksum

} = require(

    "../services/checksumService"

);

const {

    verifyInstalledVersion

} = require(

    "../services/updateVerifier"

);

const {

    startBackupScheduler

} = require("../services/backupScheduler");

let mainWindow;

function createWindow() {

    mainWindow = new BrowserWindow({
        
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

    mainWindow.loadFile(
        path.join(
            __dirname,
            '../renderer/index.html'
        )
    );

}

app.whenReady().then(() => {

    createWindow();

    verifyInstalledVersion();

    startBackupScheduler();

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

    console.error(error);

    return {

        success: false,

        message: error.stack

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
    "get-payment-corrections",
    async (event, billNo) => {

        return await getPaymentCorrections(billNo);

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

/* ===========================================
   TEST PRINTER
=========================================== */

ipcMain.handle(

    "printer:test",

    async (event, printerName) => {

        try {

            return await printTestReceipt(printerName);

        }

        catch (error) {

            console.error(error);

            return {

                success: false,

                error: error.message

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
                { header: "Segment", key: "segment", width: 15 },
                { header: "Category", key: "category", width: 18 },
                { header: "Season", key: "season", width: 15 },
                { header: "Collection", key: "collection", width: 22 },
                { header: "Product Name", key: "product_name", width: 35 },
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

ipcMain.handle(
    "download-product-master-template",
    async () => {

        try {

            const result =
                await dialog.showSaveDialog({

                    defaultPath: "Kaira_Luxe_Product_Master_Template.xlsx",

                    filters: [

                        {

                            name: "Excel Workbook",

                            extensions: ["xlsx"]

                        }

                    ]

                });

            if (result.canceled) {

                return {

                    success: false,

                    cancelled: true

                };

            }

            await downloadProductMasterTemplate(
                result.filePath
            );

            return {

                success: true

            };

        }

        catch (error) {

            console.error(error);

            return {

                success: false,

                error: error.message

            };

        }

    }
);

ipcMain.handle(

    "export-report",

    async (event, request) => {

        try {

            const today = new Date();

const dd = String(today.getDate()).padStart(2, "0");
const mm = String(today.getMonth() + 1).padStart(2, "0");
const yyyy = today.getFullYear();

const formattedDate = `${dd}_${mm}_${yyyy}`;

let fileName;

switch (request.reportType) {

    case "business":

        fileName =
            `KL_Business_Report_${formattedDate}.xlsx`;

        break;

    case "gst":

        fileName =
            `KL_GST_Report_${formattedDate}.xlsx`;

        break;

    case "product":

        fileName =
            `KL_Product_Sales_Report_${formattedDate}.xlsx`;

        break;

    case "customer":

        fileName =
            `KL_Customer_Purchase_Report_${formattedDate}.xlsx`;

        break;

    default:

        fileName =
            `KL_Report_${formattedDate}.xlsx`;

}

const result =
    await dialog.showSaveDialog({

        defaultPath: fileName,

        filters: [

            {

                name: "Excel Workbook",

                extensions: ["xlsx"]

            }

        ]

    });

if (result.canceled) {

    return {

        success: false,

        cancelled: true

    };

}

return await exportReport(

    request,

    result.filePath

);

        }

        catch (error) {

            console.error(error);

            return {

                success: false,

                error: error.message

            };

        }

    }

);

const packageInfo = require("../../package.json");

ipcMain.handle(

    "get-dashboard-summary",

    async () => {

        try {

            return await getDashboardSummary();

        }

        catch (error) {

            console.error(

                "Dashboard Summary Error:",

                error

            );

            return {

                products: 0,
                customers: 0,

                todayBills: 0,
                todaySales: 0,

                mtdBills: 0,
                mtdSales: 0,

                cashToday: 0,
                upiToday: 0,
                cardToday: 0

            };

        }

    }

);

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

/* ===========================================
   SYSTEM STATUS
=========================================== */

ipcMain.handle(

    "get-system-status",

    async () => {

        try {

            return await getSystemStatus();

        }

        catch (error) {

            console.error(

                "System Status Error:",

                error

            );

            return {

                database: {

                    healthy: false,

                    status: "Error",

                    latency: null

                },

                internet: {

                    online: false,

                    status: "Offline"

                },

                printer: {

                    status: "Unknown"

                },

                backup: {

                    status: "Unknown"

                }

            };

        }

    }

);

ipcMain.handle(

    "backup:create",

    async () => {

        try {

            return await createBackup();

        }

        catch (error) {

            console.error(error);

            return {

                success: false,

                message: error.message

            };

        }

    }

);

ipcMain.handle(

    "backup:getHistory",

    async () => {

        try {

            return await getBackupHistory();

        }

        catch (error) {

            console.error(error);

            return [];

        }

    }

);

ipcMain.handle(

    "backup:selectFolder",

    async () => {

        const result =
            await dialog.showOpenDialog({

                properties: [

                    "openDirectory"

                ]

            });

        if (result.canceled) {

            return null;

        }

        return result.filePaths[0];

    }

);

ipcMain.handle(

    "backup:validate",

    async (event, zipPath) => {

        return await validateBackup(zipPath);

    }

);

ipcMain.handle(

    "backup:restore",

    async (

        event,

        zipPath

    ) => {

        return await restoreBackup(
            zipPath
        );

    }

);

ipcMain.handle(

    "restore:selectFile",

    async () => {

        const { canceled, filePaths } =
            await dialog.showOpenDialog({

                title: "Select Backup",

                properties: [

                    "openFile"

                ],

                filters: [

                    {

                        name: "Backup ZIP",

                        extensions: [

                            "zip"

                        ]

                    }

                ]

            });

        return {

            canceled,

            filePath:

                filePaths[0]

        };

    }

);
/* ===========================================
   SHOW MESSAGE BOX
=========================================== */

/* ===========================================
   GET INSTALLED PRINTERS
=========================================== */

ipcMain.handle(

    "printer:getAll",

    async () => {

        try {

            const printers =
                await mainWindow.webContents.getPrintersAsync();

                console.log("===== INSTALLED PRINTERS =====");
                console.log(printers);

            return {

                success: true,

                printers

            };

        }

        catch (error) {

            console.error(error);

            return {

                success: false,

                message: error.message

            };

        }

    }

);

ipcMain.handle(

    "dialog:showMessageBox",

    async (event, options) => {

        return await dialog.showMessageBox(

            BrowserWindow.getFocusedWindow(),

            options

        );

    }

);



ipcMain.handle(

    "updates:check",

    async () => {

        return await checkForUpdates();

    }

);

ipcMain.handle(

    "updates:download",

    async (

        event,

        url,

        fileName,

        version

    ) => {

        try {

            const downloadedFile =

                await downloadFile(

                    event,

                    url,

                    fileName,

                    version

                );

            return {

                success: true,

                filePath:

                    downloadedFile

            };

        }

        catch (error) {

            console.error(error);

            return {

                success: false,

                message:

                    error.message

            };

        }

    }

);

ipcMain.handle(

    "updates:install",

    async (

        event,

        installerPath,

        expectedHash

    ) => {

        try {

            console.log("Installer Path:", installerPath);

console.log("Expected Hash:", expectedHash);

const checksumValid =

    await verifyChecksum(

        installerPath,

        expectedHash

    );

if (!checksumValid) {

    try {

        if (fs.existsSync(installerPath)) {

            fs.unlinkSync(installerPath);

        }

    }

    catch (error) {

        console.error(

            "Failed to delete invalid installer:",

            error

        );

    }

    return {

        success: false,

        message:

            "Downloaded installer failed checksum verification."

    };

}

                await launchInstaller(

                    installerPath

                );

                await new Promise(

                    resolve =>

                        setTimeout(

                            resolve,

                            1000

                        )

                );

                app.quit();

            return {

                success: true

            };

        }

        

        catch (error) {

            console.error(error);

            return {

                success: false,

                message: error.message

            };

        }

    }

);

ipcMain.handle(

    "google:connect",

    async () => {

        try {

            return await connectGoogleDrive();

        }

        catch (error) {

            console.error(error);

            return {

                success: false,

                message: error.message

            };

        }

    }

);

/* ===========================================
   ACTIVITY LOG
=========================================== */

ipcMain.handle(

    "activity:log",

    async (event, activity) => {

        try {

            return await logActivity(activity);

        }

        catch (error) {

            console.error(error);

            return {

                success: false,

                message: error.message

            };

        }

    }

);

ipcMain.handle(

    "activity:get",

    async () => {

        try {

            return await getActivities();

        }

        catch (error) {

            console.error(error);

            return [];

        }

    }

);

/* ===========================================
   EXPORT ACTIVITY LOG
=========================================== */

ipcMain.handle(

    "activity:export",

    async () => {

        try {

            return await exportActivityLog();

        }

        catch (error) {

            console.error(error);

            return {

                success: false,

                message: error.message

            };

        }

    }

);

/* ===========================================
   ARCHIVE ACTIVITY LOG
=========================================== */

ipcMain.handle(

    "activity:archive",

    async () => {

        try {

            // 1. Export Excel
            const exportResult =
                await exportActivityLog();

            if (
                !exportResult.success
            ) {

                return exportResult;

            }

            // 2. Delete activities
            await archiveActivities();

            // 3. Create archive log
            await logActivity({

                category: "SYSTEM",

                action: "Activity Log Archived",

                details:
                    exportResult.fileName,

                user_name: "Administrator",

                status: "SUCCESS"

            });

            return {

                success: true,

                fileName:
                    exportResult.fileName

            };

        }

        catch (error) {

            console.error(error);

            return {

                success: false,

                message:
                    error.message

            };

        }

    }

);