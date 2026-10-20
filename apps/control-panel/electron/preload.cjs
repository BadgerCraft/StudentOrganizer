const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ownerConsole', Object.freeze({
  status: () => ipcRenderer.invoke('owner:status'),
  importCandidate: () => ipcRenderer.invoke('owner:import'),
  recordTest: notes => ipcRenderer.invoke('owner:test', notes),
  approve: () => ipcRenderer.invoke('owner:approve'),
  revoke: () => ipcRenderer.invoke('owner:revoke'),
  exportPreview: () => ipcRenderer.invoke('owner:export')
}));
