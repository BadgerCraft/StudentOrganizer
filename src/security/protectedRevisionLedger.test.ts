import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createProtectedRevisionLedger, ledgerBytes, decodeLedger } = require('../../electron/protectedRevisionLedger.cjs');
const scope = { appId: 'synthetic', vaultId: 'vault', keyVersion: 1 }, empty = { head: null, pending: null };
const h = { revision: 1, hash: 'a'.repeat(64) };
const pending = { head: null, pending: { operationId: '12345678-1234-4123-8123-123456789abc', base: null, next: h } };
describe('independent protected revision ledger', () => {
  it('requires a synchronous live profile lease, scopes native identity and writes only bounded receipts', async () => {
    let active = false; const rows = new Map<string, Buffer>();
    const native = { read: (id: string) => rows.get(id) ?? null, write: (id: string, bytes: Buffer) => rows.set(id, Buffer.from(bytes)) };
    const ledger = createProtectedRevisionLedger({ scope, platform: 'win32', assertProfileLease: () => { if (!active) throw Error('no lease'); }, loadWindowsBinding: () => native });
    await expect(ledger.read()).rejects.toThrow(); active = true;
    expect(await ledger.read()).toBeNull(); await ledger.compareAndSwap(null, empty); expect(await ledger.read()).toEqual(empty);
    await ledger.compareAndSwap(empty, pending); await ledger.compareAndSwap(pending, { head: h, pending: null }); await expect(ledger.compareAndSwap(empty, empty)).rejects.toThrow();
    expect([...rows.keys()][0]).toMatch(/^TeacherVaultLedgerV1-[a-f0-9]{64}$/); expect([...rows.values()][0].length).toBeLessThan(2049);
    const other = createProtectedRevisionLedger({ scope: { ...scope, appId: 'other' }, platform: 'win32', assertProfileLease: () => {}, loadWindowsBinding: () => native }); expect(await other.read()).toBeNull();
    const badAssert = createProtectedRevisionLedger({ scope, platform: 'win32', assertProfileLease: () => Promise.resolve(), loadWindowsBinding: () => native }); await expect(badAssert.read()).rejects.toThrow();
  });
  it('rejects malformed, stale-scope, duplicated, oversized and out-of-sequence receipts', () => {
    const b = ledgerBytes(scope, empty); expect(decodeLedger(scope, b)).toEqual(empty);
    for (const bad of [Buffer.from(b.toString().replace('"version":1', '"version":1,"version":1')), Buffer.from('x'.repeat(2049)), ledgerBytes({ ...scope, vaultId: 'other' }, empty)]) expect(() => decodeLedger(scope, bad)).toThrow();
    expect(() => ledgerBytes(scope, { head: h, pending: { operationId: '1'.repeat(36), base: h, next: { ...h, revision: 3 } } })).toThrow();
  });
  it('uses Mac secret byte APIs without target constructors, enumeration or plaintext files', async () => {
    let raw: number[] | null = null;
    class AsyncEntry { async getSecret() { return raw === null ? null : [...raw]; } async setSecret(bytes: Uint8Array) { if (!(bytes instanceof Uint8Array)) throw Error('NAPI requires Uint8Array'); raw = [...bytes]; } }
    const ledger = createProtectedRevisionLedger({ scope, platform: 'darwin', assertProfileLease: () => {}, loadMacBinding: () => ({ AsyncEntry }) });
    await ledger.compareAndSwap(null, pending); await ledger.compareAndSwap(pending, { head: h, pending: null }); expect(await ledger.read()).toEqual({ head: h, pending: null });
  });
  it('rejects reset, skip, same-revision substitution and pending-operation replacement', async () => {
    const high = { revision: 5, hash: 'b'.repeat(64) }; let raw = ledgerBytes(scope, { head: high, pending: null }), writes = 0;
    const ledger = createProtectedRevisionLedger({ scope, platform: 'win32', assertProfileLease: () => {}, loadWindowsBinding: () => ({ read: () => raw, write: (_id: string, bytes: Buffer) => { raw = Buffer.from(bytes); writes++; } }) });
    const before = { head: high, pending: null };
    for (const next of [{ head: h, pending: null }, { head: { ...high, revision: 6 }, pending: null }, { head: { ...high, hash: 'c'.repeat(64) }, pending: null }, empty]) await expect(ledger.compareAndSwap(before, next)).rejects.toThrow();
    expect(writes).toBe(0);
    const next = { revision: 6, hash: 'c'.repeat(64) }, receipt = { head: high, pending: { operationId: pending.pending.operationId, base: high, next } };
    await ledger.compareAndSwap(before, receipt); await ledger.compareAndSwap(receipt, receipt);
    await expect(ledger.compareAndSwap(receipt, { ...receipt, pending: { ...receipt.pending, operationId: '22345678-1234-4123-8123-123456789abc' } })).rejects.toThrow();
    await expect(ledger.compareAndSwap(receipt, before)).rejects.toThrow();
    await ledger.compareAndSwap(receipt, { head: next, pending: null }); expect((await ledger.read()).head).toEqual(next);
    expect(() => ledgerBytes(scope, { ...receipt, pending: { ...receipt.pending, operationId: '-'.repeat(36) } })).toThrow();
  });
  it('never writes after the originating lease expires during an OS read', async () => {
    let active = true, resolveRead!: (value: null) => void, writes = 0;
    const ledger = createProtectedRevisionLedger({ scope, platform: 'win32', assertProfileLease: () => { if (!active) throw Error('expired'); }, loadWindowsBinding: () => ({ read: () => new Promise<null>(resolve => { resolveRead = resolve; }), write: () => { writes++; } }) });
    const saving = ledger.compareAndSwap(null, empty); active = false; resolveRead(null);
    await expect(saving).rejects.toThrow(); expect(writes).toBe(0);
  });

});
