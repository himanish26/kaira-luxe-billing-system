const { contextBridge, ipcRenderer } = require("electron");
let stockInwardWorkspaceToken = null;
const stockInwardInvoke = (channel, ...args) => ipcRenderer.invoke(channel, stockInwardWorkspaceToken, ...args);

contextBridge.exposeInMainWorld(
    "electronAPI",
    {

        getInventorySummary: () =>
    ipcRenderer.invoke(
        "get-inventory-summary"
    ),

        getProducts: (options) =>
            ipcRenderer.invoke(
                "get-products",
                options
            ),

            getAppInfo: () =>
                ipcRenderer.invoke(
                    "get-app-info"
                ),

            getDevelopmentStartupGateStatus: () =>
                ipcRenderer.invoke("development:get-startup-gate-status"),

            getEulaText: () =>
                ipcRenderer.invoke(
                    "legal:get-eula-text"
                ),

            searchProducts: (keyword, options) =>
    ipcRenderer.invoke(
        "search-products",
        keyword,
        options
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

        findCustomersByMobile: (mobile) =>
            ipcRenderer.invoke("customers:find-by-mobile", mobile),

        getCustomerProfile: (customerId) =>
            ipcRenderer.invoke("customers:get-profile", customerId),

        createCustomerProfile: (data) =>
            ipcRenderer.invoke("customers:create-profile", data),

        updateCustomerProfile: (customerId, data) =>
            ipcRenderer.invoke("customers:update-profile", customerId, data),

        getCustomerPurchaseHistory: (customerId) =>
            ipcRenderer.invoke("customers:purchase-history", customerId),

        getCustomerPurchaseHistoryPage: (customerId, options) =>
            ipcRenderer.invoke("customers:purchase-history-page", customerId, options),

        listCustomerDirectory: (search) =>
            ipcRenderer.invoke("customers:list-directory", search),

        getCustomerManagementProfile: (customerId) =>
            ipcRenderer.invoke("customers:get-management-profile", customerId),

        getSupplierOptions: () => ipcRenderer.invoke("suppliers:options"),
        createSupplierBrand: value => ipcRenderer.invoke("suppliers:brand-create", value),
        createSupplierProductSegment: value => ipcRenderer.invoke("suppliers:product-segment-create", value),
        listSuppliers: options => ipcRenderer.invoke("suppliers:list", options),
        listSupplierAccounts: options => ipcRenderer.invoke("suppliers:accounts-list", options),
        getSupplier: code => ipcRenderer.invoke("suppliers:get", code),
        getSupplierPaymentContext: (code, amountPaise) => ipcRenderer.invoke("suppliers:payment-context", code, amountPaise),
        createSupplier: input => ipcRenderer.invoke("suppliers:create", input),
        updateSupplier: (code, input) => ipcRenderer.invoke("suppliers:update", code, input),
        addSupplierRelationship: (code, input) => ipcRenderer.invoke("suppliers:relationship-add", code, input),
        updateSupplierRelationship: (code, previous, input) => ipcRenderer.invoke("suppliers:relationship-update", code, previous, input),
        removeSupplierRelationship: (code, input) => ipcRenderer.invoke("suppliers:relationship-remove", code, input),
        endSupplierRelationship: (code, relationshipCode, effectiveTo) => ipcRenderer.invoke("suppliers:relationship-end", code, relationshipCode, effectiveTo),
        searchSuppliersByBrand: value => ipcRenderer.invoke("suppliers:brand-search", value),
        postSupplierInvoice: (input, grant) => ipcRenderer.invoke("suppliers:post-invoice", input, grant),
        postSupplierPayment: (input, grant) => ipcRenderer.invoke("suppliers:post-payment", input, grant),
        postSupplierOpeningBalance: (input, grant) => ipcRenderer.invoke("suppliers:post-opening", input, grant),
        getSupplierOpeningBalances: supplierCode => ipcRenderer.invoke("suppliers:openings", supplierCode),
        postSupplierCreditNote: (input, grant) => ipcRenderer.invoke("suppliers:post-credit-note", input, grant),
        getSupplierCreditNotes: supplierCode => ipcRenderer.invoke("suppliers:credit-notes", supplierCode),
        getSupplierOpenLiabilities: supplierCode => ipcRenderer.invoke("suppliers:liabilities", supplierCode),
        getSupplierStatement: supplierCode => ipcRenderer.invoke("suppliers:statement", supplierCode),
        getSupplierInvoices: supplierId => ipcRenderer.invoke("suppliers:invoices", supplierId),
        getSupplierInvoice: code => ipcRenderer.invoke("suppliers:invoice", code),
        getSupplierPayments: supplierId => ipcRenderer.invoke("suppliers:payments", supplierId),
        getSupplierAccountHistory: supplierId => ipcRenderer.invoke("suppliers:history", supplierId),
        getSupplierInvoiceLines: code => ipcRenderer.invoke("suppliers:invoice-lines", code),
        exportSupplierAccount: supplierId => ipcRenderer.invoke("suppliers:export-account", supplierId),

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

    getTransactionHistoryPage: (options) =>
        ipcRenderer.invoke(
            "get-transaction-history-page",
            options
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

closeBusinessDay: attemptId =>

    ipcRenderer.invoke(

        "close-business-day",
        attemptId

    ),

onDayClosingProgress: callback =>
    ipcRenderer.on("day-closing:progress", (_event, payload) => callback(payload)),

onDayClosingExitBlocked: callback =>
    ipcRenderer.on("day-closing:exit-blocked", (_event, attemptId) => callback(attemptId)),

closeAfterDayClosing: () =>
    ipcRenderer.invoke("app:close-after-day-closing"),

    retryDayClosingDsrSync: snapshotId =>
        ipcRenderer.invoke("day-closing:retry-dsr-sync", snapshotId),

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
    dayClosingHistory: {
        listDates: () => ipcRenderer.invoke("day-closing-history:list-dates"),
        listForDate: businessDate => ipcRenderer.invoke("day-closing-history:list-for-date", businessDate),
        getSnapshot: snapshotId => ipcRenderer.invoke("day-closing-history:get-snapshot", snapshotId),
        printSnapshot: snapshotId => ipcRenderer.invoke("day-closing-history:print", snapshotId)
    },
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

        searchInventoryStyle: (input) =>
            ipcRenderer.invoke(
                "inventory:style-search",
                input
            ),

        stockInward: (data) =>
            ipcRenderer.invoke(
                "stock-inward",
                data
            ),

        stockInwardEnter: async (grant) => {
            const result = await ipcRenderer.invoke("stock-inward:enter", grant);
            stockInwardWorkspaceToken = result?.token || null;
            return Boolean(stockInwardWorkspaceToken);
        },
        stockInwardExit: async () => {
            if (!stockInwardWorkspaceToken) return { success: true };
            try { return await ipcRenderer.invoke("stock-inward:exit", stockInwardWorkspaceToken); }
            finally { stockInwardWorkspaceToken = null; }
        },
        stockInwardListDrafts: () => stockInwardInvoke("stock-inward:resume-list"),
        stockInwardHistory: (options) => stockInwardInvoke("stock-inward:history", options || {}),
        stockInwardSuppliers: () => stockInwardInvoke("stock-inward:suppliers"),
        stockInwardCreate: (data) => stockInwardInvoke("stock-inward:create", data),
        stockInwardLoad: (id) => stockInwardInvoke("stock-inward:load", id),
        stockInwardUpdateContext: (data) => stockInwardInvoke("stock-inward:update-context", data),
        stockInwardResolveBarcode: (barcode) => stockInwardInvoke("stock-inward:resolve-barcode", barcode),
        stockInwardScan: (data) => stockInwardInvoke("stock-inward:scan", data),
        stockInwardEditLine: (data) => stockInwardInvoke("stock-inward:edit-line", data),
        stockInwardRemoveLine: (data) => stockInwardInvoke("stock-inward:remove-line", data),
        stockInwardRetryMatching: (id) => stockInwardInvoke("stock-inward:retry-matching", id),
        stockInwardDiscardLine: (data) => stockInwardInvoke("stock-inward:discard-line", data),
        stockInwardPost: (data) => stockInwardInvoke("stock-inward:post", data),
        stockInwardCancel: (data) => stockInwardInvoke("stock-inward:cancel", data),
        stockInwardAbandonEmpty: (id) => stockInwardInvoke("stock-inward:abandon-empty", id),
        stockInwardInvoices: (supplierId) => stockInwardInvoke("stock-inward:invoices", supplierId),
        stockInwardFindDuplicateInvoice: (data) => stockInwardInvoke("stock-inward:duplicate-invoice", data),
        stockInwardCurrentMasterUnresolved: (id) => stockInwardInvoke("stock-inward:current-master-unresolved", id),
        stockInwardArchiveCancelled: (data) => stockInwardInvoke("stock-inward:archive-cancelled", data),
        stockInwardExportUnknown: (id) => stockInwardInvoke("stock-inward:export-unknown", id),
        stockInwardPrintReceipt: (data) => stockInwardInvoke("stock-inward:print-receipt", data),

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

getCurrentStoreIdentity: () => ipcRenderer.invoke("store-identity:get-current"),

getManagementPnlPeriod: options => ipcRenderer.invoke("management-pnl:resolve-period", options),

getManagementPnl: options => ipcRenderer.invoke("management-pnl:get", options),

getManagementPnlFinancialYear: options => ipcRenderer.invoke("management-pnl:get-financial-year", options),

exportManagementPnlFinancialYear: options => ipcRenderer.invoke("management-pnl:export-financial-year", options),

managementAccountingEntries: {
    getOptions: () => ipcRenderer.invoke("management-accounting-entries:options"),
    validate: input => ipcRenderer.invoke("management-accounting-entries:validate", input),
    post: (input, grant) => ipcRenderer.invoke("management-accounting-entries:post", input, grant),
    get: entryCode => ipcRenderer.invoke("management-accounting-entries:get", entryCode),
    list: filters => ipcRenderer.invoke("management-accounting-entries:list", filters),
    reverse: (entryCode, details, grant) => ipcRenderer.invoke("management-accounting-entries:reverse", entryCode, details, grant),
    getDataQuality: filters => ipcRenderer.invoke("management-accounting-entries:data-quality", filters)
},

saveSettings: (settings, grant) =>
    ipcRenderer.invoke(
        "save-settings",
        settings,
        grant
    ),

getIntegrationConfig: () => ipcRenderer.invoke("integrations:get-config"),
getIntegrationOutboxStatus: () => ipcRenderer.invoke("integrations:get-outbox-status"),
getIntegrationDetails: (kind, grant) => ipcRenderer.invoke("integrations:get-details", kind, grant),
saveEmailIntegration: (data, grant) => ipcRenderer.invoke("integrations:save-email", data, grant),
saveDsrIntegration: (data, grant) => ipcRenderer.invoke("integrations:save-dsr", data, grant),
saveRemoteDashboardIntegration: (data, grant) => ipcRenderer.invoke("integrations:save-remote-dashboard", data, grant),
testEmailIntegration: grant => ipcRenderer.invoke("integrations:test-email", grant),
sendIntegrationTestEmail: (recipient, grant) => ipcRenderer.invoke("integrations:send-test-email", recipient, grant),
testDsrIntegration: grant => ipcRenderer.invoke("integrations:test-dsr", grant),
testRemoteDashboardIntegration: grant => ipcRenderer.invoke("integrations:test-remote-dashboard", grant),
clearRemoteDashboardIntegration: grant => ipcRenderer.invoke("integrations:clear-remote-dashboard", grant),

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

    getActivities: (options) =>
    ipcRenderer.invoke(
        "activity:get",
        options
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

    getExpenseTrackerOptions: () => ipcRenderer.invoke("expenses:get-options"),
    validateExpenseEntry: entry => ipcRenderer.invoke("expenses:validate-entry", entry),
    findPostedExpenseDuplicates: entries => ipcRenderer.invoke("expenses:find-duplicates", entries),
    postExpenseBatch: (entries, duplicateAcknowledged, grant) =>
        ipcRenderer.invoke("expenses:post-batch", entries, duplicateAcknowledged, grant),
    getPostedExpenseHistory: options => ipcRenderer.invoke("expenses:history", options),
    getExpenseHeaderSummary: options => ipcRenderer.invoke("expenses:summary-by-header", options),
    getPostedExpenseDetails: expenseCode => ipcRenderer.invoke("expenses:details", expenseCode),
    exportPostedExpenseBatch: batchCode => ipcRenderer.invoke("expenses:export-batch", batchCode),
    exportPostedExpenseHistory: options => ipcRenderer.invoke("expenses:export-history", options),

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
onRestoreQuiescing: callback =>
    ipcRenderer.on("restore:quiescing", callback),
onRestoreResumed: callback =>
    ipcRenderer.on("restore:resumed", callback),

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
    getAuthorizationRole: purpose => ipcRenderer.invoke("security:get-authorization-role", purpose),
    authorizePin: (pin, purpose) => ipcRenderer.invoke("security:authorize-pin", pin, purpose),
    discardGrant: (grant, purpose) => ipcRenderer.invoke("security:discard-grant", grant, purpose),
    changePin: data => ipcRenderer.invoke("security:change-pin", data),
    recover: data => ipcRenderer.invoke("security:recover", data),
    recoverManagerPin: data => ipcRenderer.invoke("security:recover-manager-pin", data),
    configureManagerPin: (data, grant) =>
        ipcRenderer.invoke("security:configure-manager-pin", data, grant)
},

}

);
