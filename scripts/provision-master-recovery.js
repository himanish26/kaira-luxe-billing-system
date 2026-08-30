const fs = require("fs");
const path = require("path");
const readline = require("readline");
const {
    hashCredential
} = require("../src/services/credentialCrypto");

function readHidden(promptText) {
    if (!process.stdin.isTTY) {
        const reader = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: false
        });
        return new Promise(resolve => {
            reader.question(promptText, answer => {
                reader.close();
                resolve(answer);
            });
        });
    }

    return new Promise((resolve, reject) => {
        process.stdout.write(promptText);
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding("utf8");
        let value = "";

        function finish() {
            process.stdin.setRawMode(false);
            process.stdin.pause();
            process.stdin.removeListener("data", onData);
            process.stdout.write("\n");
            resolve(value);
        }

        function onData(character) {
            if (character === "\u0003") {
                process.stdin.setRawMode(false);
                process.stdin.pause();
                reject(new Error("Provisioning cancelled."));
                return;
            }
            if (character === "\r" || character === "\n") {
                finish();
                return;
            }
            if (character === "\u007f" || character === "\b") {
                value = value.slice(0, -1);
                return;
            }
            value += character;
        }

        process.stdin.on("data", onData);
    });
}

function parseOutputPath(args) {
    const outputIndex = args.indexOf("--output");
    if (outputIndex !== -1 && args[outputIndex + 1]) {
        return path.resolve(args[outputIndex + 1]);
    }
    return path.resolve(
        __dirname,
        "../src/config/masterRecoveryVerifier.js"
    );
}

async function provisionMasterRecovery(options = {}) {
    const readInput = options.readInput || readHidden;
    const outputPath = options.outputPath || parseOutputPath(process.argv.slice(2));

    const masterPin = await readInput("Master Recovery PIN: ");
    const confirmPin = await readInput("Confirm Master Recovery PIN: ");
    if (!/^\d{6}$/.test(masterPin)) {
        throw new Error("Master PIN must contain exactly 6 digits.");
    }
    if (masterPin !== confirmPin) {
        throw new Error("Master Recovery PIN confirmation does not match.");
    }
    const verifier = await hashCredential(masterPin);
    const fileContent = [
        "// Generated Master PIN verification material. No plaintext PIN is stored.",
        `module.exports = ${JSON.stringify(verifier)};`,
        ""
    ].join("\n");

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, fileContent, { encoding: "utf8", mode: 0o600 });

    return { outputPath, verifier };
}

if (require.main === module) {
    provisionMasterRecovery()
        .then(({ outputPath }) => {
            console.log(`Master Recovery verifier written to: ${outputPath}`);
            console.log("No plaintext Master PIN was stored or printed.");
        })
        .catch(error => {
            console.error(`Provisioning failed: ${error.message}`);
            process.exitCode = 1;
        });
}

module.exports = {
    provisionMasterRecovery,
    parseOutputPath
};
