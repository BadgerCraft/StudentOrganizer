import { useState } from 'react';
type Result = { status: 'available' | 'current' | 'unpublished' | 'unsupported' | 'error'; version?: string; installationAvailable?: false };
declare global { interface Window { desktopUpdates?: { platform: string; check: () => Promise<Result> }; } }
export function ManualWindowsUpdate() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>();
  if (window.desktopUpdates?.platform !== 'win32') return null;
  async function check() {
    setBusy(true);
    try { setResult(await window.desktopUpdates!.check()); }
    catch { setResult({ status: 'error' }); }
    finally { setBusy(false); }
  }
  const message = result?.status === 'available' ? `Version ${result.version} is available. Installation is unavailable until the update source and installer signature are verified. Your records have not changed.`
    : result?.status === 'current' ? 'This version is current for the stable release channel.'
    : result?.status === 'unpublished' ? 'No stable release is published. Your installed app remains available.'
    : result?.status === 'unsupported' ? 'Update checks require an installed Windows build.'
    : result?.status === 'error' ? 'The update could not be checked. Try again later. Your installed app and records have not changed.' : '';
  return <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-3" aria-label="Windows updates">
    <h2 className="text-base font-bold text-slate-900">Windows updates</h2>
    <p className="text-sm text-slate-600">Checks only when you click. This sends a release lookup to GitHub, with no classroom records or report drafts. Nothing downloads or installs automatically.</p>
    <button type="button" disabled={busy} onClick={check} className="px-4 py-2 rounded-lg bg-blue-600 text-white disabled:opacity-50">{busy ? 'Checking…' : 'Check for updates'}</button>
    <p role="status" className="text-sm text-slate-600">{message}</p>
  </section>;
}
