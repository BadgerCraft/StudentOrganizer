import type { AssessmentCategory } from '../types/schema';
import type { CategoryChangeReview, MarkingRubric, MarkingSession } from './types';
import { sessionCategories } from './validation';

/** Compare stored values, including versions, without depending on IndexedDB row order. */
export function categorySignature(categories: AssessmentCategory[]): string {
  return JSON.stringify([...categories].sort((a, b) => a.id.localeCompare(b.id)).map(category =>
    Object.fromEntries(Object.entries(category).sort(([a], [b]) => a.localeCompare(b)))));
}
export function compatibleCategoryTarget(previous: AssessmentCategory, current: AssessmentCategory): boolean {
  return previous.categoryCode === current.categoryCode && previous.maxScore === current.maxScore && previous.markScaleVersionId === current.markScaleVersionId;
}
export function categoryChangeReview(session: MarkingSession, categories: AssessmentCategory[], rubric: MarkingRubric): CategoryChangeReview {
  const previousCategories = sessionCategories(session);
  const missingCodes = [...new Set(rubric.criteria.map(c => c.categoryCode))].filter(code => !categories.some(c => c.categoryCode === code));
  return {
    token: JSON.stringify({ version: session.version, previous: categorySignature(previousCategories), current: categorySignature(categories), rubric }),
    compatible: missingCodes.length === 0,
    reasons: missingCodes.length ? [`Pinned rubric is incompatible: required ${missingCodes.join(', ')} categories are missing. Keep this saved draft and use Import/Export → Download Full Backup. Restore the required assessment categories in the authorized context that changed them, then review again. The assessment screen currently has no category editor, so this may require assistance with repairing the assessment. This draft cannot be finalized until its pinned rubric is compatible; its feedback is not an official mark.`] : [],
    previousCategories, currentCategories: categories, rubricTitle: rubric.title,
    criteria: rubric.criteria.map(({ name, categoryCode }) => ({ name, categoryCode })),
  };
}
