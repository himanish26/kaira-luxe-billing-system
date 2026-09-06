let restoreInProgress = false;
let quiesceHandler = null;
let resumeHandler = null;

function setRestoreQuiesceHandler(handler) {
    quiesceHandler = typeof handler === "function" ? handler : null;
}

function beginRestore() {
    if (restoreInProgress) return false;
    restoreInProgress = true;
    resumeHandler = quiesceHandler ? quiesceHandler() : null;
    return true;
}

function endRestoreBeforeClose() {
    restoreInProgress = false;
    if (resumeHandler) resumeHandler();
    resumeHandler = null;
}

function isRestoreInProgress() {
    return restoreInProgress;
}

module.exports = {
    beginRestore,
    endRestoreBeforeClose,
    isRestoreInProgress,
    setRestoreQuiesceHandler
};
