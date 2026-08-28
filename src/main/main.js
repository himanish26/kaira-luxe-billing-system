require("dotenv").config();

const {
    verifyEmailConnection
} = require("../services/emailService");

const {

    app,

    BrowserWindow,

    ipcMain,

    dialog,

} = require("electron");

const path = require("path");
const fs = require("fs");
const os = require("os");

const ExcelJS = require("exceljs");

const {
    exportReport
} = require("../database/reportService");

const {
    downloadProductMasterTemplate
} = require("../database/productMasterExporter");

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
    getSystemStatus
} = require("./statusService");

const {
    databaseReady
} = require("../database/database");

const {

    saveBill,

    getNextBillNumber,

    getBills,

    getTransactionHistory,

    getBillDetails,

    updatePaymentAllocation,

    getPaymentCorrections,

    getDashboardSummary

} = require("../database/billService");

const {
    getBillForReturn,
    getNextReturnNumber,
    saveReturn,
    getStoreCreditDetails,
    getAvailableStoreCreditByMobile,
    getStoreCreditForReprint,
    getReturnDetails
} = require("../database/returnService");

const {

    createBackup,

    getBackupHistory,

    validateBackup,

    restoreBackup

} = require("../services/backupService");

const {

    getSettings,

    saveSettings

} = require("../database/settingsService");

const {

    importProducts

} = require(
    "../database/importProducts"
);

const inventoryTransactionService = require("../database/inventoryTransactionService");

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

    logActivity,
    getActivities,
    searchActivities,
    archiveActivities

} = require("../database/activityService");

const {

    exportActivityLog

} = require("../database/activityExporter");

const {

    logApplicationStarted,

    logApplicationClosed,

    logRestoreCompleted

} = require("../database/logService");

const {

    startBackupScheduler

} = require("../services/backupScheduler");

const {

    printBill,

    printStoreCredit,

    saveBillPdf,

    printTestReceipt,

    printDayClosingReceipt

} = require("./printer");


const {

    getDayClosingSummary,
    isBusinessDayClosed,
    closeBusinessDay,
    reopenBusinessDay

} = require("../database/dayClosingService");

let mainWindow;

let isAppQuitting = false;

function createWindow() {

    mainWindow = new BrowserWindow({

        width: 1400,

        height: 900,

        show: false,

        title: "Kaira Luxe Billing System",

        webPreferences: {

            preload: path.join(
                __dirname,
                "preload.js"
            )

        }

    });

    mainWindow.loadFile(

        path.join(

            __dirname,

            "../renderer/index.html"

        )

    );

    mainWindow.once("ready-to-show", () => {

    mainWindow.maximize();

    mainWindow.show();

});


    mainWindow.on(

        "close",

        async (event) => {

            if (isAppQuitting) {

                return;

            }

            event.preventDefault();

            const result = await dialog.showMessageBox(

                mainWindow,

                {

                    type: "question",

                    buttons: [

                        "Cancel",

                        "Exit"

                    ],

                    defaultId: 1,

                    cancelId: 0,

                    title: "Exit KAIRA LUXE BILLING SYSTEM",

                    message: "Are you sure you want to exit KAIRA LUXE BILLING SYSTEM?"

                }

            );

            if (result.response === 1) {

                isAppQuitting = true;

                try {

                    await logApplicationClosed();

                }

                catch (error) {

                    console.error(error);

                }

                mainWindow.close();

            }

        }

    );

}

