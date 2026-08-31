const crypto = require("crypto");
const { hashCredential, verifyCredential, isCredentialRecord } = require("./credentialCrypto");

const ADMIN_PIN_PURPOSES = new Set([
    "FF", "GIFT_VOUCHER", "RECEIPT_SETTINGS", "PAYMENT_CORRECTION",
    "PRODUCT_IMPORT", "INVENTORY_RESET", "CUSTOMER_REPORT_EXPORT",
    "BILL_SUMMARY_REPORT_EXPORT",
    "BACKUP_LOCATION", "AUTO_BACKUP_SETTINGS", "RESTORE", "DAY_REOPEN",
    "INSTALL_UPDATE"
]);

function createAdministratorSecurityService(database, options = {}) {
    const masterVerifier = options.masterVerifier || null;
    const grantTtlMs = options.grantTtlMs || 60 * 1000;
    const now = options.now || (() => Date.now());
    const grants = new Map();
    let failedMasterAttempts = 0;

    const get = (sql, params = []) => new Promise((resolve, reject) => {
        database.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
    });
    const run = (sql, params = []) => new Promise((resolve, reject) => {
        database.run(sql, params, function(error) { error ? reject(error) : resolve(this); });
    });

    async function safeLog(action, status = "SUCCESS") {
        try {
            if (options.logEvent) {
                await options.logEvent({ action, status });
                return;
            }
            const { logActivity } = require("../database/activityService");
            await logActivity({
                category: "SECURITY", action,
                details: "Administrator security event",
                user_name: "Administrator", status
            });
        }
        catch (error) {
            console.error("Administrator security activity logging failed:", error.message);
        }
    }

    function getSecurityRow() {
        return get(`
            SELECT admin_pin_hash, admin_security_initialized
            FROM settings WHERE id = 1
        `);
    }

    async function getStatus() {
        const row = await getSecurityRow();
        const initialized = Boolean(
            row && row.admin_security_initialized === 1 &&
            isCredentialRecord(row.admin_pin_hash)
        );
        return {
            initialized,
            pinConfigured: initialized,
            masterRecoveryProvisioned: isCredentialRecord(masterVerifier)
        };
    }

    function issueGrant(purpose) {
        const token = crypto.randomBytes(32).toString("hex");
        grants.set(token, { purpose, expiresAt: now() + grantTtlMs });
        return token;
    }

    function consumeGrant(token, purpose) {
        const normalizedToken = String(token || "");
        const grant = grants.get(normalizedToken);
        if (!grant) return false;
        grants.delete(normalizedToken);
        return grant.purpose === purpose && grant.expiresAt >= now();
    }

    function consumeGrants(requirements) {
        const resolved = requirements.map(requirement => ({
            token: String(requirement.token || ""),
            purpose: requirement.purpose,
            grant: grants.get(String(requirement.token || ""))
        }));
        const valid = resolved.every(item =>
            item.grant && item.grant.purpose === item.purpose &&
            item.grant.expiresAt >= now()
        );
        resolved.forEach(item => grants.delete(item.token));
        return valid;
    }

    async function authorizePin(pin, purpose) {
        if (!ADMIN_PIN_PURPOSES.has(purpose)) {
            return { success: false, error: "Unsupported authorization purpose." };
        }
        if (!/^\d{4}$/.test(String(pin || ""))) {
            return { success: false, error: "Please enter a valid 4-digit Administrator PIN." };
        }
        const row = await getSecurityRow();
        if (!row || row.admin_security_initialized !== 1 ||
            !isCredentialRecord(row.admin_pin_hash)) {
            return { success: false, error: "Administrator Security is not configured." };
        }
        if (!await verifyCredential(pin, row.admin_pin_hash)) {
            return { success: false, error: "Incorrect Administrator PIN." };
        }
        return { success: true, grant: issueGrant(purpose) };
    }

    async function changePin(currentPin, newPin, confirmPin) {
        if (!/^\d{4}$/.test(String(currentPin || ""))) {
            return { success: false, error: "Current Administrator PIN must contain exactly 4 digits." };
        }
        if (!/^\d{4}$/.test(String(newPin || "")) || newPin !== confirmPin) {
            return { success: false, error: "New Administrator PIN must be 4 digits and match its confirmation." };
        }
        const row = await getSecurityRow();
        if (!row || row.admin_security_initialized !== 1 ||
            !isCredentialRecord(row.admin_pin_hash) ||
            !await verifyCredential(currentPin, row.admin_pin_hash)) {
            return { success: false, error: "Current Administrator PIN is incorrect." };
        }
        const newHash = await hashCredential(newPin);
        await run("BEGIN IMMEDIATE TRANSACTION");
        try {
            await run("UPDATE settings SET admin_pin_hash = ?, ff_pin = NULL WHERE id = 1", [newHash]);
            await run("COMMIT");
        }
        catch (error) {
            await run("ROLLBACK").catch(() => {});
            throw error;
        }
        grants.clear();
        await safeLog("ADMIN_PIN_CHANGED");
        return { success: true };
    }

    async function delayMasterFailure() {
        failedMasterAttempts += 1;
        const delayMs = Math.min(250 * (2 ** (failedMasterAttempts - 1)), 2000);
        await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    async function recoverPin(data) {
        const wasInitialized = (await getStatus()).initialized;
        if (!isCredentialRecord(masterVerifier)) {
            return { success: false, error: "Master Recovery is not provisioned." };
        }
        if (!/^\d{6}$/.test(String(data.masterPin || ""))) {
            return { success: false, error: "Master PIN must contain exactly 6 digits." };
        }
        if (!/^\d{4}$/.test(String(data.newPin || ""))) {
            return { success: false, error: "Administrator PIN must contain exactly 4 digits." };
        }
        if (data.newPin !== data.confirmPin) {
            return { success: false, error: "Administrator PIN confirmation does not match." };
        }
        if (!await verifyCredential(data.masterPin, masterVerifier)) {
            await safeLog("MASTER_RECOVERY_FAILED", "FAILED");
            await delayMasterFailure();
            return { success: false, error: "Master PIN is incorrect." };
        }

        const pinHash = await hashCredential(data.newPin);
        await run("BEGIN IMMEDIATE TRANSACTION");
        try {
            await run(`
                UPDATE settings
                SET admin_pin_hash = ?, admin_security_initialized = 1, ff_pin = NULL
                WHERE id = 1
            `, [pinHash]);
            await run("COMMIT");
        }
        catch (error) {
            await run("ROLLBACK").catch(() => {});
            throw error;
        }
        failedMasterAttempts = 0;
        grants.clear();
        await safeLog(wasInitialized ? "ADMIN_PIN_RECOVERED" : "ADMIN_SECURITY_INITIALIZED");
        await safeLog("MASTER_RECOVERY_SUCCESS");
        return { success: true };
    }

    return {
        getStatus, authorizePin, changePin, recoverPin,
        consumeGrant, consumeGrants,
        clearGrants: () => grants.clear()
    };
}

module.exports = { createAdministratorSecurityService, ADMIN_PIN_PURPOSES };
