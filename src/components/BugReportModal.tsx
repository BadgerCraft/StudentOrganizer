import React, { useEffect, useState } from 'react';
import { ModalDialog } from './ModalDialog';
import { downloadFile } from '../utils/downloadFile';
import {
  BUG_REPORT_LIMIT, canPreviewBugReport, clearBugReportDraft, createBugReportDraft,
  formatBugReport, loadBugReportDraft, saveBugReportDraft, type BugReportDraft
} from '../services/bugReportService';

interface BugReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentView?: string;
}
const buttonClass = 'min-h-11 px-4 py-2 rounded-lg border border-slate-300 text-sm font-medium hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed';

export const BugReportModal: React.FC<BugReportModalProps> = ({ isOpen, onClose, currentView }) => {
  const [draft, setDraft] = useState(() => createBugReportDraft(currentView));
  const [preview, setPreview] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [saved, setSaved] = useState(false);
  const [unreadableDraft, setUnreadableDraft] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    try {
      const loaded = loadBugReportDraft(window.localStorage);
      setDraft(loaded.ok && loaded.value ? loaded.value : createBugReportDraft(currentView));
      setSaved(loaded.ok && !!loaded.value);
      setStorageError(loaded.ok ? '' : loaded.error);
      setUnreadableDraft(!loaded.ok);
    } catch {
      setDraft(createBugReportDraft(currentView));
      setSaved(false);
      setStorageError('Local storage is unavailable. Copy or download your report before closing.');
      setUnreadableDraft(false);
    }
    setPreview(false);
    setActionMessage('');
  }, [isOpen]);

  const updateDraft = (next: BugReportDraft) => {
    setDraft(next);
    setActionMessage('');
    try {
      const result = saveBugReportDraft(window.localStorage, next);
      setSaved(result.ok);
      setStorageError(result.ok ? '' : result.error);
    } catch {
      setSaved(false);
      setStorageError('Local storage is unavailable. Copy or download your report before closing.');
    }
  };
  const startNew = () => {
    if (!window.confirm('Clear the saved report draft and start a new one?')) return;
    try {
      const result = clearBugReportDraft(window.localStorage);
      if (!result.ok) { setStorageError(result.error); return; }
    } catch {
      setStorageError('The saved draft could not be cleared. Copy any text you need before closing.');
      return;
    }
    setDraft(createBugReportDraft(currentView));
    setUnreadableDraft(false);
    setSaved(false);
    setStorageError('');
    setActionMessage('Draft cleared.');
    setPreview(false);
  };
  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(formatBugReport(draft));
      setActionMessage('Report copied. It has not been sent.');
    } catch {
      setActionMessage('Copy was unavailable. Select and copy the preview text, or download the report.');
    }
  };
  const downloadReport = () => {
    try {
      downloadFile(new Blob([formatBugReport(draft)], { type: 'text/plain;charset=utf-8' }),
        `bug-report-${draft.id.replace(/[^\w-]/g, '').slice(0,80)}.txt`);
      setActionMessage('Report download requested. Check your downloads. It has not been sent.');
    } catch {
      setActionMessage('Download was unavailable. Select and copy the preview text before closing.');
    }
  };
  const fields = [
    ['summary', 'Brief summary', 'e.g. The seating card did not move'],
    ['steps', 'Steps to reproduce (optional)', 'Describe the buttons or screens you used.'],
    ['expected', 'What should happen? (optional)', 'Describe the expected result.'],
    ['actual', 'What happened?', 'Describe the problem using fictional examples.']
  ] as const;

  return <ModalDialog isOpen={isOpen} onClose={onClose} title="Report a problem" maxWidthClass="max-w-2xl"
    testId="bug-report-modal" isDirty={!saved && !unreadableDraft && !!(draft.summary || draft.actual || draft.steps || draft.expected || draft.previewText)}
    confirmDiscardMessage="Your report draft could not be saved. Copy or download it before closing. Close anyway?">
    <div className="space-y-4">
      <p className="text-sm text-slate-700">Describe the problem without student names, numbers, photos, marks, or notes. Nothing from your class records is attached.</p>
      <p className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900" data-testid="report-intake-status">
        Private reporting is not connected yet. You can save a draft on this device, review it, then copy or download it. Nothing will be sent from this window.
      </p>
      {storageError && <p role="alert" className="text-sm text-red-700">{storageError}</p>}
      {unreadableDraft ? <button type="button" className={buttonClass} onClick={startNew}>Start a new draft</button> : <>
        {!preview ? <>
          {fields.map(([key, label, placeholder]) => <label key={key} className="block text-sm font-medium text-slate-800">
            {label}
            <textarea data-testid={`bug-report-${key}`} value={draft[key]} placeholder={placeholder} maxLength={2000}
              rows={key === 'summary' ? 2 : 3} className="mt-1 block w-full rounded-lg border border-slate-300 p-3 font-normal text-base"
              onChange={event => updateDraft({ ...draft, [key]: event.target.value, previewText: null })} />
          </label>)}
          <p className="text-xs text-slate-600">Included in the preview: app version {draft.appVersion}, build {draft.appBuild}, platform {draft.platform}, screen {draft.screen}. You can edit or remove these in the preview.</p>
          <button type="button" className={`${buttonClass} bg-blue-600 text-white hover:bg-blue-700 border-blue-600`} disabled={!canPreviewBugReport(draft)} onClick={() => setPreview(true)}>Review report</button>
          {!canPreviewBugReport(draft) && <p className="text-xs text-slate-600">Enter a summary and what happened to review your report.</p>}
        </> : <>
          <label className="block text-sm font-medium text-slate-800">Review and edit the complete report
            <textarea data-testid="bug-report-preview" rows={14} maxLength={BUG_REPORT_LIMIT} value={formatBugReport(draft)}
              className="mt-1 block w-full rounded-lg border border-slate-300 p-3 font-mono text-sm"
              onChange={event => updateDraft({ ...draft, previewText: event.target.value })} />
          </label>
          <p className="text-xs text-slate-600">Copy and download contain exactly this preview text. Returning to the details and changing a field will rebuild the preview.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClass} onClick={() => setPreview(false)}>Back to details</button>
            <button type="button" className={buttonClass} onClick={copyReport}>Copy report</button>
            <button type="button" className={buttonClass} onClick={downloadReport}>Download report</button>
          </div>
        </>}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3">
          <p className="text-xs text-slate-600" role="status">{saved ? 'Draft saved on this device. It has not been sent.' : 'Draft not saved yet.'}</p>
          <button type="button" className={buttonClass} onClick={startNew}>Clear draft</button>
        </div>
      </>}
      {actionMessage && <p className="text-sm text-slate-700" role="status">{actionMessage}</p>}
    </div>
  </ModalDialog>;
};
