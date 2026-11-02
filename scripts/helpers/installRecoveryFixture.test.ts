import { describe, expect, it } from 'vitest';
import { observeRecoveryFixture, parseRecoveryFixtureMarker, type RecoveryFixtureProcess } from './installRecoveryFixture';
const marker = 'format=student-organizer-install-failure-v1\r\nphase=deleted\r\npid=123\r\nattempts=2\r\n';
const process = (pid: number, installedApp = false): RecoveryFixtureProcess => ({ pid, parentPid: 123, path: 'fictional.exe', commandLine: 'fictional', installedApp });
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
    const f = fixture(); f.set({ diagnostic: 'phase=deleting\n', rows: [process(123)] });
    f.beforePoll(() => { if (f.poll === 2) f.set({ marker, exists: false, rows: [process(456)] }); if (f.poll === 5) f.set({ rows: [] }); });
    expect(await f.run()).toEqual({ pid: 123, attempts: 2 }); expect(f.poll).toBeGreaterThanOrEqual(8);
    expect(f.observations.some(row => !row.marker && row.executableExists)).toBe(true); expect(f.observations.some(row => row.marker && row.processes.some((p: any) => p.pid === 456))).toBe(true);
  });
  it('resets the quiet window when a late installer child appears', async () => {
    const f = fixture(); f.set({ marker, exists: false, rows: [] });
    f.beforePoll(() => { if (f.poll === 3) f.set({ rows: [process(456)] }); if (f.poll === 4) f.set({ rows: [] }); });
    await f.run(); expect(f.poll).toBe(7);
  });
  it('fails immediately on bounded deletion exhaustion instead of removing the executable itself', async () => {
    const f = fixture(); f.set({ diagnostic: 'phase=deleting\nphase=delete-blocked\nattempts=40\n', exists: true });
    await expect(f.run()).rejects.toThrow('no harness deletion'); expect(f.observations[0].executableExists).toBe(true); expect(f.poll).toBe(1);
  });
  it('preserves no-reopen and executable-missing requirements', async () => {
    const f = fixture(); f.set({ marker, exists: true }); await expect(f.run()).rejects.toThrow('still present');
    const reopened = fixture(); reopened.set({ marker, exists: false, rows: [process(789, true)] }); await expect(reopened.run()).rejects.toThrow('reopened');
  });
  it('fails closed on incomplete evidence or a continuing installer tree, within a bound', async () => {
    const incomplete = fixture(); incomplete.set({ exists: false }); await expect(incomplete.run()).rejects.toThrow('Timed out'); expect(incomplete.poll).toBe(20);
    const running = fixture(); running.set({ marker, exists: false, rows: [process(456)] }); await expect(running.run()).rejects.toThrow('Timed out'); expect(running.poll).toBe(20);
  });
  it('propagates native inspection failure rather than treating it as an empty process list', async () => {
    await expect(observeRecoveryFixture({ marker: () => marker, diagnostic: () => undefined, executableExists: () => false, processes: async () => { throw Error('CIM observation failed'); }, record: () => {}, sleep: async () => {} })).rejects.toThrow('CIM observation failed');
  });
});
