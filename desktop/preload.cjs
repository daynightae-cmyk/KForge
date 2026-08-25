const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("kforgeDesktop", Object.freeze({
  getRuntimeInfo: () => ipcRenderer.invoke("kforge:runtime"),
}));
