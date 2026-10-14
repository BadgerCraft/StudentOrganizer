import type { Assessment, AssessmentCategory, Student } from '../types/schema';
import { exportNativeBackup, usesNativeFiles } from '../services/nativeFiles';
import type { MarkingAttempt, MarkingCommit, MarkingRubric } from './types';
import { assertAttemptDraft } from './validation';
import { sortCategoriesForDisplay } from '../utils/categoryDisplay';

export interface MarkingReportInput {
  commit: MarkingCommit;
  rubric: MarkingRubric;
  attempt: MarkingAttempt;
  student: Student;
  assessment: Assessment;
  categories: AssessmentCategory[];
}
const escape = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const categoryNames = { K: 'Knowledge / Understanding', T: 'Thinking', A: 'Application', C: 'Communication' };

/** Call only with records freshly read through the authorized marking service. No draft state is accepted. */
export function renderMarkingReport({ commit, rubric, attempt, student, assessment, categories }: MarkingReportInput): string {
  if (commit.rubricId !== rubric.id || commit.attemptId !== attempt.id || attempt.rubricId !== rubric.id || [commit, rubric, attempt].some(record => record.assessmentId !== assessment.id || record.classSectionId !== assessment.classSectionId) || commit.draft.pending) throw new Error('The saved report records do not match.');
  if (commit.createdBy !== rubric.createdBy || commit.createdBy !== attempt.createdBy) throw new Error('The saved report records do not match.');
  assertAttemptDraft(commit.draft, attempt, rubric);
  const name = `${student.preferredName || student.firstName} ${student.lastName}`;
  const linkedJudgments = commit.draft.judgments.map(judgment => {
    const category = categories.find(value => value.id === judgment.assessmentCategoryId && value.assessmentId === assessment.id);
    if (!category) throw new Error('A saved category is unavailable for this report.');
    return { categoryCode: category.categoryCode, category, judgment };
  });
  const judgments = sortCategoriesForDisplay(linkedJudgments).map(({ category, judgment }) => {
    return `<tr><th>${escape(categoryNames[category.categoryCode])}</th><td>${judgment.assessed ? `${escape(judgment.rawScore)} (${escape(judgment.inputFormat.replace(/_/g, ' '))})` : 'Not assessed'}</td><td>${escape(judgment.feedback)}</td></tr>`;
  }).join('');
  const evidence = commit.draft.annotations.map(annotation => {
    const document = attempt.documents.find(value => value.id === annotation.documentId);
    const criterion = rubric.criteria.find(value => value.id === annotation.criterionId);
    if (!document || !criterion || annotation.start < 0 || annotation.end <= annotation.start || document.text.slice(annotation.start, annotation.end) !== annotation.quote) throw new Error('Saved feedback does not match its document or rubric version.');
    return `<article><h3>${escape(criterion.name)} — ${escape(annotation.level || 'No achievement label')}</h3><p class="source">${escape(document.name)} · characters ${annotation.start + 1}–${annotation.end}</p><blockquote>${escape(annotation.quote)}</blockquote><p>${escape(annotation.text)}</p></article>`;
  }).join('');
  const rubricRows = rubric.criteria.map(criterion => `<tr><th>${escape(criterion.name)}<br>${escape(categoryNames[criterion.categoryCode])}${criterion.weight === undefined ? '' : `<br>Rubric weight: ${escape(criterion.weight)}`}</th>${rubric.levels.map(level => `<td>${escape(criterion.descriptors[level])}</td>`).join('')}</tr>`).join('');
  const criterionFeedback = (commit.draft.rubricFeedback ?? []).map(feedback => {
    const criterion = rubric.criteria.find(value => value.id === feedback.criterionId)!;
    return `<tr><th>${escape(criterion.name)}</th><td>${escape(feedback.level || 'No achievement label')}</td><td>${escape(feedback.feedback)}</td></tr>`;
  }).join('');
  // Original photographs and visual strokes stay in local marking recovery. Only
  // deliberate written comments become student-facing supporting evidence.
  const imageEvidence = (commit.draft.imageFeedback ?? []).map(feedback => {
    const page = attempt.imagePages!.find(value => value.id === feedback.pageId)!;
    return feedback.annotations.filter(annotation => annotation.text.trim()).map(annotation => {
      const criterion = rubric.criteria.find(value => value.id === annotation.criterionId);
      const label = criterion ? `${criterion.name} — ${annotation.level || 'No achievement label'}` : 'Page feedback';
      return `<article><h3>${escape(label)}</h3><p class="source">${escape(page.name)}</p><p>${escape(annotation.text)}</p></article>`;
    }).join('');
  }).join('');
  const criterionSection = criterionFeedback ? `<h2>Criterion feedback</h2><table><thead><tr><th>Criterion</th><th>Achievement label</th><th>Feedback</th></tr></thead><tbody>${criterionFeedback}</tbody></table>` : '';
  const archivedFeedback = (commit.draft.archivedFeedback ?? []).map(entry => {
    const criterion = rubric.criteria.find(value => value.id === entry.criterionId);
    return `<article><h3>${escape(criterion?.name || 'Written feedback')} — ${escape(entry.level || 'No achievement label')}</h3><p>${escape(entry.text)}</p></article>`;
  }).join('');
  const archivedSection = attempt.archivedAt ? `<h2>Archived assessment</h2><p>Archived ${escape(attempt.archivedAt)}. ${attempt.keepStudentWork ? 'Student work retained by teacher choice.' : 'Student work removed; assessment records and written feedback retained.'}</p>${archivedFeedback}` : '';
  const imageSection = imageEvidence ? `<h2>Supporting page comments</h2>${imageEvidence}` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; connect-src 'none'; img-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(assessment.title)} — ${escape(name)}</title><style>body{font-family:system-ui,sans-serif;color:#172033;max-width:65rem;margin:2rem auto;padding:0 1rem}h1,h2,h3{break-after:avoid}table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{border:1px solid #b9c1cc;padding:.6rem;text-align:left;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}p,blockquote{white-space:pre-wrap;overflow-wrap:anywhere}article{break-inside:avoid;border-top:1px solid #b9c1cc;padding:.5rem 0}blockquote{border-left:3px solid #b9c1cc;padding-left:1rem}.source,footer{font-size:.85rem;color:#475569}@media print{body{max-width:none;margin:0}table{font-size:10pt}}</style></head><body><h1>${escape(assessment.title)}</h1><p><strong>${escape(name)}</strong></p><p>Saved assessment report · ${escape(commit.createdAt)}</p><h2>Category judgments</h2><table><thead><tr><th>Category</th><th>Teacher judgment</th><th>Feedback</th></tr></thead><tbody>${judgments}</tbody></table><h2>Overall feedback</h2><p>${escape(commit.draft.overallFeedback)}</p>${criterionSection}${archivedSection}<h2>Supporting quotations and feedback</h2>${evidence || '<p>No passage annotations.</p>'}${imageSection}<h2>Rubric: ${escape(rubric.title)}</h2><table><thead><tr><th>Criterion / KTAC</th>${rubric.levels.map(level => `<th>${escape(level)}</th>`).join('')}</tr></thead><tbody>${rubricRows}</tbody></table><footer><p>Saved commit ${escape(commit.id)} · attempt ${escape(attempt.id)} · rubric ${escape(rubric.id)}. Rubric labels are evidence; category judgments above are entered by the teacher. Use your browser’s Print / Save as PDF to create a PDF locally.</p></footer></body></html>`;
}

/** Deliberate local export; the report has no executable content or external resources. */
export async function exportMarkingReport(input: MarkingReportInput): Promise<boolean> {
  const html = renderMarkingReport(input);
  const filename = `assessment-report-${input.commit.id.replace(/[^a-zA-Z0-9_-]/g, '')}.html`;
  if (usesNativeFiles()) return exportNativeBackup(filename, html);
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
