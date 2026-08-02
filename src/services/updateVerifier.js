const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const APP_FOLDER = path.join(

    app.getPath("userData")

);

const UPDATE_CACHE = path.join(

    APP_FOLDER,
    "UpdateCache"

);

const UPDATE_INFO = path.join(

    UPDATE_CACHE,
    "update.json"

);

async function verifyInstalledVersion() {

    try {

        if (!fs.existsSync(UPDATE_INFO)) {

            return;

        }

        const updateInfo = JSON.parse(

            fs.readFileSync(

                UPDATE_INFO,
                "utf8"

            )

        );

        const currentVersion = app.getVersion();

        if (

            currentVersion !== updateInfo.expectedVersion

        ) {

            console.log(

                "Update verification skipped."

            );

            return;

        }

        console.log(

            "Update verified successfully."

        );

        cleanupUpdateCache();

    }

    catch (error) {

        console.error(

            "Update verification failed:",

            error

        );

    }

}

function cleanupUpdateCache() {

    try {

        if (!fs.existsSync(UPDATE_CACHE)) {

            return;

        }

        const files = fs.readdirSync(

            UPDATE_CACHE

        );

        for (

            const file of files

        ) {

            fs.unlinkSync(

                path.join(

                    UPDATE_CACHE,

                    file

                )

            );

        }

        console.log(

            "Update cache cleaned."

        );

    }

    catch (error) {

        console.error(

            "Cleanup failed:",

            error

        );

    }

}

module.exports = {

    verifyInstalledVersion

};