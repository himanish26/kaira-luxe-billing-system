"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "../src/renderer/modules/shortcuts.js"), "utf8");
const nodes = new Map();
const clicks = [];
const buttonIds = ["newBillBtn", "billHistoryBtn", "reportsBtn", "settingsBtn", "saveBillBtn", "printBillBtn", "paymentBackBtn"];
for (const id of buttonIds) {
    nodes.set(id, { disabled: false, click: () => clicks.push(id) });
}
nodes.set("paymentScreen", { style: { display: "block" } });
const context = {
    document: { getElementById: id => nodes.get(id) || null, querySelector: () => null },
    window: {
        getComputedStyle: node => ({ display: node.style.display || "flex", visibility: "visible", opacity: "1" }),
        guardNewBillBusinessDay: async () => false
    }
};
vm.createContext(context);
vm.runInContext(source, context, { filename: "shortcuts.js" });
const press = code => context.handleKeyboardShortcut({ code, preventDefault() {}, stopPropagation() {} });

async function main() {
    for (const [key, id] of [["F2", "newBillBtn"], ["F3", "billHistoryBtn"], ["F4", "reportsBtn"], ["F5", "settingsBtn"], ["F10", "saveBillBtn"], ["F12", "printBillBtn"]]) {
        clicks.length = 0;
        press(key);
        await Promise.resolve();
        assert.deepStrictEqual(clicks, [id], `${key} delegates to the established button from Payment`);
    }

    const cancelPairs = [
        ["storeCreditModal", "cancelStoreCreditBtn"],
        ["giftVoucherDialog", "giftVoucherCancelBtn"],
        ["returnReasonDialog", "returnReasonCancelBtn"],
        ["variableValueDialog", "variableValueCancelBtn"],
        ["dayReopenReasonModal", "cancelDayReopenReasonBtn"],
        ["adminDialog", "adminCancelBtn"],
        ["ffPinDialog", "ffPinCancelBtn"],
        ["ffDiscountDialog", "ffDiscountCancelBtn"],
        ["stockTransactionModal", "cancelStockTransactionBtn"]
    ];
    for (const [modalId, cancelId] of cancelPairs) {
        nodes.set(modalId, { style: { display: modalId === "dayReopenReasonModal" ? "" : "flex" } });
        nodes.set(cancelId, { click: () => clicks.push(cancelId) });
        clicks.length = 0;
        for (const key of ["F2", "F3", "F4", "F5", "F10", "F12"]) press(key);
        await Promise.resolve();
        assert.deepStrictEqual(clicks, [], `${modalId} blocks page/save shortcuts`);
        press("Escape");
        assert.deepStrictEqual(clicks, [cancelId], `${modalId} Esc invokes only Cancel`);
        nodes.delete(modalId);
    }
    for (const modalId of ["processingDialog", "appLockOverlay", "dayClosingLifecycleOverlay"]) {
        nodes.set(modalId, { style: { display: "flex" } });
        clicks.length = 0;
        for (const key of ["F2", "F3", "F4", "F5", "F10", "F12", "Escape"]) press(key);
        await Promise.resolve();
        assert.deepStrictEqual(clicks, [], `${modalId} blocks navigation, save and Esc`);
        nodes.delete(modalId);
    }
    nodes.get("saveBillBtn").disabled = true;
    nodes.get("printBillBtn").disabled = true;
    clicks.length = 0;
    press("F10"); press("F12");
    assert.deepStrictEqual(clicks, []);
    nodes.get("newBillBtn").disabled = true;
    press("F2");
    await Promise.resolve();
    assert.deepStrictEqual(clicks, [], "Closed business day still blocks New Bill");
    assert(!source.includes("confirmDiscardCurrentBill"), "No nonexistent renderer API is invoked");
    console.log("V2 UI shortcut/modal consistency: PASS (button mappings, Payment, modal guards, Esc Cancel, locked overlays and disabled actions)");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
