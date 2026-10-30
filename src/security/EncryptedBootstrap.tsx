import { ReceiverSetup } from './ReceiverSetup';
import type { EncryptionStatus } from './encryptionBridge';
import { protectedLaunchMarker } from './protectedLaunch';
import React, { lazy, Suspense, useEffect, useState, useSyncExternalStore } from 'react';
import { encryptedRuntimeStatus, initializeEncryptedRuntime } from './encryptedRuntime';
import { unwrapEncryption } from './encryptionBridge';
import { setRendererStorageMode } from './rendererStorageMode';
// The App imports the database singleton. Never evaluate it until the launch mode is verified.
const ProtectedApp = lazy(() => import('../App'));
let launch: Promise<EncryptionStatus | null> | null = null;
function ensureLaunch(): Promise<EncryptionStatus | null> {
  if (!launch) launch = (async () => {
    const native = window.desktopEncryption;
    if (!native) { if (protectedLaunchMarker()) throw Error('Protected native bridge is unavailable.'); setRendererStorageMode('legacy'); return null; }
    const status = unwrapEncryption(await native.status());
    if (status.appId !== 'student-organizer' || !['legacy', 'encrypted', 'enrollment-pending'].includes(status.mode)) throw Error('Invalid protected launch mode.');
    if (status.mode === 'legacy') { if (protectedLaunchMarker()) throw Error('Protected launch cannot select legacy storage.'); setRendererStorageMode('legacy'); }
    else if (status.mode === 'enrollment-pending') { if (!protectedLaunchMarker() || status.ephemeralPartition !== true) throw Error('Enrollment recovery requires secure startup.'); setRendererStorageMode('bootstrapping'); }
    else await initializeEncryptedRuntime(status, native);
    return status;
  })();
  return launch;
}
export function EncryptedBootstrap() {
  const [ready, setReady] = useState(false), [error, setError] = useState('');
  const [pendingEnrollment, setPendingEnrollment] = useState<EncryptionStatus | null>(null);
  const mode = useSyncExternalStore(encryptedRuntimeStatus.subscribe, encryptedRuntimeStatus.getSnapshot);
  useEffect(() => {
    let alive = true;
    void ensureLaunch().then(status => { if (alive) { if (status?.mode === 'enrollment-pending') setPendingEnrollment(status); else setReady(true); } }, () => { if (alive) setError('The workspace could not be opened securely. Your original workspace has not been selected as a fallback. Check native key access or use your verified recovery on the intended device.'); });
    return () => { alive = false; };
  }, []);
  if (error || mode === 'locked') return <main className="mx-auto max-w-xl p-8 space-y-4"><h1 className="text-xl font-semibold">Encrypted workspace locked</h1><p role="alert">{error || 'A protected save or context check could not be verified. Close and reopen this workspace to inspect its actual durable version before retrying. Pending writes were not replayed.'}</p><p>The preserved original workspace is separate. A locked encrypted workspace never opens it automatically.</p><button className="rounded border px-4 py-2" onClick={() => { const native = window.desktopEncryption; if (native) void native.reopenSecureStartup().then(unwrapEncryption).catch(() => setError('Secure startup could not be reopened. Close and relaunch the app; keep the preserved source and verified encrypted backup.')); else window.location.reload(); }}>Reopen secure startup</button></main>;
  if (pendingEnrollment) return <ReceiverSetup status={pendingEnrollment} />;
  return ready ? <Suspense fallback={<p role="status" className="p-8">Opening verified workspace…</p>}><ProtectedApp /></Suspense> : <p role="status" className="p-8">Checking workspace protection…</p>;
}
