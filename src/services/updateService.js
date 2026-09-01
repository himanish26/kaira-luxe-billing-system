const axios = require("axios");
const path = require("path");
const packageJson = require("../../package.json");
const { downloadFile } = require("./downloadService");
const { verifyChecksum } = require("./checksumService");
const { launchInstaller } = require("./installerService");

const UPDATE_URL =
    "https://raw.githubusercontent.com/himanish26/kaira-luxe-billing-system/main/updates/latest.json";
const MANIFEST_TIMEOUT_MS = 15000;
const RELEASE_REPOSITORY_PATH = "/himanish26/kaira-luxe-billing-system/releases/download/";
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-rc(\d+))?$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

function parseVersion(version) {
    const match = VERSION_PATTERN.exec(String(version || ""));
    if (!match) throw new Error("Update manifest version is invalid.");
    return {
        major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]),
        rc: match[4] === undefined ? null : Number(match[4])
    };
}

function compareVersions(current, latest) {
    const left = parseVersion(current);
    const right = parseVersion(latest);
    for (const field of ["major", "minor", "patch"]) {
        if (right[field] > left[field]) return 1;
        if (right[field] < left[field]) return -1;
    }
    if (left.rc === null && right.rc !== null) return -1;
    if (left.rc !== null && right.rc === null) return 1;
    if (left.rc === right.rc) return 0;
    return right.rc > left.rc ? 1 : -1;
}

function expectedInstallerFileName(version) {
    return `KairaLuxeBillingSetup-${version}.exe`;
}

function validateReleaseUrl(value, version) {
    let url;
    try { url = new URL(String(value || "")); }
    catch (_) { throw new Error("Update manifest download URL is invalid."); }
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com" ||
        url.username || url.password || url.port || url.search || url.hash) {
        throw new Error("Update manifest download URL must use the trusted GitHub release host.");
    }
    const expectedPrefix = `${RELEASE_REPOSITORY_PATH}v${version}/`;
    if (!url.pathname.startsWith(expectedPrefix)) {
        throw new Error("Update manifest download URL is outside the KLBS release path.");
    }
    let fileName;
    try { fileName = decodeURIComponent(url.pathname.slice(expectedPrefix.length)); }
    catch (_) { throw new Error("Update installer filename encoding is invalid."); }
    if (fileName !== expectedInstallerFileName(version) || fileName !== path.basename(fileName) ||
        fileName.includes("/") || fileName.includes("\\")) {
        throw new Error("Update manifest installer filename does not match the release version.");
    }
    return { downloadUrl: url.toString(), fileName };
}

function validateManifest(manifest, currentVersion) {
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
        throw new Error("Update manifest is invalid.");
    }
    parseVersion(currentVersion);
    parseVersion(manifest.version);
    if (!SHA256_PATTERN.test(String(manifest.sha256 || ""))) {
        throw new Error("Update manifest SHA-256 is invalid.");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(manifest.releaseDate || "")) ||
        !Number.isFinite(Date.parse(`${manifest.releaseDate}T00:00:00Z`))) {
        throw new Error("Update manifest release date is invalid.");
    }
    if (!Array.isArray(manifest.notes) || manifest.notes.some(note => typeof note !== "string")) {
        throw new Error("Update manifest release notes are invalid.");
    }
    if (manifest.minimumVersion !== undefined) parseVersion(manifest.minimumVersion);
    const release = validateReleaseUrl(manifest.downloadUrl, manifest.version);
    return Object.freeze({
        version: manifest.version,
        minimumVersion: manifest.minimumVersion || null,
        releaseDate: manifest.releaseDate,
        notes: [...manifest.notes],
        downloadUrl: release.downloadUrl,
        fileName: release.fileName,
        sha256: String(manifest.sha256).toLowerCase()
    });
}

function createUpdatePipeline(options = {}) {
    const httpClient = options.httpClient || axios;
    const currentVersion = options.currentVersion || packageJson.version;
    const downloadFileFn = options.downloadFile || downloadFile;
    const verifyChecksumFn = options.verifyChecksum || verifyChecksum;
    const launchInstallerFn = options.launchInstaller || launchInstaller;
    let acceptedUpdate = null;
    let verifiedArtifact = null;

    async function checkForUpdates() {
        acceptedUpdate = null;
        verifiedArtifact = null;
        try {
            const response = await httpClient.get(UPDATE_URL, {
                headers: { "Cache-Control": "no-cache", "Pragma": "no-cache" },
                params: { t: Date.now() },
                timeout: MANIFEST_TIMEOUT_MS,
                maxRedirects: 0,
                validateStatus: status => status >= 200 && status < 300
            });
            const descriptor = validateManifest(response.data, currentVersion);
            const updateAvailable = compareVersions(currentVersion, descriptor.version) === 1;
            if (updateAvailable) acceptedUpdate = descriptor;
            return {
                success: true,
                currentVersion,
                latestVersion: descriptor.version,
                updateAvailable,
                updateInfo: {
                    version: descriptor.version,
                    minimumVersion: descriptor.minimumVersion,
                    releaseDate: descriptor.releaseDate,
                    notes: [...descriptor.notes]
                }
            };
        }
        catch (error) {
            acceptedUpdate = null;
            verifiedArtifact = null;
            return { success: false, message: error.message };
        }
    }

    async function downloadAcceptedUpdate(event) {
        if (!acceptedUpdate) throw new Error("No validated update is accepted for download.");
        verifiedArtifact = null;
        const descriptor = acceptedUpdate;
        try {
            const filePath = await downloadFileFn(event, descriptor);
            if (acceptedUpdate !== descriptor) {
                throw new Error("Accepted update changed during download.");
            }
            verifiedArtifact = Object.freeze({
                version: descriptor.version,
                fileName: descriptor.fileName,
                filePath,
                sha256: descriptor.sha256
            });
            return { success: true, version: descriptor.version, fileName: descriptor.fileName };
        }
        catch (error) {
            verifiedArtifact = null;
            throw error;
        }
    }

    async function installAcceptedUpdate() {
        if (!acceptedUpdate || !verifiedArtifact ||
            verifiedArtifact.version !== acceptedUpdate.version ||
            verifiedArtifact.fileName !== acceptedUpdate.fileName ||
            verifiedArtifact.sha256 !== acceptedUpdate.sha256) {
            throw new Error("No verified accepted update is ready to install.");
        }
        if (!await verifyChecksumFn(verifiedArtifact.filePath, acceptedUpdate.sha256)) {
            verifiedArtifact = null;
            throw new Error("Verified installer checksum is no longer valid.");
        }
        await launchInstallerFn(verifiedArtifact.filePath);
        return { success: true, version: acceptedUpdate.version };
    }

    function getState() {
        return { acceptedUpdate, verifiedArtifact };
    }

    return { checkForUpdates, downloadAcceptedUpdate, installAcceptedUpdate, getState };
}

module.exports = {
    UPDATE_URL,
    MANIFEST_TIMEOUT_MS,
    RELEASE_REPOSITORY_PATH,
    compareVersions,
    expectedInstallerFileName,
    validateReleaseUrl,
    validateManifest,
    createUpdatePipeline
};
