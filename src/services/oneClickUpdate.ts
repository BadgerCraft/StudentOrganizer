import type { InstallResult } from '../components/ManualWindowsUpdate';
export class UpdateFlowError extends Error {}
export type OneClickUpdateDependencies = {
  download: () => Promise<InstallResult>;
  install: (backup: string, acknowledgeUnsigned: boolean) => Promise<InstallResult>;
  backup: () => Promise<string>;
  safetyReason: () => string | undefined;
  cancelled: () => boolean;
  onPhase: (phase: 'download' | 'backup' | 'install') => void;
  onResult: (result: InstallResult) => void;
};
/** Runs only after the view obtains its synchronous single-flight/UI lock. */
export async function runOneClickUpdate(deps: OneClickUpdateDependencies): Promise<'cancelled' | 'installing'> {
  const assertSafe = () => { const reason = deps.safetyReason(); if (reason) throw new UpdateFlowError(reason); };
  assertSafe(); deps.onPhase('download');
  const downloaded = await deps.download(); deps.onResult(downloaded);
  if (deps.cancelled() || downloaded.status === 'cancelled') return 'cancelled';
  if (downloaded.status !== 'downloaded') throw new UpdateFlowError(downloaded.error || 'The update could not be downloaded and verified. Try again.');
  if (downloaded.signature !== 'valid') throw new UpdateFlowError('This update has no trusted publisher signature. It has not been installed.');
  assertSafe(); deps.onPhase('backup');
  const backup = await deps.backup();
  if (deps.cancelled()) return 'cancelled';
  assertSafe(); deps.onPhase('install');
  const result = await deps.install(backup, false); deps.onResult(result);
  if (result.status !== 'installing') throw new UpdateFlowError(result.error || 'Installation did not start. Your work is still open.');
  return 'installing';
}
