import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
const require = createRequire(import.meta.url), { DatabaseSync } = require('node:sqlite');
const { createSqliteProtectedKeyStore } = require('../../electron/sqliteProtectedKeyStore.cjs');
const scope = { appId: 'synthetic-app', vaultId: 'synthetic-vault', keyVersion: 1 }, dirs: string[] = [];
const exec = promisify(execFile);
async function fixture(hooks = {}) { const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'synthetic-key-registry-')); dirs.push(directory); return { directory, store: createSqliteProtectedKeyStore({ directory, scope, hooks }) }; }
const protectedBytes = () => new Uint8Array([27, 46, 98, 100, 20, 250]);
afterEach(async () => { for (const directory of dirs.splice(0)) await fs.rm(directory, { recursive: true, force: true }); });
describe('transactional OS-protected key registry', () => {
  it('only exposes scoped bounded ciphertext under an active lease on the same connection', async () => {
    const { store, directory } = await fixture(); await store.initialize();
    expect(() => store.assertProfileLease()).toThrow();
    await expect(store.read('master')).rejects.toMatchObject({ code: 'PROTECTED_KEY_LEASE_REQUIRED' });
    await store.withExclusiveProfileLock(async () => { expect(store.assertProfileLease()).toBeUndefined(); expect(await store.read('master')).toBeNull(); await store.create('master', protectedBytes()); expect(await store.read('master')).toEqual(protectedBytes()); });
    const reopened = createSqliteProtectedKeyStore({ directory, scope }); await reopened.withExclusiveProfileLock(async () => expect(await reopened.read('master')).toEqual(protectedBytes()));
    const other = createSqliteProtectedKeyStore({ directory, scope: { ...scope, vaultId: 'other' } }); await other.withExclusiveProfileLock(async () => expect(await other.read('master')).toBeNull());
    const db = new DatabaseSync(path.join(directory, 'profile-keys.sqlite')); expect(db.prepare('PRAGMA journal_mode').get().journal_mode).toBe('wal'); db.close();
  });
  it('does not overwrite and rolls back failed enrollment including side effects', async () => {
    const { directory, store } = await fixture(); await store.withExclusiveProfileLock(async () => { await store.create('master', protectedBytes()); });
    await expect(store.withExclusiveProfileLock(async () => { await store.create('second', protectedBytes()); await store.create('master', new Uint8Array([99])); })).rejects.toThrow();
    await store.withExclusiveProfileLock(async () => { expect(await store.read('second')).toBeNull(); expect(await store.read('master')).toEqual(protectedBytes()); });
    for (const name of await fs.readdir(directory)) expect((await fs.readFile(path.join(directory, name))).includes(Buffer.from('SYNTHETIC_PLAINTEXT_KEY_CANARY'))).toBe(false);
  });
  it('retains a retryable clean schema after initial schema or row interruption', async () => {
    const { directory } = await fixture(); const bad = createSqliteProtectedKeyStore({ directory, scope, hooks: { beforeSchemaCommit: () => { throw Error('interrupted'); } } });
    await expect(bad.initialize()).rejects.toThrow(); const good = createSqliteProtectedKeyStore({ directory, scope }); await good.initialize();
    const failedRow = createSqliteProtectedKeyStore({ directory, scope, hooks: { beforeCommit: () => { throw Error('interrupted'); } } });
    await expect(failedRow.withExclusiveProfileLock(async () => failedRow.create('master', protectedBytes()))).rejects.toThrow();
    await good.withExclusiveProfileLock(async () => { expect(await good.read('master')).toBeNull(); await good.create('master', protectedBytes()); });
  });
  it('expires leases after callback exit and never grants them to unrelated async tasks', async () => {
    const { store } = await fixture(); let detached!: Promise<unknown>, release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    let outside!: () => void; const outsideGate = new Promise<void>(r => { outside = r; });
    const unrelated = outsideGate.then(() => store.read('master').then(() => 'leaked', () => 'denied'));
    await store.withExclusiveProfileLock(async () => { outside(); expect(await unrelated).toBe('denied'); detached = gate.then(() => store.read('master')); });
    release(); await expect(detached).rejects.toMatchObject({ code: 'PROTECTED_KEY_LEASE_REQUIRED' });
    await expect(store.withExclusiveProfileLock(async () => store.withExclusiveProfileLock(async () => {}))).rejects.toThrow();
  });
  it('reports committed reply loss as uncertain and preserves the enrolled row for readback', async () => {
    const { directory } = await fixture(); const bad = createSqliteProtectedKeyStore({ directory, scope, hooks: { afterCommit: () => { throw Error('PRIVATE_REPLY_LOSS'); } } });
    await expect(bad.withExclusiveProfileLock(async () => bad.create('master', protectedBytes()))).rejects.toMatchObject({ code: 'PROTECTED_KEY_COMMIT_UNCERTAIN' });
    const good = createSqliteProtectedKeyStore({ directory, scope }); await good.withExclusiveProfileLock(async () => expect(await good.read('master')).toEqual(protectedBytes()));
    await expect(good.withExclusiveProfileLock(async () => good.create('master', protectedBytes()))).rejects.toThrow();
  });
  it('attests the full schema and fails corrupt, trigger-bearing, unsupported storage closed', async () => {
    const { directory, store } = await fixture(); await store.initialize(); const filename = path.join(directory, 'profile-keys.sqlite');
    const db = new DatabaseSync(filename); db.exec('CREATE TABLE unexpected(value BLOB)'); db.close(); await expect(store.initialize()).rejects.toThrow();
    await fs.writeFile(filename, 'SYNTHETIC_CORRUPT'); await expect(store.initialize()).rejects.toThrow();
    expect(() => createSqliteProtectedKeyStore({ directory, scope, DatabaseSync: {} })).toThrow();
  });
  it('rejects invalid slots, oversized ciphertext and unsupported input without storing anything', async () => {
    const { store } = await fixture(); await store.withExclusiveProfileLock(async () => {
      await expect(store.create('../private', protectedBytes())).rejects.toThrow();
      for (const value of [new Uint8Array(), new Uint8Array(16385), 'not-bytes']) await expect(store.create('master', value)).rejects.toThrow();
      expect(await store.read('master')).toBeNull();
    });
  });
  it('exclusive creation is enforced across independent OS processes', async () => {
    const { directory, store } = await fixture(); await store.initialize();
    const script = "const {createSqliteProtectedKeyStore}=require(process.argv[1]);const p=JSON.parse(process.argv[2]);const s=createSqliteProtectedKeyStore(p);s.withExclusiveProfileLock(async()=>s.create('master',new Uint8Array([37,54,29]))).then(()=>console.log('CREATED')).catch(()=>console.log('REJECTED'));";
    const args = ['-e', script, path.resolve('electron/sqliteProtectedKeyStore.cjs'), JSON.stringify({ directory, scope })];
    const results = await Promise.all([exec(process.execPath, args), exec(process.execPath, args)]);
    expect(results.filter(r => r.stdout.trim() === 'CREATED')).toHaveLength(1); expect(results.filter(r => r.stdout.trim() === 'REJECTED')).toHaveLength(1);
  });
  it('bounds a competing process lock and does not return locked storage as absent', async () => {
    const { directory, store } = await fixture(); await store.initialize();
    const script = "const{createSqliteProtectedKeyStore}=require(process.argv[1]);const s=createSqliteProtectedKeyStore(JSON.parse(process.argv[2]));s.withExclusiveProfileLock(async()=>{console.log('LOCKED');await new Promise(r=>setTimeout(r,2000));}).then(()=>process.exit(0));";
    const child = spawn(process.execPath, ['-e', script, path.resolve('electron/sqliteProtectedKeyStore.cjs'), JSON.stringify({ directory, scope })], { stdio: ['ignore', 'pipe', 'pipe'] });
    const done = new Promise<void>((resolve, reject) => { child.once('exit', code => code === 0 ? resolve() : reject(Error('child failed'))); child.once('error', reject); });
    await new Promise<void>((resolve, reject) => { child.stdout!.once('data', () => resolve()); child.once('error', reject); });
    const before = Date.now(); await expect(store.withExclusiveProfileLock(async () => store.read('master'))).rejects.toThrow(); expect(Date.now() - before).toBeLessThan(2500); await done;
    await store.withExclusiveProfileLock(async () => expect(await store.read('master')).toBeNull());
  });
  it('rolls back a process exit after row creation before commit', async () => {
    const { directory, store } = await fixture(); await store.initialize();
    const script = "const{createSqliteProtectedKeyStore}=require(process.argv[1]);const s=createSqliteProtectedKeyStore(JSON.parse(process.argv[2]));s.withExclusiveProfileLock(async()=>{await s.create('master',new Uint8Array([33,44]));process.exit(73);});";
    await expect(exec(process.execPath, ['-e', script, path.resolve('electron/sqliteProtectedKeyStore.cjs'), JSON.stringify({ directory, scope })])).rejects.toMatchObject({ code: 73 });
    await store.withExclusiveProfileLock(async () => { expect(await store.read('master')).toBeNull(); await store.create('master', protectedBytes()); });
  });

});
