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

        db.run(

            `UPDATE settings

             SET

                receipt_message = ?,

                backup_location = ?,

                auto_backup_time = ?,

                last_updated = ?

            WHERE id = 1`,

            [
                settings.receipt_message,

                settings.backup_location,

                settings.auto_backup_time,

                settings.last_updated
            ],

            function(err){

                if(err){

                    reject(err);

                }

                else{

    logSettingsChanged()
        .catch(console.error);

    resolve(true);

}

            }

        );

    });

}

module.exports = {

    getSettings,

    saveSettings

};