app.whenReady().then(async () => {

    try {

        await databaseReady;

        const restoreIndex =
            process.argv.indexOf(
                "--restore-completed"
            );

        const restoreFileName =
            restoreIndex !== -1 &&
            process.argv[restoreIndex + 1]
                ? path.basename(
                    process.argv[restoreIndex + 1]
                )
                : null;

        console.log(
            "✓ Kaira Luxe Billing System database ready. Starting application."
        );

        if (restoreFileName) {

            try {

                await logRestoreCompleted(
                    restoreFileName
                );

            }
            catch (error) {

                console.error(
                    "Restore Activity Log Error:",
                    error
                );

            }

        }

        try {

            await logApplicationStarted();

        }
        catch (error) {

            console.error(
                "Application Start Activity Log Error:",
                error
            );
        }

        startBackupScheduler();

        createWindow();

    }

    catch (error) {

        console.error(
            "✗ Kaira Luxe Billing System database initialization failed:",
            error
        );

        await dialog.showMessageBox({

            type: "error",

            title: "Database Initialization Failed",

            message:
                "Kaira Luxe Billing System could not initialize its database.",

            detail:
                error.message

        });

        app.quit();

    }

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

/* ============================================================
   INVENTORY TRANSACTION HANDLERS
============================================================ */


/* GET PRODUCT FOR STOCK INWARD / OUTWARD */

ipcMain.handle(
    "get-inventory-product",

    async (event, barcode) => {

        try {

            return await inventoryTransactionService
                .getInventoryProductByBarcode(barcode);

        }

        catch (error) {

            console.error(
                "GET INVENTORY PRODUCT ERROR:",
                error
            );

            throw error;

        }

    }
);


/* STOCK INWARD */

ipcMain.handle(
    "stock-inward",

    async (event, data) => {

        try {

            return await inventoryTransactionService
                .stockInward(data);

        }

        catch (error) {

            console.error(
                "STOCK INWARD ERROR:",
                error
            );

            throw error;

        }

    }
);


/* STOCK OUTWARD */

ipcMain.handle(
    "stock-outward",

    async (event, data) => {

        try {

            return await inventoryTransactionService
                .stockOutward(data);

        }

        catch (error) {

            console.error(
                "STOCK OUTWARD ERROR:",
                error
            );

            throw error;

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

            const closed =
                await isBusinessDayClosed();

            if (closed) {

                return {

                    success: false,

                    businessDayClosed: true,

                    error:
                        "Business Day is already closed. No further billing is allowed today."

                };

            }


            await saveBill(billData);

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
    "get-transaction-history",
    async () => {

        return await getTransactionHistory();

    }
);

ipcMain.handle(
    "get-store-credit-details",
    async (event, storeCreditNo) => {

        return await getStoreCreditDetails(
            storeCreditNo
        );

    }
);

ipcMain.handle(
    "get-return-details",
    async (event, returnNo) => {

        return await getReturnDetails(
            returnNo
        );

    }
);

ipcMain.handle(
    "get-available-store-credit-by-mobile",
    async (event, customerMobile) => {

        return await getAvailableStoreCreditByMobile(
            customerMobile
        );

    }
);

ipcMain.handle(
    "get-store-credit-for-reprint",
    async (event, storeCreditNo) => {

        return await getStoreCreditForReprint(
            storeCreditNo
        );

    }
);

ipcMain.handle(
    "get-bill-details",
    async (event, billNo) => {

        return await getBillDetails(billNo);

    }
);

/* ===========================================
   RETURN MANAGEMENT
=========================================== */

ipcMain.handle(
    "get-bill-for-return",
    async (event, billNo) => {

        return await getBillForReturn(billNo);

    }
);


ipcMain.handle(
    "get-next-return-number",
    async () => {

        return await getNextReturnNumber();

    }
);


ipcMain.handle(
    "save-return",
    async (event, returnData) => {

        try {

            return await saveReturn(
                returnData
            );

        }

        catch (error) {

            console.error(
                "Save return error:",
                error
            );

            return {

                success: false,

                error:
                    error.message

            };

        }

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

/* =====================================
   PRINT STORE CREDIT - INITIAL ISSUE
===================================== */

ipcMain.handle(
    "print-store-credit",
    async (event, storeCreditData) => {

        try {

            await printStoreCredit(
                storeCreditData
            );

            return {
                success: true
            };

        }

        catch (error) {

            console.error(
                "STORE CREDIT INITIAL PRINT ERROR:",
                error
            );

            return {
                success: false,
                error: error.message
            };

        }

    }
);


/* =====================================
   REPRINT STORE CREDIT
===================================== */

ipcMain.handle(
    "reprint-store-credit",
    async (event, storeCreditNo) => {

        try {

            const storeCreditData =
                await getStoreCreditForReprint(
                    storeCreditNo
                );

            if (!storeCreditData) {

                return {
                    success: false,
                    error:
                        "Store Credit cannot be reprinted because it is not currently valid for reprint."
                };

            }

            await printStoreCredit(
                storeCreditData
            );

            return {
                success: true
            };

        }

        catch (error) {

            console.error(
                "STORE CREDIT REPRINT ERROR:",
                error
            );

            return {
                success: false,
                error: error.message
            };

        }

    }
);

ipcMain.handle(

    "print-day-closing",

    async (

        event,

        dayClosingData

    ) => {

        try {

            await printDayClosingReceipt(

                dayClosingData

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

    "email:test",

    async () => {

        try {

            return await verifyEmailConnection();

        }

        catch (error) {

            console.error(
                "Email Test Error:",
                error
            );

            return {

                success: false,

                error: error.message

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
    "app:restart",
    (
        event,
        restoreFileName
    ) => {

        const relaunchArgs = [
            ...process.argv.slice(1)
        ];

        if (restoreFileName) {

            relaunchArgs.push(
                "--restore-completed",
                restoreFileName
            );

        }

        app.relaunch({
            args: relaunchArgs
        });

        app.exit(0);

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

ipcMain.handle(

    "get-day-closing-summary",

    async () => {

        return await getDayClosingSummary();

    }

);


ipcMain.handle(

    "get-business-day-status",

    async () => {

        try {

            const closed =
                await isBusinessDayClosed();

            return {

                closed: !!closed,

                closing:
                    closed || null

            };

        }

        catch (error) {

            console.error(error);

            return {

                closed: false,

                error: error.message

            };

        }

    }

);


ipcMain.handle(

    "close-business-day",

    async () => {

        try {

            return await closeBusinessDay();

        }

        catch (error) {

            console.error(
                "Close Business Day Error:",
                error
            );

            return {

                success: false,

                error: error.message

            };

        }

    }

);

ipcMain.handle(
    "reopen-business-day",
    async () => {

        try {

            const result =
                await reopenBusinessDay();

            return result;

        }

        catch (error) {

            console.error(
                "Business Day Re-open Error:",
                error
            );

            return {

                success: false,

                error:
                    error.message

            };

        }

    }
);