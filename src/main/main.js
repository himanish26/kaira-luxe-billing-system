require("dotenv").config();

const {

    app,

    BrowserWindow,

    ipcMain,

    dialog,

} = require("electron");

const path = require("path");
const fs = require("fs");
const os = require("os");
const technicalLogger = require("../services/technicalLogger");

technicalLogger.initialize({
    logDirectory: path.join(app.getPath("userData"), "logs"),
    appVersion: app.getVersion(),
    platform: process.platform,
    isPackaged: app.isPackaged,
    sensitivePaths: [
        { value: app.getPath("userData"), label: "[USER_DATA]" },
        { value: app.getPath("temp"), label: "[TEMP]" },
        { value: os.homedir(), label: "[HOME]" }
    ]
});
technicalLogger.info("APPLICATION", "KLBS application session started", {
    version: app.getVersion(),
    platform: process.platform,
    packaged: app.isPackaged
});

let fatalHandling = false;
process.on("uncaughtException", error => {
    if (fatalHandling) return;
    fatalHandling = true;
    technicalLogger.fatal("UNCAUGHT_EXCEPTION", "Uncaught main-process exception", error);
    try { app.exit(1); } catch (_) { process.exitCode = 1; }
});
process.on("unhandledRejection", reason => {
    technicalLogger.error(
        "UNHANDLED_REJECTION",
        "Unhandled main-process promise rejection",
        reason instanceof Error ? reason : new Error(String(reason || "Unknown rejection"))
    );
});

const {
    verifyEmailConnection
} = require("../services/emailService");

const {
    exportReport
} = require("../database/reportService");

const {
    exportInventory
} = require("../database/inventoryExporter");

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
    getSystemStatus,
    getStartupCheck
} = require("./statusService");

const database = require("../database/database");
const { databaseReady } = database;
const masterRecoveryVerifier = require("../config/masterRecoveryVerifier");
const { createAdministratorSecurityService } = require("../services/administratorSecurityService");
const administratorSecurity = createAdministratorSecurityService(database, {
    masterVerifier: masterRecoveryVerifier
});

function requireSecurityGrant(grant, purpose) {
    if (!administratorSecurity.consumeGrant(grant, purpose)) {
        throw new Error("Required authorization is missing, invalid, or has expired.");
    }
}

const {

    saveBill,

    validateBillSettlement,

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
    getReturnDetails,
    getCreditNoteDetails
} = require("../database/returnService");

const {

    createBackup,

    getBackupHistory,

    validateBackup,

    restoreBackup

} = require("../services/backupService");

const {

    getRendererSettings,

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

    logRestoreCompleted,

    logActivityArchived,

    logDataExported,

    logAdministratorAction,
    logBusinessDayClosed,
    logBusinessDayReopened,
    logDsrSyncSucceeded,
    logDsrSyncFailed

} = require("../database/logService");

const {

    startBackupScheduler

} = require("../services/backupScheduler");

const {

    printBill,

    printStoreCredit,

    saveBillPdf,

    printTestReceipt,

    printDayClosingReceipt,
    printCreditNote,
    saveCreditNotePdf

} = require("./printer");


const {
    createDayClosingService
} = require("../database/dayClosingService");
const {
    getDayClosingSummary,
    getDayClosingSnapshot,
    getBusinessDayState,
    closeBusinessDay,
    reopenBusinessDay,
    retryDsrSync
} = createDayClosingService({
    database,
    klbsVersion: app.getVersion(),
    logBusinessDayClosed,
    logBusinessDayReopened,
    logDsrSyncSucceeded,
    logDsrSyncFailed
});

let mainWindow;
let splashWindow = null;
let splashShownAt = 0;

let isAppQuitting = false;
let orderlyShutdownLogged = false;

function attachWindowDiagnostics(window, component) {
    window.webContents.on("did-fail-load", (event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
        if (!isMainFrame) return;
        technicalLogger.error(component, "Window content failed to load", null, {
            errorCode,
            errorDescription
        });
    });
    window.webContents.on("render-process-gone", (event, details) => {
        technicalLogger.fatal(component, "Renderer process terminated unexpectedly", null, {
            reason: details && details.reason,
            exitCode: details && details.exitCode
        });
    });
}

