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

        importProducts: (filePath) =>
            ipcRenderer.invoke(
                "import-products",
                filePath
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

    reopenBusinessDay: () =>

    ipcRenderer.invoke(

        "reopen-business-day"

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

            updatePaymentAllocation: (data) =>
                ipcRenderer.invoke(
                    "update-payment-allocation",
                    data
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

    printDayClosing: (summary) =>

    ipcRenderer.invoke(

        "print-day-closing",

        summary

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

saveSettings: (settings) =>
    ipcRenderer.invoke(
        "save-settings",
        settings
    ),

emailTest: () =>
    ipcRenderer.invoke(
        "email:test"
    ),    

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

logActivity: (activity) =>
    ipcRenderer.invoke(
        "activity:log",
        activity
    ),

    getActivities: () =>
    ipcRenderer.invoke(
        "activity:get"
    ),

    exportActivityLog: () =>
    ipcRenderer.invoke(
        "activity:export"
    ),

    archiveActivities: () =>
    ipcRenderer.invoke(
        "activity:archive"
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

resetInventory: () =>
    ipcRenderer.invoke(
        "reset-inventory"
    ),

exportReport: (request) =>
    ipcRenderer.invoke(
        "export-report",
        request
    ),

getSystemStatus: () =>
    ipcRenderer.invoke(
        "get-system-status"
    ),

showMessageBox: (options) =>
    ipcRenderer.invoke(
        "dialog:showMessageBox",
        options
    ),

selectRestoreFile: () =>
    ipcRenderer.invoke(
        "restore:selectFile"
    ),

restoreBackup: (

    zipPath

) => ipcRenderer.invoke(

    "backup:restore",

    zipPath

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

downloadUpdate: (

    url,

    fileName,

    version

) =>

    ipcRenderer.invoke(

        "updates:download",

        url,

        fileName,

        version

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

    launchInstaller: (

    installerPath,

    expectedHash

) =>

    ipcRenderer.invoke(

        "updates:install",

        installerPath,

        expectedHash

    ),

connectGoogleDrive: () =>

    ipcRenderer.invoke(

        "google:connect"

    ),

}

);