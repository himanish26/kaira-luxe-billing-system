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

    getSystemStatus

};