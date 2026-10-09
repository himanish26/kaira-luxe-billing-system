"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
let currentDocument = null;

class FakeElement {
    constructor(id = "") {
        this.id = id;
        this.hidden = false;
        this.disabled = false;
        this.inert = false;
        this.attributes = {};
        this.style = { display: "" };
        this.children = [];
        this.listeners = {};
        this.classes = new Set();
        this.isConnected = true;
        this.classList = {
            add: (...names) => names.forEach(name => this.classes.add(name)),
            remove: (...names) => names.forEach(name => this.classes.delete(name)),
            contains: name => this.classes.has(name)
        };
    }
    append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
    addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
    removeEventListener(type, callback) { this.listeners[type] = (this.listeners[type] || []).filter(item => item !== callback); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    removeAttribute(name) { delete this.attributes[name]; }
    querySelectorAll() { return this.focusables || []; }
    contains(target) { return target === this || this.children.some(child => child.contains(target)); }
    getClientRects() { return this.hidden ? [] : [{}]; }
    focus(options) { this.focusOptions = options; currentDocument.activeElement = this; }
}

async function runtimeContract(source) {
    const documentListeners = {};
    const frames = [];
    const timers = new Map();
    let timerId = 0;
    const document = {
        activeElement: null,
        addEventListener(type, callback, capture) { (documentListeners[type] ||= []).push({ callback, capture }); }
    };
    currentDocument = document;
    const window = {
        setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
        clearTimeout(id) { timers.delete(id); },
        getComputedStyle(node) { return { transform: node.classes.has("klbs-drawer-visible") ? "translateX(0)" : "translateX(100%)" }; }
    };
    const context = { document, window, requestAnimationFrame: callback => frames.push(callback), clearTimeout: id => window.clearTimeout(id), console };
    vm.createContext(context);
    vm.runInContext(source, context, { filename: "klbsDrawer.js" });

    const parent = new FakeElement("page");
    const background = new FakeElement("page-content");
    const root = new FakeElement("drawer-overlay"); root.hidden = true; root.style.display = "none";
    const panel = new FakeElement("drawer-panel");
    const exit = new FakeElement("exit");
    const input = new FakeElement("input");
    panel.append(exit, input); panel.focusables = [exit, input]; root.append(panel); parent.append(background, root);
    const opener = new FakeElement("opener"); opener.isConnected = true; document.activeElement = opener;
    let escapeIntercepts = 0;
    const shell = window.KLBSDrawer.create({
        root, panel, labelledBy: "drawer-title", exitButtons: [exit], initialFocus: () => input,
        onEscape: () => { escapeIntercepts += 1; return false; }
    });
    assert(shell.open({ opener }), "drawer opens");
    assert(root.classList.contains("klbs-drawer-open"), "open state is applied before animation");
    assert.strictEqual(background.inert, true, "background is inert while drawer is open");
    assert.strictEqual(root.getAttribute("aria-modal"), "true");
    assert.strictEqual(root.getAttribute("aria-labelledby"), "drawer-title");
    assert.strictEqual(frames.length, 1, "opening begins on a frame boundary");
    while (frames.length) frames.shift()();
    assert(root.classList.contains("klbs-drawer-visible"), "visible state follows forced offscreen style resolution");
    assert.strictEqual(document.activeElement, input, "initial focus hook receives focus");

    const keyHandler = documentListeners.keydown[0].callback;
    document.activeElement = input;
    let prevented = false;
    keyHandler({ key: "Tab", shiftKey: false, preventDefault() { prevented = true; } });
    assert(prevented, "Tab from final control is contained at the first control");
    assert.strictEqual(document.activeElement, exit);

    let escapePrevented = false, escapeStopped = false;
    keyHandler({ key: "Escape", preventDefault() { escapePrevented = true; }, stopPropagation() { escapeStopped = true; }, stopImmediatePropagation() {} });
    assert(escapePrevented && escapeStopped, "ESC is consumed at the active drawer layer");
    assert.strictEqual(escapeIntercepts, 1, "feature hook gets first chance to handle nested actions");
    assert(shell.isClosing(), "unhandled ESC starts the shared close lifecycle");
    assert(root.classList.contains("klbs-drawer-closing"), "close state is applied centrally");
    shell.open({ opener });
    while (frames.length) frames.shift()();
    assert(shell.isOpen(), "reopening during the close transition cancels the stale close completion");
    assert.strictEqual(background.inert, true, "background remains inert through a close/reopen race");
    shell.close();
    panel.listeners.transitionend.at(-1)({ target: panel, propertyName: "transform" });
    assert(root.hidden, "transition completion hides the overlay");
    assert.strictEqual(background.inert, false, "background inert state is restored");
    assert.strictEqual(document.activeElement, opener, "focus returns to the invoking control");
    assert.strictEqual(shell.isOpen(), false);

    const rootTwo = new FakeElement("second-overlay"); rootTwo.hidden = true;
    const panelTwo = new FakeElement("second-panel"); rootTwo.append(panelTwo); parent.append(rootTwo);
    const second = window.KLBSDrawer.create({ root: rootTwo, panel: panelTwo });
    shell.open({ opener });
    while (frames.length) frames.shift()();
    second.open({ opener });
    assert.strictEqual(shell.isOpen(), false, "opening another drawer ends the first lifecycle");
    assert(root.hidden, "only one drawer shell remains active");
    assert.strictEqual(window.KLBSDrawer.getActive(), second);
    assert.strictEqual(typeof exit.listeners.click?.[0], "function", "EXIT is wired through the shared shell");
}

async function main() {
    const root = path.join(__dirname, "..");
    const component = fs.readFileSync(path.join(root, "src/renderer/components/klbsDrawer.js"), "utf8");
    const css = fs.readFileSync(path.join(root, "src/renderer/styles/klbsDrawer.css"), "utf8");
    const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
    const billing = fs.readFileSync(path.join(root, "src/renderer/modules/customerProfile.js"), "utf8");
    const supplier = fs.readFileSync(path.join(root, "src/renderer/modules/supplierManagement.js"), "utf8");
    const product = fs.readFileSync(path.join(root, "src/renderer/modules/styleExplorer.js"), "utf8");
    const template = fs.readFileSync(path.join(root, "src/renderer/modules/productMasterTemplate.js"), "utf8");
    const shortcuts = fs.readFileSync(path.join(root, "src/renderer/modules/shortcuts.js"), "utf8");

    assert(html.includes("components/klbsDrawer.js"), "universal shell loads before drawer controllers");
    assert.match(css, /width:clamp\(560px,54vw,840px\)/, "standard width is Billing's approved geometry");
    assert.match(css, /top:0; right:0; bottom:0/);
    assert.match(css, /translateX\(100%\)/);
    assert.match(css, /transition:transform 300ms cubic-bezier\(\.22,1,\.36,1\)/);
    assert.match(css, /transition-duration:240ms/);
    assert.match(css, /background:rgba\(38,34,37,\.46\)/);
    assert.match(css, /\.klbs-drawer-exit/);
    assert.match(css, /\.klbs-drawer-footer/);
    assert.match(css, /display:flex;[^}]*flex-direction:column/);
    assert.match(css, /height:100%; min-height:0; max-height:100%/);
    assert.match(css, /flex:0 0 auto/);
    assert.match(css, /flex:1 1 auto; overflow-y:auto; overflow-x:hidden/);
    assert.match(css, /padding:18px 24px 28px/);
    assert.match(css, /prefers-reduced-motion:reduce/);
    assert.match(css, /max-width:1000px/);
    assert.match(component, /requestAnimationFrame/);
    assert.match(component, /focusableSelector/);
    assert.match(component, /node\.inert = true/);
    assert.match(component, /restoreFocus/);
    assert.match(component, /propertyName === "transform"/);
    assert.match(component, /isNestedModalOpen/);

