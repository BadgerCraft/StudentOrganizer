import { expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const approval = require('../../electron/updateApproval.cjs');
const delivery = require('../../electron/releaseDelivery.cjs');
const { preparePublicationBundle } = require('../../apps/control-panel/electron/store.cjs');
const { createManualCheck } = require('../../electron/manualUpdater.cjs');
const { createInstallerUpdate, hashFile, TABLES } = require('../../electron/windowsInstallerUpdate.cjs');
const bytes = Buffer.from('FICTIONAL NON-EXECUTABLE DELIVERY FIXTURE\n');
const c = { schemaVersion: 1, product: 'StudentOrganizer', version: '1.0.2', arch: 'x64', sourceCommit: '81058d87d669ff4cd787b06c25fe84217581f2ad',
  artifact: { name: 'OntarioTeacherAssessment-1.0.2-x64-nsis.exe', bytes: bytes.length, sha512: createHash('sha512').update(bytes).digest('base64') } };
const tested = () => approval.recordTest(approval.prepare(c), 'FICTIONAL integration: exact hash, backup and controlled launcher checks.');
const approved = () => approval.approve(tested());
const prep = () => delivery.preparePublication(approved(), { signature: 'unsigned' }, true);
const release = () => ({ draft: false, prerelease: false, tag_name: 'v1.0.2', target_commitish: c.sourceCommit,
  html_url: 'https://github.com/BadgerCraft/StudentOrganizer/releases/tag/v1.0.2', assets: [c.artifact.name, 'latest.yml', delivery.approvalName('x64')].map(name => ({
    name, state: 'uploaded', size: name === c.artifact.name ? bytes.length : 100,
    browser_download_url: `https://github.com/BadgerCraft/StudentOrganizer/releases/download/v1.0.2/${name}` })) });
it('gates publication preparation on approved state, native signature inspection and explicit unsigned policy', () => {
  for (const value of [approval.prepare(c), tested(), approval.revoke(approved())]) expect(() => delivery.preparePublication(value, { signature: 'unsigned' }, true)).toThrow();
  expect(() => delivery.preparePublication(approved(), { signature: 'unsigned' })).toThrow(/acknowledgement/);
  for (const signature of [{}, { signature: 'invalid' }, { signature: 'valid', publisher: '' }, { signature: 'unsigned', publisher: 'fake' }]) {
    expect(() => delivery.preparePublication(approved(), signature, true)).toThrow();
  }
  const p = prep(); expect(JSON.parse(p.files['latest.yml'])).toMatchObject({ files: [{ url: c.artifact.name, sha512: c.artifact.sha512, size: bytes.length }] });
  expect(p.document.mode).toBe('approved-release');
  expect(() => delivery.record(approval.exportPreview(approved()))).toThrow();
  expect(() => delivery.assertSignature(p.document, { signature: 'valid', publisher: 'other' })).toThrow();
  const signed = delivery.preparePublication(approved(), { signature: 'valid', publisher: 'CN=FICTIONAL' });
  expect(() => delivery.assertSignature(signed.document, { signature: 'valid', publisher: 'CN=other' })).toThrow();
  expect(() => delivery.assertSignature(signed.document, { signature: 'unsigned' })).toThrow();
});
it('rejects missing approval, nonstable/foreign releases, source/tag/size/hash/architecture mismatch and arbitrary URLs', async () => {
  const p = prep(), good = release();
  expect(delivery.validatePublished(good, p.document, 'x64')).toEqual(p.document);
  const invalid = [{ ...good, draft: true }, { ...good, prerelease: true }, { ...good, tag_name: 'v1.0.3' }, { ...good, target_commitish: 'main' },
    { ...good, html_url: 'https://github.com/Other/StudentOrganizer/releases/tag/v1.0.2' }, { ...good, assets: [] },
    { ...good, assets: good.assets.map(a => a.name === c.artifact.name ? { ...a, size: 9 } : a) },
    { ...good, assets: good.assets.map(a => ({ ...a, browser_download_url: 'https://evil.example/file.exe' })) }];
  for (const value of invalid) expect(() => delivery.validatePublished(value, p.document, 'x64')).toThrow();
  expect(() => delivery.validatePublished(good, p.document, 'arm64')).toThrow();
  for (const change of [{ version: '1.0.3' }, { files: [{ ...p.manifest.files[0], sha512: Buffer.alloc(64, 1).toString('base64') }] },
    { files: [{ ...p.manifest.files[0], size: bytes.length + 1 }] }, { files: [{ ...p.manifest.files[0], url: 'https://evil.example/file.exe' }] }]) {
    expect(() => delivery.assertManifest(p.document, { ...p.manifest, ...change }, 'x64')).toThrow();
  }
  expect(await delivery.createLookup({ latest: async () => ({ ...good, assets: [] }) }).latest('x64')).toBeNull();
  for (const url of ['http://github.com/file', 'https://evil.example/approval.json', 'https://api.github.com/repos/BadgerCraft/StudentOrganizer/releases/tags/v1.0.2?student=1',
    'https://github.com/BadgerCraft/StudentOrganizer/releases/download/v1/../../Other/approval.json']) await expect(delivery.readJSON(url)).rejects.toThrow();
  expect(delivery.redirectAllowed('https://release-assets.githubusercontent.com/asset?signature=test', 'https://github.com/fixed')).toBe(true);
  for (const url of ['http://release-assets.githubusercontent.com/asset', 'https://evil.example/asset', 'https://user@objects.githubusercontent.com/asset']) expect(delivery.redirectAllowed(url, 'https://github.com/fixed')).toBe(false);
});
it('prepares actual files, serves isolated fixture delivery, discovers only approval-matching artifacts and preserves backup-first installation', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'owner-delivery-'));
  let server: ReturnType<typeof createServer> | undefined;
  try {
    const source = path.join(temporary, c.artifact.name); await writeFile(source, bytes);
    const prepared = prep();
    const folder = await preparePublicationBundle(temporary, prepared, source, hashFile);
    expect((await readdir(folder)).sort()).toEqual(['PUBLICATION-INSTRUCTIONS.txt', c.artifact.name, 'latest.yml', 'student-organizer-approval-x64.json'].sort());
    expect(await readFile(path.join(folder, c.artifact.name))).toEqual(bytes);
    const servedRelease = release();
    let offerApproval = false;
    const requests: string[] = [];
    server = createServer(async (request, response) => {
      requests.push(request.url || '');
      if (request.url === '/tag') { response.end(JSON.stringify({ object: { type: 'commit', sha: c.sourceCommit } })); return; }
      if (request.url === '/release') { response.end(JSON.stringify(offerApproval ? servedRelease : { ...servedRelease, assets: [] })); return; }
      const filename = request.url?.slice(1);
      if (![c.artifact.name, 'latest.yml', 'student-organizer-approval-x64.json'].includes(filename || '')) { response.writeHead(404); response.end(); return; }
      response.end(await readFile(path.join(folder, filename!)));
    });
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    // Test-side adapter translates already-validated fixed GitHub URLs to a disposable local service.
    // Production has no localhost/generic-feed option and no URL supplied by a renderer.
    const lookup = delivery.createLookup({ latest: async () => (await fetch(origin + '/release')).json(),
      read: async (url: string) => {
        const pathname = new URL(url).pathname;
        const route = pathname.includes('/git/ref/tags/') || pathname.includes('/git/tags/') ? '/tag' : pathname.includes('/releases/tags/') ? '/release' : '/' + pathname.split('/').pop();
        return (await fetch(origin + route)).json();
      } });
    const check = createManualCheck({ platform: 'win32', packaged: true, currentVersion: '1.0.0', arch: 'x64', lookup: async () => (await lookup.latest('x64'))?.release || null });
    expect(await check()).toMatchObject({ status: 'unpublished' });
    expect(requests).toEqual(['/release']);
    offerApproval = true;
    expect(await check()).toMatchObject({ status: 'available', version: '1.0.2' });
    const installer = path.join(temporary, 'downloaded-installer.exe');
    const launch = vi.fn(), signature = vi.fn(async () => ({ signature: 'unsigned' }));
    const updater = Object.assign(new EventEmitter(), { setFeedURL: vi.fn(),
      checkForUpdates: async () => ({ updateInfo: await (await fetch(origin + '/latest.yml')).json() }),
      downloadUpdate: async () => { await writeFile(installer, Buffer.from(await (await fetch(origin + '/' + c.artifact.name)).arrayBuffer())); return [installer]; },
      installerPath: installer, downloadedUpdateHelper: { clear: vi.fn() } });
    const controller = createInstallerUpdate({ supported: true, currentVersion: '1.0.0', userData: temporary, updater, arch: 'x64',
      approvalLookup: lookup.version, tokenFactory: () => ({ cancelled: false, cancel() { this.cancelled = true; } }), hash: hashFile, signature,
      canReplace: async () => {}, launch });
    expect(await controller.download()).toMatchObject({ status: 'downloaded', signature: 'unsigned' });
    expect(launch).not.toHaveBeenCalled();
    const backup = JSON.stringify({ version: 2, schemaVersion: 5, exportedAt: new Date().toISOString(), tables: Object.fromEntries(TABLES.map((name: string) => [name, []])) });
    expect(await controller.install(backup, false)).toMatchObject({ status: 'downloaded' });
    expect(launch).not.toHaveBeenCalled();
    const installed = await controller.install(backup, true);
    expect(installed.status).toBe('installing');
    expect(await readFile(installed.backupPath, 'utf8')).toBe(backup);
    expect(launch).toHaveBeenCalledTimes(1); // Controlled test double: fixture executable never runs.
    expect(await readFile(source)).toEqual(bytes);
    // A mismatch blocks download before any file is fetched, even with a nominal newer manifest.
    updater.checkForUpdates = async () => ({ updateInfo: { ...prepared.manifest, files: [{ ...prepared.manifest.files[0], size: 1 }] } });
    const blocked = createInstallerUpdate({ supported: true, currentVersion: '1.0.0', userData: temporary, updater, arch: 'x64', approvalLookup: lookup.version,
      tokenFactory: () => ({ cancelled: false, cancel() { this.cancelled = true; } }), hash: hashFile, signature, launch });
    const before = requests.filter(url => url.endsWith('.exe')).length;
    expect(await blocked.download()).toMatchObject({ status: 'error' });
    expect(requests.filter(url => url.endsWith('.exe'))).toHaveLength(before);
    // A changed artifact cannot create a publication folder; failed preparation leaves no staging tree.
    await writeFile(source, Buffer.alloc(bytes.length, 88));
    await expect(preparePublicationBundle(temporary, prepared, source, hashFile)).rejects.toThrow();
    expect((await readdir(temporary)).filter(name => name.startsWith('.owner-release-preparation-'))).toEqual([]);
  } finally { if (server) await new Promise<void>(resolve => server!.close(() => resolve())); await rm(temporary, { recursive: true, force: true }); }
});

