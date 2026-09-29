const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const packageInfo = require(path.join(root, "package.json"));
const eulaPath = path.join(root, "EULA.txt");
const eula = fs.readFileSync(eulaPath, "utf8");
const settingsSource = fs.readFileSync(path.join(root, "src/renderer/modules/settings.js"), "utf8");
const preloadSource = fs.readFileSync(path.join(root, "src/main/preload.js"), "utf8");
const mainSource = fs.readFileSync(path.join(root, "src/main/main.js"), "utf8");
const eulaServiceSource = fs.readFileSync(path.join(root, "src/services/eulaService.js"), "utf8");
const vendorSource = fs.readFileSync(path.join(root, "src/renderer/vendor/JsBarcode.all.min.js"), "utf8");
const { readAuthoritativeEula, UNAVAILABLE_MESSAGE } = require(path.join(root, "src/services/eulaService.js"));

function createSettingsHarness(getEulaText) {
    const listeners = {};
    const nodes = {};
    let renderedPage = null;
    const context = {
        APP_INFO: {},
        aboutCard: { addEventListener: (event, callback) => { listeners.about = callback; } },
        settingsPage: { style: {} },
        settingsScreen: { style: {} },
        document: {
            getElementById(id) {
                if (!nodes[id]) {
                    nodes[id] = {
                        textContent: "",
                        addEventListener(event, callback) { listeners[id] = callback; }
                    };
                }
                return nodes[id];
            }
        },
        window: {
            electronAPI: {
                async getAppInfo() {
                    return {
                        appName: "KAIRA LUXE BILLING SYSTEM", version: packageInfo.version, electron: "test",
                        node: "test", chrome: "test", author: "Himanish Patnaik", license: "Single Device Commercial",
                        database: "SQLite", schema: "v1", platform: "test", architecture: "test"
                    };
                },
                getEulaText
            }
        },
        renderSettingsPage(options) { renderedPage = options; },
        console
    };
    vm.createContext(context);
    vm.runInContext(settingsSource, context, { filename: "settings.js" });
    return {
        context,
        listeners,
        nodes,
        get renderedPage() { return renderedPage; }
    };
}

