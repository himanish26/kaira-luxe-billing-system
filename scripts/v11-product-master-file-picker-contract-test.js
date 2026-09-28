const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const read = relative => fs.readFileSync(path.join(__dirname, "..", relative), "utf8");
const inventorySource = read("src/renderer/modules/inventory.js");
const preloadSource = read("src/main/preload.js");
const mainSource = read("src/main/main.js");
const importSource = read("src/database/importProducts.js");

const inventoryStart = inventorySource.indexOf("async function importProductMaster(grant){");
const inventoryEnd = inventorySource.indexOf("/* ===========================================\n   REFRESH", inventoryStart);
assert(inventoryStart >= 0 && inventoryEnd > inventoryStart, "Product Master import function must be found");
const importFunctionSource = inventorySource.slice(inventoryStart, inventoryEnd);

const pickerStart = mainSource.indexOf("ipcMain.handle(\n    'select-excel-file',");
const pickerEnd = mainSource.indexOf('\nipcMain.handle("startup:get-metadata"', pickerStart);
assert(pickerStart >= 0 && pickerEnd > pickerStart, "Excel picker IPC handler must be found");
const pickerHandlerSource = mainSource.slice(pickerStart, pickerEnd);

async function testPickerContract() {
    let pickerResult = { canceled: false, filePaths: ["/fixture/Product Master.xlsx"] };
    let showOptions;
    const handlers = new Map();
    vm.runInNewContext(pickerHandlerSource, {
        ipcMain: { handle(channel, handler) { handlers.set(channel, handler); } },
        dialog: { async showOpenDialog(options) { showOptions = options; return pickerResult; } }
    });
    const picker = handlers.get("select-excel-file");
    assert.strictEqual(typeof picker, "function");
    assert.strictEqual(picker.length, 0, "picker IPC does not require an attemptId argument");
    assert.strictEqual(await picker({}), "/fixture/Product Master.xlsx");
    assert.deepStrictEqual(Array.from(showOptions.properties), ["openFile"]);
    assert.strictEqual(showOptions.filters[0].name, "Excel Files");
    pickerResult = { canceled: true, filePaths: [] };
    assert.strictEqual(await picker({}), null, "cancelled picker returns null");
}

async function testRendererContract() {
    const importButton = { disabled: false, textContent: "📥 Import Product Master" };
    const alerts = [];
    let selectedPath = null;
    let result = { success: true, imported: 2, skipped: 1, total: 3 };
    const imported = [];
    let refreshCount = 0;
    const context = {
        document: { getElementById(id) {
            if (id === "importBtn") return importButton;
            return { disabled: false, textContent: "" };
        } },
        window: { electronAPI: {
            async selectExcelFile() { return selectedPath; },
            async importProducts(...args) { imported.push(args); return result; }
        } },
        alert(message) { alerts.push(String(message)); },
        async refreshInventory() { refreshCount += 1; }
    };
    vm.createContext(context);
    vm.runInContext(importFunctionSource, context);

    const grant = { token: "existing-product-import-grant" };
    selectedPath = null;
    const alertCountBeforeCancel = alerts.length;
    await context.importProductMaster(grant);
    assert.strictEqual(imported.length, 0, "cancel does not import");
    assert.strictEqual(alerts.length, alertCountBeforeCancel, "cancel does not show an erroneous import failure");
    assert.strictEqual(importButton.disabled, false, "cancel restores button");

    for (const malformed of [{ success: false, error: "wrong IPC contract" }, 42, "", "   "]) {
        selectedPath = malformed;
        await context.importProductMaster(grant);
        assert.strictEqual(imported.length, 0, "malformed picker result does not import");
        assert.strictEqual(importButton.disabled, false, "malformed result restores button");
        assert(alerts.at(-1).includes("invalid file path"), "malformed result shows a safe error");
    }

    selectedPath = "/fixture/Product Master.xlsx";
    await context.importProductMaster(grant);
    assert.deepStrictEqual(imported[0], ["/fixture/Product Master.xlsx", grant]);
    assert.strictEqual(refreshCount, 1);
    assert.strictEqual(importButton.disabled, false, "completed import restores button");

    const filepathValidationIndex = importFunctionSource.indexOf('typeof filePath !== "string"');
    const importCallIndex = importFunctionSource.indexOf("electronAPI.importProducts(filePath, grant)");
    assert(filepathValidationIndex >= 0 && importCallIndex > filepathValidationIndex,
        "filepath validation runs before importProducts");
    assert(importFunctionSource.includes("if (filePath === null)"), "null cancellation returns before import");
}

async function main() {
    await testPickerContract();
    await testRendererContract();

    assert(preloadSource.includes('selectExcelFile: () =>') && preloadSource.includes('ipcRenderer.invoke("select-excel-file")'));
    assert(inventorySource.includes('requireAdminAuthorization("PRODUCT_IMPORT", grant =>'));
    assert(inventorySource.includes("importProductMaster(grant);"));
    assert(mainSource.includes('requireSecurityGrant(grant, "PRODUCT_IMPORT");'));

    const dayClosingStart = mainSource.indexOf('"close-business-day"');
    const attemptValidation = mainSource.indexOf("if (!Number.isSafeInteger(attemptId) || attemptId <= 0)", dayClosingStart);
    assert(dayClosingStart >= 0 && attemptValidation > dayClosingStart,
        "Day Closing attempt validation remains in close-business-day");
    assert(!/Number\.isSafeInteger\(attemptId\)/.test(pickerHandlerSource),
        "generic Excel picker has no Day Closing attempt validation");

    assert(importSource.includes('"variable_value"'), "Product Master Variable Value field remains supported");
    assert(importSource.includes('if (normalized === "YES") return 1;'));
    assert(importSource.includes('if (normalized === "NO") return 0;'));

    const pickerCallers = [
        ...inventorySource.matchAll(/selectExcelFile\s*\(/g),
        ...read("src/renderer/app.js").matchAll(/selectExcelFile\s*\(/g)
    ];
    assert.strictEqual(pickerCallers.length, 2, "one live caller and one pre-existing commented legacy reference were found");

    console.log("Product Master file-picker IPC contract regression tests: PASS");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
