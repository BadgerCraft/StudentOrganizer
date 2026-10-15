import { useId, useState } from 'react';
import { MARKING_LIMITS } from '../types';
import type { MarkingMode, MarkingOralEvidence, MarkingRubric, MarkingRubricFeedback } from '../types';

const field = 'border border-slate-300 rounded-lg p-2 bg-white text-slate-900 w-full';
const button = 'rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-50';
const noteLimit = 20000;
const totalNoteLimit = 50000;

export function MarkingModePicker({ onSelect, disabled = false }: {
  onSelect: (mode: MarkingMode) => void;
  disabled?: boolean;
}) {
  const titleId = useId();
  const modes: { mode: MarkingMode; title: string; description: string }[] = [
    { mode: 'written', title: 'Written markup + rubric', description: 'Mark a document or photographed pages and record rubric evidence.' },
    { mode: 'oral', title: 'Oral presentation + rubric', description: 'Use a customizable checklist, private presentation notes and rubric evidence.' },
    { mode: 'rubric', title: 'Rubric only', description: 'Record criterion feedback directly against the pinned rubric.' },
  ];
  return <section aria-labelledby={titleId} className="space-y-3">
    <h3 id={titleId} className="font-semibold">Choose a marking mode</h3>
    <div className="grid gap-3 md:grid-cols-3">{modes.map(({ mode, title, description }) => <button
      key={mode} type="button" data-testid={`marking-mode-${mode}`} disabled={disabled}
      className={`${button} text-left space-y-2 hover:bg-slate-50`} onClick={() => onSelect(mode)}>
      <span className="block font-semibold">{title}</span><span className="block text-slate-600">{description}</span>
    </button>)}</div>
  </section>;
}

export function RubricEvidenceEditor({ rubric, value, onChange, disabled }: {
  rubric: MarkingRubric;
  value: MarkingRubricFeedback[] | undefined;
  onChange: (next: MarkingRubricFeedback[]) => void;
  disabled: boolean;
}) {
  const titleId = useId();
  const entries = value ?? rubric.criteria.map(criterion => ({ criterionId: criterion.id, level: '', feedback: '' }));
  const update = (criterionId: string, patch: Partial<MarkingRubricFeedback>) => {
    const current = entries.find(entry => entry.criterionId === criterionId);
    const next = { criterionId, level: '', feedback: '', ...current, ...patch };
    onChange(current ? entries.map(entry => entry.criterionId === criterionId ? next : entry) : [...entries, next]);
  };
  return <section aria-labelledby={titleId} data-testid="marking-rubric-evidence" className="rounded-xl border bg-white p-4 space-y-3">
    <h3 id={titleId} className="font-semibold">Rubric evidence</h3>
    <p className="text-sm text-slate-600">Pinned rubric: {rubric.title}. Achievement labels and feedback record your evidence; they do not calculate grades. Enter official category judgments separately.</p>
    <fieldset disabled={disabled} className="space-y-3">{rubric.criteria.map(criterion => {
      const current = entries.find(entry => entry.criterionId === criterion.id);
      const otherCharacters = entries.reduce((sum, entry) => sum + (entry.criterionId === criterion.id ? 0 : entry.feedback.length), 0);
      const feedbackLimit = Math.max(0, Math.min(noteLimit, totalNoteLimit - otherCharacters));
      return <div key={criterion.id} className="border rounded-lg p-3 space-y-2" data-testid={`marking-criterion-${criterion.id}`}>
        <p className="font-medium">{criterion.name} · {criterion.categoryCode}</p>
        <label className="block text-sm">{criterion.name} achievement label (optional)
          <select className={field} data-testid={`marking-criterion-level-${criterion.id}`} value={current?.level ?? ''} onChange={event => update(criterion.id, { level: event.target.value })}>
            <option value="">No achievement label selected</option>{rubric.levels.map(level => <option key={level} value={level}>{level}</option>)}
          </select>
        </label>
        <details className="text-sm text-slate-600"><summary>Rubric descriptors for {criterion.name}</summary>
          <dl className="space-y-2 mt-2">{rubric.levels.map(level => <div key={level}><dt className="font-medium">{level}</dt><dd className="whitespace-pre-wrap">{criterion.descriptors[level] || 'No descriptor provided.'}</dd></div>)}</dl>
        </details>
        <label className="block text-sm">{criterion.name} feedback
          <textarea className={`${field} min-h-24`} data-testid={`marking-criterion-feedback-${criterion.id}`} value={current?.feedback ?? ''} maxLength={feedbackLimit} onChange={event => update(criterion.id, { feedback: event.target.value.slice(0, feedbackLimit) })} />
        </label>
      </div>;
    })}</fieldset>
    <p className="text-xs text-slate-500">Feedback allows up to 20,000 characters per criterion and 50,000 characters in total.</p>
  </section>;
}

