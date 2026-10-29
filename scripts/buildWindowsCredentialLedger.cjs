// Reversible native build only. No credential API calls or user provisioning.
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
if (process.platform !== 'win32') { console.log('Windows revision-ledger binding: native build applies only to Windows.'); process.exit(0); }
let tool;
for (const name of ['@electron/node-gyp/bin/node-gyp.js', 'node-gyp/bin/node-gyp.js']) {
  try { tool = require.resolve(name); break; } catch {}
}
if (!tool) throw Error('Native Node-API build tooling is unavailable; protected ledger activation remains blocked.');
const root = path.resolve(__dirname, '..');
execFileSync(process.execPath, [tool, 'rebuild', '--directory', path.join(root, 'native'), '--release'], { stdio: 'inherit', shell: false });
const binary = path.join(root, 'native', 'build', 'Release', 'windowsCredentialLedger.node');
if (!fs.statSync(binary).isFile()) throw Error('Protected ledger native binding was not built.');
const destination = path.join(root, 'electron', 'generated'); fs.mkdirSync(destination, { recursive: true });
fs.copyFileSync(binary, path.join(destination, 'windowsCredentialLedger.node'));
