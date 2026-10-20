const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
// Write/read-back before atomic replacement; a failed write preserves the previous approval.
async function atomicJSON(destination, value) {
  const text = JSON.stringify(value, null, 2) + '\n';
  const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
  try {
    const file = await fs.open(temporary, 'wx', 0o600);
    try { await file.writeFile(text, 'utf8'); await file.sync(); } finally { await file.close(); }
    if (await fs.readFile(temporary, 'utf8') !== text) throw new Error('Local approval write verification failed.');
    await fs.rename(temporary, destination);
  } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
}
async function verifyArtifact(approval, file, hash) {
  const info = await fs.stat(file);
  const expected = approval.candidate.artifact;
  if (!info.isFile() || path.basename(file) !== expected.name || info.size !== expected.bytes || await hash(file) !== expected.sha512) {
    throw new Error('Installer filename, size or SHA-512 does not match the candidate. Nothing was approved or published.');
  }
}
async function assertPreviewDestination(destination, protectedFiles, platform = process.platform) {
  if (path.extname(destination).toLowerCase() !== '.json') throw new Error('Choose a separate .json preview file.');
  async function canonical(file) {
    const resolved = await fs.realpath(file).catch(error => { if (error.code === 'ENOENT') return path.resolve(file); throw error; });
    return platform === 'win32' ? resolved.toLowerCase() : resolved;
  }
  const target = await canonical(destination);
  for (const file of protectedFiles) if (target === await canonical(file)) throw new Error('Choose a separate .json preview file.');
}
module.exports = { atomicJSON, verifyArtifact, assertPreviewDestination };
