const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createDictation } = require('./dictation.cjs');
const { trustedCaller } = require('./manualUpdater.cjs');

function attachDictation({ app, window, ipcMain, dialog, systemPreferences }) {
  const indexUrl = pathToFileURL(path.join(__dirname, '../dist/index.html')).href;
  const service = createDictation({
    runtime: path.join(app.isPackaged ? process.resourcesPath : path.join(__dirname, '..'), 'dictation-runtime', process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'),
    userData: app.getPath('userData')
  });
  let consentPending = false;
  const requireCaller = (event, args, count) => {
    if (args.length !== count || !trustedCaller(event, window.webContents, indexUrl)) throw new Error('Dictation action denied.');
  };
  const cancel = () => { service.cancel(); if (!window.webContents.isDestroyed()) window.webContents.send('dictation:interrupted'); };
  const handlers = {
    status: async (event, ...args) => { requireCaller(event, args, 0); return service.status(); },
    install: async (event, ...args) => {
      requireCaller(event, args, 0);
      const selected = await dialog.showOpenDialog(window, { title: 'Install optional English tiny model (75 MiB, MIT)', properties: ['openFile'], filters: [{ name: 'Whisper tiny.en model', extensions: ['bin'] }] });
      if (selected.canceled) return service.status();
      return service.installModel(selected.filePaths[0]);
    },
    begin: async (event, ...args) => {
      requireCaller(event, args, 0);
      if (consentPending || service.canCapture()) throw new Error('Dictation is already active.');
      consentPending = true;
      try {
        const status = await service.status(); if (!status.ready) throw new Error(status.reason);
        const choice = await dialog.showMessageBox(window, { type: 'question', title: 'Use microphone for this feedback?', message: 'Allow one local recording?', detail: 'Speak only the feedback you intend to add. Audio is processed on this computer using whisper.cpp, stays in memory, and is discarded after transcription or cancellation. Recording stops after 60 seconds. Review the transcript before adding it; normal Save still applies.', buttons: ['Cancel', 'Allow microphone'], defaultId: 0, cancelId: 0, noLink: true });
        if (choice.response !== 1 || window.isDestroyed()) throw new Error('Microphone permission was not granted.');
        if (process.platform === 'darwin' && !(await systemPreferences.askForMediaAccess('microphone'))) throw new Error('Microphone permission denied. Enable it in macOS settings or type feedback.');
        if (window.isDestroyed() || !window.isFocused()) throw new Error('Return to the marking window and start again.');
        return service.begin();
      } finally { consentPending = false; }
    },
    cancel: (event, ...args) => { requireCaller(event, args, 1); if (typeof args[0] !== 'string') throw new Error('Invalid dictation token.'); service.cancel(args[0]); },
    transcribe: (event, ...args) => { requireCaller(event, args, 2); if (typeof args[0] !== 'string') throw new Error('Invalid dictation token.'); return service.transcribe(args[0], args[1]); }
  };
  for (const [name, handler] of Object.entries(handlers)) { ipcMain.removeHandler(`dictation:${name}`); ipcMain.handle(`dictation:${name}`, handler); }
  // Only audio from the app main frame is gated by the one-recording consent lease.
  const trustedPermission = (contents, details) => contents === window.webContents && details.isMainFrame === true && trustedCaller({ sender: contents, senderFrame: contents.mainFrame }, window.webContents, indexUrl);
  window.webContents.session.setPermissionCheckHandler((contents, permission, _origin, details) => {
    if (!trustedPermission(contents, details)) return false;
    // Keep the existing deliberate Copy bug report action working.
    if (permission === 'clipboard-sanitized-write') return true;
    return permission === 'media' && details.mediaType === 'audio' && service.canCapture();
  });
  window.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(trustedPermission(contents, details) && (permission === 'clipboard-sanitized-write' || (permission === 'media' && details.mediaTypes?.length === 1 && details.mediaTypes[0] === 'audio' && service.canCapture())));
  });
  window.on('blur', cancel);
  window.on('closed', () => service.cancel());
  window.webContents.on('render-process-gone', cancel);
  window.webContents.on('did-start-navigation', cancel);
  app.on('before-quit', () => service.cancel());
  return service;
}
module.exports = { attachDictation };
