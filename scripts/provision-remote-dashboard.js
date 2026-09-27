/* eslint-disable no-console */
const path = require("path");
const { app, safeStorage } = require("electron");
const { productName } = require("../package.json");
const { createIntegrationConfigService } = require("../src/services/integrationConfigService");

// Match the packaged KLBS application's Electron identity before resolving userData.
app.setName(productName);

function option(name) {
    const prefix = `--${name}=`;
    const value = process.argv.find(argument => argument.startsWith(prefix));
    return value ? value.slice(prefix.length).trim() : "";
}

function hiddenPrompt(question) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        return Promise.reject(new Error("Installation secret must be entered interactively without terminal echo."));
    }
    return new Promise((resolve, reject) => {
        const onData = chunk => {
            const input = chunk.toString();
            if (input === "\u0003") {
                process.stdin.setRawMode(false);
                process.stdin.pause();
                reject(new Error("Provisioning cancelled."));
                return;
            }
            if (input === "\r" || input === "\n") {
                process.stdin.setRawMode(false);
                process.stdin.pause();
                process.stdin.removeListener("data", onData);
                process.stdout.write("\n");
                resolve(answer);
                return;
            }
            if (input === "\u007f") answer = answer.slice(0, -1);
            else if (!input.includes("\u001b")) answer += input;
        };
        let answer = "";
        process.stdout.write(question);
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on("data", onData);
    });
}

async function main() {
    if (process.argv.some(argument => argument === "--secret" || argument.startsWith("--secret="))) {
        throw new Error("Do not pass the installation secret on the command line.");
    }
    const webAppBase = option("web-app-base");
    const gatewayBase = option("gateway-base");
    if (!webAppBase || !gatewayBase) throw new Error("Usage: npm run provision:remote-dashboard -- --web-app-base=... --gateway-base=... [--disabled]");
    const secret = await hiddenPrompt("Installation secret (input hidden): ");
    if (!secret) throw new Error("Installation secret cannot be empty.");
    const service = createIntegrationConfigService({
        safeStorage,
        storagePath: path.join(app.getPath("userData"), "integration-config.json")
    });
    service.saveRemoteDashboard({
        webAppBase,
        gatewayBase,
        secret,
        enabled: !process.argv.includes("--disabled")
    });
    console.log("Remote Dashboard durable configuration saved.");
}

app.whenReady().then(() => main().then(() => app.quit()).catch(error => {
    console.error(`Remote Dashboard provisioning failed: ${error.message}`);
    app.exit(1);
}));
