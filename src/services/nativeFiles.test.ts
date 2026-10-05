import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  native: false,
  platform: 'web',
  exportBackup: vi.fn(),
  importBackup: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => mock.native, getPlatform: () => mock.platform },
  registerPlugin: () => mock,
}));
import { exportNativeBackup, selectNativeBackup, usesNativeFiles } from './nativeFiles';

describe('native Files bridge', () => {
  beforeEach(() => { vi.clearAllMocks(); mock.native = false; mock.platform = 'web'; });
  it('keeps browser and desktop on their existing file paths', () => {
    expect(usesNativeFiles()).toBe(false);
    mock.native = true; mock.platform = 'android';
    expect(usesNativeFiles()).toBe(false);
    mock.platform = 'ios';
    expect(usesNativeFiles()).toBe(true);
  });
  it('does not claim export success after cancellation or a storage failure', async () => {
    mock.exportBackup.mockResolvedValueOnce({ cancelled: true });
    expect(await exportNativeBackup('backup.json', '{"version":1}')).toBe(false);
    mock.exportBackup.mockRejectedValueOnce(new Error('storage full'));
    await expect(exportNativeBackup('backup.json', '{}')).rejects.toThrow('storage full');
    mock.exportBackup.mockResolvedValueOnce({ cancelled: false });
    expect(await exportNativeBackup('backup.json', '{}')).toBe(true);
    expect(mock.exportBackup).toHaveBeenLastCalledWith({ filename: 'backup.json', content: '{}' });
  });
  it('returns selection unchanged for the existing validator and no selection on cancel', async () => {
    mock.importBackup.mockResolvedValueOnce({ cancelled: true });
    expect(await selectNativeBackup()).toBeNull();
    mock.importBackup.mockResolvedValueOnce({ cancelled: false, content: 'corrupt backup' });
    expect(await selectNativeBackup()).toBe('corrupt backup');
    mock.importBackup.mockRejectedValueOnce(new Error('unreadable'));
    await expect(selectNativeBackup()).rejects.toThrow('unreadable');
  });
});
