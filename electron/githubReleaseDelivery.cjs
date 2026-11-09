// Direct stable-release discovery. GitHub supplies distribution metadata; native
// signatures anchored to the installed application supply publisher authenticity.
// No Control Panel state, arbitrary feed, account token or classroom data is used.
const { version, releaseUrl, requestLatest } = require('./manualUpdater.cjs');
const { assetURL, readJSON } = require('./releaseDelivery.cjs');
const API = 'https://api.github.com/repos/BadgerCraft/StudentOrganizer';
const COMMIT = /^[a-f0-9]{40}$/;
function identity(value, arch, platform = 'win32') {
  if (typeof value !== 'string' || value.startsWith('v')) throw new Error('Invalid release version.');
  version(value);
  if (!['x64', 'arm64'].includes(arch) || !['win32', 'darwin'].includes(platform)) throw new Error('Unsupported release platform.');
  return { version: value, arch, platform,
    name: platform === 'win32' ? `OntarioTeacherAssessment-${value}-${arch}-nsis.exe` : `OntarioTeacherAssessment-${value}-mac-${arch}.zip`,
    manifest: platform === 'win32' ? 'latest.yml' : 'latest-mac.yml' };
}
function record(value) {
  if (!value || value.mode !== 'github-release') throw new Error('Invalid direct release identity.');
  const expected = identity(value.version, value.arch, value.platform);
  if (typeof value.sourceCommit !== 'string' || !COMMIT.test(value.sourceCommit) ||
      !value.artifact || value.artifact.name !== expected.name || !Number.isSafeInteger(value.artifact.bytes) ||
      value.artifact.bytes < 1 || value.artifact.bytes > 4 * 1024 ** 3) throw new Error('Invalid direct release artifact.');
  const artifact = { name: expected.name, bytes: value.artifact.bytes };
  if (value.artifact.sha512 !== undefined) {
    const hash = value.artifact.sha512;
    if (typeof hash !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(hash) || Buffer.from(hash, 'base64').toString('base64') !== hash) throw new Error('Invalid artifact checksum.');
    artifact.sha512 = hash;
  }
  return { mode: 'github-release', version: expected.version, arch: expected.arch, platform: expected.platform,
    sourceCommit: value.sourceCommit, artifact };
}
function assertManifest(document, info, arch) {
  const checked = record(document), a = checked.artifact;
  if (checked.platform !== 'win32' || arch !== checked.arch || !info || info.version !== checked.version ||
      info.stagingPercentage !== undefined || info.packages || !Array.isArray(info.files) || info.files.length !== 1 ||
      info.files[0].url !== a.name || info.files[0].size !== a.bytes || typeof info.files[0].sha512 !== 'string' ||
      (a.sha512 !== undefined && a.sha512 !== info.files[0].sha512)) throw new Error('Manifest does not match the published installer.');
  // SHA-512 is integrity, not proof of publisher identity. Native verification is mandatory.
  return record({ ...checked, artifact: { ...a, sha512: info.files[0].sha512 } });
}
function assertSignature(document, inspected, installed) {
  // Capability checks have no release document yet; native trust still fails closed.
  if (document !== null) record(document);
  const valid = value => value?.signature === 'valid' && typeof value.publisher === 'string' && value.publisher.trim() &&
    typeof value.certificateSha256 === 'string' && /^[a-fA-F0-9]{64}$/.test(value.certificateSha256);
  if (!valid(installed) || !valid(inspected) || installed.publisher !== inspected.publisher ||
      installed.certificateSha256.toLowerCase() !== inspected.certificateSha256.toLowerCase()) {
    throw new Error('One-click updates require the same trusted signing certificate as the installed application.');
  }
}
function createLookup({ latest = requestLatest, read = readJSON, lookupTimeout = 30000 } = {}) {
  async function bounded(operation) {
    let expired = false, timer;
    const guard = async action => {
      if (expired) throw new Error('Release lookup timed out.');
      const result = await action();
      if (expired) throw new Error('Release lookup timed out.');
      return result;
    };
    try {
      return await Promise.race([
        operation(url => guard(() => read(url)), () => guard(latest)),
        new Promise((_, reject) => { timer = setTimeout(() => { expired = true; reject(new Error('Release lookup timed out.')); }, lookupTimeout); })
      ]);
    } finally { clearTimeout(timer); }
  }
  async function resolve(release, arch, platform, readWithin) {
    if (release === null) return null;
    if (!release || release.draft !== false || release.prerelease !== false || typeof release.tag_name !== 'string' || !release.tag_name.startsWith('v')) throw new Error('Release is not stable.');
    const expected = identity(release.tag_name.slice(1), arch, platform);
    releaseUrl(release.html_url, release.tag_name);
    if (!Array.isArray(release.assets)) throw new Error('Missing release assets.');
    // A release for another platform is not an installable offer on this device.
    if (!release.assets.some(a => a.name === expected.name) || !release.assets.some(a => a.name === expected.manifest)) return null;
    const artifact = assetURL(release, expected.name);
    assetURL(release, expected.manifest);
    let target = (await readWithin(`${API}/git/ref/tags/${release.tag_name}`))?.object;
    const seen = new Set();
    for (let depth = 0; target?.type === 'tag' && depth < 3; depth++) {
      if (typeof target.sha !== 'string' || !COMMIT.test(target.sha) || seen.has(target.sha)) throw new Error('Invalid annotated release tag.');
      seen.add(target.sha);
      target = (await readWithin(`${API}/git/tags/${target.sha}`))?.object;
    }
    if (target?.type !== 'commit' || typeof target.sha !== 'string' || !COMMIT.test(target.sha)) throw new Error('Release tag does not resolve to a source commit.');
    // GitHub target_commitish may be a branch name; only a literal commit can be
    // compared. The tag's resolved commit is authoritative, not today's branch tip.
    if (COMMIT.test(release.target_commitish || '') && release.target_commitish !== target.sha) throw new Error('Release source and tag disagree.');
    return { release, document: record({ mode: 'github-release', ...expected, sourceCommit: target.sha,
      artifact: { name: expected.name, bytes: artifact.size } }) };
  }
  return {
    latest: (arch, platform = 'win32') => bounded(async (readWithin, latestWithin) => resolve(await latestWithin(), arch, platform, readWithin)),
    version: (value, arch, platform = 'win32') => bounded(async readWithin => {
      identity(value, arch, platform);
      const result = await resolve(await readWithin(`${API}/releases/tags/v${value}`), arch, platform, readWithin);
      if (result && result.document.version !== value) throw new Error('Release version changed.');
      return result;
    })
  };
}
const lookupLatest = (arch, platform = 'win32') => createLookup().latest(arch, platform);
const lookupVersion = (value, arch, platform = 'win32') => createLookup().version(value, arch, platform);
module.exports = { identity, record, assertManifest, assertSignature, createLookup, lookupLatest, lookupVersion };
