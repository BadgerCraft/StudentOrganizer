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
async function preparePublicationBundle(root, preparation, source, hash) {
  const candidate = preparation.document.approval.candidate;
  const staging = await fs.mkdtemp(path.join(root, '.owner-release-preparation-'));
  const destination = path.join(root, `StudentOrganizer-release-${candidate.version}-${candidate.arch}-${crypto.randomUUID()}`);
  try {
    const copied = path.join(staging, candidate.artifact.name);
    await fs.copyFile(source, copied, require('node:fs').constants.COPYFILE_EXCL);
    await verifyArtifact(preparation.document.approval, copied, hash);
    for (const [name, contents] of Object.entries(preparation.files)) await fs.writeFile(path.join(staging, name), contents, { flag: 'wx', mode: 0o600 });
    const instructions = `LOCAL PUBLICATION PREPARATION ONLY — NOTHING PUBLISHED\n\nApproved version ${candidate.version}, Windows ${candidate.arch}.\nExact source commit: ${candidate.sourceCommit}\nCreate a stable GitHub release in BadgerCraft/StudentOrganizer with tag v${candidate.version}, target_commitish set to that exact commit, and these exact three assets: ${candidate.artifact.name}, latest.yml, ${preparation.approvalFilename}.\nDo not replace or regenerate the approved installer. Publishing requires separate owner approval. Only one Windows architecture is supported by this single-file latest.yml.\nSignature policy: ${JSON.stringify(preparation.document.signature)}. Unsigned packages still require explicit teacher acknowledgement; this is not publisher verification.\nRevoking locally cannot retract already published assets; do not publish a revoked preparation. Recheck current local approval and these bytes immediately before any separately authorized publication.\n`;
    await fs.writeFile(path.join(staging, 'PUBLICATION-INSTRUCTIONS.txt'), instructions, { flag: 'wx', mode: 0o600 });
    await fs.rename(staging, destination);
    return destination;
  } catch (error) { await fs.rm(staging, { recursive: true, force: true }); throw error; }
}
module.exports = { atomicJSON, verifyArtifact, assertPreviewDestination, preparePublicationBundle };
