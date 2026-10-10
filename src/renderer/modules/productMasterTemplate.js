window.productMasterTemplate = `
<h1 class="inventory-page-title">
    📦 PRODUCT MASTER
</h1>

<p class="page-subtitle">
    Manage your Product Catalogue
</p>

<div class="product-master-card">

    <div class="product-master-total-inventory">

        <div class="product-master-total-label">TOTAL INVENTORY</div>

        <div class="product-master-total-value">
            <span id="inventoryTotalQuantity">0</span> UNITS
        </div>

    </div>

    <div class="master-stats">

        <div class="master-stat master-stat-products">
    Products :
    <span id="inventoryProductCount">0</span>
</div>

<div class="master-stat master-stat-brands">
    Brands :
    <span id="inventoryBrandCount">0</span>
</div>

<div class="master-stat master-stat-segments">
    Segments :
    <span id="inventorySegmentCount">0</span>
</div>

<div class="master-stat master-stat-categories">
    Categories :
    <span id="inventoryCategoryCount">0</span>
</div>

<div class="master-stat master-stat-seasons">
    Seasons :
    <span id="inventorySeasonCount">0</span>
</div>

<div class="master-stat master-stat-collections">
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

    <div class="info-row">

        <label>Last Existing SKU</label>

        <span id="inventoryLatestSku">-</span>

    </div>

</div>

<div class="inventory-search-tools">
    <input
        type="text"
        id="inventorySearch"
        class="inventory-search"
        placeholder="🔍 Search Barcode, Product, Brand or Style Code...">
    <button type="button" id="openStyleExplorerBtn" class="inventory-style-open-btn">
        🔎 PRODUCT SEARCH
    </button>
</div>

<div id="inventoryStyleExplorerOverlay" class="inventory-style-overlay klbs-drawer-overlay" hidden>
    <aside id="inventoryStyleExplorerDrawer" class="inventory-style-drawer klbs-drawer-panel" role="dialog" aria-modal="true" aria-labelledby="inventoryStyleExplorerTitle" tabindex="-1">
        <header class="inventory-style-header klbs-drawer-header">
            <h2 id="inventoryStyleExplorerTitle" class="klbs-drawer-title">PRODUCT SEARCH</h2>
            <button type="button" id="closeStyleExplorerBtn" class="inventory-style-close klbs-drawer-exit" aria-label="Exit Product Search">EXIT</button>
        </header>
        <div class="inventory-style-body klbs-drawer-body">
            <input id="styleExplorerInput" class="inventory-style-search" type="text" autocomplete="off" placeholder="Scan barcode or enter Style Code">
            <div id="styleExplorerState" class="inventory-style-state" role="status" aria-live="polite"></div>
            <div id="styleExplorerResults" class="inventory-style-results" hidden>
                <section class="inventory-style-family-head" aria-live="polite">
                    <div class="inventory-style-family-identity">
                        <strong id="styleExplorerBrandStyle"></strong>
                        <span id="styleExplorerCategory"></span>
                        <small id="styleExplorerProductName"></small>
                    </div>
                    <div id="styleExplorerScanned" class="inventory-style-scanned"></div>
                </section>
                <div id="styleExplorerSummary" class="inventory-style-summary"></div>
                <div class="inventory-style-filters">
                    <label class="inventory-style-colour-label" for="styleExplorerColour">COLOUR</label>
                    <select id="styleExplorerColour"><option value="">All colours</option></select>
                    <label class="inventory-style-stock-filter" for="styleExplorerInStock"><input id="styleExplorerInStock" type="checkbox"> IN STOCK ONLY</label>
                </div>
                <div id="styleExplorerVariantRows" class="inventory-style-colour-groups" aria-live="polite"></div>
                <p id="styleExplorerNoStock" class="inventory-style-no-stock" hidden>No variants currently in stock</p>
            </div>
            <div id="styleExplorerCandidates" class="inventory-style-candidates" hidden></div>
        </div>
    </aside>
</div>

<div
    id="inventoryTableContainer"
    class="inventory-table">

    <table id="inventoryTable">

        <thead>

            <tr>

                <th>Barcode</th>
                <th>Brand</th>
                <th>Segment</th>
                <th>Business Segment</th>
                <th>Category</th>
                <th>Season</th>
                <th>Collection</th>
                <th>Product</th>
                <th>Size</th>
                <th>Colour</th>
                <th>Qty</th>
                <th>MRP</th>
                <th>Disc%</th>
                <th>GST%</th>
                <th>Selling Price</th>
                <th>Variable Value</th>

            </tr>

        </thead>

        <tbody id="inventoryTableBody">

        </tbody>

    </table>

</div>

<div
    id="inventoryPagination"
    class="inventory-pagination"
    style="display:none;">

    <div class="pagination-controls">
    <button
        id="inventoryPreviousPage"
        class="pagination-nav-btn"
        type="button">
        Previous
    </button>

    <span id="inventoryPageLabel">Page 1 of 1</span>

    <label
        class="inventory-page-jump-label"
        for="inventoryPageJump">
        Jump to page:
    </label>

    <input
        id="inventoryPageJump"
        class="inventory-page-jump-input"
        type="number"
        min="1"
        step="1"
        inputmode="numeric"
        value="1"
        aria-label="Jump to page">

    <button
        id="inventoryNextPage"
        class="pagination-nav-btn"
        type="button">
        Next
    </button>
    </div>

    <span id="inventoryRangeLabel">Showing 0-0 of 0 products</span>

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
        id="stockOutwardV21Btn"
        class="dashboard-btn"
        type="button">

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
