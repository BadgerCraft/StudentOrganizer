import { useRef, useState } from 'react';
import type { KTAC, MarkingRubric, RubricContent, RubricCriterion } from '../types';
import { parseRubricPaste, type ImportedCriterion, type RubricImportContent } from '../rubricParser';
import { importRubricFile } from '../importRubric';
import { CLASSROOM_LEVEL_LABELS } from '../../services/classroomLevels';

const field = 'border border-slate-300 rounded-lg p-2 bg-white text-slate-900 w-full';
const button = 'rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-50';
const categoryNames: Record<KTAC, string> = { K: 'Knowledge/Understanding', T: 'Thinking', C: 'Communication', A: 'Application' };
function blankCriterion(levels: string[]): ImportedCriterion {
  return { id: crypto.randomUUID(), name: '', categoryCode: null, descriptors: Object.fromEntries(levels.map(level => [level, ''])) };
}
export function RubricEditor({ rubrics, categories, onSave, onDirtyChange }: {
  rubrics: MarkingRubric[]; categories: KTAC[]; onSave: (content: RubricContent) => Promise<void>; onDirtyChange?: (dirty: boolean) => void;
}) {
  const initialLevels = [...CLASSROOM_LEVEL_LABELS];
  const [content, setContent] = useState<RubricImportContent>(() => ({ title: '', levels: initialLevels, criteria: [blankCriterion(initialLevels)] }));
  const [paste, setPaste] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const busy = useRef(false);
  const availableCategories = (['K', 'T', 'C', 'A'] as KTAC[]).filter(code => categories.includes(code));
  const unresolved = content.criteria.filter(c => !c.categoryCode || !categories.includes(c.categoryCode)).length;
  const change = (next: RubricImportContent) => { setContent(next); setConfirmed(false); setStatus(''); onDirtyChange?.(true); };
  const criterionChange = (id: string, patch: Partial<ImportedCriterion>) => change({ ...content, criteria: content.criteria.map(c => c.id === id ? { ...c, ...patch } : c) });
  const renameLevel = (index: number, name: string) => {
    const old = content.levels[index];
    if (content.levels.some((level, i) => i !== index && level === name)) { setError('Each achievement label must be unique. Existing descriptors have been retained.'); return; }
    setError('');
    change({ ...content, levels: content.levels.map((level, i) => i === index ? name : level), criteria: content.criteria.map(c => ({ ...c, descriptors: Object.fromEntries(Object.entries(c.descriptors).map(([label, description]) => [label === old ? name : label, description])) })) });
  };
  return <section className="rounded-xl border bg-white p-4 space-y-4" aria-labelledby="rubric-editor-title">
    <fieldset disabled={saving || importing} className="space-y-4">
      <h2 id="rubric-editor-title" className="font-bold text-lg">Rubric and KTCA categories</h2>
      <p className="text-sm text-slate-600">Import a complete rubric or create success criteria. Review each criterion beside its category; open its descriptors when needed. Imported achievement labels are preserved and do not calculate marks.</p>
      {rubrics.length > 0 && <label className="block text-sm">Start a new version from
        <select className={field} defaultValue="" onChange={e => {
          const source = rubrics.find(r => r.id === e.target.value);
          if (source) change({ title: source.title, levels: [...source.levels], criteria: structuredClone(source.criteria) });
        }}><option value="">Choose saved rubric…</option>{rubrics.map((r, i) => <option key={r.id} value={r.id}>{r.title} · version {rubrics.length - i}</option>)}</select>
      </label>}
      <label className="block text-sm">Import rubric file (.txt or .docx)
        <input data-testid="marking-rubric-file" type="file" className={field} accept=".txt,.docx" onChange={async e => {
          const file = e.target.files?.[0]; e.target.value = '';
          if (!file || busy.current) return;
          busy.current = true; setImporting(true); setError('');
          try { change(await importRubricFile(file)); setStatus(`Review imported rubric from ${file.name}.`); }
          catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not import rubric. Your existing review is retained.'); }
          finally { busy.current = false; setImporting(false); }
        }} />
      </label>
      <details><summary className="cursor-pointer font-medium text-sm">Paste rubric text or table</summary>
        <label className="block text-sm mt-2">Rubric text<textarea data-testid="marking-rubric-paste" className={`${field} min-h-24`} value={paste} onChange={e => { setPaste(e.target.value); onDirtyChange?.(true); }} /></label>
        <button data-testid="marking-rubric-preview" className={button} type="button" disabled={!paste.trim()} onClick={() => {
          try { change(parseRubricPaste(paste)); setError(''); setStatus('Review the imported criteria below.'); }
          catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not read rubric.'); }
        }}>Review pasted rubric</button>
      </details>
      {importing && <p role="status">Reading rubric…</p>}
      {status && <p role="status" className="text-sm text-emerald-800">{status}</p>}
      <label className="block text-sm">Rubric title<input className={field} value={content.title} maxLength={500} onChange={e => change({ ...content, title: e.target.value })} /></label>
      {content.instructions && <details><summary className="cursor-pointer text-sm">Source notes and instructions</summary><p className="text-sm whitespace-pre-wrap mt-2">{content.instructions}</p></details>}
      <details><summary className="cursor-pointer text-sm">Achievement labels ({content.levels.length})</summary>
        <p className="text-sm text-slate-600 mt-2">New rubrics include the built-in level labels. Keep a full rubric’s original descriptor headings, even when they differ from the level choices used for marking.</p>
        <div className="flex gap-2 flex-wrap mt-2">{content.levels.map((level, i) => <div key={i} className="flex gap-1 items-center">
          <label className="text-sm">Label {i + 1}<input className={field} aria-label={`Achievement label ${i + 1}`} maxLength={100} value={level} onChange={e => renameLevel(i, e.target.value)} /></label>
          <button className={button} disabled={content.levels.length <= 1} aria-label={`Remove achievement label ${i + 1}`} onClick={() => change({ ...content, levels: content.levels.filter((_, n) => n !== i), criteria: content.criteria.map(c => ({ ...c, descriptors: Object.fromEntries(Object.entries(c.descriptors).filter(([name]) => name !== level)) })) })}>Remove</button>
        </div>)}</div>
        <button className={`${button} mt-2`} disabled={content.levels.length >= 30} onClick={() => {
          let label = `Label ${content.levels.length + 1}`; while (content.levels.includes(label)) label += '+';
          change({ ...content, levels: [...content.levels, label], criteria: content.criteria.map(c => ({ ...c, descriptors: { ...c.descriptors, [label]: '' } })) });
        }}>Add achievement label</button>
      </details>
      <div className="space-y-3" aria-label="Editable criterion and category review">
        <p className="font-medium">Review {content.criteria.length} {content.criteria.length === 1 ? 'criterion' : 'criteria'}</p>
        {unresolved > 0 && <p role="status" className="text-sm text-amber-800">Choose a KTCA category for {unresolved} {unresolved === 1 ? 'criterion' : 'criteria'} before saving. No category has been assumed.</p>}
        {content.criteria.map((c, index) => <div key={c.id} className="border rounded-lg p-3 space-y-2">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block text-sm">Criterion {index + 1}<input className={field} aria-label={`Criterion ${index + 1} name`} maxLength={500} value={c.name} onChange={e => criterionChange(c.id, { name: e.target.value })} /></label>
            <label className="block text-sm">KTCA category<select className={field} aria-label={`Criterion ${index + 1} KTCA mapping`} value={c.categoryCode && categories.includes(c.categoryCode) ? c.categoryCode : ''} onChange={e => criterionChange(c.id, { categoryCode: e.target.value as KTAC })}><option value="" disabled>Choose category — confirmation needed</option>{availableCategories.map(code => <option key={code} value={code}>{code} — {categoryNames[code]}</option>)}</select></label>
          </div>
          <details><summary className="cursor-pointer text-sm">Descriptors and reference weight for criterion {index + 1}</summary>
            <div className="grid sm:grid-cols-2 gap-3 mt-2">{content.levels.map((level, i) => <label key={i} className="block text-sm">{level || `Label ${i + 1}`}<textarea className={`${field} min-h-24`} aria-label={`${c.name || `Criterion ${index + 1}`} ${level || `label ${i + 1}`} descriptor`} maxLength={10000} value={c.descriptors[level] ?? ''} onChange={e => criterionChange(c.id, { descriptors: { ...c.descriptors, [level]: e.target.value } })} /></label>)}</div>
            <label className="block text-sm mt-2">Reference weight (optional)<input type="number" className={field} min="0" max="10000" value={c.weight ?? ''} onChange={e => criterionChange(c.id, { weight: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
          </details>
          <button className={button} disabled={content.criteria.length <= 1} onClick={() => change({ ...content, criteria: content.criteria.filter(item => item.id !== c.id) })}>Remove criterion {index + 1}</button>
        </div>)}
      </div>
      <button className={button} disabled={content.criteria.length >= 40} onClick={() => change({ ...content, criteria: [...content.criteria, blankCriterion(content.levels)] })}>Add criterion</button>
      <label className="flex gap-2 items-start text-sm"><input data-testid="marking-rubric-confirm" className="mt-1" type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I have reviewed the criteria and descriptors and confirm every KTCA category.</label>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <button className={`${button} bg-blue-700 text-white`} disabled={!confirmed || saving || importing || unresolved > 0 || !content.title.trim() || content.criteria.some(c => !c.name.trim())} onClick={async () => {
        if (busy.current || unresolved > 0) return;
        busy.current = true; setSaving(true); setError('');
        try {
          const reviewed: RubricContent = { title: content.title, levels: content.levels, criteria: content.criteria.map(c => ({ ...c, categoryCode: c.categoryCode! } as RubricCriterion)) };
          await onSave(reviewed); setConfirmed(false); onDirtyChange?.(false); setStatus('Rubric version saved.');
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'Rubric could not be saved. Your review is retained; retry saving.'); }
        finally { busy.current = false; setSaving(false); }
      }}>{saving ? 'Saving rubric…' : 'Save confirmed rubric version'}</button>
      <p className="text-xs text-slate-500">Each save creates a new version. Existing marking attempts keep their original rubric.</p>
    </fieldset>
  </section>;
}
