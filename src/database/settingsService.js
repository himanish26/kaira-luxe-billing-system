const db = require("./database");

const {

    logSettingsChanged

} = require("./logService");

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

function saveSettings(settings) {

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
        settings.smtp_host !== undefined
            ? settings.smtp_host
            : current.smtp_host,

    smtp_port:
        settings.smtp_port !== undefined
            ? settings.smtp_port
            : current.smtp_port,

    smtp_secure:
        settings.smtp_secure !== undefined
            ? settings.smtp_secure
            : current.smtp_secure,

    smtp_user:
        settings.smtp_user !== undefined
            ? settings.smtp_user
            : current.smtp_user,

    smtp_password:
        settings.smtp_password !== undefined
            ? settings.smtp_password
            : current.smtp_password,

    smtp_from:
        settings.smtp_from !== undefined
            ? settings.smtp_from
            : current.smtp_from,

    ff_enabled:
        settings.ff_enabled !== undefined
            ? settings.ff_enabled
            : current.ff_enabled,

    ff_discount_percent:
        settings.ff_discount_percent !== undefined
            ? settings.ff_discount_percent
            : current.ff_discount_percent,

    ff_pin:
        settings.ff_pin !== undefined
            ? settings.ff_pin
            : current.ff_pin,

    last_updated:
        settings.last_updated !== undefined
            ? settings.last_updated
            : current.last_updated

};

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
                        
                        ff_pin = ?,

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

                        updated.ff_pin,

                        updated.last_updated

                    ],

                    function(err) {

                        if (err) {

                            reject(err);

                        }

                        else {

                            logSettingsChanged()
                                .catch(console.error);

                            resolve(true);

                        }

                    }

                );

            }

        );

    });

}

module.exports = {

    getSettings,

    saveSettings

};