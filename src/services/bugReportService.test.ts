import { describe, it, expect } from 'vitest';
import {
  BUG_REPORT_DRAFT_KEY, clearBugReportDraft, createBugReportDraft, formatBugReport,
  getReportPlatform, loadBugReportDraft, saveBugReportDraft, type DraftStorage
} from './bugReportService';

function memoryStorage(): DraftStorage {
  const values = new Map<string, string>();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
}
function report() { return { ...createBugReportDraft('markbook'), summary: 'Column disappeared', actual: 'A blank column appeared.' }; }

describe('private report drafts and recovery', () => {
  it('restores both a report and teacher-edited preview without touching classroom storage', () => {
    const storage = memoryStorage();
    storage.setItem('classroom-records', 'leave unchanged');
    const draft = { ...report(), previewText: 'A teacher-edited report with the platform removed.' };
    expect(saveBugReportDraft(storage, draft).ok).toBe(true);
    const loaded = loadBugReportDraft(storage);
    expect(loaded).toEqual({ ok: true, value: draft });
    expect(formatBugReport(draft)).toBe(draft.previewText);
    expect(clearBugReportDraft(storage).ok).toBe(true);
    expect(loadBugReportDraft(storage)).toEqual({ ok: true, value: null });
    expect(storage.getItem('classroom-records')).toBe('leave unchanged');
  });
  it('reports quota failure without erasing the prior saved draft or changing the new in-memory report', () => {
    const storage = memoryStorage();
    const previous = report();
    saveBugReportDraft(storage, previous);
    const replacement = { ...previous, actual: 'New details still available for copying.' };
    const quotaStorage = { ...storage, setItem: () => { throw new Error('QuotaExceededError'); } };
    expect(saveBugReportDraft(quotaStorage, replacement).ok).toBe(false);
    expect(loadBugReportDraft(storage)).toEqual({ ok: true, value: previous });
    expect(formatBugReport(replacement)).toContain('New details still available for copying.');
  });
  it('leaves unreadable saved data intact for an explicit replacement decision', () => {
    const storage = memoryStorage();
    storage.setItem(BUG_REPORT_DRAFT_KEY, '{broken');
    expect(loadBugReportDraft(storage).ok).toBe(false);
    expect(storage.getItem(BUG_REPORT_DRAFT_KEY)).toBe('{broken');
    storage.setItem(BUG_REPORT_DRAFT_KEY, JSON.stringify({ ...report(), schemaVersion: 2 }));
    expect(loadBugReportDraft(storage).ok).toBe(false);
  });
  it('strips unknown stored fields before restoring and resaving a report', () => {
    const storage = memoryStorage();
    const draft = report();
    const withUnknown = { ...draft, classroomRecords: [{ studentNumber: 'fictional-secret' }], fullUserAgent: 'private-device-string' };
    storage.setItem(BUG_REPORT_DRAFT_KEY, JSON.stringify(withUnknown));
    const loaded = loadBugReportDraft(storage);
    expect(loaded).toEqual({ ok: true, value: draft });
    expect(saveBugReportDraft(storage, withUnknown).ok).toBe(true);
    const raw = storage.getItem(BUG_REPORT_DRAFT_KEY)!;
    expect(raw).not.toContain('classroomRecords');
    expect(raw).not.toContain('fullUserAgent');
    expect(raw).not.toContain('fictional-secret');
  });
  it('handles unavailable storage on both read and clear', () => {
    const unavailable = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('SecurityError'); }, removeItem: () => { throw new Error('SecurityError'); } };
    expect(loadBugReportDraft(unavailable).ok).toBe(false);
    expect(clearBugReportDraft(unavailable).ok).toBe(false);
  });
  it('does not overwrite a recoverable saved report with invalid or oversized content', () => {
    const storage = memoryStorage();
    const previous = report();
    saveBugReportDraft(storage, previous);
    expect(saveBugReportDraft(storage, { ...previous, actual: 'a'.repeat(2001) }).ok).toBe(false);
    expect(loadBugReportDraft(storage)).toEqual({ ok: true, value: previous });
  });
  it('collects coarse metadata only, never arbitrary current-view strings or full user agents', () => {
    const draft = createBugReportDraft('ENG4U: Fictional Teacher');
    expect(draft.screen).toBe('unknown');
    expect(Object.keys(draft).sort()).toEqual(['schemaVersion', 'id', 'summary', 'steps', 'expected', 'actual', 'appVersion', 'appBuild', 'platform', 'screen', 'previewText'].sort());
    expect(getReportPlatform('Mozilla/5.0 Macintosh detailed device information', 5)).toBe('iPadOS / iOS');
    expect(getReportPlatform('Mozilla/5.0 (Windows NT 10.0) detailed version')).toBe('Windows');
    const text = formatBugReport(draft);
    expect(text).not.toContain('ENG4U');
    expect(text).not.toContain('Mozilla');
  });
});
