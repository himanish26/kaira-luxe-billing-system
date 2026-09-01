const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const Module = require("module");
const os = require("os");
const path = require("path");
const { PassThrough, Readable } = require("stream");

const root = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "klbs-r10-7c-"));
const userData = path.join(tempRoot, "user data");
fs.mkdirSync(userData);

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
    if (request === "electron" && parent && parent.filename.endsWith("downloadService.js")) {
        return { app: { getPath: name => {
            assert.strictEqual(name, "userData");
            return userData;
        } } };
    }
    return originalLoad.call(this, request, parent, isMain);
};
const downloadModule = require("../src/services/downloadService");
const updateModule = require("../src/services/updateService");
Module._load = originalLoad;
const generator = require("../updates/generateUpdateManifest");

const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const version = "1.0.1";
const fileName = `KairaLuxeBillingSetup-${version}.exe`;
const downloadUrl = `https://github.com/himanish26/kaira-luxe-billing-system/releases/download/v${version}/${fileName}`;
const content = Buffer.from("disposable signed installer fixture");
const descriptor = { version, fileName, downloadUrl, sha256: sha256(content) };
const manifest = {
    version, minimumVersion: "1.0.0", releaseDate: "2026-09-02",
    notes: ["Disposable test"], downloadUrl, sha256: descriptor.sha256
};

function cleanCache() {
    const cache = path.join(userData, "UpdateCache");
    if (fs.existsSync(cache)) fs.rmSync(cache, { recursive: true, force: true });
}

function responseStream(body = content, headers = {}) {
    return { status: 200, headers: { "content-length": String(body.length), ...headers }, data: Readable.from(body) };
}

async function testDownload(httpClient, targetDescriptor = descriptor, options = {}) {
    const progress = [];
    const service = downloadModule.createDownloadService({
        httpClient,
        appInstance: { getPath: () => userData },
        totalTimeoutMs: options.totalTimeoutMs || 200
    });
    const filePath = await service.downloadFile({ sender: { send: (channel, value) => progress.push(value) } }, targetDescriptor);
    return { filePath, progress };
}

