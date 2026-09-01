const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("startupAPI", {
    getMetadata: () => ipcRenderer.invoke("startup:get-metadata"),
    runCheck: checkName => ipcRenderer.invoke("startup:run-check", checkName),
    initializeAdministratorPin: data =>
        ipcRenderer.invoke("startup:initialize-administrator-pin", data),
    reopenClosedDay: data => ipcRenderer.invoke("startup:reopen-closed-day", data),
    ready: () => ipcRenderer.invoke("startup:ready"),
    exit: () => ipcRenderer.invoke("startup:exit"),
    onSplashShown: callback => ipcRenderer.once("startup:splash-shown", callback),
});
