console.log("Inventory Module Loaded");

let inventoryProductsRequestId = 0;

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

    const requestId =
        ++inventoryProductsRequestId;

    const products =
        await window.electronAPI.getProducts();

    if (requestId !== inventoryProductsRequestId) {
        return;
    }

    renderInventoryProducts(products);

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

    const requestId =
        ++inventoryProductsRequestId;

    const products =
        await window.electronAPI.searchProducts(keyword);

    if (requestId !== inventoryProductsRequestId) {
        return;
    }

    renderInventoryProducts(products);

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

async function importProductMaster(grant){

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

async function startInventoryReset(grant){

    showProcessingDialog("Resetting Inventory");

    updateProgress(20,"Preparing...");

    const result =
        await window.electronAPI.resetInventory(grant);

    if(result.success){

        updateProgress(100,"Completed");

        await refreshInventory();

        setTimeout(() => {

            hideProcessingDialog();

            alert(
`Inventory Reset Successful

The Product Master has been reset successfully.

Please import a Product Master Excel file before creating new bills.`
    + (result.activityWarning ? `\n\nWarning: ${result.activityWarning}` : "")
);

        }, 500);

    }
    else{

        hideProcessingDialog();

        alert(result.error);

    }

}

/* ===========================================
   STOCK INWARD / OUTWARD
=========================================== */

let currentStockTransactionType = null;
let currentStockProduct = null;


function openStockTransaction(type) {

    currentStockTransactionType = type;
    currentStockProduct = null;

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

        stockInwardBtn.onclick = () => {

            openStockTransaction("INWARD");

        };

    }


    /* STOCK OUTWARD */

    if (stockOutwardBtn) {

        stockOutwardBtn.onclick = () => {

            openStockTransaction("OUTWARD");

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

    if (keyword === "") {

        loadProducts();
        return;

    }

    searchProducts(keyword);

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