it('resolves lightweight and annotated tags to the exact approved commit, rejecting mismatches and tag cycles', async () => {
  const p = prep(), r = release();
  const reader = (sha: string, annotated = false) => async (url: string) => {
    if (url.endsWith('student-organizer-approval-x64.json')) return p.document;
    if (url.includes('/git/ref/')) return { object: { type: annotated ? 'tag' : 'commit', sha: annotated ? '1'.repeat(40) : sha } };
    if (url.includes('/git/tags/')) return { object: { type: 'commit', sha } };
    return r;
  };
  for (const annotated of [false, true]) {
    expect((await delivery.createLookup({ latest: async () => r, read: reader(c.sourceCommit, annotated) }).latest('x64')).document).toEqual(p.document);
    await expect(delivery.createLookup({ latest: async () => r, read: reader('2'.repeat(40), annotated) }).latest('x64')).rejects.toThrow(/source commit/);
  }
  await expect(delivery.createLookup({ latest: async () => r, read: async (url: string) => url.endsWith('.json') ? p.document : { object: { type: 'tag', sha: '1'.repeat(40) } } }).latest('x64')).rejects.toThrow();
});

it('bounds production approval transport, destroys discarded bodies and rejects untrusted redirects', async () => {
  const https = require('node:https');
  const endpoint = 'https://github.com/BadgerCraft/StudentOrganizer/releases/download/v1.0.2/student-organizer-approval-x64.json';
  const calls: any[] = [];
  const spy = vi.spyOn(https, 'get').mockImplementation((...args: any[]) => {
    const request = Object.assign(new EventEmitter(), { destroy: vi.fn() });
    calls.push({ url: args[0], options: args[1], callback: args[2], request });
    return request;
  });
  const response = (statusCode: number, location?: string) => Object.assign(new EventEmitter(), {
    statusCode, headers: { location }, destroy: vi.fn(), resume: vi.fn()
  });
  try {
    for (const code of [404, 503]) {
      const pending = delivery.readJSON(endpoint, { asset: true });
      const result = pending.catch((error: Error) => error);
      const body = response(code); calls.at(-1).callback(body);
      if (code === 404) expect(await result).toBeNull(); else expect(await result).toBeInstanceOf(Error);
      expect(body.destroy).toHaveBeenCalledTimes(1); expect(body.resume).not.toHaveBeenCalled();
    }
    const redirected = delivery.readJSON(endpoint, { asset: true });
    const originalRequest = calls.at(-1).request;
    const old = response(302, 'https://release-assets.githubusercontent.com/approval?signature=public');
    calls.at(-1).callback(old); expect(old.destroy).toHaveBeenCalledTimes(1);
    const next = response(200); calls.at(-1).callback(next);
    originalRequest.emit('error', new Error('discarded old connection'));
    next.emit('data', Buffer.from('{"ok":true}')); next.emit('end');
    expect(await redirected).toEqual({ ok: true });
    expect(Object.keys(calls.at(-1).options.headers).sort()).toEqual(['Accept', 'User-Agent']);
    const foreign = delivery.readJSON(endpoint); const rejected = foreign.catch((error: Error) => error);
    const bad = response(302, 'https://evil.example/file'); calls.at(-1).callback(bad);
    expect(await rejected).toBeInstanceOf(Error); expect(bad.destroy).toHaveBeenCalled();
    const oversized = delivery.readJSON(endpoint); const tooLarge = oversized.catch((error: Error) => error);
    const huge = response(200); calls.at(-1).callback(huge); huge.emit('data', Buffer.alloc(128 * 1024 + 1));
    expect((await tooLarge).message).toMatch(/too large/); expect(huge.destroy).toHaveBeenCalled();
    vi.useFakeTimers();
    const timed = delivery.readJSON(endpoint); const timedResult = timed.catch((error: Error) => error);
    const lateRequest = calls.at(-1), before = calls.length;
    await vi.advanceTimersByTimeAsync(10000);
    expect((await timedResult).message).toMatch(/timed out/); expect(lateRequest.request.destroy).toHaveBeenCalled();
    const lateResponse = response(302, 'https://release-assets.githubusercontent.com/late'); lateRequest.callback(lateResponse);
    expect(lateResponse.destroy).toHaveBeenCalled(); expect(calls).toHaveLength(before);
    expect(vi.getTimerCount()).toBe(0);
  } finally { spy.mockRestore(); vi.useRealTimers(); }
});
