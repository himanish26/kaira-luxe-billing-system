const crypto = require("crypto");
const { hashCredential, verifyCredential, isCredentialRecord } = require("./credentialCrypto");

const AUTHORIZATION_LEVELS = Object.freeze({
    MANAGER: "MANAGER",
    ADMINISTRATOR: "ADMINISTRATOR",
    MASTER: "MASTER"
});

const PIN_PERMISSION_DEFAULTS = Object.freeze({
    familyFriendsDiscount: { administrator: false, manager: true, master: false },
    giftVoucher: { administrator: false, manager: true, master: false },
    stockInwardOutward: { administrator: false, manager: true, master: false },
    dayReopen: { administrator: false, manager: true, master: false },
    paymentCorrection: { administrator: true, manager: false, master: false },
    productMasterImport: { administrator: true, manager: false, master: false },
    inventoryReset: { administrator: true, manager: false, master: false },
    backupRestore: { administrator: true, manager: false, master: false },
    applicationUpdates: { administrator: true, manager: false, master: false },
    activityLogOperations: { administrator: true, manager: false, master: false },
    integrations: { administrator: true, manager: false, master: false },
    customers: { administrator: false, manager: true, master: false },
    suppliers: { administrator: false, manager: true, master: false },
    accountingData: { administrator: false, manager: true, master: false },
    customerReportExport: { administrator: true, manager: false, master: false },
    billSummaryReportExport: { administrator: true, manager: false, master: false },
    receiptSettings: { administrator: true, manager: false, master: false },
    backupLocation: { administrator: true, manager: false, master: false },
    automaticBackupSettings: { administrator: true, manager: false, master: false },
    pinManagement: { administrator: true, manager: false, master: true },
    administratorPinRecovery: { administrator: false, manager: false, master: true },
    restoreDefaultPinSettings: { administrator: true, manager: false, master: false }
});

const PIN_PERMISSION_FEATURES = Object.freeze({
    FF: "familyFriendsDiscount", GIFT_VOUCHER: "giftVoucher",
    INVENTORY_INWARD: "stockInwardOutward", INVENTORY_OUTWARD: "stockInwardOutward",
    DAY_REOPEN: "dayReopen", PAYMENT_CORRECTION: "paymentCorrection",
    PRODUCT_IMPORT: "productMasterImport", INVENTORY_RESET: "inventoryReset",
    RESTORE: "backupRestore",
    INSTALL_UPDATE: "applicationUpdates", ACTIVITY_EXPORT: "activityLogOperations",
    ACTIVITY_ARCHIVE: "activityLogOperations", DSR_SYNC_RETRY: "integrations",
    INTEGRATION_EMAIL_SETTINGS: "integrations", INTEGRATION_DSR_SETTINGS: "integrations",
    INTEGRATION_REMOTE_DASHBOARD_SETTINGS: "integrations", INTEGRATION_CUSTOMER_CRM_SETTINGS: "integrations",
    CUSTOMERS_MODULE_ACCESS: "customers", SUPPLIERS_MODULE_ACCESS: "suppliers",
    ACCOUNTING_DATA_MODULE_ACCESS: "accountingData", CUSTOMER_REPORT_EXPORT: "customerReportExport",
    BILL_SUMMARY_REPORT_EXPORT: "billSummaryReportExport", RECEIPT_SETTINGS: "receiptSettings",
    BACKUP_LOCATION: "backupLocation", AUTO_BACKUP_SETTINGS: "automaticBackupSettings",
    EXPENSE_POST: "accountingData", P_AND_L_ENTRY_POST: "accountingData",
    P_AND_L_ENTRY_REVERSE: "accountingData", SUPPLIER_INVOICE_POST: "accountingData",
    SUPPLIER_PAYMENT_POST: "accountingData", SUPPLIER_OPENING_BALANCE_POST: "accountingData",
    SUPPLIER_CREDIT_NOTE_POST: "accountingData"
});

