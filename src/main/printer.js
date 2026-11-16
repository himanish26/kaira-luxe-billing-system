const {
    app,
    BrowserWindow,
    dialog
} = require("electron");
const path = require("path");
const fs = require("fs/promises");

const { getSettings } = require("../database/settingsService");
const technicalLogger = require("../services/technicalLogger");

const TAX_INVOICE_DEFAULT_PROFILE = Object.freeze({
    font: "arial",
    size: 13,
    margins: Object.freeze({ top: 2, right: 5, bottom: 2, left: 5 })
});

const DEVICE_PREVIEW_FONT_FAMILIES = Object.freeze({
    arial: "Arial, Helvetica, sans-serif",
    trebuchet: "'Trebuchet MS', Arial, sans-serif",
    verdana: "Verdana, Geneva, sans-serif",
    georgia: "Georgia, 'Times New Roman', serif",
    times: "'Times New Roman', Times, serif",
    courier: "'Courier New', monospace"
});

function savedTaxInvoiceProfile(settings) {
    try {
        const allPreferences = JSON.parse(settings?.device_print_preview_settings || "{}");
        const saved = allPreferences?.["tax-invoice"];
        return saved ? normalizeDevicePreviewSettings(saved) : normalizeDevicePreviewSettings(TAX_INVOICE_DEFAULT_PROFILE);
    } catch {
        return normalizeDevicePreviewSettings(TAX_INVOICE_DEFAULT_PROFILE);
    }
}

function receiptTypographyRules(size) {
    const detailSize = Math.max(8, Math.round(size * 11 / 13 * 100) / 100);
    const footerSize = Math.max(8, Math.round(size * 12 / 13 * 100) / 100);
    return `
        .receipt .billInfo, .receipt > table, .receipt .totals, .receipt .payment { font-size: ${size}px !important; }
        .receipt td div[style*="font-size:13px"] { font-size: ${size}px !important; }
        .receipt td div[style*="font-size:11px"] { font-size: ${detailSize}px !important; }
        .receipt .footer, .receipt .footer strong { font-size: ${footerSize}px !important; }
        .receipt .return-note { font-size: ${detailSize}px !important; }
    `;
}

function taxInvoicePrintCss(profile) {
    const fontFamily = DEVICE_PREVIEW_FONT_FAMILIES[profile.font];
    const { top, right, bottom, left } = profile.margins;
    return `
        @page { size: 80mm auto !important; margin: 0 !important; }
        html, body { box-sizing: border-box !important; width: 80mm !important; margin: 0 !important; background: #fff !important; }
        body { padding: ${top}mm ${right}mm ${bottom}mm ${left}mm !important; font-family: ${fontFamily} !important; font-size: ${profile.size}px !important; }
        .receipt { box-sizing: border-box !important; width: 100% !important; max-width: none !important; margin: 0 !important; padding: 0 !important; font-family: ${fontFamily} !important; font-size: ${profile.size}px !important; }
        .receipt, .receipt * { font-family: ${fontFamily} !important; }
        ${receiptTypographyRules(profile.size)}
    `;
}

function previewPrintCss(profile) {
    const fontFamily = DEVICE_PREVIEW_FONT_FAMILIES[profile.font];
    const { top, right, bottom, left } = profile.margins;
    return `
        html, body { box-sizing: border-box !important; }
        body { padding: ${top}mm ${right}mm ${bottom}mm ${left}mm !important; font-family: ${fontFamily} !important; font-size: ${profile.size}px !important; }
        .receipt, .credit-note { box-sizing: border-box !important; width: 100% !important; max-width: none !important; margin: 0 !important; padding: 0 !important; font-family: ${fontFamily} !important; font-size: ${profile.size}px !important; }
        .receipt *, .credit-note * { font-family: ${fontFamily} !important; }
        ${receiptTypographyRules(profile.size)}
    `;
}

