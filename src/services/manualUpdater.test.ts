import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { version, isNewer, releaseUrl, parseRelease, trustedCaller, createManualCheck } = require('../../electron/manualUpdater.cjs');
const release = { tag_name: 'v1.2.0', html_url: 'https://github.com/BadgerCraft/StudentOrganizer/releases/tag/v1.2.0', draft: false, prerelease: false };
describe('manual Windows release lookup boundary', () => {
  it('compares stable versions numerically and rejects ambiguous versions', () => {
    expect(isNewer('v1.10.0', '1.9.0')).toBe(true);
    expect(isNewer('1.0.0', '1.0.0')).toBe(false);
    expect(isNewer('1.0.0', '2.0.0')).toBe(false);
    for (const input of ['1.0.0-qa.85.1', '01.0.0', '1.0', '1.0.0/path', '1.0.0+meta', '99999999999.0.0']) expect(() => version(input)).toThrow();
  });
  it('accepts only an exact repository release destination', () => {
    expect(releaseUrl(release.html_url, release.tag_name)).toBe(release.html_url);
    for (const url of ['http://github.com/BadgerCraft/StudentOrganizer/releases/tag/v1.2.0', 'https://github.com.evil.test/BadgerCraft/StudentOrganizer/releases/tag/v1.2.0', release.html_url + '?redirect=evil', release.html_url + '#install', 'https://github.com/Other/StudentOrganizer/releases/tag/v1.2.0', release.html_url.replace('github.com', 'user@github.com')]) expect(() => releaseUrl(url, release.tag_name)).toThrow();
  });
  it('rejects draft/prerelease/malformed manifests and never authorizes installation from release metadata', () => {
    expect(parseRelease(release, '1.0.0')).toMatchObject({ status: 'available', installationAvailable: false });
    for (const data of [null, {}, { ...release, draft: true }, { ...release, prerelease: true }, { ...release, html_url: 'https://evil.test/installer.exe' }, { ...release, tag_name: 'v1.0.0-qa.1' }]) expect(() => parseRelease(data, '1.0.0')).toThrow();
  });
  it('requires the owned window, top frame and exact local bundle path', () => {
    const mainFrame = { url: 'file:///bundle/index.html#settings' }, contents = { mainFrame };
    const event = { sender: contents, senderFrame: mainFrame };
    expect(trustedCaller(event, contents, 'file:///bundle/index.html')).toBe(true);
    expect(trustedCaller({ ...event, sender: {} }, contents, 'file:///bundle/index.html')).toBe(false);
    expect(trustedCaller({ ...event, senderFrame: { ...mainFrame } }, contents, 'file:///bundle/index.html')).toBe(false);
    expect(trustedCaller(event, contents, 'file:///other/index.html')).toBe(false);
  });
  it('does no lookup during construction or on web/Mac/unpackaged builds', async () => {
    let calls = 0;
    const lookup = async () => { calls++; return release; };
    const check = createManualCheck({ platform: 'win32', packaged: true, currentVersion: '1.0.0', lookup });
    expect(calls).toBe(0);
    for (const options of [{ platform: 'darwin', packaged: true }, { platform: 'win32', packaged: false }]) expect(await createManualCheck({ ...options, currentVersion: '1.0.0', lookup })()).toEqual({ status: 'unsupported' });
    expect(calls).toBe(0);
    const results = await Promise.all([check(), check()]);
    expect(calls).toBe(1); expect(results[0]).toEqual(results[1]);
    await check(); expect(calls).toBe(2);
  });
  it('handles absent releases, request failures and invalid versions without throwing private diagnostics to UI', async () => {
    for (const [lookup, status] of [[async () => null, 'unpublished'], [async () => { throw new Error('private details'); }, 'error'], [async () => ({}), 'error']] as const) {
      expect(await createManualCheck({ platform: 'win32', packaged: true, currentVersion: '1.0.0', lookup })()).toEqual({ status });
    }
  });
});
