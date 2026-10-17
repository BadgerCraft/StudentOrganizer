import 'fake-indexeddb/auto';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { calculateOverallCourseGrade } from '../services/calculationEngine';
import { calculateAssessmentSummary, hasAssessmentFeedback, getMarkbookResultLabel, MarkbookView } from './MarkbookView';
import { LevelPicker } from './LevelPicker';
import { CLASSROOM_LEVELS } from '../services/classroomLevels';
import { AssessmentHubView } from './AssessmentHubView';
import type { AssessmentCategory, CategoryResult, StudentAssessment } from '../types/schema';

describe('assessment display preserves persisted grading inputs', () => {
  let db: OntarioTeacherDB;
  beforeEach(async () => { db = new OntarioTeacherDB(`fictional-display-${crypto.randomUUID()}`); await seedDatabase(db); });
  afterEach(async () => { await db.delete(); });

  async function fixture() {
    const section = (await db.classSections.get('class-eng4u-01')) ?? (await db.classSections.toCollection().first())!;
    const assessment = (await db.assessments.where('classSectionId').equals(section.id).first())!;
    const enrollment = (await db.classEnrollments.where('classSectionId').equals(section.id).first())!;
    const policy = { ...(await db.gradingPolicies.where('classSectionId').equals(section.id).first())!,
      weightK: 40, weightT: 30, weightC: 20, weightA: 10, excludeFormative: true, decimalPrecision: 1 };
    const category = (await db.assessmentCategories.toCollection().first())!;
    const categories: AssessmentCategory[] = (['A', 'C', 'T', 'K'] as const).map(categoryCode =>
      ({ ...category, id: `fictional-category-${categoryCode}`, assessmentId: assessment.id, categoryCode, evidenceWeight: 1, deletedAt: null }));
    const assignment: StudentAssessment = { ...(await db.studentAssessments.toCollection().first())!,
      id: 'fictional-assignment', assessmentId: assessment.id, classEnrollmentId: enrollment.id,
      classSectionId: section.id, completionStatus: 'complete', deletedAt: null };
    const sourceResult = (await db.categoryResults.toCollection().first())!;
    const percentages = { K: 90, T: 70, C: 50, A: 30 };
    const results: CategoryResult[] = categories.map(category => ({ ...sourceResult, id: `fictional-result-${category.categoryCode}`,
      studentAssessmentId: assignment.id, assessmentCategoryId: category.id, normalizedPercentage: percentages[category.categoryCode],
      rawScore: String(percentages[category.categoryCode]), deletedAt: null }));
    return { section, assessment, enrollment, policy, categories, assignment, results };
  }

  it('uses unequal class weights for both types while formative display preserves the saved course policy', async () => {
    const f = await fixture();
    const before = structuredClone(f);
    expect(calculateAssessmentSummary(f.enrollment.id, f.assessment, f.categories, [f.assignment], f.results, f.policy).finalOverall).toBe(70);
    const formative = { ...f.assessment, assessmentType: 'formative' as const };
    expect(calculateOverallCourseGrade(f.enrollment.id, formative.reportingPeriodId, [formative], f.categories, [f.assignment], f.results, f.policy, []).finalOverall).toBeNull();
    expect(calculateAssessmentSummary(f.enrollment.id, formative, f.categories, [f.assignment], f.results, f.policy).finalOverall).toBe(70);
    expect(calculateAssessmentSummary(f.enrollment.id, f.assessment, f.categories, [f.assignment],
      f.results.filter(result => ['fictional-category-K', 'fictional-category-T'].includes(result.assessmentCategoryId)), f.policy).finalOverall).toBe(81.4);
    expect(f).toEqual(before);
    const missing = { ...f.assignment, completionStatus: 'missing' as const };
    expect(calculateAssessmentSummary(f.enrollment.id, f.assessment, f.categories, [missing], f.results, f.policy).finalOverall).toBeNull();
    expect(calculateAssessmentSummary(f.enrollment.id, f.assessment, f.categories, [{ ...missing, completionStatus: 'excused' }], f.results, f.policy).finalOverall).toBeNull();
  });

  it('renders stored category identities in KTCA order in both the hub and markbook', async () => {
    const f = await fixture();
    const students = await db.students.toArray();
    const before = structuredClone(f.categories);
    const hub = renderToStaticMarkup(<AssessmentHubView classSection={f.section} assessments={[f.assessment]} categories={f.categories}
      units={await db.units.toArray()} enrollments={[f.enrollment]} students={students} userId="user-tyler" onRefresh={() => {}} />);
    expect(hub.match(/>Assesses:<\/span>(.*?)<\/div>/)?.[1]?.replace(/<[^>]+>/g, '')).toBe('KTCA');
    const html = renderToStaticMarkup(<MarkbookView classSectionId={f.section.id} reportingPeriodId={null} policy={f.policy}
      enrollments={[f.enrollment]} students={students} assessments={[f.assessment]} categories={f.categories}
      studentAssessments={[f.assignment]} categoryResults={f.results} overrides={[]} onRefresh={() => {}} onOpenStudentProfile={() => {}} />);
    expect([...html.matchAll(/data-testid="markbook-header-[^"]+-([KTCA])"/g)].map(match => match[1])).toEqual(['K', 'T', 'C', 'A']);
    for (const category of f.categories) expect(html).toContain(`markbook-cell-${f.enrollment.id}-${category.id}`);
    expect(f.categories).toEqual(before);
  });
  it('shows assigned levels by default and distinguishes unassessed, feedback-only, and historical direct marks', async () => {
    const f = await fixture();
    const students = await db.students.toArray();
    const result = f.results[0];
    const results: CategoryResult[] = [
      { ...result, id: 'assigned', assessmentCategoryId: 'fictional-category-K', inputFormat: 'classroom_level', rawScore: '4−(High)', normalizedPercentage: 85 },
      { ...result, id: 'feedback', assessmentCategoryId: 'fictional-category-T', inputFormat: 'descriptive', rawScore: '', normalizedPercentage: null, feedback: 'Fictional feedback.' },
      { ...result, id: 'historical', assessmentCategoryId: 'fictional-category-C', inputFormat: 'percentage', rawScore: '86.4%', normalizedPercentage: 86.4 },
    ];
    const render = (currentResults: CategoryResult[]) => renderToStaticMarkup(<MarkbookView classSectionId={f.section.id} reportingPeriodId={null} policy={f.policy}
      enrollments={[f.enrollment]} students={students} assessments={[f.assessment]} categories={f.categories}
      studentAssessments={[f.assignment]} categoryResults={currentResults} overrides={[]} onRefresh={() => {}} onOpenStudentProfile={() => {}} />);
    const before = structuredClone(results);
    const html = render(results);
    const cellText = (code: string) => html.match(new RegExp(`data-testid="markbook-cell-${f.enrollment.id}-fictional-category-${code}"[\\s\\S]*?<\\/td>`))?.[0]?.replace(/<[^>]+>/g, '');
    expect(cellText('K')).toContain('4−(High)');
    expect(cellText('T')).toContain('Feedback only');
    expect(cellText('C')).toContain('Direct mark');
    expect(cellText('A')).toContain('Unassessed');
    expect(html).toContain('Show percentage details');
    expect(html).not.toContain('86.4%');
    expect(html).toContain('Knowledge/Understanding');
    expect(html).toContain('Thinking');
    expect(html).toContain('Communication');
    expect(html).toContain('Application');
    expect(render([{ ...results[0], rawScore: '4+(med)', normalizedPercentage: 98 }, ...results.slice(1)])).toContain('4+(med)');
    expect(results).toEqual(before);
    expect(getMarkbookResultLabel(undefined)).toBe('Unassessed');
    expect(getMarkbookResultLabel({ ...result, inputFormat: 'scale_code', rawScore: 'R', normalizedPercentage: 35 })).toBe('R');
  });

  it('recognizes category-only and overall feedback without conflating students, deleted evidence or marks', async () => {
    const f = await fixture();
    const assignment = { ...f.assignment, overallFeedback: '' };
    const feedback = { ...f.results[0], normalizedPercentage: null, rawScore: '', feedback: 'Fictional category feedback.' };
    expect(hasAssessmentFeedback(assignment, f.categories, [feedback])).toBe(true);
    expect(hasAssessmentFeedback(assignment, f.categories, [{ ...feedback, feedback: '', inputFormat: 'descriptive', rawScore: 'Fictional descriptive text' }])).toBe(true);
    expect(hasAssessmentFeedback({ ...assignment, overallFeedback: 'Overall feedback' }, [], [])).toBe(true);
    expect(hasAssessmentFeedback(assignment, f.categories, [{ ...feedback, studentAssessmentId: 'other-student' }])).toBe(false);
    expect(hasAssessmentFeedback(assignment, f.categories, [{ ...feedback, deletedAt: '2026-10-17' }])).toBe(false);
    expect(hasAssessmentFeedback(assignment, [], [feedback])).toBe(false);
    expect(hasAssessmentFeedback(assignment, f.categories, [{ ...feedback, feedback: '  ' }])).toBe(false);
    expect(hasAssessmentFeedback(undefined, f.categories, [feedback])).toBe(false);
  });

  it('renders all 17 level choices with an explicit selected state and no implicit default selection', () => {
    const unselected = renderToStaticMarkup(<LevelPicker value="" onChange={() => {}} />);
    expect(unselected.match(/aria-pressed="false"/g)).toHaveLength(17);
    for (const level of CLASSROOM_LEVELS) {
      const html = renderToStaticMarkup(<LevelPicker value={level.label} onChange={() => {}} />);
      expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
      expect(html).toContain(`</span>${level.label}</button>`);
    }
  });

});
