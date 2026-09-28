const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const appSource = fs.readFileSync(path.join(__dirname, "../src/renderer/app.js"), "utf8");
const settingsPage = appSource.slice(
    appSource.indexOf("async function showAdministratorSecurityPage()"),
    appSource.indexOf("\nif (storeCard)", appSource.indexOf("async function showAdministratorSecurityPage()"))
);

const expectedBindings = [
    [/\["startupSecurityMasterPin"\][\s\S]*?startupVerifyButton/, ["startupSecurityMasterPin"], "startupSecurityVerifyBtn"],
    [/\["securityCurrentPin", "securityNewPin", "securityConfirmPin"\][\s\S]*?changeButton/, ["securityCurrentPin", "securityNewPin", "securityConfirmPin"], "securityChangePinBtn"],
    [/\["securityManagerPin", "securityManagerConfirmPin"\][\s\S]*?saveManagerButton/, ["securityManagerPin", "securityManagerConfirmPin"], "securitySaveManagerPinBtn"],
    [/\["securityMasterPin", "securityRecoveryPin", "securityRecoveryConfirmPin"\][\s\S]*?recoveryButton/, ["securityMasterPin", "securityRecoveryPin", "securityRecoveryConfirmPin"], "securityRecoverBtn"]
];

const fields = new Map();
const buttons = new Map();
const clickCounts = new Map();
for (const [, ids, buttonId] of expectedBindings) {
    ids.forEach(id => fields.set(id, { addEventListener(type, handler) { this.type = type; this.handler = handler; } }));
    buttons.set(buttonId, { click() { clickCounts.set(buttonId, (clickCounts.get(buttonId) || 0) + 1); } });
}

const context = {
    document: {
        getElementById(id) {
            return fields.get(id) || buttons.get(id) || null;
        }
    }
};
vm.createContext(context);
const helperStart = appSource.indexOf("function bindSecurityEnterToButton(");
const helperEnd = appSource.indexOf("\nasync function showAdministratorSecurityPage()", helperStart);
assert(helperStart >= 0 && helperEnd > helperStart, "scoped Enter helper must exist");
const helperSource = appSource.slice(helperStart, helperEnd);
assert(!/document\.addEventListener/.test(helperSource), "helper must not add a document-level handler");
vm.runInContext(helperSource, context);

const buttonObjects = {
    startupSecurityVerifyBtn: buttons.get("startupSecurityVerifyBtn"),
    securityChangePinBtn: buttons.get("securityChangePinBtn"),
    securitySaveManagerPinBtn: buttons.get("securitySaveManagerPinBtn"),
    securityRecoverBtn: buttons.get("securityRecoverBtn")
};
const bindings = [
    [["startupSecurityMasterPin"], buttonObjects.startupSecurityVerifyBtn],
    [["securityCurrentPin", "securityNewPin", "securityConfirmPin"], buttonObjects.securityChangePinBtn],
    [["securityManagerPin", "securityManagerConfirmPin"], buttonObjects.securitySaveManagerPinBtn],
    [["securityMasterPin", "securityRecoveryPin", "securityRecoveryConfirmPin"], buttonObjects.securityRecoverBtn]
];

for (let index = 0; index < expectedBindings.length; index += 1) {
    const [pattern, inputIds, buttonId] = expectedBindings[index];
    assert(pattern.test(settingsPage), `settings page must bind ${inputIds.join(", ")} to ${buttonId}`);
    const [ids, button] = bindings[index];
    context.bindSecurityEnterToButton(ids, button);
    for (const inputId of ids) {
        const input = fields.get(inputId);
        assert.strictEqual(input.type, "keydown", `${inputId} uses scoped keydown`);
        let prevented = false;
        input.handler({ key: "Enter", repeat: false, preventDefault() { prevented = true; } });
        assert.strictEqual(prevented, true, `${inputId} prevents default Enter behavior`);
        assert.strictEqual(clickCounts.get(buttonId), ids.indexOf(inputId) + 1, `${inputId} invokes the existing ${buttonId}`);

        input.handler({ key: "Tab", repeat: false, preventDefault() { throw new Error("Tab must remain unchanged"); } });
        input.handler({ key: "Enter", repeat: true, preventDefault() { throw new Error("repeated Enter must not resubmit"); } });
    }
}

assert(/adminPin\.addEventListener\("keypress",\s*\(event\)\s*=>\s*\{\s*if\(event\.key === "Enter"\)\s*\{\s*adminUnlockBtn\.click\(\);/s.test(appSource),
    "existing adminPin Enter behavior must remain present and call adminUnlockBtn.click()");
assert(/\$\{startupSecuritySetupActive \? "" : `<label>Master PIN[\s\S]*?id="securityMasterPin"/.test(appSource),
    "Initialize Security must continue rendering its Master PIN only when required");
assert(/id="securityRecoverBtn"[^>]*>Initialize Security/.test(appSource),
    "Initialize Security must continue using the existing recovery button");

console.log("Administrator Security Enter-key scoped renderer regression tests: PASS");
