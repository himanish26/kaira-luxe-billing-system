const assert = require("assert");
const Module = require("module");

let timerId = 0;
const timers = new Map();
const originalSetInterval = global.setInterval;
const originalClearInterval = global.clearInterval;
const originalLoad = Module._load;

global.setInterval = callback => {
    const id = ++timerId;
    timers.set(id, callback);
    return id;
};
global.clearInterval = id => timers.delete(id);

Module._load = function(request, parent, isMain) {
    if (request === "./backupService" && parent.filename.endsWith("backupScheduler.js")) {
        return { createBackup: async () => {} };
    }
    if (request === "../database/settingsService" && parent.filename.endsWith("backupScheduler.js")) {
        return { getSettings: async () => ({}) };
    }
    if (request === "./technicalLogger" && parent.filename.endsWith("backupScheduler.js")) {
        return { info() {}, error() {} };
    }
    return originalLoad.call(this, request, parent, isMain);
};

try {
    const restoreState = require("../src/services/restoreState");
    const scheduler = require("../src/services/backupScheduler");

    scheduler.startBackupScheduler();
    assert.strictEqual(timers.size, 1, "scheduler should create one timer");
    const timer = [...timers.keys()][0];

    let resumed = false;
    restoreState.setRestoreQuiesceHandler(() => () => { resumed = true; });
    assert.strictEqual(restoreState.beginRestore(), true);
    assert.strictEqual(restoreState.isRestoreInProgress(), true);

    scheduler.stopBackupScheduler();
    assert.strictEqual(timers.has(timer), false, "stop should clear scheduler timer");
    assert.strictEqual(restoreState.isRestoreInProgress(), true);

    restoreState.endRestoreBeforeClose();
    assert.strictEqual(restoreState.isRestoreInProgress(), false);
    assert.strictEqual(resumed, true, "pre-close failure should run resume callback");

    console.log("V1 restore quiescing disposable tests: PASS");
}
finally {
    Module._load = originalLoad;
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
}