const MANAGER_CONFIGURABLE_PERMISSIONS = new Set([
    "familyFriendsDiscount", "giftVoucher", "stockInwardOutward", "dayReopen",
    "customers", "suppliers", "accountingData"
]);

const PIN_PERMISSION_LOCKED = new Set(["pinManagement", "administratorPinRecovery", "restoreDefaultPinSettings"]);
const PIN_MANAGEMENT_INACTIVITY_TTL_MS = 60 * 1000;
const PIN_PERMISSION_LABELS = Object.freeze({
    familyFriendsDiscount: "Family & Friends Discount", giftVoucher: "Gift Voucher",
    stockInwardOutward: "Stock Inward / Outward", dayReopen: "Day Reopen",
    paymentCorrection: "Payment Correction", productMasterImport: "Product Master Import",
    inventoryReset: "Inventory Reset", backupRestore: "Backup & Restore",
    applicationUpdates: "Application Updates", activityLogOperations: "Activity Log Protected Operations",
    integrations: "All Integrations Configuration", customers: "Customers", suppliers: "Suppliers",
    accountingData: "Accounting & Data", customerReportExport: "Customer Report Export",
    billSummaryReportExport: "Bill Summary Report Export", receiptSettings: "Receipt Settings Modification",
    backupLocation: "Backup Location Modification", automaticBackupSettings: "Automatic Backup Settings Modification",
    pinManagement: "PIN Management", administratorPinRecovery: "Administrator PIN Recovery",
    restoreDefaultPinSettings: "Restore Default PIN Settings"
});

function clonePermissionMatrix(value = PIN_PERMISSION_DEFAULTS) {
    return Object.fromEntries(Object.entries(value).map(([key, roles]) => [key, { ...roles }]));
}

function validatePermissionMatrix(input, current = PIN_PERMISSION_DEFAULTS) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("PIN permissions are invalid.");
    const keys = Object.keys(PIN_PERMISSION_DEFAULTS);
    if (Object.keys(input).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(input, key))) {
        throw new Error("PIN permissions do not match the approved feature matrix.");
    }
    const normalized = {};
    for (const key of keys) {
        const roles = input[key];
        const label = PIN_PERMISSION_LABELS[key];
        const proposedMaster = roles && Object.prototype.hasOwnProperty.call(roles, "master") ? roles.master : PIN_PERMISSION_DEFAULTS[key].master;
        if (!roles || typeof roles !== "object" || Array.isArray(roles) ||
            typeof roles.administrator !== "boolean" || typeof roles.manager !== "boolean" ||
            (Object.prototype.hasOwnProperty.call(roles, "master") && typeof roles.master !== "boolean") ||
            Object.keys(roles).some(role => !["administrator", "manager", "master"].includes(role))) {
            throw new Error(`${label}: Administrator and Manager selections are required.`);
        }
        normalized[key] = { administrator: roles.administrator, manager: roles.manager, master: proposedMaster };
        const fixedMaster = current[key]?.master ?? PIN_PERMISSION_DEFAULTS[key].master;
        if (proposedMaster !== fixedMaster || roles.administrator !== current[key].administrator) {
            throw new Error(`${label}: fixed Administrator and Master assignments cannot be changed.`);
        }
        if (PIN_PERMISSION_LOCKED.has(key)) {
            const defaults = PIN_PERMISSION_DEFAULTS[key];
            if (roles.manager !== defaults.manager || roles.administrator !== defaults.administrator ||
                proposedMaster !== defaults.master) throw new Error(`${label} is a mandatory security permission and cannot be changed.`);
        } else if (MANAGER_CONFIGURABLE_PERMISSIONS.has(key)) {
            if (roles.manager && roles.administrator) throw new Error(`${label}: Administrator and Manager cannot both be assigned.`);
        } else if (roles.manager !== current[key].manager) {
            throw new Error(`${label}: this permission cannot be reassigned.`);
        }
    }
    return normalized;
}

