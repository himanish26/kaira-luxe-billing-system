const db = require("../database/database");
const https = require("https");
const { BrowserWindow } = require("electron");

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

        const defaultPrinter =
            printers.find(
                p => p.isDefault
            );

        if (!defaultPrinter) {

            return {

                status: "No Default"

            };

        }

        if (defaultPrinter.status === 0) {

            return {

                status: "Ready",

                name: defaultPrinter.name

            };

        }

        return {

            status: "Offline",

            name: defaultPrinter.name

        };

    }

    catch (error) {

        console.error(error);

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

        backup: {

            status: "Never"

        }

    };

}

module.exports = {

    getSystemStatus

};