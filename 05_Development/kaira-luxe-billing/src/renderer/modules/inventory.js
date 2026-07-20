console.log("Inventory Module Loaded");

/* ===========================================
   OPEN PRODUCT MASTER
=========================================== */

function showInventory() {

    console.log("Opening Product Master...");

    const settingsScreen =
        document.getElementById("settingsScreen");

    const settingsPage =
        document.getElementById("settingsPage");

    const settingsPageContent =
        document.getElementById("settingsPageContent");

    settingsScreen.style.display = "none";

    settingsPage.style.display = "block";

    settingsPageContent.innerHTML =
        window.productMasterTemplate;

    initializeInventoryEvents();

    loadInventorySummary();

    loadLastImport();

    loadProducts();

}

window.showInventory = showInventory;

/* ===========================================
   LAST IMPORT
=========================================== */

async function loadLastImport() {
    try {
        const info =
            await window.electronAPI.getLastImport();

        const file = document.getElementById("lastImportFile");
        const date = document.getElementById("lastImportDate");
        const count = document.getElementById("lastImportCount");

        if (!file || !date || !count) return;

        if (!info) {
            file.textContent = "";
            date.textContent = "";
            count.textContent = "";
            return;
        }

        file.textContent = info.file_name;
        date.textContent = info.imported_on;
        count.textContent = info.products_imported;
    } catch (err) {
        console.error(err);
    }
}


/* ===========================================
   PRODUCT MASTER SUMMARY
=========================================== */

async function loadInventorySummary() {

    const summary =
        await window.electronAPI.getInventorySummary();

    document.getElementById("inventoryProductCount").textContent =
        summary.products;

    document.getElementById("inventoryBrandCount").textContent =
        summary.brands;

    document.getElementById("inventoryCategoryCount").textContent =
        summary.categories;

}


/* ===========================================
   LOAD PRODUCTS
=========================================== */

async function loadProducts() {

    const products =
        await window.electronAPI.getProducts();

    const tbody =
        document.getElementById("inventoryTableBody");

    const tableContainer =
        document.getElementById("inventoryTableContainer");

    const emptyState =
        document.getElementById("inventoryEmptyState");

    tbody.innerHTML = "";

    if (products.length === 0) {

        tableContainer.style.display = "none";

        emptyState.style.display = "flex";

        return;

    }

    tableContainer.style.display = "block";

    emptyState.style.display = "none";

    products.forEach(product => {

        tbody.innerHTML += `
            <tr>
                <td>${product.barcode}</td>
                <td>${product.product_name}</td>
                <td>${product.brand}</td>
                <td>${product.category}</td>
                <td>${product.size}</td>
                <td>₹${Number(product.mrp).toFixed(2)}</td>
            </tr>
        `;

    });

}

function showInventoryResetSuccess() {

    showSuccessDialog(
        "Inventory Reset Successful",
        `The Product Master has been reset successfully.

Please import a Product Master Excel file before creating new billing.`
    );

}

/* ===========================================
   SEARCH PRODUCTS
=========================================== */

async function searchProducts(keyword) {

    const products =
        await window.electronAPI.searchProducts(keyword);

    const tbody =
        document.getElementById("inventoryTableBody");

    const tableContainer =
        document.getElementById("inventoryTableContainer");

    const emptyState =
        document.getElementById("inventoryEmptyState");

    tbody.innerHTML = "";

    if (products.length === 0) {

        tableContainer.style.display = "none";
        emptyState.style.display = "flex";
        return;

    }

    tableContainer.style.display = "block";
    emptyState.style.display = "none";

    products.forEach(product => {

        tbody.innerHTML += `
            <tr>
                <td>${product.barcode}</td>
                <td>${product.product_name}</td>
                <td>${product.brand}</td>
                <td>${product.category}</td>
                <td>${product.size}</td>
                <td>₹${Number(product.mrp).toFixed(2)}</td>
            </tr>
        `;

    });

}

/* ===========================================
   IMPORT PRODUCT MASTER
=========================================== */

async function importProductMaster(){

    console.log("Import Product Master");

    const filePath =
        await window.electronAPI.selectExcelFile();

    if(!filePath){
        return;
    }
    
    const result =
        await window.electronAPI.importProducts(filePath);

    console.log(result);

    if(result.success){

        alert(
`Import Completed

New Products : ${result.imported}

Duplicates Skipped : ${result.skipped}

Rows Read : ${result.total}`
);

        refreshInventory();

    }else{

        alert(result.error);

    }

}


/* ===========================================
   REFRESH
=========================================== */

async function refreshInventory(){

    console.log("Refreshing Inventory...");

    await loadInventorySummary();

    await loadLastImport();

    await loadProducts();

    alert(
`Inventory refreshed successfully.

Product summary, last import details and inventory list have been reloaded.`
    );

}


/* ===========================================
   EXPORT
=========================================== */

async function exportInventory(){

    const result =
        await window.electronAPI.exportInventory();

    if(result.success){

        alert(
`Inventory exported successfully.`
        );

    }

}

/* ===========================================
   RESET INVENTORY
=========================================== */

async function startInventoryReset(){

    showProcessingDialog("Resetting Inventory");

    updateProgress(20,"Preparing...");

    const result =
        await window.electronAPI.resetInventory();

    if(result.success){

        updateProgress(100,"Completed");

        await refreshInventory();

        setTimeout(() => {

            hideProcessingDialog();

            alert(
`Inventory Reset Successful

The Product Master has been reset successfully.

Please import a Product Master Excel file before creating new bills.`
);

        }, 500);

    }
    else{

        hideProcessingDialog();

        alert(result.error);

    }

}

/* ===========================================
   BUTTON EVENTS
=========================================== */

function initializeInventoryEvents() {

    const importBtn =
        document.getElementById("importBtn");

    const refreshBtn =
        document.getElementById("refreshInventoryBtn");

    const exportBtn =
        document.getElementById("exportInventoryBtn");

    const resetBtn =
    document.getElementById("resetInventoryBtn");

    const searchBox =
        document.getElementById("inventorySearch");

    if (importBtn)
        importBtn.onclick = importProductMaster;

    if (refreshBtn)
        refreshBtn.onclick = refreshInventory;

    if (exportBtn)
        exportBtn.onclick = exportInventory;

    if (resetBtn)

        resetBtn.onclick = () => {

            requireAdminAuthorization(() => {

                startInventoryReset();
                
            });

        };

    if (searchBox) {

        searchBox.addEventListener("input", (e) => {

            searchProducts(
    e.target.value.trim()
);

        });

    }

}