"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "src/renderer/app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "src/renderer/styles/billing.css"), "utf8");

const updater = app.match(/function updateProceedToPaymentState\(\) \{[\s\S]*?\n\}/)?.[0];
assert(updater, "one central Proceed to Payment updater exists");

const paymentBtn = { disabled: false };
const state = { paymentBtn, cartProductValidationBlocked: false, billItems: [] };
vm.runInNewContext(`${updater}; updateProceedToPaymentState();`, state);
assert.strictEqual(paymentBtn.disabled, true, "empty cart is disabled at fresh initialization");

state.billItems.push({ barcode: "SALE-1", qty: 1 });
vm.runInNewContext(`${updater}; updateProceedToPaymentState();`, state);
assert.strictEqual(paymentBtn.disabled, false, "first payable sale item enables the button");
state.billItems.push({ barcode: "SALE-2", qty: 1 });
vm.runInNewContext(`${updater}; updateProceedToPaymentState();`, state);
assert.strictEqual(paymentBtn.disabled, false, "multiple items remain enabled");
state.billItems.splice(0, 1);
vm.runInNewContext(`${updater}; updateProceedToPaymentState();`, state);
assert.strictEqual(paymentBtn.disabled, false, "removing one of multiple items remains enabled");
state.billItems.splice(0, 1);
vm.runInNewContext(`${updater}; updateProceedToPaymentState();`, state);
assert.strictEqual(paymentBtn.disabled, true, "removing the last item disables the button");

state.billItems.push({ barcode: "VVP-1", qty: 1, variable_value: 1 });
vm.runInNewContext(`${updater}; updateProceedToPaymentState();`, state);
assert.strictEqual(paymentBtn.disabled, false, "successful VVP item state enables the button");
state.billItems = [];
vm.runInNewContext(`${updater}; updateProceedToPaymentState();`, state);
assert.strictEqual(paymentBtn.disabled, true, "VVP cancel/failure with an empty cart remains disabled");

state.billItems = [{ barcode: "RETURN-1", qty: 0, original_qty: 1 }];
vm.runInNewContext(`${updater}; updateProceedToPaymentState();`, state);
assert.strictEqual(paymentBtn.disabled, false, "RETURN mode retains existing loaded-item button semantics");
state.billItems = [];
state.cartProductValidationBlocked = true;
vm.runInNewContext(`${updater}; updateProceedToPaymentState();`, state);
assert.strictEqual(paymentBtn.disabled, true, "Product Master validation can still block payment with cart rows");

assert.match(app, /function setCartProductValidationBlocked\(blocked\) \{\s*cartProductValidationBlocked = Boolean\(blocked\);\s*updateProceedToPaymentState\(\);/, "cart validation changes flow through the central updater");
const renderBill = app.slice(app.indexOf("function renderBill(){"), app.indexOf("function clearCurrentBill(){"));
assert.match(renderBill, /updateSummary\(\);\s*updateProceedToPaymentState\(\);/);
const addProduct = app.slice(app.indexOf("function addProductToBill(product) {"), app.indexOf("function renderBill(){"));
assert.match(addProduct, /renderBill\(\);/);
const variableProductStart = app.indexOf("function applyVariableValueEntry(");
assert(variableProductStart >= 0, "VVP successful-add function exists");
assert.match(app.slice(variableProductStart, app.indexOf("function addProductToBill(product) {")), /renderBill\(\);/);
const removeItem = app.slice(app.indexOf("function removeItem(index){"), app.indexOf("function updateDiscount(index, value){"));
assert.match(removeItem, /billItems\.splice\(index,1\);\s*renderBill\(\);/);
const resetBill = app.slice(app.indexOf("function clearCurrentBill(){"), app.indexOf("window.abandonNewBillSession = clearCurrentBill;"));
assert.match(resetBill, /billItems = \[\];[\s\S]*?renderBill\(\);/);
assert.match(app, /billItems\.length === 0\)[\s\S]*?alert\("Please select at least one product before proceeding\."\)[\s\S]*?return;/, "defense-in-depth empty-cart guard remains in the payment click handler");
assert.match(app, /if \(!returnReason\) \{\s*updateProceedToPaymentState\(\);/);
assert.match(app, /if \(!proceed\) \{\s*updateProceedToPaymentState\(\);/);
assert.match(app, /finally \{\s*updateProceedToPaymentState\(\);/);
assert(!/paymentBtn\.disabled = false/.test(app), "payment cancellation/completion cannot override an empty-cart state");
assert.match(html, /<button id="paymentBtn" class="payment-btn">/);
assert.match(css, /#paymentBtn:disabled,[\s\S]*?#paymentBtn:disabled:hover,[\s\S]*?background-color: #c7cbd1 !important;[\s\S]*?color: #68707a !important;[\s\S]*?cursor: not-allowed !important;/, "disabled payment state uses the established grey KLBS disabled-button treatment");

process.stdout.write("V21-03B Proceed to Payment authoritative state and empty-cart guard: PASS\n");
