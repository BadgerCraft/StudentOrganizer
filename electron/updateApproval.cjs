// Local preparation contract. Deliberately no network client or publishing authority.
const { version, isNewer } = require('./manualUpdater.cjs');
const { validateManifest } = require('./windowsInstallerUpdate.cjs');
const PRODUCT = 'StudentOrganizer';
const MODE = 'local-preview-only';
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw new Error('Unexpected fields in local approval data.');
}
function candidate(value) {
  exact(value, ['schemaVersion', 'product', 'version', 'arch', 'sourceCommit', 'artifact']);
  if (value.schemaVersion !== 1 || value.product !== PRODUCT || !['x64', 'arm64'].includes(value.arch) ||
      typeof value.version !== 'string' || value.version.startsWith('v') ||
      typeof value.sourceCommit !== 'string' || !/^[a-f0-9]{40}$/.test(value.sourceCommit)) throw new Error('Invalid candidate identity.');
  version(value.version);
  exact(value.artifact, ['name', 'bytes', 'sha512']);
  const artifact = value.artifact;
  if (artifact.name !== `OntarioTeacherAssessment-${value.version}-${value.arch}-nsis.exe` ||
      !Number.isSafeInteger(artifact.bytes) || artifact.bytes < 1 || artifact.bytes > 4 * 1024 ** 3 ||
      typeof artifact.sha512 !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(artifact.sha512) ||
      Buffer.from(artifact.sha512, 'base64').toString('base64') !== artifact.sha512) throw new Error('Invalid NSIS artifact identity, size or SHA-512.');
  return structuredClone(value);
}
function timestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error('Invalid approval time.');
}
function evidence(value) {
  exact(value, ['notes', 'at']); timestamp(value.at);
  if (typeof value.notes !== 'string' || value.notes.trim().length < 12 || value.notes.length > 2000) throw new Error('Record the exact tested build and verification evidence (12–2000 characters).');
}
function state(value) {
  exact(value, ['candidate', 'status', 'test', 'approvedAt']); candidate(value.candidate);
  if (!['candidate', 'tested', 'approved', 'revoked'].includes(value.status)) throw new Error('Invalid approval state.');
  if (value.status === 'candidate') {
    if (value.test !== null || value.approvedAt !== null) throw new Error('Untested candidate cannot carry approval.');
  } else {
    evidence(value.test);
    if (value.status === 'tested' && value.approvedAt !== null) throw new Error('Tested candidate is not approved.');
    if (value.status === 'approved' || value.status === 'revoked') {
      timestamp(value.approvedAt);
      if (Date.parse(value.approvedAt) < Date.parse(value.test.at)) throw new Error('Approval predates verification.');
    }
  }
  return structuredClone(value);
}
function prepare(value) { return { candidate: candidate(value), status: 'candidate', test: null, approvedAt: null }; }
function recordTest(value, notes, at = new Date().toISOString()) {
  const next = state(value);
  if (!['candidate', 'tested'].includes(next.status)) throw new Error('Import the candidate again to retest an approved or revoked version.');
  next.test = { notes: notes.trim(), at }; evidence(next.test); next.status = 'tested'; return next;
}
function approve(value, at = new Date().toISOString()) {
  const next = state(value);
  if (next.status !== 'tested') throw new Error('Only a tested candidate may be approved locally.');
  next.status = 'approved'; next.approvedAt = at; return state(next);
}
function revoke(value) {
  const next = state(value);
  if (next.status !== 'approved') throw new Error('Only an approved candidate may be revoked.');
  next.status = 'revoked'; return next;
}
function exportPreview(value) { return { schemaVersion: 1, mode: MODE, publicationReady: false, approval: state(value) }; }
function previewOffer(feed, current, arch, mode = MODE) {
  // Never enable a generic/local feed in production by changing a URL or passing a flag.
  if (mode !== MODE) throw new Error('Local approvals cannot authorize live distribution.');
  exact(feed, ['schemaVersion', 'mode', 'publicationReady', 'approval']);
  if (feed.schemaVersion !== 1 || feed.mode !== MODE || feed.publicationReady !== false) throw new Error('Not a local preview feed.');
  const value = state(feed.approval), c = value.candidate;
  if (value.status !== 'approved' || c.arch !== arch || !isNewer(c.version, current)) return null;
  const manifest = { version: c.version, files: [{ url: c.artifact.name, sha512: c.artifact.sha512, size: c.artifact.bytes }] };
  validateManifest(manifest, current, arch);
  return { mode: MODE, release: { draft: false, prerelease: false, tag_name: `v${c.version}`,
    html_url: `https://github.com/BadgerCraft/StudentOrganizer/releases/tag/v${c.version}` }, manifest };
}
module.exports = { MODE, candidate, state, prepare, recordTest, approve, revoke, exportPreview, previewOffer };
