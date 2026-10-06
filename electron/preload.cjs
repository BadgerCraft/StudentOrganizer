const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktopUpdates', Object.freeze({
  platform: process.platform,
  check: () => ipcRenderer.invoke('manual-update:check')
}));
