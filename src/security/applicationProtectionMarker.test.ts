import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), { createApplicationProtectionMarker } = require('../../electron/applicationProtectionMarker.cjs');
describe('independent application protection marker', () => {
  it('isolates applications and preserves an immutable presence marker independently of app files', async () => {
    const values = new Map<string, Buffer>(); let writes = 0;
    const native = { read: (id: string) => values.get(id) ?? null, write: (id: string, value: Uint8Array) => { writes++; values.set(id, Buffer.from(value)); } };
    const a = createApplicationProtectionMarker({ appId: 'synthetic-a', platform: 'win32', loadWindowsBinding: () => native });
    const b = createApplicationProtectionMarker({ appId: 'synthetic-b', platform: 'win32', loadWindowsBinding: () => native });
    expect(await a.read()).toBe(false); await a.markProtected(() => {}); await a.markProtected(() => {}); expect(await a.read()).toBe(true); expect(await b.read()).toBe(false); expect(writes).toBe(1);
    for (const raw of values.values()) { expect(raw.length).toBeLessThan(2048); expect(raw.toString()).not.toContain('vaultId'); }
  });
  it('does not convert unavailable, malformed or foreign application state into absence', async () => {
    const a = createApplicationProtectionMarker({ appId: 'synthetic', platform: 'win32', loadWindowsBinding: () => ({ read: () => { throw Error('PRIVATE_OS_ERROR'); }, write: () => {} }) });
    await expect(a.read()).rejects.toMatchObject({ code: 'APPLICATION_PROTECTION_UNCERTAIN' });
    const malformed = createApplicationProtectionMarker({ appId: 'synthetic', platform: 'win32', loadWindowsBinding: () => ({ read: () => Buffer.from('{}'), write: () => { throw Error('must not overwrite'); } }) }); await expect(malformed.markProtected(() => {})).rejects.toThrow();
  });
  it('retains uncertain first-marker writes and refuses to proceed after capability revocation', async () => {
    let value: Buffer | null = null, first = true;
    const a = createApplicationProtectionMarker({ appId: 'synthetic', platform: 'win32', loadWindowsBinding: () => ({ read: () => value, write: (_id: string, v: Uint8Array) => { value = Buffer.from(v); if (first) { first = false; throw Error('lost reply'); } } }) });
    await expect(a.markProtected(() => {})).rejects.toThrow(); expect(await a.read()).toBe(true); await a.markProtected(() => {});
    let entered = false; await expect(a.markProtected(() => { entered = true; throw Error('revoked'); })).rejects.toThrow(); expect(entered).toBe(true); expect(await a.read()).toBe(true);
  });
});
