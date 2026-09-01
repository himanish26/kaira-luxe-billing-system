const db = require("../database/database");
const https = require("https");
const { BrowserWindow } = require("electron");

const {
    getBackupHistory
} = require("../services/backupService");

const {
    getSettings
} = require("../database/settingsService");

/* ==========================================
   DATABASE STATUS
========================================== */

function getDatabaseStatus() {

    return new Promise((resolve) => {

        const start = Date.now();

        db.get(
            "SELECT 1",
            [],
            (err) => {

                if (err) {

                    resolve({

                        healthy: false,

                        status: "Error",

                        latency: null

                    });

                    return;

                }

                resolve({

                    healthy: true,

                    status: "Healthy",

                    latency: Date.now() - start

                });

            }

        );

    });

}

function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (error, rows) => {
            if (error) reject(error);
            else resolve(rows || []);
        });
    });
}

async function getDatabaseIntegrityStatus() {
    try {
        const integrityRows = await all("PRAGMA integrity_check");
        const integrityPassed =
            integrityRows.length === 1 &&
            String(integrityRows[0].integrity_check).toLowerCase() === "ok";
        const foreignKeyRows = await all("PRAGMA foreign_key_check");
        return {
            healthy: integrityPassed && foreignKeyRows.length === 0,
            integrityPassed,
            foreignKeyViolations: foreignKeyRows.length
        };
    }
    catch (error) {
        return { healthy: false, error: "Integrity check unavailable" };
    }
}

async function getProductInventoryStatus() {
    try {
        const rows = await all(`
            SELECT name
            FROM sqlite_master
            WHERE type = 'table'
              AND name IN ('products', 'inventory_transactions')
        `);
        const names = new Set(rows.map(row => row.name));
        if (!names.has("products") || !names.has("inventory_transactions")) {
            return { healthy: false };
        }
        await all(`
            SELECT p.id, COALESCE(SUM(it.quantity), 0) AS current_stock
            FROM products p
            LEFT JOIN inventory_transactions it ON it.product_id = p.id
            GROUP BY p.id
            LIMIT 1
        `);
        const countRows = await all("SELECT COUNT(*) AS product_count FROM products");
        return { healthy: true, productCount: Number(countRows[0].product_count) };
    }
    catch (error) {
        return { healthy: false };
    }
}

function formatBusinessDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    return match ? `${match[3]}/${match[2]}/${match[1]}` : "Unknown Date";
}

async function getStartupCheck(checkName, dependencies = {}) {
    const critical = [
        "database", "databaseIntegrity", "productInventory",
        "administratorSecurity", "businessDay"
    ].includes(checkName);
    const result = (state, message, extra = {}) => ({
        id: checkName, critical, state, message, ...extra
    });

    try {
        switch (checkName) {
        case "database": {
            const status = await getDatabaseStatus();
            return status.healthy
                ? result("ready", "Ready")
                : result("failed", "Database unavailable");
        }
        case "databaseIntegrity": {
            const status = await getDatabaseIntegrityStatus();
            return status.healthy
                ? result("ready", "Passed")
                : result("failed", "Integrity check failed");
        }
        case "productInventory": {
            const status = await getProductInventoryStatus();
            if (!status.healthy) {
                return result("failed", "Product or inventory layer unavailable");
            }
            return status.productCount === 0
                ? result("warning", "No products found - import products from Inventory to start billing",
                    { productCount: 0 })
                : result("ready", `Ready - ${status.productCount} products`,
                    { productCount: status.productCount });
        }
        case "administratorSecurity": {
            const status = await dependencies.getAdministratorSecurityStatus();
            if (!status.initialized) {
                return result("failed", "Setup required", { action: "initializeAdministratorPin" });
            }
            if (!status.masterRecoveryProvisioned) {
                return result("failed", "Administrator recovery not provisioned");
            }
            return result("ready", "Ready");
        }
        case "backup": {
            const status = await getLatestBackupStatus();
            if (status.status === "Never") return result("warning", "No backup found");
            if (status.status === "Unavailable") return result("warning", "Backup status unavailable");
            const createdAt = new Date(status.createdAt);
            if (!Number.isFinite(createdAt.getTime())) {
                return result("warning", "Backup date unavailable");
            }
            if (Date.now() - createdAt.getTime() > 24 * 60 * 60 * 1000) {
                return result("warning", "No recent backup");
            }
            return result("ready", "Ready");
        }
        case "printer": {
            const status = await getPrinterStatus();
            return status.status === "Ready"
                ? result("ready", status.name ? `Ready — ${status.name}` : "Ready")
                : result("warning",
                    status.status === "No Default" ? "No Default Printer" : "Printer unavailable");
        }
        case "internet": {
            const status = await getInternetStatus();
            return status.online
                ? result("ready", "Online")
                : result("warning", "Offline");
        }
        case "businessDay": {
            const status = await dependencies.getBusinessDayState();
            const displayDate = formatBusinessDate(status.businessDate);
            return status.closed
                ? result("failed", `CLOSED — ${displayDate}`, { businessDate: status.businessDate })
                : status.closing
                    ? result("failed", `CLOSING — ${displayDate}`, { businessDate: status.businessDate })
                    : result("ready", `OPEN — ${displayDate}`, { businessDate: status.businessDate });
        }
        default:
            return result(critical ? "failed" : "warning", "Unknown check");
        }
    }
    catch (error) {
        return result(critical ? "failed" : "warning", "Check unavailable");
    }
}

