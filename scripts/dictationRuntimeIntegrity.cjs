const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const REVISION = 'a8d002cfd879315632a579e73f0148d06959de36';
function fingerprint(file) {
  const bytes = fs.readFileSync(file);
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
function verifyFinal(root, architecture, receipt, run = execFileSync) {
  const { manifest, executable } = inspect(root, 'darwin', architecture);
  if (!receipt || receipt.stage !== 'afterSign' || JSON.stringify(receipt.source) !== JSON.stringify(manifest)) throw new Error('Missing or mismatched signing receipt.');
  equal(fingerprint(executable), receipt.final);
  verifyMac(executable, architecture, run);
  return { manifest, executable };
}
module.exports = { fingerprint, equal, inspect, verifyMac, verifyFinal };
