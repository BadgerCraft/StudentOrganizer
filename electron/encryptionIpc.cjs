// Trusted-window IPC orchestration. No key/crypto callback is exposed to the renderer.
const { randomUUID } = require('node:crypto');
const METHODS = Object.freeze({ status: 0, reopenSecureStartup: 0, selectActingTeacher: 1, unlock: 0, read: 0, commit: 2, commitDelta: 2, lock: 0, prepareMigration: 1, verifyRecovery: 1, createDeviceChallenge: 1, verifyDeviceResponse: 2, completeMigration: 1, enrollFromRecovery: 3, cancelEnrollment: 0, exportEncrypted: 2, exportBackupFile: 0, previewImport: 1, previewImportFile: 0, previewRecoveryFile: 0, authorizeRecovery: 2, applyRecovery: 1, applyImport: 1, listBackups: 0, createBackup: 2, previewStoredBackup: 1, applyStoredBackup: 1 });
const GENERIC = 'The encrypted action was not verified. Keep the original workspace and reopen its verified saved version before retrying.';
function fail(code = 'ENCRYPTION_ACTION_FAILED') { return Object.assign(new Error(GENERIC), { code }); }
function createEncryptionController({ getHost, getStatus, validateIntegrity, assertFullAuthority, replaceProtectedWindow, enrollFromRecovery, cancelEnrollment, files, onLock = () => {}, onContextChange = () => {} }) {
  let actor = null, actorEpoch = 0, busy = false, lastSnapshot = null, pendingImport = null;
  function lockNow() { actorEpoch++; actor = null; pendingImport = null; lastSnapshot = null; getHost(false)?.lock(); onLock(); onContextChange(); }
  function ticket() { const epoch = actorEpoch; return () => { if (epoch !== actorEpoch) throw fail('ENCRYPTION_CONTEXT_CHANGED'); }; }
  function protectedStatus() { const s = getStatus(); if (s.mode !== 'legacy' && s.ephemeralPartition !== true) throw fail('ENCRYPTION_RESTART_REQUIRED'); return s; }
  async function checkedRead(current) { const data = await getHost().read(); const checked = await validateIntegrity(data.snapshot); current(); lastSnapshot = checked; return { revision: data.revision, snapshot: checked }; }
  async function fullAuthority(snapshot, current) { if (actor === null) throw fail('ENCRYPTION_TEACHER_REQUIRED'); await assertFullAuthority(snapshot, actor); current(); const host = getHost(false); if (host?.status().state === 'unlocked' && host.assertHistoricalAuthority) { await host.assertHistoricalAuthority(actor); current(); } }
  async function invoke(method, args) {
    if (!Object.prototype.hasOwnProperty.call(METHODS, method) || args.length !== METHODS[method]) throw fail();
    // Revocation never waits behind a write. At the idle teacher-selection
    // boundary it clears authority without destroying automatic unlock; an
    // in-flight action or preparation is canceled and locks the session.
    if (method === 'lock') { lockNow(); return null; }
    if (method === 'selectActingTeacher' && args[0] === null) {
      if (busy || getHost(false)?.status().state === 'preparing') lockNow();
      else { actorEpoch++; actor = null; pendingImport = null; lastSnapshot = null; getHost(false)?.invalidateTransferContext?.(); onContextChange(); }
      return null;
    }
    if (method === 'reopenSecureStartup') { lockNow(); await replaceProtectedWindow(); return null; }
    if (method === 'status') { const status = protectedStatus(), host = getHost(false); return { state: 'locked', revision: null, ...status, ...(host ? host.status() : {}) }; }
    if (method === 'selectActingTeacher') {
      if (busy) throw fail('ENCRYPTION_BUSY');
      const id = args[0]; if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(id)) throw fail();
      if (lastSnapshot && !lastSnapshot.primary.tables.users.some(u => u.id === id && u.deletedAt === null)) throw fail('ENCRYPTION_TEACHER_REQUIRED');
      actorEpoch++; actor = id; pendingImport = null; getHost(false)?.invalidateTransferContext?.(); onContextChange();
      if (getHost(false)?.status().state === 'preparing') getHost(false).lock();
      return null;
    }
    if (busy) throw fail('ENCRYPTION_BUSY');
    const current = ticket(); busy = true;
    try {
      const status = protectedStatus(), host = getHost();
      if (method === 'cancelEnrollment') {
        if (status.mode !== 'enrollment-pending' || typeof cancelEnrollment !== 'function') throw fail();
        await cancelEnrollment(); current(); pendingImport = null; await replaceProtectedWindow(); return null;
      }
      if (method === 'unlock') {
        const value = await host.unlock();
        try { await checkedRead(current); } catch (e) { host.lock(); throw e; }
        return value;
      }
      if (method === 'read') return checkedRead(current);
      if (method === 'exportBackupFile') {
        if (!files || status.mode !== 'encrypted') throw fail();
        const saved = await checkedRead(current); await fullAuthority(saved.snapshot, current);
        return files.exportFile(write => host.exportArchive(write, actor), current);
      }
      if (method === 'previewImportFile' || method === 'previewRecoveryFile') {
        const receiver = method === 'previewRecoveryFile';
        if (!files || status.mode !== (receiver ? 'enrollment-pending' : 'encrypted')) throw fail(); pendingImport = null;
        let revision = null;
        if (!receiver) { const saved = await checkedRead(current); await fullAuthority(saved.snapshot, current); revision = saved.revision; }
        const preview = await files.previewFile(read => host.previewArchive(read, receiver ? undefined : actor, receiver), current); current();
        if (preview.cancelled) return { cancelled: true };
        const token = randomUUID(); pendingImport = { token, handle: preview.handle, revision, epoch: actorEpoch, source: receiver ? 'recovery-archive' : 'archive' };
        return { cancelled: false, token, metadata: preview.metadata, ...(receiver ? { operators: preview.operators } : {}) };
      }
      if (method === 'authorizeRecovery') {
        const reviewed = pendingImport;
        if (status.mode !== 'enrollment-pending' || !reviewed || reviewed.source !== 'recovery-archive' || args[0] !== reviewed.token || reviewed.epoch !== actorEpoch || typeof args[1] !== 'string') throw fail('ENCRYPTION_REVIEW_EXPIRED');
        const confirmed = await host.authorizeArchive(reviewed.handle, args[1]); current();
        // This explicit baseline selector is bound to the native-verified source
        // operators. It changes the actor epoch without rereading renderer bytes.
        actor = args[1]; actorEpoch++; const token = randomUUID(); pendingImport = { ...reviewed, token, epoch: actorEpoch };
        host.invalidateTransferContext?.(); onContextChange();
        return { token, metadata: confirmed.metadata, operators: confirmed.operators };
      }
      if (method === 'applyRecovery') {
        const reviewed = pendingImport; pendingImport = null;
        if (status.mode !== 'enrollment-pending' || !reviewed || reviewed.source !== 'recovery-archive' || args[0] !== reviewed.token || reviewed.epoch !== actorEpoch || actor === null) throw fail('ENCRYPTION_REVIEW_EXPIRED');
        let result;
        try { result = await host.applyArchive(reviewed.handle, null, actor); current(); } catch { lockNow(); throw fail('ENCRYPTION_RESTORE_UNCONFIRMED'); }
        try { await replaceProtectedWindow(); } catch { lockNow(); throw fail('ENCRYPTION_REOPEN_REQUIRED'); }
        return result;
      }
      if (method === 'commit') {
        pendingImport = null; const checked = await validateIntegrity(args[1]); current();
        const result = await host.commit(args[0], checked); current(); lastSnapshot = checked; return result;
      }
      if (method === 'commitDelta') {
        pendingImport = null; const result = await host.commitDelta(...args); current();
        // The native host validates changed records and canonical relationships
        // against its own accepted state. Do not reserialize all retained history.
        lastSnapshot = null; return result;
      }
      if (method === 'listBackups') { const result = await host.listBackups(); current(); return result; }
      if (method === 'createBackup') { const saved = await checkedRead(current); await fullAuthority(saved.snapshot, current); const result = await host.createBackup(...args); current(); return result; }
      if (method === 'previewStoredBackup') {
        const saved = await checkedRead(current); await fullAuthority(saved.snapshot, current);
        const preview = await host.previewStoredBackup(args[0], actor), checked = await validateIntegrity(preview.snapshot); await fullAuthority(checked, current);
        const token = randomUUID(); pendingImport = { token, snapshot: checked, revision: saved.revision, epoch: actorEpoch, source: 'stored', ...(preview.historicalCheckpoint ? { historicalCheckpoint: structuredClone(preview.historicalCheckpoint) } : {}) };
        return { token, metadata: { exportedAt: checked.primary.exportedAt, totalRecords: Object.values(checked.primary.tables).reduce((sum, rows) => sum + rows.length, 0), tableCount: Object.keys(checked.primary.tables).length } };
      }
      if (method === 'prepareMigration') {
        if (status.mode !== 'legacy') throw fail();
        const checked = await validateIntegrity(args[0]); await fullAuthority(checked, current); lastSnapshot = checked;
        const result = await host.prepareMigration(checked); current(); return result;
      }
      if (method === 'completeMigration') {
        const checked = await validateIntegrity(args[0]); await fullAuthority(checked, current);
        const result = await host.completeMigration(checked); current(); pendingImport = null;
        // The new encrypted checkpoint is the durable mode marker. Close the legacy
        // window and create a nonpersistent partition before evaluating App again.
        try { await replaceProtectedWindow(); } catch { lockNow(); throw fail('ENCRYPTION_REOPEN_REQUIRED'); }
        return result;
      }
      if (method === 'exportEncrypted') { const saved = await checkedRead(current); await fullAuthority(saved.snapshot, current); const result = await host.exportEncrypted(...args); current(); return result; }
      if (method === 'previewImport') {
        const saved = await checkedRead(current); await fullAuthority(saved.snapshot, current);
        const checked = await validateIntegrity(await host.previewBackup(args[0])); await fullAuthority(checked, current);
        const token = randomUUID(); pendingImport = { token, snapshot: checked, revision: saved.revision, epoch: actorEpoch };
        const tables = checked.primary.tables;
        return { token, metadata: { exportedAt: checked.primary.exportedAt, totalRecords: Object.values(tables).reduce((sum, rows) => sum + rows.length, 0), tableCount: Object.keys(tables).length } };
      }
      if (method === 'applyImport' || method === 'applyStoredBackup') {
        const reviewed = pendingImport; pendingImport = null;
        if (!reviewed || args[0] !== reviewed.token || reviewed.epoch !== actorEpoch) throw fail('ENCRYPTION_REVIEW_EXPIRED');
        const saved = await checkedRead(current); if (saved.revision !== reviewed.revision) throw fail('ENCRYPTION_REVIEW_EXPIRED');
        await fullAuthority(saved.snapshot, current); if (reviewed.snapshot) await fullAuthority(reviewed.snapshot, current);
        let result;
        try { result = reviewed.source === 'archive' ? await host.applyArchive(reviewed.handle, reviewed.revision, actor) : reviewed.historicalCheckpoint ? await host.restoreCheckpoint(reviewed.revision, reviewed.historicalCheckpoint) : await host.restoreBundle(reviewed.revision, reviewed.snapshot, { preserveHistory: reviewed.source === 'stored' }); current(); }
        catch { lockNow(); throw fail('ENCRYPTION_RESTORE_UNCONFIRMED'); }
        try { await replaceProtectedWindow(); } catch { lockNow(); throw fail('ENCRYPTION_REOPEN_REQUIRED'); }
        return result;
      }
      if (['verifyRecovery', 'createDeviceChallenge', 'verifyDeviceResponse'].includes(method)) { if (actor === null) throw fail('ENCRYPTION_TEACHER_REQUIRED'); const result = await host[method](...args); current(); return result ?? null; }
      if (method === 'enrollFromRecovery') { const result = await (enrollFromRecovery ? enrollFromRecovery(...args) : host.enrollFromRecovery(...args)); current(); await replaceProtectedWindow(); return result; }
      throw fail();
    } finally { busy = false; }
  }
  const transferTokens = new WeakMap();
  // Native-only adapter: the baseline local teacher selector is not authentication.
  // UI service permissions remain authoritative inside the trusted renderer; this
  // independently binds explicit operator selection for full-workspace disclosure.
  const transferHost = Object.freeze({
    status: () => { protectedStatus(); return getHost().status(); },
    captureTransferContext: () => {
      if (actor === null) throw fail('ENCRYPTION_TEACHER_REQUIRED');
      const token = Object.freeze({}); transferTokens.set(token, { epoch: actorEpoch, hostToken: getHost().captureTransferContext() }); return token;
    },
    assertTransferContext: async token => {
      const state = token && typeof token === 'object' ? transferTokens.get(token) : null;
      if (!state || state.epoch !== actorEpoch) throw fail('ENCRYPTION_CONTEXT_CHANGED');
      await getHost().assertTransferContext(state.hostToken);
      if (state.epoch !== actorEpoch) throw fail('ENCRYPTION_CONTEXT_CHANGED');
    },
    sealTransfer: async (id, json) => {
      const current = ticket(), saved = await checkedRead(current); await fullAuthority(saved.snapshot, current);
      if (typeof json !== 'string') throw fail();
      const checked = await validateIntegrity({ ...saved.snapshot, primary: JSON.parse(json) }); await fullAuthority(checked, current);
      const result = await getHost().sealTransfer(id, json); current(); return result;
    },
    openTransfer: async (id, ciphertext, selection) => {
      const current = ticket(), saved = await checkedRead(current); await fullAuthority(saved.snapshot, current);
      const json = await getHost().openTransfer(id, ciphertext, selection); current();
      const checked = await validateIntegrity({ ...saved.snapshot, primary: JSON.parse(json) }); await fullAuthority(checked, current);
      return json; // Preserve authenticated original bytes for ancestry comparisons.
    }
  });
  return Object.freeze({ invoke, lockNow, transferHost, getBoundActor: () => actor });
}
function attachEncryptionIpc({ ipcMain, requireCaller, controller }) {
  for (const [method, count] of Object.entries(METHODS)) ipcMain.handle('encryption:' + method, async (event, ...args) => {
    requireCaller(event, args, count);
    try { return { ok: true, value: (await controller.invoke(method, args)) ?? null }; }
    catch (error) {
      const code = typeof error?.code === 'string' && /^(ENCRYPTION_|ENCRYPTED_STORAGE_|DEVICE_KEY_)[A-Z_]{1,80}$/.test(error.code) ? error.code : 'ENCRYPTION_ACTION_FAILED';
      const messages = { ENCRYPTION_BUSY: 'Wait for the protected save to finish before switching context or starting another action.', ENCRYPTION_RESTORE_UNCONFIRMED: 'Restore outcome is unconfirmed. Reopen the actual encrypted saved version; a safety backup may already be committed. Do not repeat this restore blindly.', ENCRYPTION_REOPEN_REQUIRED: 'The encrypted write completed, but reopening its protected window failed. Close and reopen the app; the original workspace was not selected as a fallback.', ENCRYPTION_ACTIVATION_REQUIRED: 'Encryption activation is not enabled. Complete the separately reviewed platform, recovery and device checks first.', ENCRYPTION_BACKUP_WRITE_UNCONFIRMED: 'The encrypted backup may already exist at the chosen destination, but its final readback was not verified. Inspect that copy before exporting again. This file export does not replace the working workspace.', ENCRYPTION_BACKUP_WRITE_FAILED: 'The encrypted backup file was not completed. Check the selected folder and available space, then choose a writable destination and retry. This file export does not replace the working workspace.', ENCRYPTION_BACKUP_CLEANUP_REQUIRED: 'An incomplete encrypted backup staging file could not be removed. Inspect the chosen folder for a .partial file before retrying. Do not use that incomplete copy for recovery.', ENCRYPTION_ARCHIVE_INVALID: 'The complete encrypted archive was not verified. Choose an intact .sovault backup for this app and enrolled workspace. No replacement working revision was accepted by this preview.', ENCRYPTION_REVIEW_EXPIRED: 'This recovery review expired after a workspace or teacher change. Review the selected encrypted backup again before applying it.', ENCRYPTION_STREAMING_BACKUP_REQUIRED: 'Use the native encrypted-backup file action in Settings. This workspace includes dated snapshots or is too large for the older buffered export.' };
      return { ok: false, code, message: messages[code] || GENERIC };
    }
  });
}
module.exports = { createEncryptionController, attachEncryptionIpc };