/* ==========================================
   INTERNET STATUS
========================================== */

function getInternetStatus() {

    return new Promise((resolve) => {

        const request = https.get(

            "https://clients3.google.com/generate_204",

            () => {

                resolve({

                    online: true,

                    status: "Online"

                });

            }

        );

        request.on("error", () => {

            resolve({

                online: false,

                status: "Offline"

            });

        });

        request.setTimeout(3000, () => {

            request.destroy();

            resolve({

                online: false,

                status: "Offline"

            });

        });

    });

}

/* ==========================================
   PRINTER STATUS
========================================== */

async function getPrinterStatus() {

    try {

        const settings =
            await getSettings();

        const configuredPrinter =
            settings.default_printer;

        if (!configuredPrinter) {

            return {

                status: "No Default"

            };

        }

        const { execFile } =
            require("child_process");

        return await new Promise(
            (resolve) => {

                const command =
                    `Get-CimInstance Win32_Printer | ` +
                    `Where-Object { $_.Name -eq '${configuredPrinter.replace(/'/g, "''")}' } | ` +
                    `Select-Object Name, PrinterStatus, WorkOffline, DetectedErrorState | ` +
                    `ConvertTo-Json -Compress`;

                execFile(

                    "powershell.exe",

                    [

                        "-NoProfile",

                        "-Command",

                        command

                    ],

                    (

                        error,

                        stdout,

                        stderr

                    ) => {

                        if (error) {

                            console.error(
                                "Windows Printer Status Error:",
                                error,
                                stderr
                            );

                            resolve({

                                status: "Unavailable",

                                name:
                                    configuredPrinter

                            });

                            return;

                        }

                        const output =
                            stdout.trim();

                        if (!output) {

                            resolve({

                                status:
                                    "No Printer",

                                name:
                                    configuredPrinter

                            });

                            return;

                        }

                        let printer;

                        try {

                            printer =
                                JSON.parse(output);

                        }

                        catch (parseError) {

                            console.error(
                                "Printer Status Parse Error:",
                                parseError,
                                output
                            );

                            resolve({

                                status:
                                    "Unavailable",

                                name:
                                    configuredPrinter

                            });

                            return;

                        }

                        if (!printer) {

                            resolve({

                                status:
                                    "No Printer",

                                name:
                                    configuredPrinter

                            });

                            return;

                        }

                        const isOffline =
                            printer.WorkOffline === true;

                        const hasError =
                            printer.DetectedErrorState !== 0 &&
                            printer.DetectedErrorState !== null;

                        if (isOffline || hasError) {

                            resolve({

                                status:
                                    "Offline",

                                name:
                                    printer.Name ||
                                    configuredPrinter,

                                printerStatus:
                                    printer.PrinterStatus,

                                workOffline:
                                    printer.WorkOffline,

                                detectedErrorState:
                                    printer.DetectedErrorState

                            });

                            return;

                        }

                        resolve({

                            status:
                                "Ready",

                            name:
                                printer.Name ||
                                configuredPrinter,

                            printerStatus:
                                printer.PrinterStatus,

                            workOffline:
                                printer.WorkOffline

                        });

                    }

                );

            }

        );

    }

    catch (error) {

        console.error(
            "Printer Status Error:",
            error
        );

        return {

            status:
                "Unavailable"

        };

    }

}

/* ==========================================
   BACKUP STATUS
========================================== */

async function getLatestBackupStatus() {

    try {

        const backups =
            await getBackupHistory();

        if (!backups || backups.length === 0) {

            return {

                status: "Never"

            };

        }

        const latest =
            backups[0];

        const createdAt =
            new Date(latest.createdAt);

        const formattedDate =
            createdAt.toLocaleDateString(
                "en-IN",
                {
                    day: "2-digit",
                    month: "short",
                    year: "numeric"
                }
            );

        const formattedTime =
            createdAt.toLocaleTimeString(
                "en-IN",
                {
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: true
                }
            ).toUpperCase();

        return {

            status:
                `${formattedDate} • ${formattedTime}`,

            fileName:
                latest.fileName,

            createdAt:
                latest.createdAt,

            size:
                latest.size

        };

    }

    catch (error) {

        console.error(
            "Unable to read backup status:",
            error
        );

        return {

            status: "Unavailable"

        };

    }

}

/* ==========================================
   SYSTEM STATUS
========================================== */

async function getSystemStatus() {

    const database =
        await getDatabaseStatus();

    const internet =
        await getInternetStatus();

    return {

        database,

        internet,

        printer: await getPrinterStatus(),

        backup: await getLatestBackupStatus()

    };

}

module.exports = {

    getSystemStatus,
    getStartupCheck,
    getDatabaseStatus,
    getDatabaseIntegrityStatus,
    getProductInventoryStatus

};
