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

    tbody.innerHTML = "";

    if(products.length===0){

    tbody.innerHTML=`
        <tr>
            <td colspan="6">
                No Products Found
            </td>
        </tr>
    `;

    return;
}

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
   SEARCH PRODUCTS
=========================================== */

async function searchProducts(keyword) {

    const products =
        await window.electronAPI.searchProducts(keyword);

    const tbody =
        document.getElementById("inventoryTableBody");

    tbody.innerHTML = "";

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

async function showResetInventoryWarning(){

    const confirmed = confirm(

`⚠️ RESET INVENTORY

Delete all products from Product Master?

Bills and Settings will NOT be affected.

A backup will be created automatically.

Do you want to continue?`

    );

    if(!confirmed){

        return;

    }

    showResetInventoryConfirmation();

}

function showResetInventoryConfirmation(){

    const text = prompt(

`Type

RESET INVENTORY

to confirm deletion.`

    );

    if(text !== "RESET INVENTORY"){

        alert("Inventory Reset Cancelled.");

        return;

    }

    alert("Ready for Backup & Reset");

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

                showResetInventoryWarning();
                
            });

        };


    resetBtn.onclick = showResetInventoryWarning;

    if (searchBox) {

        searchBox.addEventListener("input", (e) => {

            searchProducts(
    e.target.value.trim()
);

        });

    }

}