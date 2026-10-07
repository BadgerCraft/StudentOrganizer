import { useState } from 'react';
import type { CategoryChangeReview } from '../types';
import { categorySignature, compatibleCategoryTarget } from '../categoryRecovery';

interface Props {
  review: CategoryChangeReview;
  onReconcile: (mapping: Record<string, string | null>) => void;
  onCancel: () => void;
}
export function CategoryRecoveryReview({ review, onReconcile, onCancel }: Props) {
  const [choices, setChoices] = useState<Record<string, string>>(() => Object.fromEntries(review.previousCategories.map(previous => {
    const unchanged = review.currentCategories.find(current => categorySignature([previous]) === categorySignature([current]));
    return [previous.id, unchanged?.id ?? ''];
  })));
  return <section aria-label="Review category changes" className="border-2 border-amber-600 rounded-lg p-4 space-y-3 bg-white">
    <h3 className="font-bold">Review category changes</h3>
    <p>Your draft is saved locally with its original categories. Review the pinned rubric and each judgment before reconciling. This does not change official marks or accept newer manual results.</p>
    <p>Pinned rubric: <strong>{review.rubricTitle}</strong></p>
    <ul>{review.criteria.map((criterion, index) => <li key={index}>{criterion.name} → {criterion.categoryCode}</li>)}</ul>
    <p>{review.compatible ? 'Pinned rubric is compatible with the current KTAC categories.' : review.reasons.join(' ')}</p>
    <p>Current categories: {review.currentCategories.length ? review.currentCategories.map(c => `${c.categoryCode} (maximum ${c.maxScore}, weight ${c.evidenceWeight})`).join('; ') : 'none'}.</p>
    {review.previousCategories.map(previous => <div key={previous.id} className="border rounded p-3 space-y-2">
      <p>Original {previous.categoryCode}: maximum {previous.maxScore}, weight {previous.evidenceWeight}.</p>
      <details><summary>Category identifiers and scales</summary><p>Original ID: {previous.id}; scale: {previous.markScaleVersionId ?? 'class default'}</p>{review.currentCategories.filter(c => c.categoryCode === previous.categoryCode).map(c => <p key={c.id}>Current ID: {c.id}; scale: {c.markScaleVersionId ?? 'class default'}</p>)}</details>
      <label className="block">Reconcile {previous.categoryCode} judgment<select aria-label={`Reconcile ${previous.categoryCode} judgment`} className="block w-full border rounded p-2" value={choices[previous.id]} onChange={event => setChoices({ ...choices, [previous.id]: event.target.value })}>
        <option value="">Choose how to preserve this judgment</option>
        <option value="__retain__">Keep original feedback in recovery history; start current judgment unassessed</option>
        {review.currentCategories.filter(current => compatibleCategoryTarget(previous, current)).map(current => <option key={current.id} value={current.id}>{current.categoryCode} — retain judgment with current category</option>)}
      </select></label>
    </div>)}
    <p className="text-sm">Changed or removed originals remain in Retained category feedback. Only matching KTAC categories, score maximums and scales can retain a judgment. Other current judgments start unassessed; review them yourself before finalizing.</p>
    <button className="border rounded px-3 py-2 disabled:opacity-50" disabled={!review.compatible || review.previousCategories.some(c => !choices[c.id])} onClick={() => onReconcile(Object.fromEntries(Object.entries(choices).map(([id, choice]) => [id, choice === '__retain__' ? null : choice])))}>Reconcile reviewed categories</button>
    <button className="border rounded px-3 py-2 ml-2" onClick={onCancel}>Close category review</button>
  </section>;
}
