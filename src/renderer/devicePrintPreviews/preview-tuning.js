"use strict";

window.addEventListener("message", event => {
    if (event.source !== window.parent || event.data?.type !== "KLBS_DEVICE_PRINT_PREVIEW_SETTINGS") return;

    const receiptFooter = document.getElementById("receiptFooterMessage");
    if (receiptFooter && typeof event.data.receiptMessage === "string") {
        const message = event.data.receiptMessage.trim();
        receiptFooter.textContent = message;
        receiptFooter.style.whiteSpace = "pre-line";
        receiptFooter.style.display = message ? "block" : "none";
    }

    const fontFamilies = {
        arial: "Arial, Helvetica, sans-serif",
        trebuchet: "'Trebuchet MS', Arial, sans-serif",
        verdana: "Verdana, Geneva, sans-serif",
        georgia: "Georgia, 'Times New Roman', serif",
        times: "'Times New Roman', Times, serif",
        courier: "'Courier New', monospace"
    };
    const fontFamily = fontFamilies[event.data.font] || "Arial, Helvetica, sans-serif";
    const fontSize = Math.max(9, Math.min(18, Number(event.data.fontSize) || 13));
    const detailSize = Math.max(8, Math.round(fontSize * 11 / 13 * 100) / 100);
    const footerSize = Math.max(8, Math.round(fontSize * 12 / 13 * 100) / 100);
    const margins = {};
    for (const side of ["top", "right", "bottom", "left"]) {
        margins[side] = Math.max(0, Math.min(12, Number(event.data.margins?.[side]) || 0));
    }

    let style = document.getElementById("klbs-device-print-preview-tuning");
    if (!style) {
        style = document.createElement("style");
        style.id = "klbs-device-print-preview-tuning";
        document.head.appendChild(style);
    }
    style.textContent = `
        @media screen {
            html { display: flex !important; justify-content: center !important; align-items: flex-start !important; width: 100% !important; min-height: 100vh !important; }
            html, body { box-sizing: border-box !important; }
            body {
                flex: 0 0 auto !important;
                margin-left: 0 !important;
                margin-right: 0 !important;
                padding: ${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm !important;
                font-family: ${fontFamily} !important;
                font-size: ${fontSize}px !important;
            }
            .receipt, .credit-note {
                width: 100% !important;
                max-width: none !important;
                margin: 0 !important;
                padding: 0 !important;
                font-family: ${fontFamily} !important;
                font-size: ${fontSize}px !important;
            }
            .receipt .billInfo, .receipt > table, .receipt .totals, .receipt .payment,
            .receipt td div[style*="font-size:13px"] { font-size: ${fontSize}px !important; }
            .receipt td div[style*="font-size:11px"], .receipt .return-note { font-size: ${detailSize}px !important; }
            .receipt .footer, .receipt .footer strong { font-size: ${footerSize}px !important; }
        }
    `;
});
