const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const LEVELS = new Set(["INFO", "WARN", "ERROR", "FATAL"]);
const MAX_COMPONENT = 64;
const MAX_MESSAGE = 1000;
const MAX_METADATA_KEYS = 20;
const MAX_METADATA_STRING = 500;
const MAX_STACK = 8 * 1024;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_RETENTION = 3;
const SENSITIVE_KEY = /(pin|password|secret|signature|token|grant|salt|hash|verifier|credential|authorization|cookie|oauth|smtp_password|private_key|customer|mobile|phone|email|billdata|store.?credit)/i;

let state = {
    initialized: false,
    directory: null,
    filePath: null,
    sessionId: crypto.randomBytes(6).toString("hex"),
    appVersion: null,
    platform: null,
    isPackaged: null,
    sensitivePaths: [],
    maxBytes: DEFAULT_MAX_BYTES,
    retention: DEFAULT_RETENTION,
    fsImpl: fs,
    failureReported: false,
    rotating: false
};

function cleanControls(value, maxLength) {
    return String(value === null || value === undefined ? "" : value)
        .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxLength);
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redactPaths(value) {
    let output = value;
    for (const item of state.sensitivePaths) {
        if (!item.value) continue;
        output = output.replace(new RegExp(escapeRegExp(item.value), "gi"), item.label);
    }
    output = output
        .replace(/[A-Za-z]:\\Users\\[^\\\s]+/gi, "[HOME]")
        .replace(/\/(?:Users|home)\/[^/\s]+/g, "[HOME]");
    return output;
}

function redactInlineSecrets(value) {
    return value
        .replace(/-----BEGIN [^-]*(?:PRIVATE KEY)-----.*$/gi, "[REDACTED_PRIVATE_KEY]")
        .replace(/\b(Bearer)\s+[A-Za-z0-9._~+\/-]+/gi, "$1 [REDACTED]")
        .replace(/\b((?:administrator|manager|master)\s+pin|pin(?:\s+hash)?)\s*(?:[:=]|\bis\b)?\s*([0-9]{4,}|[A-Fa-f0-9]{16,})/gi, "$1=[REDACTED]")
        .replace(/\b[A-Za-z0-9_]*(?:pin|password|secret|signature|token|grant|salt|hash|verifier|credential|authorization|cookie|oauth|smtp_password|private_key)[A-Za-z0-9_]*\b\s*[:=]\s*([^\s,;|}]+)/gi, "[REDACTED_FIELD]=[REDACTED]")
        .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[EMAIL]")
        .replace(/\b(?:\+?91[- ]?)?[6-9]\d{9}\b/g, "[MOBILE]");
}

function sanitizeText(value, maxLength = MAX_MESSAGE) {
    return cleanControls(redactInlineSecrets(redactPaths(String(
        value === null || value === undefined ? "" : value
    ))), maxLength);
}

function sanitizePrimitive(key, value) {
    if (SENSITIVE_KEY.test(key)) return "[REDACTED]";
    if (value === null || value === undefined) return null;
    if (typeof value === "string") return sanitizeText(value, MAX_METADATA_STRING);
    if (typeof value === "number") return Number.isFinite(value) ? value : "[INVALID_NUMBER]";
    if (typeof value === "boolean") return value;
    return "[OMITTED]";
}

function sanitizeMetadata(metadata) {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
    const result = {};
    for (const key of Object.keys(metadata).slice(0, MAX_METADATA_KEYS)) {
        const safeKey = cleanControls(key, 64).replace(/[^A-Za-z0-9_.-]/g, "_");
        if (!safeKey) continue;
        result[safeKey] = sanitizePrimitive(safeKey, metadata[key]);
    }
    return Object.keys(result).length ? result : undefined;
}

function sanitizeError(error) {
    try {
        if (!error) return undefined;
        if (typeof error === "string") {
            return { name: "Error", message: sanitizeText(error) };
        }
        const result = {
            name: sanitizeText(error.name || "Error", 100),
            message: sanitizeText(error.message || "Technical operation failed.")
        };
        if (typeof error.code === "string" || typeof error.code === "number") {
            result.code = sanitizeText(error.code, 100);
        }
        if (typeof error.stack === "string") {
            result.stack = sanitizeText(error.stack, MAX_STACK);
        }
        return result;
    }
    catch (_) {
        return { name: "Error", message: "Technical operation failed." };
    }
}

function consoleFallback(error) {
    if (state.failureReported) return;
    state.failureReported = true;
    try {
        console.error("KLBS technical logger unavailable:",
            sanitizeText(error && error.message || error, 200));
    }
    catch (_) {}
}

