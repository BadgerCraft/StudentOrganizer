import { useState } from 'react';
import type { KTAC, MarkingRubric, RubricContent, RubricCriterion } from '../types';
import { parseRubricPaste } from '../rubricParser';

const field = 'border border-slate-300 rounded-lg p-2 bg-white text-slate-900 w-full';
const button = 'rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-50';
const categoryNames: Record<KTAC, string> = { K: 'Knowledge / Understanding', T: 'Thinking', A: 'Application', C: 'Communication' };
function blankCriterion(levels: string[], categoryCode: KTAC): RubricCriterion {
  return { id: crypto.randomUUID(), name: '', categoryCode, descriptors: Object.fromEntries(levels.map(level => [level, ''])) };
}
export function RubricEditor({ rubrics, categories, onSave }: {
  rubrics: MarkingRubric[]; categories: KTAC[]; onSave: (content: RubricContent) => Promise<void>;
}) {
  const initialLevels = ['Level 1', 'Level 2', 'Level 3', 'Level 4'];
  const [content, setContent] = useState<RubricContent>(() => ({ title: '', levels: initialLevels, criteria: [blankCriterion(initialLevels, categories[0] ?? 'K')] }));
  const [paste, setPaste] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const change = (next: RubricContent) => { setContent(next); setConfirmed(false); };
  const criterionChange = (id: string, patch: Partial<RubricCriterion>) => change({ ...content, criteria: content.criteria.map(c => c.id === id ? { ...c, ...patch } : c) });
  const renameLevel = (index: number, name: string) => {
    const old = content.levels[index];
    if (content.levels.some((level, i) => i !== index && level === name)) {
      setError('Each achievement label must be unique. The existing labels and descriptors have been retained.');
      return;
    }
    setError('');
    change({ ...content, levels: content.levels.map((level, i) => i === index ? name : level), criteria: content.criteria.map(c => {
      // Build an own-property map: a label rename must never overwrite another column,
      // and special object-property names are still ordinary rubric labels.
      const descriptors = Object.fromEntries(Object.entries(c.descriptors).map(([label, description]) => [label === old ? name : label, description]));
      return { ...c, descriptors };
    }) });
  };
  return <section className="rounded-xl border bg-white p-4 space-y-4" aria-labelledby="rubric-editor-title">
    <fieldset disabled={saving} className="space-y-4">
    <h2 id="rubric-editor-title" className="font-bold text-lg">Rubric and KTAC mapping</h2>
    <p className="text-sm text-slate-600">Create a rubric or paste a tab-separated table with criteria in the first column and achievement labels in the header. Review every descriptor and confirm its category. Labels and weights support your judgment; they do not calculate marks.</p>
    {rubrics.length > 0 && <label className="block text-sm">Start a new version from
      <select className={field} defaultValue="" onChange={e => {
        const source = rubrics.find(r => r.id === e.target.value);
        if (source) change({ title: source.title, levels: [...source.levels], criteria: structuredClone(source.criteria) });
      }}><option value="">Choose saved rubric…</option>{rubrics.map((r, i) => <option key={r.id} value={r.id}>{r.title} · version {rubrics.length - i}</option>)}</select>
    </label>}
    <label className="block text-sm">Paste rubric text or table<textarea data-testid="marking-rubric-paste" className={`${field} min-h-24`} value={paste} onChange={e => setPaste(e.target.value)} /></label>
    <button data-testid="marking-rubric-preview" className={button} type="button" disabled={!paste.trim()} onClick={() => {
      try { change(parseRubricPaste(paste)); setError(''); } catch (e) { setError(e instanceof Error ? e.message : 'Could not parse rubric.'); }
    }}>Preview pasted rubric</button>
    <label className="block text-sm">Rubric title<input className={field} value={content.title} maxLength={500} onChange={e => change({ ...content, title: e.target.value })} /></label>
    <div className="flex gap-2 flex-wrap" aria-label="Achievement labels">{content.levels.map((level, i) => <div key={i} className="flex gap-1 items-center">
      <label className="text-sm">Label {i + 1}<input className={field} aria-label={`Achievement label ${i + 1}`} maxLength={100} value={level} onChange={e => renameLevel(i, e.target.value)} /></label>
      <button className={button} disabled={content.levels.length <= 1} aria-label={`Remove achievement label ${i + 1}`} onClick={() => change({ ...content, levels: content.levels.filter((_, n) => n !== i), criteria: content.criteria.map(c => ({ ...c, descriptors: Object.fromEntries(Object.entries(c.descriptors).filter(([name]) => name !== level)) })) })}>×</button>
    </div>)}</div>
    <button className={button} disabled={content.levels.length >= 30} onClick={() => {
      let label = `Label ${content.levels.length + 1}`; while (content.levels.includes(label)) label += '+';
      change({ ...content, levels: [...content.levels, label], criteria: content.criteria.map(c => ({ ...c, descriptors: { ...c.descriptors, [label]: '' } })) });
    }}>Add achievement label</button>
    <div className="overflow-x-auto"><table className="w-full text-sm border-collapse"><caption className="text-left mb-2">Editable descriptor matrix</caption><thead><tr><th className="text-left p-2">Criterion / KTAC</th>{content.levels.map((level, i) => <th className="text-left p-2 min-w-44" key={i}>{level || 'Unnamed label'}</th>)}</tr></thead><tbody>
      {content.criteria.map((c, index) => <tr key={c.id} className="border-t align-top"><td className="p-2 min-w-52 space-y-2">
        <label className="block">Criterion {index + 1}<input className={field} aria-label={`Criterion ${index + 1} name`} maxLength={500} value={c.name} onChange={e => criterionChange(c.id, { name: e.target.value })} /></label>
        <label className="block">KTAC mapping<select className={field} aria-label={`Criterion ${index + 1} KTAC mapping`} value={categories.includes(c.categoryCode) ? c.categoryCode : ''} onChange={e => criterionChange(c.id, { categoryCode: e.target.value as KTAC })}><option value="" disabled>Choose an assessment category</option>{categories.map(code => <option key={code} value={code}>{code} — {categoryNames[code]}</option>)}</select></label>
        <label className="block">Reference weight (optional)<input type="number" className={field} min="0" max="10000" value={c.weight ?? ''} onChange={e => criterionChange(c.id, { weight: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
        <button className={button} disabled={content.criteria.length <= 1} onClick={() => change({ ...content, criteria: content.criteria.filter(item => item.id !== c.id) })}>Remove criterion {index + 1}</button>
      </td>{content.levels.map((level, i) => <td className="p-2" key={i}><textarea className={`${field} min-h-32`} aria-label={`${c.name || `Criterion ${index + 1}`} ${level || `label ${i + 1}`} descriptor`} maxLength={10000} value={c.descriptors[level] ?? ''} onChange={e => criterionChange(c.id, { descriptors: { ...c.descriptors, [level]: e.target.value } })} /></td>)}</tr>)}
    </tbody></table></div>
    <button className={button} disabled={content.criteria.length >= 40} onClick={() => change({ ...content, criteria: [...content.criteria, blankCriterion(content.levels, categories[0] ?? 'K')] })}>Add criterion</button>
    <label className="flex gap-2 items-start text-sm"><input data-testid="marking-rubric-confirm" className="mt-1" type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I have reviewed the descriptor matrix and confirm every criterion’s KTAC mapping.</label>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <button className={`${button} bg-blue-700 text-white`} disabled={!confirmed || saving || categories.length === 0 || content.criteria.some(c => !categories.includes(c.categoryCode))} onClick={async () => {
      setSaving(true); setError('');
      try { await onSave(content); setConfirmed(false); } catch (e) { setError(e instanceof Error ? e.message : 'Rubric could not be saved.'); } finally { setSaving(false); }
    }}>{saving ? 'Saving rubric…' : 'Save confirmed rubric version'}</button>
    <p className="text-xs text-slate-500">Every save creates a new version for future imports. Existing marking attempts keep their original rubric.</p>
    </fieldset>
  </section>;
}
