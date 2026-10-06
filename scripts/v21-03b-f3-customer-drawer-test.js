"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { spawnSync } = require("child_process");

async function runElectronStyleCheck() {
    const { app, BrowserWindow } = require("electron");
    const billingCss = fs.readFileSync(process.argv[process.argv.indexOf("--drawer-style-child") + 1], "utf8");
    const settingsCss = fs.readFileSync(process.argv[process.argv.indexOf("--drawer-style-child") + 2], "utf8");
    await app.whenReady();
    const win = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    try {
        const html = `<!doctype html><html><head><style>:root{--primary:#8b004b;--primary-dark:#6D0033;--card:#fff;--border:#ddd;--radius-lg:18px}html,body{margin:0;width:100%;height:100%;overflow:hidden}</style><style>${settingsCss}\n${billingCss}</style></head><body><div class="modal customer-drawer-open" id="customerProfileModal" style="display:block"><div class="modal-content customer-profile-dialog customer-drawer-panel"><header class="customer-drawer-header"><h3>NEW CUSTOMER</h3><button class="customer-drawer-exit">EXIT</button></header><div class="customer-drawer-body"><section id="drawerStoreCreditOnly" class="customer-drawer-section customer-drawer-credit" hidden><h4>STORE CREDIT</h4><p>No available store credit</p></section></div></div></div></body></html>`;
        const encoded = encodeURIComponent(html);
        await win.loadURL(`data:text/html;charset=utf-8,${encoded}`);
        const initial = await win.webContents.executeJavaScript(`(() => { const p=document.querySelector('.customer-drawer-panel'); const c=document.querySelector('#drawerStoreCreditOnly'); const e=document.querySelector('.customer-drawer-exit'); const r=p.getBoundingClientRect(); const s=getComputedStyle(p); return {creditDisplay:getComputedStyle(c).display, creditHidden:c.hidden, transform:s.transform, transitionProperty:s.transitionProperty, transitionDuration:s.transitionDuration, top:r.top, height:r.height, viewportHeight:innerHeight, viewportWidth:innerWidth, exitBackground:getComputedStyle(e).backgroundColor, exitColor:getComputedStyle(e).color}; })()`);
        assert.strictEqual(initial.creditDisplay, "none", "Chromium computed style hides the complete mobile-only Store Credit wrapper despite its grid display rule");
        assert.strictEqual(initial.creditHidden, true);
        const availableCreditDisplay = await win.webContents.executeJavaScript(`(() => { const c=document.getElementById('drawerStoreCreditOnly'); c.hidden=false; return getComputedStyle(c).display; })()`);
        assert.strictEqual(availableCreditDisplay, "grid", "available mobile credit can render the complete wrapper");
        await win.webContents.executeJavaScript(`document.getElementById('drawerStoreCreditOnly').hidden=true`);
        assert.match(initial.transform, /matrix\(1, 0, 0, 1, [1-9][0-9]*, 0\)/, "drawer begins fully offscreen at translateX(100%)");
        assert.strictEqual(initial.transitionProperty, "transform");
        assert.strictEqual(initial.transitionDuration, "0.3s");
        assert.strictEqual(initial.top, 0);
        assert.strictEqual(initial.height, initial.viewportHeight, "panel spans the complete BrowserWindow viewport height");
        assert.strictEqual(initial.exitBackground, "rgb(139, 0, 75)");
        assert.strictEqual(initial.exitColor, "rgb(255, 255, 255)");
        await win.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => { document.getElementById('customerProfileModal').classList.add('customer-drawer-visible'); resolve(); }))`);
        await new Promise(resolve => setTimeout(resolve, 360));
        const opened = await win.webContents.executeJavaScript(`getComputedStyle(document.querySelector('.customer-drawer-panel')).transform`);
        assert.strictEqual(opened, "matrix(1, 0, 0, 1, 0, 0)", "panel transitions to its open position");
        const openBounds = await win.webContents.executeJavaScript(`(() => { const r=document.querySelector('.customer-drawer-panel').getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,height:r.height,width:r.width,viewportWidth:innerWidth,viewportHeight:innerHeight}; })()`);
        assert.strictEqual(openBounds.right, openBounds.viewportWidth, "drawer stays flush to the actual Chromium viewport right edge");
        assert.strictEqual(openBounds.top, 0);
        assert.strictEqual(openBounds.height, openBounds.viewportHeight);
        await win.webContents.executeJavaScript(`document.getElementById('customerProfileModal').classList.add('customer-drawer-closing')`);
        const closingDuration = await win.webContents.executeJavaScript(`getComputedStyle(document.querySelector('.customer-drawer-panel')).transitionDuration`);
        assert.strictEqual(closingDuration, "0.24s");
        await new Promise(resolve => setTimeout(resolve, 280));
        const closingTransform = await win.webContents.executeJavaScript(`getComputedStyle(document.querySelector('.customer-drawer-panel')).transform`);
        assert.match(closingTransform, /matrix\(1, 0, 0, 1, [1-9][0-9]*, 0\)/);
        process.stdout.write("Electron Chromium computed-style/geometry/transition check: PASS\n");
    } finally {
        win.destroy();
        app.quit();
    }
}

class Element {
    constructor(id = "") {
        this.id = id; this.value = ""; this.textContent = ""; this.hidden = false; this.disabled = false; this.isConnected = true;
        this.style = { display: "none" }; this.dataset = {}; this.listeners = {}; this.children = []; this.attributes = {};
        this.classes = new Set(); this.parentElement = null; this.inert = false; this.selectionStart = 0; this.selectionEnd = 0;
        this.classList = {
            add: (...names) => names.forEach(name => this.classes.add(name)),
            remove: (...names) => names.forEach(name => this.classes.delete(name)),
            contains: name => this.classes.has(name),
            toggle: (name, force) => { if (force) this.classes.add(name); else this.classes.delete(name); return force; }
        };
    }
    addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
    async fire(type, event = {}) { event.type = type; event.target ||= this; for (const fn of this.listeners[type] || []) await fn(event); }
    click() { return this.fire("click"); }
    append(...items) { for (const item of items) { item.parentElement = this; this.children.push(item); } }
    replaceChildren(...items) { this.children = []; this.append(...items); }
    after(item) { if (!this.parentElement) return; const i = this.parentElement.children.indexOf(this); item.parentElement = this.parentElement; this.parentElement.children.splice(i + 1, 0, item); }
    remove() { if (!this.parentElement) return; const i = this.parentElement.children.indexOf(this); if (i >= 0) this.parentElement.children.splice(i, 1); this.parentElement = null; }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    setCustomValidity(value) { this.validationMessage = value; }
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
    focus(options) {
        this.focusOptions = options;
        const drawer = globalThis.__elements?.get("customerProfileModal");
        if (drawer && this.id !== "barcodeInput") {
            globalThis.__drawerFocusAfterVisible = drawer.classList.contains("customer-drawer-visible");
        }
        if (globalThis.__document) globalThis.__document.activeElement = this;
    }
    getClientRects() { return this.hidden ? [] : [{}]; }
    contains(item) { return item === this || this.children.some(child => child.contains?.(item)); }
    querySelector(selector) { if (selector.includes("customer-drawer-panel")) return globalThis.__elements.get("drawerPanel"); return this.children.find(child => !child.hidden) || null; }
    querySelectorAll() { return globalThis.__focusables || []; }
}

async function main() {
    const root = path.join(__dirname, "..");
    const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
    const moduleSource = fs.readFileSync(path.join(root, "src/renderer/modules/customerProfile.js"), "utf8");
    const shortcutsSource = fs.readFileSync(path.join(root, "src/renderer/modules/shortcuts.js"), "utf8");
    const appSource = fs.readFileSync(path.join(root, "src/renderer/app.js"), "utf8");
    const css = fs.readFileSync(path.join(root, "src/renderer/styles/billing.css"), "utf8");
    const businessCss = fs.readFileSync(path.join(root, "src/renderer/styles/business.css"), "utf8");
    assert.match(html, /id="customerProfileModal"[^>]*role="dialog"/);
    assert.match(html, /id="customerDrawerProfileView"/);
    assert.match(html, /id="customerDrawerFormView"/);
    assert.match(html, /id="drawerPurchaseRows"/);
    assert(!html.includes('id="drawerInlineBill"') && !html.includes('id="drawerInlineBillContent"'), "inline detail rows are created and owned per expanded purchase, not moved from a static detached table row");
    assert.match(html, /customer-drawer-exit[^>]*>EXIT</);
    assert.match(html, /id="drawerStoreCreditSection"[^>]*>[\s\S]*?No available store credit/);
    assert.match(html, /id="drawerPurchaseControls"/);
    assert(!html.includes('id="customerInfoModal"') && !html.includes('id="customerHistoryModal"'), "F2 New Bill popup surfaces are removed");
    assert(!html.includes('id="customerInfoOpen"') && !html.includes("VIEW ALL PURCHASES"), "New Bill has no nested Customer Info/View All popup actions");
    assert.match(css, /width:clamp\(560px,54vw,840px\)/);
    assert.match(css, /#customerProfileModal\.customer-drawer-open \.modal-content\.customer-profile-dialog\.customer-drawer-panel,\s*#customerProfileModal\.customer-drawer-closing \.modal-content\.customer-profile-dialog\.customer-drawer-panel\{position:absolute;[^}]*top:0;right:0;bottom:0;left:auto;[^}]*height:auto;[^}]*max-height:none;[^}]*margin:0;/, "open drawer overrides the shared 510px modal dimensions and fills its fixed overlay from top to bottom");
    assert.match(css, /#customerProfileModal\.customer-drawer-visible \.modal-content\.customer-profile-dialog\.customer-drawer-panel\{transform:translateX\(0\);\}/);
    assert.match(css, /#customerProfileModal \.customer-drawer-body\{min-height:0;flex:1;overflow-y:auto;/, "only drawer body scrolls while header remains outside it");
    assert.match(css, /#customerProfileModal \.customer-drawer-header\{position:sticky;/);
    assert.match(css, /transition:transform 300ms cubic-bezier\(\.22,1,\.36,1\)/);
    assert.match(css, /transition-duration:240ms/);
    assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
    assert.match(css, /#customerProfileModal \.customer-drawer-credit\[hidden\]\{display:none!important;\}/, "important hidden rule overrides the drawer credit wrapper's display:grid rule");
    assert.match(css, /customer-drawer-panel\{[^}]*transform:translateX\(100%\)[^}]*will-change:transform;transition:transform 300ms/);
    assert.match(css, /customer-drawer-panel\{transform:translateX\(100%\);transition-duration:240ms;transition-timing-function:cubic-bezier\(\.22,1,\.36,1\);\}/);
    assert.match(css, /\.customer-drawer-exit\{[^}]*background:var\(--primary\);color:#fff/);
    assert.match(moduleSource, /requestAnimationFrame\(\(\) => \{\s*\/\/ Resolve the offscreen panel transform[\s\S]*?window\.getComputedStyle\(panel\)\.transform;\s*requestAnimationFrame\(\(\) => \{/);
    const drawerOpenSource = moduleSource.match(/function openDrawer\(view, title\) \{([\s\S]*?)\n    function closeDrawer\(\)/)?.[1] || "";
    assert(drawerOpenSource.indexOf('drawer.classList.add("customer-drawer-visible")') < drawerOpenSource.indexOf("target.focus({ preventScroll: true })"), "drawer starts its transform before moving focus without scrolling");
    assert.match(drawerOpenSource, /requestAnimationFrame\(\(\) => \{\s*if \(focusSequence !== drawerFocusSequence \|\| !drawerIsOpen\(\) \|\| !drawer\.classList\.contains\("customer-drawer-visible"\)\) return;/, "delayed focus is cancelled after close/reopen state changes");
    assert.match(drawerOpenSource, /!drawer\.contains\(target\).*target\.hidden \|\| target\.disabled \|\| !target\.isConnected \|\| target\.getClientRects\(\)\.length === 0/, "delayed focus requires a connected, visible, usable drawer control");
    assert.match(moduleSource, /function closeDrawer\(\) \{\s*if \(!drawerIsOpen\(\) \|\| drawer\.classList\.contains\("customer-drawer-closing"\)\) return;\s*drawerFocusSequence \+= 1;/);
    assert.match(css, /@media\(max-width:1000px\)\{#customerProfileModal\.customer-drawer-open[^}]*width:min\(720px,76vw\)/, "accepted responsive width override remains active");
    assert.match(css, /#customerProfileModal\.customer-drawer-open \.customer-drawer-table td[^}]*font-size:15px/);
    assert.match(css, /#customerProfileModal\.customer-drawer-open \.customer-drawer-inline-table td[^}]*font-size:14px/);
    assert(!/^\.customer-drawer-(?:table|inline-table)|^\.customer-info-table\s*\{/m.test(css), "customer drawer/table typography stays scoped and does not leak globally");
    const creditForm = html.match(/<section id="customerDrawerFormView"[\s\S]*?<div id="drawerStoreCreditOnly"[\s\S]*?<\/section>/);
    assert(creditForm, "mobile-only credit presentation is contained in the unresolved customer form");
    assert.strictEqual((html.match(/id="drawerStoreCreditOnly"/g) || []).length, 1);
    assert(html.indexOf('id="drawerStoreCreditOnly"') < html.indexOf('id="customerDrawerError"'), "no mobile-only Store Credit block follows Purchase History");
    assert.match(css, /prefers-reduced-motion:reduce/);
    assert.match(appSource, /if \(window\.isNewBillCustomerDrawerOpen\?\.\(\)\) \{\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*event\.stopImmediatePropagation\(\);/);
    assert.match(appSource, /document\.addEventListener\("keyup", \(event\) => \{\s*if \(event\.code !== "F6"\)\s*return;\s*if \(window\.isNewBillCustomerDrawerOpen\?\.\(\)\)/);
    assert.match(businessCss, /#customersScreen \.customer-directory-toolbar \{ align-items: center; margin: 0 0 24px;/);
    assert.match(html, /placeholder="Search by name, mobile or Customer ID"/);

    const ids = [
        "customerMobile","customerName","selectedCustomerProfileId","customerProfileOpen","newBillScreen","barcodeInput","customerProfileModal","drawerPanel","customerProfileTitle","customerDrawerBack","customerDrawerBody","customerDrawerChooser","customerDrawerChoices","customerDrawerNewChoice","customerDrawerProfileView","customerDrawerFormView","customerProfileValidation","customerProfileSave","customerProfileCancel","customerDrawerError","profileName","profileMobile","profileBirthday","profileAnniversary","profileEmail","profileNotes","customerDrawerHelper","drawerCustomerName","drawerCustomerCode","drawerCustomerMobile","drawerBirthdayLabel","drawerAnniversaryLabel","drawerBirthday","drawerAnniversary","drawerEmail","drawerNotes","drawerBillCount","drawerSpend","drawerLastVisit","drawerAverage","drawerCustomerEvents","drawerCustomerEventText","drawerStoreCreditSection","drawerStoreCreditEmpty","drawerStoreCreditAmount","drawerStoreCreditValidity","drawerStoreCreditReference","drawerStoreCreditOnly","drawerCreditOnlyAmount","drawerCreditOnlyValidity","drawerCreditOnlyReference","drawerPurchaseEmpty","drawerPurchaseTableWrap","drawerPurchaseRows","drawerPurchasePagination","drawerPurchaseControls","drawerPurchaseRange","drawerPurchasePage","drawerPurchasePrevious","drawerPurchaseNext","drawerPurchaseJump","customerDrawerEdit","customerProfileCancel"
    ];
    const elements = new Map(ids.map(id => [id, new Element(id)]));
    globalThis.__elements = elements;
    const focusables = ["customerDrawerBack","customerDrawerEdit","drawerPurchasePrevious","drawerPurchaseJump","drawerPurchaseNext","customerProfileCancel","customerProfileSave","profileName","profileMobile","profileBirthday","profileAnniversary","profileEmail","profileNotes"].map(id => elements.get(id));
    globalThis.__focusables = focusables;
    const document = {
        activeElement: elements.get("barcodeInput"),
        getElementById: id => elements.get(id) || null,
        createElement: () => new Element(),
        addEventListener() {},
        querySelector: () => null
    };
    globalThis.__document = document;
    elements.get("customerProfileModal").querySelector = selector => selector.includes("customer-drawer-panel") ? elements.get("drawerPanel") : null;
    elements.get("customerProfileModal").querySelectorAll = () => focusables;
    elements.get("customerProfileModal").contains = target => focusables.includes(target);
    elements.get("newBillScreen").style.display = "block";
    const thisMonth = String(new Date().getMonth() + 1).padStart(2, "0");
    let profile = { id: 17, customer_code: "KLCUS000017", name: "Himanish", mobile: "9985972977", birthday_ddmm: `26/${thisMonth}`, marriage_anniversary_ddmm: "14/02", email: "h@example.in", notes: "Preference", total_bills: 2, total_spend: 800, average_bill: 400, last_visit: "2026-10-01" };
    let profilesByMobile = [];
    let credits = { status: "ISSUED", remaining_balance: 500, valid_until: "2026-12-15", store_credit_no: "SC-17" };
    let historyPage = { rows: [{ bill_no: "B-1", bill_date: "2026-10-01", net_amount: 400 }], totalCount: 201, page: 1, pageSize: 100, totalPages: 3 };
    let writes = 0; let billReads = 0; let viewed = 0; let profileLoadError = false;
    const window = {
        electronAPI: {
            async findCustomersByMobile() { return profilesByMobile; },
            async getCustomerProfile() { return profile; },
            async getCustomerManagementProfile() { if (profileLoadError) throw new Error("Profile read failed"); return profile; },
            async getAvailableStoreCreditByMobile() { return credits; },
            async getCustomerPurchaseHistoryPage(_id, options) { return { ...historyPage, page: options.page, pageSize: options.pageSize }; },
            async createCustomerProfile(data) { writes++; profile = { ...profile, ...data, id: 17, customer_code: "KLCUS000017" }; return profile; },
            async updateCustomerProfile(id, data) { writes++; profile = { ...profile, ...data, id }; return profile; },
            async getBillDetails(billNo) { billReads++; return { bill: { bill_no: billNo, bill_date: "2026-10-01", gross_amount: 450, discount_amount: 50, taxable_amount: 400, cgst_amount: 20, sgst_amount: 20, gst_amount: 40, net_amount: 400, cash_amount: 400, upi_amount: 0, card_amount: 0, store_credit_amount: 0, gift_voucher_amount: 0 }, items: [{ product_name: "Kurti", size: "M", qty: 1, net_amount: 400 }] }; }
        },
        getComputedStyle: element => ({ display: element.style.display, visibility: "visible", opacity: "1" }),
        setTimeout(fn) { fn(); return 1; }
    };
    const listeners = {};
    document.addEventListener = (type, fn) => { (listeners[type] ||= []).push(fn); };
    const context = { document, window, Event: class { constructor(type, options = {}) { this.type = type; Object.assign(this, options); } }, requestAnimationFrame: fn => fn(), setTimeout: fn => { fn(); return 1; }, clearTimeout() {}, console, Date };
    vm.createContext(context);
    vm.runInContext(moduleSource, context, { filename: "customerProfile.js" });
    const button = elements.get("customerProfileOpen");
    const name = elements.get("customerName"), mobile = elements.get("customerMobile"), drawer = elements.get("customerProfileModal");
    name.value = ""; mobile.value = ""; credits = null;
    window.updateNewBillCustomerStoreCredit("", null);
    await button.click();
    assert.strictEqual(elements.get("drawerStoreCreditOnly").hidden, true, "clean New Customer form hides Store Credit entirely");
    assert.strictEqual(elements.get("drawerStoreCreditSection").hidden, true, "clean New Customer form has no profile Store Credit section");
    assert.strictEqual(globalThis.__drawerFocusAfterVisible, true, "drawer visible state is applied before initial focus transfer");
    assert.strictEqual(elements.get("profileName").focusOptions?.preventScroll, true, "New Customer autofocus cannot scroll or focus the New Bill background");
    await elements.get("customerDrawerBack").click();

    mobile.value = "9985972977"; profilesByMobile = []; credits = null;
    window.updateNewBillCustomerStoreCredit(mobile.value, null);
    await button.click();
    assert.strictEqual(elements.get("drawerStoreCreditOnly").hidden, true, "valid unresolved mobile without available credit hides Store Credit");
    assert.strictEqual(elements.get("drawerStoreCreditSection").hidden, true);
    await elements.get("customerDrawerBack").click();

    name.value = "New bill name"; mobile.value = "9985972977";
    credits = { status: "ISSUED", remaining_balance: 500, valid_until: "2026-12-15", store_credit_no: "SC-17" };
    window.updateNewBillCustomerStoreCredit(mobile.value, credits);
    assert(button.classList.contains("is-customer-attention") && button.classList.contains("is-customer-resolved"), "available mobile-based credit produces green attention without customer identity");
    await button.click();
    assert.strictEqual(drawer.style.display, "block", "+ opens the drawer (not the old modal presentation)");
    assert(drawer.classList.contains("customer-drawer-open") && drawer.classList.contains("customer-drawer-visible"));
    assert.strictEqual(elements.get("customerDrawerFormView").hidden, false);
    assert.strictEqual(elements.get("profileName").value, "New bill name");
    assert.strictEqual(elements.get("profileMobile").value, "9985972977");
    assert.strictEqual(elements.get("customerDrawerHelper").textContent, "Customer details are optional for billing.");
    assert.strictEqual(elements.get("customerProfileSave").textContent, "SAVE CUSTOMER");
    assert.strictEqual(elements.get("newBillScreen").inert, true, "New Bill is inert behind the drawer");
    assert.strictEqual(elements.get("drawerCreditOnlyAmount").textContent, "₹500.00 AVAILABLE");
    assert(elements.get("drawerStoreCreditOnly").classList.contains("is-available"), "unresolved mobile credit uses the positive presentation");
    assert.strictEqual(writes, 0);
    await elements.get("customerProfileSave").click();
    assert.strictEqual(writes, 1, "New Customer SAVE delegates to the central profile creation service");
    assert.strictEqual(drawer.style.display, "block", "successful creation transitions in the same drawer");
    assert.strictEqual(elements.get("customerDrawerProfileView").hidden, false);
    assert.strictEqual(elements.get("drawerCustomerCode").textContent, "Customer ID: KLCUS000017", "Customer ID is supplied by the service");
    await elements.get("customerDrawerBack").click();
    assert.strictEqual(drawer.style.display, "none", "Back closes drawer");
    assert.strictEqual(elements.get("newBillScreen").inert, false);
    assert.strictEqual(name.value, "New bill name");
    assert.strictEqual(mobile.value, "9985972977");

    profile = { id: 17, customer_code: "KLCUS000017", name: "Himanish", mobile: "9985972977", birthday_ddmm: `26/${thisMonth}`, marriage_anniversary_ddmm: "14/02", email: "h@example.in", notes: "Preference", total_bills: 2, total_spend: 800, average_bill: 400, last_visit: "2026-10-01" };
    mobile.value = "9985972977"; profilesByMobile = [profile]; credits = null;
    window.updateNewBillCustomerStoreCredit(mobile.value, null);
    elements.get("selectedCustomerProfileId").value = "17";
    await button.click();
    assert(button.classList.contains("is-customer-resolved"));
    assert.strictEqual(elements.get("customerDrawerProfileView").hidden, false);
    assert.strictEqual(elements.get("drawerCustomerCode").textContent, "Customer ID: KLCUS000017");
    assert.strictEqual(elements.get("drawerCustomerName").textContent, "Himanish");
    assert.strictEqual(elements.get("drawerBillCount").textContent, "2");
    assert.strictEqual(elements.get("drawerSpend").textContent, "₹800.00");
    assert.strictEqual(elements.get("drawerStoreCreditSection").hidden, false);
    assert.strictEqual(elements.get("drawerStoreCreditOnly").hidden, true, "resolved profile never also renders the mobile-only Store Credit section");
    assert.strictEqual(elements.get("drawerStoreCreditEmpty").hidden, false, "profile always shows a compact neutral no-credit state");
    assert.strictEqual((html.match(/id="drawerStoreCreditSection"/g) || []).length, 1, "resolved profile has one profile Store Credit section");
    assert.strictEqual(elements.get("drawerStoreCreditSection").classList.contains("is-available"), false);
    window.updateNewBillCustomerStoreCredit(mobile.value, { status: "ISSUED", remaining_balance: 500, valid_until: "2026-12-15", store_credit_no: "SC-17" });
    assert(elements.get("drawerStoreCreditSection").classList.contains("is-available"), "available credit uses positive treatment");
    assert.strictEqual(elements.get("drawerStoreCreditEmpty").hidden, true);
    assert.strictEqual(elements.get("drawerStoreCreditAmount").textContent, "₹500.00 AVAILABLE");
    assert.strictEqual(elements.get("drawerStoreCreditOnly").hidden, true, "available resolved credit is not duplicated after Purchase History");
    window.updateNewBillCustomerStoreCredit(mobile.value, null);
    assert.strictEqual(elements.get("drawerBirthday").textContent, `${Number(thisMonth === "01" ? "26" : "26")}-` + ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][Number(thisMonth)-1]);
    assert.strictEqual(elements.get("drawerCustomerEvents").hidden, false);
    assert.strictEqual(elements.get("drawerCustomerEventText").textContent, "Birthday this month");
    assert.strictEqual(elements.get("drawerPurchaseRows").children.length, 1);
    assert.strictEqual(elements.get("drawerPurchasePagination").hidden, false);
    assert.strictEqual(elements.get("drawerPurchaseControls").hidden, false);
    assert.strictEqual((html.match(/id="drawerStoreCreditSection"/g) || []).length, 1, "profile has exactly one Store Credit section");
    assert.strictEqual(elements.get("drawerLastVisit").textContent, "01-Oct-2026", "full dates use a leading-zero day");
    await elements.get("drawerPurchaseNext").click();
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(elements.get("drawerPurchasePage").textContent, "Page 2 of 3", "history pagination remains database-backed inside the drawer");
    assert.strictEqual(elements.get("drawerPurchaseRows").children[0].children[3].children[0].textContent, "DETAILS ▾");
    const view = elements.get("drawerPurchaseRows").children[0].children[3].children[0];
    await view.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(billReads, 1, "bill detail reuses the existing getBillDetails authority");
    assert.strictEqual(viewed, 0, "no Bill Details screen navigation occurs");
    const purchaseBody = elements.get("drawerPurchaseRows");
    assert.strictEqual(purchaseBody.children.length, 2, "bill details expand in a row directly beneath the selected purchase");
    const expandedRow = purchaseBody.children[1];
    assert.strictEqual(expandedRow.className, "customer-drawer-inline");
    assert(expandedRow.children[0].children.length > 0);
    assert.strictEqual(view.textContent, "DETAILS ▴");
    await view.click();
    assert.strictEqual(purchaseBody.children.length, 1, "inline detail row is removed cleanly on collapse");
    assert.strictEqual(view.textContent, "DETAILS ▾");
    assert.strictEqual(writes, 1, "history inspection performs no additional writes");

    await view.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(purchaseBody.children.length, 2);
    const focusedBefore = document.activeElement;
    await elements.get("customerDrawerEdit").click();
    assert.strictEqual(elements.get("customerDrawerFormView").hidden, false, "edit switches form inside the same drawer");
    assert.strictEqual(elements.get("customerProfileCancel").textContent, "CANCEL EDIT");
    assert.strictEqual(elements.get("customerProfileSave").textContent, "SAVE CHANGES");
    elements.get("profileNotes").value = "Edited in drawer";
    await elements.get("customerProfileSave").click();
    assert.strictEqual(drawer.style.display, "block", "profile edit stays in drawer");
    assert.strictEqual(elements.get("customerDrawerProfileView").hidden, false, "saved edit returns to read-only drawer profile");
    assert.strictEqual(purchaseBody.children.length, 1, "profile reload removes any expanded row before repaint");
    assert.strictEqual(writes, 2);
    assert.notStrictEqual(document.activeElement, focusedBefore);
    await elements.get("customerDrawerEdit").click();
    elements.get("profileName").value = "Discarded edit";
    await elements.get("customerProfileCancel").click();
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(elements.get("drawerCustomerName").textContent, "Himanish", "Cancel Edit discards edits and returns to read-only view");
    historyPage = { rows: [{ bill_no: "B-1", bill_date: "2026-10-01", net_amount: 400 }], totalCount: 1, page: 1, pageSize: 100, totalPages: 1 };
    await button.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(elements.get("drawerPurchasePagination").hidden, false, "single result may retain its subtle range");
    assert.strictEqual(elements.get("drawerPurchaseControls").hidden, true, "single-page history hides navigation and jump controls");
    assert.strictEqual(elements.get("drawerPurchaseRange").textContent, "Showing 1–1 of 1 purchase");
    historyPage = { rows: [{ bill_no: "B-1", bill_date: "2026-10-01", net_amount: 400 }], totalCount: 201, page: 1, pageSize: 100, totalPages: 3 };
    profileLoadError = true;
    await button.click();
    assert.strictEqual(elements.get("customerDrawerError").textContent, "Profile read failed");
    assert.notStrictEqual(elements.get("customerDrawerError").textContent, "Loading customer profile…", "failed profile load leaves a visible error instead of a stuck loading state");
    profileLoadError = false;
    await button.click();
    assert.strictEqual(elements.get("customerDrawerError").textContent, "");
    const scrimClick = (drawer.listeners.click || [])[0];
    await scrimClick?.({ target: drawer, preventDefault() { this.prevented = true; } });
    assert.strictEqual(drawer.style.display, "block", "clicking the scrim does not close the drawer");

    // A shared mobile is resolved inside the drawer and never silently selects a profile.
    profilesByMobile = [profile, { ...profile, id: 18, customer_code: "KLCUS000018", name: "Second Profile" }];
    mobile.value = "9985972977";
    await elements.get("customerMobile").fire("input");
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(drawer.style.display, "block");
    assert.strictEqual(elements.get("customerDrawerChooser").hidden, false, "shared-mobile choices appear inside drawer");
    assert.strictEqual(elements.get("customerDrawerChoices").children.length, 2);
    assert.strictEqual(elements.get("selectedCustomerProfileId").value, "", "no shared-mobile profile is silently selected");

    // Escape and protected billing shortcuts while the drawer is active.
    vm.runInContext(shortcutsSource, context, { filename: "shortcuts.js" });
    const shortcutEvent = code => ({ code, prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() {}, stopImmediatePropagation() {} });
    const f10 = shortcutEvent("F10"); context.handleKeyboardShortcut(f10); assert(f10.prevented, "F10 is blocked while drawer open");
    const f12 = shortcutEvent("F12"); context.handleKeyboardShortcut(f12); assert(f12.prevented, "F12 is blocked while drawer open");
    const esc = shortcutEvent("Escape"); context.handleKeyboardShortcut(esc);
    assert(esc.prevented && !window.isNewBillCustomerDrawerOpen(), "ESC is consumed and closes drawer only");
    assert.strictEqual(elements.get("newBillScreen").style.display, "block");

    // Clearing New Bill while an inline row exists removes the row without relying on a static markup node.
    elements.get("selectedCustomerProfileId").value = "17";
    await button.click();
    await new Promise(resolve => setImmediate(resolve));
    const resetView = elements.get("drawerPurchaseRows").children[0].children[3].children[0];
    await resetView.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(elements.get("drawerPurchaseRows").children.length, 2);
    window.resetCustomerProfileDraft();
    assert.strictEqual(drawer.style.display, "none", "New Bill reset closes drawer safely");
    assert.strictEqual(elements.get("drawerPurchaseRows").children.length, 0);
    assert.strictEqual(elements.get("customerDrawerError").textContent, "");

    const app = fs.readFileSync(path.join(root, "src/renderer/app.js"), "utf8");
    assert(!app.includes("new-bill-customer-info") && !app.includes("new-bill-customer-history"), "New Bill no longer routes into a Bill Details overlay");
    assert.match(shortcutsSource, /window\.isNewBillCustomerDrawerOpen\?\.\(\)[\s\S]*?window\.closeNewBillCustomerDrawer/);
    assert.match(shortcutsSource, /if \(window\.isNewBillCustomerDrawerOpen\?\.\(\)\) return true/);
    assert.match(moduleSource, /getCustomerManagementProfile\(id\)/);
    assert.match(moduleSource, /getCustomerPurchaseHistoryPage\(id, \{ page: requestedPage, pageSize: 100 \}\)/);
    assert.match(moduleSource, /getAvailableStoreCreditByMobile\(mobile\)/);
    assert(!moduleSource.includes("window.viewBill("), "drawer never opens Bill Details navigation");
    assert(!moduleSource.includes("customerInfoModal") && !moduleSource.includes("customerHistoryModal"));
    const electronBinary = require("electron");
    const cssRuntime = spawnSync(electronBinary, ["--disable-gpu", "--no-sandbox", __filename, "--drawer-style-child", path.join(root, "src/renderer/styles/billing.css"), path.join(root, "src/renderer/styles/settings.css")], { cwd: root, encoding: "utf8", timeout: 30000, windowsHide: true });
    if (cssRuntime.error) throw cssRuntime.error;
    if (cssRuntime.status !== 0 || !cssRuntime.stdout.includes("Electron Chromium computed-style/geometry/transition check: PASS")) throw new Error(`Electron computed-style check failed (exit ${cssRuntime.status}, signal ${cssRuntime.signal || "none"}): ${cssRuntime.stderr || cssRuntime.stdout || "child completed without its runtime-check result"}`);
    process.stdout.write(cssRuntime.stdout);
    process.stdout.write("V21-03B-F3 New Bill customer drawer, profile, Store Credit, history, inline bill and toolbar contracts: PASS\n");
}

if (process.versions.electron && process.argv.includes("--drawer-style-child")) {
    runElectronStyleCheck().catch(error => { console.error(error); try { require("electron").app.quit(); } catch (_) {} process.exitCode = 1; });
} else {
    main().catch(error => { console.error(error); process.exitCode = 1; });
}
