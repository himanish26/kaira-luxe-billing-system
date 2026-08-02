const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DIST_FOLDER = path.join(__dirname, "..", "dist");

const UPDATE_JSON = path.join(
    __dirname,
    "..",
    "updates",
    "latest.json"
);

function getLatestInstaller() {

    const installers = fs.readdirSync(DIST_FOLDER)

        .filter(file =>
            file.toLowerCase().endsWith(".exe")
        )

        .map(file => ({

            file,

            fullPath: path.join(DIST_FOLDER, file),

            modified: fs.statSync(
                path.join(DIST_FOLDER, file)
            ).mtimeMs

        }))

        .sort(
            (a, b) =>
                b.modified - a.modified
        );

    if (installers.length === 0) {

        throw new Error(
            "No installer (.exe) found in dist folder."
        );

    }

    return installers[0];

}

function sha256(filePath) {

    return new Promise(

        (resolve, reject) => {

            const hash = crypto.createHash("sha256");

            const stream = fs.createReadStream(filePath);

            stream.on(
                "data",
                data => hash.update(data)
            );

            stream.on(
                "end",
                () => resolve(
                    hash.digest("hex")
                )
            );

            stream.on(
                "error",
                reject
            );

        }

    );

}

async function main() {

    const installer = getLatestInstaller();

    console.log(
        "Installer:",
        installer.file
    );

    const hash = await sha256(
        installer.fullPath
    );

    console.log(
        "SHA256:",
        hash
    );

    const json = JSON.parse(

        fs.readFileSync(
            UPDATE_JSON,
            "utf8"
        )

    );

    const packageJson = JSON.parse(

    fs.readFileSync(

        path.join(

            __dirname,

            "..",

            "package.json"

        ),

        "utf8"

    )

);

json.version = packageJson.version;

json.releaseDate =

    new Date()

        .toISOString()

        .split("T")[0];

    json.sha256 = hash;

    fs.writeFileSync(

        UPDATE_JSON,

        JSON.stringify(
            json,
            null,
            4
        )

    );

    console.log("");

    console.log(
        "latest.json updated successfully."
    );

}

main().catch(console.error);