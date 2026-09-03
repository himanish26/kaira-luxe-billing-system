const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("startupAPI", {
    getMetadata: () => ipcRenderer.invoke("startup:get-metadata"),
    runCheck: checkName => ipcRenderer.invoke("startup:run-check", checkName),
    openSecuritySetup: () => ipcRenderer.invoke("startup:open-security-setup"),
    reopenClosedDay: data => ipcRenderer.invoke("startup:reopen-closed-day", data),
    ready: () => ipcRenderer.invoke("startup:ready"),
    exit: () => ipcRenderer.invoke("startup:exit"),
    onSplashShown: callback => ipcRenderer.once("startup:splash-shown", callback),
    onSecuritySetupCompleted: callback =>
        ipcRenderer.once("startup:security-setup-completed", callback),
});
