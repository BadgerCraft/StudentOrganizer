import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const { createEncryptionController, attachEncryptionIpc } = createRequire(import.meta.url)('../../electron/encryptionIpc.cjs');
const original = { format: 'student-organizer-working', version: 1, primary: { exportedAt: '2026-10-29T00:00:00Z', tables: { users: [{ id: 'owner', deletedAt: null }, { id: 'co-teacher', deletedAt: null }], students: [{ id: 'fictional' }] } }, recovery: {}, applicationStorage: {} };
function fixture() {
  let snapshot: any = structuredClone(original), revision = 1, state = 'unlocked', commits = 0, authorizations = 0, switches = 0, invalidations = 0;
  const host: any = { status: () => ({ appId: 'student-organizer', vaultId: 'synthetic', keyVersion: 1, state, revision }), lock: () => { state = 'locked'; }, read: async () => { if (state !== 'unlocked') throw Error(); return { revision, snapshot: structuredClone(snapshot) }; }, unlock: async () => { state = 'unlocked'; return { revision }; }, commit: async (expected: number, next: any) => { if (expected !== revision) throw Error(); snapshot = structuredClone(next); commits++; return { revision: ++revision }; }, restoreBundle: async (expected: number, next: any) => { if (expected !== revision) throw Error(); snapshot = structuredClone(next); return { revision: ++revision }; }, previewBackup: async () => structuredClone(original), exportEncrypted: async () => ({ revision, ciphertext: 'synthetic encrypted bytes' }), invalidateTransferContext: () => { invalidations++; } };
  const options: any = { getHost: () => host, getStatus: () => ({ mode: 'encrypted', ephemeralPartition: true, activationReady: true }), validateIntegrity: async (value: any) => { if (value.invalid) throw Error('PRIVATE_RESPONSE'); return structuredClone(value); }, assertFullAuthority: async (_value: any, actor: string) => { authorizations++; if (actor !== 'owner') throw Error('PRIVATE_DENIED'); }, replaceProtectedWindow: async () => { switches++; } };
  const controller = createEncryptionController(options);
  return { host, options, controller, get commits() { return commits; }, get authorizations() { return authorizations; }, get switches() { return switches; }, get invalidations() { return invalidations; } };
}
describe('native encrypted IPC boundary', () => {
  it('pins focused readable report permission to native actor, exact generation revision and unlocked lifecycle', async () => {
    const f = fixture();
    expect(() => f.controller.captureReadableExportContext(1)).toThrow();
    await f.controller.invoke('selectActingTeacher', ['co-teacher']);
    expect(() => f.controller.captureReadableExportContext(undefined)).toThrow(); expect(() => f.controller.captureReadableExportContext(2)).toThrow();
    const current = f.controller.captureReadableExportContext(1); expect(() => current()).not.toThrow(); expect(f.authorizations).toBe(0); // class READ stays at existing renderer service boundary
    await f.controller.invoke('commit', [1, original]); expect(() => current()).toThrow();
    const next = f.controller.captureReadableExportContext(2); await f.controller.invoke('selectActingTeacher', ['owner']); expect(() => next()).toThrow();
    const last = f.controller.captureReadableExportContext(2); await f.controller.invoke('lock', []); expect(() => last()).toThrow();
  });
  it('clears an idle selected actor at startup without closing automatic unlock', async () => {
    const f = fixture(); await f.controller.invoke('read', []); await f.controller.invoke('selectActingTeacher', ['owner']);
    await f.controller.invoke('selectActingTeacher', [null]); expect(f.controller.getBoundActor()).toBeNull(); expect(f.host.status().state).toBe('unlocked');
    await f.controller.invoke('commit', [1, original]); expect(f.commits).toBe(1); await expect(f.controller.invoke('exportEncrypted', ['backup', 'synthetic'])).rejects.toMatchObject({ code: 'ENCRYPTION_TEACHER_REQUIRED' });
  });
  it('checks retained native history only for an unlocked workspace, not before legacy preparation', async () => {
    const f = fixture(); f.host.lock(); f.options.getStatus = () => ({ mode: 'legacy', ephemeralPartition: false });
    f.host.assertHistoricalAuthority = async () => { throw Error('history is unavailable before conversion'); }; f.host.prepareMigration = async () => ({ wrappedKey: 'synthetic' });
    const c = createEncryptionController(f.options); await c.invoke('selectActingTeacher', ['owner']);
    expect(await c.invoke('prepareMigration', [original])).toEqual({ wrappedKey: 'synthetic' });
  });
  it('revokes the runtime enrollment epoch as well as the host when explicitly locked', async () => {
    const f = fixture(); let runtimeLocks = 0; f.options.onLock = () => { runtimeLocks++; }; const c = createEncryptionController(f.options);
    await c.invoke('lock', []); expect(runtimeLocks).toBe(1); expect(f.host.status().state).toBe('locked');
  });
  it('keeps the legacy teacher separate from a code-only archive owner and exposes only an opaque review ticket', async () => {
    const f = fixture(), handle = Object.freeze({}), metadata = { exportedAt: '2026-10-29T00:00:00Z', totalRecords: 3, tableCount: 2 }, operators = [{ id: 'archive-owner', name: 'Fictional owner' }];
    const calls: unknown[] = []; f.options.getStatus = () => ({ mode: 'legacy', ephemeralPartition: false });
    f.options.files = { previewFile: async (read: any) => ({ cancelled: false, ...await read({ [Symbol.asyncIterator]: async function* () {} }) }) };
    f.options.prepareRecoveryFile = async (code: string) => { expect(code).toBe('synthetic-private-code'); return { handle, metadata, operators }; };
    f.options.cancelOfflineRecovery = () => {};
    f.options.authorizeOfflineRecovery = async (selected: object, actor: string) => { expect(selected).toBe(handle); expect(actor).toBe('archive-owner'); return { metadata, operators }; };
    f.options.applyOfflineRecovery = async (...args: unknown[]) => { calls.push(args); return { revision: 1 }; };
    const c = createEncryptionController(f.options); await c.invoke('selectActingTeacher', ['owner']);
    const preview = await c.invoke('previewOfflineRecoveryFile', ['synthetic-private-code']); expect(preview).toMatchObject({ cancelled: false, metadata, operators }); expect(JSON.stringify(preview)).not.toContain('synthetic-private-code'); expect(preview.handle).toBeUndefined();
    await expect(c.invoke('applyOfflineRecovery', [preview.token])).rejects.toThrow(); // authorization is required and consumes no other actor
    const second = await c.invoke('previewOfflineRecoveryFile', ['synthetic-private-code']), authorized = await c.invoke('authorizeOfflineRecovery', [second.token, 'archive-owner']);
    expect(c.getBoundActor()).toBe('owner'); expect(await c.invoke('applyOfflineRecovery', [authorized.token])).toEqual({ revision: 1 }); expect(calls).toEqual([[handle, 'archive-owner']]); expect(f.switches).toBe(1);
  });
  it('invalidates a code-only recovery ticket when the legacy teacher changes', async () => {
    const f = fixture(); f.options.getStatus = () => ({ mode: 'legacy', ephemeralPartition: false });
    f.options.files = { previewFile: async (read: any) => ({ cancelled: false, ...await read({}) }) }; f.options.prepareRecoveryFile = async () => ({ handle: {}, metadata: {}, operators: [] });
    const c = createEncryptionController(f.options); const preview = await c.invoke('previewOfflineRecoveryFile', ['synthetic']); await c.invoke('selectActingTeacher', ['co-teacher']);
    await expect(c.invoke('authorizeOfflineRecovery', [preview.token, 'archive-owner'])).rejects.toMatchObject({ code: 'ENCRYPTION_REVIEW_EXPIRED' }); expect(f.switches).toBe(0);
  });
  it('revokes private recovery material when an invalid apply consumes the review token', async () => {
    const f = fixture(); let cancels = 0, applies = 0; f.options.getStatus = () => ({ mode: 'legacy', ephemeralPartition: false });
    f.options.files = { previewFile: async (read: any) => ({ cancelled: false, ...await read({}) }) }; f.options.prepareRecoveryFile = async () => ({ handle: {}, metadata: {}, operators: [] });
    f.options.authorizeOfflineRecovery = async () => ({ metadata: {}, operators: [] }); f.options.cancelOfflineRecovery = () => { cancels++; }; f.options.applyOfflineRecovery = async () => { applies++; };
    const c = createEncryptionController(f.options), preview = await c.invoke('previewOfflineRecoveryFile', ['synthetic']), authorized = await c.invoke('authorizeOfflineRecovery', [preview.token, 'archive-owner']);
    await expect(c.invoke('applyOfflineRecovery', ['stale-' + authorized.token])).rejects.toMatchObject({ code: 'ENCRYPTION_REVIEW_EXPIRED' }); expect(cancels).toBe(1); expect(applies).toBe(0); expect(f.switches).toBe(0);
  });
  it('cancels held code-only verification before a late private handle can be accepted', async () => {
    const f = fixture(); let release!: () => void, cancelled = 0; const held = new Promise<void>(resolve => { release = resolve; });
    f.options.getStatus = () => ({ mode: 'legacy', ephemeralPartition: false }); f.options.files = { previewFile: async (read: any) => ({ cancelled: false, ...await read({}) }) };
    f.options.prepareRecoveryFile = async () => { await held; return { handle: {}, metadata: {}, operators: [] }; }; f.options.cancelOfflineRecovery = () => { cancelled++; };
    const c = createEncryptionController(f.options), preview = c.invoke('previewOfflineRecoveryFile', ['synthetic']); await c.invoke('cancelOfflineRecovery', []); release();
    await expect(preview).rejects.toMatchObject({ code: 'ENCRYPTION_CONTEXT_CHANGED' }); expect(cancelled).toBe(1); expect(f.switches).toBe(0);
  });
  it('preserves ordinary co-teacher persistence while requiring a separately selected operator for full export', async () => {
    const f = fixture(); await f.controller.invoke('read', []); await f.controller.invoke('selectActingTeacher', ['co-teacher']);
    await f.controller.invoke('commit', [1, original]); expect(f.commits).toBe(1); expect(f.authorizations).toBe(0);
    await expect(f.controller.invoke('exportEncrypted', ['backup', 'synthetic'])).rejects.toThrow(); expect(f.authorizations).toBe(1);
    await f.controller.invoke('selectActingTeacher', ['owner']); await expect(f.controller.invoke('exportEncrypted', ['backup', 'synthetic'])).resolves.toHaveProperty('ciphertext');
  });
  it('blocks context switches while validating a save and allows immediate fail-closed revocation', async () => {
    const f = fixture(); await f.controller.invoke('selectActingTeacher', ['owner']); let release!: () => void;
    const blocked = new Promise<void>(r => { release = r; }); f.options.validateIntegrity = async (v: any) => { await blocked; return structuredClone(v); };
    const c = createEncryptionController(f.options); await c.invoke('selectActingTeacher', ['owner']); const saving = c.invoke('commit', [1, original]);
    await expect(c.invoke('selectActingTeacher', ['co-teacher'])).rejects.toMatchObject({ code: 'ENCRYPTION_BUSY' });
    await c.invoke('selectActingTeacher', [null]); release(); await expect(saving).rejects.toMatchObject({ code: 'ENCRYPTION_CONTEXT_CHANGED' }); expect(f.commits).toBe(0); expect(c.getBoundActor()).toBeNull();
  });
  it('rejects encrypted startup status in a persistent partition', async () => {
    const f = fixture(); f.options.getStatus = () => ({ mode: 'encrypted', ephemeralPartition: false }); const c = createEncryptionController(f.options);
    await expect(c.invoke('status', [])).rejects.toMatchObject({ code: 'ENCRYPTION_RESTART_REQUIRED' });
  });
  it('pins restore tokens to actor context and durable revision before applying with a safety copy', async () => {
    const f = fixture(); await f.controller.invoke('selectActingTeacher', ['owner']); const preview = await f.controller.invoke('previewImport', ['opaque-encrypted-file']); expect(preview.metadata.totalRecords).toBe(3);
    await f.controller.invoke('commit', [1, original]); await expect(f.controller.invoke('applyImport', [preview.token])).rejects.toThrow(); expect(f.switches).toBe(0);
    const latest = await f.controller.invoke('previewImport', ['opaque-encrypted-file']); expect(await f.controller.invoke('applyImport', [latest.token])).toEqual({ revision: 3 }); expect(f.switches).toBe(1);
    await expect(f.controller.invoke('applyImport', [latest.token])).rejects.toThrow();
  });
  it('does not claim a failed restore left data unchanged', async () => {
    const f = fixture(); await f.controller.invoke('selectActingTeacher', ['owner']); const preview = await f.controller.invoke('previewImport', ['opaque-encrypted-file']); f.host.restoreBundle = async () => { throw Error('PRIVATE_LOST_ACK'); };
    await expect(f.controller.invoke('applyImport', [preview.token])).rejects.toMatchObject({ code: 'ENCRYPTION_RESTORE_UNCONFIRMED' }); expect(f.host.status().state).toBe('locked');
  });
  it('checks trusted callers and sanitizes provider response bodies at IPC registration', async () => {
    const f = fixture(), handlers = new Map<string, (...args: any[]) => Promise<any>>(); let guards = 0;
    attachEncryptionIpc({ ipcMain: { handle: (name: string, fn: any) => handlers.set(name, fn) }, controller: f.controller, requireCaller: (event: any, args: any[], count: number) => { guards++; if (event !== 'trusted' || args.length !== count) throw Error('denied'); } });
    await expect(handlers.get('encryption:commit')!('foreign', 1, original)).rejects.toThrow('denied');
    const result = await handlers.get('encryption:commit')!('trusted', 1, { ...original, invalid: true }); expect(result.ok).toBe(false); expect(JSON.stringify(result)).not.toContain('PRIVATE_'); expect(f.commits).toBe(0); expect(guards).toBe(2);
    expect(handlers.has('encryption:openTransfer')).toBe(false); expect(handlers.has('encryption:sealTransfer')).toBe(false);
  });
});