export function OralEvidenceEditor({ value, onChange, disabled }: {
  value: MarkingOralEvidence;
  onChange: (next: MarkingOralEvidence) => void;
  disabled: boolean;
}) {
  const titleId = useId();
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  const totalCharacters = value.notes.length + value.items.reduce((sum, item) => sum + item.note.length, 0);
  const allowedLength = (currentLength: number) => Math.max(0, Math.min(noteLimit, totalNoteLimit - totalCharacters + currentLength));
  const updateItem = (id: string, patch: Partial<MarkingOralEvidence['items'][number]>) => onChange({
    ...value, items: value.items.map(item => item.id === id ? { ...item, ...patch } : item),
  });
  const removeItem = (id: string) => { onChange({ ...value, items: value.items.filter(item => item.id !== id) }); setPendingRemoval(null); };
  return <section aria-labelledby={titleId} data-testid="marking-oral-evidence" className="rounded-xl border bg-white p-4 space-y-3">
    <h3 id={titleId} className="font-semibold">Oral presentation evidence</h3>
    <p className="text-sm text-slate-600">Customize the checklist for this presentation. Checklist selections and notes do not calculate grades. Checklist notes and private presentation notes are excluded from the student report; use rubric feedback for feedback you want to share.</p>
    <fieldset disabled={disabled} className="space-y-3">
      {value.items.map((item, index) => <div key={item.id} data-testid={`marking-oral-item-${item.id}`} className="border rounded-lg p-3 space-y-2">
        <label className="flex gap-2 items-center text-sm"><input type="checkbox" data-testid={`marking-oral-check-${item.id}`} checked={item.checked} onChange={event => updateItem(item.id, { checked: event.target.checked })} />Checklist item {index + 1} observed{item.label ? `: ${item.label}` : ''}</label>
        <label className="block text-sm">Checklist item {index + 1} label<input className={field} data-testid={`marking-oral-label-${item.id}`} value={item.label} maxLength={500} onChange={event => updateItem(item.id, { label: event.target.value.slice(0, 500) })} /></label>
        <label className="block text-sm">Checklist item {index + 1} private note<textarea className={`${field} min-h-20`} data-testid={`marking-oral-note-${item.id}`} value={item.note} maxLength={allowedLength(item.note.length)} onChange={event => updateItem(item.id, { note: event.target.value.slice(0, allowedLength(item.note.length)) })} /></label>
        {pendingRemoval === item.id ? <div role="group" aria-label={`Confirm removal of checklist item ${index + 1}`} className="space-y-2">
          <p className="text-sm">Remove this checklist item and its saved selection and note?</p>
          <button type="button" className={button} data-testid={`marking-oral-confirm-remove-${item.id}`} onClick={() => removeItem(item.id)}>Confirm removal</button>
          <button type="button" className={`${button} ml-2`} onClick={() => setPendingRemoval(null)}>Keep checklist item</button>
        </div> : <button type="button" className={button} data-testid={`marking-oral-remove-${item.id}`} onClick={() => {
          if (item.checked || item.note.length > 0) setPendingRemoval(item.id); else removeItem(item.id);
        }}>Remove checklist item {index + 1}</button>}
      </div>)}
      <button type="button" className={button} data-testid="marking-oral-add-item" disabled={value.items.length >= MARKING_LIMITS.checklistItems} onClick={() => onChange({
        ...value, items: [...value.items, { id: crypto.randomUUID(), label: `Checklist item ${value.items.length + 1}`, checked: false, note: '' }],
      })}>Add checklist item</button>
      <p className="text-xs text-slate-500">{value.items.length} of {MARKING_LIMITS.checklistItems} checklist items. Notes allow up to 20,000 characters each and 50,000 characters in total.</p>
      <label className="block text-sm">Private presentation notes (excluded from student report)
        <textarea className={`${field} min-h-32`} data-testid="marking-oral-private-notes" value={value.notes} maxLength={allowedLength(value.notes.length)} onChange={event => onChange({ ...value, notes: event.target.value.slice(0, allowedLength(value.notes.length)) })} />
      </label>
    </fieldset>
  </section>;
}
