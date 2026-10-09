"use strict";

const assert = require("assert");
const sqlite3 = require("sqlite3").verbose();
const Module = require("module");
const {
    CURRENT_DB_SCHEMA_VERSION,
    prepareDatabaseSchema,
    readSchemaVersion
} = require("../src/database/schemaVersion");
const { migrateReturnCogsReversal } = require("../src/database/returnCogsReversalMigration");
const { deriveReturnCostSnapshot } = require("../src/database/returnCostSnapshot");
const { createReturnCogsService } = require("../src/database/returnCogsService");
const { getBusinessDate } = require("../src/database/businessDate");

const run = (db, sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function(error) {
    error ? reject(error) : resolve({ lastID: this.lastID, changes: this.changes });
}));
const get = (db, sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (error, row) => {
    error ? reject(error) : resolve(row || null);
}));
const all = (db, sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => {
    error ? reject(error) : resolve(rows || []);
}));
const exec = (db, sql) => new Promise((resolve, reject) => db.exec(sql, error => error ? reject(error) : resolve()));
const close = db => new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));

async function testMigrationAndConstraints() {
    const db = new sqlite3.Database(":memory:");
    try {
        await exec(db, `
            CREATE TABLE products(id INTEGER PRIMARY KEY);
            CREATE TABLE bills(id INTEGER PRIMARY KEY, bill_no TEXT);
            CREATE TABLE settings(id INTEGER PRIMARY KEY);
            CREATE TABLE inventory_transactions(id INTEGER PRIMARY KEY, quantity INTEGER);
            CREATE TABLE day_closing(id INTEGER PRIMARY KEY, business_date TEXT);
            CREATE TABLE customers(id INTEGER PRIMARY KEY, name TEXT);
            CREATE TABLE stock_movements(id INTEGER PRIMARY KEY, movement_no TEXT);
            CREATE TABLE stock_movement_lines(id INTEGER PRIMARY KEY, movement_id INTEGER);
            CREATE TABLE expenses(id INTEGER PRIMARY KEY, expense_date TEXT);
            CREATE TABLE stores(id INTEGER PRIMARY KEY, store_code TEXT UNIQUE, store_name TEXT,
                status TEXT, created_at TEXT, updated_at TEXT);
            CREATE TABLE store_context(id INTEGER PRIMARY KEY CHECK(id=1), current_store_id INTEGER REFERENCES stores(id));
            CREATE TABLE klbs_schema_metadata(id INTEGER PRIMARY KEY CHECK(id=1), schema_version INTEGER NOT NULL);
            CREATE TABLE returns(id INTEGER PRIMARY KEY, original_bill_no TEXT, accounting_status TEXT,
                business_date TEXT, accounting_snapshot_version INTEGER);
            CREATE TABLE bill_items(id INTEGER PRIMARY KEY, bill_no TEXT, business_segment TEXT,
                unit_cost_paise INTEGER, cost_basis_status TEXT, cost_source TEXT, cost_method TEXT);
            CREATE TABLE return_items(id INTEGER PRIMARY KEY, return_id INTEGER,
                original_bill_item_id INTEGER, quantity INTEGER);
            INSERT INTO klbs_schema_metadata VALUES (1,7);
            INSERT INTO stores VALUES (1,'KL001','Kaira Luxe','ACTIVE','2026-01-01','2026-01-01');
            INSERT INTO store_context VALUES (1,1);
            INSERT INTO returns VALUES (1,'OLD-BILL','COMPLETED','2026-10-01',1);
            INSERT INTO bill_items VALUES (11,'OLD-BILL','KL',10000,'CAPTURED','PRODUCT_MASTER','SALE_TIME_COST_PRICE_PAISE');
            INSERT INTO return_items VALUES (21,1,11,1);
        `);
        await prepareDatabaseSchema({ database: db, runCurrentMigrations: async () => {} });
        assert.strictEqual(CURRENT_DB_SCHEMA_VERSION, 13);
        assert.strictEqual(await readSchemaVersion(db), 13);
        assert.strictEqual(Number((await get(db, `SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table'
            AND name IN ('management_accounting_entries','management_accounting_entry_sequences')`)).count), 2,
        "the isolated V7 fixture completes the real numbered migration chain through V13");
        assert.strictEqual(Number((await get(db, "SELECT COUNT(*) AS count FROM management_accounting_entries")).count), 0,
            "schema migration creates no synthetic management accounting entries");
        assert.deepStrictEqual(await get(db, "SELECT return_cost_basis_status, return_unit_cost_paise, return_cost_paise FROM return_items WHERE id=21"), {
            return_cost_basis_status: "UNKNOWN", return_unit_cost_paise: null, return_cost_paise: null
        }, "legacy return rows remain UNKNOWN without any backfill");

        await run(db, "INSERT INTO returns VALUES (2,'CAPTURED-BILL','COMPLETED','2026-10-02',1)");
        await run(db, "INSERT INTO bill_items VALUES (12,'CAPTURED-BILL','MENS',25000,'CAPTURED','PRODUCT_MASTER','SALE_TIME_COST_PRICE_PAISE')");
        await run(db, `INSERT INTO return_items
            (id,return_id,original_bill_item_id,quantity,return_unit_cost_paise,return_cost_paise,
             return_cost_basis_status,return_cost_source,return_cost_method)
            VALUES (22,2,12,2,25000,50000,'CAPTURED','PRODUCT_MASTER','ORIGINAL_SALE_TIME_COST_REVERSAL')`);
        await assert.rejects(() => run(db, `INSERT INTO return_items
            (id,return_id,original_bill_item_id,quantity,return_unit_cost_paise,return_cost_paise,
             return_cost_basis_status,return_cost_source,return_cost_method)
            VALUES (23,2,12,2,25000,49999,'CAPTURED','PRODUCT_MASTER','ORIGINAL_SALE_TIME_COST_REVERSAL')`),
        /KLBS_RETURN_COST_BASIS_INVALID/);

        await run(db, "INSERT INTO returns VALUES (3,'UNKNOWN-BILL','COMPLETED','2026-10-03',1)");
        await run(db, "INSERT INTO bill_items VALUES (13,'UNKNOWN-BILL','KL',NULL,'UNKNOWN',NULL,NULL)");
        await run(db, `INSERT INTO return_items (id,return_id,original_bill_item_id,quantity,return_cost_basis_status)
            VALUES (24,3,13,1,'UNKNOWN')`);
        await assert.rejects(() => run(db, `INSERT INTO return_items
            (id,return_id,original_bill_item_id,quantity,return_cost_basis_status,return_cost_paise)
            VALUES (25,3,13,1,'UNKNOWN',0)`), /KLBS_RETURN_COST_BASIS_INVALID/);

        await run(db, "INSERT INTO returns VALUES (4,'NA-BILL','COMPLETED','2026-10-04',1)");
        await run(db, "INSERT INTO bill_items VALUES (14,'NA-BILL','KIDS',NULL,'NOT_APPLICABLE',NULL,NULL)");
        await run(db, `INSERT INTO return_items (id,return_id,original_bill_item_id,quantity,return_cost_basis_status)
            VALUES (26,4,14,1,'NOT_APPLICABLE')`);
        await assert.rejects(() => run(db, `INSERT INTO return_items
            (id,return_id,original_bill_item_id,quantity,return_cost_basis_status,return_cost_paise)
            VALUES (27,4,14,1,'NOT_APPLICABLE',0)`), /KLBS_RETURN_COST_BASIS_INVALID/);
        assert.deepStrictEqual(await all(db, "PRAGMA foreign_key_check"), []);
        assert.strictEqual((await get(db, "PRAGMA integrity_check")).integrity_check, "ok");
    } finally {
        await close(db);
    }
}

