const fs = require("fs");
const path = require("path");

const { google } = require("googleapis");

const TOKEN_PATH = path.join(
    process.cwd(),
    "google-token.json"
);

const CREDENTIALS_PATH = path.join(
    process.cwd(),
    "google-credentials.json"
);

function loadCredentials() {

    const content = fs.readFileSync(
        CREDENTIALS_PATH,
        "utf8"
    );

    return JSON.parse(content);

}

function saveToken(token) {

    fs.writeFileSync(

        TOKEN_PATH,

        JSON.stringify(
            token,
            null,
            4
        )

    );

}

function loadToken() {

    if (!fs.existsSync(TOKEN_PATH)) {

        return null;

    }

    return JSON.parse(

        fs.readFileSync(
            TOKEN_PATH,
            "utf8"
        )

    );

}

module.exports = {

    loadCredentials,

    saveToken,

    loadToken

};