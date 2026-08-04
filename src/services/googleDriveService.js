const fs = require("fs");
const path = require("path");

const { google } = require("googleapis");

const {
    authenticate
} = require("@google-cloud/local-auth");

const SCOPES = [

    "https://www.googleapis.com/auth/drive.file"

];

const TOKEN_PATH =
    path.join(
        process.cwd(),
        "google-token.json"
    );

const CREDENTIALS_PATH =
    path.join(
        process.cwd(),
        "google-credentials.json"
    );

async function connectGoogleDrive() {

    const auth = await authenticate({

        scopes: SCOPES,

        keyfilePath: CREDENTIALS_PATH

    });

    const oauth2Client = auth;

    const token = oauth2Client.credentials;

    fs.writeFileSync(

        TOKEN_PATH,

        JSON.stringify(

            token,

            null,

            4

        )

    );

    return {

        success: true,

        email: null

    };

}

module.exports = {
    
    connectGoogleDrive
    
};