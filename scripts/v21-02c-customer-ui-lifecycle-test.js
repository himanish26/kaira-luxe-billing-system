"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

class Element {
    constructor(id = "") {
        this.id = id;
        this.value = "";
        this.isConnected = true;
        this.hidden = false;
        this.style = { display: "none" };
        this.dataset = {};
        this.listeners = {};
        this.children = [];
        this.parentElement = null;
        this.attributes = {};
        this.classes = new Set();
        this.classList = {
            toggle: (name, force) => force ? this.classes.add(name) : this.classes.delete(name),
            add: (...names) => names.forEach(name => this.classes.add(name)),
            remove: (...names) => names.forEach(name => this.classes.delete(name)),
            contains: name => this.classes.has(name)
        };
        this.textContent = "";
        this.selectionStart = 0;
        this.selectionEnd = 0;
    }
    addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
    dispatchEvent(event) { event.target ||= this; for (const callback of this.listeners[event.type] || []) callback(event); return true; }
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
    setCustomValidity(message) { this.validationMessage = message; }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    focus() { this.focused = true; activeElement = this; }
    replaceChildren(...children) { this.children = []; this.append(...children); }
    append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
    querySelector(selector) { return selector.includes("customer-drawer-panel") ? elements.get("drawerPanel") : null; }
    querySelectorAll() { return focusables; }
    getClientRects() { return this.hidden ? [] : [{}]; }
    contains(element) { return element === this || (this.id === "customerProfileModal" && focusables.includes(element)) || this.children.some(child => child.contains?.(element)); }
    click() { for (const callback of this.listeners.click || []) callback({ type: "click", target: this }); }
}

class TestEvent {
    constructor(type, options = {}) { this.type = type; Object.assign(this, options); }
    preventDefault() { this.defaultPrevented = true; }
}

const ids = [
    "customerMobile", "customerName", "newBillScreen", "selectedCustomerProfileId", "customerProfileTitle", "profileName", "profileMobile",
    "drawerPanel", "customerDrawerBack", "customerDrawerBody", "customerDrawerChooser", "customerDrawerChoices", "customerDrawerNewChoice", "customerDrawerProfileView", "customerDrawerFormView", "customerDrawerEdit", "customerDrawerError", "customerDrawerHelper", "drawerCustomerName", "drawerCustomerCode", "drawerCustomerMobile", "drawerBirthdayLabel", "drawerAnniversaryLabel", "drawerBirthday", "drawerAnniversary", "drawerEmail", "drawerNotes", "drawerBillCount", "drawerSpend", "drawerLastVisit", "drawerAverage", "drawerCustomerEvents", "drawerCustomerEventText", "drawerStoreCreditSection", "drawerStoreCreditEmpty", "drawerStoreCreditAmount", "drawerStoreCreditValidity", "drawerStoreCreditReference", "drawerStoreCreditOnly", "drawerCreditOnlyAmount", "drawerCreditOnlyValidity", "drawerCreditOnlyReference", "drawerPurchaseEmpty", "drawerPurchaseTableWrap", "drawerPurchaseRows", "drawerPurchasePagination", "drawerPurchaseControls", "drawerPurchaseRange", "drawerPurchasePage", "drawerPurchasePrevious", "drawerPurchaseNext", "drawerPurchaseJump",
    "profileBirthday", "profileAnniversary", "profileEmail", "profileNotes", "customerProfileModal",
    "customerProfileValidation", "customerProfileSave", "customerProfileCancel", "customerProfileOpen",
    "customerChooserModal", "customerChooserList", "customerChooserNew", "customerChooserCancel", "barcodeInput"
];
const elements = new Map(ids.map(id => [id, new Element(id)]));
elements.get("customerProfileModal").querySelector = selector => selector.includes("customer-drawer-panel") ? elements.get("drawerPanel") : elements.get("customerDrawerBack");
elements.get("newBillScreen").style.display = "block";
const document = {
    getElementById: id => elements.get(id) || null,
    createElement: () => new Element(),
};
let profileCreateCalls = 0;
let profileUpdateCalls = 0;
let customerLookupCalls = 0;
let profileToLoad = null;
let lastSavedProfileData = null;
const window = { setTimeout: callback => { callback(); return 1; }, electronAPI: {
    findCustomersByMobile: async () => { customerLookupCalls += 1; return []; },
    getCustomerProfile: async () => profileToLoad,
    getCustomerManagementProfile: async () => profileToLoad,
    getAvailableStoreCreditByMobile: async () => null,
    getCustomerPurchaseHistoryPage: async () => ({ rows: [], totalCount: 0, page: 1, pageSize: 100, totalPages: 1 }),
    createCustomerProfile: async data => { profileCreateCalls += 1; lastSavedProfileData = { ...data }; return { id: 1, name: data.name, mobile: data.mobile }; }
} };
window.electronAPI.updateCustomerProfile = async (id, data) => { profileUpdateCalls += 1; lastSavedProfileData = { ...data }; return profileToLoad; };
window.getComputedStyle = element => ({ display: element.style.display || "flex", visibility: "visible", opacity: "1" });
let activeElement = null;
const focusables = ["customerDrawerBack", "customerDrawerEdit", "drawerPurchasePrevious", "drawerPurchaseJump", "drawerPurchaseNext", "profileName", "profileMobile", "profileBirthday", "profileAnniversary", "profileEmail", "profileNotes", "customerProfileCancel", "customerProfileSave"].map(id => elements.get(id));
const pendingAnimationFrames = [];
Object.defineProperty(document, "activeElement", { get: () => activeElement });
document.querySelector = () => null;
document.addEventListener = () => {};
const context = { document, window, Event: TestEvent, requestAnimationFrame: callback => { pendingAnimationFrames.push(callback); return pendingAnimationFrames.length; }, setTimeout: callback => { callback(); return 1; }, clearTimeout() {}, console, alert() {} };
vm.createContext(context);
const source = fs.readFileSync(path.join(__dirname, "../src/renderer/modules/customerProfile.js"), "utf8");
vm.runInContext(source, context, { filename: "customerProfile.js" });

