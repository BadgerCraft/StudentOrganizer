import type { MarkingAttempt, MarkingRubric, MarkingSession } from './types';
import { assertAttemptDraft, assertMarkingRecord } from './validation';

/** Validate all read shortcuts too; a TypeScript type does not validate an IndexedDB record. */
export function validateSavedMarkingSession(session: MarkingSession, attempt: MarkingAttempt, rubric: MarkingRubric): void {
  assertMarkingRecord('markingAttempts', attempt);
  assertMarkingRecord('markingRubrics', rubric);
  assertMarkingRecord('markingSessions', session);
  if (session.attemptId !== attempt.id || session.rubricId !== rubric.id || attempt.rubricId !== rubric.id ||
      session.assessmentId !== attempt.assessmentId || rubric.assessmentId !== attempt.assessmentId ||
      session.classSectionId !== attempt.classSectionId || rubric.classSectionId !== attempt.classSectionId ||
      session.createdBy !== attempt.createdBy || rubric.createdBy !== attempt.createdBy) {
    throw new Error('Saved marking links are inconsistent. Keep the original records and restore a validated backup.');
  }
  assertAttemptDraft(session.draft, attempt, rubric);
}
