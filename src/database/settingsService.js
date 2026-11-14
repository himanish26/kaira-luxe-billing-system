const db = require("./database");
const { logActivity } = require("./activityService");

const SETTINGS_AUDIT_GROUPS = Object.freeze([
    {
        fields: ["receipt_message"],
        action: "RECEIPT_FOOTER_UPDATED",
        reference: "RECEIPT_SETTINGS",
        details: "Receipt footer message changed",
        actor: "ADMINISTRATOR",
        auditFields: {
            receipt_message: ["receipt_footer_message", "Receipt Footer Message"]
        }
    },
    {
        fields: ["default_printer"],
        action: "PRINTER_SETTINGS_UPDATED",
        reference: "PRINTER_SETTINGS",
        details: "Default printer changed",
        actor: "OPERATOR",
        auditFields: {
            default_printer: ["default_printer", "Default Printer"]
        }
    },
    {
        fields: ["backup_location"],
        action: "BACKUP_LOCATION_UPDATED",
        reference: "BACKUP_SETTINGS",
        details: "Backup location changed",
        actor: "ADMINISTRATOR",
        auditFields: {
            backup_location: ["backup_location", "Backup Location"]
        }
    },
    {
        fields: ["auto_backup_enabled", "auto_backup_frequency", "auto_backup_time"],
        action: "AUTO_BACKUP_SETTINGS_UPDATED",
        reference: "AUTO_BACKUP_SETTINGS",
        details: "Automatic backup settings changed",
        actor: "ADMINISTRATOR",
        auditFields: {
            // Keep this payload within the established Activity Log allowlist.
            // The audit values still identify the effective automatic-backup setting.
            auto_backup_enabled: ["active", "Automatic Backup Enabled"],
            auto_backup_frequency: ["backup_schedule", "Automatic Backup Frequency"],
            auto_backup_time: ["backup_schedule", "Automatic Backup Time"]
        }
    },
    {
        fields: ["ff_enabled", "ff_discount_percent"],
        action: "FAMILY_FRIENDS_SETTINGS_UPDATED",
        reference: "FAMILY_FRIENDS_SETTINGS",
        details: "Family & Friends settings changed",
        actor: "ADMINISTRATOR",
        auditFields: {
            ff_enabled: ["ff_enabled", "Family & Friends Enabled"],
            ff_discount_percent: ["ff_discount_percent", "Family & Friends Discount Percent"]
        }
    }
]);

const comparable = value => value === null || value === undefined ? "" : String(value);
const VALID_AUTO_BACKUP_FREQUENCIES = new Set([
    "DAILY",
    "EVERY_6_HOURS",
    "EVERY_3_HOURS",
    "EVERY_1_HOUR"
]);

function buildSettingsActivity(current, updated, requested) {
    const changedFields = Object.keys(requested || {}).filter(field =>
        field !== "last_updated" && comparable(current[field]) !== comparable(updated[field])
    );
    const automaticBackupRequested = Object.keys(requested || {}).some(field =>
        ["auto_backup_enabled", "auto_backup_frequency", "auto_backup_time"].includes(field)
    );
    if (!changedFields.length && !automaticBackupRequested) return null;

    const group = SETTINGS_AUDIT_GROUPS.find(candidate =>
        (changedFields.length
            ? changedFields.every(field => candidate.fields.includes(field))
            : candidate.action === "AUTO_BACKUP_SETTINGS_UPDATED")
    );
    if (!group) return null;

    const activityFields = changedFields.length
        ? changedFields
        : ["auto_backup_enabled", "auto_backup_frequency", "auto_backup_time"]
            .filter(field => Object.prototype.hasOwnProperty.call(requested, field));
    const changes = activityFields.map(field => {
        const [auditField, label] = group.auditFields[field];
        return {
            field: auditField,
            label,
            old: current[field],
            new: updated[field]
        };
    });
    const automaticBackup = group.action === "AUTO_BACKUP_SETTINGS_UPDATED";
    const automaticDetails = automaticBackup
        ? formatAutomaticBackupDetails(updated)
        : group.details;
    return {
        category: "SETTINGS",
        action: group.action,
        details: automaticDetails,
        user_name: group.actor,
        status: "SUCCESS",
        entity_type: "SETTINGS",
        reference_no: group.reference,
        change_data: { version: 1, changes }
    };
}

