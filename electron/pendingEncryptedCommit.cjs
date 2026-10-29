const { createHash, randomUUID } = require('node:crypto');
const { ledgerBytes } = require('./protectedRevisionLedger.cjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const error = () => Error('Encrypted pending commit requires reconciliation. No older revision or unmatched candidate was accepted.');
function createPendingEncryptedCommit({ scope, withExclusiveProfileLock, ledger, candidates, maxBytes = 180 * 1024 * 1024, assertFreshEnrollment = () => { throw error(); } }) {
  if (typeof withExclusiveProfileLock !== 'function' || !['read', 'compareAndSwap'].every(k => typeof ledger?.[k] === 'function') || !['stage', 'readStaged', 'publish', 'current'].every(k => typeof candidates?.[k] === 'function') || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 180 * 1024 * 1024) throw error();
  ledgerBytes(scope, { head: null, pending: null }); scope = Object.freeze({ ...scope });
  function checkpoint(value) {
    if (value === null) return null;
    if (!value || Object.keys(value).sort().join(',') !== 'ciphertext,revision' || !Number.isSafeInteger(value.revision) || value.revision < 1 || typeof value.ciphertext !== 'string' || Buffer.byteLength(value.ciphertext) < 1 || Buffer.byteLength(value.ciphertext) > maxBytes) throw error();
    return { revision: value.revision, hash: hash(Buffer.from(value.ciphertext, 'utf8')) };
  }
  async function reconcileLocked() {
    const state = await ledger.read(), current = checkpoint(await candidates.current());
    if (!state) { if (current !== null) throw error(); return { state: { head: null, pending: null }, missing: true }; }
    ledgerBytes(scope, state);
    if (!state.pending) { if (!equal(current, state.head)) throw error(); return { state, missing: false }; }
    const p = state.pending;
    if (!equal(current, p.next)) {
      if (!equal(current, p.base)) throw error();
      const staged = await candidates.readStaged(p.operationId);
      if (!equal(checkpoint(staged), p.next)) throw error();
      await candidates.publish(p.operationId, p.base, staged);
      if (!equal(checkpoint(await candidates.current()), p.next)) throw error();
    }
    const next = { head: p.next, pending: null }; await ledger.compareAndSwap(state, next); return { state: next, missing: false };
  }
  async function reconcile() {
    try { return await withExclusiveProfileLock(async () => { const { state, missing } = await reconcileLocked(); return { status: state.head === null ? 'enrollment-required' : 'durable', head: state.head }; }); }
    catch { return { status: 'uncertain', code: 'PENDING_RECONCILIATION_REQUIRED' }; }
  }
  async function commit(expectedHead, input) {
    // Freeze the exact bytes before awaiting a host lock. No automatic retry.
    let next, expected; try { ledgerBytes(scope, { head: expectedHead, pending: null }); expected = expectedHead === null ? null : { revision: expectedHead.revision, hash: expectedHead.hash }; checkpoint(input); next = { revision: input.revision, ciphertext: input.ciphertext }; checkpoint(next); } catch { return { status: 'rejected', code: 'INVALID_ENCRYPTED_CANDIDATE' }; }
    let pendingAttempted = false, reconciled = false, ioAttempted = false;
    try { return await withExclusiveProfileLock(async () => {
      const { state, missing } = await reconcileLocked(), selected = checkpoint(next); reconciled = true;
      if (!equal(state.head, expected) || selected.revision !== (state.head?.revision ?? 0) + 1) return { status: 'rejected', code: 'STALE_ENCRYPTED_HEAD' };
      if (state.head === null) { try { if (assertFreshEnrollment() !== undefined) throw error(); } catch { return { status: 'rejected', code: 'VERIFIED_ENROLLMENT_REQUIRED' }; } }
      const operationId = randomUUID();
      ioAttempted = true;
      await candidates.stage(operationId, next);
      if (!equal(checkpoint(await candidates.readStaged(operationId)), selected)) throw error();
      const pending = { head: state.head, pending: { operationId, base: state.head, next: selected } };
      if (state.head === null && assertFreshEnrollment() !== undefined) throw error();
      pendingAttempted = true; await ledger.compareAndSwap(missing ? null : state, pending);
      await candidates.publish(operationId, state.head, next);
      if (!equal(checkpoint(await candidates.current()), selected)) throw error();
      await ledger.compareAndSwap(pending, { head: selected, pending: null });
      return { status: 'durable', head: selected };
    }); } catch { return { status: pendingAttempted || !reconciled || ioAttempted ? 'uncertain' : 'rejected', code: pendingAttempted || !reconciled || ioAttempted ? 'PENDING_RECONCILIATION_REQUIRED' : 'ENCRYPTED_COMMIT_REJECTED' }; }
  }
  return Object.freeze({ commit, reconcile });
}
module.exports = { createPendingEncryptedCommit };