    assert(html.includes('class="modal klbs-drawer-overlay" id="customerProfileModal"'), "Billing keeps its existing Customer form inside the canonical shell");
    assert(billing.includes("window.KLBSDrawer.create") && billing.includes("customerDrawerShell.open") && billing.includes("customerDrawerShell.close()"), "Billing delegates only its drawer lifecycle to the shell");
    assert(html.includes('class="supplier-profile-overlay klbs-drawer-overlay"'));
    assert.match(html, /id="supplierEditorView"[^>]*>[\s\S]*?<header[^>]*klbs-drawer-header[\s\S]*?<div class="supplier-drawer-body klbs-drawer-body">[\s\S]*?<footer class="supplier-drawer-footer klbs-drawer-footer"/);
    assert.match(supplier, /onClosed: \(\) => \{\s*if \(currentView !== "supplierEditorView"\) editorView\.hidden = true;/, "Supplier hides its exiting editor after close animation completes");
    assert(supplier.includes('initialFocus: () => currentView === "supplierEditorView"') && supplier.includes("supplierDrawer.open()"), "Supplier drawer focuses its active feature view when opened");
    assert(supplier.includes("window.KLBSDrawer.create") && supplier.includes("supplierDrawer.open()") && supplier.includes("supplierDrawer.close()"));
    assert(template.includes('class="inventory-style-overlay klbs-drawer-overlay"'));
    assert(product.includes("window.KLBSDrawer.create") && product.includes("drawerShell?.open") && product.includes("drawerShell?.close()"));
    assert(template.includes('class="inventory-style-header klbs-drawer-header"'));
    assert(template.includes("class=\"klbs-drawer-title\">PRODUCT SEARCH"));
    assert(template.includes(">EXIT</button>") && !template.includes("inventoryStyleExplorerSubtitle"));
    assert(!template.includes("SCAN BARCODE") && !template.includes("Scan a barcode to find available sizes and colours"));
    assert(template.includes("placeholder=\"Scan barcode or enter Style Code\""));
    assert(shortcuts.includes("KLBSDrawer?.hasOpenDrawer?.()"), "global shortcuts recognize drawers generically");
    assert.match(html, /id="customerDrawerFooter" class="klbs-drawer-footer" hidden/);
    assert(billing.includes('document.body?.append(drawer)'), "shared Customer shell is outside hidden feature screens");
    assert(billing.includes('background: () => [...(drawerContext === "management" && customersScreen ? customersScreen.children : newBillScreen.children)]'), "active Customer workflow alone is made inert");
    assert(billing.includes('function showManagementModal(profile = null)') && billing.includes('openDrawer("form", byId("customerProfileTitle").textContent, focus)'), "Customers page Add/Edit uses the universal drawer lifecycle");
    assert(billing.includes('drawerFooter.append(drawerActions)') && billing.includes('drawerActionsHome.insertBefore(drawerActions, drawerActionsNextSibling)'), "Customer actions move into a fixed management footer and return to the Billing form");

    await runtimeContract(component);
    process.stdout.write("V21 Universal KLBS Drawer shell, Billing golden reference, Supplier and Product Search migration: PASS\n");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
