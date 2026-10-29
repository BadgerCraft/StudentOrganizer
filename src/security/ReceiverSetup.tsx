import { useId, useRef, useState } from 'react';
import { unwrapEncryption, type EncryptionStatus } from './encryptionBridge';
const button = 'rounded border px-4 py-2 disabled:opacity-50';
export function ReceiverSetup({ status }: { status: EncryptionStatus }) {
  const [token, setToken] = useState(''), [metadata, setMetadata] = useState<{ exportedAt: string; totalRecords: number; tableCount: number } | null>(null);
  const [operators, setOperators] = useState<{ id: string; name: string }[]>([]), [operator, setOperator] = useState(''), [disposition, setDisposition] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [completed, setCompleted] = useState(''); const pending = useRef(false), generation = useRef(0), fileTicket = useRef('');
  const native = window.desktopEncryption, operatorId = useId();
  const run = async (action: () => Promise<void>) => { if (pending.current || !native) return; pending.current = true; setBusy(true); setError(''); try { await action(); } catch { setError('This recovery step was not verified. Keep the original source and encrypted backup. Check the intended app, device and recovery enrollment, then choose the intact full encrypted backup again.'); } finally { pending.current = false; setBusy(false); } };
  const chooseFile = async () => { const latest = ++generation.current; fileTicket.current = ''; setToken(''); setMetadata(null); setOperator(''); setDisposition(''); const checked = unwrapEncryption(await native!.previewRecoveryFile()); if (latest !== generation.current || checked.cancelled) return; fileTicket.current = checked.token; setToken(checked.token); setMetadata(checked.metadata); setOperators(checked.operators || []); };
  return <main className="mx-auto max-w-2xl p-8 space-y-4"><h1 className="text-xl font-semibold">Finish this computer’s encrypted workspace</h1>
    <p>This device has completed key enrollment. It needs a verified full encrypted backup from the original computer before a classroom workspace can open. No empty workspace is created as a fallback.</p>
    {status.enrollmentResponse && <label className="block">Response for the original computer<textarea className="block w-full rounded border p-2" readOnly value={JSON.stringify(status.enrollmentResponse)} /></label>}
    <p>Any original unprotected workspace on this computer remains separate. Importing this copy does not merge its edits. Reconcile differing work before choosing which copy to use.</p>
    {!status.activationReady && <p role="status">Recovery activation is unavailable until reviewed platform and real-device acceptance is enabled.</p>}
    {!completed && <fieldset disabled={busy} className="space-y-3"><legend className="font-semibold">Verify the original computer’s full encrypted backup</legend>
      <button className={button} disabled={!status.activationReady} onClick={() => void run(chooseFile)}>Choose full encrypted backup file</button>
      {metadata && <><p>Backup dated {new Date(metadata.exportedAt).toLocaleString()} · {metadata.totalRecords} records · {metadata.tableCount} record groups.</p>
        <div><label className="block" htmlFor={operatorId}>Confirm the intended teacher or owner</label><select id={operatorId} className="block rounded border p-2" value={operator} onChange={event => { if (pending.current) return; const value = event.target.value, reviewed = fileTicket.current; setOperator(value); setToken(''); if (!value) return; void run(async () => { const checked = unwrapEncryption(await native!.authorizeRecovery(reviewed, value)); fileTicket.current = checked.token; setToken(checked.token); setMetadata(checked.metadata); }); }}><option value="">Choose explicitly</option>{operators.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <label className="block"><input type="radio" name="receiver-source-choice" checked={disposition === 'separate'} onChange={() => setDisposition('separate')} /> Keep any original source separate and create this verified encrypted working copy.</label>
        <label className="block"><input type="radio" name="receiver-source-choice" checked={disposition === 'reconcile'} onChange={() => setDisposition('reconcile')} /> Cancel enrollment and reconcile the original work first.</label>
        <button className={button} disabled={!status.activationReady || !token || !operator || disposition !== 'separate'} onClick={() => void run(async () => { if (!confirm('Create this encrypted copy without merging the separate original source?')) return; unwrapEncryption(await native!.applyRecovery(token)); setToken(''); setCompleted('The encrypted copy was created. Secure startup is reopening; no queued import will be replayed.'); })}>Create this computer’s encrypted copy</button>
      </>}
      <button className={button} onClick={() => void run(async () => { if (!confirm('Cancel this incomplete enrollment and reopen the separate original workspace?')) return; unwrapEncryption(await native!.cancelEnrollment()); setCompleted('Enrollment cancelled. The original source is reopening. If no window opens, close and relaunch the app.'); })}>Cancel enrollment and keep original workspace</button>
    </fieldset>}
    {busy && <p role="status">Verifying encrypted recovery…</p>}{error && <p role="alert">{error}</p>}{completed && <p role="status">{completed}</p>}
  </main>;
}
