import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBugReportDraft } from '../services/bugReportService';
const values = new Map<string, string>();
const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
afterEach(() => { vi.resetModules(); vi.doUnmock('./encryptedRuntime'); vi.doUnmock('../services/identityService'); values.clear(); });
async function setup() {
  let epoch = 0, release!: () => void, entered!: () => void, first = true;
  const held = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { entered = resolve; });
  vi.doMock('../services/identityService', () => ({ getIdentityEpoch: () => epoch }));
  vi.doMock('./encryptedRuntime', () => ({ privateStorageRead: async (read: any) => read(storage), privateStorageWrite: async (write: any) => { if (first) { first = false; entered(); await held; } return write(storage); } }));
  const api = await import('./privateReportStorage');
  return { api, release, ready, change: () => { epoch++; } };
}
const draft = (summary: string) => ({ ...createBugReportDraft(), summary });
describe('private report queue', () => {
  it('coalesces consecutive typing without jumping a clear/read boundary', async () => {
    const f = await setup(), first = f.api.savePrivateReport(draft('first')); await f.ready;
    const middle = f.api.savePrivateReport(draft('middle')), latest = f.api.savePrivateReport(draft('latest')), cleared = f.api.clearPrivateReport(), read = f.api.readPrivateReport();
    f.release(); await Promise.all([first, middle, latest, cleared]); const result = await read; expect(result.ok && result.value).toBeNull();
  });
  it('does not credit an old actor’s queued request with a new actor’s save result', async () => {
    const f = await setup(), first = f.api.savePrivateReport(draft('in flight')); await f.ready;
    const old = f.api.savePrivateReport(draft('queued old')); const oldResult = old.then(() => 'accepted', () => 'rejected'); f.change(); const fresh = f.api.savePrivateReport(draft('new actor'));
    const firstResult = first.then(() => 'accepted', () => 'rejected'); f.release(); expect(await firstResult).toBe('rejected'); expect(await oldResult).toBe('rejected'); expect((await fresh).ok).toBe(true); const result = await f.api.readPrivateReport(); expect(result.ok && result.value?.summary).toBe('new actor');
  });
});
