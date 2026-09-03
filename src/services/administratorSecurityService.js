const crypto = require("crypto");
const { hashCredential, verifyCredential, isCredentialRecord } = require("./credentialCrypto");

const AUTHORIZATION_LEVELS = Object.freeze({
    MANAGER: "MANAGER",
    ADMINISTRATOR: "ADMINISTRATOR"
});

const AUTHORIZATION_POLICY = Object.freeze({
    "FF": AUTHORIZATION_LEVELS.MANAGER,
    "GIFT_VOUCHER": AUTHORIZATION_LEVELS.MANAGER,
    "DAY_REOPEN": AUTHORIZATION_LEVELS.MANAGER,
    "PAYMENT_CORRECTION": AUTHORIZATION_LEVELS.ADMINISTRATOR,
    "CUSTOMER_REPORT_EXPORT": AUTHORIZATION_LEVELS.ADMINISTRATOR,
    "BILL_SUMMARY_REPORT_EXPORT": AUTHORIZATION_LEVELS.ADMINISTRATOR,
    "RECEIPT_SETTINGS": AUTHORIZATION_LEVELS.ADMINISTRATOR,
    "PRODUCT_IMPORT": AUTHORIZATION_LEVELS.ADMINISTRATOR,
    "INVENTORY_RESET": AUTHORIZATION_LEVELS.ADMINISTRATOR,
    "BACKUP_LOCATION": AUTHORIZATION_LEVELS.ADMINISTRATOR,
    "AUTO_BACKUP_SETTINGS": AUTHORIZATION_LEVELS.ADMINISTRATOR,
    "RESTORE": AUTHORIZATION_LEVELS.ADMINISTRATOR,
    "INSTALL_UPDATE": AUTHORIZATION_LEVELS.ADMINISTRATOR,
    "ACTIVITY_EXPORT": AUTHORIZATION_LEVELS.ADMINISTRATOR,
    "ACTIVITY_ARCHIVE": AUTHORIZATION_LEVELS.ADMINISTRATOR,
    "DSR_SYNC_RETRY": AUTHORIZATION_LEVELS.ADMINISTRATOR,
    "INTEGRATION_EMAIL_SETTINGS": AUTHORIZATION_LEVELS.ADMINISTRATOR,
    "INTEGRATION_DSR_SETTINGS": AUTHORIZATION_LEVELS.ADMINISTRATOR,
    "MANAGER_PIN_MANAGEMENT": AUTHORIZATION_LEVELS.ADMINISTRATOR
});

const AUTHORIZATION_PURPOSES = new Set(Object.keys(AUTHORIZATION_POLICY));

const ADMIN_PIN_AUDIT_POLICY = Object.freeze({
    FF: { classification: "BUSINESS_OPERATION", action: "FAMILY_FRIENDS_DISCOUNT_APPLIED" },
    GIFT_VOUCHER: { classification: "BUSINESS_OPERATION", action: "GIFT_VOUCHER_APPLIED" },
    RECEIPT_SETTINGS: { classification: "BUSINESS_OPERATION", action: "RECEIPT_FOOTER_UPDATED" },
    PAYMENT_CORRECTION: { classification: "BUSINESS_OPERATION", action: "PAYMENT_CORRECTED" },
    PRODUCT_IMPORT: { classification: "BUSINESS_OPERATION", action: "PRODUCT_IMPORT_COMPLETED" },
    INVENTORY_RESET: { classification: "BUSINESS_OPERATION", action: "INVENTORY_RESET" },
    CUSTOMER_REPORT_EXPORT: {
        classification: "RESOURCE_ACCESS",
        resource: "CUSTOMER_PURCHASE_REPORT",
        label: "Customer Purchase Report"
    },
    BILL_SUMMARY_REPORT_EXPORT: {
        classification: "RESOURCE_ACCESS",
        resource: "BILL_SUMMARY_REPORT",
        label: "Bill Summary Report"
    },
    BACKUP_LOCATION: { classification: "BUSINESS_OPERATION", action: "BACKUP_LOCATION_UPDATED" },
    AUTO_BACKUP_SETTINGS: { classification: "BUSINESS_OPERATION", action: "AUTO_BACKUP_TIME_UPDATED" },
    RESTORE: { classification: "BUSINESS_OPERATION", action: "RESTORE_COMPLETED" },
    DAY_REOPEN: { classification: "BUSINESS_OPERATION", action: "BUSINESS_DAY_REOPENED" },
    INSTALL_UPDATE: { classification: "BUSINESS_OPERATION", action: "APPLICATION_UPDATED" },
    ACTIVITY_EXPORT: { classification: "BUSINESS_OPERATION", action: "ACTIVITY_LOG_EXPORTED" },
    ACTIVITY_ARCHIVE: { classification: "BUSINESS_OPERATION", action: "ACTIVITY_LOG_ARCHIVED" },
    DSR_SYNC_RETRY: { classification: "BUSINESS_OPERATION", action: "DSR_SYNC_RETRY" },
    INTEGRATION_EMAIL_SETTINGS: { classification: "BUSINESS_OPERATION", action: "INTEGRATION_EMAIL_SETTINGS_UPDATED" },
    INTEGRATION_DSR_SETTINGS: { classification: "BUSINESS_OPERATION", action: "INTEGRATION_DSR_SETTINGS_UPDATED" },
    MANAGER_PIN_MANAGEMENT: { classification: "BUSINESS_OPERATION", action: "MANAGER_PIN_CHANGED" }
});