async function main() {
    assert.ok(fs.existsSync(eulaPath), "authoritative EULA.txt exists");
    assert.deepEqual(
        [...eula.matchAll(/^(\d+)\. [A-Z][A-Z ,&/-]+$/gm)].map(match => Number(match[1])),
        Array.from({ length: 33 }, (_, index) => index + 1),
        "authoritative EULA has all 33 consecutively numbered sections"
    );
    assert.equal(packageInfo.build.nsis.license, "EULA.txt", "NSIS uses authoritative EULA.txt");
    assert.ok(packageInfo.build.files.includes("EULA.txt"), "packaged application includes EULA.txt");
    assert.equal(packageInfo.version, "2.0.0", "package version is promoted for the V2 release candidate");
    assert.doesNotMatch(settingsSource, /This copy of the Kaira Luxe Billing System is licensed|1\. License Grant|3\. Ownership/, "old independent EULA text is absent from About renderer");
    assert.match(settingsSource, /window\.electronAPI\.getEulaText\(\)/, "About retrieves EULA through the bridge");
    assert.match(settingsSource, /eulaElement\.textContent\s*=/, "EULA is displayed as inert text, not HTML");
    assert.match(preloadSource, /getEulaText:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(\s*"legal:get-eula-text"\s*\)/, "preload exposes one fixed no-argument EULA method");
    assert.doesNotMatch(preloadSource, /require\(["'](?:fs|node:fs)["']\)|readFileSync|readFile\(/, "preload exposes no arbitrary filesystem reading");
    assert.match(mainSource, /ipcMain\.handle\("legal:get-eula-text", async event\s*=>[\s\S]*?event\.sender !== mainWindow\.webContents[\s\S]*?readAuthoritativeEula\(/, "main process restricts EULA IPC to the application window and calls its fixed loader");
    assert.match(mainSource, /readAuthoritativeEula.*\.\.\/services\/eulaService/, "main process imports the EULA-only loader");
    assert.match(mainSource, /The license agreement is unavailable\. Please try again later\./, "main process returns a path-free controlled load failure");
    assert.match(eulaServiceSource, /path\.join\(appPath, "EULA\.txt"\)/, "packaged loader reads EULA from the packaged application root");
    assert.match(eulaServiceSource, /path\.resolve\(mainDirectory, "\.\.", "\.\.", "EULA\.txt"\)/, "development loader reads the repository-root EULA");
    let loadedPath = null;
    const packagedLoad = readAuthoritativeEula({
        isPackaged: true,
        appPath: path.join(root, "resources", "app.asar"),
        mainDirectory: path.join(root, "src", "main"),
        readFileSync(filePath, encoding) {
            loadedPath = filePath;
            assert.equal(encoding, "utf8");
            return eula;
        }
    });
    assert.equal(loadedPath, path.join(root, "resources", "app.asar", "EULA.txt"), "packaged loader selects EULA.txt within app resources");
    assert.deepEqual(packagedLoad, { success: true, text: eula }, "loader returns authoritative text");
    const developmentLoad = readAuthoritativeEula({
        isPackaged: false,
        appPath: "unused",
        mainDirectory: path.join(root, "src", "main"),
        readFileSync: filePath => { loadedPath = filePath; return eula; }
    });
    assert.equal(loadedPath, eulaPath, "development loader selects repository-root EULA.txt");
    assert.equal(developmentLoad.success, true, "development EULA loads successfully");
    const missingLoad = readAuthoritativeEula({
        isPackaged: true,
        appPath: path.join(root, "private", "resource-path"),
        mainDirectory: "unused",
        readFileSync() { throw new Error("private path detail"); }
    });
    assert.deepEqual(missingLoad, { success: false, message: UNAVAILABLE_MESSAGE }, "missing EULA returns controlled path-free failure");
    assert.ok(!JSON.stringify(missingLoad).includes("private"), "loader failure does not expose filesystem path or exception");
    assert.match(vendorSource, /JsBarcode v3\.12\.3 \| \(c\) Johan Lindell \| MIT license/, "existing JsBarcode third-party notice remains present");

    const visibleText = "Authoritative EULA fixture\nSection one";
    const successHarness = createSettingsHarness(async () => ({ success: true, text: visibleText }));
    await successHarness.context.showAboutPage();
    assert.ok(successHarness.renderedPage.content.includes(`<strong>${packageInfo.version}</strong>`), "About displays the promoted package version");
    assert.ok(successHarness.renderedPage.content.includes("View End User License Agreement"), "About page retains EULA navigation button");
    await successHarness.listeners.viewEulaBtn();
    assert.equal(successHarness.renderedPage.title, "END USER LICENSE AGREEMENT", "EULA navigation opens legal view");
    assert.equal(successHarness.nodes.authoritativeEulaText.textContent, visibleText, "authoritative EULA response is displayed verbatim");
    assert.equal(typeof successHarness.renderedPage.backAction, "function", "EULA view retains Back action");
    await successHarness.renderedPage.backAction();
    assert.equal(successHarness.renderedPage.title, "ABOUT", "Back returns from EULA to About");
    successHarness.renderedPage.backAction();
    assert.equal(successHarness.context.settingsPage.style.display, "none", "About Back hides the About page");
    assert.equal(successHarness.context.settingsScreen.style.display, "block", "About view is restored on Back");

    const failureHarness = createSettingsHarness(async () => ({ success: false, message: "path must not be rendered" }));
    await failureHarness.context.showAboutPage();
    await failureHarness.listeners.viewEulaBtn();
    assert.equal(failureHarness.nodes.authoritativeEulaText.textContent, "The license agreement is unavailable. Please try again later.", "load failure uses controlled renderer message");
    assert.ok(!failureHarness.nodes.authoritativeEulaText.textContent.includes("path"), "failure message does not expose filesystem details");

    const rejectedHarness = createSettingsHarness(async () => { throw new Error("filesystem path must stay private"); });
    await rejectedHarness.context.showAboutPage();
    await rejectedHarness.listeners.viewEulaBtn();
    assert.equal(rejectedHarness.nodes.authoritativeEulaText.textContent, "The license agreement is unavailable. Please try again later.", "IPC rejection is handled without an unhandled renderer exception");

    console.log("PASS: 33 authoritative EULA architecture assertions");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
