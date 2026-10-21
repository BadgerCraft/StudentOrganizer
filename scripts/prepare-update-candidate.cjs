// Read-only artifact inspection plus a new local descriptor. Never uploads or runs a file.
const fs = require('node:fs/promises');
const path = require('node:path');
const { candidate } = require('../electron/updateApproval.cjs');
const { hashFile } = require('../electron/windowsInstallerUpdate.cjs');
async function main() {
  const [file, version, arch, sourceCommit, destination, ...extra] = process.argv.slice(2);
  if (!destination || extra.length) throw new Error('Usage: node scripts/prepare-update-candidate.cjs INSTALLER VERSION ARCH SOURCE_COMMIT NEW_JSON_FILE');
  const info = await fs.stat(file);
  if (!info.isFile()) throw new Error('Select an NSIS installer file.');
  const value = candidate({ schemaVersion: 1, product: 'StudentOrganizer', version, arch, sourceCommit,
    artifact: { name: path.basename(file), bytes: info.size, sha512: await hashFile(file) } });
  await fs.writeFile(destination, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  process.stdout.write('Local candidate descriptor written. No approval or publication occurred.\n');
}
main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
