window.productMasterTemplate = `
<h1 class="page-title">
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
            Categories :
            <span id="inventoryCategoryCount">0</span>
        </div>

    </div>

    <button
        id="importBtn"
        class="dashboard-btn">

        📥 Import Product Master

    </button>

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
                <th>Product</th>
                <th>Brand</th>
                <th>Category</th>
                <th>Size</th>
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

`;