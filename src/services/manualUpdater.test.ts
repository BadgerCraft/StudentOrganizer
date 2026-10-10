import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const https = require('node:https');
const { version, isNewer, releaseUrl, parseRelease, trustedCaller, createManualCheck } = require('../../electron/manualUpdater.cjs');
const release = { tag_name: 'v1.2.0', html_url: 'https://github.com/BadgerCraft/StudentOrganizer/releases/tag/v1.2.0', draft: false, prerelease: false };
describe('manual Windows release lookup boundary', () => {
  it('compares stable versions numerically and rejects ambiguous versions', () => {
    expect(isNewer('v1.10.0', '1.9.0')).toBe(true);
    expect(isNewer('1.0.0', '1.0.0')).toBe(false);
    expect(isNewer('1.0.0', '2.0.0')).toBe(false);
    for (const input of ['1.0.0-qa.85.1', '01.0.0', '1.0', '1.0.0/path', '1.0.0+meta', '99999999999.0.0']) expect(() => version(input)).toThrow();
  });
  it('compares an installed QA build against stable releases without accepting incoming QA tags', () => {
    expect(isNewer('1.0.0', '1.0.0-qa.85.1')).toBe(true);
    expect(isNewer('1.1.0', '1.0.0-qa.85.1')).toBe(true);
    expect(isNewer('1.0.0', '1.1.0-qa.85.1')).toBe(false);
    expect(parseRelease({ ...release, tag_name: 'v1.0.0', html_url: release.html_url.replace('v1.2.0', 'v1.0.0') }, '1.0.0-qa.85.1')).toMatchObject({ status: 'available', installationAvailable: false });
    expect(() => isNewer('1.0.0-qa.86.1', '1.0.0-qa.85.1')).toThrow();
    for (const current of ['1.0.0-beta.1', '1.0.0-qa.85', '1.0.0-qa.085.1', '1.0.0-qa.85.1+metadata', '1.0.0-qa.85.1/extra']) expect(() => isNewer('1.0.0', current)).toThrow();
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
    const mainFrame = { url: 'file:///C:/bundle/index.html#settings' }, contents = { mainFrame };
    const event = { sender: contents, senderFrame: mainFrame };
    expect(trustedCaller(event, contents, 'file:///C:/bundle/index.html')).toBe(true);
    expect(trustedCaller({ ...event, sender: {} }, contents, 'file:///C:/bundle/index.html')).toBe(false);
    expect(trustedCaller({ ...event, senderFrame: { ...mainFrame } }, contents, 'file:///C:/bundle/index.html')).toBe(false);
    expect(trustedCaller(event, contents, 'file:///C:/other/index.html')).toBe(false);
  });
  it('authorizes equivalent tilde encoding in an installed Windows bundle without widening the caller boundary', () => {
    const actual = 'file:///C:/Users/RUNNER~1/AppData/Local/Temp/app/resources/app.asar/dist/index.html';
    const expected = actual.replace('RUNNER~1', 'RUNNER%7E1');
    const mainFrame = { url: actual + '#settings' }, contents = { mainFrame };
    const event = { sender: contents, senderFrame: mainFrame };
    expect(trustedCaller(event, contents, expected)).toBe(true);
    for (const url of [actual + '?install=1', actual.replace('file:', 'https:'), actual.replace('file:///', 'file://foreign/'), actual.replace('index.html', 'other.html'), actual.replace('RUNNER~1', 'RUNNER%2F1')]) {
      mainFrame.url = url;
      expect(trustedCaller(event, contents, expected)).toBe(false);
    }
    mainFrame.url = actual;
    expect(trustedCaller({ ...event, sender: {} }, contents, expected)).toBe(false);
    expect(trustedCaller({ ...event, senderFrame: { url: actual } }, contents, expected)).toBe(false);
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
  it('bounds slow connection and trickling responses by ten seconds, then permits retry', async () => {
    vi.useFakeTimers();
    const transports: { request: EventEmitter & { destroy: ReturnType<typeof vi.fn> }; respond: (response: EventEmitter) => void }[] = [];
    vi.spyOn(https, 'get').mockImplementation((...args: unknown[]) => {
      const respond = args[2] as (response: EventEmitter) => void;
      const request = new EventEmitter() as EventEmitter & { destroy: ReturnType<typeof vi.fn> };
      request.destroy = vi.fn((error: Error) => { request.emit('error', error); return request; });
      transports.push({ request, respond });
      return request;
    });
    try {
      const check = createManualCheck({ platform: 'win32', packaged: true, currentVersion: '1.0.0' });
      // Connection/DNS stall: no socket or response event arrives.
      const stalled = check();
      await vi.advanceTimersByTimeAsync(10000);
      expect(await stalled).toEqual({ status: 'error' });
      expect(transports[0].request.destroy).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      // Data keeps arriving, so a socket inactivity timeout would never fire.
      const trickling = check();
      const response = new EventEmitter() as EventEmitter & { statusCode: number };
      response.statusCode = 200;
      transports[1].respond(response);
      for (let second = 0; second < 9; second++) {
        response.emit('data', Buffer.from(' '));
        await vi.advanceTimersByTimeAsync(1000);
      }
      expect(transports[1].request.destroy).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1000);
      expect(await trickling).toEqual({ status: 'error' });
      expect(transports[1].request.destroy).toHaveBeenCalledTimes(1);
      // Failure must clear the pending latch; a subsequent clicked check succeeds.
      const retry = check();
      const absent = Object.assign(new EventEmitter(), { statusCode: 404, resume: vi.fn() });
      transports[2].respond(absent);
      expect(await retry).toEqual({ status: 'unpublished' });
      await vi.advanceTimersByTimeAsync(10000);
      expect(transports[2].request.destroy).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.restoreAllMocks(); vi.useRealTimers(); }
  });

  it('releases a clicked check immediately when the response is interrupted', async () => {
    const responses: EventEmitter[] = [];
    const transport = vi.spyOn(https, 'get').mockImplementation((...args: unknown[]) => {
      const respond = args[2] as (response: EventEmitter) => void;
      const request = Object.assign(new EventEmitter(), { destroy: vi.fn() });
      const response = Object.assign(new EventEmitter(), { statusCode: 200 });
      responses.push(response);
      queueMicrotask(() => { respond(response); response.emit('aborted'); });
      return request;
    });
    try {
      const check = createManualCheck({ platform: 'win32', packaged: true, currentVersion: '1.0.0' });
      expect(await check()).toEqual({ status: 'error' });
      expect(await check()).toEqual({ status: 'error' });
      expect(responses).toHaveLength(2);
    } finally { transport.mockRestore(); }
  });

});