async function applyPrintCss(printWindow, cssText, styleId) {
    await printWindow.webContents.executeJavaScript(`(() => {
        let style = document.getElementById(${JSON.stringify(styleId)});
        if (!style) { style = document.createElement('style'); style.id = ${JSON.stringify(styleId)}; document.head.appendChild(style); }
        style.textContent = ${JSON.stringify(cssText)};
    })()`);
}

async function prepareBillReceipt(printWindow, billData, settings) {
    await printWindow.loadFile(path.join(__dirname, "../renderer/receipt.html"));
    await printWindow.webContents.executeJavaScript(
        `window.receiptData = ${JSON.stringify(billData)}; window.storeSettings = ${JSON.stringify(settings)};`
    );
    await printWindow.webContents.executeJavaScript("if (window.loadReceipt) { window.loadReceipt(); }");
    await applyPrintCss(printWindow, taxInvoicePrintCss(savedTaxInvoiceProfile(settings)), "klbs-tax-invoice-print-profile");
    await printWindow.webContents.executeJavaScript("document.fonts ? document.fonts.ready : Promise.resolve()");
}

async function printBill(billData) {
    const settings = await getSettings();
    let printWindow = null;
    try {
        printWindow = new BrowserWindow({
            show: false,
            width: 302,
            height: 1200,
            webPreferences: { nodeIntegration: true, contextIsolation: false }
        });
        await prepareBillReceipt(printWindow, billData, settings);
        await new Promise((resolve, reject) => {
            printWindow.webContents.print({
                silent: true,
                printBackground: true,
                deviceName: settings.default_printer,
                margins: { marginType: "none" },
                landscape: false,
                scaleFactor: 100,
                usePrinterDefaultPageSize: true
            }, (success, error) => success
                ? resolve()
                : reject(new Error(error || "Printer rejected bill output.")));
        });
        return { success: true };
    } catch (error) {
        technicalLogger.error("PRINTER", "Bill printing failed", error, { documentType: "BILL" });
        throw error;
    } finally {
        if (printWindow && !printWindow.isDestroyed()) printWindow.close();
    }
}

/* =====================================
   PRINT STORE CREDIT
===================================== */

