import { useState } from 'react';
import { readTheme, saveTheme, type AppTheme } from '../services/theme';

export function AppearanceSettings() {
  const [theme, setTheme] = useState(readTheme);
  const [error, setError] = useState('');
  return <section aria-label="Appearance" className="bg-white border border-slate-200 rounded-2xl p-6">
    <h2 className="text-lg font-semibold mb-2">Appearance</h2>
    <p className="text-sm text-slate-500 mb-4">Choose the appearance on this computer. New installations start in dark mode.</p>
    <label className="flex items-center gap-3">Theme<select aria-label="Theme" value={theme} onChange={event => {
      const next = event.target.value as AppTheme;
      try { saveTheme(next); setTheme(next); setError(''); }
      catch { setError('Appearance could not be saved on this computer. Your previous choice is unchanged.'); }
    }} className="border rounded-lg px-3 py-2"><option value="dark">Dark</option><option value="light">Light</option></select></label>
    {error && <p role="alert">{error}</p>}
  </section>;
}
