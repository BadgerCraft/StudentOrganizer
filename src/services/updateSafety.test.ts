import { afterEach, describe, expect, it } from 'vitest';
import { runUpdateWork, setUpdateLocked, updateSafetyReason } from './updateSafety';
afterEach(() => setUpdateLocked(false));
describe('restart safety across asynchronous teacher actions', () => {
  it('registers before the first await and retains the blocker across overlapping writes', async () => {
    let finishA!: () => void, finishB!: () => void;
    const a = runUpdateWork(() => new Promise<void>(resolve => { finishA = resolve; }));
    const b = runUpdateWork(() => new Promise<void>(resolve => { finishB = resolve; }));
    expect(updateSafetyReason()).toMatch(/save to finish/);
    finishA(); await a; expect(updateSafetyReason()).toMatch(/save to finish/);
    finishB(); await b; expect(updateSafetyReason()).toBeUndefined();
  });
  it('releases the blocker on failure and never starts an action while installation holds the UI', async () => {
    await expect(runUpdateWork(async () => { throw new Error('fictional failure'); })).rejects.toThrow('fictional failure');
    expect(updateSafetyReason()).toBeUndefined();
    setUpdateLocked(true); let called = false;
    await runUpdateWork(async () => { called = true; }); expect(called).toBe(false);
    setUpdateLocked(false); await runUpdateWork(async () => { called = true; }); expect(called).toBe(true);
  });
});