async function printStoreCredit(storeCreditData) {

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

        if (!result.success) {
            technicalLogger.error(
                "PRINTER",
                "Store Credit printing failed",
                new Error(result.error || "Printer rejected Store Credit output"),
                { documentType: "STORE_CREDIT" }
            );
        }

        return result;

    }

    catch (error) {

        console.error(
            "STORE CREDIT PRINT ERROR:",
            error
        );
        technicalLogger.error(
            "PRINTER",
            "Store Credit printing failed",
            error,
            { documentType: "STORE_CREDIT" }
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
function safeBillPdfName(billData) {
    const billNo = String(billData?.bill_no || "Kaira-Luxe-Bill")
        .trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").replace(/[. ]+$/g, "");
    return `${billNo || "Kaira-Luxe-Bill"}.pdf`;
}

async function saveBillPdf(billData, parentWindow = null) {
    const saveOptions = {
        title: "Save Tax Invoice as PDF",
        defaultPath: path.join(app.getPath("downloads"), safeBillPdfName(billData)),
        filters: [{ name: "PDF Documents", extensions: ["pdf"] }]
    };
    const destination = parentWindow
        ? await dialog.showSaveDialog(parentWindow, saveOptions)
        : await dialog.showSaveDialog(saveOptions);
    if (destination.canceled || !destination.filePath) {
        return { success: false, error: "PDF generation cancelled." };
    }

    const settings = await getSettings();
    let printWindow = null;
    try {
        printWindow = new BrowserWindow({
            show: false,
            width: 302,
            height: 1200,
            webPreferences: { nodeIntegration: true, contextIsolation: false }
        });
        await prepareBillReceipt(printWindow, billData, settings);
        const pageHeightInches = await printWindow.webContents.executeJavaScript(`(() => {
            const receipt = document.querySelector('.receipt');
            if (!receipt) throw new Error('Tax Invoice content could not be measured.');
            const body = getComputedStyle(document.body);
            const top = parseFloat(body.paddingTop) || 0;
            const bottom = parseFloat(body.paddingBottom) || 0;
            const heightPx = receipt.getBoundingClientRect().height + top + bottom + (5 * 96 / 25.4);
            return Math.max(2, Math.ceil((heightPx / 96) * 100) / 100);
        })()`);
        const pdf = await printWindow.webContents.printToPDF({
            printBackground: true,
            landscape: false,
            pageSize: { width: 80 / 25.4, height: pageHeightInches },
            margins: { top: 0, right: 0, bottom: 0, left: 0 },
            preferCSSPageSize: false,
            scale: 1
        });
        await fs.writeFile(destination.filePath, pdf);
        return { success: true, filePath: destination.filePath };
    } catch (error) {
        technicalLogger.error("PRINTER", "Bill PDF generation failed", error, { documentType: "BILL_PDF" });
        return { success: false, error: error.message || "The PDF could not be saved." };
    } finally {
        if (printWindow && !printWindow.isDestroyed()) printWindow.close();
    }
}

function createCreditNoteWindow() {
    return new BrowserWindow({
        show: false,
        width: 302,
        height: 1000,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });
}

async function loadCreditNoteDocument(printWindow, creditNoteData) {
    const settings = await getSettings();
    await printWindow.loadFile(
        path.join(__dirname, "../renderer/creditNote.html")
    );
    await printWindow.webContents.executeJavaScript(
        `window.creditNoteData = ${JSON.stringify(creditNoteData)};
         window.storeSettings = ${JSON.stringify(settings)};
         if (window.loadCreditNote) { loadCreditNote(); }`
    );
    return settings;
}

async function printCreditNote(creditNoteData) {
    const printWindow = createCreditNoteWindow();
    try {
        const settings = await loadCreditNoteDocument(
            printWindow,
            creditNoteData
        );
        return await new Promise((resolve, reject) => {
            printWindow.webContents.print(
                {
                    silent: true,
                    printBackground: true,
                    deviceName: settings.default_printer,
                    margins: { marginType: "none" },
                    landscape: false,
                    scaleFactor: 100,
                    usePrinterDefaultPageSize: true
                },
                (success, error) => {
                    if (success) {
                        resolve({ success: true });
                        return;
                    }
                    reject(
                        new Error(error || "Credit Note printing failed.")
                    );
                }
            );
        });
    }
    catch (error) {
        technicalLogger.error(
            "PRINTER",
            "Credit Note printing failed",
            error,
            { documentType: "CREDIT_NOTE" }
        );
        throw error;
    }
    finally {
        if (!printWindow.isDestroyed()) {
            printWindow.close();
        }
    }
}

async function saveCreditNotePdf(creditNoteData) {
    const printWindow = createCreditNoteWindow();
    try {
        await loadCreditNoteDocument(printWindow, creditNoteData);
        const safeCreditNoteNo = String(
            creditNoteData.credit_note_no || "Credit_Note"
        ).replace(/[^A-Za-z0-9_-]/g, "_");
        const selection = await dialog.showSaveDialog({
            title: "Save Credit Note PDF",
            defaultPath: `Credit_Note_${safeCreditNoteNo}.pdf`,
            filters: [{ name: "PDF Documents", extensions: ["pdf"] }]
        });
        if (selection.canceled || !selection.filePath) {
            return { success: false, canceled: true };
        }
        const pdf = await printWindow.webContents.printToPDF({
            printBackground: true,
            pageSize: "A4",
            margins: {
                top: 0.25,
                bottom: 0.25,
                left: 0.25,
                right: 0.25
            }
        });
        await fs.writeFile(selection.filePath, pdf);
        return { success: true, filePath: selection.filePath };
    }
    catch (error) {
        technicalLogger.error(
            "PRINTER",
            "Credit Note PDF generation failed",
            error,
            { documentType: "CREDIT_NOTE_PDF" }
        );
        throw error;
    }
    finally {
        if (!printWindow.isDestroyed()) {
            printWindow.close();
        }
    }
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

                    technicalLogger.error(
                        "PRINTER",
                        "Test receipt printing failed",
                        error,
                        { documentType: "TEST_RECEIPT" }
                    );

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

                                technicalLogger.error(
                                    "PRINTER",
                                    "Day Closing receipt printing failed",
                                    new Error(error || "Printer rejected Day Closing output"),
                                    { documentType: "DAY_CLOSING" }
                                );

                                reject(error);

                            }

                        }

                    );

                }, 300);

            }

        );

    });

}

