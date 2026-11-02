// Isolated synthetic receipt metadata only; no master or recovery secret.
const { randomBytes } = require('node:crypto');
const assert = require('node:assert/strict');
if (process.platform !== 'win32') { console.log('Windows native credential-ledger probe requires a Windows runner.'); process.exit(0); }
const native = require('../electron/generated/windowsCredentialLedger.node');
const target = 'TeacherVaultLedgerQAV1-' + randomBytes(32).toString('hex');
try {
  assert.equal(native.read(target), null);
  const receipt = Buffer.from(JSON.stringify({ synthetic: true, revision: 1, hash: 'a'.repeat(64) }));
  native.write(target, receipt); assert.deepEqual(native.read(target), receipt);
  assert.throws(() => native.write(target, Buffer.alloc(2049)));
  assert.throws(() => native.read(target + '\0'));
  assert.throws(() => native.removeSynthetic('TeacherVaultLedgerV1-' + 'a'.repeat(64)));
  console.log('PASS Windows native local-persistence ledger: scoped synthetic read/write, bounds and cleanup restrictions.');
} finally { native.removeSynthetic(target); }
