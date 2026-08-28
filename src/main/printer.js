const {
    BrowserWindow,
    dialog
} = require("electron");
const path = require("path");

const { getSettings } = require("../database/settingsService");

async function printBill(billData){

    console.log("PRINT FUNCTION CALLED");
    console.log(billData);

    return new Promise((resolve, reject)=>{

        const printWindow = new BrowserWindow({

            show: false,

            width: 302,

            height: 800,

            webPreferences: {

                nodeIntegration: true,

                contextIsolation: false

            }

        });

        printWindow.loadFile(

            path.join(
                __dirname,
                "../renderer/receipt.html"
            )

        );

        printWindow.webContents.once(

            "did-finish-load",

            async () => {

                const settings = await getSettings();

                const printerName = settings.default_printer;

                await printWindow.webContents.executeJavaScript(
    `window.receiptData = ${JSON.stringify(billData)};
     window.storeSettings = ${JSON.stringify(settings)};`
);

                await printWindow.webContents.executeJavaScript(

                    "if(window.loadReceipt){ loadReceipt(); }"
                );

                setTimeout(() => {

                    printWindow.webContents.print(

                        {
    silent: true,

    printBackground: true,

    deviceName: printerName,

    margins: {
        marginType: "none"
    },

    landscape: false,

    scaleFactor: 100,

    usePrinterDefaultPageSize: true
},

                        (success, error) => {

                            printWindow.close();

                            if (success) {

                                resolve({
                                    success: true
                                });

                            } else {

                                reject(error);

                            }

                        }

                    );

                }, 300);

            }

        );

    });

}

/* =====================================
   PRINT STORE CREDIT
===================================== */

async function printStoreCredit(storeCreditData) {

    console.log(
        "PRINT STORE CREDIT FUNCTION CALLED"
    );

    console.log(storeCreditData);

    let printWindow = null;

    try {

        const settings =
            await getSettings();

        const printerName =
            settings.default_printer;

        if (!printerName) {

            return {
                success: false,
                error:
                    "No default printer is configured."
            };

        }

        printWindow =
            new BrowserWindow({

                show: false,

                width: 302,

                height: 1000,

                webPreferences: {

                    nodeIntegration: true,

                    contextIsolation: false

                }

            });

        await printWindow.loadFile(

            path.join(
                __dirname,
                "../renderer/storeCreditReceipt.html"
            )

        );

        await printWindow.webContents
            .executeJavaScript(

                `window.storeCreditData = ${JSON.stringify(
                    storeCreditData
                )};
                 window.storeSettings = ${JSON.stringify(
                    settings
                )};`

            );

        await printWindow.webContents
            .executeJavaScript(

                `if (
                    typeof loadStoreCreditReceipt === "function"
                ) {
                    loadStoreCreditReceipt();
                }`

            );

        await new Promise(
            resolve => setTimeout(resolve, 500)
        );

        const result =
            await new Promise(resolve => {

                if (
                    !printWindow ||
                    printWindow.isDestroyed()
                ) {

                    resolve({
                        success: false,
                        error:
                            "Print window was destroyed."
                    });

                    return;

                }

                printWindow.webContents.print(

                    {

                        silent: true,

                        printBackground: true,

                        deviceName:
                            printerName,

                        margins: {

                            marginType:
                                "none"

                        },

                        landscape: false,

                        scaleFactor: 100,

                        usePrinterDefaultPageSize:
                            true

                    },

                    (success, error) => {

                        resolve({

                            success,

                            error:
                                error || null

                        });

                    }

                );

            });

        if (
            printWindow &&
            !printWindow.isDestroyed()
        ) {

            printWindow.close();

        }

        return result;

    }

    catch (error) {

        console.error(
            "STORE CREDIT PRINT ERROR:",
            error
        );

        if (
            printWindow &&
            !printWindow.isDestroyed()
        ) {

            printWindow.close();

        }

        return {

            success: false,

            error:
                error.message ||
                "Store Credit printing failed."

        };

    }

}
async function saveBillPdf(billData){

    console.log("SAVE PDF FUNCTION CALLED");

    return new Promise((resolve, reject)=>{

        const printWindow = new BrowserWindow({

            show: false,

            width: 302,

            height: 800,

            webPreferences: {

                nodeIntegration: true,

                contextIsolation: false

            }

        });

        printWindow.loadFile(

            path.join(
                __dirname,
                "../renderer/receipt.html"
            )

        );

        printWindow.webContents.once(

            "did-finish-load",

            async () => {

                const settings = await getSettings();

await printWindow.webContents.executeJavaScript(
    `window.receiptData = ${JSON.stringify(billData)};
     window.storeSettings = ${JSON.stringify(settings)};`
);

                await printWindow.webContents.executeJavaScript(

                    "if(window.loadReceipt){ loadReceipt(); }"

                );

                setTimeout(() => {

                    printWindow.webContents.print(

                        {

                            silent: false,

                            printBackground: true

                        },

                        (success,error)=>{

                            printWindow.close();

                            if(success){

                                resolve({
                                    success:true
                                });

                            }

                            else{

                                resolve({
                                    success:false,
                                    error:error || "PDF generation cancelled."

                                });

                            }

                        }

                    );

                },300);

            }

        );

    });

}

