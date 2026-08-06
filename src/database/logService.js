const { logActivity } = require("./activityService");

/* ===========================================
   SYSTEM
=========================================== */

async function logApplicationStarted() {

    return logActivity({

        category: "SYSTEM",

        action: "Application Started",

        details: "Kaira Luxe Billing System started",

        user_name: "Administrator",

        status: "SUCCESS"

    });

}

async function logApplicationUpdated(version) {

    return logActivity({

        category: "SYSTEM",

        action: "Application Updated",

        details: version,

        user_name: "Administrator",

        status: "SUCCESS"

    });

}

async function logDatabaseReset() {

    return logActivity({

        category: "SYSTEM",

        action: "Database Reset",

        details: "Database reset completed",

        user_name: "Administrator",

        status: "SUCCESS"

    });

}

async function logActivityArchived(fileName) {

    return logActivity({

        category: "SYSTEM",

        action: "Activity Log Archived",

        details: fileName,

        user_name: "Administrator",

        status: "SUCCESS"

    });

}

async function logApplicationClosed() {

    return logActivity({

        category: "SYSTEM",

        action: "Application Closed",

        details: "Kaira Luxe Billing System closed",

        user_name: "Administrator",

        status: "SUCCESS"

    });

}

/* ===========================================
   BILLING
=========================================== */

async function logInvoiceGenerated(
    billNumber,
    amount,
    items
) {

    return logActivity({

        category: "BILLING",

        action: "Invoice Generated",

        details:
            `Bill ${billNumber} | ₹${amount} | ${items} Item(s)`,

        user_name: "Administrator",

        status: "SUCCESS"

    });

}

async function logPaymentCorrected(
    billNumber
) {

    return logActivity({

        category: "BILLING",

        action: "Payment Corrected",

        details: `Bill ${billNumber}`,

        user_name: "Administrator",

        status: "SUCCESS"

    });

}

/* ===========================================
   INVENTORY
=========================================== */

async function logProductImport(count) {

    return logActivity({

        category: "INVENTORY",

        action: "Product Import",

        details: `${count} product(s) imported`,

        user_name: "Administrator",

        status: "SUCCESS"

    });

}

async function logInventoryReset() {

    return logActivity({

        category: "INVENTORY",

        action: "Inventory Reset",

        details: "Inventory reset completed",

        user_name: "Administrator",

        status: "SUCCESS"

    });

}

/* ===========================================
   SETTINGS
=========================================== */

async function logSettingsChanged() {

    return logActivity({

        category: "SETTINGS",

        action: "Settings Changed",

        details: "System settings updated",

        user_name: "Administrator",

        status: "SUCCESS"

    });

}

/* ===========================================
   BACKUP
=========================================== */

async function logBackupCreated(fileName) {

    return logActivity({

        category: "BACKUP",

        action: "Backup Created",

        details: fileName,

        user_name: "Administrator",

        status: "SUCCESS"

    });

}

async function logBackupFailed(reason) {

    return logActivity({

        category: "BACKUP",

        action: "Backup Failed",

        details: reason,

        user_name: "Administrator",

        status: "ERROR"

    });

}

/* ===========================================
   RESTORE
=========================================== */

async function logRestoreCompleted(fileName) {

    return logActivity({

        category: "RESTORE",

        action: "Restore Completed",

        details: fileName,

        user_name: "Administrator",

        status: "SUCCESS"

    });

}

async function logRestoreFailed(reason) {

    return logActivity({

        category: "RESTORE",

        action: "Restore Failed",

        details: reason,

        user_name: "Administrator",

        status: "ERROR"

    });

}

/* ===========================================
   DAY CLOSING
=========================================== */

async function logBusinessDayOpened(date) {

    return logActivity({

        category: "DAY CLOSING",

        action: "Business Day Opened",

        details: date,

        user_name: "Administrator",

        status: "SUCCESS"

    });

}

async function logBusinessDayClosed(date) {

    return logActivity({

        category: "DAY CLOSING",

        action: "Business Day Closed",

        details: date,

        user_name: "Administrator",

        status: "SUCCESS"

    });

}

module.exports = {

    logApplicationStarted,

    logApplicationClosed,

    logApplicationUpdated,

    logDatabaseReset,

    logActivityArchived,

    logInvoiceGenerated,

    logPaymentCorrected,

    logProductImport,

    logInventoryReset,

    logSettingsChanged,

    logBackupCreated,

    logBackupFailed,

    logRestoreCompleted,

    logRestoreFailed,

    logBusinessDayOpened,

    logBusinessDayClosed

};