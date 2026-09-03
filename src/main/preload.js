const { contextBridge, ipcRenderer } = require("electron");

console.log("PRELOAD LOADED");

contextBridge.exposeInMainWorld(
    "electronAPI",
    {

        getInventorySummary: () =>
    ipcRenderer.invoke(
        "get-inventory-summary"
    ),

        getProducts: () =>
            ipcRenderer.invoke(
                "get-products"
            ),

            getAppInfo: () =>
                ipcRenderer.invoke(
                    "get-app-info"
                ),

            searchProducts: (keyword) =>
    ipcRenderer.invoke(
        "search-products",
        keyword
    ),

    getLastImport: () =>
        ipcRenderer.invoke(
            "get-last-import"
        ),

        selectExcelFile: () =>
            ipcRenderer.invoke("select-excel-file"),

        importProducts: (filePath, grant) =>
            ipcRenderer.invoke(
                "import-products",
                filePath,
                grant
            ),

        getProduct: (barcode) =>
            ipcRenderer.invoke(
                "get-product",
                barcode
            ),

        saveBill: (billData) =>
            ipcRenderer.invoke(
                "save-bill",
                billData
            ),

        getNextBillNumber: () =>
            ipcRenderer.invoke(
                "get-next-bill-number"
            ),

        getBills: () =>
            ipcRenderer.invoke(
                "get-bills"
            ),

            getTransactionHistory: () =>
    ipcRenderer.invoke(
        "get-transaction-history"
    ),

getStoreCreditDetails: (storeCreditNo) =>
ipcRenderer.invoke(
    "get-store-credit-details",
    storeCreditNo
),

getReturnDetails: (returnNo) =>
ipcRenderer.invoke(
    "get-return-details",
    returnNo
),

getCreditNoteDetails: (identifier) =>
ipcRenderer.invoke(
    "get-credit-note-details",
    identifier
),

printCreditNote: (identifier) =>
ipcRenderer.invoke(
    "print-credit-note",
    identifier
),

saveCreditNotePdf: (identifier) =>
ipcRenderer.invoke(
    "save-credit-note-pdf",
    identifier
),

getAvailableStoreCreditByMobile: (customerMobile) =>
ipcRenderer.invoke(
    "get-available-store-credit-by-mobile",
    customerMobile
),

    getStoreCreditForReprint: (storeCreditNo) =>
    ipcRenderer.invoke(
        "get-store-credit-for-reprint",
        storeCreditNo
    ),

            getBillForReturn: (billNo) =>
    ipcRenderer.invoke(
        "get-bill-for-return",
        billNo
    ),

getNextReturnNumber: () =>
    ipcRenderer.invoke(
        "get-next-return-number"
    ),

saveReturn: (returnData) =>
    ipcRenderer.invoke(
        "save-return",
        returnData
    ),

            getDashboardSummary: () =>

    ipcRenderer.invoke(

        "get-dashboard-summary"

    ),

    getDayClosingSummary: () =>

    ipcRenderer.invoke(

        "get-day-closing-summary"

    ),

    getBusinessDayStatus: () =>

    ipcRenderer.invoke(

        "get-business-day-status"

    ),

closeBusinessDay: () =>

    ipcRenderer.invoke(

        "close-business-day"

    ),

    retryDayClosingDsrSync: (grant, snapshotId) =>
        ipcRenderer.invoke("day-closing:retry-dsr-sync", grant, snapshotId),

    reopenBusinessDay: (grant, reason) =>

    ipcRenderer.invoke(

        "reopen-business-day",
        grant,
        reason

    ),

        getBillDetails: (billNo) =>
            ipcRenderer.invoke(
                "get-bill-details",
                billNo
            ),

            getPaymentCorrections: (billNo) =>
    ipcRenderer.invoke(
        "get-payment-corrections",
        billNo
    ),

            updatePaymentAllocation: (data, grant) =>
                ipcRenderer.invoke(
                    "update-payment-allocation",
                    data,
                    grant
    ),

printBill: (billData) =>
    ipcRenderer.invoke(
        "print-bill",
        billData
    ),

printStoreCredit: (storeCreditData) =>
    ipcRenderer.invoke(
        "print-store-credit",
        storeCreditData
    ),

reprintStoreCredit: (storeCreditNo) =>
    ipcRenderer.invoke(
        "reprint-store-credit",
        storeCreditNo
    ),

    printDayClosing: (snapshotId) =>

    ipcRenderer.invoke(

        "print-day-closing",

        snapshotId

    ),
    testPrinter: (printerName) => ipcRenderer.invoke("printer:test", printerName),

        saveBillPdf: (billData) =>
            ipcRenderer.invoke(
                "save-bill-pdf",
                billData
            ),

            exportInventory: () =>
                ipcRenderer.invoke(
                "export-inventory"
            ),

                    exportInventory: () =>
            ipcRenderer.invoke(
                "export-inventory"
            ),


        /* INVENTORY TRANSACTIONS */

        getInventoryProduct: (barcode) =>
            ipcRenderer.invoke(
                "get-inventory-product",
                barcode
            ),

        stockInward: (data) =>
            ipcRenderer.invoke(
                "stock-inward",
                data
            ),

        stockOutward: (data) =>
            ipcRenderer.invoke(
                "stock-outward",
                data
            ),




            downloadProductMasterTemplate: () =>
                ipcRenderer.invoke(
                    "download-product-master-template"
                ),

        // ⭐ NEW APIs

        getSettings: () =>
    ipcRenderer.invoke(
        "get-settings"
    ),

saveSettings: (settings, grant) =>
    ipcRenderer.invoke(
        "save-settings",
        settings,
        grant
    ),

getIntegrationConfig: () => ipcRenderer.invoke("integrations:get-config"),
getIntegrationDetails: (kind, grant) => ipcRenderer.invoke("integrations:get-details", kind, grant),
saveEmailIntegration: (data, grant) => ipcRenderer.invoke("integrations:save-email", data, grant),
saveDsrIntegration: (data, grant) => ipcRenderer.invoke("integrations:save-dsr", data, grant),
testEmailIntegration: grant => ipcRenderer.invoke("integrations:test-email", grant),
sendIntegrationTestEmail: (recipient, grant) => ipcRenderer.invoke("integrations:send-test-email", recipient, grant),
testDsrIntegration: grant => ipcRenderer.invoke("integrations:test-dsr", grant),

getPrinters: () =>
    ipcRenderer.invoke(
        "printer:getAll"
    ),

testPrinter: (printerName) =>
    ipcRenderer.invoke(
        "printer:test",
        printerName
    ),

createBackup: () =>
    ipcRenderer.invoke(
        "backup:create"
    ),

getBackupHistory: () =>
    ipcRenderer.invoke(
        "backup:getHistory"
    ),

    getActivities: () =>
    ipcRenderer.invoke(
        "activity:get"
    ),

    exportActivityLog: (grant) =>
    ipcRenderer.invoke(
        "activity:export",
        grant
    ),

    archiveActivities: (grant) =>
    ipcRenderer.invoke(
        "activity:archive",
        grant
    ),

selectBackupFolder: () =>
    ipcRenderer.invoke(
        "backup:selectFolder"
    ),

validateBackup: (zipPath) =>
    ipcRenderer.invoke(
        "backup:validate",
        zipPath
    ),

resetInventory: (grant) =>
    ipcRenderer.invoke(
        "reset-inventory",
        grant
    ),

exportReport: (request, grant) =>
    ipcRenderer.invoke(
        "export-report",
        request,
        grant
    ),

getSystemStatus: () =>
    ipcRenderer.invoke(
        "get-system-status"
    ),

onOperationalReady: callback =>
    ipcRenderer.once("startup:operational-ready", callback),

onSecuritySetupRequired: callback =>
    ipcRenderer.once("startup:security-setup-required", (_event, status) => callback(status)),

completeStartupSecuritySetup: () =>
    ipcRenderer.invoke("startup:security-setup-complete"),
verifyStartupMasterPin: masterPin =>
    ipcRenderer.invoke("startup:verify-master-pin", masterPin),
configureMissingStartupAdministratorPin: data =>
    ipcRenderer.invoke("startup:configure-missing-administrator-pin", data),
configureMissingStartupManagerPin: data =>
    ipcRenderer.invoke("startup:configure-missing-manager-pin", data),

notifyDashboardReady: () =>
    ipcRenderer.send("startup:dashboard-ready"),

showMessageBox: (options) =>
    ipcRenderer.invoke(
        "dialog:showMessageBox",
        options
    ),
restoreFocusAfterNativeDialog: () =>
    ipcRenderer.send("dialog:restore-focus"),
onNativeDialogClosed: callback =>
    ipcRenderer.on("dialog:native-closed", callback),

selectRestoreFile: () =>
    ipcRenderer.invoke(
        "restore:selectFile"
    ),

restoreBackup: (

    zipPath,
    grant

) => ipcRenderer.invoke(

    "backup:restore",

    zipPath,
    grant

),

restartApp: (
    restoreFileName
) =>
    ipcRenderer.invoke(
        "app:restart",
        restoreFileName
    ),

checkForUpdates: () =>

    ipcRenderer.invoke(
        "updates:check"
    ),

downloadUpdate: grant =>

    ipcRenderer.invoke(

        "updates:download",

        grant

    ),

onDownloadProgress: (

    callback

) =>

    ipcRenderer.on(

        "update-download-progress",

        (

            event,

            progress

        ) =>

            callback(progress)

    ),

launchInstaller: grant =>

    ipcRenderer.invoke(

        "updates:install",

        grant

    ),

connectGoogleDrive: () =>

    ipcRenderer.invoke(

        "google:connect"

    ),

administratorSecurity: {
    getStatus: () => ipcRenderer.invoke("security:get-status"),
    authorizePin: (pin, purpose) => ipcRenderer.invoke("security:authorize-pin", pin, purpose),
    changePin: data => ipcRenderer.invoke("security:change-pin", data),
    recover: data => ipcRenderer.invoke("security:recover", data),
    recoverManagerPin: data => ipcRenderer.invoke("security:recover-manager-pin", data),
    configureManagerPin: (data, grant) =>
        ipcRenderer.invoke("security:configure-manager-pin", data, grant)
},

}

);
