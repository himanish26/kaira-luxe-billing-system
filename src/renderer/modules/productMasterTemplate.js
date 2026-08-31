window.productMasterTemplate = `
<h1 class="inventory-page-title">
    📦 PRODUCT MASTER
</h1>

<p class="page-subtitle">
    Manage your Product Catalogue
</p>

<div class="product-master-card">

    <h2>Product Master</h2>

    <div class="master-stats">

        <div>
    Products :
    <span id="inventoryProductCount">0</span>
</div>

<div>
    Brands :
    <span id="inventoryBrandCount">0</span>
</div>

<div>
    Segments :
    <span id="inventorySegmentCount">0</span>
</div>

<div>
    Categories :
    <span id="inventoryCategoryCount">0</span>
</div>

<div>
    Seasons :
    <span id="inventorySeasonCount">0</span>
</div>

<div>
    Collections :
    <span id="inventoryCollectionCount">0</span>
</div>

    </div>

    <div class="inventory-action-buttons">

    <button
        id="importBtn"
        class="dashboard-btn">

        📥 Import Product Master

    </button>

    <button
        id="downloadTemplateBtn"
        class="dashboard-btn">

        📄 Download Master Template

    </button>

</div>

</div>

<div class="product-master-card">

    <h2>Last Import</h2>

    <div class="info-row">

        <label>File Name</label>

        <span id="lastImportFile">-</span>

    </div>

    <div class="info-row">

        <label>Imported On</label>

        <span id="lastImportDate">-</span>

    </div>

    <div class="info-row">

        <label>Products Imported</label>

        <span id="lastImportCount">0</span>

    </div>

</div>

<input
    type="text"
    id="inventorySearch"
    class="inventory-search"
    placeholder="🔍 Search Barcode, Product, Brand or Style Code...">

<div
    id="inventoryTableContainer"
    class="inventory-table">

    <table id="inventoryTable">

        <thead>

            <tr>

                <th>Barcode</th>
                <th>Brand</th>
                <th>Segment</th>
                <th>Category</th>
                <th>Season</th>
                <th>Collection</th>
                <th>Product</th>
                <th>Size</th>
                <th>Qty</th>
                <th>MRP</th>

            </tr>

        </thead>

        <tbody id="inventoryTableBody">

        </tbody>

    </table>

</div>

<div
    id="inventoryEmptyState"
    class="inventory-empty-state"
    style="display:none;">

    <div class="empty-icon">📦</div>

    <h2>Inventory Empty</h2>

    <p>Import a Product Master to begin billing.</p>

</div>

<div class="inventory-action-buttons">

    <button
        id="refreshInventoryBtn"
        class="dashboard-btn">

        🔄 Refresh

    </button>

    <button
        id="exportInventoryBtn"
        class="dashboard-btn">

        📤 Export to Excel

    </button>

    <button
        id="stockInwardBtn"
        class="dashboard-btn">

        📥 Stock Inward

    </button>

    <button
        id="stockOutwardBtn"
        class="dashboard-btn">

        📤 Stock Outward

    </button>

</div>

<div class="inventory-actions">

<div class="danger-zone">

    <h2>⚠️ DANGER ZONE</h2>

    <p>
        This will permanently delete ALL products from the Product Master.
    </p>
    <p>
        <strong>
            Bills, Bill History and Settings will NOT be affected.
        </strong>
    </p>

    <p>
        A backup of the inventory will be created automatically before deletion.
    </p>

    <p class="danger-warning">
        This action cannot be undone.
    </p>

    <button
        id="resetInventoryBtn"
        class="danger-btn">

        🗑 RESET INVENTORY

    </button>

</div>

<!-- =========================================================
     STOCK TRANSACTION MODAL
========================================================= -->

<div
    id="stockTransactionModal"
    class="stock-transaction-modal"
    style="display:none;">

    <div class="stock-transaction-modal-content">

        <div class="stock-modal-header">

            <h2 id="stockModalTitle">
                Stock Transaction
            </h2>

            <button
                id="closeStockModalBtn"
                class="stock-modal-close"
                type="button">

                ×

            </button>

        </div>


        <!-- BARCODE -->

        <div class="stock-form-group">

            <label>
                Scan / Enter Barcode
            </label>

            <input
                type="text"
                id="stockTransactionBarcode"
                class="stock-transaction-input"
                placeholder="Scan barcode here..."
                autocomplete="off">

        </div>


        <!-- PRODUCT DETAILS -->

        <div
            id="stockProductDetails"
            class="stock-product-details"
            style="display:none;">

            <div class="stock-product-row">

                <span>Product</span>

                <strong
                    id="stockProductName">

                    -

                </strong>

            </div>


            <div class="stock-product-row">

                <span>Barcode</span>

                <strong
                    id="stockProductBarcode">

                    -

                </strong>

            </div>


            <div class="stock-product-row">

                <span>Current Stock</span>

                <strong
                    id="stockCurrentQty">

                    0

                </strong>

            </div>

        </div>


        <!-- QUANTITY -->

        <div
            id="stockQuantityGroup"
            class="stock-form-group"
            style="display:none;">

            <label id="stockQuantityLabel">
                Quantity
            </label>

            <input
                type="number"
                id="stockTransactionQty"
                class="stock-transaction-input"
                min="1"
                step="1"
                placeholder="Enter quantity">

        </div>


        <!-- INWARD FIELDS -->

        <div
            id="stockInwardFields"
            style="display:none;">

            <div class="stock-form-group">

                <label>
                    Invoice Number
                    <span class="optional-field">
                        (Optional)
                    </span>
                </label>

                <input
                    type="text"
                    id="stockInvoiceNo"
                    class="stock-transaction-input"
                    placeholder="Enter invoice number">

            </div>


            <div class="stock-form-group">

                <label>
                    Remarks
                    <span class="optional-field">
                        (Optional)
                    </span>
                </label>

                <textarea
                    id="stockInwardRemarks"
                    class="stock-transaction-input stock-remarks"
                    placeholder="Enter remarks"></textarea>

            </div>

        </div>


        <!-- OUTWARD FIELDS -->

        <div
            id="stockOutwardFields"
            style="display:none;">

            <div class="stock-form-group">

                <label>
                    Reason
                </label>

                <select
                    id="stockOutwardReason"
                    class="stock-transaction-input">

                    <option value="">
                        Select Reason
                    </option>

                    <option value="DAMAGE">
                        Damage
                    </option>

                    <option value="SUPPLIER_RETURN">
                        Supplier Return
                    </option>

                    <option value="ADJUSTMENT">
                        Stock Adjustment
                    </option>

                </select>

            </div>


            <div class="stock-form-group">

                <label>
                    Remarks
                    <span class="optional-field">
                        (Optional)
                    </span>
                </label>

                <textarea
                    id="stockOutwardRemarks"
                    class="stock-transaction-input stock-remarks"
                    placeholder="Enter remarks"></textarea>

            </div>

        </div>


        <!-- ACTIONS -->

        <div class="stock-modal-actions">

            <button
                id="cancelStockTransactionBtn"
                class="dashboard-btn klbs-cancel-btn"
                type="button">

                Cancel

            </button>


            <button
                id="confirmStockTransactionBtn"
                class="dashboard-btn klbs-primary-btn"
                type="button"
                disabled>

                Confirm

            </button>

        </div>

    </div>

</div>

</div>

`;
