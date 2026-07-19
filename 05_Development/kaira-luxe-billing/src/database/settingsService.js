const db = require("./database");

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

                last_updated = ?

             WHERE id = 1`,

            [

                settings.receipt_message,

                settings.last_updated

            ],

            function(err){

                if(err){

                    reject(err);

                }

                else{

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