const path = require("path");
const { logActivity } = require("./activityService");

const safeFileName = value => path.basename(String(value || "Unknown file")).slice(0, 255);
const safeError = value => String(value || "Operation failed")
    .replace(/(?:[A-Za-z]:\\|\/)[^\s|]+/g, "[PATH]")
    .slice(0, 1000);

const write = (category, action, details, actor, status, extra = {}) => logActivity({
    category, action, details, user_name: actor, status, ...extra
});

const logApplicationStarted = () => write(
    "SYSTEM", "APPLICATION_STARTED", "Kaira Luxe Billing System started", "SYSTEM", "SUCCESS"
);
const logApplicationClosed = () => write(
    "SYSTEM", "APPLICATION_CLOSED", "Kaira Luxe Billing System closed", "SYSTEM", "SUCCESS"
);
const logApplicationUpdated = version => write(
    "SYSTEM", "APPLICATION_UPDATED", String(version || "Unknown version"), "ADMINISTRATOR", "SUCCESS"
);
const logDatabaseReset = () => write(
    "SYSTEM", "DATABASE_RESET", "Database reset completed", "ADMINISTRATOR", "SUCCESS"
);
const logActivityArchived = (fileName, removedCount) => write(
    "ACTIVITY", "ACTIVITY_LOG_ARCHIVED",
    `File: ${safeFileName(fileName)} | Rows removed: ${Number(removedCount) || 0}`,
    "ADMINISTRATOR", "SUCCESS",
    { entity_type: "ACTIVITY_LOG", reference_no: safeFileName(fileName) }
);
const logDataExported = (action, resource, details, actor = "OPERATOR") => write(
    "EXPORT", action, details, actor, "SUCCESS",
    { entity_type: "EXPORT", reference_no: resource }
);
const logAdministratorAction = (category, action, resource, details, status = "SUCCESS", actor = "ADMINISTRATOR") => write(
    category, action, details, actor, status,
    { entity_type: "PROTECTED_OPERATION", reference_no: resource }
);

const logInvoiceGenerated = (billNumber, amount, items) => write(
    "BILLING", "INVOICE_GENERATED",
    `Bill ${billNumber} | ₹${amount} | ${items} Item(s)`, "OPERATOR", "SUCCESS",
    { entity_type: "BILL", reference_no: billNumber }
);
const logPaymentCorrected = billNumber => write(
    "BILLING", "PAYMENT_CORRECTED", `Bill ${billNumber}`, "ADMINISTRATOR", "SUCCESS",
    { entity_type: "BILL", reference_no: billNumber }
);
const logReturnCompleted = (
    returnNo,
    originalBillNo,
    amount,
    actor = "OPERATOR"
) => write(
    "RETURN",
    "RETURN_COMPLETED",
    `Return ${returnNo} | Original Bill ${originalBillNo} | ₹${amount}`,
    actor,
    "SUCCESS",
    {
        entity_type: "RETURN",
        reference_no: returnNo
    }
);

const logCreditNoteGenerated = (
    creditNoteNo,
    returnNo,
    originalBillNo,
    amount,
    actor = "OPERATOR"
) => write(
    "CREDIT NOTE",
    "CREDIT_NOTE_GENERATED",
    `Credit Note ${creditNoteNo} | Return ${returnNo} | Original Bill ${originalBillNo} | ₹${amount}`,
    actor,
    "SUCCESS",
    {
        entity_type: "CREDIT_NOTE",
        reference_no: creditNoteNo
    }
);

const logStoreCreditIssued = (
    storeCreditNo,
    returnNo,
    amount,
    actor = "OPERATOR"
) => write(
    "STORE CREDIT",
    "STORE_CREDIT_ISSUED",
    `Store Credit ${storeCreditNo} | Return ${returnNo} | ₹${amount}`,
    actor,
    "SUCCESS",
    {
        entity_type: "STORE_CREDIT",
        reference_no: storeCreditNo
    }
);

const logStoreCreditUpdated = (
    storeCreditNo,
    returnNo,
    amount,
    availableBalance,
    actor = "OPERATOR"
) => write(
    "STORE CREDIT",
    "STORE_CREDIT_UPDATED",
    `Store Credit ${storeCreditNo} | Return ${returnNo} | Added ₹${amount} | Available ₹${availableBalance}`,
    actor,
    "SUCCESS",
    {
        entity_type: "STORE_CREDIT",
        reference_no: storeCreditNo
    }
);

const logStoreCreditRedeemed = (
    storeCreditNo,
    billNo,
    amount,
    actor = "OPERATOR"
) => write(
    "STORE CREDIT",
    "STORE_CREDIT_REDEEMED",
    `Store Credit ${storeCreditNo} | Bill ${billNo} | ₹${amount}`,
    actor,
    "SUCCESS",
    {
        entity_type: "STORE_CREDIT",
        reference_no: storeCreditNo
    }
);

