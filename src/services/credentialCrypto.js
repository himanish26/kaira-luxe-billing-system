const crypto = require("crypto");

const SCRYPT_VERSION = "v1";
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;

function scryptAsync(value, salt, options) {
    return new Promise((resolve, reject) => {
        crypto.scrypt(
            value,
            salt,
            SCRYPT_KEY_LENGTH,
            options,
            (error, derivedKey) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(derivedKey);
            }
        );
    });
}

async function hashCredential(value) {
    const normalized = String(value);
    const salt = crypto.randomBytes(16);
    const derivedKey = await scryptAsync(normalized, salt, {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        maxmem: SCRYPT_MAX_MEMORY
    });

    return [
        "scrypt",
        SCRYPT_VERSION,
        SCRYPT_N,
        SCRYPT_R,
        SCRYPT_P,
        salt.toString("base64"),
        derivedKey.toString("base64")
    ].join("$");
}

async function verifyCredential(value, record) {
    try {
        const parts = String(record || "").split("$");
        if (parts.length !== 7 || parts[0] !== "scrypt" || parts[1] !== SCRYPT_VERSION) {
            return false;
        }

        const N = Number(parts[2]);
        const r = Number(parts[3]);
        const p = Number(parts[4]);
        const salt = Buffer.from(parts[5], "base64");
        const expected = Buffer.from(parts[6], "base64");

        if (
            N !== SCRYPT_N ||
            r !== SCRYPT_R ||
            p !== SCRYPT_P ||
            salt.length < 16 ||
            expected.length !== SCRYPT_KEY_LENGTH
        ) {
            return false;
        }

        const actual = await scryptAsync(String(value), salt, {
            N,
            r,
            p,
            maxmem: SCRYPT_MAX_MEMORY
        });

        return crypto.timingSafeEqual(actual, expected);
    }
    catch (_error) {
        return false;
    }
}

function isCredentialRecord(record) {
    return typeof record === "string" &&
        record.startsWith(`scrypt$${SCRYPT_VERSION}$`);
}

module.exports = {
    hashCredential,
    verifyCredential,
    isCredentialRecord
};
