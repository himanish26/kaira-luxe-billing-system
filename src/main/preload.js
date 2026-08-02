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

            getDashboardSummary: () =>

    ipcRenderer.invoke(

        "get-dashboard-summary"

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

        saveBillPdf: (billData) =>
            ipcRenderer.invoke(
                "save-bill-pdf",
                billData
            ),

            exportInventory: () =>
                ipcRenderer.invoke(
                "export-inventory"
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

createBackup: () =>
    ipcRenderer.invoke(
        "backup:create"
    ),

getBackupHistory: () =>
    ipcRenderer.invoke(
        "backup:getHistory"
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

}

);