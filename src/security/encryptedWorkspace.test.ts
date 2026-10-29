import { describe, expect, it } from 'vitest';
import { decryptBytes, generateMasterKey, generateRecoveryCode, wrapMasterKey } from '../../shared/encryption';
import { answerEnrollmentChallenge, EncryptedWorkspaceSession, MigrationVerificationError, WorkspaceLockedError, WorkspaceMigration, type EncryptedCheckpoint, type EncryptedWorkspaceStore, type MigrationSource } from './encryptedWorkspace';
interface Bundle { version: 1; records: { id: string; name: string; attachment: string }[]; recovery: string[]; commentBank: string[] }
const fixture = (): Bundle => ({ version: 1, records: [{ id: 'fictional', name: 'Fictional Student', attachment: 'fictional-inline-bytes' }], recovery: ['fictional-backup'], commentBank: ['fictional comment'] });
const scope = () => ({ appId: 'student-organizer', vaultId: 'synthetic-vault', keyVersion: 1 });
function validate(value: unknown): asserts value is Bundle { if (!value || typeof value !== 'object' || (value as Bundle).version !== 1 || !Array.isArray((value as Bundle).records) || !Array.isArray((value as Bundle).recovery) || !Array.isArray((value as Bundle).commentBank)) throw new Error('Invalid synthetic bundle'); }
class Store implements EncryptedWorkspaceStore {
  data: EncryptedCheckpoint | null = null; writes = 0; loseReply = false; fail = false; hold: (() => Promise<void>) | null = null;
  async read() { return structuredClone(this.data); }
  async commit(expected: number | null, next: EncryptedCheckpoint) {
    if (this.hold) await this.hold();
    if ((this.data?.revision ?? null) !== expected || this.fail) throw new Error('CAS failed');
    this.data = structuredClone(next); this.writes++;
    if (this.loseReply) throw new Error('Reply lost');
  }
}
function source(value = fixture()): MigrationSource<Bundle> & { value: Bundle } {
  return { value, async withReadLock(task) { return task(structuredClone(this.value)); } };
}
async function prepared() {
  const key = generateMasterKey(), code = await generateRecoveryCode(), selected = scope(), wrapped = await wrapMasterKey(key, code, selected.appId, selected.vaultId);
  const original = source(), store = new Store(), migration = await WorkspaceMigration.prepare(original, selected, key, wrapped, 'device-a', validate);
  return { key, code, selected, wrapped, original, store, migration };
}
async function verified() {
  const f = await prepared(); await f.migration.verifyRecovery(f.code);
  const challenge = await f.migration.createDeviceChallenge('device-b'); await f.migration.verifyDeviceResponse('device-b', await answerEnrollmentChallenge(f.key, challenge)); return f;
}
async function opened() { const f = await verified(); await f.migration.convert(f.original, f.store); const session = await EncryptedWorkspaceSession.open(f.store, f.selected, f.key, validate); return { ...f, session }; }

