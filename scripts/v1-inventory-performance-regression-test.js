const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => db.run(sql, params, function (error) {
        error ? reject(error) : resolve(this);
    }));
}

function get(db, sql, params = []) {
    return new Promise((resolve, reject) => db.get(sql, params, (error, row) => {
        error ? reject(error) : resolve(row);
    }));
}

function all(db, sql, params = []) {
    return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => {
        error ? reject(error) : resolve(rows);
    }));
}

function close(db) {
    return new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
}

async function seedProducts(db, count) {
    await run(db, "BEGIN");
    try {
        for (let index = 1; index <= count; index += 1) {
            const barcode = `PERF-${String(index).padStart(4, "0")}`;
            await run(db, `
                INSERT INTO products
                    (barcode, sku, brand, product_name, segment, category, season,
                     collection, style_code, size, colour, mrp, discount,
                     selling_price, gst_rate, opening_stock, active)
                VALUES (?, ?, 'PERF-BRAND', ?, 'PERF-SEGMENT', 'PERF-CATEGORY',
                        'PERF-SEASON', 'PERF-COLLECTION', ?, 'M', 'BLACK',
                        1000, 0, 1000, 5, 10, 1)
            `, [barcode, `SKU-${index}`, `Performance Product ${index}`, `STYLE-${index}`]);
            await run(db, `
                INSERT INTO inventory_transactions
                    (product_id, barcode, transaction_type, quantity, reference_type,
                     reference_id, remarks, created_by, created_at)
                SELECT id, barcode, 'OPENING', 10, 'PERFORMANCE_TEST', ?,
                       'Disposable performance seed', 'TEST', datetime('now')
                FROM products WHERE barcode = ?
            `, [`PERF-SEED-${index}`, barcode]);
        }
        await run(db, "COMMIT");
    }
    catch (error) {
        await run(db, "ROLLBACK").catch(() => {});
        throw error;
    }
}

function assertPageRows(pageResult, expectedPage, expectedTotal, pageSize) {
    assert.strictEqual(pageResult.page, expectedPage);
    assert.strictEqual(pageResult.totalCount, expectedTotal);
    assert(pageResult.products.length <= pageSize);
    assert.strictEqual(pageResult.totalPages, Math.max(1, Math.ceil(expectedTotal / pageSize)));
}

