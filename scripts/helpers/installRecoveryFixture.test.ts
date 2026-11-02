import { beforeAll, describe, expect, it } from 'vitest';
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

/** An expected parser rejection must be a real, diagnostic process exit. */
function assertNativePidRejection(run: () => unknown, expected: RegExp) {
  let failure: any;
  try { run(); } catch (error) { failure = error; }
  expect(failure, 'PowerShell must reject the malformed PID input').toBeDefined();
  expect(failure.code, 'Timeouts and launch failures are not parser rejection').not.toBe('ETIMEDOUT');
  expect(failure.signal, 'The process must exit rather than be terminated').toBeNull();
  expect(Number.isInteger(failure.status) && failure.status > 0, 'Expected a nonzero PowerShell exit status').toBe(true);
  expect(String(failure.stderr), 'Expected the specific PID validation/parser diagnostic').toMatch(expected);
}
describe('native PID rejection evidence', () => {
  const diagnostic = /Recovery fixture known PID must be a scalar UInt32/;
  it('accepts an actual nonzero exit with the expected validation diagnostic', () => {
    assertNativePidRejection(() => { throw { status: 1, signal: null, stderr: 'Recovery fixture known PID must be a scalar UInt32' }; }, diagnostic);
  });
  it.each([
    { code: 'ETIMEDOUT', status: null, signal: 'SIGTERM', stderr: 'Recovery fixture known PID must be a scalar UInt32' },
    { code: 'ENOENT', status: null, signal: null, stderr: '' },
    { status: 0, signal: null, stderr: 'Recovery fixture known PID must be a scalar UInt32' },
    { status: 1, signal: null, stderr: 'Command not recognized' }
  ])('does not count infrastructure/timeout/unrelated failure as valid rejection (%j)', failure => {
    expect(() => assertNativePidRejection(() => { throw failure; }, diagnostic)).toThrow();
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
  function invokePowerShell(script: string, knownPids: string, timeout: number) {
    const systemRoot = process.env.SystemRoot || 'C:\\Windows';
    const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'));
    return execFileSync(join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; " + script], {
      encoding: 'utf8', timeout, maxBuffer: 65536, stdio: ['ignore', 'pipe', 'pipe'], env: { ...environment,
        PSModulePath: join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules'),
        OTA_RECOVERY_KNOWN_PIDS: knownPids, OTA_RECOVERY_FIXTURE_PID: '', OTA_UPGRADE_EXECUTABLE: 'D:\\fixture\\app.exe',
        OTA_UPGRADE_DIRECTORY: 'D:\\fixture\\workspace', OTA_RECOVERY_INSTALLER: 'D:\\fixture-setup.exe' }
    });
  }
  // This prerequisite measures cold runtime/module readiness separately. It is
  // one mandatory attempt, not a retry of an observer case. In particular []
  // remains the first observer input and retains its 15-second process bound.
  beforeAll(() => {
    const started = Date.now(); console.info('NATIVE_POWERSHELL_READINESS_START');
    const output = invokePowerShell(`[Console]::Error.WriteLine('native-runtime-entered');
      $clock=[System.Diagnostics.Stopwatch]::StartNew()
      if ($PSVersionTable.PSVersion.Major -ne 5) { throw 'Windows PowerShell 5 is required' }
      $probe=ConvertFrom-Json -InputObject '{"ready":true}'
      $set=New-Object 'System.Collections.Generic.HashSet[uint32]'
      [void]$set.Add([uint32]1)
      if ($probe.ready -ne $true -or -not $set.Contains([uint32]1)) { throw 'Native runtime readiness failed' }
      [pscustomobject]@{ ready=$true; major=$PSVersionTable.PSVersion.Major; initializationMilliseconds=$clock.ElapsedMilliseconds } | ConvertTo-Json -Compress`, '[]', 60000);
    const ready = JSON.parse(output); expect(ready.ready).toBe(true); expect(ready.major).toBe(5); expect(Number.isFinite(ready.initializationMilliseconds)).toBe(true);
    console.info('NATIVE_POWERSHELL_READINESS_COMPLETE', JSON.stringify({ elapsedMilliseconds: Date.now() - started, initializationMilliseconds: ready.initializationMilliseconds }));
  }, 65000);
  function nativeObserver(knownPids: string) {
    const started = Date.now();
    try {
      return invokePowerShell("[Console]::Error.WriteLine('native-observer-entered'); " + fictionalCim + recoveryFixtureProcessScript + "; [Console]::Error.WriteLine('native-observer-completed')", knownPids, 15000);
    } finally { console.info('NATIVE_OBSERVER_ATTEMPT', JSON.stringify({ knownPids, elapsedMilliseconds: Date.now() - started })); }
  }
  it.each<[string, number[]]>([['[]', []], ['[101]', [101, 202]], ['[303]', [303]], ['[101,303]', [101, 202, 303]]])('observes validated known PID array %s', (known, expected) => {
    const result = JSON.parse(nativeObserver(known)); expect(result.processes.map((row: any) => row.pid).sort((a: number, b: number) => a - b)).toEqual(expected);
  }, 20000);
  it.each<[string, RegExp]>([
    ...['[[]]', '[{}]', '["101"]', '[true]', '[0]', '[-1]', '[4294967296]'].map(known => [known, /Recovery fixture known PID must be a scalar UInt32/] as [string, RegExp]),
    ['{}', /Recovery fixture known PIDs must be an array/], ['101', /Recovery fixture known PIDs must be an array/],
    ['not-json', /Invalid JSON/]
  ])('rejects non-scalar or malformed known PID payload %s', (known, diagnostic) => {
    assertNativePidRejection(() => nativeObserver(known), diagnostic);
  }, 20000);
});