const logProductImport = (fileName, counts = {}) => {
    const imported = Number(counts.imported) || 0;
    const updated = Number(counts.updated) || 0;
    const skipped = Number(counts.skipped) || 0;
    const total = Number(counts.total) || imported + updated + skipped;
    return write(
        "INVENTORY", "PRODUCT_IMPORT_COMPLETED",
        `File: ${safeFileName(fileName)} | Rows: ${total} | New: ${imported} | Updated: ${updated} | Skipped: ${skipped}`,
        "ADMINISTRATOR", "SUCCESS",
        { entity_type: "PRODUCT_IMPORT", reference_no: safeFileName(fileName) }
    );
};

const logInventoryReset = () => write(
    "INVENTORY", "INVENTORY_RESET", "Inventory reset completed", "ADMINISTRATOR", "SUCCESS"
);

function logInventoryMovement(type, result, data = {}) {
    const product = result.product || {};
    const quantity = Number(result.quantity) || 0;
    const parts = [
        type === "INWARD" ? "Stock Inward" : "Stock Outward",
        `Product: ${product.product_name || "Unknown"}`,
        `Barcode: ${product.barcode || data.barcode || "Unknown"}`,
        `Quantity: ${quantity}`
    ];
    if (type === "INWARD" && data.invoiceNo) parts.push(`Invoice: ${data.invoiceNo}`);
    if (type === "OUTWARD" && (result.transactionType || data.reason)) {
        parts.push(`Reason: ${result.transactionType || data.reason}`);
    }
    if (data.remarks) parts.push(`Remarks: ${data.remarks}`);
    return write(
        "INVENTORY", type === "INWARD" ? "STOCK_INWARD" : "STOCK_OUTWARD",
        parts.join(" | "), "OPERATOR", "SUCCESS",
        { entity_type: "INVENTORY_TRANSACTION", reference_no: result.transactionId }
    );
}
const logStockInward = (result, data) => logInventoryMovement("INWARD", result, data);
const logStockOutward = (result, data) => logInventoryMovement("OUTWARD", result, data);

const logBackupCreated = fileName => write(
    "BACKUP", "BACKUP_CREATED", safeFileName(fileName), "SYSTEM", "SUCCESS",
    { entity_type: "BACKUP", reference_no: safeFileName(fileName) }
);
const logBackupFailed = reason => write(
    "BACKUP", "BACKUP_FAILED", safeError(reason), "SYSTEM", "ERROR"
);
const logRestoreCompleted = fileName => write(
    "RESTORE", "RESTORE_COMPLETED", safeFileName(fileName), "ADMINISTRATOR", "SUCCESS",
    { entity_type: "BACKUP", reference_no: safeFileName(fileName) }
);
const logRestoreFailed = reason => write(
    "RESTORE", "RESTORE_FAILED", safeError(reason), "ADMINISTRATOR", "ERROR"
);
const logBusinessDayOpened = date => write(
    "DAY CLOSING", "BUSINESS_DAY_OPENED", date, "SYSTEM", "SUCCESS",
    { entity_type: "BUSINESS_DAY", reference_no: date }
);
const logBusinessDayClosed = date => write(
    "DAY CLOSING", "BUSINESS_DAY_CLOSED", date, "ADMINISTRATOR", "SUCCESS",
    { entity_type: "BUSINESS_DAY", reference_no: date }
);
const logBusinessDayReopened = date => write(
    "DAY CLOSING", "BUSINESS_DAY_REOPENED", date, "MANAGER", "SUCCESS",
    { entity_type: "BUSINESS_DAY", reference_no: date }
);
const logDsrSyncSucceeded = (date, sequence, action) => write(
    "DAY CLOSING", "DSR_SYNC_SUCCEEDED",
    `Close sequence: ${Number(sequence)} | Action: ${String(action || "UNKNOWN")}`,
    "SYSTEM", "SUCCESS",
    { entity_type: "BUSINESS_DAY", reference_no: date }
);
const logDsrSyncFailed = (date, sequence, reason) => write(
    "DAY CLOSING", "DSR_SYNC_FAILED",
    `Close sequence: ${Number(sequence)} | ${safeError(reason)}`,
    "SYSTEM", "FAILED",
    { entity_type: "BUSINESS_DAY", reference_no: date }
);

module.exports = {
    logApplicationStarted, logApplicationClosed, logApplicationUpdated,
    logDatabaseReset, logActivityArchived, logDataExported,
    logAdministratorAction, logInvoiceGenerated,
    logPaymentCorrected,
    logReturnCompleted, logCreditNoteGenerated,
    logStoreCreditIssued, logStoreCreditUpdated,
    logStoreCreditRedeemed,
    logProductImport, logInventoryReset,
    logStockInward, logStockOutward,
    logBackupCreated, logBackupFailed, logRestoreCompleted, logRestoreFailed,
    logBusinessDayOpened, logBusinessDayClosed, logBusinessDayReopened,
    logDsrSyncSucceeded, logDsrSyncFailed,
    safeFileName, safeError
};