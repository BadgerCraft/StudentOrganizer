import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { createStartupUpdateCheck } = require('../../electron/startupUpdateCheck.cjs');
const release = { tag_name: 'v1.2.0', html_url: 'https://github.com/BadgerCraft/StudentOrganizer/releases/tag/v1.2.0', draft: false, prerelease: false };
function setup(options: Record<string, unknown> = {}) {
  const lookup = vi.fn(async () => ({ release }));
  const capability = vi.fn(async () => ({ installationAvailable: true }));
  return { lookup, capability, controller: createStartupUpdateCheck({ platform: 'win32', packaged: true,
    currentVersion: '1.0.0', arch: 'x64', lookup, capability, ...options }) };
}
describe('startup metadata checks', () => {
  it('starts once, exposes local cached status and leaves downloads to an explicit click', async () => {
    const { controller, lookup, capability } = setup();
    expect(controller.status()).toMatchObject({ status: 'idle' });
    expect(lookup).not.toHaveBeenCalled();
    const checks = [controller.start(), controller.start(), controller.check()];
    expect(controller.status()).toMatchObject({ status: 'checking' });
    const results = await Promise.all(checks);
    expect(results.every(r => r.status === 'available' && r.installationAvailable)).toBe(true);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith('x64', 'win32');
    expect(capability).toHaveBeenCalledTimes(1);
    controller.status(); await controller.start(); controller.status();
    expect(lookup).toHaveBeenCalledTimes(1);
    await controller.check();
    expect(lookup).toHaveBeenCalledTimes(2);
  });
  it('never contacts GitHub for browser/development/unsupported platforms or approved-mode startup', async () => {
    for (const options of [{ packaged: false }, { platform: 'linux' }, { mode: 'approved-release' }]) {
      const f = setup(options); await f.controller.start();
      expect(f.lookup).not.toHaveBeenCalled();
    }
  });
  it('stays usable for no release, offline/rate-limit, invalid releases and retries without a loop', async () => {
    const lookup = vi.fn().mockRejectedValueOnce(new Error('private details')).mockResolvedValueOnce(null).mockResolvedValueOnce({ release });
    const { controller } = setup({ lookup });
    expect(await controller.start()).toMatchObject({ status: 'error', installationAvailable: false });
    expect(JSON.stringify(controller.status())).not.toContain('private details');
    await controller.start(); expect(lookup).toHaveBeenCalledTimes(1);
    expect(await controller.check()).toMatchObject({ status: 'unpublished' });
    expect(await controller.check()).toMatchObject({ status: 'available' });
    for (const bad of [{ ...release, draft: true }, { ...release, prerelease: true }, { ...release, html_url: 'https://untrusted.test' }]) {
      const f = setup({ lookup: async () => ({ release: bad }) });
      expect(await f.controller.start()).toMatchObject({ status: 'error' });
    }
  });
  it('does not offer equal/downgrade releases or run signature probes for them', async () => {
    for (const currentVersion of ['1.2.0', '2.0.0']) {
      const f = setup({ currentVersion });
      expect(await f.controller.start()).toMatchObject({ status: 'current', installationAvailable: false });
      expect(f.capability).not.toHaveBeenCalled();
    }
  });
  it('reports unsigned, elevated, portable or protected capability without pretending installation is available', async () => {
    for (const message of ['Signed bootstrap needed', 'Per-user installation required', 'Portable copy', 'Protected recovery unavailable']) {
      const f = setup({ capability: async () => ({ installationAvailable: false, message }) });
      expect(await f.controller.start()).toMatchObject({ status: 'available', installationAvailable: false, message });
    }
  });
  it('discovers Mac releases but never promises the unavailable native install path', async () => {
    const f = setup({ platform: 'darwin', arch: 'arm64' });
    expect(await f.controller.start()).toMatchObject({ status: 'available', installationAvailable: false, message: expect.stringContaining('Mac') });
    expect(f.lookup).toHaveBeenCalledWith('arm64', 'darwin');
    expect(f.capability).not.toHaveBeenCalled();
  });
});
