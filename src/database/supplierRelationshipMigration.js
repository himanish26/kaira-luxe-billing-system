"use strict";

function run(db, sql) {
    return new Promise((resolve, reject) => db.run(sql, error => error ? reject(error) : resolve()));
}

async function migrateSupplierRelationships(db) {
    const table = await new Promise((resolve, reject) => db.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='supplier_master'",
        [], (error, row) => error ? reject(error) : resolve(row || null)));
    if (!table) throw new Error("V12 Supplier relationship migration requires V10 Supplier tables.");

    // V11 has independent value lists, not relationship tuples. Preserve those
    // rows as legacy data and never infer tuple membership from them.
    await run(db, `CREATE TABLE supplier_relationship_sequences (
        id INTEGER PRIMARY KEY CHECK(id=1),
        next_brand_sequence INTEGER NOT NULL CHECK(next_brand_sequence BETWEEN 1 AND 1000000),
        next_product_segment_sequence INTEGER NOT NULL CHECK(next_product_segment_sequence BETWEEN 1 AND 1000000),
        next_relationship_sequence INTEGER NOT NULL CHECK(next_relationship_sequence BETWEEN 1 AND 1000000)
    )`);
    await run(db, "INSERT INTO supplier_relationship_sequences VALUES(1,1,1,1)");
    await run(db, `CREATE TABLE supplier_brand_master (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        brand_code TEXT NOT NULL UNIQUE CHECK(length(brand_code)=11 AND brand_code GLOB 'KLSBR[0-9][0-9][0-9][0-9][0-9][0-9]'),
        display_name TEXT NOT NULL CHECK(length(trim(display_name)) BETWEEN 1 AND 100),
        normalized_name TEXT NOT NULL UNIQUE CHECK(length(trim(normalized_name)) BETWEEN 1 AND 100),
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )`);
    await run(db, `CREATE TABLE supplier_product_segment_master (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_segment_code TEXT NOT NULL UNIQUE CHECK(length(product_segment_code)=11 AND product_segment_code GLOB 'KLSPS[0-9][0-9][0-9][0-9][0-9][0-9]'),
        display_name TEXT NOT NULL CHECK(length(trim(display_name)) BETWEEN 1 AND 100),
        normalized_name TEXT NOT NULL UNIQUE CHECK(length(trim(normalized_name)) BETWEEN 1 AND 100),
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )`);
    await run(db, `CREATE TABLE supplier_relationships (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        relationship_code TEXT NOT NULL UNIQUE CHECK(length(relationship_code)=12 AND relationship_code GLOB 'KLSREL[0-9][0-9][0-9][0-9][0-9][0-9]'),
        supplier_id INTEGER NOT NULL REFERENCES supplier_master(id),
        brand_id INTEGER NOT NULL REFERENCES supplier_brand_master(id),
        product_segment_id INTEGER NOT NULL REFERENCES supplier_product_segment_master(id),
        business_segment TEXT NOT NULL CHECK(business_segment IN ('KL','MENS','KIDS')),
        status TEXT NOT NULL CHECK(status IN ('ACTIVE','INACTIVE')),
        effective_from TEXT NOT NULL CHECK(length(effective_from)=10 AND effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        effective_to TEXT CHECK(effective_to IS NULL OR (length(effective_to)=10 AND effective_to GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK((status='ACTIVE' AND effective_to IS NULL) OR (status='INACTIVE' AND effective_to IS NOT NULL)),
        CHECK(effective_to IS NULL OR effective_to>=effective_from)
    )`);
    await run(db, "CREATE UNIQUE INDEX idx_supplier_relationship_active_tuple ON supplier_relationships(supplier_id,brand_id,product_segment_id,business_segment) WHERE status='ACTIVE' AND effective_to IS NULL");
    await run(db, "CREATE INDEX idx_supplier_relationship_brand_active ON supplier_relationships(brand_id,supplier_id,status,effective_from)");
    await run(db, "CREATE INDEX idx_supplier_relationship_supplier_history ON supplier_relationships(supplier_id,status,effective_from,relationship_code)");
    await run(db, `CREATE TRIGGER trg_supplier_relationship_sequence_monotonic BEFORE UPDATE ON supplier_relationship_sequences
        WHEN NEW.id<>OLD.id OR NEW.next_brand_sequence<OLD.next_brand_sequence OR NEW.next_product_segment_sequence<OLD.next_product_segment_sequence OR NEW.next_relationship_sequence<OLD.next_relationship_sequence
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_RELATIONSHIP_SEQUENCE_CANNOT_REWIND'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_relationship_sequence_no_delete BEFORE DELETE ON supplier_relationship_sequences
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_RELATIONSHIP_SEQUENCE_DELETE_PROHIBITED'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_brand_code_sequence BEFORE INSERT ON supplier_brand_master
        WHEN NOT EXISTS(SELECT 1 FROM supplier_relationship_sequences WHERE id=1 AND next_brand_sequence>1 AND CAST(SUBSTR(NEW.brand_code,6) AS INTEGER)=next_brand_sequence-1)
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_BRAND_SEQUENCE_REQUIRED'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_product_segment_code_sequence BEFORE INSERT ON supplier_product_segment_master
        WHEN NOT EXISTS(SELECT 1 FROM supplier_relationship_sequences WHERE id=1 AND next_product_segment_sequence>1 AND CAST(SUBSTR(NEW.product_segment_code,6) AS INTEGER)=next_product_segment_sequence-1)
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_PRODUCT_SEGMENT_SEQUENCE_REQUIRED'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_relationship_code_sequence BEFORE INSERT ON supplier_relationships
        WHEN NOT EXISTS(SELECT 1 FROM supplier_relationship_sequences WHERE id=1 AND next_relationship_sequence>1 AND CAST(SUBSTR(NEW.relationship_code,7) AS INTEGER)=next_relationship_sequence-1)
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_RELATIONSHIP_CODE_SEQUENCE_REQUIRED'); END`);
    for (const [tableName, codeColumn] of [["supplier_brand_master", "brand_code"], ["supplier_product_segment_master", "product_segment_code"]]) {
        await run(db, `CREATE TRIGGER trg_${tableName}_identity_immutable BEFORE UPDATE ON ${tableName}
            WHEN NEW.id<>OLD.id OR NEW.${codeColumn}<>OLD.${codeColumn} OR NEW.display_name<>OLD.display_name OR NEW.normalized_name<>OLD.normalized_name OR NEW.created_at<>OLD.created_at
            BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_VOCABULARY_IDENTITY_IMMUTABLE'); END`);
        await run(db, `CREATE TRIGGER trg_${tableName}_prevent_delete BEFORE DELETE ON ${tableName}
            BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_VOCABULARY_DELETE_PROHIBITED'); END`);
    }
    await run(db, `CREATE TRIGGER trg_supplier_relationship_no_overlap BEFORE INSERT ON supplier_relationships
        WHEN EXISTS(SELECT 1 FROM supplier_relationships r WHERE r.supplier_id=NEW.supplier_id AND r.brand_id=NEW.brand_id AND r.product_segment_id=NEW.product_segment_id AND r.business_segment=NEW.business_segment
            AND NEW.effective_from<=COALESCE(r.effective_to,'9999-12-31') AND r.effective_from<=COALESCE(NEW.effective_to,'9999-12-31'))
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_RELATIONSHIP_PERIOD_OVERLAP'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_relationship_identity_immutable BEFORE UPDATE ON supplier_relationships
        WHEN NEW.id<>OLD.id OR NEW.relationship_code<>OLD.relationship_code OR NEW.supplier_id<>OLD.supplier_id OR NEW.brand_id<>OLD.brand_id OR NEW.product_segment_id<>OLD.product_segment_id OR NEW.business_segment<>OLD.business_segment OR NEW.effective_from<>OLD.effective_from OR NEW.created_at<>OLD.created_at
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_RELATIONSHIP_IDENTITY_IMMUTABLE'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_relationship_end_only BEFORE UPDATE ON supplier_relationships
        WHEN NOT (OLD.status='ACTIVE' AND OLD.effective_to IS NULL AND NEW.status='INACTIVE' AND NEW.effective_to IS NOT NULL AND NEW.effective_to>=OLD.effective_from)
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_RELATIONSHIP_LIFECYCLE_INVALID'); END`);
    await run(db, `CREATE TRIGGER trg_supplier_relationship_prevent_delete BEFORE DELETE ON supplier_relationships
        BEGIN SELECT RAISE(ABORT,'KLBS_SUPPLIER_RELATIONSHIP_DELETE_PROHIBITED'); END`);
}

module.exports = { migrateSupplierRelationships };
