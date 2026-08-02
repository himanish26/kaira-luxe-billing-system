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

        console.log("UPDATE_URL =", UPDATE_URL);

        const response = await axios.get(


    UPDATE_URL,

    {

        headers: {

            "Cache-Control": "no-cache",

            "Pragma": "no-cache"

        },

        params: {

            t: Date.now()

        }

    }

);

        const latest =
            response.data;

            console.log("LATEST JSON FROM GITHUB");
            console.log("Response Keys:");

console.log(Object.keys(latest));

console.log("Raw Response:");

console.dir(latest, { depth: null });

console.log("SHA256 =", latest.sha256);

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