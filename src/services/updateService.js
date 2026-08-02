const axios = require("axios");

const packageJson = require("../../package.json");

// Change this later to your actual GitHub URL
const UPDATE_URL =
    "https://raw.githubusercontent.com/himanish26/kaira-luxe-billing-system/main/updates/latest.json";

    function compareVersions(current, latest) {

    const normalize = version =>

        version

            .replace("-rc", ".-1.")

            .split(".")

            .map(part => {

                if (part === "-1") {

                    return -1;

                }

                return Number(part);

            });

    const currentParts =
        normalize(current);

    const latestParts =
        normalize(latest);

    const length = Math.max(

        currentParts.length,

        latestParts.length

    );

    for (

        let i = 0;

        i < length;

        i++

    ) {

        const currentValue =
            currentParts[i] ?? 0;

        const latestValue =
            latestParts[i] ?? 0;

        if (latestValue > currentValue) {

            return 1;

        }

        if (latestValue < currentValue) {

            return -1;

        }

    }

    return 0;

}

async function checkForUpdates() {

    try {

        const response =
            await axios.get(

                UPDATE_URL,

                {

                    timeout: 5000

                }

            );

        const latest =
            response.data;

            console.log("LATEST JSON FROM GITHUB");
            console.log(JSON.stringify(latest, null, 2));

        const currentVersion =
            packageJson.version;

        return {

            success: true,

            currentVersion,

            latestVersion:
                latest.version,

            updateAvailable:

    compareVersions(

        packageJson.version,

        latest.version

    ) === 1,

            updateInfo:
                latest

        };

    }

    catch (error) {

        return {

            success: false,

            message:
                error.message

        };

    }

}

module.exports = {

    checkForUpdates

};