import { useEffect, useRef, useState } from 'react';
import { db } from '../db/database';
import { PortabilityService } from '../services/portabilityService';
import { runOneClickUpdate, UpdateFlowError } from '../services/oneClickUpdate';
import { setUpdateLocked } from '../services/updateSafety';
import type { CheckResult, InstallResult } from './ManualWindowsUpdate';

export function StartupUpdateBanner({ safetyReason, onBusyChange }: {
  safetyReason: () => string | undefined;
  onBusyChange: (busy: boolean) => void;
}) {
  const bridge = window.desktopUpdates;
  const [offer, setOffer] = useState<CheckResult>();
  const [activeOffer, setActiveOffer] = useState<CheckResult>();
  const [progress, setProgress] = useState<InstallResult>();
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('');
  const [error, setError] = useState('');
  const running = useRef(false);
  const installingNow = useRef(false);
  const cancelled = useRef(false);
  const latestSafety = useRef(safetyReason); latestSafety.current = safetyReason;
  useEffect(() => {
    if (bridge?.mode !== 'github-release' || !bridge.startupStatus) return;
    let alive = true, polling = false;
    const refresh = async () => {
      if (polling) return;
      polling = true;
      try {
        const value = await bridge.startupStatus!();
        if (alive) setOffer(value);
        if (running.current && bridge.status) { const value = await bridge.status(); if (alive) setProgress(value); }
      } catch { /* Startup errors are surfaced by the main process cache or Settings retry. */ }
      finally { polling = false; }
    };
    void refresh(); const timer = setInterval(() => void refresh(), 500);
    return () => { alive = false; clearInterval(timer); };
  }, [bridge]);

  const displayedOffer = busy ? activeOffer : offer;
  if (bridge?.mode !== 'github-release' || displayedOffer?.status !== 'available') return null;
  const capable = displayedOffer.installationAvailable === true && !!bridge.download && !!bridge.install;
  async function update() {
    if (running.current || !capable) return;
    const reason = latestSafety.current();
    if (reason) { setError(reason); return; }
    running.current = true; installingNow.current = false; cancelled.current = false; setActiveOffer(displayedOffer); setBusy(true); setError(''); setPhase('Downloading and verifying update…');
    // Lock immediately, before any asynchronous work or React render. No drafts are discarded.
    setUpdateLocked(true); onBusyChange(true);
    let installing = false;
    try {
      const outcome = await runOneClickUpdate({
        download: () => bridge!.download!(), install: (backup, acknowledge) => bridge!.install!(backup, acknowledge),
        backup: async () => { const service = new PortabilityService(db); const backup = await service.createFullBackupJSON(); service.validateBackupJSON(backup); return backup; },
        safetyReason: () => latestSafety.current(), cancelled: () => cancelled.current,
        onResult: setProgress,
        onPhase: phase => {
          if (phase === 'install') installingNow.current = true;
          setPhase(phase === 'download' ? 'Downloading and verifying update…' : phase === 'backup' ? 'Saving local recovery backup…' : 'Installing and restarting…');
        }
      });
      installing = outcome === 'installing';
      if (!installing) setPhase('Update cancelled. Your work is unchanged.');
    } catch (cause) {
      setPhase('');
      // Never echo database/IPC exceptions which might contain classroom data.
      setError(cause instanceof UpdateFlowError ? cause.message : 'The update was stopped safely. Your work is still open. Save any open edits, then retry. If it keeps failing, check Settings for update support.');
    } finally {
      if (!installing) { running.current = false; installingNow.current = false; setUpdateLocked(false); onBusyChange(false); setBusy(false); }
    }
  }
  async function cancel() {
    if (!running.current || installingNow.current) return;
    cancelled.current = true;
    setPhase('Cancelling update…');
    try { await bridge!.cancel?.(); } catch { setError('Cancellation is pending. Wait for the update operation to stop.'); }
  }
  return <section aria-label="Update available" className="bg-emerald-100 text-emerald-800 border-b border-emerald-300 px-4 py-3 flex flex-wrap items-center justify-between gap-3" data-testid="startup-update-banner">
    <div className="min-w-0"><p className="font-semibold">Student Organizer {displayedOffer.version} is available</p>
      <p className="text-sm" role="status">{busy ? progress?.status === 'downloading' ? `Downloading update: ${Math.floor(progress.percent ?? 0)}%` : phase : !capable ? displayedOffer.message || 'Automatic installation is unavailable for this build. Keep using this version.' : phase || 'Update saves a recovery backup on this device, then restarts the app.'}</p>
      {error && <p role="alert" className="text-sm font-medium">{error}</p>}
    </div>
    <div className="flex gap-2 shrink-0">
      <button type="button" onClick={() => void update()} disabled={!capable || busy} className="rounded-lg bg-emerald-800 px-4 py-2 text-white font-semibold disabled:opacity-50">{busy ? 'Updating…' : 'Update and restart'}</button>
      {busy && phase !== 'Installing and restarting…' && <button type="button" onClick={() => void cancel()} className="rounded-lg border border-emerald-800 px-3 py-2">Cancel update</button>}
    </div>
  </section>;
}