app.on("before-quit", () => {
    if (orderlyShutdownLogged) return;
    orderlyShutdownLogged = true;
    technicalLogger.info("APPLICATION", "KLBS application shutdown requested");
});

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
    attachWindowDiagnostics(mainWindow, "MAIN_WINDOW");

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
                technicalLogger.info("APPLICATION", "Orderly application exit confirmed");

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

function createSplashWindow() {
    splashWindow = new BrowserWindow({
        width: 680,
        height: 590,
        center: true,
        frame: false,
        resizable: false,
        maximizable: false,
        minimizable: false,
        show: false,
        backgroundColor: "#ffffff",
        webPreferences: {
            preload: path.join(__dirname, "startupPreload.js")
        }
    });
    splashWindow.loadFile(path.join(__dirname, "../renderer/startupSplash.html"));
    attachWindowDiagnostics(splashWindow, "STARTUP_SPLASH");
    splashWindow.once("ready-to-show", () => {
    splashShownAt = Date.now();
    splashWindow.show();
});
    splashWindow.on("closed", () => { splashWindow = null; });
}

app.whenReady().then(async () => {

    try {

        await databaseReady;
        technicalLogger.info("DATABASE", "Database readiness checkpoint completed");

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
        createSplashWindow();

    }

    catch (error) {

        technicalLogger.fatal(
            "APPLICATION_STARTUP",
            "KLBS startup failed before operational readiness",
            error
        );

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

ipcMain.handle("startup:get-metadata", () => ({
    version: app.getVersion(),
    developer: "Himanish Patnaik",
    copyright: "© 2026 Himanish Patnaik"
}));

ipcMain.handle("startup:run-check", async (event, checkName) =>
    getStartupCheck(checkName, {
        getAdministratorSecurityStatus: () => administratorSecurity.getStatus(),
        getBusinessDayState
    })
);

ipcMain.handle("startup:exit", () => {
    isAppQuitting = true;
    app.quit();
    return { success: true };
});

ipcMain.handle("startup:reopen-closed-day", async (event, data) => {
    if (!splashWindow || event.sender !== splashWindow.webContents) {
        return { success: false, error: "Startup recovery request rejected." };
    }
    const reason = String(data && data.reason || "").trim();
    const pin = String(data && data.pin || "");
    if (!reason) return { success: false, error: "Day Re-open reason is required." };
    const authorization = await administratorSecurity.authorizePin(pin, "DAY_REOPEN");
    if (!authorization.success) return authorization;
    requireSecurityGrant(authorization.grant, "DAY_REOPEN");
    return reopenBusinessDay(reason);
});

ipcMain.handle("startup:ready", async event => {

    if (!splashWindow || event.sender !== splashWindow.webContents) {
        return { success: false };
    }

    if (mainWindow && !mainWindow.isDestroyed()) {

        if (mainWindow.webContents.isLoadingMainFrame()) {
            await new Promise(resolve => {
                mainWindow.webContents.once(
                    "did-finish-load",
                    resolve
                );
            });
        }

        /*
         * Keep the splash visible until the hidden
         * operational Dashboard confirms that its
         * initial data/status initialization is complete.
         */

        const dashboardReady = new Promise(resolve => {

            const onDashboardReady = dashboardEvent => {

                if (
                    !mainWindow ||
                    mainWindow.isDestroyed() ||
                    dashboardEvent.sender !== mainWindow.webContents
                ) {
                    return;
                }

                ipcMain.removeListener(
                    "startup:dashboard-ready",
                    onDashboardReady
                );

                resolve();
            };

            ipcMain.on(
                "startup:dashboard-ready",
                onDashboardReady
            );
        });

        /*
         * Tell the hidden renderer to initialize
         * the operational Dashboard.
         */

        mainWindow.webContents.send(
            "startup:operational-ready"
        );

        /*
         * Wait until app.js confirms that the Dashboard,
         * System Status and operational initialization
         * have completed.
         */

        await dashboardReady;

/*
 * Keep the splash visible for a minimum of 3 seconds
 * from the moment it was actually shown.
 *
 * If Dashboard initialization itself takes longer than
 * 8 seconds, no additional delay is added.
 */

const minimumSplashDuration = 8000;

const splashElapsed =
    splashShownAt > 0
        ? Date.now() - splashShownAt
        : minimumSplashDuration;

const remainingSplashTime =
    Math.max(
        0,
        minimumSplashDuration - splashElapsed
    );

if (remainingSplashTime > 0) {
    await new Promise(resolve =>
        setTimeout(resolve, remainingSplashTime)
    );
}

/*
 * Only now reveal KLBS.
 */

mainWindow.maximize();
mainWindow.show();
mainWindow.focus();
    }

    /*
     * Close the splash LAST, after the operational
     * application is already ready and visible.
     */

    if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
    }

    return { success: true };
});

ipcMain.handle("security:get-status", () => administratorSecurity.getStatus());
ipcMain.handle("security:authorize-pin", (event, pin, purpose) =>
    administratorSecurity.authorizePin(pin, purpose));
ipcMain.handle("security:change-pin", (event, data) =>
    administratorSecurity.changePin(data.currentPin, data.newPin, data.confirmPin));
ipcMain.handle("security:recover", (event, data) =>
    administratorSecurity.recoverPin(data));
ipcMain.handle("security:configure-manager-pin", (event, data, grant) => {
    requireSecurityGrant(grant, "MANAGER_PIN_MANAGEMENT");
    const managerPinData = data || {};
    return administratorSecurity.configureManagerPin(
        managerPinData.newPin,
        managerPinData.confirmPin,
        "ADMINISTRATOR"
    );
});

ipcMain.handle(
    'import-products',
    async (event, filePath, grant) => {

        try {

            requireSecurityGrant(grant, "PRODUCT_IMPORT");

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
    async (event, grant) => {

        try{

            requireSecurityGrant(grant, "INVENTORY_RESET");

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

            validateBillSettlement(billData);

            const usedFamilyFriendsAuthorization = (billData.items || []).some(item =>
                item.ff_discount !== null && item.ff_discount !== undefined
            );
            const usedGiftVoucherAuthorization = Number(billData.gift_voucher_amount || 0) > 0;
            const authorizationRequirements = [];
            if (usedFamilyFriendsAuthorization) {
                authorizationRequirements.push({
                    token: billData.authorization && billData.authorization.ff,
                    purpose: "FF"
                });
            }
            if (usedGiftVoucherAuthorization) {
                authorizationRequirements.push({
                    token: billData.authorization && billData.authorization.giftVoucher,
                    purpose: "GIFT_VOUCHER"
                });
            }
            if (
                authorizationRequirements.length &&
                !administratorSecurity.consumeGrants(authorizationRequirements)
            ) {
                throw new Error("Required authorization is missing, invalid, or has expired.");
            }
            delete billData.authorization;

            const dayState =
                await getBusinessDayState();

            if (dayState.closed || dayState.closing) {

                return {

                    success: false,

                    businessDayClosed:
                        dayState.closed,

                    businessDayClosing:
                        dayState.closing,

                    error:
                        dayState.closing
                            ? "Business Day closing is in progress. Please retry after it completes."
                            : "Business Day is already closed. No further billing is allowed today."

                };

            }


            await saveBill(billData);

            const activityWarnings = [];
            if (usedFamilyFriendsAuthorization) {
                try {
                    await logAdministratorAction(
                        "BILLING", "FAMILY_FRIENDS_DISCOUNT_APPLIED", billData.bill_no,
                        `Family & Friends Discount applied to bill ${billData.bill_no}`,
                        "SUCCESS", "MANAGER"
                    );
                }
                catch (logError) {
                    activityWarnings.push("Family & Friends authorization audit could not be recorded.");
                    console.error("Family & Friends authorization activity logging failed:", logError.message);
                }
            }
            if (usedGiftVoucherAuthorization) {
                try {
                    await logAdministratorAction(
                        "GIFT VOUCHER", "GIFT_VOUCHER_APPLIED", billData.bill_no,
                        `Gift Voucher applied to bill ${billData.bill_no}`,
                        "SUCCESS", "MANAGER"
                    );
                }
                catch (logError) {
                    activityWarnings.push("Gift Voucher authorization audit could not be recorded.");
                    console.error("Gift Voucher authorization activity logging failed:", logError.message);
                }
            }

            return {

                success: true,
                activityWarning: activityWarnings.length ? activityWarnings.join(" ") : null

            };

        }

        catch (error) {

            if (error.message === "KLBS_BUSINESS_DAY_CLOSING") {
                return {
                    success: false,
                    businessDayClosing: true,
                    error: "Business Day closing is in progress. Please retry after it completes."
                };
            }

            if (error.message === "KLBS_BUSINESS_DAY_CLOSED") {
                return {
                    success: false,
                    businessDayClosed: true,
                    error: "Business Day is already closed. No further billing is allowed today."
                };
            }

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
    "get-credit-note-details",
    async (event, identifier) => {
        try {
            return await getCreditNoteDetails(identifier);
        }
        catch (error) {
            console.error("GET CREDIT NOTE ERROR:", error);
            return { success: false, error: error.message };
        }
    }
);

ipcMain.handle(
    "print-credit-note",
    async (event, identifier) => {
        try {
            const details = await getCreditNoteDetails(identifier);
            if (!details || details.available !== true) {
                return {
                    success: false,
                    error: details && details.reason
                        ? details.reason
                        : "Credit Note is not available."
                };
            }
            return await printCreditNote(details);
        }
        catch (error) {
            console.error("PRINT CREDIT NOTE ERROR:", error);
            return { success: false, error: error.message };
        }
    }
);

ipcMain.handle(
    "save-credit-note-pdf",
    async (event, identifier) => {
        try {
            const details = await getCreditNoteDetails(identifier);
            if (!details || details.available !== true) {
                return {
                    success: false,
                    error: details && details.reason
                        ? details.reason
                        : "Credit Note is not available."
                };
            }
            return await saveCreditNotePdf(details);
        }
        catch (error) {
            console.error("SAVE CREDIT NOTE PDF ERROR:", error);
            return { success: false, error: error.message };
        }
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
    async (event, data, grant) => {

        try {

            requireSecurityGrant(grant, "PAYMENT_CORRECTION");

            return await updatePaymentAllocation(data);

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

        snapshotId

    ) => {

        try {

            const dayClosingData =
                await getDayClosingSnapshot(snapshotId);

            if (
                !dayClosingData ||
                dayClosingData.closeStatus !== "CLOSED"
            ) {
                throw new Error("A valid closed Day Closing snapshot is required for printing.");
            }

            await printDayClosingReceipt(dayClosingData);

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

        return await getRendererSettings();

    }

);

ipcMain.handle(

    "save-settings",

    async (event, settings, grant) => {

        if (Object.prototype.hasOwnProperty.call(settings, "receipt_message")) {
            requireSecurityGrant(grant, "RECEIPT_SETTINGS");
        }
        else if (Object.prototype.hasOwnProperty.call(settings, "backup_location")) {
            requireSecurityGrant(grant, "BACKUP_LOCATION");
        }
        else if (Object.prototype.hasOwnProperty.call(settings, "auto_backup_time")) {
            requireSecurityGrant(grant, "AUTO_BACKUP_SETTINGS");
        }

        return await saveSettings(settings);

    }

);

ipcMain.handle(
    "export-inventory",
    async () => {

        try {

            const products =
                await getAllProducts();

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

            await exportInventory(
                products,
                result.filePath
            );

            let activityWarning = null;
            try {
                await logDataExported(
                    "INVENTORY_EXPORTED", "INVENTORY",
                    "Inventory exported", "OPERATOR"
                );
            }
            catch (logError) {
                activityWarning = "Inventory exported, but its Activity Log event could not be recorded.";
                console.error("Inventory export activity logging failed:", logError.message);
            }

            return{

                success:true,
                activityWarning

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

    async (event, request, grant) => {

        try {

            if (request.reportType === "customer") {
                requireSecurityGrant(grant, "CUSTOMER_REPORT_EXPORT");
            }
            else if (request.reportType === "billSummary") {
                requireSecurityGrant(grant, "BILL_SUMMARY_REPORT_EXPORT");
            }

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

    case "billSummary":

        fileName =
            `KL_Bill_Summary_Report_${formattedDate}.xlsx`;

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

const exportResult = await exportReport(

    request,

    result.filePath

);

const auditByReportType = {
    business: ["BUSINESS_REPORT_EXPORTED", "BUSINESS_REPORT", "Business Report exported", "OPERATOR"],
    gst: ["GST_REPORT_EXPORTED", "GST_REPORT", "GST Report exported", "OPERATOR"],
    product: ["PRODUCT_SALES_REPORT_EXPORTED", "PRODUCT_SALES_REPORT", "Product Sales Report exported", "OPERATOR"],
    customer: ["CUSTOMER_PURCHASE_REPORT_EXPORTED", "CUSTOMER_PURCHASE_REPORT", "Customer Purchase Report exported", "ADMINISTRATOR"],
    billSummary: ["BILL_SUMMARY_REPORT_EXPORTED", "BILL_SUMMARY_REPORT", "Bill Summary Report exported", "ADMINISTRATOR"]
};
let activityWarning = null;
try {
    await logDataExported(...auditByReportType[request.reportType]);
}
catch (logError) {
    activityWarning = "Report exported, but its Activity Log event could not be recorded.";
    console.error("Report export activity logging failed:", logError.message);
}
return { ...(exportResult || {}), success: true, activityWarning };

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

        zipPath,
        grant

    ) => {

        requireSecurityGrant(grant, "RESTORE");

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

        expectedHash,
        grant

    ) => {

        try {

            requireSecurityGrant(grant, "INSTALL_UPDATE");

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

                try {
                    await logAdministratorAction(
                        "SYSTEM", "APPLICATION_UPDATED", packageInfo.version,
                        "Software update installer launched"
                    );
                }
                catch (logError) {
                    console.error("Software update activity logging failed:", logError.message);
                }

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

    async (event, grant) => {

        try {

            requireSecurityGrant(grant, "ACTIVITY_EXPORT");

            const result = await exportActivityLog();
            if (!result.success) return result;

            let activityWarning = null;
            try {
                await logDataExported(
                    "ACTIVITY_LOG_EXPORTED", "ACTIVITY_LOG",
                    "Activity Log exported", "ADMINISTRATOR"
                );
            }
            catch (logError) {
                activityWarning = "Activity Log exported, but its export event could not be recorded.";
                console.error("Activity Log export activity logging failed:", logError.message);
            }
            return { ...result, activityWarning };

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

    async (event, grant) => {

        try {

            requireSecurityGrant(grant, "ACTIVITY_ARCHIVE");

            // 1. Export Excel
            const exportResult =
                await exportActivityLog();

            if (
                !exportResult.success
            ) {

                return exportResult;

            }

            // 2. Delete activities
            const archiveResult =
                await archiveActivities(
                    exportResult.rowCount
                );

            // 3. Create archive log
            let activityWarning = null;

            try {

                await logActivityArchived(
                    exportResult.fileName,
                    archiveResult.deleted
                );

            }

            catch (logError) {

                activityWarning =
                    "Activity Log archive completed, but its marker could not be recorded.";

                console.error(
                    "Activity archive marker failed:",
                    logError.message
                );

            }

            return {

                success: true,

                fileName:
                    exportResult.fileName,

                removedCount:
                    archiveResult.deleted,

                activityWarning

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

            return await getBusinessDayState();

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
    async (event, grant, reason) => {

        try {

            requireSecurityGrant(grant, "DAY_REOPEN");

            const result =
                await reopenBusinessDay(reason);

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

ipcMain.handle("day-closing:retry-dsr-sync", async (event, grant, snapshotId) => {
    try {
        requireSecurityGrant(grant, "DSR_SYNC_RETRY");
        const id = Number(snapshotId);
        if (!Number.isSafeInteger(id) || id <= 0) {
            throw new Error("A valid Day Closing snapshot is required.");
        }
        const result = await retryDsrSync(id);
        return {
            success: result.status === "SYNCED",
            dsrSyncStatus: result.status,
            dsrSyncWarning: result.warning || null,
            action: result.action || null
        };
    }
    catch (error) {
        return { success: false, error: error.message };
    }
});
