const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { pipeline } = require("stream/promises");
const { app } = require("electron");
const { verifyChecksum } = require("./checksumService");

const DOWNLOAD_SOCKET_TIMEOUT_MS = 120000;
const DOWNLOAD_TOTAL_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_REDIRECTS = 5;
const ALLOWED_REDIRECT_HOSTS = new Set([
    "github.com",
    "release-assets.githubusercontent.com",
    "objects.githubusercontent.com"
]);

function getUpdatesFolder(appInstance = app) {
    const updatesFolder = path.join(appInstance.getPath("userData"), "UpdateCache");
    fs.mkdirSync(updatesFolder, { recursive: true });
    return updatesFolder;
}

function validateSafeInstallerFileName(fileName) {
    const value = String(fileName || "");
    if (!value || value !== path.basename(value) ||
        value.includes("/") || value.includes("\\") ||
        path.isAbsolute(value) || !/^[A-Za-z0-9._ ()-]+\.exe$/i.test(value)) {
        throw new Error("Update installer filename is invalid.");
    }
    return value;
}

function resolveContainedDestination(updateCache, fileName) {
    const safeName = validateSafeInstallerFileName(fileName);
    const root = path.resolve(updateCache);
    const destination = path.resolve(root, safeName);
    const relative = path.relative(root, destination);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error("Update installer destination is outside UpdateCache.");
    }
    return destination;
}

function validateRedirectUrl(value) {
    let url;
    try { url = new URL(value); }
    catch (_) { throw new Error("Update redirect URL is invalid."); }
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || !ALLOWED_REDIRECT_HOSTS.has(hostname) ||
        (hostname === "github.com" &&
            !url.pathname.startsWith("/himanish26/kaira-luxe-billing-system/releases/download/"))) {
        throw new Error("Update redirect escaped the trusted GitHub release hosts.");
    }
    return url.toString();
}

function removeFile(filePath) {
    try {
        if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    catch (_) {}
}

async function requestDownload(httpClient, initialUrl, signal) {
    let currentUrl = initialUrl;
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
        const response = await httpClient({
            method: "GET",
            url: currentUrl,
            responseType: "stream",
            timeout: DOWNLOAD_SOCKET_TIMEOUT_MS,
            signal,
            maxRedirects: 0,
            validateStatus: status => status >= 200 && status < 400
        });
        if (response.status >= 200 && response.status < 300) return response;
        const location = response.headers && response.headers.location;
        if (!location || redirects === MAX_REDIRECTS) {
            if (response.data && response.data.destroy) response.data.destroy();
            throw new Error("Update download exceeded the trusted redirect limit.");
        }
        if (response.data && response.data.destroy) response.data.destroy();
        currentUrl = validateRedirectUrl(new URL(location, currentUrl).toString());
    }
    throw new Error("Update download redirect failed.");
}

function createDownloadService(options = {}) {
    const httpClient = options.httpClient || axios;
    const appInstance = options.appInstance || app;
    const verifyChecksumFn = options.verifyChecksum || verifyChecksum;
    const totalTimeoutMs = options.totalTimeoutMs || DOWNLOAD_TOTAL_TIMEOUT_MS;

    async function downloadFile(event, descriptor) {
        const updateCache = getUpdatesFolder(appInstance);
        const destination = resolveContainedDestination(updateCache, descriptor.fileName);
        const partialPath = `${destination}.partial`;
        const metadataPath = path.join(updateCache, "update.json");
        const metadataPartialPath = `${metadataPath}.partial`;
        removeFile(partialPath);
        removeFile(destination);
        removeFile(metadataPartialPath);

        const controller = new AbortController();
        const totalTimer = setTimeout(() => controller.abort(), totalTimeoutMs);
        let response;
        try {
            response = await requestDownload(httpClient, descriptor.downloadUrl, controller.signal);
            const totalSize = Number(response.headers && response.headers["content-length"]);
            let downloaded = 0;
            response.data.on("data", chunk => {
                downloaded += chunk.length;
                if (Number.isFinite(totalSize) && totalSize > 0 && event && event.sender) {
                    const progress = Math.max(0, Math.min(99, Math.floor(downloaded * 100 / totalSize)));
                    event.sender.send("update-download-progress", progress);
                }
            });
            const writer = fs.createWriteStream(partialPath, { flags: "wx" });
            await pipeline(response.data, writer, { signal: controller.signal });
            if (!fs.existsSync(partialPath) || fs.statSync(partialPath).size <= 0) {
                throw new Error("Downloaded installer is empty or incomplete.");
            }
            if (!await verifyChecksumFn(partialPath, descriptor.sha256)) {
                throw new Error("Downloaded installer failed checksum verification.");
            }
            fs.renameSync(partialPath, destination);
            fs.writeFileSync(metadataPartialPath, JSON.stringify({
                expectedVersion: descriptor.version,
                fileName: descriptor.fileName,
                sha256: descriptor.sha256,
                downloadedAt: new Date().toISOString()
            }, null, 4), { flag: "wx" });
            fs.renameSync(metadataPartialPath, metadataPath);
            if (event && event.sender) event.sender.send("update-download-progress", 100);
            return destination;
        }
        catch (error) {
            if (response && response.data && response.data.destroy) response.data.destroy();
            removeFile(partialPath);
            removeFile(destination);
            removeFile(metadataPartialPath);
            if (controller.signal.aborted) {
                throw new Error("Update download timed out.");
            }
            throw error;
        }
        finally {
            clearTimeout(totalTimer);
        }
    }

    return { downloadFile };
}

const defaultService = createDownloadService();

module.exports = {
    DOWNLOAD_SOCKET_TIMEOUT_MS,
    DOWNLOAD_TOTAL_TIMEOUT_MS,
    MAX_REDIRECTS,
    ALLOWED_REDIRECT_HOSTS,
    getUpdatesFolder,
    validateSafeInstallerFileName,
    resolveContainedDestination,
    validateRedirectUrl,
    createDownloadService,
    downloadFile: defaultService.downloadFile
};
