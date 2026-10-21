const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(process.argv[2] || 'dictation-runtime');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
if (manifest.revision !== 'a8d002cfd879315632a579e73f0148d06959de36' || manifest.platform !== process.platform || manifest.modelBundled !== false) throw new Error('Wrong packaged speech runtime provenance.');
const executable = path.join(root, process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli');
if (fs.statSync(executable).size !== manifest.bytes) throw new Error('Packaged runtime size changed.');
fs.accessSync(path.join(root, 'LICENSE'));
// --help tests packaged binary loading without microphone, model, input, output files or network.
execFileSync(executable, ['--help'], { stdio: 'pipe', timeout: 10000, windowsHide: true });
console.log(JSON.stringify({ result: 'PASS', platform: manifest.platform, architecture: manifest.architecture, bytes: manifest.bytes, microphone: 'not opened', recognition: 'not tested' }));
