const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { inspect, fingerprint, equal, verifyFinal } = require('./dictationRuntimeIntegrity.cjs');
const root = path.resolve(process.argv[2] || 'dictation-runtime');
const architecture = process.env.QA_ARCH || process.arch;
const receiptPath = process.argv[3];
const { manifest, executable } = process.platform === 'darwin' && receiptPath
  ? verifyFinal(root, architecture, JSON.parse(fs.readFileSync(receiptPath, 'utf8')))
  : inspect(root, process.platform, architecture);
// Unsigned/source and Windows paths must retain their exact prepared bytes.
if (!(process.platform === 'darwin' && receiptPath)) equal(fingerprint(executable), manifest);
// --help tests loading without microphone, model, audio files or network.
execFileSync(executable, ['--help'], { stdio: 'pipe', timeout: 10000, windowsHide: true });
console.log(JSON.stringify({ result: 'PASS', platform: manifest.platform, architecture, source: { bytes: manifest.bytes, sha256: manifest.sha256 }, final: fingerprint(executable), microphone: 'not opened', recognition: 'not tested' }));