async function printStockInwardReceipt(receiptData) {
    let printWindow = null;
    try {
        const settings = await getSettings();
        const printerName = settings.stock_inward_printer || settings.default_printer;
        if (!printerName) throw new Error("No KLBS printer is configured for Stock Inward.");
        const useA4 = settings.stock_inward_print_profile === "A4";
        printWindow = new BrowserWindow({
            show: false,
            width: useA4 ? 794 : 302,
            height: useA4 ? 1123 : 800,
            webPreferences: { nodeIntegration: true, contextIsolation: false }
        });
        await printWindow.loadFile(path.join(__dirname, useA4 ? "../renderer/stock-inward-a4.html" : "../renderer/stock-inward-receipt.html"));
        const serialized=JSON.stringify(receiptData).replace(/</g,"\\u003c");
        await printWindow.webContents.executeJavaScript(`window.stockInwardReceipt=${serialized}; if(window.renderStockInwardA4) window.renderStockInwardA4(); if(window.renderStockInwardReceipt) window.renderStockInwardReceipt();`);
        await new Promise(resolve=>setTimeout(resolve,300));
        await new Promise((resolve,reject)=>printWindow.webContents.print({
            silent:true,
            printBackground:true,
            deviceName:printerName,
            ...(useA4 ? { pageSize:"A4" } : { margins:{marginType:"none"}, usePrinterDefaultPageSize:true }),
            landscape:false,
            scaleFactor:100
        },(success,error)=>success?resolve():reject(new Error(error||"Printer rejected Stock Inward output."))));
        return {success:true};
    } catch(error) {
        technicalLogger.error("PRINTER","Stock Inward thermal receipt failed",error,{documentType:"STOCK_INWARD"});
        throw new Error("Stock Inward receipt could not be printed.");
    } finally {
        if(printWindow&&!printWindow.isDestroyed())printWindow.close();
    }
}

async function printStockOutwardReceipt(receiptData) {
    let printWindow = null;
    try {
        const settings = await getSettings();
        const printerName = settings.stock_outward_printer || settings.default_printer;
        if (!printerName) throw new Error("No KLBS printer is configured for Stock Outward.");
        const useA4 = settings.stock_outward_print_profile === "A4";
        printWindow = new BrowserWindow({
            show: false,
            width: useA4 ? 794 : 302,
            height: useA4 ? 1123 : 800,
            webPreferences: { nodeIntegration: true, contextIsolation: false }
        });
        await printWindow.loadFile(path.join(__dirname, useA4 ? "../renderer/stock-outward-a4.html" : "../renderer/stock-outward-receipt.html"));
        const serialized=JSON.stringify(receiptData).replace(/</g,"\\u003c");
        await printWindow.webContents.executeJavaScript(`window.stockOutwardReceipt=${serialized}; if(window.renderStockOutwardA4) window.renderStockOutwardA4(); if(window.renderStockOutwardReceipt) window.renderStockOutwardReceipt();`);
        await new Promise(resolve=>setTimeout(resolve,300));
        await new Promise((resolve,reject)=>printWindow.webContents.print({
            silent:true,
            printBackground:true,
            deviceName:printerName,
            ...(useA4 ? { pageSize:"A4" } : { margins:{marginType:"none"}, usePrinterDefaultPageSize:true }),
            landscape:false,
            scaleFactor:100
        },(success,error)=>success?resolve():reject(new Error(error||"Printer rejected Stock Outward output."))));
        return {success:true};
    } catch(error) {
        technicalLogger.error("PRINTER","Stock Outward thermal receipt failed",error,{documentType:"STOCK_OUTWARD"});
        throw new Error("Stock Outward receipt could not be printed.");
    } finally {
        if(printWindow&&!printWindow.isDestroyed())printWindow.close();
    }
}