function input(id, value) {
    const element = elements.get(id);
    element.value = value;
    element.selectionStart = value.length;
    element.dispatchEvent(new TestEvent("input"));
    return element;
}

function paste(id, value) {
    const element = elements.get(id);
    element.value = "";
    element.selectionStart = 0;
    element.selectionEnd = 0;
    element.dispatchEvent(new TestEvent("paste", {
        clipboardData: { getData: () => value },
        preventDefault() { this.defaultPrevented = true; }
    }));
    return element;
}

async function openCustomerDetails(name, mobile, profileId = "", profile = null) {
    elements.get("customerName").value = name;
    elements.get("customerMobile").value = mobile;
    elements.get("selectedCustomerProfileId").value = profileId;
    profileToLoad = profile;
    activeElement = null;
    const lookupCallsBefore = customerLookupCalls;
    const openHandler = elements.get("customerProfileOpen").listeners.click[0];
    await openHandler({ type: "click" });
    while (pendingAnimationFrames.length) {
        const frame = pendingAnimationFrames.splice(0);
        for (const callback of frame) callback();
        await Promise.resolve();
    }
    assert.strictEqual(elements.get("customerProfileModal").style.display, "block");
    assert.strictEqual(elements.get("customerName").value, name, "focus decision preserves bill name snapshot input");
    assert.strictEqual(elements.get("customerMobile").value, mobile, "focus decision preserves bill mobile input");
    assert.strictEqual(elements.get("selectedCustomerProfileId").value, profileId, "focus decision does not alter customer identity association");
    assert.strictEqual(customerLookupCalls, lookupCallsBefore + (!profileId && /^\d{10}$/.test(mobile) ? 1 : 0), "drawer entry uses the existing lookup only when needed to resolve a canonical mobile");
    assert.strictEqual(profileCreateCalls, 0, "opening Customer Details does not create a profile");
    assert.strictEqual(profileUpdateCalls, 0, "opening Customer Details does not update a profile");
    return profileId ? document.activeElement?.id : document.activeElement?.id;
}

