import { describe, expect, it, vi } from 'vitest';
import { runOneClickUpdate, type OneClickUpdateDependencies } from './oneClickUpdate';
import type { InstallResult } from '../components/ManualWindowsUpdate';
function setup() {
  const deps: OneClickUpdateDependencies = {
    download: vi.fn(async (): Promise<InstallResult> => ({ status: 'downloaded', installationAvailable: true, signature: 'valid' })),
    install: vi.fn(async (): Promise<InstallResult> => ({ status: 'installing', installationAvailable: true })),
    backup: vi.fn(async () => 'fictional complete validated backup'), safetyReason: vi.fn(() => undefined),
    cancelled: vi.fn(() => false), onPhase: vi.fn(), onResult: vi.fn()
  };
  return deps;
}
describe('one-click renderer update sequence', () => {
  it('backs up after verified download, then installs once without unsigned consent', async () => {
    const deps = setup(); expect(await runOneClickUpdate(deps)).toBe('installing');
    expect(deps.install).toHaveBeenCalledTimes(1); expect(deps.install).toHaveBeenCalledWith('fictional complete validated backup', false);
    expect(vi.mocked(deps.onPhase).mock.calls).toEqual([['download'], ['backup'], ['install']]);
    expect(deps.safetyReason).toHaveBeenCalledTimes(3);
  });
  it.each(['unsigned', undefined] as const)('rejects %s signature before backup or installation', async signature => {
    const deps = setup(); vi.mocked(deps.download).mockResolvedValue({ status: 'downloaded', installationAvailable: true, signature });
    await expect(runOneClickUpdate(deps)).rejects.toThrow('trusted publisher'); expect(deps.backup).not.toHaveBeenCalled(); expect(deps.install).not.toHaveBeenCalled();
  });
  it.each(['error', 'current', 'unsupported'] as const)('does not install after %s download outcome', async status => {
    const deps = setup(); vi.mocked(deps.download).mockResolvedValue({ status, installationAvailable: false });
    await expect(runOneClickUpdate(deps)).rejects.toThrow(); expect(deps.backup).not.toHaveBeenCalled(); expect(deps.install).not.toHaveBeenCalled();
  });
  it.each([0, 1, 2])('retains edits when safety check %i reports work in progress', async check => {
    const deps = setup(); let count = 0; deps.safetyReason = () => count++ === check ? 'Save fictional changes first.' : undefined;
    await expect(runOneClickUpdate(deps)).rejects.toThrow('Save fictional changes'); expect(deps.install).not.toHaveBeenCalled();
    if (check === 0) expect(deps.download).not.toHaveBeenCalled();
    if (check < 2) expect(deps.backup).not.toHaveBeenCalled();
  });
  it.each(['download', 'backup'] as const)('supports cancellation during %s without installation', async at => {
    const deps = setup(); let cancel = false; deps.cancelled = () => cancel;
    if (at === 'download') vi.mocked(deps.download).mockImplementation(async () => { cancel = true; return { status: 'downloaded', installationAvailable: true, signature: 'valid' }; });
    else vi.mocked(deps.backup).mockImplementation(async () => { cancel = true; return 'fictional'; });
    expect(await runOneClickUpdate(deps)).toBe('cancelled'); expect(deps.install).not.toHaveBeenCalled();
  });
  it('fails closed on backup failure and surfaced installation failure', async () => {
    const deps = setup(); vi.mocked(deps.backup).mockRejectedValueOnce(new Error('fictional disk full'));
    await expect(runOneClickUpdate(deps)).rejects.toThrow('fictional disk full'); expect(deps.install).not.toHaveBeenCalled();
    vi.mocked(deps.install).mockResolvedValueOnce({ status: 'error', installationAvailable: true, error: 'Installer did not launch.' });
    await expect(runOneClickUpdate(deps)).rejects.toThrow('Installer did not launch');
  });
});