function rotateIfRequired(incomingBytes) {
    if (state.rotating) return;
    const fileSystem = state.fsImpl;
    let currentSize = 0;
    try {
        currentSize = fileSystem.existsSync(state.filePath)
            ? fileSystem.statSync(state.filePath).size : 0;
    }
    catch (error) {
        consoleFallback(error);
        return;
    }
    if (currentSize + incomingBytes <= state.maxBytes) return;
    state.rotating = true;
    try {
        const oldest = `${state.filePath}.${state.retention}`;
        if (fileSystem.existsSync(oldest)) fileSystem.unlinkSync(oldest);
        for (let index = state.retention - 1; index >= 1; index -= 1) {
            const source = `${state.filePath}.${index}`;
            if (fileSystem.existsSync(source)) {
                fileSystem.renameSync(source, `${state.filePath}.${index + 1}`);
            }
        }
        if (fileSystem.existsSync(state.filePath)) {
            fileSystem.renameSync(state.filePath, `${state.filePath}.1`);
        }
    }
    catch (error) {
        consoleFallback(error);
    }
    finally {
        state.rotating = false;
    }
}

function initialize(options = {}) {
    try {
        const directory = path.resolve(String(options.logDirectory || ""));
        if (!options.logDirectory) throw new Error("Technical log directory is required.");
        const fsImpl = options.fsImpl || fs;
        fsImpl.mkdirSync(directory, { recursive: true });
        const filePath = path.join(directory, "KLBS.log");
        fsImpl.closeSync(fsImpl.openSync(filePath, "a"));
        const sensitivePaths = Array.isArray(options.sensitivePaths)
            ? options.sensitivePaths : [];
        state = {
            initialized: true,
            directory,
            filePath,
            sessionId: crypto.randomBytes(6).toString("hex"),
            appVersion: sanitizeText(options.appVersion || "unknown", 100),
            platform: sanitizeText(options.platform || process.platform, 50),
            isPackaged: Boolean(options.isPackaged),
            sensitivePaths: [
                { value: directory, label: "[LOG_DIR]" },
                ...sensitivePaths.map(item => typeof item === "string"
                    ? { value: item, label: "[PATH]" }
                    : { value: String(item.value || ""), label: String(item.label || "[PATH]") })
            ].sort((left, right) => right.value.length - left.value.length),
            maxBytes: Number.isSafeInteger(options.maxBytes) && options.maxBytes > 0
                ? options.maxBytes : DEFAULT_MAX_BYTES,
            retention: Number.isSafeInteger(options.retention) && options.retention > 0
                ? Math.min(options.retention, DEFAULT_RETENTION) : DEFAULT_RETENTION,
            fsImpl,
            failureReported: false,
            rotating: false
        };
        return true;
    }
    catch (error) {
        state.initialized = false;
        state.directory = null;
        state.filePath = null;
        consoleFallback(error);
        return false;
    }
}

function write(level, component, message, error, metadata) {
    try {
        if (!state.initialized || !LEVELS.has(level)) return false;
        const entry = {
            timestamp: new Date().toISOString(),
            level,
            component: sanitizeText(component || "APPLICATION", MAX_COMPONENT) || "APPLICATION",
            sessionId: state.sessionId,
            message: sanitizeText(message || "Technical event") || "Technical event"
        };
        const safeMetadata = sanitizeMetadata(metadata);
        const safeError = sanitizeError(error);
        if (safeMetadata) entry.metadata = safeMetadata;
        if (safeError) entry.error = safeError;
        const line = `${JSON.stringify(entry)}\n`;
        rotateIfRequired(Buffer.byteLength(line, "utf8"));
        state.fsImpl.appendFileSync(state.filePath, line, "utf8");
        state.failureReported = false;
        return true;
    }
    catch (writeError) {
        consoleFallback(writeError);
        return false;
    }
}

function info(component, message, metadata) {
    return write("INFO", component, message, null, metadata);
}
function warn(component, message, metadata) {
    return write("WARN", component, message, null, metadata);
}
function error(component, message, errorValue, metadata) {
    return write("ERROR", component, message, errorValue, metadata);
}
function fatal(component, message, errorValue, metadata) {
    return write("FATAL", component, message, errorValue, metadata);
}
function getLogDirectory() {
    try { return state.initialized ? state.directory : null; }
    catch (_) { return null; }
}

module.exports = {
    initialize, info, warn, error, fatal, sanitizeError, getLogDirectory,
    _test: { sanitizeText, sanitizeMetadata, DEFAULT_MAX_BYTES, DEFAULT_RETENTION }
};
