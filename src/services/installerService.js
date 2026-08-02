const fs = require("fs");

const { spawn } = require("child_process");

async function launchInstaller(installerPath) {

    if (!fs.existsSync(installerPath)) {

        throw new Error("Installer not found.");

    }

    const child = spawn(

        installerPath,

        [],

        {

            detached: true,

            stdio: "ignore"

        }

    );

    child.unref();

    return true;

}

module.exports = {

    launchInstaller

};