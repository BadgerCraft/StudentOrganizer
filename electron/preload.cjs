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
  exportPdf: (filename, html, expectedRevision) => expectedRevision === undefined ? ipcRenderer.invoke('assessment-report:pdf', filename, html) : ipcRenderer.invoke('assessment-report:pdf', filename, html, expectedRevision),
  exportCsv: (filename, csv, expectedRevision) => ipcRenderer.invoke('assessment-report:csv', filename, csv, expectedRevision),
  cancelReadableExport: () => ipcRenderer.invoke('assessment-report:cancel')
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

// Keys and generic decryption capabilities stay in the main process. Only
// focused workspace actions are exposed through the existing trusted caller guard.
contextBridge.exposeInMainWorld('desktopEncryption', Object.freeze({
  status: () => ipcRenderer.invoke('encryption:status'),
  selectActingTeacher: userId => ipcRenderer.invoke('encryption:selectActingTeacher', userId),
  unlock: () => ipcRenderer.invoke('encryption:unlock'),
  read: () => ipcRenderer.invoke('encryption:read'),
  commit: (expectedRevision, snapshot) => ipcRenderer.invoke('encryption:commit', expectedRevision, snapshot),
  commitDelta: (expectedRevision, changes) => ipcRenderer.invoke('encryption:commitDelta', expectedRevision, changes),
  lock: () => ipcRenderer.invoke('encryption:lock'),
  prepareMigration: snapshot => ipcRenderer.invoke('encryption:prepareMigration', snapshot),
  verifyRecovery: code => ipcRenderer.invoke('encryption:verifyRecovery', code),
  createDeviceChallenge: deviceId => ipcRenderer.invoke('encryption:createDeviceChallenge', deviceId),
  verifyDeviceResponse: (deviceId, ciphertext) => ipcRenderer.invoke('encryption:verifyDeviceResponse', deviceId, ciphertext),
  completeMigration: snapshot => ipcRenderer.invoke('encryption:completeMigration', snapshot),
  enrollFromRecovery: (code, wrappedKey, challenge) => ipcRenderer.invoke('encryption:enrollFromRecovery', code, wrappedKey, challenge),
  cancelEnrollment: () => ipcRenderer.invoke('encryption:cancelEnrollment'),
  exportEncrypted: (purpose, recordId) => ipcRenderer.invoke('encryption:exportEncrypted', purpose, recordId),
  exportBackupFile: () => ipcRenderer.invoke('encryption:exportBackupFile'),
  previewImportFile: () => ipcRenderer.invoke('encryption:previewImportFile'),
  previewRecoveryFile: () => ipcRenderer.invoke('encryption:previewRecoveryFile'),
  authorizeRecovery: (token, userId) => ipcRenderer.invoke('encryption:authorizeRecovery', token, userId),
  applyRecovery: token => ipcRenderer.invoke('encryption:applyRecovery', token),
  previewOfflineRecoveryFile: code => ipcRenderer.invoke('encryption:previewOfflineRecoveryFile', code),
  authorizeOfflineRecovery: (token, userId) => ipcRenderer.invoke('encryption:authorizeOfflineRecovery', token, userId),
  applyOfflineRecovery: token => ipcRenderer.invoke('encryption:applyOfflineRecovery', token),
  cancelOfflineRecovery: () => ipcRenderer.invoke('encryption:cancelOfflineRecovery'),
  previewImport: ciphertext => ipcRenderer.invoke('encryption:previewImport', ciphertext),
  applyImport: token => ipcRenderer.invoke('encryption:applyImport', token),
  listBackups: () => ipcRenderer.invoke('encryption:listBackups'),
  createBackup: (reason, expectedRevision) => ipcRenderer.invoke('encryption:createBackup', reason, expectedRevision),
  previewStoredBackup: id => ipcRenderer.invoke('encryption:previewStoredBackup', id),
  applyStoredBackup: token => ipcRenderer.invoke('encryption:applyStoredBackup', token),
  reopenSecureStartup: () => ipcRenderer.invoke('encryption:reopenSecureStartup')
}));
