const fs = require("fs");
const crypto = require("crypto");

function verifyChecksum(

    filePath,

    expectedHash

) {

    return new Promise(

        (

            resolve,

            reject

        ) => {

            const hash = crypto.createHash(

                "sha256"

            );

            const stream = fs.createReadStream(

                filePath

            );

            stream.on(

                "data",

                data => hash.update(data)

            );

            stream.on(

                "end",

                () => {

                    const calculated =

                        hash.digest("hex");

                    resolve(

                        calculated.toLowerCase() ===

                        expectedHash.toLowerCase()

                    );

                }

            );

            stream.on(

                "error",

                reject

            );

        }

    );

}

module.exports = {

    verifyChecksum

};