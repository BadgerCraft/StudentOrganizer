export type AppTheme = 'dark' | 'light';
const KEY = 'student-organizer-appearance';

/** Device-local appearance only; no student records or remote settings. */
export function readTheme(): AppTheme {
  try { return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'; }
  catch { return 'dark'; }
}
export function applyTheme(theme: AppTheme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}
export function saveTheme(theme: AppTheme) {
  localStorage.setItem(KEY, theme);
  applyTheme(theme);
}
