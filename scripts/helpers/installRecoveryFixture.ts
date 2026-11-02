/** CI fixture evidence only. Never deletes, kills or repairs an installation. */
export type RecoveryFixtureMarker = { pid: number; attempts: number };
export type RecoveryFixtureProcess = { pid: number; parentPid: number; path: string | null; commandLine: string | null; installedApp: boolean };
export function parseRecoveryFixtureMarker(text: string): RecoveryFixtureMarker {
  const match = /^format=student-organizer-install-failure-v1\r?\nphase=deleted\r?\npid=([1-9][0-9]*)\r?\nattempts=([1-9][0-9]*)\r?\n$/.exec(text);
  if (!match) throw new Error('Recovery fixture deletion marker is invalid');
  const pid = Number(match[1]), attempts = Number(match[2]);
  if (!Number.isSafeInteger(pid) || pid > 0xffffffff || attempts > 40) throw new Error('Recovery fixture deletion marker is out of bounds');
  return { pid, attempts };
}
export async function observeRecoveryFixture(options: {
  marker: () => string | undefined; diagnostic: () => string | undefined;
  executableExists: () => boolean; processes: (pid: number | undefined) => Promise<RecoveryFixtureProcess[]>;
  record: (observation: unknown) => void; now?: () => number; sleep: (milliseconds: number) => Promise<void>;
  timeout?: number; quietMilliseconds?: number;
}): Promise<RecoveryFixtureMarker> {
  const now = options.now || Date.now, deadline = now() + (options.timeout ?? 120000), quietMilliseconds = options.quietMilliseconds ?? 1500;
  let marker: RecoveryFixtureMarker | undefined, quietSince: number | undefined;
  while (now() < deadline) {
    const text = options.marker(), diagnostic = options.diagnostic();
    if (text !== undefined) marker = parseRecoveryFixtureMarker(text);
    const processes = await options.processes(marker?.pid), executableExists = options.executableExists();
    options.record({ time: new Date(now()).toISOString(), marker, diagnostic, executableExists, processes });
    if (marker && processes.some(row => row.installedApp)) throw new Error('A failed replacement reopened the installed app; fixture observation stopped');
    if (diagnostic && /(?:^|\r?\n)phase=(?:missing-before-delete|delete-blocked|marker-write-failed)(?:\r?\n|$)/.test(diagnostic)) throw new Error('NSIS could not verify deliberate executable deletion; inspect fixture diagnostics (no harness deletion attempted)');
    if (marker && executableExists) throw new Error('NSIS deletion marker conflicts with the installed executable still present');
    if (marker && processes.length === 0) {
      quietSince ??= now();
      if (now() - quietSince >= quietMilliseconds) return marker;
    } else quietSince = undefined;
    await options.sleep(250);
  }
  throw new Error('Timed out observing verified NSIS deletion and installer-tree quiescence; inspect fixture observations (no harness deletion attempted)');
}
