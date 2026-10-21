// Approval-to-delivery boundary: fixed public repository; no token, service or publisher client.
const https = require('node:https');
const { state } = require('./updateApproval.cjs');
const { version, releaseUrl, requestLatest } = require('./manualUpdater.cjs');
const REPO = 'https://github.com/BadgerCraft/StudentOrganizer';
const API = 'https://api.github.com/repos/BadgerCraft/StudentOrganizer';
const approvalName = arch => {
  if (!['x64', 'arm64'].includes(arch)) throw new Error('Unsupported update architecture.');
  return `student-organizer-approval-${arch}.json`;
};
function signaturePolicy(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Missing native signature policy.');
  if (value.signature === 'unsigned' && Object.keys(value).join(',') === 'signature') return { signature: 'unsigned' };
  if (value.signature === 'valid' && Object.keys(value).sort().join(',') === 'publisher,signature' &&
      typeof value.publisher === 'string' && value.publisher.trim() && value.publisher.length <= 512) return { signature: 'valid', publisher: value.publisher };
  throw new Error('Invalid native signature policy.');
}
function record(value) {
  if (!value || Object.keys(value).sort().join(',') !== 'approval,mode,schemaVersion,signature' || value.schemaVersion !== 1 || value.mode !== 'approved-release') throw new Error('Not approved release metadata.');
  const checked = state(value.approval);
  if (checked.status !== 'approved') throw new Error('Release has no active owner approval.');
  return { schemaVersion: 1, mode: 'approved-release', approval: checked, signature: signaturePolicy(value.signature) };
}
function preparePublication(approval, signature, acknowledgeUnsigned = false) {
  const native = signaturePolicy(signature);
  if (native.signature === 'unsigned' && acknowledgeUnsigned !== true) throw new Error('Explicit owner acknowledgement is required to prepare an unsigned installer.');
  const document = record({ schemaVersion: 1, mode: 'approved-release', approval, signature: native });
  const c = document.approval.candidate;
  // JSON is also valid YAML; quoting prevents titles/filenames being interpreted as YAML syntax.
  const manifest = { version: c.version, files: [{ url: c.artifact.name, sha512: c.artifact.sha512, size: c.artifact.bytes }],
    path: c.artifact.name, sha512: c.artifact.sha512 };
  return { document, approvalFilename: approvalName(c.arch), manifest,
    files: { [approvalName(c.arch)]: JSON.stringify(document, null, 2) + '\n', 'latest.yml': JSON.stringify(manifest, null, 2) + '\n' },
    tag: `v${c.version}`, sourceCommit: c.sourceCommit, artifactName: c.artifact.name };
}
function assetURL(release, name) {
  const assets = release.assets;
  if (!Array.isArray(assets)) throw new Error('Missing release assets.');
  const matches = assets.filter(asset => asset.name === name);
  if (matches.length !== 1 || matches[0].state !== 'uploaded') throw new Error('Required release asset is missing or ambiguous.');
  const expected = `${REPO}/releases/download/${release.tag_name}/${name}`;
  if (matches[0].browser_download_url !== expected) throw new Error('Untrusted release artifact origin.');
  return matches[0];
}
function validatePublished(release, document, arch) {
  const checked = record(document), c = checked.approval.candidate;
  version(c.version); releaseUrl(release.html_url, release.tag_name);
  if (release.draft !== false || release.prerelease !== false || release.tag_name !== `v${c.version}` ||
      release.target_commitish !== c.sourceCommit || c.arch !== arch) throw new Error('Release identity does not match owner approval.');
  assetURL(release, approvalName(arch)); assetURL(release, 'latest.yml');
  const installer = assetURL(release, c.artifact.name);
  if (installer.size !== c.artifact.bytes) throw new Error('Published artifact size does not match approval.');
  return checked;
}
function assertManifest(document, info, arch) {
  const checked = record(document), c = checked.approval.candidate;
  if (c.arch !== arch || info.version !== c.version || info.files?.length !== 1 ||
      info.files[0].url !== c.artifact.name || info.files[0].sha512 !== c.artifact.sha512 || info.files[0].size !== c.artifact.bytes) throw new Error('Update manifest does not match the approved exact artifact.');
  return checked;
}
function assertSignature(document, inspected) {
  const expected = record(document).signature;
  if (expected.signature !== inspected.signature || (expected.signature === 'valid' && expected.publisher !== inspected.publisher)) throw new Error('Installer publisher does not match owner approval.');
}
function redirectAllowed(raw, original) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return false;
    return url.href === original || ['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(url.hostname);
  } catch { return false; }
}
function readJSON(url, { asset = false } = {}) {
  // Callers construct fixed repository URLs; redirected assets may use GitHub's signed CDN URLs.
  const stable = '(?:0|[1-9]\\d{0,8})\\.(?:0|[1-9]\\d{0,8})\\.(?:0|[1-9]\\d{0,8})';
  const allowed = new RegExp(`^https://(?:api\\.github\\.com/repos/BadgerCraft/StudentOrganizer/(?:releases/tags/v${stable}|git/ref/tags/v${stable}|git/tags/[a-f0-9]{40})|github\\.com/BadgerCraft/StudentOrganizer/releases/download/v${stable}/student-organizer-approval-(?:x64|arm64)\\.json)$`);
  if (!allowed.test(url)) return Promise.reject(new Error('Untrusted approval endpoint.'));
  return new Promise((resolve, reject) => {
    let active, settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => { const error = new Error('Approval lookup timed out.'); finish(error); active?.destroy(error); }, 10000);
    function get(destination, redirects) {
      if (settled) return;
      const request = https.get(destination, { timeout: 10000, headers: { Accept: asset ? 'application/octet-stream' : 'application/vnd.github+json', 'User-Agent': 'StudentOrganizer-explicit-approved-update' } }, response => {
        if (settled) { response.destroy(); return; }
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          response.destroy();
          let next; try { next = new URL(response.headers.location, destination).href; } catch { finish(new Error('Invalid asset redirect.')); return; }
          if (redirects >= 3 || !redirectAllowed(next, url)) { finish(new Error('Untrusted asset redirect.')); return; }
          get(next, redirects + 1); return;
        }
        if (response.statusCode === 404) { response.destroy(); finish(null, null); return; }
        if (response.statusCode !== 200) { response.destroy(); finish(new Error('Approval unavailable.')); return; }
        let bytes = 0, chunks = [];
        response.on('data', chunk => { bytes += chunk.length; if (bytes > 128 * 1024) { const error = new Error('Approval response too large.'); finish(error); response.destroy(error); } else chunks.push(Buffer.from(chunk)); });
        response.on('error', error => finish(error)); response.on('aborted', () => finish(new Error('Approval response interrupted.')));
        response.on('end', () => { try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { finish(new Error('Invalid approval response.')); } });
      });
      active = request;
      request.on('error', error => { if (active === request) finish(error); }); request.on('timeout', () => { if (active !== request) return; const error = new Error('Approval transport timed out.'); finish(error); request.destroy(error); });
    }
    try { get(url, 0); } catch (error) { finish(error); }
  });
}
function createLookup({ latest = requestLatest, read = readJSON } = {}) {
  async function resolve(release, arch) {
    if (!release) return null;
    version(release.tag_name); releaseUrl(release.html_url, release.tag_name);
    if (release.draft !== false || release.prerelease !== false) throw new Error('Release is not stable.');
    if (!Array.isArray(release.assets) || !release.assets.some(a => a.name === approvalName(arch))) return null;
    const metadata = assetURL(release, approvalName(arch));
    const document = await read(metadata.browser_download_url, { asset: true });
    if (!document) return null;
    const checked = validatePublished(release, document, arch);
    let target = await read(`${API}/git/ref/tags/${release.tag_name}`);
    target = target?.object;
    for (let depth = 0; target?.type === 'tag' && depth < 3; depth++) {
      if (typeof target.sha !== 'string' || !/^[a-f0-9]{40}$/.test(target.sha)) throw new Error('Invalid annotated release tag.');
      target = (await read(`${API}/git/tags/${target.sha}`))?.object;
    }
    if (target?.type !== 'commit' || target.sha !== checked.approval.candidate.sourceCommit) throw new Error('Published tag does not resolve to the approved source commit.');
    return { release, document: checked };
  }
  return {
    latest: async arch => resolve(await latest(), arch),
    version: async (value, arch) => { version(value); return resolve(await read(`${API}/releases/tags/v${value}`), arch); }
  };
}
const lookupLatestApproved = arch => createLookup().latest(arch);
const lookupVersionApproved = (value, arch) => createLookup().version(value, arch);
module.exports = { approvalName, signaturePolicy, record, preparePublication, assetURL, validatePublished, assertManifest, assertSignature,
  redirectAllowed, readJSON, createLookup, lookupLatestApproved, lookupVersionApproved };
