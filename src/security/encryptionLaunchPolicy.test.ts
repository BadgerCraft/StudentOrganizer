import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import path from 'node:path';
const { createEncryptionLaunchPolicy, attachEncryptionWindowGuards } = createRequire(import.meta.url)('../../electron/encryptionLaunchPolicy.cjs');
function fixture(mode = 'encrypted', persistent = false) {
  const policy = createEncryptionLaunchPolicy({ mode, indexPath: path.resolve('/synthetic-app/dist/index.html') });
  let locks = 0, hidden = 0, stopped = 0; const violations: string[] = [];
  const webContents = Object.assign(new EventEmitter(), { session: { isPersistent: () => persistent, storagePath: persistent ? '/synthetic-persistent-profile' : null }, stop: () => { stopped++; } });
  const window = Object.assign(new EventEmitter(), { webContents, hide: () => { hidden++; } });
  const attached = attachEncryptionWindowGuards({ window, policy, lock: () => { locks++; }, onViolation: (reason: string) => violations.push(reason) });
  return { policy, window, attached, violations, get locks() { return locks; }, get hidden() { return hidden; }, get stopped() { return stopped; } };
}
describe('native protected launch policy', () => {
  it('uses independent memory partitions for encrypted and pending enrollment windows', () => {
    const a = fixture(), b = fixture('enrollment-pending'); expect(a.attached).toBe(true); expect(b.attached).toBe(true); expect(a.policy.partition).not.toMatch(/^persist:/); expect(a.policy.partition).not.toBe(b.policy.partition); expect(a.policy.hash).toBe('encrypted-workspace');
  });
  it('refuses a native session that unexpectedly persists despite the requested partition', () => {
    const f = fixture('encrypted', true); expect(f.attached).toBe(false); expect(f.violations).toEqual(['partition']); expect(f.hidden).toBe(1);
  });
  it('leaves default legacy storage selection unchanged', () => {
    const f = fixture('legacy', true); expect(f.attached).toBe(true); expect(f.policy.partition).toBeNull(); expect(f.policy.hash).toBeUndefined(); f.window.webContents.emit('preload-error'); expect(f.violations).toEqual([]);
  });
  it('locks and hides on preload errors, without displaying App as a fallback', () => {
    const f = fixture(); f.window.webContents.emit('preload-error', {}, 'private/path', Error('PRIVATE')); expect(f.violations).toEqual(['preload']); expect(f.locks).toBe(1); expect(f.hidden).toBe(1); expect(f.stopped).toBe(1);
  });
  it('rejects marker removal even though it is same-document navigation', () => {
    const f = fixture(); f.window.webContents.emit('did-navigate-in-page', {}, f.policy.indexUrl, true); expect(f.violations).toEqual(['fragment']); expect(f.hidden).toBe(1);
  });
  it('accepts only the configured bundle URL and protected marker; query strings never grant access', () => {
    const f = fixture(); expect(f.policy.permits(f.policy.indexUrl + '#encrypted-workspace')).toBe(true);
    for (const url of [f.policy.indexUrl, f.policy.indexUrl + '?workspace=encrypted#encrypted-workspace', 'https://example.invalid/#encrypted-workspace', f.policy.indexUrl + '#legacy']) expect(f.policy.permits(url)).toBe(false);
  });
  it('revokes native key access on main-frame reload, renderer crash and window close', () => {
    const f = fixture(); f.window.webContents.emit('did-start-navigation', {}, f.policy.indexUrl, false, false); expect(f.locks).toBe(0); f.window.webContents.emit('did-start-navigation', {}, f.policy.indexUrl, false, true); expect(f.locks).toBe(1); f.window.emit('closed'); expect(f.locks).toBe(2); f.window.webContents.emit('render-process-gone'); expect(f.violations).toEqual(['renderer']); expect(f.locks).toBeGreaterThan(2);
  });
});