const AUTHORIZATION_POLICY = Object.freeze({
    "FF": AUTHORIZATION_LEVELS.MANAGER,
    "GIFT_VOUCHER": AUTHORIZATION_LEVELS.MANAGER,
    "INVENTORY_INWARD": AUTHORIZATION_LEVELS.MANAGER,
    "INVENTORY_OUTWARD": AUTHORIZATION_LEVELS.MANAGER,
    "DAY_REOPEN": AUTHORIZATION_LEVELS.MANAGER,
    "EXPENSE_POST": AUTHORIZATION_LEVELS.MANAGER,
    "P_AND_L_ENTRY_POST": AUTHORIZATION_LEVELS.MANAGER,
    "P_AND_L_ENTRY_REVERSE": AUTHORIZATION_LEVELS.MANAGER,
    "SUPPLIER_INVOICE_POST": AUTHORIZATION_LEVELS.MANAGER,
    "SUPPLIER_PAYMENT_POST": AUTHORIZATION_LEVELS.MANAGER,
    "SUPPLIER_OPENING_BALANCE_POST": AUTHORIZATION_LEVELS.MANAGER,
    "SUPPLIER_CREDIT_NOTE_POST": AUTHORIZATION_LEVELS.MANAGER,
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
    "INTEGRATION_REMOTE_DASHBOARD_SETTINGS": AUTHORIZATION_LEVELS.ADMINISTRATOR,
    "INTEGRATION_CUSTOMER_CRM_SETTINGS": AUTHORIZATION_LEVELS.ADMINISTRATOR,
    "PIN_MANAGEMENT_ADMIN": AUTHORIZATION_LEVELS.ADMINISTRATOR,
    "PIN_MANAGEMENT_MASTER": AUTHORIZATION_LEVELS.MASTER,
    "RESTORE_PIN_DEFAULTS": AUTHORIZATION_LEVELS.ADMINISTRATOR,
    "CUSTOMERS_MODULE_ACCESS": AUTHORIZATION_LEVELS.MANAGER,
    "SUPPLIERS_MODULE_ACCESS": AUTHORIZATION_LEVELS.MANAGER,
    "ACCOUNTING_DATA_MODULE_ACCESS": AUTHORIZATION_LEVELS.MANAGER,
    "MANAGER_PIN_MANAGEMENT": AUTHORIZATION_LEVELS.ADMINISTRATOR
});

const AUTHORIZATION_PURPOSES = new Set(Object.keys(AUTHORIZATION_POLICY));

