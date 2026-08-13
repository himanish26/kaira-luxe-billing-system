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

        const printers =
            await BrowserWindow
                .getFocusedWindow()
                ?.webContents
                .getPrintersAsync();

        if (!printers || printers.length === 0) {

            return {

                status: "No Printer"

            };

        }

        const settings =
            await getSettings();

            console.log(
    "PRINTER DEBUG - Kaira Luxe Billing System settings:",
    settings
);

        const configuredPrinter =
            settings.default_printer;

        console.log(
    "PRINTER DEBUG - configured printer:",
    configuredPrinter
);

console.log(
    "PRINTER DEBUG - installed printers:",
    printers
);

        if (!configuredPrinter) {

            return {

                status: "No Default"

            };

        }

        const selectedPrinter =
            printers.find(
                printer =>
                    printer.name ===
                    configuredPrinter
            );

        if (!selectedPrinter) {

            return {

                status: "No Printer",

                name:
                    configuredPrinter

            };

        }

        if (selectedPrinter.status === 0) {

            return {

                status: "Ready",

                name:
                    selectedPrinter.name

            };

        }

        return {

            status: "Offline",

            name:
                selectedPrinter.name

        };

    }

    catch (error) {

        console.error(
            "Printer Status Error:",
            error
        );

        return {

            status: "Unavailable"

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

    getSystemStatus

};