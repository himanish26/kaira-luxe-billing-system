const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-rc\d+)?$/;

function expectedInstallerFileName(version) {
    return `KairaLuxeBillingSetup-${version}.exe`;
}

function validateReleaseUrl(value, version, installerFileName) {
    let url;
    try { url = new URL(String(value || "")); }
    catch (_) { throw new Error("A valid release download URL is required."); }
    const expectedPath = `/himanish26/kaira-luxe-billing-system/releases/download/v${version}/${installerFileName}`;
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com" ||
        url.username || url.password || url.port || url.search || url.hash ||
        decodeURIComponent(url.pathname) !== expectedPath) {
        throw new Error("Release URL must match the approved KLBS GitHub release and installer.");
    }
    return url.toString();
}

function sha256(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash("sha256");
        const stream = fs.createReadStream(filePath);
        stream.on("data", data => hash.update(data));
        stream.on("end", () => resolve(hash.digest("hex")));
        stream.on("error", reject);
    });
}

function parseArguments(argv) {
    const values = {};
    for (let index = 0; index < argv.length; index += 2) {
        const key = argv[index];
        const value = argv[index + 1];
        if (!key || !key.startsWith("--") || value === undefined) {
            throw new Error("Manifest arguments must use --name value pairs.");
        }
        values[key.slice(2)] = value;
    }
    return values;
}

async function generateManifest(options = {}) {
    const packagePath = options.packagePath || path.join(ROOT, "package.json");
    const outputPath = options.outputPath || path.join(ROOT, "updates", "latest.json");
    const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    const version = String(packageJson.version || "");
    if (!VERSION_PATTERN.test(version)) throw new Error("package.json version is invalid.");

    const installerFileName = expectedInstallerFileName(version);
    const installerPath = options.installerPath || path.join(ROOT, "dist", installerFileName);
    if (!fs.existsSync(installerPath) || !fs.statSync(installerPath).isFile()) {
        throw new Error(`Expected installer not found: ${installerFileName}`);
    }
    if (path.basename(installerPath) !== installerFileName) {
        throw new Error("Installer filename does not match package version and builder artifactName.");
    }

    const downloadUrl = validateReleaseUrl(options.downloadUrl, version, installerFileName);
    const existing = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    if (!Array.isArray(existing.notes) || existing.notes.some(note => typeof note !== "string")) {
        throw new Error("Existing release notes are invalid.");
    }
    const releaseDate = options.releaseDate || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) throw new Error("Release date is invalid.");

    const manifest = {
        version,
        minimumVersion: existing.minimumVersion,
        releaseDate,
        notes: existing.notes,
        downloadUrl,
        sha256: await sha256(installerPath)
    };
    const temporaryPath = `${outputPath}.partial`;
    fs.writeFileSync(temporaryPath, JSON.stringify(manifest, null, 4), { flag: "wx" });
    try { fs.renameSync(temporaryPath, outputPath); }
    catch (error) {
        try { fs.unlinkSync(temporaryPath); } catch (_) {}
        throw error;
    }
    return manifest;
}

async function main() {
    const args = parseArguments(process.argv.slice(2));
    const downloadUrl = args["download-url"] || process.env.KLBS_RELEASE_DOWNLOAD_URL;
    return generateManifest({
        downloadUrl,
        installerPath: args.installer,
        outputPath: args.output,
        packagePath: args.package,
        releaseDate: args["release-date"]
    });
}

if (require.main === module) {
    main()
        .then(manifest => console.log(`latest.json generated for ${manifest.version}.`))
        .catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = {
    expectedInstallerFileName,
    validateReleaseUrl,
    parseArguments,
    generateManifest
};
