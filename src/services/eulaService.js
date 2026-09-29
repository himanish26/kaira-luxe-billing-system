const fs = require("fs");
const path = require("path");

const UNAVAILABLE_MESSAGE = "The license agreement is unavailable. Please try again later.";

function readAuthoritativeEula({ isPackaged, appPath, mainDirectory, readFileSync = fs.readFileSync }) {
    try {
        const eulaPath = isPackaged
            ? path.join(appPath, "EULA.txt")
            : path.resolve(mainDirectory, "..", "..", "EULA.txt");
        const text = readFileSync(eulaPath, "utf8");

        if (typeof text !== "string" || !text.trim()) {
            return { success: false, message: UNAVAILABLE_MESSAGE };
        }

        return { success: true, text };
    }
    catch (_) {
        return { success: false, message: UNAVAILABLE_MESSAGE };
    }
}

module.exports = { readAuthoritativeEula, UNAVAILABLE_MESSAGE };
