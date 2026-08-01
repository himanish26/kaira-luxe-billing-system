const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { app } = require("electron");

function getUpdatesFolder() {

    const updatesFolder = path.join(

        app.getPath("userData"),

        "Updates"

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

    fileName

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

                () =>

                    resolve(

                        destination

                    )

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