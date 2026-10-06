"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "../src/renderer/modules/shortcuts.js"), "utf8");
const nodes = new Map();
const clicks = [];
let draftAbandonCount = 0;
let customerDrawerOpen = false;
const buttonIds = ["newBillBtn", "billHistoryBtn", "reportsBtn", "settingsBtn", "saveBillBtn", "printBillBtn", "paymentBackBtn", "backBtn"];
for (const id of buttonIds) {
    nodes.set(id, { disabled: false, click: () => clicks.push(id) });
}
nodes.set("paymentScreen", { style: { display: "block" } });
nodes.set("newBillScreen", { style: { display: "block" } });
const context = {
    document: { getElementById: id => nodes.get(id) || null, querySelector: () => null },
    window: {
        getComputedStyle: node => ({ display: node.style.display || "flex", visibility: "visible", opacity: "1" }),
        isNewBillCustomerDrawerOpen: () => customerDrawerOpen,
        closeNewBillCustomerDrawer: () => { customerDrawerOpen = false; clicks.push("customerDrawerBack"); },
        guardNewBillBusinessDay: async () => false,
        abandonNewBillSession: () => { draftAbandonCount += 1; }
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
        ["customerProfileModal", "customerProfileCancel"],
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
    customerDrawerOpen = true;
    clicks.length = 0;
    for (const key of ["F2", "F3", "F4", "F5", "F10", "F12"]) press(key);
    assert.deepStrictEqual(clicks, [], "New Bill customer drawer blocks navigation, save and print shortcuts");
    press("Escape");
    assert.deepStrictEqual(clicks, ["customerDrawerBack"], "Escape closes only the active Customer Drawer");
    assert.strictEqual(customerDrawerOpen, false);
    nodes.get("paymentScreen").style.display = "none";
    clicks.length = 0;
    press("Escape");
    assert.deepStrictEqual(clicks, ["backBtn"], "Escape from New Bill still follows the existing Dashboard route when no modal is open");
    clicks.length = 0;
    for (const [key, button] of [["F3", "billHistoryBtn"], ["F4", "reportsBtn"], ["F5", "settingsBtn"]]) {
        press(key);
        assert.strictEqual(clicks.at(-1), button, `${key} keeps its existing navigation target`);
    }
    assert.strictEqual(draftAbandonCount, 3, "F3/F4/F5 abandon New Bill transient state before leaving the screen");

    nodes.get("newBillScreen").style.display = "none";
    for (const [screenId, backId] of [
        ["reportsScreen", "reportsDashboardBtn"],
        ["customersScreen", "customersBusinessBtn"],
        ["accountingDataScreen", "accountingBusinessBtn"],
        ["businessScreen", "businessDashboardBtn"]
    ]) {
        nodes.set(screenId, { style: { display: "block" } });
        nodes.set(backId, { click: () => clicks.push(backId) });
        clicks.length = 0;
        press("Escape");
        assert.deepStrictEqual(clicks, [backId], `Escape from ${screenId} follows its parent route`);
        nodes.get(screenId).style.display = "none";
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
    console.log("V2 UI shortcut/modal consistency: PASS (button mappings, Business F4 draft abandonment, parent-context Esc, Payment, modal guards, locked overlays and disabled actions)");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