async function main() {
    const validated = updateModule.validateManifest(manifest, "1.0.0");
    assert.strictEqual(validated.fileName, fileName);
    for (const scheme of ["http", "file", "data", "javascript", "ftp"]) {
        assert.throws(() => updateModule.validateManifest({
            ...manifest, downloadUrl: `${scheme}:test`
        }, "1.0.0"));
    }
    for (const unsafe of ["../evil.exe", "..\\evil.exe", "C:\\evil.exe", "\\\\server\\evil.exe", "subdir/evil.exe", "subdir\\evil.exe"]) {
        assert.throws(() => downloadModule.validateSafeInstallerFileName(unsafe));
    }
    const cacheRoot = path.join(tempRoot, "cache with spaces");
    const contained = downloadModule.resolveContainedDestination(cacheRoot, fileName);
    assert.strictEqual(path.dirname(contained), path.resolve(cacheRoot));
    assert.throws(() => downloadModule.validateRedirectUrl("https://example.com/asset.exe"));
    assert.throws(() => downloadModule.validateRedirectUrl("https://github.com/attacker/repository/releases/download/v1/evil.exe"));
    assert.doesNotThrow(() => downloadModule.validateRedirectUrl("https://release-assets.githubusercontent.com/asset"));

    const noAccepted = updateModule.createUpdatePipeline({ currentVersion: "1.0.0" });
    await assert.rejects(noAccepted.downloadAcceptedUpdate({}), /No validated update/);

    cleanCache();
    await assert.rejects(testDownload(async () => responseStream(content), {
        ...descriptor, sha256: "0".repeat(64)
    }));
    assert(!fs.existsSync(path.join(userData, "UpdateCache", fileName)));
    assert(!fs.existsSync(path.join(userData, "UpdateCache", `${fileName}.partial`)));

    cleanCache();
    const correct = await testDownload(async () => responseStream(content));
    assert(fs.existsSync(correct.filePath));
    assert.strictEqual(fs.readFileSync(correct.filePath).equals(content), true);
    assert.strictEqual(correct.progress.at(-1), 100);
    assert(correct.progress.every(value => Number.isFinite(value) && value >= 0 && value <= 100));

    for (const status of [404, 500]) {
        cleanCache();
        await assert.rejects(testDownload(async () => ({
            status, headers: {}, data: Readable.from("error")
        })));
        assert(!fs.existsSync(path.join(userData, "UpdateCache", fileName)));
    }

    cleanCache();
    const stalled = new PassThrough();
    await assert.rejects(testDownload(async () => ({ status: 200, headers: {}, data: stalled }), descriptor, {
        totalTimeoutMs: 20
    }), /timed out/);
    assert(!fs.existsSync(path.join(userData, "UpdateCache", `${fileName}.partial`)));

    cleanCache();
    const reset = new PassThrough();
    setImmediate(() => reset.destroy(new Error("injected connection reset")));
    await assert.rejects(testDownload(async () => ({ status: 200, headers: {}, data: reset })));
    assert(!fs.existsSync(path.join(userData, "UpdateCache", `${fileName}.partial`)));

    cleanCache();
    const obstruction = path.join(userData, "UpdateCache");
    fs.writeFileSync(obstruction, "not a directory");
    await assert.rejects(testDownload(async () => responseStream(content)));
    fs.unlinkSync(obstruction);
    const retry = await testDownload(async () => responseStream(content));
    assert(fs.existsSync(retry.filePath));

    cleanCache();
    fs.mkdirSync(path.join(userData, "UpdateCache"));
    fs.mkdirSync(path.join(userData, "UpdateCache", fileName));
    await assert.rejects(testDownload(async () => responseStream(content)));
    fs.rmSync(path.join(userData, "UpdateCache", fileName), { recursive: true, force: true });
    assert(!fs.existsSync(path.join(userData, "UpdateCache", `${fileName}.partial`)));

    const manifests = [manifest, {
        ...manifest,
        version: "1.0.2",
        downloadUrl: "https://github.com/himanish26/kaira-luxe-billing-system/releases/download/v1.0.2/KairaLuxeBillingSetup-1.0.2.exe"
    }];
    let checkIndex = 0;
    const downloaded = [];
    const launched = [];
    const pipeline = updateModule.createUpdatePipeline({
        currentVersion: "1.0.0",
        httpClient: { get: async () => ({ data: manifests[checkIndex++] }) },
        downloadFile: async (event, accepted) => {
            const target = path.join(tempRoot, accepted.fileName);
            fs.writeFileSync(target, content);
            downloaded.push(accepted.version);
            return target;
        },
        verifyChecksum: async () => true,
        launchInstaller: async installerPath => launched.push(installerPath)
    });
    assert.strictEqual((await pipeline.checkForUpdates()).updateAvailable, true);
    await pipeline.downloadAcceptedUpdate({});
    assert.strictEqual(pipeline.getState().verifiedArtifact.version, "1.0.1");
    await pipeline.checkForUpdates();
    assert.strictEqual(pipeline.getState().acceptedUpdate.version, "1.0.2");
    assert.strictEqual(pipeline.getState().verifiedArtifact, null);
    await assert.rejects(pipeline.installAcceptedUpdate(), /No verified/);
    await pipeline.downloadAcceptedUpdate({});
    await pipeline.installAcceptedUpdate();
    assert.deepStrictEqual(downloaded, ["1.0.1", "1.0.2"]);
    assert.strictEqual(launched.length, 1);

    const fixtureRoot = path.join(tempRoot, "generator");
    fs.mkdirSync(fixtureRoot);
    const fixturePackage = path.join(fixtureRoot, "package.json");
    const fixtureInstaller = path.join(fixtureRoot, fileName);
    const fixtureManifest = path.join(fixtureRoot, "latest.json");
    fs.writeFileSync(fixturePackage, JSON.stringify({ version }));
    fs.writeFileSync(fixtureInstaller, content);
    fs.writeFileSync(fixtureManifest, JSON.stringify({
        version: "1.0.0", minimumVersion: "1.0.0", releaseDate: "2026-01-01",
        notes: ["Fixture"], downloadUrl: "https://github.com/old/old", sha256: "0".repeat(64)
    }));
    const beforeMissingUrl = fs.readFileSync(fixtureManifest, "utf8");
    await assert.rejects(generator.generateManifest({
        packagePath: fixturePackage, installerPath: fixtureInstaller, outputPath: fixtureManifest
    }));
    assert.strictEqual(fs.readFileSync(fixtureManifest, "utf8"), beforeMissingUrl);
    await assert.rejects(generator.generateManifest({
        packagePath: fixturePackage, installerPath: fixtureInstaller,
        outputPath: fixtureManifest, downloadUrl: "http://example.com/installer.exe"
    }));
    const generated = await generator.generateManifest({
        packagePath: fixturePackage, installerPath: fixtureInstaller,
        outputPath: fixtureManifest, downloadUrl, releaseDate: "2026-09-02"
    });
    assert.strictEqual(generated.version, version);
    assert.strictEqual(generated.downloadUrl, downloadUrl);
    assert.strictEqual(generated.sha256, sha256(content));

    const preload = fs.readFileSync(path.join(root, "src/main/preload.js"), "utf8");
    const renderer = fs.readFileSync(path.join(root, "src/renderer/modules/system/updates.js"), "utf8");
    const mainSource = fs.readFileSync(path.join(root, "src/main/main.js"), "utf8");
    assert(/downloadUpdate:\s*grant\s*=>/.test(preload));
    assert(/launchInstaller:\s*grant\s*=>/.test(preload));
    assert(!renderer.includes("info.downloadUrl") && !renderer.includes("info.sha256"));
    assert(mainSource.includes('requireSecurityGrant(grant, "INSTALL_UPDATE")'));
    assert(mainSource.includes("updatePipeline.downloadAcceptedUpdate(event)"));
    assert(mainSource.includes("updatePipeline.installAcceptedUpdate()"));
    assert(!/updates:download[\s\S]{0,250}\burl\b/.test(mainSource));

    console.log("R10.7C secure update pipeline focused tests: PASS");
    console.log(`Disposable directory: ${tempRoot}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
