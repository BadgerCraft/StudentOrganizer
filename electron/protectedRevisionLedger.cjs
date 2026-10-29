const { createHash, timingSafeEqual } = require('node:crypto');
const LIMIT = 2048;
const fail = () => Object.assign(Error('Protected revision ledger is unavailable. Reconcile the verified pending operation; no fallback was used.'), { code: 'PROTECTED_LEDGER_UNAVAILABLE' });
function normalizedScope(s) {
  if (!s || Object.keys(s).sort().join(',') !== 'appId,keyVersion,vaultId' || ![s.appId, s.vaultId].every(x => typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(x)) || !Number.isSafeInteger(s.keyVersion) || s.keyVersion < 1) throw fail();
  return { appId: s.appId, vaultId: s.vaultId, keyVersion: s.keyVersion };
}
function head(h) {
  if (h === null) return null;
  if (!h || Object.keys(h).sort().join(',') !== 'hash,revision' || !Number.isSafeInteger(h.revision) || h.revision < 1 || typeof h.hash !== 'string' || !/^[a-f0-9]{64}$/.test(h.hash)) throw fail();
  return { revision: h.revision, hash: h.hash };
}
function ledgerBytes(scope, state) {
  const s = normalizedScope(scope);
  if (!state || Object.keys(state).sort().join(',') !== 'head,pending') throw fail();
  const current = head(state.head); let pending = null;
  if (state.pending !== null) {
    const p = state.pending;
    if (!p || Object.keys(p).sort().join(',') !== 'base,next,operationId' || typeof p.operationId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(p.operationId)) throw fail();
    const base = head(p.base), next = head(p.next);
    if (!next || JSON.stringify(base) !== JSON.stringify(current) || next.revision !== (base?.revision ?? 0) + 1) throw fail();
    pending = { operationId: p.operationId, base, next };
  }
  const bytes = Buffer.from(JSON.stringify({ version: 1, ...s, head: current, pending }));
  if (bytes.length > LIMIT) throw fail(); return bytes;
}
function decode(scope, value) {
  if (!(value instanceof Uint8Array) || value.length < 1 || value.length > LIMIT) throw fail();
  const b = Buffer.from(value); let parsed;
  try { parsed = JSON.parse(b.toString('utf8')); } catch { throw fail(); }
  const expected = ledgerBytes(scope, { head: parsed?.head, pending: parsed?.pending });
  if (!b.equals(expected)) throw fail();
  return { head: parsed.head, pending: parsed.pending };
}
function transition(expected, next) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (same(expected, next)) return;
  if (expected === null) {
    if (next.head !== null || (next.pending !== null && (next.pending.base !== null || next.pending.next.revision !== 1))) throw fail();
    return;
  }
  if (expected.pending === null) {
    if (!next.pending || !same(next.head, expected.head) || !same(next.pending.base, expected.head)) throw fail();
    return;
  }
  if (next.pending !== null || !same(next.head, expected.pending.next)) throw fail();
}
function createProtectedRevisionLedger({ scope, platform = process.platform, assertProfileLease, loadWindowsBinding, loadMacBinding = () => require('@napi-rs/keyring') }) {
  const fixed = normalizedScope(scope);
  if (typeof assertProfileLease !== 'function') throw fail();
  const digest = createHash('sha256').update(JSON.stringify(fixed)).digest('hex');
  const target = 'TeacherVaultLedgerV1-' + digest; let windows, mac;
  function backend() {
    if (platform === 'win32') {
      windows ??= loadWindowsBinding?.(); if (typeof windows?.read !== 'function' || typeof windows?.write !== 'function') throw fail();
      return { read: () => windows.read(target), write: bytes => windows.write(target, bytes) };
    }
    if (platform === 'darwin') {
      const binding = loadMacBinding(); if (typeof binding?.AsyncEntry !== 'function') throw fail();
      mac ??= new binding.AsyncEntry('TeacherVaultLedgerV1', 'scope-' + digest);
      return { read: async () => { const v = await mac.getSecret(); if (v === null) return null; if (!Array.isArray(v) || v.length > LIMIT || v.some(x => !Number.isInteger(x) || x < 0 || x > 255)) throw fail(); return Buffer.from(v); }, write: bytes => mac.setSecret(bytes) };
    }
    throw fail();
  }
  async function read() {
    try { if (assertProfileLease() !== undefined) throw fail(); const value = await backend().read(); if (assertProfileLease() !== undefined) throw fail(); return value === null ? null : decode(fixed, value); } catch { throw fail(); }
  }
  async function compareAndSwap(expected, next) {
    try {
      if (assertProfileLease() !== undefined) throw fail(); const wanted = expected === null ? null : ledgerBytes(fixed, expected), output = ledgerBytes(fixed, next);
      transition(wanted === null ? null : decode(fixed, wanted), decode(fixed, output));
      const current = await read(), actual = current === null ? null : ledgerBytes(fixed, current);
      if ((wanted === null) !== (actual === null) || (wanted && (wanted.length !== actual.length || !timingSafeEqual(wanted, actual)))) throw fail();
      if (assertProfileLease() !== undefined) throw fail();
      if (actual && actual.equals(output)) return;
      await backend().write(output);
      if (assertProfileLease() !== undefined) throw fail();
      const after = await read();
      if (assertProfileLease() !== undefined) throw fail();
      if (!after || !ledgerBytes(fixed, after).equals(output)) throw fail();
    } catch { throw fail(); }
  }
  return Object.freeze({ read, compareAndSwap });
}
module.exports = { createProtectedRevisionLedger, ledgerBytes, decodeLedger: decode };
