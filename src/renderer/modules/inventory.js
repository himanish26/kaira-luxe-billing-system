let inventoryProductsRequestId = 0;
const INVENTORY_PAGE_SIZE = 100;
let inventoryPage = 1;
let inventoryKeyword = "";
let inventoryTotalCount = 0;
let inventoryTotalPages = 1;

/* ===========================================
   OPEN PRODUCT MASTER
=========================================== */

function showInventory() {

    discardStockAuthorization();

    const settingsScreen =
        document.getElementById("settingsScreen");

    const settingsPage =
        document.getElementById("settingsPage");

    const settingsPageContent =
        document.getElementById("settingsPageContent");

    settingsScreen.style.display = "none";

    settingsPage.style.display = "block";

    setSettingsPageBackToSettings();

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

    document.getElementById("inventoryTotalQuantity").textContent =
        Number(summary.total_inventory || 0).toLocaleString("en-IN");

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

    const requestId =
        ++inventoryProductsRequestId;

    const result =
        await window.electronAPI.getProducts({
            page: inventoryPage,
            pageSize: INVENTORY_PAGE_SIZE,
            keyword: inventoryKeyword
        });

    if (requestId !== inventoryProductsRequestId) {
        return;
    }

    inventoryPage = result.page;
    inventoryTotalCount = result.totalCount;
    inventoryTotalPages = result.totalPages;
    renderInventoryProducts(result.products);
    updateInventoryPagination();

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

    inventoryKeyword = keyword;
    inventoryPage = 1;
    await loadProducts();

}

function updateInventoryPagination() {

    const pagination = document.getElementById("inventoryPagination");
    const previous = document.getElementById("inventoryPreviousPage");
    const next = document.getElementById("inventoryNextPage");
    const pageLabel = document.getElementById("inventoryPageLabel");
    const rangeLabel = document.getElementById("inventoryRangeLabel");
    const pageJumpInput = document.getElementById("inventoryPageJump");

    if (!pagination || !previous || !next || !pageLabel || !rangeLabel) {
        return;
    }

    const first = inventoryTotalCount === 0
        ? 0
        : ((inventoryPage - 1) * INVENTORY_PAGE_SIZE) + 1;
    const last = Math.min(
        inventoryPage * INVENTORY_PAGE_SIZE,
        inventoryTotalCount
    );

    pagination.style.display = inventoryTotalCount === 0
        ? "none"
        : "flex";
    previous.disabled = inventoryPage <= 1;
    next.disabled = inventoryPage >= inventoryTotalPages;
    pageLabel.textContent =
        `Page ${inventoryPage.toLocaleString("en-US")} of ${inventoryTotalPages.toLocaleString("en-US")}`;
    if (pageJumpInput) {
        pageJumpInput.value = String(inventoryPage);
        pageJumpInput.max = String(inventoryTotalPages);
    }
    rangeLabel.textContent =
        `Showing ${first.toLocaleString("en-US")}\u2013${last.toLocaleString("en-US")} of ${inventoryTotalCount.toLocaleString("en-US")} products`;

}

async function goToInventoryPage(page) {

    const targetPage = Number.parseInt(page, 10);

    if (!Number.isFinite(targetPage)) {
        return;
    }

    inventoryPage = Math.min(
        Math.max(targetPage, 1),
        inventoryTotalPages
    );
    await loadProducts();

}

function handleInventoryPageJump() {

    const pageJumpInput =
        document.getElementById("inventoryPageJump");
    const rawValue = pageJumpInput?.value.trim() || "";

    if (!/^\d+$/.test(rawValue)) {
        if (pageJumpInput) pageJumpInput.value = String(inventoryPage);
        return;
    }

    const targetPage = Number(rawValue);

    if (
        !Number.isSafeInteger(targetPage) ||
        targetPage < 1 ||
        targetPage > inventoryTotalPages
    ) {
        if (pageJumpInput) pageJumpInput.value = String(inventoryPage);
        return;
    }

    goToInventoryPage(targetPage);

}

/* ===========================================
   RENDER AUTHORITATIVE PRODUCT/STOCK PAIRS
=========================================== */

function renderInventoryProducts(products) {

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

    tbody.innerHTML = products.map(product => `
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
            <td>${Number(product.discount || 0)}%</td>
            <td>${Number(product.gst_rate || 0)}%</td>
            <td>₹${Number(product.selling_price || 0).toFixed(2)}</td>
        </tr>
        `
    ).join("");

}

