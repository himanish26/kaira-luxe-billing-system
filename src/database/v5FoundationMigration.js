function run(database, sql, params = []) {
    return new Promise((resolve, reject) => {
        database.run(sql, params, function(error) {
            if (error) reject(error);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

function all(database, sql, params = []) {
    return new Promise((resolve, reject) => {
        database.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || []));
    });
}

function get(database, sql, params = []) {
    return new Promise((resolve, reject) => {
        database.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null));
    });
}

async function ensureColumn(database, table, name, definition) {
    const columns = await all(database, `PRAGMA table_info(${table})`);
    if (!columns.some(column => column.name === name)) {
        await run(database, `ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    }
}

async function rebuildCustomersForSharedMobiles(database) {
    const columns = await all(database, "PRAGMA table_info(customers)");
    if (!columns.length) throw new Error("V5 customer migration requires the customers table.");

    const createSql = await get(database, `
        SELECT sql FROM sqlite_master
        WHERE type = 'table' AND name = 'customers'
    `);
    if (!createSql) throw new Error("V5 customer migration cannot find the customers definition.");
    if (!/\bmobile\s+TEXT\s+UNIQUE\b/i.test(createSql.sql)) {
        const names = new Set(columns.map(column => column.name));
        if (names.has("birthday_ddmm") && names.has("marriage_anniversary_ddmm")) return;
        throw new Error("V5 customer migration cannot safely recognize the existing customers definition.");
    }

    const expectedColumns = ["id", "customer_code", "name", "mobile", "email", "address", "remarks", "active", "created_at", "updated_at"];
    if (columns.length !== expectedColumns.length || expectedColumns.some(name => !columns.some(column => column.name === name))) {
        throw new Error("V5 customer migration found an unexpected V4 customers column layout.");
    }
    const customObjects = await all(database, `
        SELECT type, name FROM sqlite_master
        WHERE tbl_name = 'customers' AND type IN ('index', 'trigger')
          AND name NOT LIKE 'sqlite_autoindex_%'
    `);
    const unexpectedObjects = customObjects.filter(object =>
        !(object.type === "index" && object.name === "idx_customers_mobile"));
    if (unexpectedObjects.length) {
        throw new Error("V5 customer migration found unrecognized customer indexes or triggers.");
    }
    const beforeRows = await all(database, `
        SELECT id, customer_code, name, mobile, email, address, remarks,
               active, created_at, updated_at
        FROM customers ORDER BY id
    `);

    const dependents = await all(database, `
        SELECT m.name AS table_name
        FROM sqlite_master m
        WHERE m.type = 'table' AND m.name <> 'customers'
    `);
    for (const dependent of dependents) {
        const foreignKeys = await all(database, `PRAGMA foreign_key_list("${dependent.table_name.replace(/"/g, '""')}")`);
        if (foreignKeys.some(key => String(key.table).toLowerCase() === "customers")) {
            throw new Error(`V5 customer migration found an existing foreign key to customers in ${dependent.table_name}.`);
        }
    }

    await run(database, `
        CREATE TABLE customers_v5_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_code TEXT UNIQUE,
            name TEXT NOT NULL,
            mobile TEXT,
            email TEXT,
            address TEXT,
            remarks TEXT,
            active INTEGER DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            birthday_ddmm TEXT,
            marriage_anniversary_ddmm TEXT,
            CHECK (birthday_ddmm IS NULL OR (
                length(birthday_ddmm) = 5 AND birthday_ddmm GLOB '[0-3][0-9]/[0-1][0-9]' AND
                CAST(substr(birthday_ddmm, 1, 2) AS INTEGER) BETWEEN 1 AND 31 AND
                CAST(substr(birthday_ddmm, 4, 2) AS INTEGER) BETWEEN 1 AND 12
            )),
            CHECK (marriage_anniversary_ddmm IS NULL OR (
                length(marriage_anniversary_ddmm) = 5 AND marriage_anniversary_ddmm GLOB '[0-3][0-9]/[0-1][0-9]' AND
                CAST(substr(marriage_anniversary_ddmm, 1, 2) AS INTEGER) BETWEEN 1 AND 31 AND
                CAST(substr(marriage_anniversary_ddmm, 4, 2) AS INTEGER) BETWEEN 1 AND 12
            ))
        )
    `);
    await run(database, `
        INSERT INTO customers_v5_new (
            id, customer_code, name, mobile, email, address, remarks,
            active, created_at, updated_at
        )
        SELECT id, customer_code, name, mobile, email, address, remarks,
               active, created_at, updated_at
        FROM customers
    `);
    const oldCount = await get(database, "SELECT COUNT(*) AS count FROM customers");
    const copiedCount = await get(database, "SELECT COUNT(*) AS count FROM customers_v5_new");
    if (Number(oldCount?.count) !== Number(copiedCount?.count)) {
        throw new Error("V5 customer rebuild row-count verification failed.");
    }
    const copiedRows = await all(database, `
        SELECT id, customer_code, name, mobile, email, address, remarks,
               active, created_at, updated_at
        FROM customers_v5_new ORDER BY id
    `);
    if (JSON.stringify(copiedRows) !== JSON.stringify(beforeRows)) {
        throw new Error("V5 customer rebuild value-preservation verification failed.");
    }
    await run(database, "DROP TABLE customers");
    await run(database, "ALTER TABLE customers_v5_new RENAME TO customers");
    await run(database, `
        CREATE INDEX IF NOT EXISTS idx_customers_mobile
        ON customers(mobile)
    `);
}

async function migrateV5Foundation(database) {
    await rebuildCustomersForSharedMobiles(database);

    await ensureColumn(database, "bills", "customer_id", "INTEGER REFERENCES customers(id)");
    await ensureColumn(database, "bill_items", "unit_cost_paise", "INTEGER CHECK (unit_cost_paise IS NULL OR unit_cost_paise >= 0)");
    await ensureColumn(database, "bill_items", "cost_basis_status", "TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (cost_basis_status IN ('UNKNOWN', 'CAPTURED', 'NOT_APPLICABLE'))");
    await ensureColumn(database, "bill_items", "cost_source", "TEXT");
    await ensureColumn(database, "bill_items", "cost_method", "TEXT");

    await run(database, `
        CREATE TABLE IF NOT EXISTS stock_movements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            movement_no TEXT NOT NULL UNIQUE,
            direction TEXT NOT NULL CHECK (direction IN ('INWARD', 'OUTWARD')),
            status TEXT NOT NULL DEFAULT 'DRAFT'
                CHECK (status IN ('DRAFT', 'PARTIALLY_POSTED', 'PENDING_MASTER', 'COMPLETE', 'CANCELLED')),
            supplier_id INTEGER,
            supplier_name TEXT,
            invoice_no TEXT,
            reference_text TEXT,
            business_date TEXT NOT NULL,
            reason TEXT,
            remarks TEXT,
            idempotency_key TEXT NOT NULL UNIQUE,
            posted_by TEXT,
            posted_at TEXT,
            cancelled_by TEXT,
            cancelled_at TEXT,
            cancel_reason TEXT,
            created_by TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    `);
    await run(database, `
        CREATE TABLE IF NOT EXISTS stock_movement_lines (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            movement_id INTEGER NOT NULL,
            barcode TEXT NOT NULL,
            scanned_quantity INTEGER NOT NULL CHECK (scanned_quantity > 0),
            recognized_quantity INTEGER NOT NULL DEFAULT 0
                CHECK (recognized_quantity >= 0 AND recognized_quantity <= scanned_quantity),
            product_id INTEGER,
            product_state TEXT NOT NULL DEFAULT 'PENDING_MASTER'
                CHECK (product_state IN ('READY', 'PENDING_MASTER')),
            posting_state TEXT NOT NULL DEFAULT 'UNPOSTED'
                CHECK (posting_state IN ('UNPOSTED', 'POSTED')),
            posted_quantity INTEGER NOT NULL DEFAULT 0
                CHECK (posted_quantity >= 0 AND posted_quantity <= recognized_quantity),
            inventory_transaction_id INTEGER,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE (movement_id, barcode),
            CHECK (
                (product_state = 'PENDING_MASTER' AND product_id IS NULL AND recognized_quantity = 0) OR
                (product_state = 'READY' AND product_id IS NOT NULL AND recognized_quantity > 0)
            ),
            CHECK (
                (posting_state = 'UNPOSTED' AND posted_quantity = 0) OR
                (posting_state = 'POSTED' AND posted_quantity = recognized_quantity)
            ),
            FOREIGN KEY (movement_id) REFERENCES stock_movements(id),
            FOREIGN KEY (product_id) REFERENCES products(id),
            FOREIGN KEY (inventory_transaction_id) REFERENCES inventory_transactions(id)
        )
    `);
    await run(database, `CREATE INDEX IF NOT EXISTS idx_stock_movements_date_status ON stock_movements(business_date, status)`);
    await run(database, `CREATE INDEX IF NOT EXISTS idx_stock_movements_invoice ON stock_movements(supplier_id, invoice_no)`);
    await run(database, `CREATE INDEX IF NOT EXISTS idx_stock_movement_lines_barcode_state ON stock_movement_lines(barcode, product_state, posting_state)`);
    await run(database, `CREATE INDEX IF NOT EXISTS idx_stock_movement_lines_product ON stock_movement_lines(product_id)`);
    await run(database, `
        CREATE TRIGGER IF NOT EXISTS trg_stock_movement_line_direction_insert
        BEFORE INSERT ON stock_movement_lines
        FOR EACH ROW
        WHEN (NEW.product_state = 'PENDING_MASTER' AND
              (SELECT direction FROM stock_movements WHERE id = NEW.movement_id) <> 'INWARD') OR
             (NEW.product_state = 'READY' AND NEW.product_id IS NULL) OR
             ((SELECT direction FROM stock_movements WHERE id = NEW.movement_id) = 'OUTWARD' AND
              (NEW.product_state <> 'READY' OR NEW.product_id IS NULL))
        BEGIN
            SELECT RAISE(ABORT, 'KLBS_STOCK_MOVEMENT_LINE_DIRECTION_INVALID');
        END
    `);
    await run(database, `
        CREATE TRIGGER IF NOT EXISTS trg_stock_movement_line_direction_update
        BEFORE UPDATE OF movement_id, product_state, product_id ON stock_movement_lines
        FOR EACH ROW
        WHEN (NEW.product_state = 'PENDING_MASTER' AND
              (SELECT direction FROM stock_movements WHERE id = NEW.movement_id) <> 'INWARD') OR
             (NEW.product_state = 'READY' AND NEW.product_id IS NULL) OR
             ((SELECT direction FROM stock_movements WHERE id = NEW.movement_id) = 'OUTWARD' AND
              (NEW.product_state <> 'READY' OR NEW.product_id IS NULL))
        BEGIN
            SELECT RAISE(ABORT, 'KLBS_STOCK_MOVEMENT_LINE_DIRECTION_INVALID');
        END
    `);
    await run(database, `
        CREATE TRIGGER IF NOT EXISTS trg_bill_item_cost_basis_insert
        BEFORE INSERT ON bill_items
        FOR EACH ROW
        WHEN (NEW.cost_basis_status = 'UNKNOWN' AND NEW.unit_cost_paise IS NOT NULL) OR
             (NEW.cost_basis_status = 'CAPTURED' AND
              (NEW.unit_cost_paise IS NULL OR NEW.cost_source IS NULL OR NEW.cost_method IS NULL)) OR
             (NEW.cost_basis_status = 'NOT_APPLICABLE' AND NEW.unit_cost_paise IS NOT NULL)
        BEGIN
            SELECT RAISE(ABORT, 'KLBS_BILL_ITEM_COST_BASIS_INVALID');
        END
    `);
    await run(database, `
        CREATE TRIGGER IF NOT EXISTS trg_bill_item_cost_basis_update
        BEFORE UPDATE OF unit_cost_paise, cost_basis_status, cost_source, cost_method ON bill_items
        FOR EACH ROW
        WHEN (NEW.cost_basis_status = 'UNKNOWN' AND NEW.unit_cost_paise IS NOT NULL) OR
             (NEW.cost_basis_status = 'CAPTURED' AND
              (NEW.unit_cost_paise IS NULL OR NEW.cost_source IS NULL OR NEW.cost_method IS NULL)) OR
             (NEW.cost_basis_status = 'NOT_APPLICABLE' AND NEW.unit_cost_paise IS NOT NULL)
        BEGIN
            SELECT RAISE(ABORT, 'KLBS_BILL_ITEM_COST_BASIS_INVALID');
        END
    `);

    await run(database, `
        CREATE TABLE IF NOT EXISTS expenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            expense_date TEXT NOT NULL,
            category TEXT NOT NULL,
            particulars TEXT NOT NULL,
            expense_class TEXT NOT NULL DEFAULT 'OPERATING' CHECK (expense_class = 'OPERATING'),
            amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
            payment_mode TEXT NOT NULL,
            paid_to TEXT,
            reference TEXT,
            business_segment TEXT NOT NULL
                CHECK (business_segment IN ('KL', 'MENS', 'KIDS', 'COMMON')),
            remarks TEXT,
            lifecycle_status TEXT NOT NULL DEFAULT 'ACTIVE'
                CHECK (lifecycle_status IN ('ACTIVE', 'VOID')),
            entered_by TEXT NOT NULL,
            last_modified_by TEXT,
            correction_reason TEXT,
            corrects_expense_id INTEGER UNIQUE,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            voided_by TEXT,
            voided_at TEXT,
            void_reason TEXT,
            FOREIGN KEY (corrects_expense_id) REFERENCES expenses(id)
        )
    `);
    await run(database, `CREATE INDEX IF NOT EXISTS idx_expenses_date_segment_status ON expenses(expense_date, business_segment, lifecycle_status)`);
    await run(database, `CREATE INDEX IF NOT EXISTS idx_expenses_category_date ON expenses(category, expense_date)`);
    await run(database, `
        CREATE TRIGGER IF NOT EXISTS trg_expenses_prevent_delete
        BEFORE DELETE ON expenses
        FOR EACH ROW
        BEGIN
            SELECT RAISE(ABORT, 'KLBS_EXPENSE_DELETE_PROHIBITED');
        END
    `);
}

module.exports = { migrateV5Foundation };
