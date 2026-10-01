import { useEffect, useState } from 'react';

/** Web-only installation status; does not inspect, upload, or change student records. */
export function OfflineAppStatus() {
  const [ready, setReady] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [storageMessage, setStorageMessage] = useState('');
  const eligible = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';

  useEffect(() => {
    if (!eligible || !('serviceWorker' in navigator) || !import.meta.env.PROD) return;
    let mounted = true;
    const onlineChanged = () => setOffline(!navigator.onLine);
    window.addEventListener('online', onlineChanged);
    window.addEventListener('offline', onlineChanged);
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' })
      .then(registration => {
        const inspect = () => {
          if (!mounted) return;
          setReady(!!registration.active);
          setWaiting(!!registration.waiting);
        };
        const watchInstalling = () => registration.installing?.addEventListener('statechange', inspect);
        inspect();
        watchInstalling();
        registration.addEventListener('updatefound', watchInstalling);
        navigator.serviceWorker.ready.then(() => { if (mounted) setReady(true); });
      })
      .catch(() => { if (mounted) setFailed(true); });
    return () => {
      mounted = false;
      window.removeEventListener('online', onlineChanged);
      window.removeEventListener('offline', onlineChanged);
    };
  }, [eligible]);

  if (!eligible || !import.meta.env.PROD) return null;

  const requestStorage = async () => {
    try {
      const kept = await navigator.storage?.persist?.();
      setStorageMessage(kept
        ? 'Browser storage protection granted. Keep regular backups.'
        : 'Storage protection was not granted. Keep regular backups in Files.');
    } catch {
      setStorageMessage('Storage protection is unavailable. Keep regular backups in Files.');
    }
  };

  return (
    <aside className="web-app-status border-b border-blue-100 bg-blue-50 px-4 py-2 text-xs text-blue-950" aria-label="Offline and device storage">
      <details>
        <summary className="cursor-pointer min-h-6" data-testid="offline-app-status">
          {failed ? 'Offline setup unavailable. Reopen online and try again.' : ready ? offline ? 'Offline · app available on this device' : 'Ready for offline use on this device' : 'Preparing offline use. Stay online until ready.'}
          {waiting && ' · Update ready: save work, then close all app windows and reopen.'}
        </summary>
        <div className="space-y-2 pt-2 max-w-3xl">
          <p>On iPad: open the approved HTTPS address in Safari, tap Share, then Add to Home Screen. Open the Home Screen app online and wait for this ready message before working offline.</p>
          <p>Records stay in this browser or Home Screen app. Safari and the Home Screen app can have separate records. Use Import/Export to save a backup in Files and restore it on another device. Restore replaces the destination records; it does not combine changes.</p>
          <p>Clearing website data or removing the app can lose local records. Save regular backups and check that the file appears in Files. A browser storage request cannot guarantee recovery.</p>
          <button type="button" className="rounded border border-blue-300 px-3 py-2 font-semibold" onClick={requestStorage}>Request storage protection</button>
          {storageMessage && <p role="status">{storageMessage}</p>}
        </div>
      </details>
    </aside>
  );
}