function getSettings() {

    return new Promise((resolve, reject) => {

        db.get(

            `SELECT * FROM settings WHERE id = 1`,

            (err, row) => {

                if (err) {

                    reject(err);

                } else {

                    resolve(row);

                }

            }

        );

    });

}

function getRendererSettings() {

    return getSettings().then(settings => {

        if (!settings) {
            return settings;
        }

        const {
            ff_pin,
            admin_pin_hash,
            // Deprecated R09.6B compatibility field; never returned or written.
            admin_password_hash,
            admin_security_initialized,
            manager_pin_hash,
            manager_security_initialized,
            pin_permissions_json,
            smtp_password,
            ...safeSettings
        } = settings;

        return safeSettings;

    });

}

function saveSettings(settings, options = {}) {

    const writeActivity = options.logActivity || logActivity;

    return new Promise((resolve, reject) => {

        db.get(
            `SELECT * FROM settings WHERE id = 1`,
            [],
            (getErr, current) => {

                if (getErr) {

                    reject(getErr);

                    return;

                }

                const updated = {

    receipt_message:
        settings.receipt_message !== undefined
            ? settings.receipt_message
            : current.receipt_message,

    default_printer:
        settings.default_printer !== undefined
            ? settings.default_printer
            : current.default_printer,

    backup_location:
        settings.backup_location !== undefined
            ? settings.backup_location
            : current.backup_location,

    auto_backup_time:
        settings.auto_backup_time !== undefined
            ? settings.auto_backup_time
            : current.auto_backup_time,

    auto_backup_enabled:
        settings.auto_backup_enabled !== undefined
            ? (Number(settings.auto_backup_enabled) === 1 ? 1 : 0)
            : (current.auto_backup_enabled === 0 ? 0 : 1),

    auto_backup_frequency:
        settings.auto_backup_frequency !== undefined
            ? String(settings.auto_backup_frequency)
            : (VALID_AUTO_BACKUP_FREQUENCIES.has(String(current.auto_backup_frequency))
                ? current.auto_backup_frequency
                : "DAILY"),

    auto_backup_last_success_at: current.auto_backup_last_success_at || null,

    smtp_host:
        current.smtp_host,

    smtp_port:
        current.smtp_port,

    smtp_secure:
        current.smtp_secure,

    smtp_user:
        current.smtp_user,

    smtp_password:
        current.smtp_password,

    smtp_from:
        current.smtp_from,

    ff_enabled:
        settings.ff_enabled !== undefined
            ? settings.ff_enabled
            : current.ff_enabled,

    ff_discount_percent:
        settings.ff_discount_percent !== undefined
            ? settings.ff_discount_percent
            : current.ff_discount_percent,

    last_updated:
        settings.last_updated !== undefined
            ? settings.last_updated
            : current.last_updated

};

                if (!VALID_AUTO_BACKUP_FREQUENCIES.has(updated.auto_backup_frequency)) {
                    reject(new Error("Unsupported automatic backup frequency."));
                    return;
                }

                const settingsActivity = buildSettingsActivity(current, updated, settings);

                db.run(

                    `UPDATE settings

                    SET

                        receipt_message = ?,

                        default_printer = ?,

                        backup_location = ?,

                        auto_backup_time = ?,

                        auto_backup_enabled = ?,

                        auto_backup_frequency = ?,

                        auto_backup_last_success_at = ?,

                        smtp_host = ?,

                        smtp_port = ?,

                        smtp_secure = ?,

                        smtp_user = ?,

                        smtp_password = ?,

                        smtp_from = ?,

                        ff_enabled = ?,
                        
                        ff_discount_percent = ?,

                        last_updated = ?

                    WHERE id = 1`,

                    [

                        updated.receipt_message,

                        updated.default_printer,

                        updated.backup_location,

                        updated.auto_backup_time,

                        updated.auto_backup_enabled,

                        updated.auto_backup_frequency,

                        updated.auto_backup_last_success_at,

                        updated.smtp_host,

                        updated.smtp_port,

                        updated.smtp_secure,

                        updated.smtp_user,

                        updated.smtp_password,

                        updated.smtp_from,

                        updated.ff_enabled,

                        updated.ff_discount_percent,

                        updated.last_updated

                    ],

                    async function(err) {

                        if (err) {

                            reject(err);

                        }

                        else {

                            let activityWarning = null;
                            if (settingsActivity) {
                                try {
                                    await writeActivity(settingsActivity);
                                }
                                catch (logError) {
                                    activityWarning =
                                        "Settings were saved, but the Activity Log event could not be recorded.";
                                    console.error(
                                        "Settings activity logging failed:",
                                        logError.message
                                    );
                                }
                            }

                            resolve({
                                success: true,
                                changed: Boolean(settingsActivity),
                                activityWarning
                            });

                        }

                    }

                );

            }

        );

    });

}

