import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { observeRecoveryFixture, parseRecoveryFixtureMarker, recoveryFixtureProcessScript, type RecoveryFixtureProcess } from './installRecoveryFixture';
const marker = 'format=student-organizer-install-failure-v1\r\nphase=deleted\r\npid=123\r\nattempts=2\r\n';
const processRow = (pid: number, installedApp = false): RecoveryFixtureProcess => ({ pid, parentPid: 123, path: 'fictional.exe', commandLine: 'fictional', installedApp });
function fixture() {
  let time = 0, markerText: string | undefined, diagnostic: string | undefined, exists = true, rows: RecoveryFixtureProcess[] = [], poll = 0;
  const observations: any[] = []; let beforePoll = () => {};
  const run = () => observeRecoveryFixture({ now: () => time, sleep: async ms => { time += ms; }, timeout: 5000, quietMilliseconds: 750,
    marker: () => markerText, diagnostic: () => diagnostic, executableExists: () => exists, processes: async () => { poll++; beforePoll(); return rows; }, record: row => observations.push(row) });
  return { run, observations, set: (values: { marker?: string; diagnostic?: string; exists?: boolean; rows?: RecoveryFixtureProcess[] }) => { if ('marker' in values) markerText = values.marker; if ('diagnostic' in values) diagnostic = values.diagnostic; if ('exists' in values) exists = values.exists!; if ('rows' in values) rows = values.rows!; }, beforePoll: (action: () => void) => { beforePoll = action; }, get poll() { return poll; } };
}
describe('read-only install recovery fixture observation', () => {
  it('accepts only a bounded post-deletion PID/attempt marker', () => {
    expect(parseRecoveryFixtureMarker(marker)).toEqual({ pid: 123, attempts: 2 });
    for (const invalid of ['Deliberate StudentOrganizer recovery acceptance fixture.', marker.replace('deleted', 'deleting'), marker.replace('attempts=2', 'attempts=41'), marker.replace('pid=123', 'pid=0'), marker + 'extra\n']) expect(() => parseRecoveryFixtureMarker(invalid)).toThrow();
  });
  it('does not mistake a pre-delete diagnostic or downloaded parent exit for completed injection', async () => {
    const f = fixture(); f.set({ diagnostic: 'phase=deleting\n', rows: [processRow(123)] });
    f.beforePoll(() => { if (f.poll === 2) f.set({ marker, exists: false, rows: [processRow(456)] }); if (f.poll === 5) f.set({ rows: [] }); });
    expect(await f.run()).toEqual({ pid: 123, attempts: 2 }); expect(f.poll).toBeGreaterThanOrEqual(8);
    expect(f.observations.some(row => !row.marker && row.executableExists)).toBe(true); expect(f.observations.some(row => row.marker && row.processes.some((p: any) => p.pid === 456))).toBe(true);
  });
  it('resets the quiet window when a late installer child appears', async () => {
    const f = fixture(); f.set({ marker, exists: false, rows: [] });
    f.beforePoll(() => { if (f.poll === 3) f.set({ rows: [processRow(456)] }); if (f.poll === 4) f.set({ rows: [] }); });
    await f.run(); expect(f.poll).toBe(7);
  });
  it('fails immediately on bounded deletion exhaustion instead of removing the executable itself', async () => {
    const f = fixture(); f.set({ diagnostic: 'phase=deleting\nphase=delete-blocked\nattempts=40\n', exists: true });
    await expect(f.run()).rejects.toThrow('no harness deletion'); expect(f.observations[0].executableExists).toBe(true); expect(f.poll).toBe(1);
  });
  it('preserves no-reopen and executable-missing requirements', async () => {
    const f = fixture(); f.set({ marker, exists: true }); await expect(f.run()).rejects.toThrow('still present');
    const reopened = fixture(); reopened.set({ marker, exists: false, rows: [processRow(789, true)] }); await expect(reopened.run()).rejects.toThrow('reopened');
  });
  it('fails closed on incomplete evidence or a continuing installer tree, within a bound', async () => {
    const incomplete = fixture(); incomplete.set({ exists: false }); await expect(incomplete.run()).rejects.toThrow('Timed out'); expect(incomplete.poll).toBe(20);
    const running = fixture(); running.set({ marker, exists: false, rows: [processRow(456)] }); await expect(running.run()).rejects.toThrow('Timed out'); expect(running.poll).toBe(20);
  });
  it('propagates native inspection failure rather than treating it as an empty process list', async () => {
    await expect(observeRecoveryFixture({ marker: () => marker, diagnostic: () => undefined, executableExists: () => false, processes: async () => { throw Error('CIM observation failed'); }, record: () => {}, sleep: async () => {} })).rejects.toThrow('CIM observation failed');
  });
});

// Execute the SAME observer source under the production PowerShell 5.1 binary.
// Only its read-only CIM source is replaced with fictional process rows.
// Linux cannot establish PowerShell enumeration semantics; these remain skipped
// there and are required by the ordinary Windows unit-test job.
describe.skipIf(process.platform !== 'win32')('Windows PowerShell 5.1 fixture PID decoding', () => {
  const fictionalCim = String.raw`function Get-CimInstance {
    param([string]$ClassName)
    [pscustomobject]@{ ProcessId=101; ParentProcessId=0; ExecutablePath='D:\unrelated.exe'; CommandLine='fictional root' }
    [pscustomobject]@{ ProcessId=202; ParentProcessId=101; ExecutablePath='D:\child.exe'; CommandLine='fictional child' }
    [pscustomobject]@{ ProcessId=303; ParentProcessId=0; ExecutablePath='D:\other.exe'; CommandLine='fictional independent' }
  }; `;
  function nativeObserver(knownPids: string) {
    const systemRoot = process.env.SystemRoot || 'C:\\Windows';
    const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'));
    return execFileSync(join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; " + fictionalCim + recoveryFixtureProcessScript], {
      encoding: 'utf8', timeout: 15000, maxBuffer: 65536, stdio: ['ignore', 'pipe', 'pipe'], env: { ...environment,
        PSModulePath: join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules'),
        OTA_RECOVERY_KNOWN_PIDS: knownPids, OTA_RECOVERY_FIXTURE_PID: '', OTA_UPGRADE_EXECUTABLE: 'D:\\fixture\\app.exe',
        OTA_UPGRADE_DIRECTORY: 'D:\\fixture\\workspace', OTA_RECOVERY_INSTALLER: 'D:\\fixture-setup.exe' }
    });
  }
  it.each<[string, number[]]>([['[]', []], ['[101]', [101, 202]], ['[303]', [303]], ['[101,303]', [101, 202, 303]]])('observes validated known PID array %s', (known, expected) => {
    const result = JSON.parse(nativeObserver(known)); expect(result.processes.map((row: any) => row.pid).sort((a: number, b: number) => a - b)).toEqual(expected);
  }, 20000);
  it.each(['[[]]', '[{}]', '["101"]', '[true]', '[0]', '[-1]', '[4294967296]', '{}', '101', 'not-json'])('rejects non-scalar or malformed known PID payload %s', known => {
    expect(() => nativeObserver(known)).toThrow();
  }, 20000);
});
