import { downloadFile } from '../../utils/downloadFile';
import { rendererStorageMode } from '../../security/rendererStorageMode';
import { readFeedbackBank, writeFeedbackBank } from '../../security/privateFeedbackStorage';
import { useEffect, useRef, useState } from 'react';
import type { MarkingActor } from '../types';
import { assertCommentBankActor, exportCommentBank, importCommentBankFile, parseCommentBank } from '../commentBank';

const button = 'rounded-lg border border-slate-300 bg-white text-slate-900 px-3 py-2 text-sm disabled:opacity-50';
const field = 'w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900';

/** Caller inserts the chosen text into its focused editor; links remain caller-owned. */
export function CommentBankPicker({ actor, onSelect, onDirtyChange, onSavingChange, disabled = false }: {
  actor: MarkingActor; onSelect: (text: string) => void; onDirtyChange?: (dirty: boolean) => void; onSavingChange?: (saving: boolean) => void; disabled?: boolean;
}) {
  const [bank, setBank] = useState<string[]>([]);
  const [view, setView] = useState<'closed' | 'choose' | 'import'>('closed');
  const [search, setSearch] = useState('');
  const [paste, setPaste] = useState('');
  const [review, setReview] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [importing, setImporting] = useState(false);
  const busy = useRef(false);
  const lifecycle = useRef(0);
  useEffect(() => {
    lifecycle.current++; busy.current = false; setImporting(false);
    setBank([]); setView('closed'); setReview(null); setPaste(''); setError(''); setMessage('');
    const started = lifecycle.current;
    void readFeedbackBank(actor).then(value => { if (started === lifecycle.current) setBank(value); }, cause => { if (started === lifecycle.current) setError(cause instanceof Error ? cause.message : 'The saved comment bank is unavailable.'); });
    return () => { lifecycle.current++; onDirtyChange?.(false); };
  }, [actor.userId, actor.epoch]);
  const reviewComments = (comments: string[]) => { setReview(comments); onDirtyChange?.(true); setError(''); setMessage(''); };
  const matches = bank.map((text, index) => ({ text, index })).filter(({ text }) => text.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <section aria-label="Comment bank" className="rounded-lg border border-slate-200 p-3 space-y-2">
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={disabled || importing} onClick={async () => {
        if (view === 'choose') { setView('closed'); return; }
        const started = lifecycle.current;
        try { const value = await readFeedbackBank(actor); if (started !== lifecycle.current) return; setBank(value); setView('choose'); setMessage(''); setError(''); }
        catch (cause) { if (started === lifecycle.current) setError(cause instanceof Error ? cause.message : 'The saved comment bank is unavailable.'); }
      }}>Choose bank comment ({bank.length})</button>
      <button type="button" className={button} disabled={disabled || importing} onClick={() => { setView('import'); setMessage(''); }}>Import comment bank</button>
    </div>
    {view === 'choose' && <div className="space-y-2">
      <label className="block text-sm">Find a bank comment<input type="search" className={field} value={search} onChange={e => setSearch(e.target.value)} /></label>
      {bank.length === 0 ? <p className="text-sm text-slate-600">Import reusable feedback to start your bank. Writing student feedback does not add it automatically.</p> : <>
        <p className="text-sm text-slate-600">Choose a comment to place it in the current editor, then edit it for this student.</p>
        <ul className="max-h-56 overflow-y-auto space-y-2">{matches.map(({ text, index }) => <li key={index}><button type="button" className={`${button} text-left w-full whitespace-pre-wrap`} disabled={disabled || importing} onClick={() => {
          try { assertCommentBankActor(actor); onSelect(text); setView('closed'); setError(''); }
          catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not select comment.'); }
        }}>{text}</button></li>)}</ul>
        {matches.length === 0 && <p className="text-sm">No matching comments.</p>}
        <button type="button" className={button} disabled={disabled || importing} onClick={() => { setView('import'); reviewComments([...bank]); }}>Edit bank comments</button>
        <button type="button" className={button} disabled={disabled || importing} onClick={() => {
          try {
            assertCommentBankActor(actor);
            downloadFile(new Blob([exportCommentBank(bank)], { type: 'text/csv;charset=utf-8' }), 'comment-bank.csv');
            setMessage('Comment bank download requested. Check your downloads.');
          } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not export comment bank.'); }
        }}>Export comment bank</button>
      </>}
    </div>}
    {view === 'import' && <fieldset disabled={disabled || importing} className="space-y-2">
      <p className="text-sm">Use .txt or .docx with one comment per line, or a CSV/TSV file with one Comment column. Quoted CSV comments may contain multiple lines.</p>
      <label className="block text-sm">Choose comment-bank file<input type="file" className={field} accept=".txt,.docx,.csv,.tsv" onChange={async e => {
        const file = e.target.files?.[0]; e.target.value = '';
        if (!file || busy.current) return;
        const started = lifecycle.current, hadReview = review !== null || !!paste.trim();
        busy.current = true; setImporting(true); setError(''); onDirtyChange?.(true);
        try {
          const comments = await importCommentBankFile(file); assertCommentBankActor(actor);
          if (started !== lifecycle.current) return;
          setPaste(''); reviewComments(comments);
        } catch (cause) {
          if (started !== lifecycle.current) return;
          onDirtyChange?.(hadReview);
          setError(cause instanceof Error ? cause.message : 'Could not read comment bank. Your current bank is retained.');
        } finally { if (started === lifecycle.current) { busy.current = false; setImporting(false); } }
      }} /></label>
      <label className="block text-sm">Or paste one comment per line<textarea className={`${field} min-h-20`} aria-label="Or paste one comment per line" value={paste} onChange={e => { setPaste(e.target.value); setReview(null); setMessage(''); onDirtyChange?.(true); }} /></label>
      <button type="button" className={button} disabled={!paste.trim()} onClick={() => {
        try { reviewComments(parseCommentBank(paste)); }
        catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not read comments.'); }
      }}>Review pasted comments</button>
      {review && <div className="space-y-2">
        <p className="font-medium text-sm">Review {review.length} comments</p>
        <div className="max-h-72 overflow-y-auto space-y-2">{review.map((text, index) => <div key={index} className="flex gap-2 items-start">
          <label className="flex-1 text-sm">Bank comment {index + 1}<textarea className={field} aria-label={`Bank comment ${index + 1}`} maxLength={5000} value={text} onChange={e => { reviewComments(review.map((value, at) => at === index ? e.target.value : value)); }} /></label>
          <button type="button" className={`${button} mt-5`} aria-label={`Remove bank comment ${index + 1}`} onClick={() => reviewComments(review.filter((_, at) => at !== index))}>Remove</button>
        </div>)}</div>
        <div className="flex gap-2 flex-wrap">
          <button type="button" className={button} onClick={async () => {
            if (busy.current) return; const started = lifecycle.current; busy.current = true; setImporting(true); onSavingChange?.(true);
            try { const value = await writeFeedbackBank(actor, review, 'add'); if (started !== lifecycle.current) return; setBank(value); setReview(null); setPaste(''); setView('choose'); onDirtyChange?.(false); setMessage('Reviewed comments added to your bank.'); }
            catch (cause) { if (started === lifecycle.current) setError(cause instanceof Error ? cause.message : 'Could not save comments. Your review is retained; retry saving.'); }
            finally { onSavingChange?.(false); if (started === lifecycle.current) { busy.current = false; setImporting(false); } }
          }}>Add reviewed comments to bank</button>
          <button type="button" className={button} onClick={async () => {
            if (busy.current) return; const started = lifecycle.current; busy.current = true; setImporting(true); onSavingChange?.(true);
            try { const value = await writeFeedbackBank(actor, review, 'replace'); if (started !== lifecycle.current) return; setBank(value); setReview(null); setPaste(''); setView('choose'); onDirtyChange?.(false); setMessage('Reviewed comment bank saved.'); }
            catch (cause) { if (started === lifecycle.current) setError(cause instanceof Error ? cause.message : 'Could not save comments. Your review is retained; retry saving.'); }
            finally { onSavingChange?.(false); if (started === lifecycle.current) { busy.current = false; setImporting(false); } }
          }}>Replace bank with reviewed comments</button>
        </div>
      </div>}
    </fieldset>}
    {importing && <p role="status" className="text-sm">Reading or saving comment bank…</p>}
    {message && <p role="status" className="text-sm text-emerald-800">{message}</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {view !== 'closed' && <p className="text-xs text-slate-600">{rendererStorageMode() === 'legacy' ? 'This teacher’s bank is saved on this device. It is separate from student records and is not included in the application backup. Export the bank to keep a transferable copy.' : 'This teacher’s bank is included in encrypted workspace backups. Keep a verified encrypted backup and its recovery code separately.'}</p>}
  </section>;
}
