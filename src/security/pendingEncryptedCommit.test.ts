import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), { createPendingEncryptedCommit } = require('../../electron/pendingEncryptedCommit.cjs');
const scope = { appId: 'synthetic', vaultId: 'vault', keyVersion: 1 };
const copy = <T>(x: T): T => structuredClone(x);
function fixture(allowFresh = true, preEnrolledEmpty = false) {
  let ledgerState: any = preEnrolledEmpty ? { head: null, pending: null } : null, current: any = null, fault = ''; let writes = 0, publishes = 0, unreadable = false;
  const staged = new Map<string, any>();
  const ledger = { read: async () => copy(ledgerState), compareAndSwap: async (expected: any, next: any) => {
    if (JSON.stringify(ledgerState) !== JSON.stringify(expected)) throw Error('CAS');
    if (fault === 'before-head' && !next.pending) { fault = ''; throw Error('lost'); }
    ledgerState = copy(next); writes++;
    if (fault === 'after-pending' && next.pending || fault === 'after-head' && !next.pending) { fault = ''; throw Error('lost'); }
  } };
  const candidates = { current: async () => { if (unreadable) throw Error('unreadable'); return copy(current); }, stage: async (id: string, next: any) => { staged.set(id, copy(next)); if (fault === 'stage-current-corrupt') { current = { revision: 99, ciphertext: 'SYNTHETIC_CHANGED' }; throw Error('uncertain'); } if (fault === 'stage-current-unreadable') { unreadable = true; throw Error('uncertain'); } if (fault === 'stage') { fault = ''; throw Error('stage'); } }, readStaged: async (id: string) => copy(staged.get(id) ?? null), publish: async (_id: string, _base: any, next: any) => { current = copy(next); publishes++; if (fault === 'publish') { fault = ''; throw Error('lost'); } } };
  const coordinator = createPendingEncryptedCommit({ scope, withExclusiveProfileLock: (fn: () => any) => fn(), assertFreshEnrollment: () => { if (!allowFresh) throw Error('not verified'); }, ledger, candidates });
  return { coordinator, staged, fault: (f: string) => { fault = f; }, ledger: () => copy(ledgerState), current: () => copy(current), setCurrent: (v: any) => { current = copy(v); }, counts: () => ({ writes, publishes }) };
}
describe('pending encrypted commit reconciliation', () => {
  it('publishes a new revision only after binding its exact ciphertext hash in the protected receipt', async () => {
    const f = fixture(); const one = await f.coordinator.commit(null, { revision: 1, ciphertext: 'SYNTHETIC_CIPHERTEXT_ONE' }); expect(one.status).toBe('durable'); expect(one.head.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(f.ledger()).toEqual({ head: one.head, pending: null }); expect((await f.coordinator.commit(null, { revision: 2, ciphertext: 'SYNTHETIC_OTHER' })).status).toBe('rejected');
    const two = await f.coordinator.commit(one.head, { revision: 2, ciphertext: 'SYNTHETIC_CIPHERTEXT_TWO' }); expect(two.status).toBe('durable');
    f.setCurrent({ revision: 1, ciphertext: 'SYNTHETIC_CIPHERTEXT_ONE' }); expect((await f.coordinator.reconcile()).status).toBe('uncertain');
  });
  it.each(['after-pending', 'publish', 'before-head', 'after-head'])('reconciles interruption %s without creating another revision or replaying another candidate', async fault => {
    const f = fixture(); f.fault(fault); expect((await f.coordinator.commit(null, { revision: 1, ciphertext: 'SYNTHETIC_CIPHER' })).status).toBe('uncertain');
    expect((await f.coordinator.reconcile()).status).toBe('durable'); expect(f.current()).toEqual({ revision: 1, ciphertext: 'SYNTHETIC_CIPHER' }); expect(f.counts().publishes).toBe(1);
  });
  it('rejects a changed staged ciphertext even at the correct next revision', async () => {
    const f = fixture(); f.fault('after-pending'); await f.coordinator.commit(null, { revision: 1, ciphertext: 'SYNTHETIC_EXACT_CIPHER' }); const op = f.ledger().pending.operationId;
    f.staged.set(op, { revision: 1, ciphertext: 'SYNTHETIC_OTHER_VALID_CIPHER' }); expect((await f.coordinator.reconcile()).status).toBe('uncertain'); expect(f.current()).toBeNull(); expect(f.counts().publishes).toBe(0);
  });
  it('leaves an uncertain pre-receipt staging failure unactivated and never resets heads for historical recovery', async () => {
    const f = fixture(); f.fault('stage'); expect((await f.coordinator.commit(null, { revision: 1, ciphertext: 'SYNTHETIC_CIPHER' })).status).toBe('uncertain'); expect(f.current()).toBeNull(); expect(f.ledger()).toBeNull();
    const one = await f.coordinator.commit(null, { revision: 1, ciphertext: 'SYNTHETIC_CIPHER' });
    expect((await f.coordinator.commit(one.head, { revision: 1, ciphertext: 'SYNTHETIC_OLD_BACKUP' })).status).toBe('rejected');
    expect((await f.coordinator.commit(one.head, { revision: 2, ciphertext: 'SYNTHETIC_REENCRYPTED_HISTORY' })).status).toBe('durable');
  });
  it('copies the expected head before awaiting native storage', async () => {
    const f = fixture(); const first = await f.coordinator.commit(null, { revision: 1, ciphertext: 'SYNTHETIC_CIPHER' });
    const expected = { ...first.head }; const pending = f.coordinator.commit(expected, { revision: 2, ciphertext: 'SYNTHETIC_SECOND_CIPHER' });
    expected.hash = '0'.repeat(64); expected.revision = 999;
    expect((await pending).status).toBe('durable');
  });

  it.each(['stage-current-corrupt', 'stage-current-unreadable'])('never claims known rejection after %s', async failure => {
    const f = fixture(); f.fault(failure); expect((await f.coordinator.commit(null, { revision: 1, ciphertext: 'SYNTHETIC_CIPHER' })).status).toBe('uncertain');
    expect((await f.coordinator.reconcile()).status).toBe('uncertain'); expect(f.ledger()).toBeNull();
  });
  it.each([false, true])('requires explicit verified enrollment for absent or empty protected heads (empty=%s)', async preEnrolledEmpty => {
    const f = fixture(false, preEnrolledEmpty); expect(await f.coordinator.reconcile()).toEqual({ status: 'enrollment-required', head: null });
    expect(await f.coordinator.commit(null, { revision: 1, ciphertext: 'SYNTHETIC_CIPHER' })).toEqual({ status: 'rejected', code: 'VERIFIED_ENROLLMENT_REQUIRED' });
    expect(f.ledger()).toEqual(preEnrolledEmpty ? { head: null, pending: null } : null); expect(f.staged.size).toBe(0);
  });

});
