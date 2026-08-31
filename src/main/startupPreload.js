const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("startupAPI", {
    getMetadata: () => ipcRenderer.invoke("startup:get-metadata"),
    runCheck: checkName => ipcRenderer.invoke("startup:run-check", checkName),
    reopenClosedDay: data => ipcRenderer.invoke("startup:reopen-closed-day", data),
    ready: () => ipcRenderer.invoke("startup:ready"),
    exit: () => ipcRenderer.invoke("startup:exit")
});