async function printTestReceipt(printerName) {

    return new Promise((resolve, reject) => {

        const printWindow = new BrowserWindow({

            show: false,

            width: 302,

            height: 1000,

            webPreferences: {

                nodeIntegration: true,

                contextIsolation: false

            }

        });

        printWindow.loadFile(

            path.join(
                __dirname,
                "../renderer/receipt.html"
            )

        );

        printWindow.webContents.once(

            "did-finish-load",

            async () => {

                try {

                    const settings =
                        await getSettings();

                    const testReceipt = {

                        testPrint: true,

                        bill_no: "TEST-PRINT",

                        bill_date:
                            new Date().toLocaleDateString(
                                "en-IN"
                            ),

                        bill_time:
                            new Date().toLocaleTimeString(
                                "en-IN"
                            ),

                        customer_name:
                            "PRINTER TEST",

                        customer_mobile:
                            "",

                        total_items: 1,

                        total_qty: 1,

                        gross_amount: 100,

                        discount_amount: 0,

                        taxable_amount: 84.75,

                        cgst_amount: 7.63,

                        sgst_amount: 7.63,

                        gst_amount: 15.25,

                        net_amount: 100,

                        cash_amount: 100,

                        upi_amount: 0,

                        card_amount: 0,

                        items: [

                            {

                                barcode: "8901234567890",

                                brand: "TEST",

                                product_name:
                                    "PRINTER TEST ITEM",

                                category:
                                    "TEST",

                                size: "FREE",

                                colour: "TEST",

                                qty: 1,

                                mrp: 100,

                                discount: 0,

                                discount_percent: 0,

                                gross_amount: 100,

                                discount_amount: 0,

                                taxable_amount: 84.75,

                                gst_rate: 18,

                                gst_amount: 15.25,

                                net_amount: 100

                            }

                        ]

                    };

                    await printWindow.webContents.executeJavaScript(

                        `window.receiptData = ${JSON.stringify(testReceipt)};
                         window.storeSettings = ${JSON.stringify(settings)};`

                    );

                    await printWindow.webContents.executeJavaScript(

                        "if(window.loadReceipt){ loadReceipt(); }"

                    );

                    setTimeout(() => {

                            printWindow.webContents.print(

    {

        silent: true,

        printBackground: true,

        deviceName: printerName,

        margins: {
    marginType: "none"
},

landscape: false,

scaleFactor: 100,

usePrinterDefaultPageSize: true,

     

    },

                            (success, error) => {

                                printWindow.close();

                                if (success) {

                                    resolve({

                                        success: true

                                    });

                                }

                                else {

                                    reject(

                                        error ||
                                        new Error(
                                            "Printer test failed."
                                        )

                                    );

                                }

                            }

                        );

                    }, 500);

                }

                catch (error) {

                    printWindow.close();

                    reject(error);

                }

            }

        );

    });

}

async function printDayClosingReceipt(dayClosingData) {

    return new Promise((resolve, reject) => {

        const printWindow = new BrowserWindow({

            show: false,

            width: 320,

            height: 900,

            webPreferences: {

                nodeIntegration: true,

                contextIsolation: false

            }

        });

        printWindow.loadFile(

            path.join(

                __dirname,

                "../renderer/dayClosingReceipt.html"

            )

        );

        printWindow.webContents.once(

            "did-finish-load",

            async () => {

                await printWindow.webContents.executeJavaScript(

`window.dayClosingData = ${JSON.stringify(dayClosingData)};`

                );

                await printWindow.webContents.executeJavaScript(

    "if(window.loadDayClosingReceipt){ loadDayClosingReceipt(); }"

);

                setTimeout(() => {

                    printWindow.webContents.print(

                        {
    silent: true,

    printBackground: true,

    margins: {
    marginType: "none"
},

landscape: false,

scaleFactor: 100,

usePrinterDefaultPageSize: true
},

                        (success, error) => {

                            printWindow.close();

                            if (success) {

                                resolve({

                                    success: true

                                });

                            }

                            else {

                                reject(error);

                            }

                        }

                    );

                }, 300);

            }

        );

    });

}

module.exports = {

    printBill,

    printStoreCredit,

    saveBillPdf,

    printTestReceipt,

    printDayClosingReceipt

};