"use strict";

function createSupplierInvoiceFormatProfileService(database, options = {}) {
    const run = (sql, params = []) => new Promise((resolve, reject) => database.run(sql, params, function (error) { error ? reject(error) : resolve({ lastID: this.lastID, changes: this.changes }); }));
    const all = (sql, params = []) => new Promise((resolve, reject) => database.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
    const now = options.now || (() => new Date());

    async function listForSupplier(supplierId) {
        const id = Number(supplierId);
        if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Select a valid supplier for this invoice.");
        return (await all("SELECT format_signature, sheet_name, header_row, headers_json, mapping_json, is_default, sort_order FROM supplier_invoice_format_profiles WHERE supplier_id=? ORDER BY sort_order ASC, is_default DESC, updated_at DESC", [id]))
            .map(row => ({ formatSignature: row.format_signature, sheetName: row.sheet_name, headerRow: Number(row.header_row), headers: JSON.parse(row.headers_json), mapping: JSON.parse(row.mapping_json), isDefault: Number(row.is_default) === 1, sortOrder: Number(row.sort_order) }));
    }

    async function save(input = {}) {
        const supplierId = Number(input.supplierId);
        const signature = String(input.formatSignature || "");
        const sheetName = String(input.sheetName || "").trim();
        const headerRow = Number(input.headerRow);
        const headers = Array.isArray(input.headers) ? input.headers.map(value => String(value ?? "").slice(0, 200)) : [];
        const mapping = input.mapping && typeof input.mapping === "object" && !Array.isArray(input.mapping) ? input.mapping : {};
        if (!Number.isSafeInteger(supplierId) || supplierId <= 0) throw new Error("Select a valid supplier before saving its invoice layout.");
        if (!/^[a-f0-9]{64}$/.test(signature) || !sheetName || !Number.isSafeInteger(headerRow) || headerRow <= 0) throw new Error("The supplier invoice layout could not be saved.");
        for (const field of ["barcode", "quantity", "mrp", "unitCost"]) {
            if (!Number.isSafeInteger(Number(mapping[field])) || Number(mapping[field]) < 0) throw new Error("Map Barcode, Quantity, Printed MRP and Invoice Rate before saving this supplier layout.");
        }
        if (new Set(["barcode", "quantity", "mrp", "unitCost"].map(field => Number(mapping[field]))).size !== 4) throw new Error("Required supplier invoice fields must use separate columns.");
        const timestamp = now().toISOString();
        const existing = await all("SELECT 1 FROM supplier_invoice_format_profiles WHERE supplier_id=? AND format_signature=?", [supplierId, signature]);
        const nextOrder = existing.length ? 0 : Number((await all("SELECT COALESCE(MAX(sort_order),-1)+1 AS next_order FROM supplier_invoice_format_profiles WHERE supplier_id=?", [supplierId]))[0]?.next_order || 0);
        const sql = "INSERT INTO supplier_invoice_format_profiles " +
            "(supplier_id,format_signature,sheet_name,header_row,headers_json,mapping_json,created_at,updated_at,sort_order) " +
            "VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(supplier_id,format_signature) DO UPDATE SET " +
            "sheet_name=excluded.sheet_name,header_row=excluded.header_row,headers_json=excluded.headers_json," +
            "mapping_json=excluded.mapping_json,updated_at=excluded.updated_at";
        await run(sql, [supplierId, signature, sheetName, headerRow, JSON.stringify(headers), JSON.stringify(mapping), timestamp, timestamp, nextOrder]);
        return { saved: true };
    }

    async function setDefault(input = {}) {
        const supplierId = Number(input.supplierId);
        const signature = String(input.formatSignature || "");
        if (!Number.isSafeInteger(supplierId) || supplierId <= 0 || !/^[a-f0-9]{64}$/.test(signature)) throw new Error("Select a saved invoice layout to make the supplier default.");
        const found = await all("SELECT 1 AS found FROM supplier_invoice_format_profiles WHERE supplier_id=? AND format_signature=?", [supplierId, signature]);
        if (!found.length) throw new Error("That invoice layout is no longer saved for this supplier. Refresh the Supplier profile.");
        const timestamp = now().toISOString();
        await run("BEGIN IMMEDIATE");
        try {
            await run("UPDATE supplier_invoice_format_profiles SET is_default=0, updated_at=? WHERE supplier_id=?", [timestamp, supplierId]);
            await run("UPDATE supplier_invoice_format_profiles SET is_default=1, updated_at=? WHERE supplier_id=? AND format_signature=?", [timestamp, supplierId, signature]);
            await run("COMMIT");
        } catch (error) {
            try { await run("ROLLBACK"); } catch (_) { /* Keep the original database error. */ }
            throw error;
        }
        return { isDefault: true };
    }

    async function resetForSupplier(supplierIdValue) {
        const supplierId = Number(supplierIdValue);
        if (!Number.isSafeInteger(supplierId) || supplierId <= 0) throw new Error("Select a valid supplier before resetting invoice layouts.");
        const result = await run("DELETE FROM supplier_invoice_format_profiles WHERE supplier_id=?", [supplierId]);
        return { reset: true, removed: Number(result.changes || 0) };
    }

    async function deleteLayout(supplierIdValue, signatureValue) {
        const supplierId = Number(supplierIdValue);
        const signature = String(signatureValue || "");
        if (!Number.isSafeInteger(supplierId) || supplierId <= 0 || !/^[a-f0-9]{64}$/.test(signature)) throw new Error("Select a saved supplier invoice format to delete.");
        const result = await run("DELETE FROM supplier_invoice_format_profiles WHERE supplier_id=? AND format_signature=?", [supplierId, signature]);
        return { deleted: Number(result.changes || 0) === 1 };
    }

    async function reorderLayouts(supplierIdValue, signaturesValue) {
        const supplierId = Number(supplierIdValue);
        const signatures = Array.isArray(signaturesValue) ? signaturesValue.map(value => String(value || "")) : [];
        if (!Number.isSafeInteger(supplierId) || supplierId <= 0 || signatures.some(value => !/^[a-f0-9]{64}$/.test(value)) || new Set(signatures).size !== signatures.length) throw new Error("The supplier invoice tab order is invalid.");
        const current = await all("SELECT format_signature FROM supplier_invoice_format_profiles WHERE supplier_id=?", [supplierId]);
        if (current.length !== signatures.length || current.some(row => !signatures.includes(row.format_signature))) throw new Error("The saved supplier invoice tabs changed. Reload them and try again.");
        await run("BEGIN IMMEDIATE");
        try {
            for (let index = 0; index < signatures.length; index++) await run("UPDATE supplier_invoice_format_profiles SET sort_order=?,updated_at=? WHERE supplier_id=? AND format_signature=?", [index, now().toISOString(), supplierId, signatures[index]]);
            await run("COMMIT");
        } catch (error) {
            try { await run("ROLLBACK"); } catch (_) { /* Keep the original database error. */ }
            throw error;
        }
        return { reordered: true };
    }

    return { listForSupplier, save, setDefault, resetForSupplier, deleteLayout, reorderLayouts };
}

module.exports = { createSupplierInvoiceFormatProfileService };
