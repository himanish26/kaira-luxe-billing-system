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

    document.getElementById("inventorySegmentCount").textContent =
        summary.segments;

    document.getElementById("inventoryCategoryCount").textContent =
        summary.categories;

    document.getElementById("inventorySeasonCount").textContent =
        summary.seasons;

    document.getElementById("inventoryCollectionCount").textContent =
        summary.collections;

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
            <td>${product.brand}</td>
            <td>${product.segment || ""}</td>
            <td>${product.category}</td>
            <td>${product.season || ""}</td>
            <td>${product.collection || ""}</td>
            <td>${product.product_name}</td>
            <td>${product.size}</td>
            <td>${product.current_stock ?? product.opening_stock ?? 0}</td>
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
            <td>${product.brand}</td>
            <td>${product.segment || ""}</td>
            <td>${product.category}</td>
            <td>${product.season || ""}</td>
            <td>${product.collection || ""}</td>
            <td>${product.product_name}</td>
            <td>${product.size}</td>
            <td>${product.current_stock ?? product.opening_stock ?? 0}</td>
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

    const importBtn =
    document.getElementById("importBtn");

    importBtn.disabled = true;

    importBtn.textContent =
        "⏳ Importing...";

    const downloadTemplateBtn =
    document.getElementById("downloadTemplateBtn");

    const filePath =
        await window.electronAPI.selectExcelFile();

    if(!filePath){

    importBtn.disabled = false;

    importBtn.textContent =
        "📥 Import Product Master";

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

    await refreshInventory();

    importBtn.disabled = false;

    importBtn.textContent =
        "📥 Import Product Master";

}else{

    importBtn.disabled = false;

    importBtn.textContent =
        "📥 Import Product Master";

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

    const exportBtn =
        document.getElementById("exportInventoryBtn");

    exportBtn.disabled = true;

    exportBtn.textContent =
        "⏳ Exporting...";

    try{

        const result =
            await window.electronAPI.exportInventory();

        if(result.success){

            alert(
`Inventory exported successfully.`
            );

        }
        else if(result.error){

            alert(result.error);

        }

    }

    finally{

        exportBtn.disabled = false;

        exportBtn.textContent =
            "📤 Export to Excel";

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

    const downloadTemplateBtn =
        document.getElementById("downloadTemplateBtn");

    const refreshBtn =
        document.getElementById("refreshInventoryBtn");

    const exportBtn =
        document.getElementById("exportInventoryBtn");

    const resetBtn =
    document.getElementById("resetInventoryBtn");

    const searchBox =
        document.getElementById("inventorySearch");

    if (importBtn)

    importBtn.onclick = () => {

        requireAdminAuthorization(() => {

            importProductMaster();

        });

    };

    if (downloadTemplateBtn)

    downloadTemplateBtn.onclick = async () => {

        downloadTemplateBtn.disabled = true;

        downloadTemplateBtn.textContent =
            "⏳ Downloading...";

        try {

            const result =
                await window.electronAPI.downloadProductMasterTemplate();

            if (result?.success) {

                alert(
                    "Product Master Template downloaded successfully."
                );

            } else if (result?.error) {

                alert(result.error);

            }

        } catch (err) {

            console.error(err);

            alert(err.message);

        } finally {

            downloadTemplateBtn.disabled = false;

            downloadTemplateBtn.textContent =
                "📄 Download Master Template";

        }

    };

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

    const keyword = e.target.value.trim();

    if (keyword === "") {

        loadProducts();
        return;

    }

    searchProducts(keyword);

});

    }

}