const ADMIN_PIN_AUDIT_POLICY = Object.freeze({
    FF: { classification: "BUSINESS_OPERATION", action: "FAMILY_FRIENDS_DISCOUNT_APPLIED" },
    GIFT_VOUCHER: { classification: "BUSINESS_OPERATION", action: "GIFT_VOUCHER_APPLIED" },
    INVENTORY_INWARD: { classification: "BUSINESS_OPERATION", action: "STOCK_INWARD_AUTHORIZED" },
    INVENTORY_OUTWARD: { classification: "BUSINESS_OPERATION", action: "STOCK_OUTWARD_AUTHORIZED" },
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
    EXPENSE_POST: { classification: "BUSINESS_OPERATION", action: "EXPENSE_BATCH_POSTED" },
    P_AND_L_ENTRY_POST: { classification: "BUSINESS_OPERATION", action: "MANAGEMENT_ACCOUNTING_ENTRY_POSTED" },
    P_AND_L_ENTRY_REVERSE: { classification: "BUSINESS_OPERATION", action: "MANAGEMENT_ACCOUNTING_ENTRY_REVERSED" },
    SUPPLIER_INVOICE_POST: { classification: "BUSINESS_OPERATION", action: "SUPPLIER_INVOICE_POST_AUTHORIZED" },
    SUPPLIER_PAYMENT_POST: { classification: "BUSINESS_OPERATION", action: "SUPPLIER_PAYMENT_POST_AUTHORIZED" },
    SUPPLIER_OPENING_BALANCE_POST: { classification: "BUSINESS_OPERATION", action: "SUPPLIER_OPENING_BALANCE_POST_AUTHORIZED" },
    SUPPLIER_CREDIT_NOTE_POST: { classification: "BUSINESS_OPERATION", action: "SUPPLIER_CREDIT_NOTE_POST_AUTHORIZED" },
    INSTALL_UPDATE: { classification: "BUSINESS_OPERATION", action: "APPLICATION_UPDATED" },
    ACTIVITY_EXPORT: { classification: "BUSINESS_OPERATION", action: "ACTIVITY_LOG_EXPORTED" },
    ACTIVITY_ARCHIVE: { classification: "BUSINESS_OPERATION", action: "ACTIVITY_LOG_ARCHIVED" },
    DSR_SYNC_RETRY: { classification: "BUSINESS_OPERATION", action: "DSR_SYNC_RETRY" },
    INTEGRATION_EMAIL_SETTINGS: { classification: "BUSINESS_OPERATION", action: "INTEGRATION_EMAIL_SETTINGS_UPDATED" },
    INTEGRATION_DSR_SETTINGS: { classification: "BUSINESS_OPERATION", action: "INTEGRATION_DSR_SETTINGS_UPDATED" },
    INTEGRATION_REMOTE_DASHBOARD_SETTINGS: { classification: "BUSINESS_OPERATION", action: "REMOTE_DASHBOARD_SETTINGS_UPDATED" },
    INTEGRATION_CUSTOMER_CRM_SETTINGS: { classification: "BUSINESS_OPERATION", action: "CUSTOMER_CRM_SETTINGS_ACCESSED" },
    PIN_MANAGEMENT_ADMIN: { classification: "BUSINESS_OPERATION", action: "PIN_MANAGEMENT_AUTHORIZED" },
    PIN_MANAGEMENT_MASTER: { classification: "BUSINESS_OPERATION", action: "PIN_MANAGEMENT_AUTHORIZED" },
    RESTORE_PIN_DEFAULTS: { classification: "BUSINESS_OPERATION", action: "PIN_SETTINGS_DEFAULTS_RESTORED" },
    CUSTOMERS_MODULE_ACCESS: { classification: "RESOURCE_ACCESS", resource: "CUSTOMERS_MODULE", label: "Customers" },
    SUPPLIERS_MODULE_ACCESS: { classification: "RESOURCE_ACCESS", resource: "SUPPLIERS_MODULE", label: "Suppliers" },
    ACCOUNTING_DATA_MODULE_ACCESS: { classification: "RESOURCE_ACCESS", resource: "ACCOUNTING_DATA_MODULE", label: "Accounting & Data" },
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
    const ffGrantTtlMs = options.ffGrantTtlMs || 600 * 1000;
    const now = options.now || (() => Date.now());

    function grantTtlForPurpose(purpose) {
        return purpose === "FF" ? ffGrantTtlMs : grantTtlMs;
    }
    const grants = new Map();
    const reservedGrants = new Map();
    const pinManagementSessions = new Map();
    const workspaceSessions = new Map();
    const startupSetupSessions = new Map();
    let failedMasterAttempts = 0;
    let permissionMatrix = clonePermissionMatrix();

    function authorizationLevelForPurpose(purpose) {
        const feature = PIN_PERMISSION_FEATURES[purpose];
        if (!feature) return AUTHORIZATION_POLICY[purpose] || null;
        const roles = permissionMatrix[feature];
        if (roles?.administrator) return AUTHORIZATION_LEVELS.ADMINISTRATOR;
        if (roles?.manager) return AUTHORIZATION_LEVELS.MANAGER;
        return null;
    }

    function managerAuthorizationDisabled(purpose) {
        const feature = PIN_PERMISSION_FEATURES[purpose];
        const roles = feature && permissionMatrix[feature];
        return Boolean(feature && MANAGER_CONFIGURABLE_PERMISSIONS.has(feature) &&
            roles && !roles.administrator && !roles.manager);
    }

    async function initializePermissions() {
        const row = await get("SELECT pin_permissions_json FROM settings WHERE id = 1");
        if (!row) throw new Error("PIN permission settings are unavailable.");
        if (row.pin_permissions_json) {
            let parsed;
            try { parsed = JSON.parse(row.pin_permissions_json); }
            catch (_) { throw new Error("Saved PIN permission settings are invalid; startup was stopped for safety."); }
            permissionMatrix = validatePermissionMatrix(parsed, parsed);
        }
        return getPermissionMatrix();
    }

    function getPermissionMatrix() { return clonePermissionMatrix(permissionMatrix); }

    async function persistPermissionMatrix(next, action) {
        const validated = validatePermissionMatrix(next, permissionMatrix);
        await run("BEGIN IMMEDIATE TRANSACTION");
        try {
            await run("UPDATE settings SET pin_permissions_json = ? WHERE id = 1", [JSON.stringify(validated)]);
            await run("COMMIT");
        } catch (error) {
            await run("ROLLBACK").catch(() => {});
            throw error;
        }
        permissionMatrix = validated;
        grants.clear(); reservedGrants.clear(); workspaceSessions.clear();
        const activityWarning = await safeLog({ action, details: action === "PIN_SETTINGS_DEFAULTS_RESTORED" ? "Approved default PIN permission settings restored" : "PIN permission settings changed", status: "SUCCESS", entity_type: "ADMIN_SECURITY", reference_no: "PIN_PERMISSIONS" });
        return { success: true, permissions: getPermissionMatrix(), activityWarning };
    }

    async function savePermissionMatrix(next) {
        return persistPermissionMatrix(next, "PIN_PERMISSIONS_UPDATED");
    }

    async function restoreDefaultPermissionMatrix(token, rendererId) {
        if (!hasPinManagementSession(token, rendererId)) throw new Error("PIN Management authorization has expired. Reopen PIN Management.");
        const restored = getPermissionMatrix();
        for (const feature of MANAGER_CONFIGURABLE_PERMISSIONS) {
            restored[feature].manager = PIN_PERMISSION_DEFAULTS[feature].manager;
        }
        return persistPermissionMatrix(restored, "PIN_SETTINGS_DEFAULTS_RESTORED");
    }

    function openPinManagementSession(administratorGrant, masterGrant, rendererId) {
        const valid = consumeGrants([
            { token: administratorGrant, purpose: "PIN_MANAGEMENT_ADMIN" },
            { token: masterGrant, purpose: "PIN_MANAGEMENT_MASTER" }
        ]);
        if (!valid) throw new Error("Both Administrator and Master authorization are required.");
        const token = crypto.randomBytes(32).toString("hex");
        const expiresAt = now() + PIN_MANAGEMENT_INACTIVITY_TTL_MS;
        pinManagementSessions.set(token, { rendererId, expiresAt });
        return { sessionToken: token, expiresAt, permissions: getPermissionMatrix() };
    }

    function hasPinManagementSession(token, rendererId) {
        const key = String(token || "");
        const session = pinManagementSessions.get(key);
        if (!session || session.expiresAt <= now() || session.rendererId !== rendererId) {
            pinManagementSessions.delete(key);
            return false;
        }
        return true;
    }

    function closePinManagementSession(token, rendererId) {
        const key = String(token || "");
        const session = pinManagementSessions.get(key);
        if (!session || session.rendererId !== rendererId) return false;
        return pinManagementSessions.delete(key);
    }

    function recordPinManagementActivity(token, rendererId) {
        const key = String(token || "");
        const session = pinManagementSessions.get(key);
        if (!session || session.rendererId !== rendererId || session.expiresAt <= now()) {
            pinManagementSessions.delete(key);
            return { active: false };
        }
        session.expiresAt = now() + PIN_MANAGEMENT_INACTIVITY_TTL_MS;
        return { active: true, expiresAt: session.expiresAt };
    }

    async function savePinPermissions(token, proposed, rendererId) {
        if (!hasPinManagementSession(token, rendererId)) throw new Error("PIN Management authorization has expired. Reopen PIN Management.");
        return persistPermissionMatrix(proposed, "PIN_PERMISSIONS_UPDATED");
    }

    function openWorkspaceSession(grant, purpose, rendererId) {
        const feature = PIN_PERMISSION_FEATURES[purpose];
        const level = authorizationLevelForPurpose(purpose);
        if (!feature || (!managerAuthorizationDisabled(purpose) && (!level || !consumeGrant(grant, purpose)))) throw new Error("Manager authorization is missing, invalid, or expired.");
        const token = crypto.randomBytes(32).toString("hex");
        workspaceSessions.set(`${rendererId}:${feature}`, { token, rendererId, feature, level, expiresAt: now() + 2 * 60 * 60 * 1000 });
        return { success: true, token, feature };
    }

    function hasWorkspaceSession(rendererId, feature) {
        const key = `${rendererId}:${feature}`;
        const session = workspaceSessions.get(key);
        if (!session || session.expiresAt < now()) { workspaceSessions.delete(key); return false; }
        return true;
    }

    function issueWorkspaceGrant(rendererId, purpose) {
        const feature = PIN_PERMISSION_FEATURES[purpose];
        const session = feature && workspaceSessions.get(`${rendererId}:${feature}`);
        const level = authorizationLevelForPurpose(purpose);
        if (managerAuthorizationDisabled(purpose) && session && session.expiresAt >= now()) return null;
        if (!session || session.expiresAt < now() || !level || session.level !== level) {
            if (session && session.expiresAt < now()) workspaceSessions.delete(`${rendererId}:${feature}`);
            throw new Error("A current authorized workspace session is required.");
        }
        return issueGrant(purpose, level);
    }

    function closeWorkspaceSession(rendererId, feature) {
        return workspaceSessions.delete(`${rendererId}:${feature}`);
    }

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
            details: `${level === AUTHORIZATION_LEVELS.MANAGER ? "Manager" : level === AUTHORIZATION_LEVELS.MASTER ? "Master" : "Administrator"} authorization failed for ${label}`,
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

    function getAuthorizationRole(purpose) {
        return AUTHORIZATION_PURPOSES.has(purpose) ? authorizationLevelForPurpose(purpose) : null;
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
        grants.set(token, {
            purpose,
            level,
            expiresAt: now() + grantTtlForPurpose(purpose)
        });
        return token;
    }

    function consumeGrant(token, purpose) {
        if (managerAuthorizationDisabled(purpose)) return !token;
        const normalizedToken = String(token || "");
        const grant = grants.get(normalizedToken);
        if (!grant) return false;
        grants.delete(normalizedToken);
        const expectedLevel = authorizationLevelForPurpose(purpose);
        return Boolean(expectedLevel) && grant.purpose === purpose &&
            grant.level === expectedLevel && grant.expiresAt >= now();
    }

    function validateGrant(token, purpose) {
        if (managerAuthorizationDisabled(purpose)) return !token;
        const grant = grants.get(String(token || ""));
        const expectedLevel = authorizationLevelForPurpose(purpose);
        return Boolean(expectedLevel && grant && grant.purpose === purpose &&
            grant.level === expectedLevel && grant.expiresAt >= now());
    }

    function discardGrant(token, purpose) {
        const normalizedToken = String(token || "");
        const grant = grants.get(normalizedToken);
        if (!grant || !authorizationLevelForPurpose(purpose) || grant.purpose !== purpose) return false;
        grants.delete(normalizedToken);
        return true;
    }

    function consumeGrants(requirements) {
        const resolved = requirements.map(requirement => ({
            token: String(requirement.token || ""),
            purpose: requirement.purpose,
            grant: grants.get(String(requirement.token || ""))
        }));
        const valid = resolved.every(item =>
            authorizationLevelForPurpose(item.purpose) && item.grant &&
            item.grant.purpose === item.purpose &&
            item.grant.level === authorizationLevelForPurpose(item.purpose) &&
            item.grant.expiresAt >= now()
        );
        resolved.forEach(item => grants.delete(item.token));
        return valid;
    }

    function resolveGrantRequirements(requirements) {
        return requirements.map(requirement => ({
            token: String(requirement.token || ""),
            purpose: requirement.purpose,
            grant: grants.get(String(requirement.token || ""))
        }));
    }

    function areValidGrantRequirements(resolved) {
        const tokens = new Set();
        if (resolved.some(item => {
            if (tokens.has(item.token)) return true;
            tokens.add(item.token);
            return false;
        })) return false;
        return resolved.every(item =>
            authorizationLevelForPurpose(item.purpose) && item.grant &&
            item.grant.purpose === item.purpose &&
            item.grant.level === authorizationLevelForPurpose(item.purpose) &&
            item.grant.expiresAt >= now()
        );
    }

    // Reserve grants for an in-flight protected operation. The reservation
    // prevents concurrent reuse without consuming authorization before the
    // protected operation has committed.
    function reserveGrants(requirements) {
        const resolved = resolveGrantRequirements(requirements).filter(item => !managerAuthorizationDisabled(item.purpose));
        if (!areValidGrantRequirements(resolved)) return false;
        resolved.forEach(item => {
            grants.delete(item.token);
            reservedGrants.set(item.token, item.grant);
        });
        return true;
    }

    function commitGrants(requirements) {
        const activeRequirements = requirements.filter(requirement => !managerAuthorizationDisabled(requirement.purpose));
        const valid = activeRequirements.every(requirement => {
            const token = String(requirement.token || "");
            const grant = reservedGrants.get(token);
            return authorizationLevelForPurpose(requirement.purpose) && grant &&
                grant.purpose === requirement.purpose &&
                grant.level === authorizationLevelForPurpose(requirement.purpose);
        });
        activeRequirements.forEach(requirement => {
            reservedGrants.delete(String(requirement.token || ""));
        });
        return valid;
    }

    function releaseGrants(requirements) {
        requirements.forEach(requirement => {
            if (managerAuthorizationDisabled(requirement.purpose)) return;
            const token = String(requirement.token || "");
            const grant = reservedGrants.get(token);
            if (!grant || grant.purpose !== requirement.purpose) return;
            reservedGrants.delete(token);
            if (grant.expiresAt >= now()) grants.set(token, grant);
        });
    }

    async function authorizePin(pin, purpose) {
        if (!AUTHORIZATION_PURPOSES.has(purpose)) {
            return { success: false, error: "Unsupported authorization purpose." };
        }
        const level = authorizationLevelForPurpose(purpose);
        if (!level && managerAuthorizationDisabled(purpose)) return { success: true, grant: null };
        if (!level) return { success: false, error: "This permission is not assigned to an authorized PIN." };
        const label = level === AUTHORIZATION_LEVELS.MANAGER ? "Manager" : level === AUTHORIZATION_LEVELS.MASTER ? "Master" : "Administrator";
        const pinLength = level === AUTHORIZATION_LEVELS.MASTER ? 6 : 4;
        if (!(new RegExp(`^\\d{${pinLength}}$`)).test(String(pin || ""))) {
            return denied(purpose, level, `Please enter a valid ${pinLength}-digit ${label} PIN.`);
        }
        if (level === AUTHORIZATION_LEVELS.MASTER) {
            if (!isCredentialRecord(masterVerifier)) return { success: false, error: "Master Recovery is not provisioned." };
            if (!await verifyCredential(pin, masterVerifier)) {
                await safeLog({ action: "MASTER_RECOVERY_FAILED", details: "PIN Management Master authorization failed", status: "FAILED", entity_type: "ADMIN_SECURITY", reference_no: "PIN_MANAGEMENT" });
                await delayMasterFailure();
                return { success: false, error: "Incorrect Master PIN." };
            }
            failedMasterAttempts = 0;
            return { success: true, grant: issueGrant(purpose, level) };
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
        grants.clear(); reservedGrants.clear(); pinManagementSessions.clear(); workspaceSessions.clear();
        const action = wasConfigured ? "MANAGER_PIN_CHANGED" : "MANAGER_PIN_CONFIGURED";
        const activityWarning = await safeLog({
            action,
            details: wasConfigured ? "Manager PIN changed" : "Manager PIN configured",
            user_name: AUTHORIZATION_LEVELS.ADMINISTRATOR,
            status: "SUCCESS", entity_type: "MANAGER_SECURITY", reference_no: "MANAGER_PIN"
        });
        return { success: true, activityWarning };
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
            await safeLog({ action: "MASTER_RECOVERY_FAILED", details: "Master recovery authorization failed", status: "FAILED", entity_type: "MANAGER_SECURITY", reference_no: "MASTER_RECOVERY" });
            await delayMasterFailure();
            return { success: false, error: "Master PIN is incorrect." };
        }

        const pinHash = await hashCredential(data.newPin);
        await run("BEGIN IMMEDIATE TRANSACTION");
        try {
            await run("UPDATE settings SET manager_pin_hash = ?, manager_security_initialized = 1 WHERE id = 1", [pinHash]);
            await run("COMMIT");
        } catch (error) {
            await run("ROLLBACK").catch(() => {});
            throw error;
        }
        failedMasterAttempts = 0;
        grants.clear(); reservedGrants.clear(); pinManagementSessions.clear(); workspaceSessions.clear();
        await safeLog({ action: status.managerPinConfigured ? "MANAGER_PIN_RECOVERED" : "MANAGER_PIN_CONFIGURED", details: status.managerPinConfigured ? "Manager PIN recovered" : "Manager PIN configured", user_name: AUTHORIZATION_LEVELS.ADMINISTRATOR, status: "SUCCESS", entity_type: "MANAGER_SECURITY", reference_no: "MANAGER_PIN" });
        await safeLog({ action: "MASTER_RECOVERY_SUCCESS", details: "Master recovery completed", status: "SUCCESS", entity_type: "MANAGER_SECURITY", reference_no: "MASTER_RECOVERY" });
        return { success: true };
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
        grants.clear(); reservedGrants.clear(); pinManagementSessions.clear(); workspaceSessions.clear();
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
        grants.clear(); reservedGrants.clear(); pinManagementSessions.clear(); workspaceSessions.clear();
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
        grants.clear(); reservedGrants.clear(); pinManagementSessions.clear(); workspaceSessions.clear();
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
        getStatus, getAuthorizationRole, authorizePin, changePin, recoverPin, recoverManagerPin, configureManagerPin,
        isManagerAuthorizationDisabled: managerAuthorizationDisabled,
        initializePermissions, getPermissionMatrix, openPinManagementSession, hasPinManagementSession, closePinManagementSession,
        recordPinManagementActivity,
        savePinPermissions, restoreDefaultPermissionMatrix,
        openWorkspaceSession, hasWorkspaceSession, issueWorkspaceGrant, closeWorkspaceSession,
        beginStartupSetup,
        configureMissingAdministratorPin: data =>
            configureMissingPinWithStartupSetup(data || {}, AUTHORIZATION_LEVELS.ADMINISTRATOR),
        configureMissingManagerPin: data =>
            configureMissingPinWithStartupSetup(data || {}, AUTHORIZATION_LEVELS.MANAGER),
        consumeGrant, consumeGrants, reserveGrants, commitGrants, releaseGrants,
        validateGrant, discardGrant,
        clearGrants: () => { grants.clear(); reservedGrants.clear(); pinManagementSessions.clear(); workspaceSessions.clear(); },
        clearStartupSetupSessions: () => startupSetupSessions.clear()
    };
}

module.exports = {
    createAdministratorSecurityService,
    AUTHORIZATION_LEVELS,
    AUTHORIZATION_POLICY,
    AUTHORIZATION_PURPOSES,
    ADMIN_PIN_AUDIT_POLICY,
    PIN_PERMISSION_DEFAULTS
};
