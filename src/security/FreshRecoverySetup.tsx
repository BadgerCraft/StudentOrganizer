import { useEffect, useId, useRef, useState } from 'react';
import type { OntarioTeacherDB } from '../db/database';
import { recoveryStore } from '../sync/backupStore';
import { getIdentityEpoch } from '../services/identityService';
import { installLegacyCaptureGate, pauseForNativeTransition } from './encryptedRuntime';
import { unwrapEncryption, type EncryptedFilePreview, type EncryptionStatus } from './encryptionBridge';
const button = 'rounded border px-4 py-2 disabled:opacity-50';
const primary = button + ' bg-blue-600 text-white border-blue-600';
/** Offline recovery never accepts an owner flag or decrypted work from a renderer. */
export function FreshRecoverySetup({ database, status, onBack, onDirtyChange, onBusyChange }: {
  database: OntarioTeacherDB; status: EncryptionStatus | null; onBack: () => void;
  onDirtyChange: (dirty: boolean) => void; onBusyChange: (busy: boolean) => void;
}) {
  const native = window.desktopEncryption, operatorId = useId();
  const [code, setCode] = useState(''), [preview, setPreview] = useState<EncryptedFilePreview | null>(null);
  const [operator, setOperator] = useState(''), [authorized, setAuthorized] = useState(false), [separate, setSeparate] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const pending = useRef(false), alive = useRef(true), owned = useRef(false), lifecycle = useRef(0), openingEpoch = useRef(getIdentityEpoch());
  useEffect(() => { alive.current = true; return () => { alive.current = false; lifecycle.current++; onDirtyChange(false); onBusyChange(false); if (owned.current) void native?.cancelOfflineRecovery().catch(() => {}); }; }, [native, onDirtyChange, onBusyChange]);
  useEffect(() => { onDirtyChange(Boolean(code || preview || busy)); onBusyChange(busy); }, [code, preview, busy, onDirtyChange, onBusyChange]);
  const assertCurrent = () => { if (!alive.current || openingEpoch.current !== getIdentityEpoch()) throw Error('Recovery context changed.'); };
  const run = async (action: () => Promise<void>) => {
    if (pending.current || !native) return; pending.current = true; const started = lifecycle.current; setBusy(true); setError(''); setNotice('');
    try { assertCurrent(); await action(); }
    catch { if (started === lifecycle.current) setError('Offline recovery was not verified. Use the saved recovery code and an intact complete backup for this app. A computer with an existing protected registration needs its supported recovery process; moving the app to a new folder does not reset that registration. Keep the separate original workspace and choose the backup again.'); }
    finally { pending.current = false; if (started === lifecycle.current) setBusy(false); }
  };
  const cancel = () => void run(async () => {
    unwrapEncryption(await native!.cancelOfflineRecovery()); owned.current = false; setCode(''); setPreview(null); setOperator(''); setAuthorized(false); setSeparate(false); assertCurrent(); onBack();
  });
  return <section aria-label="Offline recovery" className="space-y-4">
    <h3 className="font-semibold">Recover with an offline code and backup</h3>
    <p>The original computer is not needed. This option is for a computer without an existing protected Student Organizer registration. Moving the app to a new folder does not reset that registration.</p>
    <p>Any unprotected workspace here stays separate. Recovery does not merge its edits. Reconcile differing work before choosing which copy to use. Choose the teacher profile whose records you are recovering. This is a local profile selection, not a sign-in.</p>
    {!status?.activationReady && <p role="status">Recovery activation and device provisioning are unavailable on this build pending reviewed platform and real-device acceptance.</p>}
    {!preview ? <div className="space-y-3 rounded border p-4">
      <label className="block">Offline recovery code<input className="block w-full rounded border p-2" type="password" autoComplete="off" maxLength={128} value={code} disabled={busy} onChange={event => { if (!pending.current) setCode(event.target.value); }} /></label>
      <p>The code is sent only to the local native recovery process. It is cleared from this form when checking starts and is never saved in the workspace.</p>
      <button className={primary} disabled={busy || !status?.activationReady || !code} onClick={() => void run(async () => {
        const submitted = code; setCode(''); setOperator(''); setAuthorized(false); setSeparate(false); owned.current = true;
        const checked = unwrapEncryption(await native!.previewOfflineRecoveryFile(submitted)); assertCurrent();
        if (checked.cancelled) { unwrapEncryption(await native!.cancelOfflineRecovery()); owned.current = false; setNotice('Backup selection cancelled. No recovered workspace was created.'); return; }
        setPreview(checked);
      })}>Choose backup and verify recovery code</button>
    </div> : <>
      <div className="rounded border p-3"><p>Complete backup verified for review.</p><p className="text-sm">{new Date(preview.metadata.exportedAt).toLocaleString()} · {preview.metadata.totalRecords} records · {preview.metadata.tableCount} record groups.</p></div>
      <div className="space-y-3 rounded border p-4"><label className="block" htmlFor={operatorId}>Acting teacher for recovered workspace</label><select id={operatorId} className="block rounded border p-2" value={operator} disabled={busy} onChange={event => {
        if (pending.current) return; const value = event.target.value; setOperator(value); setAuthorized(false); setSeparate(false); if (!value) return;
        void run(async () => { const checked = unwrapEncryption(await native!.authorizeOfflineRecovery(preview.token, value)); assertCurrent(); setPreview({ ...checked, operators: checked.operators ?? preview.operators }); setAuthorized(true); });
      }}><option value="">Choose explicitly</option>{(preview.operators ?? []).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      {authorized && <p role="status">This acting profile is permitted to review the complete recovered workspace.</p>}
      <label className="flex gap-2"><input type="checkbox" checked={separate} disabled={busy || !authorized} onChange={event => { if (!pending.current) setSeparate(event.target.checked); }} />Keep any existing unprotected source separate and create this recovered encrypted working copy without merging.</label>
      <button className={primary} disabled={busy || !status?.activationReady || !authorized || !operator || !separate} onClick={() => void run(async () => {
        if (!confirm('Create the recovered encrypted copy? Any existing unprotected workspace remains separate; its edits are not merged.')) return;
        const gate = await installLegacyCaptureGate(database, recoveryStore); assertCurrent();
        try { await gate.withFinalReadLock(async () => { assertCurrent(); unwrapEncryption(await native!.applyOfflineRecovery(preview.token)); assertCurrent(); }); }
        finally { owned.current = false; setCode(''); pauseForNativeTransition(); }
      })}>Create recovered encrypted workspace</button></div>
    </>}
    <button className={button} disabled={busy} onClick={cancel}>Cancel offline recovery</button>
    {busy && <p role="status">Verifying offline recovery…</p>}{notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
