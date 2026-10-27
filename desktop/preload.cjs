const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("kforgeDesktop", Object.freeze({
  getRuntimeInfo: () => ipcRenderer.invoke("kforge:runtime"),
  githubStart: () => ipcRenderer.invoke("kforge:github-start"),
  githubStatus: () => ipcRenderer.invoke("kforge:github-status"),
  githubDisconnect: () => ipcRenderer.invoke("kforge:github-disconnect"),
  githubInstallations: () => ipcRenderer.invoke("kforge:github-installations"),
  githubRepositories: (installationId) => ipcRenderer.invoke("kforge:github-repositories", installationId),
}));
