const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { Writable, Readable } = require("stream");
const { pipeline } = require("stream/promises");

const PROFILE_VERSION = 1;
const AES_STRENGTH = 3;
let zipModulePromise;

function safeUnlink(filePath) {
    try { if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
}

function createBackupEncryptionService(options = {}) {
    const safeStorage = options.safeStorage;
    const storagePath = options.storagePath;

    function readProfile() {
        if (!storagePath || !fs.existsSync(storagePath)) return null;
        try {
            const profile = JSON.parse(fs.readFileSync(storagePath, "utf8"));
            if (profile?.version !== PROFILE_VERSION || typeof profile.encryptedPassword !== "string") return null;
            return profile;
        } catch (_) { throw new Error("Backup encryption settings could not be read safely."); }
    }

    function writeProfile(profile) {
        if (!safeStorage || !safeStorage.isEncryptionAvailable()) {
            throw new Error("This computer’s secure storage is unavailable. KLBS cannot save the recovery password safely.");
        }
        fs.mkdirSync(path.dirname(storagePath), { recursive: true });
        const temporary = `${storagePath}.tmp-${crypto.randomBytes(5).toString("hex")}`;
        try {
            fs.writeFileSync(temporary, JSON.stringify(profile, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
            fs.renameSync(temporary, storagePath);
        } finally { safeUnlink(temporary); }
    }

    function getLocalPassword() {
        const profile = readProfile();
        if (!profile) return null;
        if (!safeStorage || !safeStorage.isEncryptionAvailable()) {
            throw new Error("This computer’s secure storage is unavailable. KLBS cannot use the saved backup password safely.");
        }
        try { return safeStorage.decryptString(Buffer.from(profile.encryptedPassword, "base64")); }
        catch (_) { throw new Error("KLBS could not unlock the saved backup password from this computer’s secure storage."); }
    }

    function getStatus() {
        let configured = false;
        try { configured = Boolean(readProfile()); } catch (_) {}
        return { configured, secureStorageAvailable: Boolean(safeStorage && safeStorage.isEncryptionAvailable()), algorithm: "WinZip AES-256" };
    }

    function configureRecoveryPassword(password) {
        const value = String(password || "");
        if (value.length < 12) throw new Error("Use a recovery password or phrase with at least 12 characters.");
        if (!safeStorage || !safeStorage.isEncryptionAvailable()) {
            throw new Error("This computer’s secure storage is unavailable. KLBS cannot save the recovery password safely.");
        }
        if (readProfile()) throw new Error("Backup encryption is already configured on this computer.");
        const encryptedPassword = safeStorage.encryptString(value).toString("base64");
        writeProfile({ version: PROFILE_VERSION, encryptedPassword, configuredAt: new Date().toISOString() });
        return getStatus();
    }

    function isEncryptedBackup(filePath) {
        let fd;
        try {
            fd = fs.openSync(filePath, "r");
            const size = fs.fstatSync(fd).size;
            const tailLength = Math.min(size, 65557);
            const tail = Buffer.alloc(tailLength);
            fs.readSync(fd, tail, 0, tailLength, size - tailLength);
            let eocd = -1;
            for (let i = tail.length - 22; i >= 0; i -= 1) {
                if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
            }
            if (eocd < 0) return false;
            let centralOffset = tail.readUInt32LE(eocd + 16);
            let centralSize = tail.readUInt32LE(eocd + 12);
            // ZIP64 stores these values in its ZIP64 end record when either
            // classic EOCD field reaches its sentinel value.
            if (centralOffset === 0xffffffff || centralSize === 0xffffffff) {
                const absoluteEocd = size - tailLength + eocd;
                const locatorOffset = absoluteEocd - 20;
                if (locatorOffset < 0) return false;
                const locator = Buffer.alloc(20);
                if (fs.readSync(fd, locator, 0, 20, locatorOffset) !== 20 || locator.readUInt32LE(0) !== 0x07064b50) return false;
                const zip64Offset = Number(locator.readBigUInt64LE(8));
                if (!Number.isSafeInteger(zip64Offset)) return false;
                const zip64 = Buffer.alloc(56);
                if (fs.readSync(fd, zip64, 0, 56, zip64Offset) !== 56 || zip64.readUInt32LE(0) !== 0x06064b50) return false;
                centralSize = Number(zip64.readBigUInt64LE(40));
                centralOffset = Number(zip64.readBigUInt64LE(48));
                if (!Number.isSafeInteger(centralOffset) || !Number.isSafeInteger(centralSize)) return false;
            }
            // The central-directory offset is already absolute from the start
            // of the archive. Only the EOCD/ZIP64 record itself lives in `tail`.
            const start = centralOffset;
            if (!Number.isSafeInteger(start) || start < 0 || start > size) return false;
            const central = Buffer.alloc(Math.min(centralSize, size - start));
            if (fs.readSync(fd, central, 0, central.length, start) !== central.length) return false;
            for (let i = 0; i + 46 <= central.length && central.readUInt32LE(i) === 0x02014b50;) {
                const flags = central.readUInt16LE(i + 8);
                if (flags & 1) return true;
                i += 46 + central.readUInt16LE(i + 28) + central.readUInt16LE(i + 30) + central.readUInt16LE(i + 32);
            }
            return false;
        } catch (_) { return false; }
        finally { if (fd !== undefined) try { fs.closeSync(fd); } catch (_) {} }
    }

    async function getZipModule() {
        if (!zipModulePromise) zipModulePromise = import("@zip.js/zip.js");
        return zipModulePromise;
    }

    class NodeFileReader {
        constructor(filePath) { this.filePath = filePath; this.size = 0; this.handle = null; this.initialized = false; }
        async init() {
            if (this.initialized) return;
            this.handle = await fs.promises.open(this.filePath, "r");
            this.size = (await this.handle.stat()).size;
            this.initialized = true;
        }
        async readUint8Array(offset, length) {
            await this.init();
            const data = Buffer.alloc(Math.min(length, Math.max(0, this.size - offset)));
            const { bytesRead } = await this.handle.read(data, 0, data.length, offset);
            return new Uint8Array(data.buffer, data.byteOffset, bytesRead);
        }
        createReadable({ offset = 0, size = this.size - offset, chunkSize = 64 * 1024 } = {}) {
            let cursor = offset;
            let remaining = size;
            return new ReadableStream({
                pull: async controller => {
                    if (remaining <= 0) { controller.close(); return; }
                    const chunk = await this.readUint8Array(cursor, Math.min(chunkSize, remaining));
                    if (!chunk.byteLength) { controller.close(); return; }
                    cursor += chunk.byteLength;
                    remaining -= chunk.byteLength;
                    controller.enqueue(chunk);
                },
                cancel: async () => this.close()
            });
        }
        get readable() { return Readable.toWeb(fs.createReadStream(this.filePath)); }
        async close() { if (this.handle) { await this.handle.close(); this.handle = null; } }
    }

    function fileWriter(filePath) {
        const stream = fs.createWriteStream(filePath, { flags: "wx", mode: 0o600 });
        return Writable.toWeb(stream);
    }

    async function repackageZip(sourcePath, destinationPath, options = {}) {
        const { ZipReader, ZipWriter } = await getZipModule();
        const sourceReader = new NodeFileReader(sourcePath);
        const reader = new ZipReader(sourceReader);
        const entries = await reader.getEntries();
        const password = options.decryptPassword;
        if (options.encryptPassword && entries.some(entry => entry.encrypted)) {
            await reader.close();
            throw new Error("KLBS cannot encrypt an already encrypted ZIP without first restoring it.");
        }
        const writer = new ZipWriter(fileWriter(destinationPath), options.encryptPassword
            ? { password: options.encryptPassword, encryptionStrength: AES_STRENGTH, zip64: true }
            : { zip64: true });
        const temporaryFiles = [];
        try {
            for (const entry of entries) {
                if (entry.directory) continue;
                const tempPath = path.join(os.tmpdir(), `klbs-zip-entry-${process.pid}-${crypto.randomBytes(8).toString("hex")}`);
                temporaryFiles.push(tempPath);
                await entry.getData(fileWriter(tempPath), password ? { password } : undefined);
                const fileReader = new NodeFileReader(tempPath);
                await writer.add(entry.filename, fileReader, options.encryptPassword
                    ? { password: options.encryptPassword, encryptionStrength: AES_STRENGTH, zip64: true }
                    : { zip64: true });
                await fileReader.close();
                safeUnlink(tempPath);
                temporaryFiles.pop();
            }
            await writer.close();
        } catch (error) {
            safeUnlink(destinationPath);
            if (password && /password|decrypt|authenticate|signature/i.test(String(error.message))) {
                const passwordError = new Error("The recovery password did not open this backup. Check the password or backup file.");
                passwordError.code = "BACKUP_PASSWORD_INVALID";
                throw passwordError;
            }
            throw error;
        } finally {
            await reader.close().catch(() => {});
            await sourceReader.close().catch(() => {});
            for (const tempPath of temporaryFiles) safeUnlink(tempPath);
        }
    }

    async function encryptZipFile(sourcePath, destinationPath) {
        const password = getLocalPassword();
        if (!password) throw new Error("Set up Backup Encryption before creating backups.");
        await repackageZip(sourcePath, destinationPath, { encryptPassword: password });
        return { encrypted: true, algorithm: "WinZip AES-256" };
    }

    async function createEncryptedArchive(destinationPath, files, textEntries = []) {
        const password = getLocalPassword();
        if (!password) throw new Error("Set up Backup Encryption before creating backups.");
        const { TextReader, ZipWriter } = await getZipModule();
        const writer = new ZipWriter(fileWriter(destinationPath), {
            password,
            encryptionStrength: AES_STRENGTH,
            zip64: true,
            level: 9
        });
        const readers = [];
        try {
            for (const item of textEntries) {
                await writer.add(item.name, new TextReader(item.text), {
                    password, encryptionStrength: AES_STRENGTH
                });
            }
            for (const item of files) {
                const reader = new NodeFileReader(item.path);
                readers.push(reader);
                await writer.add(item.name, reader, {
                    password, encryptionStrength: AES_STRENGTH, zip64: true
                });
            }
            await writer.close();
            return { encrypted: true, algorithm: "WinZip AES-256" };
        } catch (error) {
            safeUnlink(destinationPath);
            throw error;
        } finally {
            for (const reader of readers) await reader.close().catch(() => {});
        }
    }

    async function withDecryptedBackup(sourcePath, password, callback) {
        if (!isEncryptedBackup(sourcePath)) return callback(sourcePath, { encrypted: false });
        const actualPassword = password == null || password === "" ? getLocalPassword() : String(password);
        if (!actualPassword) {
            const error = new Error("Enter the recovery password to open this backup on this computer.");
            error.code = "BACKUP_PASSWORD_REQUIRED";
            throw error;
        }
        const temporaryPath = path.join(os.tmpdir(), `klbs-backup-open-${process.pid}-${crypto.randomBytes(8).toString("hex")}.zip`);
        try {
            await repackageZip(sourcePath, temporaryPath, { decryptPassword: actualPassword });
            if (!readProfile()) {
                const encryptedPassword = safeStorage.encryptString(actualPassword).toString("base64");
                writeProfile({ version: PROFILE_VERSION, encryptedPassword, configuredAt: new Date().toISOString(), importedAt: new Date().toISOString() });
            }
            return await callback(temporaryPath, { encrypted: true, algorithm: "WinZip AES-256" });
        } finally { safeUnlink(temporaryPath); }
    }

    return { getStatus, configureRecoveryPassword, encryptZipFile, createEncryptedArchive, withDecryptedBackup, isEncryptedBackup, getLocalPassword };
}

module.exports = { createBackupEncryptionService };
