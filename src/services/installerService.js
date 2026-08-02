const { shell } = require("electron");
const fs = require("fs");

async function launchInstaller(installerPath) {

    if (!fs.existsSync(installerPath)) {

        throw new Error("Installer not found.");

    }

    await shell.openPath(installerPath);

    return true;

}

module.exports = {

    launchInstaller

};