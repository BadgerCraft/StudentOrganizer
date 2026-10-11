const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktopUpdates', Object.freeze({
  platform: process.platform,
  check: () => ipcRenderer.invoke('manual-update:check'),
  status: () => ipcRenderer.invoke('installer-update:status'),
  download: () => ipcRenderer.invoke('installer-update:download'),
  cancel: () => ipcRenderer.invoke('installer-update:cancel'),
  install: (backupJSON, acknowledgeUnsigned) => ipcRenderer.invoke('installer-update:install', backupJSON, acknowledgeUnsigned)
}));
