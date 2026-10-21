import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
const require = createRequire(import.meta.url);
const { prepare, recordTest, approve, revoke, candidate, state, exportPreview, previewOffer } = require('../../electron/updateApproval.cjs');
const { createManualCheck } = require('../../electron/manualUpdater.cjs');
const { createInstallerUpdate, hashFile } = require('../../electron/windowsInstallerUpdate.cjs');
const { atomicJSON, verifyArtifact, assertPreviewDestination } = require('../../apps/control-panel/electron/store.cjs');
const bytes = Buffer.from('FICTIONAL NON-EXECUTABLE INSTALLER FIXTURE\n');
const sample = () => ({ schemaVersion: 1, product: 'StudentOrganizer', version: '1.0.2', arch: 'x64', sourceCommit: '81058d87d669ff4cd787b06c25fe84217581f2ad', artifact: {
  name: 'OntarioTeacherAssessment-1.0.2-x64-nsis.exe', bytes: bytes.length, sha512: createHash('sha512').update(bytes).digest('base64') } });
const tested = () => recordTest(prepare(sample()), 'Fictional test evidence only: backup/reopen/recovery exercised by test doubles.', '2026-10-20T10:00:00.000Z');
const approved = () => approve(tested(), '2026-10-20T11:00:00.000Z');
describe('owner-local release preparation', () => {
  it('requires verification then approval; immutable candidates cannot inherit old approval', () => {
    const initial = prepare(sample());
    expect(() => approve(initial)).toThrow();
    expect(initial.status).toBe('candidate');
    expect(() => recordTest(initial, 'short')).toThrow();
    expect(approved().status).toBe('approved');
    expect(() => recordTest(approved(), 'new evidence here')).toThrow();
    expect(() => approve(approved())).toThrow();
    expect(() => approve(tested(), '2026-10-20T09:00:00.000Z')).toThrow();
    expect(revoke(approved()).status).toBe('revoked');
    expect(() => approve(revoke(approved()))).toThrow();
    const changed = sample(); changed.version = '1.0.3'; changed.artifact.name = 'OntarioTeacherAssessment-1.0.3-x64-nsis.exe';
    expect(prepare(changed)).toMatchObject({ status: 'candidate', test: null, approvedAt: null });
  });
  it('rejects malformed identities, traversal, executable URLs, student fields and mismatched artifacts', () => {
    const invalid = [
      { ...sample(), url: 'https://evil.example/installer.exe' }, { ...sample(), studentRecords: [] },
      { ...sample(), product: 'other' }, { ...sample(), version: 'v1.0.2' }, { ...sample(), version: '1.0.2-beta' },
      { ...sample(), sourceCommit: 'main' }, { ...sample(), arch: 'ia32' },
      ...['../../evil.exe', 'https://evil.example/file.exe', 'OntarioTeacherAssessment-1.0.3-x64-nsis.exe'].map(name => ({ ...sample(), artifact: { ...sample().artifact, name } })),
      ...[0, -1, 1.1, Infinity, 4 * 1024 ** 3 + 1].map(size => ({ ...sample(), artifact: { ...sample().artifact, bytes: size } })),
      { ...sample(), artifact: { ...sample().artifact, sha512: 'bad' } }, { ...sample(), artifact: { ...sample().artifact, url: 'file:///local.exe' } }
    ];
    for (const value of invalid) expect(() => candidate(value)).toThrow();
    expect(() => state({ ...prepare(sample()), approvedAt: '2026-10-20T10:00:00.000Z' })).toThrow();
    expect(() => state({ ...approved(), status: 'tested' })).toThrow();
  });
  it('offers only approved newer matching builds, and fails closed for every live-mode attempt', () => {
    for (const value of [prepare(sample()), tested(), revoke(approved())]) expect(previewOffer(exportPreview(value), '1.0.0', 'x64')).toBeNull();
    const feed = exportPreview(approved());
    expect(previewOffer(feed, '1.0.0', 'x64')).toMatchObject({ mode: 'local-preview-only', manifest: { version: '1.0.2' } });
    expect(previewOffer(feed, '1.0.2', 'x64')).toBeNull();
    expect(previewOffer(feed, '1.0.0', 'arm64')).toBeNull();
    expect(() => previewOffer(feed, '1.0.0', 'x64', 'live')).toThrow();
    for (const change of [{ mode: 'live' }, { publicationReady: true }, { telemetry: [] }, { approval: { ...approved(), candidate: { ...sample(), version: '1.0.3' } } }]) {
      expect(() => previewOffer({ ...feed, ...change }, '1.0.0', 'x64')).toThrow();
    }
  });
  it('checks actual local artifact bytes and preserves the last saved approval after mismatches or failed saves', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'owner-approval-'));
    try {
      const installer = path.join(directory, sample().artifact.name), store = path.join(directory, 'approval.json');
      await writeFile(installer, bytes); await verifyArtifact(approved(), installer, hashFile);
      await atomicJSON(store, approved()); const original = await readFile(store, 'utf8');
      await writeFile(installer, Buffer.from('X'.repeat(bytes.length)));
      await expect(verifyArtifact(approved(), installer, hashFile)).rejects.toThrow();
      expect(await readFile(store, 'utf8')).toBe(original);
      await writeFile(installer, bytes.subarray(1));
      await expect(verifyArtifact(approved(), installer, hashFile)).rejects.toThrow();
      const wrongName = path.join(directory, 'other.exe'); await writeFile(wrongName, bytes);
      await expect(verifyArtifact(approved(), wrongName, hashFile)).rejects.toThrow();
      await expect(atomicJSON(path.join(directory, 'missing', 'approval.json'), tested())).rejects.toThrow();
      expect(await readFile(store, 'utf8')).toBe(original);
      expect((await readdir(directory)).some(name => name.endsWith('.tmp'))).toBe(false);
      expect(JSON.parse(original)).toEqual(approved());
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('bridges the approved local fixture into the existing checker and NSIS path without executable URLs or live transport', async () => {
    const offer = previewOffer(exportPreview(approved()), '1.0.0', 'x64');
    const check = createManualCheck({ platform: 'win32', packaged: true, currentVersion: '1.0.0', lookup: async () => offer.release });
    expect(await check()).toMatchObject({ status: 'available', version: '1.0.2' });
    const updater = Object.assign(new EventEmitter(), {
      setFeedURL: vi.fn(), checkForUpdates: vi.fn(async () => ({ updateInfo: offer.manifest })),
      downloadUpdate: vi.fn(async () => ['/fixture/installer.exe']), installerPath: '/fixture/installer.exe',
      downloadedUpdateHelper: { clear: vi.fn() }, quitAndInstall: vi.fn()
    });
    const launch = vi.fn();
    const controller = createInstallerUpdate({ supported: true, currentVersion: '1.0.0', userData: '/fixture/profile', arch: 'x64', updater,
      tokenFactory: () => ({ cancelled: false, cancel() { this.cancelled = true; } }), hash: async () => sample().artifact.sha512,
      approvalLookup: async () => ({ document: require('../../electron/releaseDelivery.cjs').preparePublication(approved(), { signature: 'valid', publisher: 'FICTIONAL TEST DOUBLE' }).document }),
      signature: async () => ({ signature: 'valid', publisher: 'FICTIONAL TEST DOUBLE' }), backup: async () => { throw new Error('disk full'); }, canReplace: async () => {}, launch });
    expect(await controller.download()).toMatchObject({ status: 'downloaded', version: '1.0.2' });
    expect(launch).not.toHaveBeenCalled();
    const { TABLES } = require('../../electron/windowsInstallerUpdate.cjs');
    const backup = JSON.stringify({ schemaVersion: 5, version: 2, exportedAt: '2026-10-20T11:00:00.000Z', tables: Object.fromEntries(TABLES.map((t: string) => [t, []])) });
    expect(await controller.install(backup, false)).toMatchObject({ status: 'error' });
    expect(launch).not.toHaveBeenCalled();
    expect(updater.downloadedUpdateHelper.clear).toHaveBeenCalled();
    // The adapter only hands test doubles metadata; production feed selection is unchanged.
    expect(updater.setFeedURL).toHaveBeenCalledWith({ provider: 'github', owner: 'BadgerCraft', repo: 'StudentOrganizer', private: false });
  });
});

it('protects the console store and installer from export, including case-insensitive Windows aliases', async () => {
  await expect(assertPreviewDestination('/tmp/LOCAL-APPROVAL.JSON', ['/tmp/local-approval.json'], 'win32')).rejects.toThrow();
  await expect(assertPreviewDestination('/tmp/installer.exe', [], 'win32')).rejects.toThrow();
  await expect(assertPreviewDestination('/tmp/preview.json', ['/tmp/local-approval.json'], 'win32')).resolves.toBeUndefined();
});