function saveStockDocumentPrintSettings(settings = {}) {
    const allowedFields = [
        "stock_inward_printer",
        "stock_inward_print_profile",
        "stock_outward_printer",
        "stock_outward_print_profile"
    ];
    const update = {};
    for (const field of allowedFields) {
        if (Object.prototype.hasOwnProperty.call(settings, field)) update[field] = settings[field];
    }
    if (!Object.keys(update).length) throw new Error("Choose a Stock Inward or Stock Outward print setting to save.");
    for (const field of ["stock_inward_print_profile", "stock_outward_print_profile"]) {
        if (Object.prototype.hasOwnProperty.call(update, field) && !["THERMAL", "A4"].includes(update[field])) {
            throw new Error("Unsupported stock document print layout.");
        }
    }
    for (const field of ["stock_inward_printer", "stock_outward_printer"]) {
        if (Object.prototype.hasOwnProperty.call(update, field) &&
            (typeof update[field] !== "string" || update[field].trim().length > 300)) {
            throw new Error("Choose a valid printer for the stock document.");
        }
        if (Object.prototype.hasOwnProperty.call(update, field)) update[field] = update[field].trim() || null;
    }
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM settings WHERE id = 1", [], (getError, current) => {
            if (getError) return reject(getError);
            if (!current) return reject(new Error("KLBS settings could not be loaded."));
            const columns = Object.keys(update);
            const changed = columns.filter(column => comparable(current[column]) !== comparable(update[column]));
            if (!changed.length) {
                return resolve({ success: true, changed: false, activityWarning: null });
            }
            const assignments = columns.map(column => `${column} = ?`).join(", ");
            db.run(`UPDATE settings SET ${assignments}, last_updated = ? WHERE id = 1`,
                [...columns.map(column => update[column]), new Date().toISOString()], async error => {
                    if (error) return reject(error);
                    let activityWarning = null;
                    const details = changed.map(column => {
                        const label = column.includes("inward") ? "Stock Inward" : "Stock Outward";
                        return `${label} ${column.endsWith("printer") ? "printer" : "paper layout"}: ${update[column] || "KLBS default"}`;
                    }).join("; ");
                    try {
                        await logActivity({ category: "PRINTING", action: "STOCK_DOCUMENT_PRINTER_SETTINGS_UPDATED",
                            details, user_name: "OPERATOR", status: "SUCCESS", entity_type: "PRINT_SETTINGS",
                            reference_no: "STOCK_DOCUMENT_PRINT_SETTINGS" });
                    } catch (logError) {
                        activityWarning = "Print routing was saved, but its Activity Log entry could not be recorded.";
                    }
                    resolve({ success: true, changed: true, activityWarning });
                });
        });
    });
}

const DEVICE_PREVIEW_TYPES = new Set([
    "tax-invoice", "store-credit", "day-closing", "printer-test", "credit-note",
    "stock-inward", "stock-outward", "stock-inward-a4", "stock-outward-a4"
]);
const DEVICE_PREVIEW_FONTS = new Set(["arial", "georgia", "trebuchet", "verdana", "times", "courier"]);

