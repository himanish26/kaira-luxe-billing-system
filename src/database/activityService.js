const db = require("./database");

const ACTIVITY_TIME_ZONE = "Asia/Kolkata";
const MAX_TEXT = 2000;
const MAX_CHANGE_DATA = 8192;
const MAX_CHANGES = 25;
const CATEGORIES = new Set([
    "SYSTEM", "SECURITY", "PRODUCT", "INVENTORY", "BILLING",
    "RETURN", "CREDIT NOTE", "STORE CREDIT", "GIFT VOUCHER",
    "SETTINGS", "BACKUP", "RESTORE", "DAY CLOSING", "PRINTING",
    "EXPORT", "ACTIVITY"
]);
const ACTORS = new Set(["SYSTEM", "OPERATOR", "MANAGER", "ADMINISTRATOR"]);
const STATUSES = new Set(["SUCCESS", "WARNING", "FAILED", "ERROR"]);
const SECRET_FIELD = /(pin|password|token|grant|salt|hash|verifier|secret|credential|oauth|smtp_password)/i;
const CHANGE_FIELDS = new Set([
    "active", "amount", "backup_location", "backup_schedule", "barcode",
    "brand", "card_amount", "cash_amount", "category", "collection",
    "cost_price", "default_printer", "discount", "ff_discount_percent",
    "ff_enabled", "gst_rate", "hsn_code", "invoice_no", "left_margin",
    "mrp", "opening_stock", "paper_width", "payment_status", "quantity",
    "reason", "receipt_footer_message", "receipt_message", "reference", "reorder_level", "right_margin",
    "season", "segment", "selling_price", "size", "sku", "status",
    "style_code", "supplier", "upi_amount", "valid_until"
]);

function boundedText(value, field, maxLength = MAX_TEXT, required = false) {
    const text = String(value === null || value === undefined ? "" : value).trim();
    if (required && !text) throw new Error(`Activity ${field} is required.`);
    return text.slice(0, maxLength) || null;
}

function sanitizeDetails(value) {
    const text = boundedText(value, "details", MAX_TEXT) || "";
    return text.replace(
        /\b(pin|password|token|grant|salt|hash|verifier|secret|credential|oauth|smtp_password)\b\s*[:=]\s*[^|,;\n]+/gi,
        "$1: [REDACTED]"
    ).replace(/(?:[A-Za-z]:\\|\/)[^\s|]+/g, "[PATH]");
}

function sanitizeReference(value) {
    const reference = boundedText(value, "reference_no", 128);
    if (!reference) return null;
    if (/^(?:[A-Za-z]:\\|\/)/.test(reference)) {
        return reference.split(/[\\/]/).filter(Boolean).pop().slice(0, 128);
    }
    return reference;
}

function canonicalValue(value, allowed, field) {
    const normalized = boundedText(value, field, 64, true).toUpperCase();
    if (!allowed.has(normalized)) throw new Error(`Unsupported Activity ${field}: ${normalized}`);
    return normalized;
}

function canonicalAction(value) {
    const action = boundedText(value, "action", 100, true)
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
    if (!action) throw new Error("Activity action is required.");
    return action;
}

function serializeChangeData(value) {
    if (value === null || value === undefined) return null;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Activity change_data must be a structured object.");
    }
    if (value.version !== 1 || !Array.isArray(value.changes)) {
        throw new Error("Activity change_data must use version 1 changes.");
    }
    if (value.changes.length > MAX_CHANGES) {
        throw new Error(`Activity change_data supports at most ${MAX_CHANGES} changes.`);
    }
    const changes = value.changes.map(change => {
        if (!change || typeof change !== "object" || Array.isArray(change)) {
            throw new Error("Activity change_data contains an invalid change.");
        }
        const field = boundedText(change.field, "change field", 64, true);
        const label = boundedText(change.label, "change label", 80, true);
        if (!/^[a-z][a-z0-9_]*$/i.test(field) || !CHANGE_FIELDS.has(field) ||
            SECRET_FIELD.test(field) || SECRET_FIELD.test(label)) {
            throw new Error("Activity change_data contains a disallowed field.");
        }
        const rawOld = boundedText(change.old, "old value", 256);
        const rawNew = boundedText(change.new, "new value", 256);
        const oldValue = rawOld === null ? null : sanitizeDetails(rawOld);
        const newValue = rawNew === null ? null : sanitizeDetails(rawNew);
        return { field, label, old: oldValue, new: newValue };
    });
    const serialized = JSON.stringify({ version: 1, changes });
    if (Buffer.byteLength(serialized, "utf8") > MAX_CHANGE_DATA) {
        throw new Error("Activity change_data exceeds the permitted size.");
    }
    return serialized;
}

