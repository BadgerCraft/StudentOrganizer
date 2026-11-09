import { expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const delivery = require('../../electron/githubReleaseDelivery.cjs');
const sourceCommit = '1'.repeat(40);
const hash = Buffer.alloc(64, 2).toString('base64');
const name = 'OntarioTeacherAssessment-1.0.2-x64-nsis.exe';
const release = (platform = 'win32', arch = 'x64') => {
  const identity = delivery.identity('1.0.2', arch, platform);
  return { draft: false, prerelease: false, tag_name: 'v1.0.2', target_commitish: 'main',
    html_url: 'https://github.com/BadgerCraft/StudentOrganizer/releases/tag/v1.0.2',
    assets: [identity.name, identity.manifest].map(name => ({ name, state: 'uploaded', size: 128,
      browser_download_url: `https://github.com/BadgerCraft/StudentOrganizer/releases/download/v1.0.2/${name}` })) };
};
const document = () => ({ mode: 'github-release', version: '1.0.2', platform: 'win32', arch: 'x64', sourceCommit, artifact: { name, bytes: 128 } });
const manifest = () => ({ version: '1.0.2', files: [{ url: name, size: 128, sha512: hash }] });
const signer = () => ({ signature: 'valid', publisher: 'CN=FICTIONAL', certificateSha256: 'ab'.repeat(32) });
const reader = async () => ({ object: { type: 'commit', sha: sourceCommit } });
it('discovers a standard published GitHub release without Control Panel metadata and resolves its source', async () => {
  const calls: string[] = [];
  const lookup = delivery.createLookup({ latest: async () => release(), read: async (url: string) => { calls.push(url); return reader(); } });
  expect((await lookup.latest('x64')).document).toEqual(document());
  expect(calls).toEqual(['https://api.github.com/repos/BadgerCraft/StudentOrganizer/git/ref/tags/v1.0.2']);
  expect(delivery.assertManifest(document(), manifest(), 'x64')).toEqual({ ...document(), artifact: { ...document().artifact, sha512: hash } });
});
it('requires platform-specific installer and metadata assets, never presents Windows bytes as a Mac update', async () => {
  for (const platform of ['win32', 'darwin']) for (const arch of ['x64', 'arm64']) {
    const lookup = delivery.createLookup({ latest: async () => release(platform, arch), read: reader });
    expect((await lookup.latest(arch, platform)).document).toMatchObject({ platform, arch, sourceCommit });
    expect(await lookup.latest(arch, platform === 'win32' ? 'darwin' : 'win32')).toBeNull();
  }
  expect(await delivery.createLookup({ latest: async () => null }).latest('x64')).toBeNull();
  expect(await delivery.createLookup({ latest: async () => ({ ...release(), assets: [] }) }).latest('x64')).toBeNull();
});
it('rejects nonstable, foreign, ambiguous or incomplete release identities', async () => {
  const good = release();
  for (const changed of [
    { draft: true }, { prerelease: true }, { tag_name: 'v1.0.2-beta.1' }, { tag_name: '1.0.2' },
    { html_url: 'https://github.com/other/StudentOrganizer/releases/tag/v1.0.2' },
    { assets: [...good.assets, good.assets[0]] }, { assets: good.assets.map(a => ({ ...a, state: 'new' })) },
    { assets: good.assets.map(a => ({ ...a, browser_download_url: 'https://evil.example/file' })) },
    { assets: good.assets.map(a => ({ ...a, size: 0 })) }, { target_commitish: '2'.repeat(40) },
  ]) await expect(delivery.createLookup({ latest: async () => ({ ...good, ...changed }), read: reader }).latest('x64')).rejects.toThrow();
  for (const arch of ['ia32', '../x64']) await expect(delivery.createLookup({ latest: async () => good, read: reader }).latest(arch)).rejects.toThrow();
});
it('resolves annotated tags and rejects missing, malformed, cyclic or over-depth source targets', async () => {
  const annotated = delivery.createLookup({ latest: async () => release(), read: async (url: string) =>
    url.includes('/git/ref/') ? { object: { type: 'tag', sha: '2'.repeat(40) } } : reader() });
  expect((await annotated.latest('x64')).document.sourceCommit).toBe(sourceCommit);
  for (const object of [undefined, { type: 'tree', sha: sourceCommit }, { type: 'commit', sha: 'bad' }, { type: 'tag', sha: '2'.repeat(40) }]) {
    await expect(delivery.createLookup({ latest: async () => release(), read: async () => ({ object }) }).latest('x64')).rejects.toThrow();
  }
  let reads = 0;
  await expect(delivery.createLookup({ latest: async () => release(), read: async () => ({ object: { type: 'tag', sha: String(++reads).repeat(40) } }) }).latest('x64')).rejects.toThrow();
  expect(reads).toBe(4);
});
it('pins version-specific requests and rejects altered manifest identity, sizes, hashes and downgrade-like substitutions', async () => {
  const lookup = delivery.createLookup({ read: async (url: string) => url.includes('/releases/') ? release() : reader() });
  expect((await lookup.version('1.0.2', 'x64')).document.version).toBe('1.0.2');
  await expect(lookup.version('1.0.3', 'x64')).rejects.toThrow(/changed/);
  await expect(lookup.version('../main', 'x64')).rejects.toThrow();
  const good = manifest();
  for (const changed of [ { version: '1.0.1' }, { stagingPercentage: 50 }, { packages: {} }, { files: [] },
    { files: [...good.files, good.files[0]] }, ...[ { url: 'https://evil.example/installer.exe' }, { size: 129 },
      { sha512: undefined }, { sha512: 'bad' }, { sha512: 'A'.repeat(85) + 'B==' } ].map(p => ({ files: [{ ...good.files[0], ...p }] })) ]) {
    expect(() => delivery.assertManifest(document(), { ...good, ...changed }, 'x64')).toThrow();
  }
  expect(() => delivery.assertManifest(document(), good, 'arm64')).toThrow();
  const pinned = delivery.assertManifest(document(), good, 'x64');
  expect(() => delivery.assertManifest(pinned, { ...good, files: [{ ...good.files[0], sha512: Buffer.alloc(64, 3).toString('base64') }] }, 'x64')).toThrow();
});
it('requires the current installed trusted certificate, not an unsigned approval, matching name or remote signature claim', () => {
  expect(() => delivery.assertSignature(document(), signer(), signer())).not.toThrow();
  expect(() => delivery.assertSignature(null, signer(), signer())).not.toThrow();
  expect(() => delivery.assertSignature(null, { signature: 'unsigned' }, { signature: 'unsigned' })).toThrow();
  expect(() => delivery.assertSignature(document(), { ...signer(), certificateSha256: signer().certificateSha256.toUpperCase() }, signer())).not.toThrow();
  for (const changed of [undefined, { signature: 'unsigned' }, { ...signer(), publisher: 'CN=Other' },
    { ...signer(), certificateSha256: 'cd'.repeat(32) }, { ...signer(), certificateSha256: undefined }, { ...signer(), certificateSha256: 'bad' }]) {
    expect(() => delivery.assertSignature(document(), changed, signer())).toThrow();
    expect(() => delivery.assertSignature(document(), signer(), changed)).toThrow();
  }
  expect(() => delivery.assertSignature({ ...document(), mode: 'approved-release' }, signer(), signer())).toThrow();
});

it('bounds the complete lookup, prevents late chained requests and allows a fresh retry', async () => {
  vi.useFakeTimers();
  let finish: (value: unknown) => void = () => {};
  const read = vi.fn(async () => reader());
  let hang = true;
  const lookup = delivery.createLookup({ latest: () => hang ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(release()), read, lookupTimeout: 30000 });
  try {
    const result = lookup.latest('x64').catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(30000);
    expect((await result).message).toMatch(/timed out/);
    finish(release()); await Promise.resolve(); await Promise.resolve();
    expect(read).not.toHaveBeenCalled();
    hang = false;
    expect((await lookup.latest('x64')).document).toEqual(document());
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
