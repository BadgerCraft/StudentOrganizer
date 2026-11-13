const fs = require('node:fs/promises');
const path = require('node:path');
const approval = require('./updateApproval.cjs');
const { preparePublication } = require('./releaseDelivery.cjs');
const { hashFile, inspectSignature } = require('./windowsInstallerUpdate.cjs');
const { trustedCaller } = require('./manualUpdater.cjs');
const { atomicJSON, verifyArtifact, assertPreviewDestination, preparePublicationBundle } = require('./controlPanelStore.cjs');
async function attachControlPanel({ ipcMain, dialog, getWindow, index, storeFile, legacyStoreFile }) {
let stored = null, busy = false, storageError = '';
function snapshot(message = '') {
  return { approval: stored?.approval || null, message: message || storageError,
    mode: approval.MODE, publicationReady: false };
}
async function readJSON(file) {
  if ((await fs.stat(file)).size > 32 * 1024) throw new Error('Local approval JSON exceeds 32 KB.');
  return JSON.parse(await fs.readFile(file, 'utf8'));
}
async function save(next) { await fs.mkdir(path.dirname(storeFile), { recursive: true, mode: 0o700 }); await atomicJSON(storeFile, next); stored = next; storageError = ''; }
async function verify() {
  if (!stored) throw new Error('Import a candidate and select its installer first.');
  approval.state(stored.approval);
  await verifyArtifact(stored.approval, stored.artifactPath, hashFile);
}
const handlers = {
  status: async () => snapshot(),
  import: async () => {
    const descriptor = await dialog.showOpenDialog(getWindow(), { title: 'Select local candidate JSON (no student data)', filters: [{ name: 'Candidate JSON', extensions: ['json'] }], properties: ['openFile'] });
    if (descriptor.canceled) return snapshot('Import cancelled.');
    const next = approval.prepare(await readJSON(descriptor.filePaths[0]));
    const installer = await dialog.showOpenDialog(getWindow(), { title: `Select ${next.candidate.artifact.name}`, filters: [{ name: 'NSIS installer', extensions: ['exe'] }], properties: ['openFile'] });
    if (installer.canceled) return snapshot('Import cancelled. Previous approval retained.');
    await verifyArtifact(next, installer.filePaths[0], hashFile);
    await save({ approval: next, artifactPath: installer.filePaths[0] });
    return snapshot('Candidate bytes verified. Publisher signature has not been verified.');
  },
  test: async notes => {
    if (typeof notes !== 'string' || notes.length > 2000) throw new Error('Invalid verification notes.');
    await verify(); await save({ ...stored, approval: approval.recordTest(stored.approval, notes) });
    return snapshot('Test evidence recorded for these exact installer bytes.');
  },
  approve: async () => {
    await verify(); await save({ ...stored, approval: approval.approve(stored.approval) });
    return snapshot('Approved locally only. Nothing was published; installed apps cannot discover this approval.');
  },
  revoke: async () => {
    if (!stored) throw new Error('No local approval.');
    await save({ ...stored, approval: approval.revoke(stored.approval) });
    return snapshot('Local approval revoked. Previously exported preview files are independent snapshots.');
  },
  publication: async acknowledgeUnsigned => {
    if (typeof acknowledgeUnsigned !== 'boolean') throw new Error('Explicit unsigned policy choice required.');
    if (process.platform !== 'win32') throw new Error('Prepare delivery on Windows so the real NSIS publisher signature can be inspected.');
    await verify();
    const native = await inspectSignature(stored.artifactPath);
    const preparation = preparePublication(stored.approval, native, acknowledgeUnsigned);
    const selected = await dialog.showOpenDialog(getWindow(), { title: 'Choose folder for LOCAL publication preparation — nothing is published', properties: ['openDirectory', 'createDirectory'] });
    if (selected.canceled) return snapshot('Publication preparation cancelled.');
    const destination = await preparePublicationBundle(selected.filePaths[0], preparation, stored.artifactPath, hashFile);
    return snapshot(`Publication preparation saved to ${destination}. No release was published. Inspect the instructions; publication still needs separate approval.`);
  },
  export: async () => {
    await verify();
    if (stored.approval.status !== 'approved') throw new Error('Only an approved candidate can be exported as a preview.');
    const result = await dialog.showSaveDialog(getWindow(), { title: 'Save LOCAL PREVIEW ONLY — no publication', defaultPath: `LOCAL-PREVIEW-${stored.approval.candidate.version}.json`, filters: [{ name: 'Preview JSON', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return snapshot('Export cancelled.');
    await assertPreviewDestination(result.filePath, [storeFile, stored.artifactPath, ...(legacyStoreFile ? [legacyStoreFile] : [])]);
    await atomicJSON(result.filePath, approval.exportPreview(stored.approval));
    return snapshot('Local preview saved. No telemetry, credentials or executable paths are included. No release was published.');
  }
};
for (const [name, handler] of Object.entries(handlers)) ipcMain.handle(`owner:${name}`, async (event, ...args) => {
  const window = getWindow();
  if (!window || !trustedCaller(event, window.webContents, index) || args.length !== (['test', 'publication'].includes(name) ? 1 : 0)) throw new Error('Owner action denied.');
  if (name === 'status') return snapshot();
  if (busy) throw new Error('Another local approval action is in progress.');
  busy = true;
  try { return await handler(...args); }
  catch (error) { return { ...snapshot(), error: error instanceof Error ? error.message : 'Local preparation failed.' }; }
  finally { busy = false; }
});
  try {
    let value;
    try { value = await readJSON(storeFile); }
    catch (error) {
      if (error.code !== 'ENOENT' || !legacyStoreFile) throw error;
      value = await readJSON(legacyStoreFile);
      storageError = 'Previous Control Panel preparation loaded. Changes are saved in Student Organizer; the previous record is preserved.';
    }
    if (typeof value.artifactPath !== 'string' || Object.keys(value).sort().join(',') !== 'approval,artifactPath') throw new Error('Invalid local store.');
    stored = { approval: approval.state(value.approval), artifactPath: value.artifactPath };
  } catch (error) { if (error.code !== 'ENOENT') storageError = 'Saved approval could not be read. Original file retained; import a candidate to start again.'; }
}
module.exports = { attachControlPanel };
