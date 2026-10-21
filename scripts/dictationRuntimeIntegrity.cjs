const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const REVISION = 'a8d002cfd879315632a579e73f0148d06959de36';
function fingerprint(file) {
  const bytes = Buffer.isBuffer(file) ? file : fs.readFileSync(file);
  return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
function equal(actual, expected) {
  if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) throw new Error('Speech runtime bytes/hash changed.');
}
function inspect(root, platform, architecture) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  if (manifest.engine !== 'whisper.cpp' || manifest.version !== '1.7.6' || manifest.revision !== REVISION || manifest.platform !== platform || manifest.architecture !== architecture || manifest.modelBundled !== false || !/^[a-f0-9]{64}$/.test(manifest.sha256)) throw new Error('Wrong packaged speech runtime provenance.');
  fs.accessSync(path.join(root, 'LICENSE'));
  return { manifest, executable: path.join(root, platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli') };
}
function verifyMac(executable, architecture, run = execFileSync) {
  const expected = { arm64: 'arm64', x64: 'x86_64' }[architecture];
  if (!expected) throw new Error('Unsupported speech runtime architecture.');
  const actual = run('/usr/bin/lipo', ['-archs', executable], { encoding: 'utf8' }).trim();
  if (actual !== expected) throw new Error('Wrong signed speech runtime architecture.');
  run('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', executable], { stdio: 'pipe' });
}
// Delegate Mach-O rewriting to Apple's signing tool, not a permissive custom
// parser. On disposable copies, first give BOTH inputs the same signature policy
// (also handles unsigned x64 input), then remove it. Compare ALL remaining bytes,
// including load commands, instructions, constants and link-edit data. Fail closed
// if Apple's normalization ever leaves different padding/layout. Never mutate the
// packaged executable or infer identity from a valid signature/architecture alone.
function compareMacCode(prepared, signed, run = execFileSync) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dictation-code-'));
  try {
    const normalized = [prepared, signed].map((bytes, index) => {
      const file = path.join(dir, `runtime-${index}`);
      fs.writeFileSync(file, bytes, { mode: 0o700 });
      run('/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', 'ca.on.teacher.dictation-integrity', '--timestamp=none', file], { stdio: 'pipe' });
      run('/usr/bin/codesign', ['--remove-signature', file], { stdio: 'pipe' });
      return fingerprint(file);
    });
    equal(normalized[0], normalized[1]);
    return { method: 'apple-codesign-normalize-remove-v1', ...normalized[0] };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
function verifyFinal(root, architecture, receipt, run = execFileSync) {
  const { manifest, executable } = inspect(root, 'darwin', architecture);
  if (!receipt || receipt.stage !== 'afterSign' || JSON.stringify(receipt.source) !== JSON.stringify(manifest)) throw new Error('Missing or mismatched signing receipt.');
  equal(fingerprint(executable), receipt.final);
  verifyMac(executable, architecture, run);
  return { manifest, executable };
}
module.exports = { fingerprint, equal, inspect, verifyMac, verifyFinal, compareMacCode };