async function buildRuntimeDatabase() {
    const db = new sqlite3.Database(":memory:");
    await exec(db, `
        CREATE TABLE products (
            id INTEGER PRIMARY KEY, barcode TEXT UNIQUE, product_name TEXT, variable_value INTEGER DEFAULT 0,
            cost_price REAL, business_segment TEXT
        );
        CREATE TABLE bills (id INTEGER PRIMARY KEY, bill_no TEXT UNIQUE, bill_date TEXT);
        CREATE TABLE bill_items (
            id INTEGER PRIMARY KEY, bill_no TEXT, barcode TEXT, product_name TEXT, qty INTEGER, mrp REAL,
            discount_percent REAL, discount_amount REAL, taxable_amount REAL, gst_rate REAL, gst_amount REAL,
            net_amount REAL, business_segment TEXT, unit_cost_paise INTEGER, cost_basis_status TEXT,
            cost_source TEXT, cost_method TEXT
        );
        CREATE TABLE returns (
            id INTEGER PRIMARY KEY AUTOINCREMENT, return_no TEXT, credit_note_no TEXT, original_bill_no TEXT,
            business_date TEXT, original_bill_date TEXT, customer_id INTEGER, customer_name TEXT NOT NULL,
            customer_mobile TEXT NOT NULL, return_reason TEXT NOT NULL, remarks TEXT, return_amount REAL NOT NULL,
            gross_reversal REAL, discount_reversal REAL, taxable_reversal REAL, cgst_reversal REAL,
            sgst_reversal REAL, gst_reversal REAL, net_reversal REAL,
            accounting_status TEXT NOT NULL DEFAULT 'LEGACY_UNASSESSED', accounting_snapshot_version INTEGER,
            created_by TEXT, created_at TEXT NOT NULL
        );
        CREATE TABLE return_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT, return_id INTEGER NOT NULL, product_id INTEGER, barcode TEXT,
            product_name TEXT, original_bill_item_id INTEGER, quantity INTEGER NOT NULL, unit_value REAL NOT NULL DEFAULT 0,
            return_value REAL NOT NULL DEFAULT 0, mrp REAL, gross_reversal REAL, discount_percent REAL,
            discount_reversal REAL, taxable_reversal REAL, gst_rate REAL, cgst_reversal REAL, sgst_reversal REAL,
            gst_reversal REAL, net_reversal REAL, remarks TEXT, created_at TEXT NOT NULL
        );
        CREATE TABLE inventory_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER, barcode TEXT, transaction_type TEXT,
            quantity INTEGER, reference_type TEXT, reference_id TEXT, remarks TEXT, created_by TEXT, created_at TEXT
        );
        CREATE TABLE store_credits (
            id INTEGER PRIMARY KEY AUTOINCREMENT, store_credit_no TEXT, return_id INTEGER, original_bill_no TEXT,
            customer_id INTEGER, customer_name TEXT, customer_mobile TEXT, issue_date TEXT, valid_until TEXT,
            original_amount REAL, remaining_balance REAL, status TEXT, created_by TEXT, created_at TEXT
        );
        CREATE TABLE customer_credit_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER, transaction_type TEXT, amount REAL,
            reference_type TEXT, reference_id TEXT, remarks TEXT, created_by TEXT, created_at TEXT
        );
    `);
    await migrateReturnCogsReversal(db);
    await exec(db, `
        CREATE TRIGGER trg_return_items_accounting_immutable_update
        BEFORE UPDATE ON return_items
        FOR EACH ROW WHEN EXISTS (SELECT 1 FROM returns WHERE id=OLD.return_id AND accounting_status='COMPLETED')
        BEGIN SELECT RAISE(ABORT,'KLBS_RETURN_ACCOUNTING_IMMUTABLE'); END;
        CREATE TRIGGER trg_return_items_accounting_immutable_delete
        BEFORE DELETE ON return_items
        FOR EACH ROW WHEN EXISTS (SELECT 1 FROM returns WHERE id=OLD.return_id AND accounting_status='COMPLETED')
        BEGIN SELECT RAISE(ABORT,'KLBS_RETURN_ACCOUNTING_IMMUTABLE'); END;
    `);

    const originalLoad = Module._load;
    const returnServicePath = require.resolve("../src/database/returnService");
    Module._load = function(request, parent, isMain) {
        if (parent && parent.filename === returnServicePath && request === "./database") return db;
        if (parent && parent.filename === returnServicePath && request === "./logService") {
            return {
                logReturnCompleted: async () => {},
                logCreditNoteGenerated: async () => {},
                logStoreCreditIssued: async () => {},
                logStoreCreditUpdated: async () => {}
            };
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    delete require.cache[returnServicePath];
    const { saveReturn } = require("../src/database/returnService");
    Module._load = originalLoad;
    return { db, saveReturn };
}

async function testReturnFlow() {
    const { db, saveReturn } = await buildRuntimeDatabase();
    try {
        const lineSpecs = [
            { name: "Captured line", qty: 4, mrp: 100, segment: "KL", saleCost: 10000, status: "CAPTURED" },
            { name: "Unknown line", qty: 2, mrp: 50, segment: "MENS", saleCost: null, status: "UNKNOWN" }
        ];
        await run(db, `INSERT INTO bills (bill_no,bill_date) VALUES ('SALE-05A','2026-10-01')`);
        const originalIds = [];
        for (const [index, spec] of lineSpecs.entries()) {
            const barcode = `05A-${index}`;
            const product = await run(db, "INSERT INTO products (barcode,product_name,variable_value,cost_price,business_segment) VALUES (?,?,0,100,?)",
                [barcode, spec.name, spec.segment]);
            await run(db, `INSERT INTO inventory_transactions (product_id,barcode,transaction_type,quantity,reference_type,reference_id,created_by,created_at)
                VALUES (?,?,'OPENING',?,'TEST','SALE-05A','TEST','2026-10-01')`, [product.lastID, barcode, spec.qty]);
            const item = await run(db, `INSERT INTO bill_items
                (bill_no,barcode,product_name,qty,mrp,discount_percent,discount_amount,taxable_amount,gst_rate,gst_amount,
                 net_amount,business_segment,unit_cost_paise,cost_basis_status,cost_source,cost_method)
                VALUES ('SALE-05A',?,?,?, ?,0,0,?,0,0,?,?,?,'${spec.status}',?,?)`,
                [barcode, spec.name, spec.qty, spec.mrp, spec.qty * spec.mrp, spec.qty * spec.mrp, spec.segment,
                    spec.saleCost, spec.status === "CAPTURED" ? "PRODUCT_MASTER" : null,
                    spec.status === "CAPTURED" ? "SALE_TIME_COST_PRICE_PAISE" : null]);
            originalIds.push(item.lastID);
        }

        const capturedBefore = await get(db, "SELECT unit_cost_paise,cost_basis_status,cost_source,cost_method FROM bill_items WHERE id=?", [originalIds[0]]);
        await run(db, "UPDATE products SET cost_price=999 WHERE barcode='05A-0'");
        await run(db, `CREATE TRIGGER test_force_inventory_return_failure
            BEFORE INSERT ON inventory_transactions WHEN NEW.transaction_type='RETURN'
            BEGIN SELECT RAISE(ABORT,'V21_05A_INJECTED_FAILURE'); END`);
        const failedCountsBefore = await get(db, `SELECT
            (SELECT COUNT(*) FROM returns) AS returns_count,
            (SELECT COUNT(*) FROM return_items) AS items_count,
            (SELECT COUNT(*) FROM store_credits) AS credits_count,
            (SELECT COUNT(*) FROM inventory_transactions WHERE transaction_type='RETURN') AS inventory_count`);
        await assert.rejects(() => saveReturn({ original_bill_no: "SALE-05A", customer_name: "05A Test",
            customer_mobile: "9999999999", return_reason: "Size / Fit Issue",
            items: [{ original_bill_item_id: originalIds[0], quantity: 1 }] }), /V21_05A_INJECTED_FAILURE/);
        await run(db, "DROP TRIGGER test_force_inventory_return_failure");
        assert.deepStrictEqual(await get(db, `SELECT
            (SELECT COUNT(*) FROM returns) AS returns_count,
            (SELECT COUNT(*) FROM return_items) AS items_count,
            (SELECT COUNT(*) FROM store_credits) AS credits_count,
            (SELECT COUNT(*) FROM inventory_transactions WHERE transaction_type='RETURN') AS inventory_count`), failedCountsBefore,
        "failure after item insert rolls back return cost metadata, Store Credit, and inventory together");

        const result = await saveReturn({ original_bill_no: "SALE-05A", customer_name: "05A Test",
            customer_mobile: "9999999999", return_reason: "Size / Fit Issue",
            items: [
                { original_bill_item_id: originalIds[0], quantity: 1 },
                { original_bill_item_id: originalIds[1], quantity: 1 }
            ] });
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.return_amount, 150);
        assert.strictEqual(result.gross_reversal, 150);
        assert.strictEqual(result.discount_reversal, 0);
        assert.strictEqual(result.taxable_reversal, 150);
        assert.strictEqual(result.gst_reversal, 0);
        assert.strictEqual(result.net_reversal, 150);

        const costRows = await all(db, `SELECT ri.original_bill_item_id,ri.quantity,ri.gross_reversal,
                ri.discount_reversal,ri.taxable_reversal,ri.gst_reversal,ri.net_reversal,
                ri.return_unit_cost_paise,ri.return_cost_paise,ri.return_cost_basis_status,
                ri.return_cost_source,ri.return_cost_method,bi.business_segment
            FROM return_items ri JOIN bill_items bi ON bi.id=ri.original_bill_item_id
            WHERE ri.return_id=? ORDER BY ri.id`, [result.return_id]);
        assert.strictEqual(costRows.length, 2);
        assert.deepStrictEqual(costRows[0], {
            original_bill_item_id: originalIds[0], quantity: 1, gross_reversal: 100,
            discount_reversal: 0, taxable_reversal: 100, gst_reversal: 0, net_reversal: 100,
            return_unit_cost_paise: 10000, return_cost_paise: 10000,
            return_cost_basis_status: "CAPTURED", return_cost_source: "PRODUCT_MASTER",
            return_cost_method: "ORIGINAL_SALE_TIME_COST_REVERSAL", business_segment: "KL"
        });
        assert.strictEqual(costRows[1].return_cost_basis_status, "UNKNOWN");
        assert.strictEqual(costRows[1].return_unit_cost_paise, null);
        assert.strictEqual(costRows[1].return_cost_paise, null);
        assert.strictEqual(costRows[1].business_segment, "MENS");
        assert.deepStrictEqual(await get(db, "SELECT unit_cost_paise,cost_basis_status,cost_source,cost_method FROM bill_items WHERE id=?", [originalIds[0]]), capturedBefore);

        const returnDate = await get(db, "SELECT business_date FROM returns WHERE id=?", [result.return_id]);
        assert.strictEqual(returnDate.business_date, getBusinessDate());
        const cogs = createReturnCogsService(db);
        const rows = await cogs.listCompletedReturnCogsReversals({ fromDate: returnDate.business_date, toDate: returnDate.business_date });
        assert.strictEqual(rows.length, 2);
        assert.strictEqual(rows[0].return_cost_paise, 10000);
        assert.strictEqual(rows[0].return_business_date, returnDate.business_date);
        assert.strictEqual(rows[0].business_segment, "KL");
        assert.strictEqual(rows[0].credit_note_no, result.credit_note_no);
        assert.strictEqual((await cogs.listCompletedReturnCogsReversals({
            fromDate: returnDate.business_date, toDate: returnDate.business_date, businessSegment: "MENS"
        })).length, 1);
        await assert.rejects(() => cogs.listCompletedReturnCogsReversals({
            fromDate: returnDate.business_date, toDate: returnDate.business_date, businessSegment: "COMMON"
        }), /valid Business Segment/);

        await run(db, `INSERT INTO returns
            (return_no,original_bill_no,customer_name,customer_mobile,return_reason,return_amount,created_at)
            VALUES ('LEGACY-05A','OLD-05A','Legacy','9999999998','Legacy',0,'now')`);
        const legacyId = (await get(db, "SELECT id FROM returns WHERE return_no='LEGACY-05A'")).id;
        await run(db, `INSERT INTO return_items (return_id,original_bill_item_id,quantity,unit_value,return_value,created_at)
            VALUES (?, ?, 1, 0, 0, 'now')`, [legacyId, originalIds[0]]);
        assert.strictEqual((await get(db, "SELECT return_cost_basis_status FROM return_items WHERE return_id=?", [legacyId])).return_cost_basis_status, "UNKNOWN");
        assert.strictEqual((await cogs.listCompletedReturnCogsReversals({ fromDate: returnDate.business_date, toDate: returnDate.business_date })).length, 2,
            "legacy/unassessed return does not enter completed return authority");

        const credit = await get(db, "SELECT original_amount,remaining_balance,status FROM store_credits WHERE return_id=?", [result.return_id]);
        assert.deepStrictEqual(credit, { original_amount: 150, remaining_balance: 150, status: "ISSUED" });
        assert.strictEqual((await get(db, "SELECT COUNT(*) AS count FROM customer_credit_transactions WHERE reference_id=?", [result.return_no])).count, 1);
        assert.strictEqual((await get(db, "SELECT SUM(quantity) AS quantity FROM inventory_transactions WHERE transaction_type='RETURN' AND reference_id=?", [result.return_no])).quantity, 2);

        await assert.rejects(() => saveReturn({ original_bill_no: "SALE-05A", customer_name: "05A Test",
            customer_mobile: "9999999999", return_reason: "Size / Fit Issue",
            items: [{ original_bill_item_id: originalIds[0], quantity: 1 }] }), /RETURN COMPLETED \/ FURTHER RETURNS NOT ALLOWED/);
        assert.strictEqual((await get(db, "SELECT COUNT(*) AS count FROM returns WHERE original_bill_no='SALE-05A'")).count, 1);
        await assert.rejects(() => run(db, "UPDATE return_items SET return_cost_paise=1 WHERE return_id=?", [result.return_id]), /KLBS_RETURN_ACCOUNTING_IMMUTABLE/);

        assert.deepStrictEqual(deriveReturnCostSnapshot({ cost_basis_status: "NOT_APPLICABLE" }, 1), {
            return_unit_cost_paise: null, return_cost_paise: null,
            return_cost_basis_status: "NOT_APPLICABLE", return_cost_source: null, return_cost_method: null
        });
        assert.deepStrictEqual(deriveReturnCostSnapshot({ cost_basis_status: "UNKNOWN" }, 1), {
            return_unit_cost_paise: null, return_cost_paise: null,
            return_cost_basis_status: "UNKNOWN", return_cost_source: null, return_cost_method: null
        });
    } finally {
        await close(db);
    }
}

async function main() {
    await testMigrationAndConstraints();
    await testReturnFlow();
    console.log("PASS V21-05A V7→V10 migration path (including V8 Return COGS), captured/unknown/not-applicable cost states, integer partial reversal, multi-line returns, source cost immutability, return-date/segment query, atomic rollback, legacy UNKNOWN, row immutability, unchanged return values/Store Credit/inventory, and one-return-per-bill rule");
}

main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
