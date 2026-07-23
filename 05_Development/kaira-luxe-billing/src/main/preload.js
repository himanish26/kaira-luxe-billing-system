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

        getBillDetails: (billNo) =>
            ipcRenderer.invoke(
                "get-bill-details",
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

resetInventory: () =>
    ipcRenderer.invoke(
        "reset-inventory"
    ),

}

);