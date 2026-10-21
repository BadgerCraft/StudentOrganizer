import { useEffect, useRef, useState } from 'react';
export type DriveReply<T> = { ok: true; value: T } | { ok: false; message: string };
export interface DriveUpload { id: string; name: string; assignmentName: string; size: number; modifiedTime: string }
type DriveStatus = { configured: boolean; connected: boolean };
export interface CaptureDriveBridge {
  status(): Promise<DriveReply<DriveStatus>>;
  connect(): Promise<DriveReply<DriveStatus>>;
  list(): Promise<DriveReply<DriveUpload[]>>;
  download(id: string): Promise<DriveReply<{ name: string; bytes: Uint8Array }>>;
  cancel(): Promise<DriveReply<{ cancelled: boolean }>>;
  disconnect(): Promise<DriveReply<DriveStatus>>;
}
declare global { interface Window { desktopCaptureDrive?: CaptureDriveBridge } }
function value<T>(reply: DriveReply<T>): T { if (!reply.ok) throw new Error(reply.message); return reply.value; }
const button = 'rounded-lg border border-slate-400 px-3 py-2 disabled:opacity-50';
export function DriveCapturePicker({ disabled, onLoad }: { disabled: boolean; onLoad: (load: () => Promise<File>) => Promise<void> }) {
  const api = window.desktopCaptureDrive;
  const [status, setStatus] = useState<DriveStatus | null>(null), [files, setFiles] = useState<DriveUpload[]>([]);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [opened, setOpened] = useState(false);
  const generation = useRef(0), lock = useRef(false);
  useEffect(() => {
    const started = ++generation.current;
    if (api) void api.status().then(reply => { if (generation.current === started) setStatus(value(reply)); }).catch(() => { if (generation.current === started) setMessage('Drive status unavailable. Use a local ZIP.'); });
    return () => { generation.current++; if (api) void api.disconnect().catch(() => {}); };
  }, [api]);
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setMessage('');
    const started = generation.current;
    try { await action(); }
    catch (error) { if (started === generation.current) setMessage(error instanceof Error ? error.message : 'Drive action failed. Retry or use a local ZIP.'); }
    finally { lock.current = false; if (started === generation.current) { setBusy(false); if (api) void api.status().then(reply => { if (started === generation.current) setStatus(value(reply)); }).catch(() => {}); } }
  }
  async function refresh(connect: boolean) {
    if (!api) return;
    const started = generation.current;
    setFiles([]);
    if (connect) value(await api.connect());
    if (started !== generation.current) return;
    const uploads = value(await api.list());
    if (started === generation.current) { setFiles(uploads); setOpened(true); setMessage(uploads.length ? 'Choose an upload. You will review its page sets and confirm each student locally.' : 'No available capture ZIPs. Use the same Google account and approved app project as the phone, or use a local ZIP.'); }
  }
  if (!api) return <p className="text-sm">Direct private Drive retrieval is available in the installed desktop app. Local ZIP import works here.</p>;
  return <section aria-label="Private Drive uploads" className="rounded-lg border p-3 space-y-2">
    <h3 className="font-semibold">Import from private Drive</h3>
    <p className="text-sm">Choose a completed phone upload without downloading it yourself. Matches stay local; uploads are never deleted. Connect only to the account used on your phone. Access ends when you leave this matching screen.</p>
    {status && !status.configured && <p>Desktop Drive setup has not been approved/configured. Use the local ZIP option below. Setup instructions: docs/DESKTOP_DRIVE_SETUP.md in the project.</p>}
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={disabled || busy || !status?.configured} onClick={() => void run(() => refresh(!status?.connected))}>{status?.connected ? 'Refresh Drive uploads' : 'Connect Google Drive'}</button>
      {status?.connected && <button type="button" className={button} disabled={busy || disabled} onClick={() => void run(async () => { setStatus(value(await api.disconnect())); setFiles([]); setOpened(false); })}>Disconnect Drive</button>}
      {busy && <button type="button" className={button} onClick={() => void api.cancel().catch(() => setMessage('Cancellation unavailable. Close this matching screen.'))}>Cancel Drive action</button>}
    </div>
    {busy && <p role="status">Working with Drive… You can cancel.</p>}
    {message && <p role="status">{message}</p>}
    {opened && <ul className="max-h-64 overflow-auto space-y-2">{files.map(file => <li key={file.id}>
      <button type="button" className={`${button} text-left break-all`} disabled={busy || disabled} onClick={() => void run(async () => {
        const started = generation.current;
        await onLoad(async () => {
          const download = value(await api.download(file.id));
          if (started !== generation.current) throw new Error('Matching screen changed. Reopen under the intended teacher.');
          return new File([new Uint8Array(download.bytes)], download.name, { type: 'application/zip' });
        });
      })}>Import {file.assignmentName} · {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB{file.modifiedTime ? ` · ${file.modifiedTime}` : ''}</button>
    </li>)}</ul>}
  </section>;
}
