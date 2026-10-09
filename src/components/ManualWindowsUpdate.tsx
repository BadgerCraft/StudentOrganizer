import { useEffect, useState } from 'react';
import { db } from '../db/database';
import { PortabilityService } from '../services/portabilityService';
import { ModalDialog } from './ModalDialog';

type CheckResult = { status: 'available' | 'current' | 'unpublished' | 'unsupported' | 'error'; version?: string; installationAvailable?: boolean };
type InstallResult = {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'cancelled' | 'error' | 'unsupported' | 'current';
  installationAvailable: boolean; version?: string; percent?: number;
  signature?: 'unsigned' | 'valid'; publisher?: string; backupPath?: string; error?: string;
};
declare global {
  interface Window {
    desktopUpdates?: {
      platform: string; check: () => Promise<CheckResult>;
      status?: () => Promise<InstallResult>; download?: () => Promise<InstallResult>;
      cancel?: () => Promise<InstallResult>; install?: (backup: string, acknowledgeUnsigned: boolean) => Promise<InstallResult>;
    };
  }
}

export function ManualWindowsUpdate({ installationBlocked = false }: { installationBlocked?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CheckResult>();
  const [installer, setInstaller] = useState<InstallResult>();
  const [confirmInstall, setConfirmInstall] = useState(false);
  const [acknowledgeUnsigned, setAcknowledgeUnsigned] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [localError, setLocalError] = useState('');
  const bridge = window.desktopUpdates;

  // Local status reads never check for or download updates.
  useEffect(() => {
    if (bridge?.platform !== 'win32' || !bridge.status) return;
    let alive = true;
    const refresh = () => bridge.status!().then(value => { if (alive) setInstaller(value); }).catch(() => {});
    void refresh();
    const timer = setInterval(() => void refresh(), 500);
    return () => { alive = false; clearInterval(timer); };
  }, [bridge]);

  if (bridge?.platform !== 'win32') return null;
  async function check() {
    setBusy(true); setLocalError('');
    try { setResult(await bridge!.check()); }
    catch { setResult({ status: 'error' }); }
    finally { setBusy(false); }
  }
  async function download() {
    setBusy(true); setLocalError(''); setConfirmInstall(false); setAcknowledgeUnsigned(false);
    try { setInstaller(await bridge!.download!()); }
    catch { setLocalError('The update could not be downloaded. Your installed app and records have not changed.'); }
    finally { setBusy(false); }
  }
  async function cancel() {
    try { setInstaller(await bridge!.cancel!()); }
    catch { setLocalError('The download could not be cancelled. Wait for it to stop before trying again.'); }
  }
  async function install() {
    if (installationBlocked || preparing || !bridge?.install) return;
    if (installer?.signature === 'unsigned' && !acknowledgeUnsigned) return;
    setPreparing(true); setLocalError('');
    try {
      const service = new PortabilityService(db);
      const backup = await service.createFullBackupJSON();
      service.validateBackupJSON(backup);
      const outcome = await bridge.install(backup, acknowledgeUnsigned);
      setInstaller(outcome);
      if (outcome.status !== 'installing') setPreparing(false);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Backup or installation could not start. The app is still open.');
      setPreparing(false);
    }
  }

  const downloading = installer?.status === 'downloading';
  const ready = installer?.status === 'downloaded';
  const capable = result?.installationAvailable && bridge.download && bridge.install;
  const message = result?.status === 'available' ? `Version ${result.version} is available.${capable ? ' Download it when you are ready.' : ' Installation is unavailable for this build. Your records have not changed.'}`
    : result?.status === 'current' ? 'This version is current for the stable release channel.'
    : result?.status === 'unpublished' ? 'No stable release is published. Your installed app remains available.'
    : result?.status === 'unsupported' ? 'Update checks require a packaged Windows build.'
    : result?.status === 'error' ? 'The update could not be checked. Try again later. Your installed app and records have not changed.' : '';
  const button = 'px-4 py-2 rounded-lg bg-blue-600 text-white disabled:opacity-50';

  return <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-3" aria-label="Windows updates">
    <h2 className="text-base font-bold text-slate-900">Windows updates</h2>
    <p className="text-sm text-slate-600">Checks only when you click. Update requests go to GitHub with no classroom records or report drafts. You choose when to download and install. Installation saves a local recovery backup, closes the app, replaces the installed version and reopens it.</p>
    <div className="flex flex-wrap gap-3">
      <button type="button" disabled={busy || downloading || preparing || ready} onClick={check} className={button}>{busy && !downloading ? 'Working…' : 'Check for updates'}</button>
      {capable && !ready && <button type="button" disabled={busy || downloading || preparing} onClick={download} className={button}>Download update</button>}
      {downloading && bridge.cancel && <button type="button" onClick={cancel} className={button}>Cancel download</button>}
      {ready && <button type="button" disabled={installationBlocked || preparing} onClick={() => { setConfirmInstall(true); setAcknowledgeUnsigned(false); }} className={button}>Backup and install</button>}
    </div>
    <p role="status" className="text-sm text-slate-600">{message}</p>
    {downloading && <p role="status">Downloading update: {Math.floor(installer.percent ?? 0)}%</p>}
    {installer?.status === 'cancelled' && <p role="status">Download cancelled. Your installed app and records have not changed.</p>}
    {ready && <p role="status">Version {installer.version} downloaded and checked. It will only install when you choose.</p>}
    {installationBlocked && ready && <p className="text-sm text-amber-800">Save your Settings changes and close any open editor before installing.</p>}
    {(localError || installer?.error) && <p role="alert" className="text-sm text-red-700">{localError || installer?.error}</p>}
    <ModalDialog isOpen={confirmInstall} title="Install Windows update" hideHeader maxWidthClass="max-w-lg" onClose={() => { if (!preparing) setConfirmInstall(false); }}>
      <div className="space-y-4">
        <h3 className="text-lg font-bold">Install version {installer?.version}?</h3>
        <p>A recovery backup will be saved on this device before the app closes. Your classroom records stay in the same local profile. Windows may ask for permission to replace the application.</p>
        {installer?.signature === 'unsigned' && <div className="rounded-lg bg-amber-50 p-3 space-y-2">
          <p className="text-sm text-amber-900">This installer has no verified Windows publisher signature. Windows may warn or block it. Its download checksum was checked, but that does not verify the publisher.</p>
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={acknowledgeUnsigned} disabled={preparing} onChange={event => setAcknowledgeUnsigned(event.target.checked)} />I understand this installer is unsigned.</label>
        </div>}
        {installer?.signature === 'valid' && <p className="text-sm">Windows signature: {installer.publisher}</p>}
        {(localError || installer?.error) && <p role="alert" className="text-red-700">{localError || installer?.error}</p>}
        <div className="flex gap-3">
          <button type="button" disabled={preparing || installationBlocked || (installer?.signature === 'unsigned' && !acknowledgeUnsigned)} onClick={install} className={button}>{preparing ? 'Saving backup and installing…' : 'Install and reopen'}</button>
          <button type="button" disabled={preparing} onClick={() => setConfirmInstall(false)} className="px-4 py-2 rounded-lg border">Later</button>
        </div>
      </div>
    </ModalDialog>
  </section>;
}
