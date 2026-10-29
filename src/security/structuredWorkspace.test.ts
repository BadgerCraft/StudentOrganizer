import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import * as cryptoRuntime from '../../shared/encryption';
import * as chunkRuntime from '../../shared/encryption/chunks';
const require = createRequire(import.meta.url), { StructuredWorkspace } = require('../../electron/structuredWorkspace.cjs'), { createCipherChunkStore } = require('../../electron/cipherChunkStore.cjs');
const directories: string[] = [];
const shardHashes = new Set(Array.from({length:256},(_,index)=>createHash('sha256').update('shard/'+index.toString(16).padStart(2,'0')).digest('hex')));
const scope = { appId: 'student-organizer', vaultId: 'fictional-structured', keyVersion: 1 };
function row(id: string, value: unknown) { return { namespace: 'primary', table: 'students', key: id, value }; }
async function fixture(extra: Record<string, unknown> = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'synthetic-structured-')); directories.push(directory); const key = cryptoRuntime.generateMasterKey();
  let checkpoint: any = null, commits = 0, stages = 0, reads = 0, bodyReads = 0, failed = false, lost = false, held: Promise<void> | null = null;
  const checkpointStore = { read: async () => structuredClone(checkpoint), commit: async (expected: number | null, next: any) => { if (held) await held; if (failed) throw Error('synthetic rejection'); if ((checkpoint?.revision ?? null) !== expected) throw Error('stale'); commits++; checkpoint = structuredClone(next); if (lost) throw Error('synthetic lost reply'); } };
  const options = { scope, key, checkpointStore, recoveryWrapperHash: 'e'.repeat(64), cryptoRuntime, chunkRuntime, createChunkStore: (verifyManifest: unknown, assertPublication: () => void) => {
    const native = createCipherChunkStore({ directory, scope, parseEnvelope: cryptoRuntime.parseEnvelope, verifyManifest, hooks: { beforeCommit: assertPublication } });
    return { ...native, stage: async (...args: any[]) => { stages++; return native.stage(...args); }, read: async (...args: any[]) => { reads++; if (!shardHashes.has(args[1]?.split('/')[1])) bodyReads++; return native.read(...args); } };
  }, ...extra };
  return { options, directory, key, checkpointStore, checkpoint: () => checkpoint, stages: () => stages, reads: () => reads, bodyReads:()=>bodyReads, commits: () => commits, fail: () => { failed = true; }, lose: () => { lost = true; }, hold: () => { let release!: () => void; held = new Promise<void>(r => release = r); return () => { held = null; release(); }; } };
}
afterEach(async () => { for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }); });
describe('structured immutable object workspace', () => {
  it('roundtrips typed logical records and large JSON strings without a whole-bundle encoding', async () => {
    const f = await fixture({ maxRecordBytes: 128 * 1024 });
    async function* source() { for (let i = 0; i < 12; i++) yield { namespace: 'recovery', table: 'backups', key: 'dated-' + i, value: { id: 'dated-' + i, json: 'Fictional history ' + '\u{1f600}'.repeat(16000) } }; yield row('student/a', { id: 'student/a', text: 'quote " slash \\ and lone \ud800', level: '3+' }); }
    const session = await StructuredWorkspace.create(f.options, source());
    expect(session.getRevision()).toBe(1); expect((await session.list()).length).toBe(13);
    const saved = f.checkpoint(); expect(saved.ciphertext).not.toContain('Fictional history');
    const root = JSON.parse(new TextDecoder().decode(await cryptoRuntime.decryptBytes(f.key, { ...scope, purpose: 'working-data', recordId: 'workspace', revision: 1 }, saved.ciphertext)));
    expect(root.recordCount).toBe(13); expect(root.buckets.length).toBeLessThanOrEqual(256); expect(JSON.stringify(root).length).toBeLessThan(16000);
    // Aggregate record bodies exceed the injected per-record buffered limit many times over.
    const reopened = await StructuredWorkspace.open(f.options); expect((await reopened.readRecord({ namespace: 'recovery', table: 'backups', key: 'dated-11' })).json).toBe('Fictional history ' + '\u{1f600}'.repeat(16000));
    expect((await reopened.readRecord({ namespace: 'primary', table: 'students', key: 'student/a' })).text).toBe('quote " slash \\ and lone \ud800');
  }, 30000);
  it('reads earlier private root payloads and upgrades their authenticated ceiling on the next write', async()=>{
    const f=await fixture();await StructuredWorkspace.create(f.options,[row('a',{text:'legacy'})]);const saved=f.checkpoint();
    const plain=await cryptoRuntime.decryptBytes(f.key,{...scope,purpose:'working-data',recordId:'workspace',revision:1},saved.ciphertext), root=JSON.parse(new TextDecoder().decode(plain));plain.fill(0);root.version=1;delete root.objectRevisionCeiling;
    saved.ciphertext=await cryptoRuntime.encryptBytes(f.key,{...scope,purpose:'working-data',recordId:'workspace',revision:1},new TextEncoder().encode(JSON.stringify(root)));
    const opened=await StructuredWorkspace.open(f.options);expect(opened.getObjectRevisionCeiling()).toBe(1);await opened.commitDelta(1,[row('a',{text:'new'})]);expect(opened.getObjectRevisionCeiling()).toBe(2);
    const current=JSON.parse(new TextDecoder().decode(await cryptoRuntime.decryptBytes(f.key,{...scope,purpose:'working-data',recordId:'workspace',revision:2},f.checkpoint().ciphertext)));expect(current.version).toBe(2);expect(current.objectRevisionCeiling).toBe(2);
  });
  it('writes only changed objects and their bounded shard metadata; unchanged history is reused', async () => {
    const f = await fixture(); const records = [row('a', { id: 'a', comment: 'old' }), { namespace: 'recovery', table: 'backups', key: 'history', value: { json: 'Historical unchanged bytes'.repeat(10000) } }];
    const session = await StructuredWorkspace.create(f.options, records); const stages = f.stages();
    await session.commitDelta(1, [row('a', { comment: 'new', id: 'a' })]);
    expect(f.stages() - stages).toBe(2); // One small row and one metadata shard, never the retained backup.
    const same = f.stages(); await session.commitDelta(2, [row('a', { id: 'a', comment: 'new' })]); expect(f.stages()).toBe(same);
    await session.commitDelta(3, [{ namespace: 'primary', table: 'students', key: 'a', deleted: true }]); expect(await session.readRecord({ namespace: 'primary', table: 'students', key: 'a' })).toBeUndefined();
    expect((await session.readRecord({ namespace: 'recovery', table: 'backups', key: 'history' })).json.length).toBeGreaterThan(100000);
  }, 30000);
  it('preserves the authenticated recovery wrapper hash and keeps keys private after caller mutation', async () => {
    const f = await fixture(); const correctKey = new Uint8Array(f.key); const pending = StructuredWorkspace.create(f.options, [row('a', { id: 'a', text: 'kept' })]); f.key.fill(0); const session = await pending;
    expect(session.getRecoveryWrapperHash()).toBe('e'.repeat(64)); expect(Object.keys(session)).toEqual([]);
    await session.commitDelta(1, [row('a', { id: 'a', text: 'changed' })]); expect(session.getRecoveryWrapperHash()).toBe('e'.repeat(64));
    expect((await session.readRecord({ namespace: 'primary', table: 'students', key: 'a' })).text).toBe('changed');
    await expect(StructuredWorkspace.open({ ...f.options, key: correctKey, recoveryWrapperHash: 'f'.repeat(64) })).rejects.toThrow(); expect((await StructuredWorkspace.open({ ...f.options, key: correctKey })).getRecoveryWrapperHash()).toBe('e'.repeat(64)); correctKey.fill(0);
  });
  it('owns queued delta values and holds reads until the durable root succeeds', async () => {
    const f = await fixture(); const session = await StructuredWorkspace.create(f.options, [row('a', { text: 'old' })]); const release = f.hold();
    const value = { text: 'new' }, saving = session.commitDelta(1, [row('a', value)]); value.text = 'caller changed'; let done = false;
    const reading = session.readRecord({ namespace: 'primary', table: 'students', key: 'a' }).then((v: unknown) => { done = true; return v; });
    await new Promise(r => setTimeout(r, 10)); expect(done).toBe(false); expect(session.getRevision()).toBe(1); release(); await saving; expect(await reading).toEqual({ text: 'new' });
  });
  it('locks after a failed or uncertain root commit and reopens the actual durable revision without replay', async () => {
    for (const lose of [false, true]) {
      const f = await fixture(); const session = await StructuredWorkspace.create(f.options, [row('a', { text: 'old' })]); if (lose) f.lose(); else f.fail();
      await expect(session.commitDelta(1, [row('a', { text: 'new' })])).rejects.toThrow(); expect(() => session.getRevision()).toThrow();
      const reopened = await StructuredWorkspace.open(f.options); expect((await reopened.readRecord({ namespace: 'primary', table: 'students', key: 'a' })).text).toBe(lose ? 'new' : 'old'); expect(f.commits()).toBe(lose ? 2 : 1);
    }
  });
  it('rejects stale independent writers, wrong contexts and corrupt object descriptors', async () => {
    const f = await fixture(); await StructuredWorkspace.create(f.options, [row('a', { text: 'original' })]); const left = await StructuredWorkspace.open(f.options), right = await StructuredWorkspace.open(f.options);
    await left.commitDelta(1, [row('a', { text: 'left' })]); await expect(right.commitDelta(1, [row('a', { text: 'right' })])).rejects.toThrow();
    expect((await (await StructuredWorkspace.open(f.options)).readRecord({ namespace: 'primary', table: 'students', key: 'a' })).text).toBe('left');
    await expect(StructuredWorkspace.open({ ...f.options, scope: { ...scope, appId: 'other-app' } })).rejects.toThrow();
    const checkpoint = f.checkpoint(); checkpoint.ciphertext = checkpoint.ciphertext.slice(0, -1) + 'x'; await expect(StructuredWorkspace.open(f.options)).rejects.toThrow();
  });
  it('maps full source records without losing empty tables, binary row order or exact history strings', async () => {
    const { recordsFromBundle, bundleFromRecords } = require('../../electron/studentOrganizerRecords.cjs');
    const original = { format: 'student-organizer-working', version: 1, primary: { version: 2, schemaVersion: 5, exportedAt: '2026-10-29T00:00:00Z', tables: { students: [{ id: 'ä', name: 'Fictional' }, { id: 'a/b' }, { id: 'a' }, { id: 'Z' }], notes: [] } }, recovery: { backups: [{ id: 'b', createdAt: '2026-10-29T00:00:00Z', reason: 'manual', json: ' { "tables" : [] } \n' }], options: [], state: [] }, applicationStorage: { 'ota.comment-bank.v1.teacher/key': ' [ "Fictional note" ] ' } };
    const f = await fixture(); const session = await StructuredWorkspace.create(f.options, recordsFromBundle(original, ['students', 'notes']));
    const rebuilt = bundleFromRecords(await session.readAll(), ['students', 'notes']);
    expect(rebuilt.primary.tables.students.map((r: { id: string }) => r.id)).toEqual(['Z', 'a', 'a/b', 'ä']); expect(rebuilt.primary.tables.notes).toEqual([]);
    expect(rebuilt.recovery.backups[0].json).toBe(original.recovery.backups[0].json); expect(rebuilt.applicationStorage).toEqual(original.applicationStorage);
    const { bundleViewFromRecords } = require('../../electron/studentOrganizerRecords.cjs'); const allRecords = await session.readAll();
    const view = bundleViewFromRecords(allRecords.filter((record: any) => record.table !== 'backup-content'), ['students', 'notes']);
    expect(view.bundle.recovery.backups).toEqual([]); expect(view.backupCatalog).toEqual([{ id: 'b', createdAt: original.recovery.backups[0].createdAt, reason: 'manual' }]);
    expect(() => bundleFromRecords(allRecords.filter((record: any) => record.table !== 'backup-content'), ['students','notes'])).toThrow();
    expect(() => bundleViewFromRecords(allRecords, ['students','notes'])).toThrow();
    const { recordChangesFromLegacyDelta } = require('../../electron/studentOrganizerRecords.cjs');
    const changed = { namespace: 'recovery', table: 'backups', key: 'b', value: original.recovery.backups[0] };
    expect(recordChangesFromLegacyDelta([changed])).toEqual([{ ...changed, value: view.backupCatalog[0] }, { namespace: 'recovery', table: 'backup-content', key: 'b', value: original.recovery.backups[0].json }]);
    expect(recordChangesFromLegacyDelta([{ namespace: 'recovery', table: 'backups', key: 'b', deleted: true }])).toEqual([{ namespace: 'recovery', table: 'backups', key: 'b', deleted: true }, { namespace: 'recovery', table: 'backup-content', key: 'b', deleted: true }]);
    expect(() => bundleFromRecords([...recordsFromBundle(original, ['students', 'notes'])].slice(1), ['students', 'notes'])).toThrow();
  });
  it('restores complete immutable root references at a new revision and retains an exact pre-restore safety root', async () => {
    const f = await fixture(); const session = await StructuredWorkspace.create(f.options, [row('a', { text: 'old' }), { namespace: 'recovery', table: 'backup-content', key: 'old-history', value: 'old exact history' }]);
    const initial = structuredClone(f.checkpoint());
    await session.commitDelta(1, [row('a', { text: 'new' }), { namespace: 'recovery', table: 'backup-content', key: 'new-history', value: 'new exact history' }]); const beforeRestore = structuredClone(f.checkpoint());
    const identity = { namespace: 'metadata', key: 'internal-safety/' + crypto.randomUUID() }; const stages = f.stages();
    expect(await session.restoreCheckpoint(2, initial, identity)).toEqual({ revision: 3 }); expect(f.stages() - stages).toBe(2);
    expect((await session.readRecord({ namespace: 'primary', table: 'students', key: 'a' })).text).toBe('old');
    expect(await session.readRecord({ namespace: 'recovery', table: 'backup-content', key: 'new-history' })).toBeUndefined();
    const safety = await session.readRecord(identity); expect(safety.revision).toBe(2); expect(safety.ciphertext).toBe(beforeRestore.ciphertext); expect(Number.isFinite(Date.parse(safety.createdAt))).toBe(true);
    await session.restoreCheckpoint(3, { revision: safety.revision, ciphertext: safety.ciphertext }, { namespace: 'metadata', key: 'internal-safety/' + crypto.randomUUID() });
    expect(session.getRevision()).toBe(4); expect((await session.readRecord({ namespace: 'primary', table: 'students', key: 'a' })).text).toBe('new');
    expect(await session.readRecord({ namespace: 'recovery', table: 'backup-content', key: 'new-history' })).toBe('new exact history');
  });
  // Five real encrypted SQLite setup/restore/reopen scenarios exceeded the
  // default 5s on Windows CI; retain every case under one bounded I/O allowance.
  it('rejects invalid or revoked retained-root restore without advancing current data', async () => {
    for (const scenario of ['wrong-key', 'wrong-wrapper', 'future', 'guard', 'lost-reply']) {
      const f = await fixture(); const session = await StructuredWorkspace.create(f.options, [row('a', { text: 'old' })]); const original = structuredClone(f.checkpoint()); await session.commitDelta(1, [row('a', { text: 'new' })]);
      let guardCalls = 0;
      if (scenario === 'wrong-wrapper' || scenario === 'future') {
        const root = JSON.parse(new TextDecoder().decode(await cryptoRuntime.decryptBytes(f.key, { ...scope, purpose: 'working-data', recordId: 'workspace', revision: original.revision }, original.ciphertext)));
        if (scenario === 'wrong-wrapper') root.recoveryWrapperHash = 'f'.repeat(64); else original.revision = 3;
        original.ciphertext = await cryptoRuntime.encryptBytes(f.key, { ...scope, purpose: 'working-data', recordId: 'workspace', revision: original.revision }, new TextEncoder().encode(JSON.stringify(root)));
      }
      if (scenario === 'wrong-key') original.ciphertext = original.ciphertext.slice(0,-1) + 'x'; if (scenario === 'lost-reply') f.lose();
      await expect(session.restoreCheckpoint(2, original, { namespace: 'metadata', key: 'internal-safety/' + crypto.randomUUID() }, () => { if (scenario === 'guard' && ++guardCalls === 3) throw Error('synthetic revoked context'); })).rejects.toThrow();
      expect(() => session.getRevision()).toThrow(); const reopened = await StructuredWorkspace.open(f.options);
      expect(reopened.getRevision()).toBe(scenario === 'lost-reply' ? 3 : 2); expect((await reopened.readRecord({ namespace: 'primary', table: 'students', key: 'a' })).text).toBe(scenario === 'lost-reply' ? 'old' : 'new');
    }
  }, 30000);
  // Mac Intel CI exceeded the old 30s while processing real encrypted chunks.
  // Keep a bounded allowance for the minimum two-chunk FULL-SQLite fixture.
  it('preflights materialization budgets while retaining a bounded authenticated streaming path', async () => {
    const f = await fixture({ maxReadRecordBytes: 1024, maxReadAllBytes: 1400 });
    // Minimum real-format multi-chunk body: keep the fixed shared 4-MiB
    // boundary without an unrelated extra megabyte of synthetic plaintext.
    const payload='Fictional cross-chunk record '+'x'.repeat(chunkRuntime.CHUNK_BYTES);
    expect(Buffer.byteLength(payload)).toBeGreaterThan(chunkRuntime.CHUNK_BYTES);
    expect(Buffer.byteLength(payload)).toBeLessThan(chunkRuntime.CHUNK_BYTES+256);
    await StructuredWorkspace.create(f.options, [row('large', { text: payload }), row('small', { text: 'ok' })]);
    const capped = await StructuredWorkspace.open(f.options);
    await expect(capped.readRecord({ namespace: 'primary', table: 'students', key: 'large' })).rejects.toMatchObject({ code: 'STRUCTURED_WORKSPACE_READ_LIMIT' });
    const streaming = await StructuredWorkspace.open(f.options); const pieces: Uint8Array[] = [], borrowed: Uint8Array[] = [];
    const size = await streaming.readRecordStream({ namespace: 'primary', table: 'students', key: 'large' }, async (piece: Uint8Array) => { borrowed.push(piece); pieces.push(new Uint8Array(piece)); });
    expect(size).toBeGreaterThan(1024); expect(JSON.parse(Buffer.concat(pieces).toString()).text).toBe(payload); expect(pieces.length).toBeGreaterThan(1); expect(pieces.every(piece => piece.length <= chunkRuntime.CHUNK_BYTES)).toBe(true); expect(borrowed.every(piece => piece.every(byte => byte === 0))).toBe(true);
    const budgeted = await StructuredWorkspace.open({ ...f.options, maxReadRecordBytes: 10000, maxReadAllBytes: 1000 });
    const reads = f.reads(); await expect(budgeted.readAll()).rejects.toMatchObject({ code: 'STRUCTURED_WORKSPACE_READ_LIMIT' });
    expect(f.reads() - reads).toBeLessThanOrEqual(2); // Metadata shards only, no large body read.
    expect(f.checkpoint().revision).toBe(1);
  }, 90000);
  // Mac Intel's real encrypted fixture exceeded Vitest's default 5s; all
  // preflight/read-count assertions remain inside this explicit bound.
  it('preflights the entire selected hydration before any body and excludes unselected large history',async()=>{
    const f=await fixture({maxReadRecordBytes:4096,maxReadAllBytes:1000});
    // This unselected body must exceed BOTH successful selection budgets;
    // its former hundreds of KiB added I/O without another boundary.
    const history='fictional history '.repeat(512);
    expect(Buffer.byteLength(JSON.stringify(history))).toBeGreaterThan(4096);
    expect(Buffer.byteLength(JSON.stringify(history))).toBeGreaterThan(3000);
    await StructuredWorkspace.create(f.options,[row('a',{text:'a'.repeat(600)}),row('b',{text:'b'.repeat(600)}),{namespace:'recovery',table:'backup-content',key:'large-history',value:history}]);
    const selection=[{namespace:'primary',table:'students',key:'b'},{namespace:'primary',table:'students',key:'a'}];
    const limited=await StructuredWorkspace.open(f.options),before=f.bodyReads();await expect(limited.readSelected(selection)).rejects.toMatchObject({code:'STRUCTURED_WORKSPACE_READ_LIMIT'});expect(f.bodyReads()).toBe(before);
    const bounded=await StructuredWorkspace.open({...f.options,maxReadAllBytes:3000}),values=await bounded.readSelected(selection);expect(values.map((value:any)=>value.key)).toEqual(['b','a']);expect(values[0].value.text).toBe('b'.repeat(600));expect(f.bodyReads()-before).toBe(2);
    const recordLimited=await StructuredWorkspace.open({...f.options,maxReadRecordBytes:512,maxReadAllBytes:3000}),beforeRecord=f.bodyReads();await expect(recordLimited.readSelected([selection[0]])).rejects.toMatchObject({code:'STRUCTURED_WORKSPACE_READ_LIMIT'});expect(f.bodyReads()).toBe(beforeRecord);expect(f.checkpoint().revision).toBe(1);
  },30000);
  it('rejects duplicate, malformed and missing selections before any selected body is read',async()=>{
    const f=await fixture();await StructuredWorkspace.create(f.options,[row('a',{text:'fictional'})]);const selected={namespace:'primary',table:'students',key:'a'};
    for(const selection of [[selected,selected],[{...selected,value:'untrusted'}],[{...selected,key:'missing'}],[{namespace:'storage',table:'students',key:'a'}]]) {
      const opened=await StructuredWorkspace.open(f.options),before=f.bodyReads();await expect(opened.readSelected(selection)).rejects.toThrow();expect(f.bodyReads()).toBe(before);
    }
    const opened=await StructuredWorkspace.open(f.options);expect(await opened.readSelected([])).toEqual([]);expect(f.checkpoint().revision).toBe(1);
  });
  it('owns selected identities and serializes hydration after durable saves while invalidating closed reads',async()=>{
    const f=await fixture(),session=await StructuredWorkspace.create(f.options,[row('a',{text:'old'})]),release=f.hold();
    const saving=session.commitDelta(1,[row('a',{text:'new'})]),selection=[{namespace:'primary',table:'students',key:'a'}];let done=false;
    const reading=session.readSelected(selection).then((value:any)=>{done=true;return value;});selection[0].key='changed caller alias';await new Promise(resolve=>setTimeout(resolve,10));expect(done).toBe(false);release();await saving;expect((await reading)[0].value.text).toBe('new');
    const reopened=await StructuredWorkspace.open(f.options),before=f.bodyReads(),closed=reopened.readSelected([{namespace:'primary',table:'students',key:'a'}]);reopened.lock();await expect(closed).rejects.toMatchObject({code:'STRUCTURED_WORKSPACE_LOCKED'});expect(f.bodyReads()).toBe(before);
  });
  it('does not complete a streaming read after its workspace is locked', async () => {
    const f = await fixture(); const session = await StructuredWorkspace.create(f.options, [row('a', { text: 'fictional' })]); let chunks = 0;
    await expect(session.readRecordStream({ namespace: 'primary', table: 'students', key: 'a' }, async () => { chunks++; session.lock(); })).rejects.toMatchObject({ code: 'STRUCTURED_WORKSPACE_LOCKED' });
    expect(chunks).toBe(1); expect(f.checkpoint().revision).toBe(1); expect(() => session.getRevision()).toThrow();
  });
  it('rejects non-JSON records, over-limit individual records and a changed actor guard without advancing the root', async () => {
    const f = await fixture({ maxRecordBytes: 1024 }); const session = await StructuredWorkspace.create(f.options, [row('a', { text: 'original' })]);
    await expect(session.commitDelta(1, [row('a', { text: 'x'.repeat(2000) })])).rejects.toThrow(); expect(f.checkpoint().revision).toBe(1);
    const fresh = await StructuredWorkspace.open(f.options); await expect(fresh.commitDelta(1, [row('a', { value: undefined })])).rejects.toThrow(); expect(f.checkpoint().revision).toBe(1);
    const guarded = await StructuredWorkspace.open(f.options); await expect(guarded.commitDelta(1, [row('a', { text: 'next' })], () => { throw Error('synthetic actor changed'); })).rejects.toThrow(); expect(f.checkpoint().revision).toBe(1);
  });
});
