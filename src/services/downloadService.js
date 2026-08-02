const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { app } = require("electron");

function getUpdatesFolder() {

    const updatesFolder = path.join(

        app.getPath("userData"),

        "UpdateCache"

    );

    if (!fs.existsSync(updatesFolder)) {

        fs.mkdirSync(

            updatesFolder,

            {

                recursive: true

            }

        );

    }

    return updatesFolder;

}

async function downloadFile(

    event,

    url,

    fileName,

    version

) {

    const updatesFolder =

        getUpdatesFolder();

    const destination =

        path.join(

            updatesFolder,

            fileName

        );

    const response =

        await axios({

            method: "GET",

            url,

            responseType: "stream"

        });

    const totalSize =

        Number(

            response.headers["content-length"]

        );

    let downloaded = 0;

    const writer =

        fs.createWriteStream(

            destination

        );

    response.data.on(

        "data",

        chunk => {

            downloaded += chunk.length;

            if (totalSize > 0) {

    event.sender.send(

        "update-download-progress",

        Math.round(

            downloaded *

            100 /

            totalSize

        )

    );

}

        }

    );

    response.data.pipe(writer);

    return new Promise(

        (

            resolve,

            reject

        ) => {

            writer.on(

                "finish",

                () => {

    const updateInfo = {

        expectedVersion: version,

        downloadedAt: new Date().toISOString()

    };

    fs.writeFileSync(

        path.join(

            updatesFolder,

            "update.json"

        ),

        JSON.stringify(

            updateInfo,

            null,

            4

        )

    );

    resolve(destination);

}

            );

            writer.on(

                "error",

                reject

            );

        }

    );

}

module.exports = {

    getUpdatesFolder,

    downloadFile

};