async function child(tempRoot, productCount) {
    const { app } = require("electron");
    app.setPath("userData", path.join(tempRoot, "user data"));

    const db = require("../src/database/database");
    await db.databaseReady;
    const productService = require("../src/database/productService");
    const inventoryService = require("../src/database/inventoryTransactionService");

    await seedProducts(db, productCount);

    const pageSize = 100;
    const countStart = process.hrtime.bigint();
    const firstPage = await productService.getProductPage({ page: 1, pageSize });
    const countMs = Number(process.hrtime.bigint() - countStart) / 1e6;
    assertPageRows(firstPage, 1, productCount, pageSize);
    assert.strictEqual(firstPage.products.length, Math.min(pageSize, productCount));
    assert.strictEqual(Number(firstPage.products[0].current_stock), 10);

    const pageStart = process.hrtime.bigint();
    const secondPage = await productService.getProductPage({ page: 2, pageSize });
    const pageMs = Number(process.hrtime.bigint() - pageStart) / 1e6;
    if (productCount > pageSize) {
        assertPageRows(secondPage, 2, productCount, pageSize);
        assert.notStrictEqual(firstPage.products[0].id, secondPage.products[0].id);
    }

    const lastPageNumber = Math.max(1, Math.ceil(productCount / pageSize));
    const lastPage = await productService.getProductPage({
        page: lastPageNumber,
        pageSize
    });
    assertPageRows(lastPage, lastPageNumber, productCount, pageSize);
    assert.strictEqual(
        lastPage.products.length,
        productCount === 0 ? 0 : ((productCount - 1) % pageSize) + 1
    );

    const seenIds = new Set();
    let previousSortKey = null;
    for (let page = 1; page <= lastPageNumber; page += 1) {
        const result = await productService.getProductPage({ page, pageSize });
        for (const product of result.products) {
            assert(!seenIds.has(product.id));
            seenIds.add(product.id);
            const sortKey = `${product.product_name}\u0000${String(product.id).padStart(12, "0")}`;
            if (previousSortKey !== null) {
                assert(sortKey >= previousSortKey);
            }
            previousSortKey = sortKey;
        }
    }
    assert.strictEqual(seenIds.size, productCount);

    const searchTerms = [
        `Performance Product 1`,
        `SKU-${Math.ceil(productCount / 2)}`,
        `PERF-${String(productCount).padStart(4, "0")}`
    ];
    const searchTimings = {};
    for (const term of searchTerms) {
        const searchStart = process.hrtime.bigint();
        const searchResult = await productService.getProductPage({
            page: 1,
            pageSize,
            keyword: term
        });
        searchTimings[term] = Number(process.hrtime.bigint() - searchStart) / 1e6;
        assert(searchResult.totalCount >= 1);
        assert(searchResult.products.some(product =>
            product.barcode.includes(term) ||
            product.sku.includes(term) ||
            product.product_name.includes(term)
        ));
    }

    const broadSearch = await productService.getProductPage({
        page: 1,
        pageSize,
        keyword: "PERF-BRAND"
    });
    assert.strictEqual(broadSearch.totalCount, productCount);
    assert.strictEqual(broadSearch.products.length, pageSize);
    const broadSearchLast = await productService.getProductPage({
        page: broadSearch.totalPages,
        pageSize,
        keyword: "PERF-BRAND"
    });
    assert(broadSearchLast.products.length <= pageSize);

    const emptySearch = await productService.getProductPage({
        page: 99,
        pageSize,
        keyword: "NO-SUCH-PRODUCT"
    });
    assert.strictEqual(emptySearch.totalCount, 0);
    assert.strictEqual(emptySearch.page, 1);
    assert.strictEqual(emptySearch.products.length, 0);

    const inwardStart = process.hrtime.bigint();
    const inward = await inventoryService.stockInward({
        barcode: "PERF-0001",
        quantity: 5,
        invoiceNo: "PERF-INVOICE",
        remarks: "Performance inward",
        createdBy: "TEST"
    });
    const inwardMs = Number(process.hrtime.bigint() - inwardStart) / 1e6;
    assert.strictEqual(inward.success, true);
    assert.strictEqual(inward.currentStock, 15);

    const outwardStart = process.hrtime.bigint();
    const outward = await inventoryService.stockOutward({
        barcode: "PERF-0001",
        quantity: 3,
        reason: "DAMAGE",
        remarks: "Performance outward",
        createdBy: "TEST"
    });
    const outwardMs = Number(process.hrtime.bigint() - outwardStart) / 1e6;
    assert.strictEqual(outward.success, true);
    assert.strictEqual(outward.currentStock, 12);

    const movementCountBeforeFailure = await get(db, `
        SELECT COUNT(*) AS count
        FROM inventory_transactions
        WHERE barcode = 'PERF-0001'
          AND transaction_type IN ('INWARD', 'DAMAGE')
    `);
    await assert.rejects(
        inventoryService.stockOutward({
            barcode: "PERF-0001",
            quantity: 1000,
            reason: "DAMAGE",
            remarks: "Must fail",
            createdBy: "TEST"
        }),
        /Insufficient stock/
    );
    const movementCountAfterFailure = await get(db, `
        SELECT COUNT(*) AS count
        FROM inventory_transactions
        WHERE barcode = 'PERF-0001'
          AND transaction_type IN ('INWARD', 'DAMAGE')
    `);
    assert.strictEqual(movementCountAfterFailure.count, movementCountBeforeFailure.count);

    const finalStock = await inventoryService.getLiveStock(
        (await get(db, "SELECT id FROM products WHERE barcode = 'PERF-0001'")).id
    );
    assert.strictEqual(finalStock, 12);
    assert.strictEqual(
        (await get(db, "SELECT COUNT(*) AS count FROM inventory_transactions WHERE id = ?", [inward.transactionId])).count,
        1
    );
    assert.strictEqual(
        (await get(db, "SELECT COUNT(*) AS count FROM inventory_transactions WHERE id = ? AND transaction_type = 'DAMAGE'", [outward.transactionId])).count,
        1
    );
    assert.deepStrictEqual(await all(db, "PRAGMA foreign_key_check"), []);

    const rendererSource = fs.readFileSync(
        path.join(__dirname, "../src/renderer/modules/inventory.js"),
        "utf8"
    );
    assert(rendererSource.includes("tbody.innerHTML = products.map(product =>"));
    assert(!rendererSource.includes("tbody.innerHTML +="));
    assert(rendererSource.includes("INVENTORY_PAGE_SIZE = 100"));
    assert(rendererSource.includes("inventoryPreviousPage"));

    process.stdout.write(JSON.stringify({
        productCount,
        countMs: Number(countMs.toFixed(3)),
        pageMs: Number(pageMs.toFixed(3)),
        searchMs: Number(Math.max(...Object.values(searchTimings)).toFixed(3)),
        stockInwardSaveMs: Number(inwardMs.toFixed(3)),
        stockOutwardSaveMs: Number(outwardMs.toFixed(3)),
        domBuild: "Not measured in Node; manual Chromium/Windows acceptance required",
        pageSize,
        totalPages: lastPageNumber
    }) + "\nInventory pagination performance/correctness test: PASS\n");

    await close(db);
    app.exit(0);
}

if (process.argv.includes("--child")) {
    const childIndex = process.argv.indexOf("--child");
    child(
        process.argv[childIndex + 1],
        Number(process.argv[childIndex + 2])
    ).catch(error => {
        console.error(error);
        try { require("electron").app.exit(1); } catch (_) {}
        process.exitCode = 1;
    });
}
else {
    const electronBinary = require("electron");
    const sizes = [1253, 3000, 5000, 10000];
    const measurements = [];
    for (const size of sizes) {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "klbs-inventory-perf-"));
        const result = spawnSync(
            electronBinary,
            ["--disable-gpu", "--in-process-gpu", __filename, "--child", tempRoot, String(size)],
            {
                cwd: path.resolve(__dirname, ".."),
                env: { ...process.env, KLBS_DEV_DATABASE_PATH: path.join(tempRoot, "billing.db") },
                encoding: "utf8",
                timeout: 180000,
                windowsHide: true
            }
        );
        if (result.error) throw result.error;
        if (result.status !== 0) {
            process.stdout.write(result.stdout || "");
            process.stderr.write(result.stderr || "");
            process.exit(result.status || 1);
        }
        const jsonLine = result.stdout.split("\n").find(line => line.trim().startsWith("{"));
        measurements.push(JSON.parse(jsonLine));
    }
    process.stdout.write(JSON.stringify({ measurements }, null, 2) + "\nInventory pagination performance/correctness test: PASS\n");
}