if (
    Object.keys(ADMIN_PIN_AUDIT_POLICY).length !== AUTHORIZATION_PURPOSES.size ||
    [...AUTHORIZATION_PURPOSES].some(purpose => !ADMIN_PIN_AUDIT_POLICY[purpose])
) {
    throw new Error("Every protected authorization purpose must have an audit classification.");
}

function createAdministratorSecurityService(database, options = {}) {
    const masterVerifier = options.masterVerifier || null;
    const grantTtlMs = options.grantTtlMs || 60 * 1000;
    const now = options.now || (() => Date.now());
    const grants = new Map();
    const startupSetupSessions = new Map();
    let failedMasterAttempts = 0;

    const get = (sql, params = []) => new Promise((resolve, reject) => {
        database.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
    });
    const run = (sql, params = []) => new Promise((resolve, reject) => {
        database.run(sql, params, function(error) { error ? reject(error) : resolve(this); });
    });

    async function safeLog(event) {
        try {
            if (options.logEvent) {
                await options.logEvent(event);
                return null;
            }
            const { logActivity } = require("../database/activityService");
            await logActivity({
                category: "SECURITY",
                user_name: event.user_name || "ADMINISTRATOR",
                ...event
            });
            return null;
        }
        catch (error) {
            console.error("Administrator security activity logging failed:", error.message);
            return "Administrator authorization completed, but its Activity Log event could not be recorded.";
        }
    }

    function deniedEvent(purpose, level) {
        const policy = ADMIN_PIN_AUDIT_POLICY[purpose];
        const reference = policy.resource || purpose;
        const label = policy.label || purpose.replace(/_/g, " ").toLowerCase();
        return {
            action: "PROTECTED_ACTION_DENIED",
            details: `${level === AUTHORIZATION_LEVELS.MANAGER ? "Manager" : "Administrator"} authorization failed for ${label}`,
            user_name: level,
            status: "FAILED",
            entity_type: "ADMIN_AUTHORIZATION",
            reference_no: reference
        };
    }

    async function denied(purpose, level, error) {
        await safeLog(deniedEvent(purpose, level));
        return { success: false, error };
    }

    function getSecurityRow() {
        return get(`
            SELECT * FROM settings WHERE id = 1
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
            managerPinConfigured: Boolean(
                row && row.manager_security_initialized === 1 &&
                isCredentialRecord(row.manager_pin_hash)
            ),
            masterRecoveryProvisioned: isCredentialRecord(masterVerifier)
        };
    }

    function issueGrant(purpose, level) {
        const token = crypto.randomBytes(32).toString("hex");
        grants.set(token, { purpose, level, expiresAt: now() + grantTtlMs });
        return token;
    }

    function consumeGrant(token, purpose) {
        const normalizedToken = String(token || "");
        const grant = grants.get(normalizedToken);
        if (!grant) return false;
        grants.delete(normalizedToken);
        const expectedLevel = AUTHORIZATION_POLICY[purpose];
        return Boolean(expectedLevel) && grant.purpose === purpose &&
            grant.level === expectedLevel && grant.expiresAt >= now();
    }

    function validateGrant(token, purpose) {
        const grant = grants.get(String(token || ""));
        const expectedLevel = AUTHORIZATION_POLICY[purpose];
        return Boolean(expectedLevel && grant && grant.purpose === purpose &&
            grant.level === expectedLevel && grant.expiresAt >= now());
    }

    function consumeGrants(requirements) {
        const resolved = requirements.map(requirement => ({
            token: String(requirement.token || ""),
            purpose: requirement.purpose,
            grant: grants.get(String(requirement.token || ""))
        }));
        const valid = resolved.every(item =>
            AUTHORIZATION_POLICY[item.purpose] && item.grant &&
            item.grant.purpose === item.purpose &&
            item.grant.level === AUTHORIZATION_POLICY[item.purpose] &&
            item.grant.expiresAt >= now()
        );
        resolved.forEach(item => grants.delete(item.token));
        return valid;
    }

    async function authorizePin(pin, purpose) {
        if (!AUTHORIZATION_PURPOSES.has(purpose)) {
            return { success: false, error: "Unsupported authorization purpose." };
        }
        const level = AUTHORIZATION_POLICY[purpose];
        const label = level === AUTHORIZATION_LEVELS.MANAGER ? "Manager" : "Administrator";
        if (!/^\d{4}$/.test(String(pin || ""))) {
            return denied(purpose, level, `Please enter a valid 4-digit ${label} PIN.`);
        }
        const row = await getSecurityRow();
        const initializedField = level === AUTHORIZATION_LEVELS.MANAGER
            ? "manager_security_initialized" : "admin_security_initialized";
        const hashField = level === AUTHORIZATION_LEVELS.MANAGER
            ? "manager_pin_hash" : "admin_pin_hash";
        if (!row || row[initializedField] !== 1 || !isCredentialRecord(row[hashField])) {
            return denied(purpose, level, `${label} PIN is not configured.`);
        }
        if (!await verifyCredential(pin, row[hashField])) {
            return denied(purpose, level, `Incorrect ${label} PIN.`);
        }
        const result = { success: true, grant: issueGrant(purpose, level) };
        const policy = ADMIN_PIN_AUDIT_POLICY[purpose];
        if (policy.classification === "RESOURCE_ACCESS") {
            const activityWarning = await safeLog({
                action: "PROTECTED_RESOURCE_ACCESSED",
                details: `${policy.label} accessed`,
                status: "SUCCESS",
                entity_type: "PROTECTED_RESOURCE",
                reference_no: policy.resource,
                user_name: level
            });
            if (activityWarning) result.activityWarning = activityWarning;
        }
        return result;
    }

    async function configureManagerPin(newPin, confirmPin, authorizedLevel) {
        if (authorizedLevel !== AUTHORIZATION_LEVELS.ADMINISTRATOR) {
            return { success: false, error: "Administrator authorization is required to manage the Manager PIN." };
        }
        if (!/^\d{4}$/.test(String(newPin || "")) || newPin !== confirmPin) {
            return { success: false, error: "Manager PIN must be 4 digits and match its confirmation." };
        }
        const row = await getSecurityRow();
        const wasConfigured = Boolean(row && row.manager_security_initialized === 1 &&
            isCredentialRecord(row.manager_pin_hash));
        const pinHash = await hashCredential(newPin);
        await run("BEGIN IMMEDIATE TRANSACTION");
        try {
            await run(`
                UPDATE settings
                SET manager_pin_hash = ?, manager_security_initialized = 1
                WHERE id = 1
            `, [pinHash]);
            await run("COMMIT");
        }
        catch (error) {
            await run("ROLLBACK").catch(() => {});
            throw error;
        }
        grants.clear();
        const action = wasConfigured ? "MANAGER_PIN_CHANGED" : "MANAGER_PIN_CONFIGURED";
        const activityWarning = await safeLog({
            action,
            details: wasConfigured ? "Manager PIN changed" : "Manager PIN configured",
            user_name: AUTHORIZATION_LEVELS.ADMINISTRATOR,
            status: "SUCCESS", entity_type: "MANAGER_SECURITY", reference_no: "MANAGER_PIN"
        });
        return { success: true, activityWarning };
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
        await safeLog({
            action: "ADMIN_PIN_CHANGED", details: "Administrator PIN changed",
            status: "SUCCESS", entity_type: "ADMIN_SECURITY", reference_no: "ADMIN_PIN"
        });
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
            await safeLog({
                action: "MASTER_RECOVERY_FAILED", details: "Master recovery authorization failed",
                status: "FAILED", entity_type: "ADMIN_SECURITY", reference_no: "MASTER_RECOVERY"
            });
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
        await safeLog({
            action: wasInitialized ? "ADMIN_PIN_RECOVERED" : "ADMIN_SECURITY_INITIALIZED",
            details: wasInitialized ? "Administrator PIN recovered" : "Administrator Security initialized",
            status: "SUCCESS", entity_type: "ADMIN_SECURITY", reference_no: "ADMIN_PIN"
        });
        await safeLog({
            action: "MASTER_RECOVERY_SUCCESS", details: "Master recovery completed",
            status: "SUCCESS", entity_type: "ADMIN_SECURITY", reference_no: "MASTER_RECOVERY"
        });
        return { success: true };
    }

    async function beginStartupSetup(masterPin) {
        const status = await getStatus();
        if (status.initialized && status.managerPinConfigured) {
            return { success: false, error: "Security setup is already complete." };
        }
        if (!isCredentialRecord(masterVerifier)) {
            return { success: false, error: "Master Recovery is not provisioned." };
        }
        if (!/^\d{6}$/.test(String(masterPin || ""))) {
            return { success: false, error: "Master PIN must contain exactly 6 digits." };
        }
        if (!await verifyCredential(masterPin, masterVerifier)) {
            await safeLog({
                action: "MASTER_RECOVERY_FAILED", details: "Startup security setup authorization failed",
                status: "FAILED", entity_type: "ADMIN_SECURITY", reference_no: "MASTER_RECOVERY"
            });
            await delayMasterFailure();
            return { success: false, error: "Master PIN is incorrect." };
        }
        failedMasterAttempts = 0;
        startupSetupSessions.clear();
        const token = crypto.randomBytes(32).toString("hex");
        startupSetupSessions.set(token, { expiresAt: now() + grantTtlMs });
        await safeLog({
            action: "MASTER_RECOVERY_SUCCESS", details: "Startup security setup authorized",
            status: "SUCCESS", entity_type: "ADMIN_SECURITY", reference_no: "MASTER_RECOVERY"
        });
        return { success: true, setupToken: token };
    }

    function validateStartupSetupSession(token) {
        const normalizedToken = String(token || "");
        const session = startupSetupSessions.get(normalizedToken);
        if (!session || session.expiresAt < now()) {
            startupSetupSessions.delete(normalizedToken);
            return false;
        }
        return true;
    }

    async function configureMissingPinWithStartupSetup(data, level) {
        if (!validateStartupSetupSession(data && data.setupToken)) {
            return { success: false, error: "Startup security setup authorization has expired." };
        }
        const status = await getStatus();
        const isManager = level === AUTHORIZATION_LEVELS.MANAGER;
        if (isManager ? status.managerPinConfigured : status.initialized) {
            return { success: false, error: `${isManager ? "Manager" : "Administrator"} PIN is already configured.` };
        }
        if (!/^\d{4}$/.test(String(data.newPin || "")) || data.newPin !== data.confirmPin) {
            return { success: false, error: `${isManager ? "Manager" : "Administrator"} PIN must be 4 digits and match its confirmation.` };
        }
        const pinHash = await hashCredential(data.newPin);
        const sql = isManager
            ? "UPDATE settings SET manager_pin_hash = ?, manager_security_initialized = 1 WHERE id = 1"
            : "UPDATE settings SET admin_pin_hash = ?, admin_security_initialized = 1, ff_pin = NULL WHERE id = 1";
        await run("BEGIN IMMEDIATE TRANSACTION");
        try {
            await run(sql, [pinHash]);
            await run("COMMIT");
        }
        catch (error) {
            await run("ROLLBACK").catch(() => {});
            throw error;
        }
        await safeLog({
            action: isManager ? "MANAGER_PIN_CONFIGURED" : "ADMIN_SECURITY_INITIALIZED",
            details: isManager ? "Manager PIN configured" : "Administrator Security initialized",
            user_name: AUTHORIZATION_LEVELS.ADMINISTRATOR,
            status: "SUCCESS",
            entity_type: isManager ? "MANAGER_SECURITY" : "ADMIN_SECURITY",
            reference_no: isManager ? "MANAGER_PIN" : "ADMIN_PIN"
        });
        const updatedStatus = await getStatus();
        if (updatedStatus.initialized && updatedStatus.managerPinConfigured) {
            startupSetupSessions.clear();
        }
        return { success: true };
    }

    async function recoverManagerPin(data) {
        const status = await getStatus();
        if (!isCredentialRecord(masterVerifier)) {
            return { success: false, error: "Master Recovery is not provisioned." };
        }
        if (!/^\d{6}$/.test(String(data.masterPin || ""))) {
            return { success: false, error: "Master PIN must contain exactly 6 digits." };
        }
        if (!/^\d{4}$/.test(String(data.newPin || "")) || data.newPin !== data.confirmPin) {
            return { success: false, error: "Manager PIN must be 4 digits and match its confirmation." };
        }
        if (!await verifyCredential(data.masterPin, masterVerifier)) {
            await safeLog({
                action: "MASTER_RECOVERY_FAILED", details: "Master recovery authorization failed",
                status: "FAILED", entity_type: "MANAGER_SECURITY", reference_no: "MASTER_RECOVERY"
            });
            await delayMasterFailure();
            return { success: false, error: "Master PIN is incorrect." };
        }

        const pinHash = await hashCredential(data.newPin);
        await run("BEGIN IMMEDIATE TRANSACTION");
        try {
            await run(`
                UPDATE settings
                SET manager_pin_hash = ?, manager_security_initialized = 1
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
        await safeLog({
            action: status.managerPinConfigured ? "MANAGER_PIN_RECOVERED" : "MANAGER_PIN_CONFIGURED",
            details: status.managerPinConfigured ? "Manager PIN recovered" : "Manager PIN configured",
            user_name: AUTHORIZATION_LEVELS.ADMINISTRATOR,
            status: "SUCCESS", entity_type: "MANAGER_SECURITY", reference_no: "MANAGER_PIN"
        });
        await safeLog({
            action: "MASTER_RECOVERY_SUCCESS", details: "Master recovery completed",
            status: "SUCCESS", entity_type: "MANAGER_SECURITY", reference_no: "MASTER_RECOVERY"
        });
        return { success: true };
    }

    return {
        getStatus, authorizePin, changePin, recoverPin, recoverManagerPin, configureManagerPin,
        beginStartupSetup,
        configureMissingAdministratorPin: data =>
            configureMissingPinWithStartupSetup(data || {}, AUTHORIZATION_LEVELS.ADMINISTRATOR),
        configureMissingManagerPin: data =>
            configureMissingPinWithStartupSetup(data || {}, AUTHORIZATION_LEVELS.MANAGER),
        consumeGrant, consumeGrants, validateGrant,
        clearGrants: () => grants.clear(),
        clearStartupSetupSessions: () => startupSetupSessions.clear()
    };
}

module.exports = {
    createAdministratorSecurityService,
    AUTHORIZATION_LEVELS,
    AUTHORIZATION_POLICY,
    AUTHORIZATION_PURPOSES,
    ADMIN_PIN_AUDIT_POLICY
};
