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

            width: 320,

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

                            silent: true,

                            printBackground: true

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



async function saveBillPdf(billData){

    console.log("SAVE PDF FUNCTION CALLED");

    return new Promise((resolve, reject)=>{

        const printWindow = new BrowserWindow({

            show: false,

            width: 320,

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

module.exports = {

    printBill,
    saveBillPdf

};