const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const inventorySource = fs.readFileSync(
    path.join(__dirname, "../src/renderer/modules/inventory.js"),
    "utf8"
);

function createElement(id) {
    return {
        id,
        style: {},
        value: "",
        textContent: "",
        innerHTML: "",
        disabled: false,
        max: "",
        onclick: null,
        listeners: {},
        addEventListener(type, listener) {
            this.listeners[type] = listener;
        }
    };
}

async function run() {
    assert(inventorySource.includes('inventoryKeyword = "";'));
    assert(inventorySource.includes("inventoryPage = 1;"));
    assert(!inventorySource.includes("searchBox.value = inventoryKeyword"));

    const elements = new Map();
    let inventorySearch = null;
    const requests = [];

    function getElementById(id) {
        if (!elements.has(id)) elements.set(id, createElement(id));
        return elements.get(id);
    }

    const settingsPageContent = getElementById("settingsPageContent");
    let templateValue = "";
    Object.defineProperty(settingsPageContent, "innerHTML", {
        get: () => templateValue,
        set: value => {
            templateValue = value;
            for (const id of [
                "inventorySearch", "inventoryTableBody", "inventoryTableContainer",
                "inventoryEmptyState", "inventoryPagination", "inventoryPreviousPage",
                "inventoryNextPage", "inventoryPageLabel", "inventoryRangeLabel",
                "inventoryPageJump", "inventoryTotalQuantity", "inventoryProductCount",
                "inventoryBrandCount", "inventorySegmentCount", "inventoryCategoryCount",
                "inventorySeasonCount", "inventoryCollectionCount", "inventoryLatestSku",
                "lastImportFile", "lastImportDate", "lastImportCount"
            ]) {
                elements.set(id, createElement(id));
            }
            inventorySearch = elements.get("inventorySearch");
        }
    });

    const context = {
        console,
        setTimeout,
        clearTimeout,
        window: {
            productMasterTemplate: "<inventory-template>",
            electronAPI: {
                getInventorySummary: async () => ({
                    total_inventory: 0,
                    products: 0,
                    brands: 0,
                    segments: 0,
                    categories: 0,
                    seasons: 0,
                    collections: 0,
                    latest_sku: null
                }),
                getLastImport: async () => null,
                getProducts: async options => {
                    requests.push({ ...options });
                    return {
                        products: [],
                        totalCount: options.keyword ? 1 : 0,
                        page: options.page,
                        pageSize: options.pageSize,
                        totalPages: options.keyword ? 1 : 1
                    };
                }
            }
        },
        document: {
            getElementById
        },
        setSettingsPageBackToSettings: () => {},
        globalThis: null
    };
    context.globalThis = context;

    vm.runInNewContext(inventorySource, context, {
        filename: "inventory.js"
    });

    await context.window.showInventory();
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(inventorySearch.value, "");
    assert.deepStrictEqual(requests.at(-1), {
        page: 1,
        pageSize: 100,
        keyword: ""
    });

    const activeSearchHandler = inventorySearch.listeners.input;
    assert(activeSearchHandler, "Inventory search input handler is present");
    inventorySearch.value = "987654321";
    activeSearchHandler({ target: { value: "987654321" } });
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(inventorySearch.value, "987654321");
    assert.strictEqual(requests.at(-1).keyword, "987654321");
    assert.strictEqual(requests.at(-1).page, 1);

    await context.window.showInventory();
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(inventorySearch.value, "");
    assert.deepStrictEqual(requests.at(-1), {
        page: 1,
        pageSize: 100,
        keyword: ""
    });

    const secondSearchHandler = inventorySearch.listeners.input;
    inventorySearch.value = "SECOND-SKU";
    secondSearchHandler({ target: { value: "SECOND-SKU" } });
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(requests.at(-1).keyword, "SECOND-SKU");

    await context.window.showInventory();
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(inventorySearch.value, "");
    assert.strictEqual(requests.at(-1).keyword, "");
    assert.strictEqual(requests.at(-1).page, 1);
    assert(!inventorySource.includes("localStorage"));
    assert(!inventorySource.includes("sessionStorage"));

    process.stdout.write("INV-02 Inventory search state reset test: PASS (navigation, active search, pagination, repeat, and no persistence)\n");
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
