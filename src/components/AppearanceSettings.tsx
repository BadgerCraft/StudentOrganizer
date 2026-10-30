import { useEffect, useRef, useState } from 'react';
import { readTheme, saveTheme, type AppTheme } from '../services/theme';

export function AppearanceSettings({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) {
  const [theme, setTheme] = useState(readTheme);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const pending = useRef(false);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  return <section aria-label="Appearance" className="bg-white border border-slate-200 rounded-2xl p-6">
    <h2 className="text-lg font-semibold mb-2">Appearance</h2>
    <p className="text-sm text-slate-500 mb-4">Choose the appearance on this computer. New installations start in dark mode.</p>
    <label className="flex items-center gap-3">Theme<select aria-label="Theme" value={theme} disabled={busy} onChange={async event => {
      if (pending.current) return; pending.current = true; setBusy(true);
      const next = event.target.value as AppTheme;
      try { await saveTheme(next); setTheme(next); setError(''); }
      catch { setError('Appearance save was not verified. Reopen this workspace to check its saved choice before retrying.'); }
      finally { pending.current = false; setBusy(false); }
    }} className="border rounded-lg px-3 py-2"><option value="dark">Dark</option><option value="light">Light</option></select></label>
    {busy && <p role="status">Saving appearance…</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