const DEVICE_SETTINGS_PREVIEW_FILES = Object.freeze({
    "tax-invoice": "tax-invoice.html",
    "store-credit": "store-credit.html",
    "day-closing": "day-closing.html",
    "printer-test": "printer-test.html",
    "credit-note": "credit-note.html",
    "stock-inward": "stock-inward.html",
    "stock-outward": "stock-outward.html",
    "stock-inward-a4": "stock-inward-a4.html",
    "stock-outward-a4": "stock-outward-a4.html"
});


function normalizeDevicePreviewSettings(source = {}) {
    const font = String(source.font || "arial");
    if (!Object.prototype.hasOwnProperty.call(DEVICE_PREVIEW_FONT_FAMILIES, font)) {
        throw new Error("Unsupported print preview font.");
    }
    const size = Number(source.size);
    if (!Number.isFinite(size) || size < 9 || size > 18) {
        throw new Error("Print sample text size must be between 9 and 18 pixels.");
    }
    const margins = {};
    for (const side of ["top", "right", "bottom", "left"]) {
        const margin = Number(source.margins?.[side]);
        if (!Number.isFinite(margin) || margin < 0 || margin > 12) {
            throw new Error("Print sample margins must be between 0 and 12 millimetres.");
        }
        margins[side] = margin;
    }
    return { font, size, margins };
}

async function printLayoutPreview(previewType, previewSettings) {
    const fileName = DEVICE_SETTINGS_PREVIEW_FILES[String(previewType || "")];
    if (!fileName) throw new Error("Unsupported print preview type.");
    const preference = normalizeDevicePreviewSettings(previewSettings);

    const settings = await getSettings();
    const isInwardA4 = previewType === "stock-inward-a4";
    const isOutwardA4 = previewType === "stock-outward-a4";
    const printerName = isInwardA4
        ? (settings?.stock_inward_printer || settings?.default_printer)
        : isOutwardA4
            ? (settings?.stock_outward_printer || settings?.default_printer)
            : settings?.default_printer;
    if (!printerName) throw new Error("No default KLBS printer is configured.");

    let printWindow = null;
    try {
        printWindow = new BrowserWindow({
            show: false,
            width: isInwardA4 || isOutwardA4 ? 794 : 302,
            height: isInwardA4 || isOutwardA4 ? 1123 : 1200,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true
            }
        });
        const previewPath = (isInwardA4 || isOutwardA4)
            ? path.join(__dirname, "../renderer", fileName)
            : path.join(__dirname, "../renderer/devicePrintPreviews", fileName);
        await printWindow.loadFile(previewPath);
        await applyPrintCss(printWindow, previewPrintCss(preference), "klbs-device-print-sample-tuning");
        await new Promise(resolve => setTimeout(resolve, 150));
        await new Promise((resolve, reject) => printWindow.webContents.print({
            silent: true,
            printBackground: true,
            deviceName: printerName,
            ...(isInwardA4 || isOutwardA4 ? { pageSize: "A4" } : { margins: { marginType: "none" }, usePrinterDefaultPageSize: true }),
            landscape: false,
            scaleFactor: 100
        }, (success, error) => success ? resolve() : reject(new Error(error || "Printer rejected sample output."))));
        return { success: true };
    } catch (error) {
        technicalLogger.error("PRINTER", "Device Settings sample print failed", error, { previewType });
        throw new Error(error.message || "The print sample could not be sent.");
    } finally {
        if (printWindow && !printWindow.isDestroyed()) printWindow.close();
    }
}

module.exports = {

    printBill,

    printStoreCredit,

    saveBillPdf,

    printCreditNote,

    saveCreditNotePdf,

    printTestReceipt,

    printDayClosingReceipt,
    printStockInwardReceipt,
    printStockOutwardReceipt,
    printLayoutPreview

};
