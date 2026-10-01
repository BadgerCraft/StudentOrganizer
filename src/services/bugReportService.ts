import packageInfo from '../../package.json';

export const BUG_REPORT_DRAFT_KEY = 'ota.bug-report-draft.v1';
export const BUG_REPORT_LIMIT = 12000;
const SCREENS = ['dashboard', 'seating', 'markbook', 'assessments', 'participation', 'settings', 'portability'] as const;
export type ReportScreen = typeof SCREENS[number] | 'unknown';
export type ReportPlatform = 'Windows' | 'macOS' | 'iPadOS / iOS' | 'Android' | 'Linux' | 'Unknown';

export interface BugReportDraft {
  schemaVersion: 1;
  id: string;
  summary: string;
  steps: string;
  expected: string;
  actual: string;
  appVersion: string;
  appBuild: string;
  platform: ReportPlatform;
  screen: ReportScreen;
  previewText: string | null;
}
export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export type DraftResult<T> = { ok: true; value: T } | { ok: false; error: string };

// Only a coarse platform name leaves this helper. Never retain the full user agent.
export function getReportPlatform(userAgent: string, maxTouchPoints = 0): ReportPlatform {
  if (/iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)) return 'iPadOS / iOS';
  if (/Windows/.test(userAgent)) return 'Windows';
  if (/Android/.test(userAgent)) return 'Android';
  if (/Macintosh|Mac OS/.test(userAgent)) return 'macOS';
  if (/Linux/.test(userAgent)) return 'Linux';
  return 'Unknown';
}
export function createBugReportDraft(screen?: string): BugReportDraft {
  return {
    schemaVersion: 1, id: crypto.randomUUID(), summary: '', steps: '', expected: '', actual: '',
    appVersion: packageInfo.version,
    appBuild: /^[a-f0-9]{7,40}$/.test(import.meta.env.VITE_BUILD_SHA ?? '') ? import.meta.env.VITE_BUILD_SHA : 'unknown',
    platform: typeof navigator === 'undefined' ? 'Unknown' : getReportPlatform(navigator.userAgent, navigator.maxTouchPoints),
    screen: SCREENS.includes(screen as typeof SCREENS[number]) ? screen as ReportScreen : 'unknown',
    previewText: null
  };
}
export function isBugReportDraft(value: unknown): value is BugReportDraft {
  if (!value || typeof value !== 'object') return false;
  const d = value as Record<string, unknown>;
  return d.schemaVersion === 1 && typeof d.id === 'string' && d.id.length <= 80 &&
    ['summary', 'steps', 'expected', 'actual'].every(k => typeof d[k] === 'string' && (d[k] as string).length <= 2000) &&
    typeof d.appVersion === 'string' && /^[\w.+-]{1,80}$/.test(d.appVersion) &&
    (d.appBuild === undefined || (typeof d.appBuild === 'string' && /^(?:[a-f0-9]{7,40}|unknown)$/.test(d.appBuild))) &&
    ['Windows', 'macOS', 'iPadOS / iOS', 'Android', 'Linux', 'Unknown'].includes(d.platform as string) &&
    [...SCREENS, 'unknown'].includes(d.screen as ReportScreen) &&
    (d.previewText === null || (typeof d.previewText === 'string' && d.previewText.length <= BUG_REPORT_LIMIT));
}
// Normalization protects the stored draft and later preview from arbitrary fields
// introduced by stale/malformed local storage. It is never a classroom-data object.
export function normalizeBugReportDraft(draft: BugReportDraft): BugReportDraft {
  return {
    schemaVersion: 1, id: draft.id, summary: draft.summary, steps: draft.steps,
    expected: draft.expected, actual: draft.actual, appVersion: draft.appVersion,
    appBuild: draft.appBuild ?? 'unknown', platform: draft.platform, screen: draft.screen,
    previewText: draft.previewText
  };
}
export function loadBugReportDraft(storage: DraftStorage): DraftResult<BugReportDraft | null> {
  try {
    const raw = storage.getItem(BUG_REPORT_DRAFT_KEY);
    if (raw === null) return { ok: true, value: null };
    const parsed: unknown = JSON.parse(raw);
    if (!isBugReportDraft(parsed)) return { ok: false, error: 'The saved report draft could not be read. It has been kept unchanged. Start a new draft only when you are ready to replace it.' };
    return { ok: true, value: normalizeBugReportDraft(parsed) };
  } catch {
    return { ok: false, error: 'The saved report draft could not be read. Storage may be unavailable. Copy or download your report before closing.' };
  }
}
export function saveBugReportDraft(storage: DraftStorage, draft: BugReportDraft): DraftResult<void> {
  if (!isBugReportDraft(draft)) return { ok: false, error: 'The report is too long or invalid. Copy your text before closing.' };
  try {
    storage.setItem(BUG_REPORT_DRAFT_KEY, JSON.stringify(normalizeBugReportDraft(draft)));
    return { ok: true, value: undefined };
  } catch {
    return { ok: false, error: 'This draft could not be saved on this device. Keep this window open and copy or download the report before leaving.' };
  }
}
export function clearBugReportDraft(storage: DraftStorage): DraftResult<void> {
  try {
    storage.removeItem(BUG_REPORT_DRAFT_KEY);
    return { ok: true, value: undefined };
  } catch {
    return { ok: false, error: 'The saved draft could not be cleared. It may reappear next time you open this window.' };
  }
}
export function formatBugReport(draft: BugReportDraft): string {
  return draft.previewText ?? [
    `Ontario Teacher Assessment bug report`, `Report ID: ${draft.id}`, '',
    `Summary: ${draft.summary.trim()}`, '', `Steps to reproduce:\n${draft.steps.trim()}`, '',
    `Expected:\n${draft.expected.trim()}`, '', `What happened:\n${draft.actual.trim()}`, '',
    `App version: ${draft.appVersion}`, `Build: ${draft.appBuild}`, `Platform: ${draft.platform}`, `Screen: ${draft.screen}`
  ].join('\n');
}
export function canPreviewBugReport(draft: BugReportDraft): boolean {
  return !!draft.summary.trim() && !!draft.actual.trim();
}
