"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const sqlite3 = require("sqlite3").verbose();

const run = (db, sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function(error) {
    error ? reject(error) : resolve(this);
}));
const get = (db, sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
const close = db => new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));

async function qualifyRendererDirectoryStates() {
    class Element {
        constructor(id = "") {
            this.id = id;
            this.hidden = false;
            this.disabled = false;
            this.value = "";
            this.textContent = "";
            this.style = {};
            this.children = [];
            this.listeners = {};
            this.classes = new Set();
            this.classList = {
            toggle: (name, force) => force ? this.classes.add(name) : this.classes.delete(name),
                add: (...names) => names.forEach(name => this.classes.add(name)),
                remove: (...names) => names.forEach(name => this.classes.delete(name)),
                contains: name => this.classes.has(name)
            };
            this.dataset = {};
            this.attributes = {};
            this.validationMessage = "";
            this.selectionStart = 0;
            this.selectionEnd = 0;
        }
        addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
        dispatch(type, event = {}) {
            event.type = type;
            event.target ||= this;
            let result;
            for (const handler of this.listeners[type] || []) result = handler(event);
            return result;
        }
        click() { return this.dispatch("click", {}); }
        append(...children) { this.children.push(...children); }
        replaceChildren(...children) { this.children = children; }
        focus() { this.focused = true; }
        setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
        setCustomValidity(message) { this.validationMessage = message; }
        setAttribute(name, value) { this.attributes[name] = value; }
        removeAttribute(name) { delete this.attributes[name]; }
        querySelector(selector) { return selector.includes("customer-drawer-panel") ? elements.get("drawerPanel") : elements.get("customerDrawerBack"); }
        querySelectorAll() { return []; }
        getClientRects() { return this.hidden ? [] : [{}]; }
        contains(element) { return element === this || this.children.some(child => child.contains?.(element)); }
    }
    const ids = [
        "customerDirectoryView", "customerManagementProfile", "customerDirectorySearch", "customerDirectoryAdd",
        "customerDirectoryMessage", "customerDirectoryEmpty", "customerDirectoryNoResults", "customerDirectoryTableWrap",
        "customerDirectoryPagination", "customerDirectoryPrevious", "customerDirectoryNext", "customerDirectoryPageLabel",
        "customerDirectoryRangeLabel", "customerDirectoryPageJump", "customerDirectoryRows", "customerProfileBackToDirectory",
        "customerManagementMessage", "customerPurchaseRows", "customerPurchaseEmpty", "customerProfileEdit",
        "managementCustomerName", "managementCustomerCode", "managementCustomerMobile", "managementCustomerBirthday",
        "managementCustomerAnniversary", "managementCustomerEmail", "managementCustomerNotes", "managementCustomerBillCount",
        "managementCustomerSpend", "managementCustomerLastVisit", "managementCustomerAverage"
        , "customerMobile", "customerName", "selectedCustomerProfileId", "drawerPanel", "customerDrawerBack", "customerDrawerBody", "customerDrawerChooser", "customerDrawerChoices", "customerDrawerNewChoice", "customerDrawerProfileView", "customerDrawerFormView", "customerDrawerEdit", "customerDrawerError", "customerDrawerHelper", "drawerCustomerName", "drawerCustomerCode", "drawerCustomerMobile", "drawerBirthday", "drawerAnniversary", "drawerEmail", "drawerNotes", "drawerBillCount", "drawerSpend", "drawerLastVisit", "drawerAverage", "drawerCustomerEvents", "drawerCustomerEventText", "drawerStoreCreditSection", "drawerStoreCreditEmpty", "drawerStoreCreditAmount", "drawerStoreCreditValidity", "drawerStoreCreditReference", "drawerStoreCreditOnly", "drawerCreditOnlyAmount", "drawerCreditOnlyValidity", "drawerCreditOnlyReference", "drawerPurchaseEmpty", "drawerPurchaseTableWrap", "drawerPurchaseRows", "drawerPurchasePagination", "drawerPurchaseControls", "drawerPurchaseRange", "drawerPurchasePage", "drawerPurchasePrevious", "drawerPurchaseNext", "drawerPurchaseJump", "barcodeInput",
        "customerInfoOpen", "customerInfoModal", "customerInfoClose", "customerInfoName", "customerInfoCode", "customerInfoMobile", "customerInfoEvents", "customerInfoStoreCredit", "customerInfoCreditAmount", "customerInfoCreditValidity", "customerInfoCreditReference", "customerInfoRecentSection", "customerInfoRecentEmpty", "customerInfoRecentTable", "customerInfoRecentRows", "customerInfoViewAll", "customerInfoHistoryRows", "customerInfoHistoryEmpty", "customerInfoHistoryPagination", "customerInfoHistoryRange", "customerInfoHistoryPrevious", "customerInfoHistoryPage", "customerInfoHistoryJump", "customerInfoHistoryNext",
        "customerProfileTitle", "customerProfileModal", "profileName", "profileMobile",
        "profileBirthday", "profileAnniversary", "profileEmail", "profileNotes", "customerProfileValidation",
        "customerProfileCancel", "customerProfileSave", "customerProfileOpen", "customerChooserModal",
        "customerChooserList", "customerChooserNew", "customerChooserCancel", "customerHistoryModal",
        "customerHistoryList", "customerHistoryClose", "customerHistoryModal", "customersScreen", "newBillScreen", "paymentScreen",
        "customerPurchaseTableWrap", "customerPurchasePagination", "customerPurchasePrevious", "customerPurchaseNext",
        "customerPurchasePageLabel", "customerPurchasePageJump", "customerPurchaseRangeLabel",
        "businessScreen", "customerProfileBackToDirectory", "customersBusinessBtn"
    ];
    const elements = new Map(ids.map(id => [id, new Element(id)]));
    elements.get("customerProfileModal").querySelector = selector => selector.includes("customer-drawer-panel") ? elements.get("drawerPanel") : elements.get("customerDrawerBack");
    elements.get("customerDirectoryEmpty").hidden = true;
    elements.get("customerDirectoryNoResults").hidden = true;
    elements.get("customerDirectoryTableWrap").hidden = true;
    elements.get("customerDirectoryPagination").hidden = true;
    elements.get("customerManagementProfile").hidden = true;
    const requests = [];
    const resultFactory = (search, page) => ({
        rows: Number(search) ? [{ id: 1, name: "Shared Profile", mobile: search }] : [{ id: 1, name: "Example Customer", mobile: "9000000000" }],
        totalCount: search === "missing" ? 0 : search === "Patnaik" ? 205 : search === "" ? 1 : 1,
        page,
        pageSize: 100,
        totalPages: search === "Patnaik" ? 3 : 1
    });
    let responseFactory = resultFactory;
    let purchaseFactory = () => ({ rows: [], totalCount: 0, page: 1, pageSize: 100, totalPages: 1 });
    const viewedBills = [];
    elements.get("customersScreen").style.display = "block";
    elements.get("newBillScreen").style.display = "none";
    elements.get("paymentScreen").style.display = "none";
    let profileCreateCalls = 0;
    const window = {
        setTimeout(callback) { return setTimeout(callback, 0); },
        scrollY: 37,
        scrollTo(_x, y) { this.scrollY = y; },
        getComputedStyle(element) { return { display: element.style.display || "none", visibility: "visible", opacity: "1" }; },
        electronAPI: {
            async listCustomerDirectory(request) {
                requests.push({ ...request });
                return responseFactory(request.search, request.page);
            },
            async getCustomerManagementProfile(id) {
                return {
                    id, customer_code: "KLCUS000077", name: "Example Customer", total_bills: 0,
                    birthday_ddmm: id === 78 ? "44/44" : id === 79 ? null : id === 77 ? "01/01" : "26/03",
                    marriage_anniversary_ddmm: id === 78 ? "31/02" : id === 79 ? "" : id === 77 ? "29/02" : "14/02"
                };
            },
            async getCustomerPurchaseHistory() { return []; },
            async getCustomerPurchaseHistoryPage(id, options) { return purchaseFactory(id, options); },
            async getCustomerProfile(id) {
                return {
                    id, customer_code: "KLCUS000077", name: "Example Customer", mobile: "9000000000",
                    birthday_ddmm: "26/03", marriage_anniversary_ddmm: "14/02"
                };
            },
            async getAvailableStoreCreditByMobile() { return null; },
            async findCustomersByMobile() { return []; },
            async createCustomerProfile(data) { profileCreateCalls += 1; return { id: 99, ...data }; },
            async updateCustomerProfile(id, data) { return { id, ...data }; }
        },
        viewBill(billNo, context) { viewedBills.push({ billNo, context }); }
    };
    const document = {
        getElementById: id => elements.get(id) || null,
        createElement: () => new Element(),
        querySelector: () => null,
        addEventListener() {}
    };
    class TestEvent {
        constructor(type, options = {}) { this.type = type; Object.assign(this, options); }
        preventDefault() { this.defaultPrevented = true; }
    }
    const profileSource = fs.readFileSync(path.join(__dirname, "../src/renderer/modules/customerProfile.js"), "utf8");
    vm.runInNewContext(profileSource, { document, window, Event: TestEvent, setTimeout, clearTimeout, requestAnimationFrame: callback => callback(), console, alert() {} });
    let addEntry = null;
    const openSharedModal = window.openCustomerDetailsForManagement;
    window.openCustomerDetailsForManagement = (profile, onSaved) => {
        addEntry = { profile, onSaved };
        return openSharedModal(profile, onSaved);
    };
    const source = fs.readFileSync(path.join(__dirname, "../src/renderer/modules/customerManagement.js"), "utf8");
    vm.runInNewContext(source, {
        document, window, setTimeout, clearTimeout,
        requestAnimationFrame: callback => callback(),
        Number, String, Promise
    });
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    const assertState = (empty, noResults, table, pagination, label) => {
        assert.strictEqual(elements.get("customerDirectoryEmpty").hidden, !empty, `${label}: empty state`);
        assert.strictEqual(elements.get("customerDirectoryNoResults").hidden, !noResults, `${label}: no-results state`);
        assert.strictEqual(elements.get("customerDirectoryTableWrap").hidden, !table, `${label}: table`);
        assert.strictEqual(elements.get("customerDirectoryPagination").hidden, !pagination, `${label}: pagination`);
    };

    responseFactory = () => ({ rows: [], totalCount: 0, page: 1, pageSize: 100, totalPages: 1 });
    await window.showCustomerDirectory();
    assertState(true, false, false, false, "zero customers and blank search");
    elements.get("customerDirectorySearch").value = "   ";
    elements.get("customerDirectorySearch").dispatch("input", {});
    await delay(150);
    assertState(true, false, false, false, "zero customers and whitespace search");

    responseFactory = (search, page) => ({
        rows: [{ id: 1, name: "Example Customer", mobile: "9000000000" }],
        totalCount: search === "Patnaik" ? 205 : 1,
        page,
        pageSize: 100,
        totalPages: search === "Patnaik" ? 3 : 1
    });
    elements.get("customerDirectorySearch").value = "";
    await window.showCustomerDirectory();
    assertState(false, false, true, true, "customers and blank search");
    assert(elements.get("customerDirectoryPrevious").disabled, "first-page Previous is disabled");
    assert(elements.get("customerDirectoryNext").disabled, "one-page Next is disabled");

    responseFactory = (search, page) => ({
        rows: [{ id: page, name: "Patnaik Match", mobile: "9000000001" }],
        totalCount: 205, page, pageSize: 100, totalPages: 3
    });
    elements.get("customerDirectorySearch").value = "Patnaik";
    elements.get("customerDirectorySearch").dispatch("input", {});
    await delay(150);
    assertState(false, false, true, true, "search with matching customers");
    assert.strictEqual(requests.at(-1).page, 1, "search changes reset pagination to page one");
    assert.strictEqual(elements.get("customerDirectoryNext").disabled, false);
    await elements.get("customerDirectoryNext").click();
    await delay(0);
    assert.strictEqual(requests.at(-1).page, 2, "Next requests only the following backend page");
    assert.strictEqual(elements.get("customerDirectoryPageLabel").textContent, "Page 2 of 3");
    const openProfile = elements.get("customerDirectoryRows").children[0].children[6].children[0];
    await openProfile.click();
    assert.strictEqual(elements.get("customerManagementProfile").hidden, false, "directory row opens profile view");
    assert.strictEqual(elements.get("customerPurchaseEmpty").hidden, false, "zero linked bills show the purchase empty state");
    assert.strictEqual(elements.get("customerPurchaseTableWrap").hidden, true, "zero linked bills hide table headers");
    assert.strictEqual(elements.get("customerPurchasePagination").hidden, true, "zero linked bills hide pagination");
    await elements.get("customerProfileBackToDirectory").click();
    assert.deepStrictEqual([requests.at(-1).search, requests.at(-1).page], ["Patnaik", 2], "profile return restores search and page");
    await elements.get("customerDirectoryNext").click();
    await delay(0);
    assert.strictEqual(requests.at(-1).page, 3, "last page is fetched via LIMIT/OFFSET service request");
    assert.strictEqual(elements.get("customerDirectoryNext").disabled, true, "last-page Next is disabled");

    await window.showCustomerDirectory();
    assert.deepStrictEqual([requests.at(-1).search, requests.at(-1).page], ["", 1], "fresh Customers entry clears prior search and starts at page one");
    assert.strictEqual(elements.get("customerDirectorySearch").value, "", "fresh entry clears the visible search field");
    assert.match(elements.get("customerDirectoryPageLabel").textContent, /^Page 1 of /, "fresh entry resets displayed page even when several pages exist");

    responseFactory = (search, page) => ({ rows: [{ id: 1, name: "Patnaik Match", mobile: "9000000001", customer_code: "KLCUS000001" }], totalCount: 205, page, pageSize: 100, totalPages: 3 });
    elements.get("customerDirectorySearch").value = "Patnaik";
    elements.get("customerDirectorySearch").dispatch("input", {});
    await delay(150);
    await elements.get("customerDirectoryNext").click();
    await delay(0);
    const directoryRow = elements.get("customerDirectoryRows").children[0];
    assert.strictEqual(directoryRow.children[0].textContent, "KLCUS000001", "directory displays the business Customer ID in the first column");
    assert.strictEqual(directoryRow.children[1].textContent, "Patnaik Match", "customer name occupies the second column");
    purchaseFactory = (_id, options) => ({
        rows: [{ id: options.page, bill_no: `B-${options.page}`, bill_date: "2026-10-01", total_items: 1, total_qty: 1, net_amount: 100 }],
        totalCount: 205, page: options.page, pageSize: 100, totalPages: 3
    });
    const profileOpenButton = elements.get("customerDirectoryRows").children[0].children[6].children[0];
    await profileOpenButton.click();
    await delay(0);
    assert.strictEqual(elements.get("managementCustomerCode").textContent, "Customer ID · KLCUS000077");
    assert.strictEqual(elements.get("managementCustomerBirthday").textContent, "26-Mar");
    assert.strictEqual(elements.get("managementCustomerAnniversary").textContent, "14-Feb");
    await elements.get("customerProfileEdit").click();
    assert.strictEqual(elements.get("profileBirthday").value, "26/03", "Edit modal receives stored DD/MM rather than display text");
    assert.strictEqual(elements.get("profileAnniversary").value, "14/02", "Edit modal retains numeric DD/MM for anniversary");
    await elements.get("customerProfileCancel").click();
    await window.openCustomerManagementProfile(77);
    assert.strictEqual(elements.get("managementCustomerBirthday").textContent, "01-Jan");
    assert.strictEqual(elements.get("managementCustomerAnniversary").textContent, "29-Feb");
    await window.openCustomerManagementProfile(78);
    assert.strictEqual(elements.get("managementCustomerBirthday").textContent, "—", "malformed stored date uses a safe display fallback");
    assert.strictEqual(elements.get("managementCustomerAnniversary").textContent, "—");
    await window.openCustomerManagementProfile(79);
    assert.strictEqual(elements.get("managementCustomerBirthday").textContent, "—", "blank stored dates display an em dash");
    assert.strictEqual(elements.get("customerPurchaseTableWrap").hidden, false, "linked history shows the table");
    assert.strictEqual(elements.get("customerPurchaseEmpty").hidden, true);
    await elements.get("customerPurchaseNext").click();
    await delay(0);
    await elements.get("customerPurchaseNext").click();
    await delay(0);
    assert.strictEqual(elements.get("customerPurchasePageLabel").textContent, "Page 3 of 3", "purchase paging clamps to the last page and renders requested backend page");
    assert.strictEqual(elements.get("customerPurchaseNext").disabled, true);
    elements.get("customerPurchaseRows").children[0].children[4].children[0].click();
    assert.strictEqual(viewedBills.at(-1).context.historyPage, 3, "bill details context retains purchase-history page");
    window.restoreCustomerProfileContext(1, viewedBills.at(-1).context.historyPage);
    await delay(0);
    assert.strictEqual(elements.get("customerPurchasePageLabel").textContent, "Page 3 of 3", "Bill Details return restores the same purchase page");
    await elements.get("customerProfileBackToDirectory").click();
    await delay(0);
    assert.deepStrictEqual([requests.at(-1).search, requests.at(-1).page], ["Patnaik", 2], "Profile → Bill Details → Profile → Directory restores directory search and page");

    responseFactory = () => ({ rows: [], totalCount: 0, page: 1, pageSize: 100, totalPages: 1 });
    elements.get("customerDirectorySearch").value = "missing";
    elements.get("customerDirectorySearch").dispatch("input", {});
    await delay(150);
    assertState(false, true, false, false, "nonblank search with no matches");
    assert.strictEqual(elements.get("customerDirectoryRows").children.length, 0);

    await elements.get("customerDirectoryAdd").click();
    assert(addEntry && addEntry.profile === null && typeof addEntry.onSaved === "function", "Add Customer calls the shared modal in create mode with the management save callback");
    assert.strictEqual(elements.get("customerProfileModal").style.display, "flex", "real shared modal becomes visible from the Customers screen");
    assert.strictEqual(elements.get("profileName").focused, true, "blank manual Add opens with Name focus");
    await elements.get("customerProfileCancel").click();
    assert.strictEqual(elements.get("customerProfileModal").style.display, "none", "Cancel closes the shared modal");
    assert.strictEqual(profileCreateCalls, 0, "Cancel closes without a customer database write");

    await elements.get("customerDirectoryAdd").click();
    const shortcutSource = fs.readFileSync(path.join(__dirname, "../src/renderer/modules/shortcuts.js"), "utf8");
    const shortcutContext = { document, window, console };
    vm.createContext(shortcutContext);
    vm.runInContext(shortcutSource, shortcutContext, { filename: "shortcuts.js" });
    shortcutContext.handleKeyboardShortcut({ code: "Escape", preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
    assert.strictEqual(elements.get("customerProfileModal").style.display, "none", "Escape closes Add Customer modal through the existing shortcut handler");
    assert.strictEqual(elements.get("customersScreen").style.display, "block", "Escape leaves the Customers screen active");

    await elements.get("customerDirectoryAdd").click();
    elements.get("profileName").value = "Runtime Created Profile";
    await elements.get("customerProfileSave").click();
    assert.strictEqual(profileCreateCalls, 1, "Save invokes the existing customer profile service exactly once");
    assert.strictEqual(elements.get("customerProfileModal").style.display, "none", "successful Save closes the shared modal");
    assert.strictEqual(elements.get("customerManagementProfile").hidden, false, "the management save callback opens the created profile");
}

async function main() {
    const db = new sqlite3.Database(":memory:");
    require.cache[require.resolve("../src/database/database")] = { exports: db };
    const customers = require("../src/database/customerService");
    try {
        await run(db, `CREATE TABLE customers (
            id INTEGER PRIMARY KEY AUTOINCREMENT, customer_code TEXT UNIQUE,
            name TEXT NOT NULL, mobile TEXT, email TEXT, address TEXT, remarks TEXT,
            active INTEGER DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            birthday_ddmm TEXT, marriage_anniversary_ddmm TEXT
        )`);
        await run(db, `CREATE TABLE bills (
            id INTEGER PRIMARY KEY AUTOINCREMENT, bill_no TEXT, bill_date TEXT,
            bill_time TEXT, customer_name TEXT, customer_mobile TEXT,
            total_items INTEGER, total_qty INTEGER, gross_amount REAL,
            discount_amount REAL, gst_amount REAL, net_amount REAL,
            cash_amount REAL, upi_amount REAL, card_amount REAL,
            store_credit_amount REAL, gift_voucher_amount REAL, customer_id INTEGER
        )`);

        const empty = await customers.listCustomerDirectory({ search: "   ", page: 1, pageSize: 100 });
        assert.deepStrictEqual([empty.rows, empty.totalCount, empty.page, empty.pageSize, empty.totalPages], [[], 0, 1, 100, 1], "empty whitespace search returns one authoritative empty page");
        const legacyProfile = await run(db, `INSERT INTO customers (name, mobile, active, created_at, updated_at)
            VALUES ('Legacy profile', '9555000000', 1, '2026-01-01', '2026-01-01')`);
        const nameOnly = await customers.createCustomerProfile({ name: "Name Only" });
        assert.strictEqual(nameOnly.customer_code, "KLCUS000001", "new profiles receive the exact first zero-padded Customer ID");
        assert.strictEqual((await customers.getCustomerProfile(legacyProfile.lastID)).customer_code, null, "legacy null Customer IDs are not silently backfilled");
        assert.strictEqual(nameOnly.mobile, null, "manual profiles may omit mobile");
        await assert.rejects(customers.createCustomerProfile({ name: "Partial Mobile", mobile: "98765" }), /exactly 10 digits/i);

        const first = await customers.createCustomerProfile({
            name: "Shared Household Alpha", mobile: "9876543210", birthday_ddmm: "29/02",
            email: "  alpha@example.com  ", notes: "First profile"
        });
        assert.strictEqual(first.customer_code, "KLCUS000002", "the centralized generator advances to KLCUS000002 after an existing KLCUS000001 profile");
        const second = await customers.createCustomerProfile({ name: "Shared Household Beta", mobile: "9876543210" });
        assert.notStrictEqual(first.id, second.id, "same mobile creates independent customer IDs");
        assert.deepStrictEqual([first.customer_code, second.customer_code], ["KLCUS000002", "KLCUS000003"], "shared-mobile profiles receive distinct sequential Customer IDs");
        const concurrentProfiles = await Promise.all(Array.from({ length: 12 }, (_, index) =>
            customers.createCustomerProfile({ name: `Concurrent Profile ${index}` })
        ));
        assert.strictEqual(new Set(concurrentProfiles.map(profile => profile.customer_code)).size, 12, "single-statement sequence allocation remains unique under concurrent creation");
        assert.deepStrictEqual(
            concurrentProfiles.map(profile => profile.customer_code).sort(),
            Array.from({ length: 12 }, (_, index) => `KLCUS${String(index + 4).padStart(6, "0")}`),
            "concurrent allocation produces unique zero-padded sequence values"
        );
        await assert.rejects(
            run(db, "UPDATE customers SET customer_code = ? WHERE id = ?", [first.customer_code, second.id]),
            /UNIQUE constraint failed/i,
            "SQLite unique constraint rejects duplicate Customer IDs"
        );
        assert.strictEqual(first.email, "alpha@example.com", "valid email is trimmed by existing service validation");
        assert.deepStrictEqual((await customers.listCustomerDirectory({ search: "9876543210" })).rows.map(row => row.name), [
            "Shared Household Alpha", "Shared Household Beta"
        ], "mobile search returns all shared-mobile profiles");
        assert.strictEqual((await customers.listCustomerDirectory({ search: "alpha" })).rows.length, 1, "name search is case-insensitive and partial");
        assert.strictEqual((await customers.listCustomerDirectory({ search: "klcus000002" })).rows[0].customer_code, "KLCUS000002", "Customer ID search is case-insensitive");
        assert.strictEqual((await customers.listCustomerDirectory({ search: "000002" })).rows[0].id, first.id, "partial numeric Customer ID search works");
        assert.strictEqual((await customers.listCustomerDirectory({ search: "  BETA  " })).rows.length, 1, "search trims input");
        assert.deepStrictEqual((await customers.listCustomerDirectory({ search: "no matching customer" })).rows, [], "empty search results are explicit");

        const historicUnlinked = await run(db, `INSERT INTO bills
            (bill_no,bill_date,customer_name,customer_mobile,total_items,total_qty,net_amount,customer_id)
            VALUES ('UNLINKED-MATCH','2024-01-01','Old Snapshot','9876543210',1,1,999,NULL)`);
        assert(historicUnlinked.lastID);
        await run(db, `INSERT INTO bills
            (bill_no,bill_date,customer_name,customer_mobile,total_items,total_qty,net_amount,customer_id)
            VALUES ('LINKED-OLD','2025-02-01','Sale Snapshot A','9876543210',2,3,100,?),
                   ('LINKED-NEW','2026-03-04','Sale Snapshot A','9876543210',1,1,250,?),
                   ('LINKED-B','2026-02-10','Sale Snapshot B','9876543210',1,1,500,?)`,
        [first.id, first.id, second.id]);

        const zeroSummary = await customers.getCustomerManagementProfile(nameOnly.id);
        assert.deepStrictEqual([
            zeroSummary.total_bills, zeroSummary.total_spend, zeroSummary.average_bill, zeroSummary.last_visit
        ], [0, 0, 0, null], "profile without linked bills has zero/empty summary");
        const summary = await customers.getCustomerManagementProfile(first.id);
        assert.strictEqual(summary.total_bills, 2);
        assert.strictEqual(summary.total_spend, 350);
        assert.strictEqual(summary.average_bill, 175);
        assert.strictEqual(summary.last_visit, "2026-03-04");
        const oneBillSummary = await customers.getCustomerManagementProfile(second.id);
        assert.deepStrictEqual([
            oneBillSummary.total_bills, oneBillSummary.total_spend,
            oneBillSummary.average_bill, oneBillSummary.last_visit
        ], [1, 500, 500, "2026-02-10"], "single linked bill summary uses final net amount");
        const history = await customers.getCustomerPurchaseHistory(first.id);
        assert.deepStrictEqual(history.map(bill => bill.bill_no), ["LINKED-NEW", "LINKED-OLD"], "history is linked-only and newest first");
        assert(!history.some(bill => bill.bill_no === "UNLINKED-MATCH"), "matching historical mobile does not imply ownership");

        await customers.updateCustomerProfile(first.id, {
            name: "Edited Current Name", mobile: "", birthday_ddmm: "31/05",
            marriage_anniversary_ddmm: "", email: "store@kairaluxe.in", notes: "Updated"
        });
        assert.strictEqual((await customers.getCustomerProfile(first.id)).mobile, null, "edit can clear an optional mobile");
        const snapshots = await get(db, "SELECT customer_name, customer_mobile FROM bills WHERE bill_no='LINKED-NEW'");
        assert.deepStrictEqual(snapshots, { customer_name: "Sale Snapshot A", customer_mobile: "9876543210" }, "profile edit does not rewrite bill snapshots");
        assert.strictEqual((await customers.getCustomerPurchaseHistory(first.id)).length, 2, "profile edit retains customer_id-linked history");
        assert.strictEqual((await customers.getCustomerProfile(first.id)).customer_code, "KLCUS000002", "profile editing does not alter Customer ID");

        const zeroPage = await customers.getCustomerPurchaseHistoryPage(nameOnly.id, { page: 9, pageSize: 100 });
        assert.deepStrictEqual([zeroPage.rows.length, zeroPage.totalCount, zeroPage.page, zeroPage.totalPages], [0, 0, 1, 1], "zero linked bills return one empty page");
        const exactlyHundred = await customers.createCustomerProfile({ name: "Exactly 100 bills" });
        for (let i = 0; i < 100; i += 1) {
            await run(db, `INSERT INTO bills (bill_no,bill_date,customer_name,customer_mobile,total_items,total_qty,net_amount,customer_id)
                VALUES (?, '2026-10-01', 'Snapshot', '9876543210', 1, 1, 10, ?)`, [`EXACT-${i}`, exactlyHundred.id]);
        }
        const exactlyHundredPage = await customers.getCustomerPurchaseHistoryPage(exactlyHundred.id, { page: 1, pageSize: 100 });
        assert.deepStrictEqual([exactlyHundredPage.totalCount, exactlyHundredPage.rows.length, exactlyHundredPage.totalPages], [100, 100, 1], "exactly 100 linked bills fit one page");
        const lessThanHundredPage = await customers.getCustomerPurchaseHistoryPage(second.id, { page: 1, pageSize: 100 });
        assert.deepStrictEqual([lessThanHundredPage.totalCount, lessThanHundredPage.rows.length, lessThanHundredPage.totalPages], [1, 1, 1], "fewer than 100 linked bills fit one page");
        for (let i = 0; i < 205; i += 1) {
            await run(db, `INSERT INTO bills (bill_no,bill_date,customer_name,customer_mobile,total_items,total_qty,net_amount,customer_id)
                VALUES (?, '2026-10-02', 'Snapshot', '9876543210', 1, 1, 10, ?)`, [`MANY-${String(i).padStart(3, "0")}`, first.id]);
        }
        const firstPurchasePage = await customers.getCustomerPurchaseHistoryPage(first.id, { page: 1, pageSize: 100 });
        const secondPurchasePage = await customers.getCustomerPurchaseHistoryPage(first.id, { page: 2, pageSize: 100 });
        const thirdPurchasePage = await customers.getCustomerPurchaseHistoryPage(first.id, { page: 99, pageSize: 100 });
        assert.deepStrictEqual([firstPurchasePage.totalCount, firstPurchasePage.totalPages, firstPurchasePage.rows.length], [207, 3, 100]);
        assert.deepStrictEqual([secondPurchasePage.rows.length, thirdPurchasePage.page, thirdPurchasePage.rows.length], [100, 3, 7]);
        const pagedBills = [...firstPurchasePage.rows, ...secondPurchasePage.rows, ...thirdPurchasePage.rows];
        assert.strictEqual(new Set(pagedBills.map(bill => bill.id)).size, 207, "purchase pages contain no duplicated/missing linked bills");
        assert(firstPurchasePage.rows[0].id > firstPurchasePage.rows[1].id, "same-date bill history uses deterministic descending ID tie-breaker");
        assert(!pagedBills.some(bill => bill.bill_no === "UNLINKED-MATCH"), "matching unlinked mobile snapshots stay outside purchase pages");

        const fixtureNames = [];
        for (let i = 0; i < 205; i += 1) {
            const name = `Patnaik Result ${String(i).padStart(3, "0")}`;
            fixtureNames.push(name);
            await customers.createCustomerProfile({ name, mobile: `8${String(i).padStart(9, "0")}` });
        }
        for (let i = 0; i < 100; i += 1) {
            await customers.createCustomerProfile({ name: `ExactlyOnePage ${String(i).padStart(3, "0")}`, mobile: `7${String(i).padStart(9, "0")}` });
        }
        const sharedPageIds = [];
        for (let i = 0; i < 101; i += 1) {
            const profile = await customers.createCustomerProfile({ name: `Shared Search ${String(i).padStart(3, "0")}`, mobile: "9000000001" });
            sharedPageIds.push(profile.id);
        }

        const shortSearch = await customers.listCustomerDirectory({ search: "Edited Current Name" });
        assert.deepStrictEqual([shortSearch.totalCount, shortSearch.rows.length, shortSearch.page, shortSearch.totalPages], [1, 1, 1, 1], "fewer-than-one-page search result");
        const onePage = await customers.listCustomerDirectory({ search: "ExactlyOnePage", page: 1, pageSize: 100 });
        assert.deepStrictEqual([onePage.totalCount, onePage.rows.length, onePage.page, onePage.totalPages], [100, 100, 1, 1], "exactly one page of results");

        const patnaikPage1 = await customers.listCustomerDirectory({ search: "  PATNAIK  ", page: 1, pageSize: 100 });
        const patnaikPage2 = await customers.listCustomerDirectory({ search: "patnaik", page: 2, pageSize: 100 });
        const patnaikPage3 = await customers.listCustomerDirectory({ search: "patnaik", page: 3, pageSize: 100 });
        assert.deepStrictEqual([patnaikPage1.totalCount, patnaikPage1.totalPages, patnaikPage1.rows.length], [205, 3, 100], "search and count happen before pagination");
        assert.deepStrictEqual([patnaikPage2.rows.length, patnaikPage3.rows.length], [100, 5]);
        assert.strictEqual(patnaikPage1.rows[0].name, fixtureNames[0], "ordering is deterministic by name and id");
        const allPatnaik = [...patnaikPage1.rows, ...patnaikPage2.rows, ...patnaikPage3.rows];
        assert.strictEqual(new Set(allPatnaik.map(row => row.id)).size, 205, "adjacent pages have no duplicate customers");
        assert.deepStrictEqual(allPatnaik.map(row => row.name), fixtureNames, "pages contain every matching customer in deterministic order");
        const clampedPage = await customers.listCustomerDirectory({ search: "patnaik", page: 9, pageSize: 100 });
        assert.deepStrictEqual([clampedPage.page, clampedPage.rows.length], [3, 5], "out-of-range page clamps to last page");
        const sharedPage1 = await customers.listCustomerDirectory({ search: "9000000001", page: 1, pageSize: 100 });
        const sharedPage2 = await customers.listCustomerDirectory({ search: "9000000001", page: 2, pageSize: 100 });
        assert.deepStrictEqual([sharedPage1.totalCount, sharedPage1.rows.length, sharedPage2.rows.length], [101, 100, 1], "shared mobile matches span database pages");
        assert.deepStrictEqual([...sharedPage1.rows, ...sharedPage2.rows].map(row => row.id), sharedPageIds, "all shared-mobile profiles remain independent across pages");

        await run(db, `INSERT INTO customers (customer_code, name, active, created_at, updated_at)
            VALUES ('KLCUS999999', 'Sequence Exhaustion Fixture', 1, '2026-01-01', '2026-01-01')`);
        await assert.rejects(
            customers.createCustomerProfile({ name: "After Exhaustion" }),
            /sequence exhausted/i,
            "six-digit Customer ID allocation fails safely without wrapping"
        );

        const root = path.join(__dirname, "..");
        const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
        const management = fs.readFileSync(path.join(root, "src/renderer/modules/customerManagement.js"), "utf8");
        const customerServiceSource = fs.readFileSync(path.join(root, "src/database/customerService.js"), "utf8");
        const profileUi = fs.readFileSync(path.join(root, "src/renderer/modules/customerProfile.js"), "utf8");
        const app = fs.readFileSync(path.join(root, "src/renderer/app.js"), "utf8");
        const shortcuts = fs.readFileSync(path.join(root, "src/renderer/modules/shortcuts.js"), "utf8");
        const preload = fs.readFileSync(path.join(root, "src/main/preload.js"), "utf8");
        const main = fs.readFileSync(path.join(root, "src/main/main.js"), "utf8");
        const businessCss = fs.readFileSync(path.join(root, "src/renderer/styles/business.css"), "utf8");
        const billingCss = fs.readFileSync(path.join(root, "src/renderer/styles/billing.css"), "utf8");
        assert(html.includes("Customer directory and purchase history"));
        assert(html.includes("customerDirectorySearch") && html.includes("customerDirectoryAdd"));
        assert(!html.includes("Search customers by name, mobile or Customer ID</span>"), "redundant search label is removed from the rendered toolbar");
        assert.match(html, /id="customerDirectorySearch" type="search" aria-label="Search customers by name, mobile or Customer ID" placeholder="Search by name, mobile or Customer ID"/, "the existing placeholder is preserved exactly");
        assert(!html.includes("customer-search-label"), "no visible Customer Directory search label or reserved label styling remains");
        assert(html.includes("customerManagementProfile") && html.includes("customerPurchaseRows"));
        assert(!html.includes("Customer tools will be available here."), "placeholder shell is removed");
        assert(html.includes('src="modules/customerProfile.js"></script>') && html.includes('src="modules/customerManagement.js"></script>'));
        const directoryTableMarkup = html.match(/<table id="customerDirectoryTable"[\s\S]*?<\/thead>/)?.[0] || "";
        const directoryHeaders = [...directoryTableMarkup.matchAll(/<th>(.*?)<\/th>/g)].map(match => match[1]);
        assert.deepStrictEqual(directoryHeaders, ["CUSTOMER ID", "CUSTOMER", "MOBILE", "BILLS", "TOTAL SPEND", "LAST VISIT", "ACTION"], "directory columns use the locked order");
        assert.match(html, /id="customerDirectoryTableWrap" class="customer-directory-table-wrap table-container"/);
        assert.match(html, /id="customerDirectoryTable" class="customer-directory-table"/);
        assert.match(businessCss, /#customerDirectoryTableWrap th:nth-child\(1\)[\s\S]*?#customerDirectoryTableWrap td:nth-child\(7\)/, "customer-only column sizing is scoped to the directory");
        assert.match(billingCss, /\.table-container thead th[\s\S]*?background:\s*var\(--primary\)[\s\S]*?color:\s*#fff/);
        assert.match(billingCss, /\.table-container tbody tr:nth-child\(even\)[\s\S]*?background:#f8f8f8/);
        assert.match(businessCss, /#customerDirectoryTableWrap th:nth-child\(1\)[\s\S]*?#customerDirectoryTableWrap td:nth-child\(7\)/, "Customer-specific widths are scoped separately from shared Bill History table treatment");
        const billHistoryTableMarkup = html.match(/<table id="historyTable">[\s\S]*?<\/table>/)?.[0] || "";
        assert(billHistoryTableMarkup.includes("<th>Category</th>") && billHistoryTableMarkup.includes("<th>Bill No</th>") && billHistoryTableMarkup.includes("<th>Print</th>"), "legacy Bill History table markup remains present");
        assert(!/Delete Customer|Deactivate Customer|Reactivate Customer|Active\/Inactive/i.test(html), "no customer lifecycle controls were introduced");
        assert.match(management, /window\.electronAPI\.listCustomerDirectory\(\{[\s\S]*?search: directorySearch,[\s\S]*?page: Number\.isFinite\(requestedPage\)[\s\S]*?pageSize: CUSTOMER_DIRECTORY_PAGE_SIZE/);
        assert.match(management, /const CUSTOMER_DIRECTORY_PAGE_SIZE = 100/);
        assert.match(management, /directoryPage = 1;[\s\S]*?setTimeout\(\(\) => loadDirectory\([\s\S]*?page: 1/);
        assert.match(management, /function setDirectoryPresentation\([\s\S]*?customerDirectoryEmpty[\s\S]*?customerDirectoryNoResults[\s\S]*?customerDirectoryTableWrap[\s\S]*?customerDirectoryPagination/);
        assert.match(management, /customerDirectoryEmpty"\)\.hidden = loading \|\| error \|\| hasSearch \|\| hasRows/);
        assert.match(management, /customerDirectoryNoResults"\)\.hidden = loading \|\| error \|\| !hasSearch \|\| hasRows/);
        assert.match(management, /customerDirectoryTableWrap"\)\.hidden = loading \|\| error \|\| !hasRows/);
        assert.match(management, /customerDirectoryPagination"\)\.hidden = loading \|\| error \|\| !hasRows/);
        assert.match(businessCss, /#customersScreen \[hidden\]\s*\{\s*display:\s*none !important/);
        assert.match(management, /Page \$\{directoryPage[\s\S]*?of \$\{directoryTotalPages/);
        assert.match(management, /Showing \$\{first[\s\S]*?of \$\{directoryTotalCount[\s\S]*?customers/);
        assert.match(management, /previous\.disabled = directoryPage <= 1/);
        assert.match(management, /next\.disabled = directoryPage >= directoryTotalPages/);
        assert.match(customerServiceSource, /async function listCustomerDirectory\(options = \{\}\)[\s\S]*?SELECT COUNT\(\*\) AS total_count FROM customers c \$\{where\}[\s\S]*?LEFT JOIN bills b ON b\.customer_id = c\.id[\s\S]*?GROUP BY c\.id[\s\S]*?ORDER BY c\.name COLLATE NOCASE, c\.id[\s\S]*?LIMIT \? OFFSET \?/);
        assert.match(customerServiceSource, /LOWER\(COALESCE\(c\.customer_code, ''\)\) LIKE \?/);
        assert.match(customerServiceSource, /totalPages = Math\.max\(1, Math\.ceil\(totalCount \/ pageSize\)\)/);
        assert.match(customerServiceSource, /async function getCustomerPurchaseHistoryPage\(id, options = \{\}\)[\s\S]*?COUNT\(\*\) AS total_count FROM bills WHERE customer_id = \?[\s\S]*?ORDER BY bill_date DESC, id DESC[\s\S]*?LIMIT \? OFFSET \?/);
        assert.match(customerServiceSource, /async function createCustomerProfileWithCode/);
        assert.match(customerServiceSource, /KLCUS' \|\| printf\('%06d'/);
        assert.match(management, /getCustomerManagementProfile\(activeCustomerId\)/);
        assert.match(management, /getCustomerPurchaseHistoryPage\(activeCustomerId,[\s\S]*?page: 1,[\s\S]*?pageSize: CUSTOMER_PURCHASE_PAGE_SIZE/);
        assert.match(management, /window\.openCustomerDetailsForManagement\(profile/);
        assert.match(profileUi, /window\.openCustomerDetailsForManagement =/);
        assert.strictEqual((html.match(/id="customerProfileModal"/g) || []).length, 1, "Customer Management reuses the single authoritative Customer Details modal");
        const modalAncestors = getElementAncestors(html, "customerProfileModal");
        assert(!modalAncestors.includes("newBillScreen"), "shared Customer Details overlay is not trapped inside the hidden New Bill screen");
        assert.match(preload, /listCustomerDirectory:/);
        assert.match(preload, /getCustomerManagementProfile:/);
        assert.match(preload, /getCustomerPurchaseHistoryPage:/);
        assert.match(main, /customers:list-directory/);
        assert.match(main, /customers:get-management-profile/);
        assert.match(main, /customers:purchase-history-page/);
        assert.match(app, /billDetailsReturnContext\?\.type === "customer-profile"[\s\S]*?restoreCustomerProfileContext/);
        assert.match(management, /window\.viewBill\(bill\.bill_no,\s*\{[\s\S]*?type: "customer-profile"/);
        assert.match(management, /showDirectory\(\{[\s\S]*?context: RETURN_TO_CUSTOMER_DIRECTORY,[\s\S]*?restoreScroll: true/);
        assert.match(management, /context: FRESH_CUSTOMER_DIRECTORY_ENTRY/);
        assert.match(management, /getCustomerPurchaseHistoryPage\(customerId,[\s\S]*?page: requestedPage,[\s\S]*?pageSize: CUSTOMER_PURCHASE_PAGE_SIZE/);
        assert.match(management, /directoryScrollTop/);
        assert.match(shortcuts, /customerManagementProfile[\s\S]*?customerProfileBackToDirectory/);
        assert.match(app, /billHistoryScreen\.style\.display = "block";\s*resetScrollPosition\(\);/);

        await qualifyRendererDirectoryStates();

        process.stdout.write("V21-03B Customer Management search, database pagination, renderer states, shared-modal Add/Cancel/Save/Escape runtime wiring, linked summaries, history and navigation: PASS\n");
    } finally {
        await close(db);
        delete require.cache[require.resolve("../src/database/customerService")];
        delete require.cache[require.resolve("../src/database/database")];
    }
}

function getElementAncestors(markup, targetId) {
    const stack = [];
    const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
    const tokens = markup.matchAll(/<!--[\s\S]*?-->|<\/?([a-z][a-z0-9-]*)([^>]*)>/gi);
    for (const token of tokens) {
        if (!token[1]) continue;
        const tag = token[1].toLowerCase();
        const attributes = token[2] || "";
        if (token[0].startsWith("</")) {
            const index = stack.map(entry => entry.tag).lastIndexOf(tag);
            if (index >= 0) stack.length = index;
            continue;
        }
        const id = attributes.match(/\bid=["']([^"']+)["']/i)?.[1] || "";
        if (id === targetId) return stack.map(entry => entry.id).filter(Boolean);
        if (!voidTags.has(tag) && !/\/\s*>$/.test(token[0])) stack.push({ tag, id });
    }
    return [];
}

main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
