const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktopUpdates', Object.freeze({
  platform: process.platform,
  check: () => ipcRenderer.invoke('manual-update:check'),
  status: () => ipcRenderer.invoke('installer-update:status'),
  download: () => ipcRenderer.invoke('installer-update:download'),
  cancel: () => ipcRenderer.invoke('installer-update:cancel'),
  install: (backupJSON, acknowledgeUnsigned) => ipcRenderer.invoke('installer-update:install', backupJSON, acknowledgeUnsigned)
}));

contextBridge.exposeInMainWorld('desktopReports', Object.freeze({
  exportPdf: (filename, html) => ipcRenderer.invoke('assessment-report:pdf', filename, html)
}));

contextBridge.exposeInMainWorld('desktopDictation', Object.freeze({
  status: () => ipcRenderer.invoke('dictation:status'),
  install: () => ipcRenderer.invoke('dictation:install'),
  begin: () => ipcRenderer.invoke('dictation:begin'),
  cancel: token => ipcRenderer.invoke('dictation:cancel', token),
  transcribe: (token, audio) => ipcRenderer.invoke('dictation:transcribe', token, audio),
  onInterrupted: callback => {
    const listener = () => callback();
    ipcRenderer.on('dictation:interrupted', listener);
    return () => ipcRenderer.removeListener('dictation:interrupted', listener);
  }
}));

contextBridge.exposeInMainWorld('desktopCaptureDrive', Object.freeze({
  status: () => ipcRenderer.invoke('capture-drive:status'),
  connect: () => ipcRenderer.invoke('capture-drive:connect'),
  list: () => ipcRenderer.invoke('capture-drive:list'),
  download: id => ipcRenderer.invoke('capture-drive:download', id),
  cancel: () => ipcRenderer.invoke('capture-drive:cancel'),
  disconnect: () => ipcRenderer.invoke('capture-drive:disconnect')
}));

contextBridge.exposeInMainWorld('desktopOrganizerDrive', Object.freeze({
  status: () => ipcRenderer.invoke('organizer-drive:status'),
  connect: () => ipcRenderer.invoke('organizer-drive:connect'),
  list: () => ipcRenderer.invoke('organizer-drive:list'),
  download: id => ipcRenderer.invoke('organizer-drive:download', id),
  upload: json => ipcRenderer.invoke('organizer-drive:upload', json),
  disconnect: () => ipcRenderer.invoke('organizer-drive:disconnect')
}));