function getActivityTimestamp(instant = new Date()) {
    const date = instant instanceof Date ? instant : new Date(instant);
    if (!Number.isFinite(date.getTime())) throw new Error("Invalid Activity timestamp.");
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-GB", {
            timeZone: ACTIVITY_TIME_ZONE,
            day: "2-digit", month: "short", year: "numeric",
            hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true
        }).formatToParts(date).filter(part => part.type !== "literal")
            .map(part => [part.type, part.value])
    );
    const kolkata = new Date(date.getTime() + 330 * 60 * 1000)
        .toISOString().replace("Z", "+05:30");
    return {
        activity_date: `${parts.day} ${parts.month} ${parts.year}`,
        activity_time: `${parts.hour}:${parts.minute}:${parts.second} ${parts.dayPeriod.toUpperCase()}`,
        created_at: kolkata
    };
}

function normalizeActivity(activity, instant = new Date()) {
    if (!activity || typeof activity !== "object" || Array.isArray(activity)) {
        throw new Error("Activity must be a backend-generated object.");
    }
    const timestamp = getActivityTimestamp(instant);
    return {
        ...timestamp,
        category: canonicalValue(activity.category, CATEGORIES, "category"),
        action: canonicalAction(activity.action),
        details: sanitizeDetails(activity.details),
        user_name: canonicalValue(activity.user_name || activity.actor, ACTORS, "actor"),
        status: canonicalValue(activity.status, STATUSES, "status"),
        entity_type: activity.entity_type
            ? boundedText(activity.entity_type, "entity_type", 64).toUpperCase()
            : null,
        reference_no: sanitizeReference(activity.reference_no),
        change_data: serializeChangeData(activity.change_data)
    };
}

async function logActivity(activity) {
    const normalized = normalizeActivity(activity);
    return new Promise((resolve, reject) => {
        db.run(`
            INSERT INTO activities (
                activity_date, activity_time, category, action, details,
                user_name, status, entity_type, reference_no, change_data, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            normalized.activity_date, normalized.activity_time,
            normalized.category, normalized.action, normalized.details,
            normalized.user_name, normalized.status, normalized.entity_type,
            normalized.reference_no, normalized.change_data, normalized.created_at
        ], function(error) {
            if (error) return reject(error);
            resolve({ success: true, id: this.lastID, activity: normalized });
        });
    });
}

async function getActivities() {
    return new Promise((resolve, reject) => {
        db.all("SELECT * FROM activities ORDER BY id DESC", [],
            (error, rows) => error ? reject(error) : resolve(rows));
    });
}

async function searchActivities(searchText) {
    const term = `%${String(searchText || "").slice(0, 200)}%`;
    return new Promise((resolve, reject) => {
        db.all(`
            SELECT * FROM activities
            WHERE activity_date LIKE ? OR activity_time LIKE ? OR category LIKE ?
               OR action LIKE ? OR details LIKE ? OR entity_type LIKE ?
               OR reference_no LIKE ? OR user_name LIKE ? OR status LIKE ?
            ORDER BY id DESC
        `, Array(9).fill(term),
        (error, rows) => error ? reject(error) : resolve(rows));
    });
}

async function archiveActivities(expectedCount) {
    const run = (sql, params = []) => new Promise((resolve, reject) => {
        db.run(sql, params, function(error) {
            error ? reject(error) : resolve({ changes: this.changes });
        });
    });
    const get = sql => new Promise((resolve, reject) => {
        db.get(sql, [], (error, row) => error ? reject(error) : resolve(row));
    });
    let started = false;
    try {
        await run("BEGIN IMMEDIATE TRANSACTION");
        started = true;
        const row = await get("SELECT COUNT(*) AS count FROM activities");
        if (Number(row.count) !== Number(expectedCount)) {
            throw new Error("Activity Log changed during archive export. Please retry.");
        }
        const deletion = await run("DELETE FROM activities");
        await run("COMMIT");
        started = false;
        return { success: true, deleted: deletion.changes };
    }
    catch (error) {
        if (started) await run("ROLLBACK").catch(() => {});
        throw error;
    }
}

module.exports = {
    logActivity,
    getActivities,
    searchActivities,
    archiveActivities,
    normalizeActivity,
    serializeChangeData,
    getActivityTimestamp,
    ACTIVITY_TIME_ZONE
};