describe('staged encrypted workspace integration', () => {
  it('requires real recovery and distinct-device key-possession proofs, retaining the plaintext source', async () => {
    const f = await prepared(), before = structuredClone(f.original.value);
    await expect(f.migration.convert(f.original, f.store)).rejects.toBeInstanceOf(MigrationVerificationError);
    expect(f.store.data).toBeNull();
    await expect(f.migration.createDeviceChallenge('device-a')).rejects.toBeInstanceOf(MigrationVerificationError);
    await expect(f.migration.verifyRecovery('not-a-code')).rejects.toThrow();
    await f.migration.verifyRecovery(f.code);
    await expect(f.migration.convert(f.original, f.store)).rejects.toThrow();
    const challenge = await f.migration.createDeviceChallenge('device-b');
    const answer = await answerEnrollmentChallenge(f.key, challenge);
    await expect(f.migration.verifyDeviceResponse('device-c', answer)).rejects.toThrow();
    await f.migration.verifyDeviceResponse('device-b', answer); await f.migration.convert(f.original, f.store);
    expect(f.original.value).toEqual(before); expect(f.store.writes).toBe(1);
    expect(f.store.data!.ciphertext).not.toContain('Fictional Student'); expect(f.store.data!.ciphertext).not.toContain('fictional-backup');
    expect((await EncryptedWorkspaceSession.open(f.store, f.selected, f.key, validate)).read()).toEqual(before);
  });
  it('rejects source changes, replacing an existing encrypted target and stale challenge responses', async () => {
    const f = await verified(); f.original.value.commentBank.push('new local comment');
    await expect(f.migration.convert(f.original, f.store)).rejects.toThrow(); expect(f.store.writes).toBe(0);
    const g = await verified(); g.store.data = { revision: 9, ciphertext: 'existing' };
    await expect(g.migration.convert(g.original, g.store)).rejects.toThrow(); expect(g.store.data.ciphertext).toBe('existing');
    const h = await prepared(); const old = await h.migration.createDeviceChallenge('device-b'); const reply = await answerEnrollmentChallenge(h.key, old); await h.migration.createDeviceChallenge('device-b');
    await expect(h.migration.verifyDeviceResponse('device-b', reply)).rejects.toThrow();
  });
  it('serializes durable edits, retains every data surface and survives restart', async () => {
    const f = await opened(); await Promise.all([f.session.transact(async draft => { draft.records[0].name = 'first'; }), f.session.transact(draft => { draft.commentBank.push('second'); })]);
    expect(f.session.getRevision()).toBe(3); expect(f.store.writes).toBe(3);
    const reopened = await EncryptedWorkspaceSession.open(f.store, f.selected, f.key, validate);
    expect(reopened.read()).toEqual(f.session.read()); expect(reopened.read().records[0].attachment).toBe('fictional-inline-bytes'); expect(reopened.read().recovery).toEqual(['fictional-backup']);
  });
  it('never publishes references retained by an edit callback, including while persistence is pending', async () => {
    const f = await opened(); let retained!: Bundle, release!: () => void, entered!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { entered = resolve; });
    f.store.hold = async () => { entered(); await wait; };
    const saving = f.session.transact(draft => { retained = draft; draft.records[0].name = 'committed'; }); await ready;
    retained.records[0].name = 'uncommitted-during-write'; expect(f.session.read().records[0].name).toBe('Fictional Student'); release(); await saving;
    retained.records[0].name = 'uncommitted-after-write'; expect(f.session.read().records[0].name).toBe('committed');
    expect((await EncryptedWorkspaceSession.open(f.store, f.selected, f.key, validate)).read().records[0].name).toBe('committed');
  });
  it('binds the copied vault scope despite caller mutations', async () => {
    const f = await opened(); f.selected.vaultId = 'caller-mutated'; await f.session.transact(draft => { draft.records[0].name = 'saved'; });
    const reopened = await EncryptedWorkspaceSession.open(f.store, scope(), f.key, validate); expect(reopened.read().records[0].name).toBe('saved');
    await expect(EncryptedWorkspaceSession.open(f.store, f.selected, f.key, validate)).rejects.toThrow();
  });
  it('owns key bytes before awaiting reads and migration source capture', async () => {
    const f = await opened(), originalKey = new Uint8Array(f.key), callerKey = new Uint8Array(f.key);
    let resume!: () => void; const gate = new Promise<void>(resolve => { resume = resolve; });
    const delayed = { read: async () => { await gate; return f.store.read(); }, commit: f.store.commit.bind(f.store) };
    const opening = EncryptedWorkspaceSession.open(delayed, scope(), callerKey, validate); callerKey.fill(0); resume();
    const session = await opening; await session.transact(draft => { draft.records[0].name = 'owned key'; });
    expect((await EncryptedWorkspaceSession.open(f.store, scope(), originalKey, validate)).read().records[0].name).toBe('owned key');
    const g = await prepared(), migratingKey = new Uint8Array(g.key); let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    const sourceWithGate: MigrationSource<Bundle> = { async withReadLock(task) { await wait; return task(structuredClone(g.original.value)); } };
    const preparing = WorkspaceMigration.prepare(sourceWithGate, scope(), migratingKey, g.wrapped, 'device-a', validate); migratingKey.fill(0); release();
    const migration = await preparing; await migration.verifyRecovery(g.code); const challenge = await migration.createDeviceChallenge('device-b'); await migration.verifyDeviceResponse('device-b', await answerEnrollmentChallenge(g.key, challenge)); await migration.convert(sourceWithGate, g.store);
    expect((await EncryptedWorkspaceSession.open(g.store, scope(), g.key, validate)).read()).toEqual(fixture());
  });
  it('locks after an uncertain commit and does not replay queued writes', async () => {
    const f = await opened(); f.store.loseReply = true;
    const first = f.session.transact(draft => { draft.records[0].name = 'accepted remotely'; }), second = f.session.transact(draft => { draft.records[0].name = 'must not replay'; });
    await expect(first).rejects.toBeInstanceOf(WorkspaceLockedError); await expect(second).rejects.toBeInstanceOf(WorkspaceLockedError);
    expect(() => f.session.read()).toThrow(); expect(f.store.writes).toBe(2);
    expect((await EncryptedWorkspaceSession.open(f.store, scope(), f.key, validate)).read().records[0].name).toBe('accepted remotely');
  });
  it('rejects stale writers and locks without replacing the winning revision', async () => {
    const f = await opened(), other = await EncryptedWorkspaceSession.open(f.store, scope(), f.key, validate);
    await f.session.transact(draft => { draft.records[0].name = 'winner'; }); await expect(other.transact(draft => { draft.records[0].name = 'loser'; })).rejects.toThrow();
    expect(() => other.read()).toThrow(); expect((await EncryptedWorkspaceSession.open(f.store, scope(), f.key, validate)).read().records[0].name).toBe('winner');
  });
  it('keeps the old checkpoint after failed writes and rejects corrupted ciphertext and plaintext', async () => {
    const f = await opened(), before = structuredClone(f.store.data); f.store.fail = true;
    await expect(f.session.transact(draft => { draft.records[0].name = 'not durable'; })).rejects.toThrow(); expect(f.store.data).toEqual(before);
    f.store.data!.ciphertext = f.store.data!.ciphertext.slice(0, -3) + 'bad'; await expect(EncryptedWorkspaceSession.open(f.store, scope(), f.key, validate)).rejects.toThrow();
    f.store.data!.ciphertext = JSON.stringify(fixture()); await expect(EncryptedWorkspaceSession.open(f.store, scope(), f.key, validate)).rejects.toThrow();
  });
  it('exports authenticated backups/transfers with separate contexts and no plaintext fallback', async () => {
    const f = await opened(); const backup = await f.session.exportEncrypted('backup', 'dated-synthetic');
    const expected = { ...scope(), purpose: 'backup' as const, recordId: 'dated-synthetic', revision: backup.revision };
    expect(JSON.parse(new TextDecoder().decode(await decryptBytes(f.key, expected, backup.ciphertext)))).toEqual(fixture());
    await expect(decryptBytes(f.key, { ...expected, purpose: 'transfer' }, backup.ciphertext)).rejects.toThrow();
    await expect(decryptBytes(f.key, { ...expected, appId: 'servetrack' }, backup.ciphertext)).rejects.toThrow();
  });
  it('rejects non-JSON state and lock interrupts pending edits without writing', async () => {
    const f = await opened(); await expect(f.session.transact(draft => { (draft as any).bad = undefined; })).rejects.toThrow(); expect(f.store.writes).toBe(1);
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
    const saving = f.session.transact(async draft => { await wait; draft.records[0].name = 'closed'; }); await new Promise(resolve => setTimeout(resolve, 0)); f.session.lock(); release(); await expect(saving).rejects.toThrow(); expect(f.store.writes).toBe(1);
  });
});
