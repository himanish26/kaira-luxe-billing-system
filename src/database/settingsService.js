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
        fields: ["auto_backup_time"],
        action: "AUTO_BACKUP_TIME_UPDATED",
        reference: "AUTO_BACKUP_SETTINGS",
        details: "Automatic backup time changed",
        actor: "ADMINISTRATOR",
        auditFields: {
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

function buildSettingsActivity(current, updated, requested) {
    const changedFields = Object.keys(requested || {}).filter(field =>
        field !== "last_updated" && comparable(current[field]) !== comparable(updated[field])
    );
    if (!changedFields.length) return null;

    const group = SETTINGS_AUDIT_GROUPS.find(candidate =>
        changedFields.every(field => candidate.fields.includes(field))
    );
    if (!group) return null;

    const changes = changedFields.map(field => {
        const [auditField, label] = group.auditFields[field];
        return {
            field: auditField,
            label,
            old: current[field],
            new: updated[field]
        };
    });
    return {
        category: "SETTINGS",
        action: group.action,
        details: group.details,
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

                const settingsActivity = buildSettingsActivity(current, updated, settings);

                db.run(

                    `UPDATE settings

                    SET

                        receipt_message = ?,

                        default_printer = ?,

                        backup_location = ?,

                        auto_backup_time = ?,

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

module.exports = {

    getSettings,

    getRendererSettings,

    saveSettings,

    buildSettingsActivity,

    SETTINGS_AUDIT_GROUPS

};
