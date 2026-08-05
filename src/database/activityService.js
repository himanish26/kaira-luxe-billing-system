const db = require("./database");

/* ===========================================
   LOG ACTIVITY
=========================================== */

async function logActivity(activity) {

    const now = new Date();

const activityDate =
    now.toLocaleDateString("en-GB", {

        day: "2-digit",
        month: "short",
        year: "numeric"

    });

const activityTime =
    now.toLocaleTimeString("en-IN", {

        hour: "2-digit",
        minute: "2-digit",
        hour12: true

    });

    return new Promise((resolve, reject) => {

        db.run(

            `

            INSERT INTO activities (

                activity_date,
                activity_time,
                category,
                action,
                details,
                user_name,
                status

            )

            VALUES (?, ?, ?, ?, ?, ?, ?)

            `,

            [

                activityDate,
                activityTime,
                activity.category,
                activity.action,
                activity.details,
                activity.user_name,
                activity.status

            ],

            function (error) {

                if (error) {

                    return reject(error);

                }

                resolve({

                    success: true,

                    id: this.lastID

                });

            }

        );

    });

}

/* ===========================================
   GET ACTIVITIES
=========================================== */

async function getActivities() {

    return new Promise((resolve, reject) => {

        db.all(

            `

            SELECT *

            FROM activities

            ORDER BY id DESC

            `,

            [],

            (error, rows) => {

                if (error) {

                    return reject(error);

                }

                resolve(rows);

            }

        );

    });

}
/* ===========================================
   SEARCH ACTIVITIES
=========================================== */

async function searchActivities(searchText) {

    return new Promise((resolve, reject) => {

        db.all(

            `

            SELECT *

            FROM activities

            WHERE

                category LIKE ?

                OR action LIKE ?

                OR details LIKE ?

                OR user_name LIKE ?

            ORDER BY id DESC

            `,

            [

                `%${searchText}%`,
                `%${searchText}%`,
                `%${searchText}%`,
                `%${searchText}%`

            ],

            (error, rows) => {

                if (error) {

                    return reject(error);

                }

                resolve(rows);

            }

        );

    });

}

/* ===========================================
   ARCHIVE ACTIVITIES
=========================================== */

async function archiveActivities() {

    return new Promise((resolve, reject) => {

        db.run(

            `DELETE FROM activities`,

            [],

            function (error) {

                if (error) {

                    return reject(error);

                }

                resolve({

                    success: true,

                    deleted: this.changes

                });

            }

        );

    });

}

/* ===========================================
   MODULE EXPORTS
=========================================== */

module.exports = {

    logActivity,

    getActivities,
    
    searchActivities,
    
    archiveActivities

};