/* ===========================================
   IMPORT PRODUCT MASTER
=========================================== */

async function importProductMaster(grant){


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
        await window.electronAPI.importProducts(filePath, grant);

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

async function startInventoryReset(grant){

    showProcessingDialog("Resetting Inventory");

    updateProgress(20,"Preparing...");

    const result =
        await window.electronAPI.resetInventory(grant);

    if(result.success){

        updateProgress(100,"Completed");

        await refreshInventory();

        hideProcessingDialog();

        await alert(
`Inventory Reset Successful

The Product Master has been reset successfully.

Please import a Product Master Excel file before creating new bills.`
    + (result.activityWarning ? `\n\nWarning: ${result.activityWarning}` : "")
);

    }
    else{

        hideProcessingDialog();

        await alert(result.error);

    }

}

/* ===========================================
   STOCK INWARD / OUTWARD
=========================================== */

let currentStockTransactionType = null;
let currentStockProduct = null;
let currentStockAuthorizationGrant = null;

function discardStockAuthorization() {
    const grant = currentStockAuthorizationGrant;
    const purpose = currentStockTransactionType === "INWARD"
        ? "INVENTORY_INWARD"
        : currentStockTransactionType === "OUTWARD"
            ? "INVENTORY_OUTWARD"
            : null;
    currentStockAuthorizationGrant = null;
    if (grant && purpose && window.electronAPI.administratorSecurity?.discardGrant) {
        window.electronAPI.administratorSecurity.discardGrant(grant, purpose).catch(() => {});
    }
}

window.discardStockTransactionAuthorization = discardStockAuthorization;


function openStockTransaction(type, authorizationGrant) {

    currentStockTransactionType = type;
    currentStockProduct = null;
    currentStockAuthorizationGrant = authorizationGrant;

    const modal =
        document.getElementById("stockTransactionModal");

    const title =
        document.getElementById("stockModalTitle");

    const barcode =
        document.getElementById("stockTransactionBarcode");

    const productDetails =
        document.getElementById("stockProductDetails");

    const quantityGroup =
        document.getElementById("stockQuantityGroup");

    const inwardFields =
        document.getElementById("stockInwardFields");

    const outwardFields =
        document.getElementById("stockOutwardFields");

    const qty =
        document.getElementById("stockTransactionQty");

    const invoice =
        document.getElementById("stockInvoiceNo");

    const inwardRemarks =
        document.getElementById("stockInwardRemarks");

    const outwardReason =
        document.getElementById("stockOutwardReason");

    const outwardRemarks =
        document.getElementById("stockOutwardRemarks");

    const confirmBtn =
        document.getElementById("confirmStockTransactionBtn");


    barcode.value = "";
    qty.value = "";

    invoice.value = "";
    inwardRemarks.value = "";

    outwardReason.value = "";
    outwardRemarks.value = "";


    productDetails.style.display = "none";
    quantityGroup.style.display = "none";

    confirmBtn.disabled = true;


    if (type === "INWARD") {

        title.textContent = "📥 Stock Inward";

        inwardFields.style.display = "block";

        outwardFields.style.display = "none";

    } else {

        title.textContent = "📤 Stock Outward";

        inwardFields.style.display = "none";

        outwardFields.style.display = "block";

    }


    modal.style.display = "flex";

    setTimeout(() => {

        barcode.focus();

    }, 100);

}


/* ===========================================
   CLOSE STOCK MODAL
=========================================== */

function closeStockTransaction() {

    const modal =
        document.getElementById("stockTransactionModal");

    modal.style.display = "none";

    discardStockAuthorization();
    currentStockTransactionType = null;
    currentStockProduct = null;

}


/* ===========================================
   LOOKUP STOCK PRODUCT
=========================================== */

async function lookupStockProduct() {

    const barcodeInput =
        document.getElementById(
            "stockTransactionBarcode"
        );

    const barcode =
        barcodeInput.value.trim();

    if (!barcode) return;


    try {

const product =
    await window.electronAPI.getInventoryProduct(
        barcode
    );


        if (!product) {

            currentStockProduct = null;

            document.getElementById(
                "stockProductDetails"
            ).style.display = "none";

            document.getElementById(
                "stockQuantityGroup"
            ).style.display = "none";

            document.getElementById(
                "confirmStockTransactionBtn"
            ).disabled = true;


            alert(
                "Product not found. Contact ADMINISTRATOR."
            );

            barcodeInput.focus();

            return;

        }


        currentStockProduct = product;


        document.getElementById(
            "stockProductName"
        ).textContent =
            product.product_name;


        document.getElementById(
            "stockProductBarcode"
        ).textContent =
            product.barcode;


        document.getElementById(
            "stockCurrentQty"
        ).textContent =
            product.current_stock ??
            product.opening_stock ??
            0;


        document.getElementById(
            "stockProductDetails"
        ).style.display = "block";


        document.getElementById(
            "stockQuantityGroup"
        ).style.display = "block";


        document.getElementById(
            "stockTransactionQty"
        ).focus();


        validateStockTransaction();

    } catch (err) {

        console.error(err);

        alert(
            "Unable to find product. Please try again."
        );

    }

}


/* ===========================================
   VALIDATE STOCK TRANSACTION
=========================================== */

function validateStockTransaction() {

    const confirmBtn =
        document.getElementById(
            "confirmStockTransactionBtn"
        );

    const qty =
        Number(
            document.getElementById(
                "stockTransactionQty"
            ).value
        );


    if (!currentStockProduct) {

        confirmBtn.disabled = true;

        return;

    }


    if (!Number.isInteger(qty) || qty <= 0) {

        confirmBtn.disabled = true;

        return;

    }


    if (
        currentStockTransactionType === "OUTWARD"
    ) {

        const reason =
            document.getElementById(
                "stockOutwardReason"
            ).value;

        const currentStock =
            Number(
                currentStockProduct.current_stock ??
                currentStockProduct.opening_stock ??
                0
            );


        if (!reason || qty > currentStock) {

            confirmBtn.disabled = true;

            return;

        }

    }


    confirmBtn.disabled = false;

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

        const stockInwardBtn =
        document.getElementById("stockInwardBtn");

    const stockOutwardBtn =
        document.getElementById("stockOutwardBtn");

    const closeStockModalBtn =
        document.getElementById("closeStockModalBtn");

    const cancelStockTransactionBtn =
        document.getElementById(
            "cancelStockTransactionBtn"
        );

    const stockTransactionBarcode =
        document.getElementById(
            "stockTransactionBarcode"
        );

    const stockTransactionQty =
        document.getElementById(
            "stockTransactionQty"
        );

    const stockOutwardReason =
        document.getElementById(
            "stockOutwardReason"
        );

    const confirmStockTransactionBtn =
        document.getElementById(
            "confirmStockTransactionBtn"
        );

    const searchBox =
        document.getElementById("inventorySearch");

    const previousPageBtn =
        document.getElementById("inventoryPreviousPage");

    const nextPageBtn =
        document.getElementById("inventoryNextPage");

    const pageJumpInput =
        document.getElementById("inventoryPageJump");

    if (importBtn)

    importBtn.onclick = () => {

        requireAdminAuthorization("PRODUCT_IMPORT", grant => {

            importProductMaster(grant);

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

            requireAdminAuthorization("INVENTORY_RESET", grant => {

                startInventoryReset(grant);
                
            });

        };

            /* STOCK INWARD */

    if (stockInwardBtn) {

        stockInwardBtn.onclick = async () => {
            const grant = await requestAdminAuthorization("INVENTORY_INWARD");
            if (grant) openStockTransaction("INWARD", grant);

        };

    }


    /* STOCK OUTWARD */

    if (stockOutwardBtn) {

        stockOutwardBtn.onclick = async () => {
            const grant = await requestAdminAuthorization("INVENTORY_OUTWARD");
            if (grant) openStockTransaction("OUTWARD", grant);

        };

    }


    /* CLOSE / CANCEL MODAL */

    if (closeStockModalBtn) {

        closeStockModalBtn.onclick =
            closeStockTransaction;

    }

    if (cancelStockTransactionBtn) {

        cancelStockTransactionBtn.onclick =
            closeStockTransaction;

    }


    /* BARCODE LOOKUP */

    if (stockTransactionBarcode) {

        stockTransactionBarcode.addEventListener(
            "keydown",
            (e) => {

                if (e.key === "Enter") {

                    e.preventDefault();

                    lookupStockProduct();

                }

            }
        );

    }


    /* VALIDATE QUANTITY */

    if (stockTransactionQty) {

        stockTransactionQty.addEventListener(
            "input",
            validateStockTransaction
        );

    }


    /* VALIDATE OUTWARD REASON */

    if (stockOutwardReason) {

        stockOutwardReason.addEventListener(
            "change",
            validateStockTransaction
        );

    }
    
    if (searchBox) {

        searchBox.addEventListener("input", (e) => {

    const keyword = e.target.value.trim();

    inventoryKeyword = keyword;
    inventoryPage = 1;

    if (keyword === "") {

        loadProducts();
        return;

    }

    searchProducts(keyword);

});

    }

    if (previousPageBtn) {

        previousPageBtn.addEventListener("click", () => {
            goToInventoryPage(inventoryPage - 1);
        });

    }

    if (nextPageBtn) {

        nextPageBtn.addEventListener("click", () => {
            goToInventoryPage(inventoryPage + 1);
        });

    }

    if (pageJumpInput) {

        pageJumpInput.addEventListener("keydown", event => {
            if (event.key === "Enter") {
                event.preventDefault();
                handleInventoryPageJump();
            }
        });

    }

/* ===========================================
   CONFIRM STOCK TRANSACTION
=========================================== */

if (confirmStockTransactionBtn)

confirmStockTransactionBtn.onclick = async () => {

    if (!currentStockProduct) {

        alert(
            "Please scan a valid product first."
        );

        return;

    }


    const transactionQty =
        Number(
            stockTransactionQty.value
        );


    if (
        !Number.isInteger(transactionQty) ||
        transactionQty <= 0
    ) {

        alert(
            "Please enter a valid quantity."
        );

        return;

    }


    confirmStockTransactionBtn.disabled = true;


    try {

        let result;


        /* ===============================
           STOCK INWARD
        =============================== */

        if (
            currentStockTransactionType ===
            "INWARD"
        ) {

            result =
                await window.electronAPI.stockInward({

                    authorizationGrant: currentStockAuthorizationGrant,

                    productId:
                        currentStockProduct.id,

                    barcode:
                        currentStockProduct.barcode,

                    quantity:
                        transactionQty,

invoiceNo:
    document.getElementById(
        "stockInvoiceNo"
    ).value.trim(),

remarks:
    document.getElementById(
        "stockInwardRemarks"
    ).value.trim()

                });

        }


        /* ===============================
           STOCK OUTWARD
        =============================== */

        else if (
            currentStockTransactionType ===
            "OUTWARD"
        ) {

            const reason =
                stockOutwardReason.value;


            if (!reason) {

                alert(
                    "Please select a reason."
                );

                confirmStockTransactionBtn.disabled =
                    false;

                return;

            }


            result =
                await window.electronAPI.stockOutward({

                    authorizationGrant: currentStockAuthorizationGrant,

                    productId:
                        currentStockProduct.id,

                    barcode:
                        currentStockProduct.barcode,

                    quantity:
                        transactionQty,

                    reason:
                        reason,

remarks:
    document.getElementById(
        "stockOutwardRemarks"
    ).value.trim()

                });

        }


if (!result) {
    throw new Error(
        "Transaction could not be completed."
    );
}

/* ===========================================
   TRANSACTION SAVED SUCCESSFULLY
=========================================== */

const successMessage =
    currentStockTransactionType === "INWARD"
        ? "Stock inward completed successfully."
        : "Stock outward completed successfully.";

/* Close modal immediately after successful save */

closeStockTransaction();

/* Refresh inventory separately.
   A refresh error must NOT make a saved transaction
   appear as failed. */

try {

    await loadInventorySummary();
    await loadProducts();

} catch (refreshError) {

    console.error(
        "INVENTORY REFRESH ERROR:",
        refreshError
    );

}

/* Show success only after transaction is safely saved */

alert(
    successMessage +
    (result.activityWarning ? `\n\nWarning: ${result.activityWarning}` : "")
);


    }

    catch (error) {

        console.error(
            "STOCK TRANSACTION ERROR:",
            error
        );


        alert(
            error.message ||
            "Unable to complete stock transaction."
        );


        confirmStockTransactionBtn.disabled =
            false;

    }

};

}