function saveDevicePrintPreviewSettings(input = {}) {
    const documentType = String(input.documentType || "");
    if (!DEVICE_PREVIEW_TYPES.has(documentType)) throw new Error("Unsupported print preview document.");
    const source = input.settings || {};
    if (!DEVICE_PREVIEW_FONTS.has(source.font)) throw new Error("Unsupported print preview font.");
    const size = Number(source.size);
    if (!Number.isFinite(size) || size < 9 || size > 18) throw new Error("Preview text size must be between 9 and 18 pixels.");
    const margins = {};
    for (const side of ["top", "right", "bottom", "left"]) {
        const margin = Number(source.margins?.[side]);
        if (!Number.isFinite(margin) || margin < 0 || margin > 12) throw new Error("Preview margins must be between 0 and 12 millimetres.");
        margins[side] = margin;
    }
    const preference = { font: source.font, size, margins };
    return new Promise((resolve, reject) => {
        db.get("SELECT device_print_preview_settings FROM settings WHERE id = 1", [], (getError, row) => {
            if (getError) return reject(getError);
            let allPreferences = {};
            try {
                const parsed = JSON.parse(row?.device_print_preview_settings || "{}");
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) allPreferences = parsed;
            } catch { allPreferences = {}; }
            const existing = allPreferences[documentType];
            const unchanged = existing && existing.font === preference.font && Number(existing.size) === preference.size &&
                ["top", "right", "bottom", "left"].every(side => Number(existing.margins?.[side]) === margins[side]);
            if (unchanged) {
                return resolve({ success: true, changed: false, preference: existing, allPreferences, activityWarning: null });
            }
            allPreferences[documentType] = preference;
            const serialized = JSON.stringify(allPreferences);
            db.run("UPDATE settings SET device_print_preview_settings = ?, last_updated = ? WHERE id = 1",
                [serialized, new Date().toISOString()], async error => {
                    if (error) return reject(error);
                    let activityWarning = null;
                    try {
                        await logActivity({ category: "PRINTING", action: "PRINT_PREVIEW_SETTINGS_SAVED",
                            details: `Saved ${documentType} preview: ${preference.font}, ${size}px text, margins ${margins.top}/${margins.right}/${margins.bottom}/${margins.left} mm (top/right/bottom/left).`,
                            user_name: "OPERATOR", status: "SUCCESS", entity_type: "PRINT_PREVIEW",
                            reference_no: documentType.toUpperCase().replace(/-/g, "_") });
                    } catch {
                        activityWarning = "Preview settings were saved, but their Activity Log entry could not be recorded.";
                    }
                    resolve({ success: true, changed: true, preference, allPreferences, activityWarning });
                });
        });
    });
}

function formatAutomaticBackupDetails(settings) {
    if (Number(settings.auto_backup_enabled) !== 1) return "Automatic Backup: OFF";
    const labels = {
        DAILY: "Daily",
        EVERY_6_HOURS: "Every 6 Hours",
        EVERY_3_HOURS: "Every 3 Hours",
        EVERY_1_HOUR: "Every 1 Hour"
    };
    const frequency = labels[String(settings.auto_backup_frequency)] || "Daily";
    const time = String(settings.auto_backup_time || "").trim();
    return `Automatic Backup: ON, Frequency: ${frequency}` +
        (String(settings.auto_backup_frequency) === "DAILY" && time
            ? `, Time: ${formatAutomaticBackupTime(time)}`
            : "");
}

function formatAutomaticBackupTime(value) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value);
    if (!match) return value;
    const hour = Number(match[1]);
    const minute = match[2];
    if (hour < 0 || hour > 23) return value;
    return `${String(hour % 12 || 12).padStart(2, "0")}:${minute} ${hour >= 12 ? "PM" : "AM"}`;
}

function recordScheduledBackupSuccess(timestamp = new Date().toISOString()) {
    return new Promise((resolve, reject) => {
        db.run(
            `UPDATE settings SET auto_backup_last_success_at = ?, last_updated = ? WHERE id = 1`,
            [timestamp, timestamp],
            error => error ? reject(error) : resolve()
        );
    });
}

module.exports = {

    getSettings,

    getRendererSettings,

    saveSettings,

    saveStockDocumentPrintSettings,

    saveDevicePrintPreviewSettings,

    recordScheduledBackupSuccess,

    buildSettingsActivity,

    SETTINGS_AUDIT_GROUPS

};