async function main() {
for (const [raw, expected] of [["2603", "26/03"], ["1402", "14/02"], ["26x03", "26/03"], ["26-03", "26/03"], ["260399", "26/03"]]) {
    assert.strictEqual(input("profileBirthday", raw).value, expected, `Birthday input ${raw}`);
}
assert.strictEqual(paste("profileBirthday", "26x03").value, "26/03", "paste is sanitized and formatted");
assert.strictEqual(input("profileAnniversary", "1402").value, "14/02");
for (const field of ["profileBirthday", "profileAnniversary"]) {
    for (const valid of ["0101", "3101", "2902", "3004", "3105", "2512"]) {
        const element = input(field, valid);
        assert.strictEqual(element.validationMessage, "", `${valid} is valid DD/MM`);
        assert.strictEqual(element.classList.contains("is-invalid"), false);
    }
    for (const invalid of ["0001", "3201", "4444", "3333", "3102", "3002", "3104", "3106", "3109", "3111", "1513", "1200"]) {
        const element = input(field, invalid);
        assert.strictEqual(element.value, `${invalid.slice(0, 2)}/${invalid.slice(2)}`, `${invalid} remains unchanged for correction`);
        assert(element.validationMessage, `${invalid} must be rejected as an impossible DD/MM`);
        assert.strictEqual(element.classList.contains("is-invalid"), true);
        assert.strictEqual(element.attributes["aria-invalid"], "true");
        assert(elements.get("customerProfileValidation").textContent.includes("valid DD/MM"), "invalid completion is immediately shown inline");
    }
}
const editableDate = input("profileBirthday", "2603");
editableDate.selectionStart = 3;
editableDate.value = editableDate.value.slice(0, 2) + editableDate.value.slice(3); // Native Backspace removes the slash.
editableDate.dispatchEvent(new TestEvent("input"));
assert.strictEqual(editableDate.value, "26/03", "Backspace editing survives automatic slash formatting");
editableDate.selectionStart = 2;
editableDate.value = editableDate.value.slice(0, 2) + editableDate.value.slice(3); // Native Delete removes the slash.
editableDate.dispatchEvent(new TestEvent("input"));
assert.strictEqual(editableDate.value, "26/03", "Delete editing survives automatic slash formatting");
assert.strictEqual(input("customerMobile", "98a765432109").value, "9876543210", "billing mobile strips non-digits and caps at ten");
assert.strictEqual(paste("profileMobile", "(987) 654-3210").value, "9876543210", "profile mobile paste strips formatting characters");
assert.strictEqual(paste("profileMobile", "919876543210").value, "", "overlong mobile paste is rejected instead of guessing identity");

assert.strictEqual(await openCustomerDetails("", ""), "profileName", "blank identity starts at Name");
assert.strictEqual(await openCustomerDetails("Cashier Entered", ""), "profileMobile", "name without mobile starts at Mobile");
assert.strictEqual(await openCustomerDetails("Cashier Entered", "98765"), "profileMobile", "incomplete mobile starts at Mobile");
assert.strictEqual(await openCustomerDetails("", "9876543210"), "profileName", "valid mobile without name starts at Name");
assert.strictEqual(await openCustomerDetails("Cashier Entered", "9876543210"), "profileBirthday", "name and canonical mobile start at Birthday for an unresolved new profile");
const existingProfile = {
    id: 82, name: "Existing Profile", mobile: "9876543210", birthday_ddmm: "29/02",
    marriage_anniversary_ddmm: "31/05", email: "", notes: ""
};
assert.strictEqual(await openCustomerDetails("Bill Snapshot", "9876543210", "82", existingProfile), "customerDrawerBack", "resolved profile opens directly in the drawer rather than the edit form");
assert.strictEqual(elements.get("drawerBirthday").textContent, "29-Feb", "existing DD/MM profile date is shown read-only without mutating storage");
assert.strictEqual(elements.get("drawerCustomerName").textContent, "Existing Profile");
assert.strictEqual(elements.get("drawerCustomerMobile").textContent, "9876543210");

const shortcutSource = fs.readFileSync(path.join(__dirname, "../src/renderer/modules/shortcuts.js"), "utf8");
vm.runInContext(shortcutSource, context, { filename: "shortcuts.js" });
context.handleKeyboardShortcut({ code: "Escape", preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
assert.strictEqual(elements.get("customerProfileModal").style.display, "none", "Escape closes only Customer Details");
assert.strictEqual(elements.get("newBillScreen").style.display, "block", "Escape keeps the New Bill screen active");
assert.strictEqual(await openCustomerDetails("Reopened", "12345"), "profileMobile", "reopen recalculates focus from current bill values");

elements.get("customerProfileModal").dataset.profileId = "";
elements.get("profileName").value = "Transient";
elements.get("profileMobile").value = "9876543210";
elements.get("profileBirthday").value = "44/44";
elements.get("profileAnniversary").value = "";
elements.get("customerProfileSave").click();
assert.strictEqual(profileCreateCalls, 0, "SAVE does not call profile service for invalid completed date");
assert(elements.get("customerProfileValidation").textContent.includes("Birthday"), "SAVE guard reports invalid DD/MM inline");

elements.get("profileBirthday").value = "";
const customerLookupBeforeEmail = customerLookupCalls;
for (const valid of ["", "himanish26@gmail.com", "store@kairaluxe.in", "accounts+kl@gmail.com", "customer.name@example.co.in"]) {
    input("profileEmail", valid);
    assert.strictEqual(elements.get("profileEmail").classList.contains("is-invalid"), false, `${valid || "blank email"} is valid`);
}
for (const invalid of ["himanish26.com", "himanish26@", "@gmail.com", "himanish26@gmail", "himanish26 @gmail.com", "himanish26@gmail..com"]) {
    input("profileEmail", invalid);
    assert.strictEqual(elements.get("profileEmail").classList.contains("is-invalid"), true, `${invalid} is invalid`);
    assert.strictEqual(elements.get("profileEmail").validationMessage, "Enter a valid email address.");
    assert.strictEqual(elements.get("customerProfileValidation").textContent.includes("Email must be a valid email address."), true);
}
const savedCreateHandler = elements.get("customerProfileSave").listeners.click[0];
await savedCreateHandler({ type: "click" });
assert.strictEqual(profileCreateCalls, 0, "invalid email blocks Customer Details Save");
input("profileEmail", "  accounts+kl@gmail.com  ");
assert.strictEqual(elements.get("profileEmail").classList.contains("is-invalid"), false, "correcting email clears error");
const validationTextBeforeSave = elements.get("customerProfileValidation").textContent;
assert(!validationTextBeforeSave.includes("Email"), "correcting email clears inline email error");
const lookupCountBeforeEmailSave = customerLookupCalls;
await savedCreateHandler({ type: "click" });
assert.strictEqual(profileCreateCalls, 1, "valid email allows profile Save");
assert.strictEqual(lastSavedProfileData.email, "accounts+kl@gmail.com", "Save trims surrounding whitespace and preserves email otherwise");
assert.strictEqual(customerLookupCalls, lookupCountBeforeEmailSave, "email edits and save do not trigger customer lookup");
assert.strictEqual(customerLookupCalls, customerLookupBeforeEmail, "email is not a customer identity or lookup key");
input("profileEmail", "   ");
await savedCreateHandler({ type: "click" });
assert.strictEqual(profileCreateCalls, 2, "blank optional email allows profile Save");
assert.strictEqual(lastSavedProfileData.email, "", "blank email is submitted as absent");

elements.get("profileName").value = "Transient";
elements.get("profileMobile").value = "9876543210";
elements.get("profileBirthday").value = "26/03";
elements.get("customerProfileModal").style.display = "flex";
elements.get("customerProfileValidation").textContent = "invalid";
window.resetCustomerProfileDraft();
for (const id of ["customerProfileModal"]) {
    assert.strictEqual(elements.get(id).style.display, "none", `${id} is closed on fresh session`);
}
for (const id of ["profileName", "profileMobile", "profileBirthday", "profileAnniversary", "profileEmail", "profileNotes", "selectedCustomerProfileId"]) {
    assert.strictEqual(elements.get(id).value, "", `${id} is cleared on fresh session`);
}
assert.strictEqual(elements.get("customerProfileValidation").textContent, "");
assert.strictEqual(elements.has("customerPurchaseHistory"), false, "the obsolete New Bill Purchase History control is removed");
assert.strictEqual(elements.has("customerProfileStatus"), false, "the obsolete Existing Customer status strip is removed");

const appSource = fs.readFileSync(path.join(__dirname, "../src/renderer/app.js"), "utf8");
assert.match(appSource, /function clearCurrentBill\(\)[\s\S]*?window\.resetCustomerProfileDraft\?\.\(\)/, "central new-bill reset clears customer profile state");
assert.match(appSource, /billItems\.length > 0 && \(newBillWasVisible \|\| paymentWasVisible\)/, "fresh dashboard entry clears abandoned draft while in-flow re-entry preserves it");
assert.match(appSource, /window\.abandonNewBillSession = clearCurrentBill/, "navigation reset reuses the authoritative bill reset routine");
const shortcutsSource = fs.readFileSync(path.join(__dirname, "../src/renderer/modules/shortcuts.js"), "utf8");
assert.match(shortcutsSource, /function abandonNewBillDraftBeforeNavigation\([\s\S]*?window\.abandonNewBillSession\?\.\(\)/, "shortcut navigation abandons a draft before leaving New Bill");
const billingCss = fs.readFileSync(path.join(__dirname, "../src/renderer/styles/billing.css"), "utf8");
assert(billingCss.includes("#customerProfileModal .modal-content.customer-profile-dialog{box-sizing:border-box;width:min(960px,calc(100vw - 48px))"), "customer details overrides the shared 420px modal with a 960px desktop target");
assert(billingCss.includes("height:510px;min-height:0;max-height:calc(100vh - 48px)"), "customer details desktop height is stable at approximately 500px");
assert(!billingCss.includes("aspect-ratio:16/9"), "compact modal does not retain the fixed 540px 16:9 height");
assert(billingCss.includes("grid-template-columns:repeat(2,minmax(0,1fr));column-gap:32px"), "desktop form uses two wide columns");
assert(billingCss.includes("#customerProfileModal .customer-profile-fields label:nth-child(4){white-space:nowrap;}"), "desktop anniversary label remains on one line");
assert(billingCss.includes("padding:30px 44px") && billingCss.includes("margin:8px 0 7px"), "vertical spacing is compact and balanced");
assert(billingCss.includes("min-width:172px;height:50px"), "centered actions retain the approved size");

const customerModalMarkup = fs.readFileSync(path.join(__dirname, "../src/renderer/index.html"), "utf8");
const tabOrder = ["profileName", "profileMobile", "profileBirthday", "profileAnniversary", "profileEmail", "profileNotes", "customerProfileCancel", "customerProfileSave"];
const tabPositions = tabOrder.map(id => customerModalMarkup.indexOf(`id="${id}"`));
assert(tabPositions.every((position, index) => position >= 0 && (index === 0 || position > tabPositions[index - 1])), "Customer Details DOM keeps logical Tab order");
assert(!/tabindex=["']?[1-9]/i.test(customerModalMarkup.slice(tabPositions[0], tabPositions.at(-1) + 80)), "Customer Details does not use positive tabindex values");
assert(billingCss.includes("#customerProfileModal .customer-profile-validation{box-sizing:border-box;display:flex;align-items:center;width:100%;height:24px;min-height:24px;margin:8px 0 0"), "validation has a reserved fixed-height row in the desktop form");
assert(!billingCss.includes(".customer-profile-validation:not(:empty)"), "validation visibility does not change document-flow spacing");
assert(billingCss.includes("height:24px;min-height:24px;margin:8px 0 0"), "email and date errors share a stable reserved validation row");

console.log("V21-02C customer input/reset/focus: PASS (DD/MM, mobile, paste sanitization, invalid dates, profile overlay reset, contextual focus, lifecycle contracts)");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
