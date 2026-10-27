import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Search,
  ArrowUpDown,
  AlertCircle,
  Eye,
  X
} from 'lucide-react';
import type {
  Assessment,
  AssessmentCategory,
  ClassEnrollment,
  Student,
  StudentAssessment,
  CategoryResult,
  GradingPolicy,
  GradeOverride,
  ScoreInputFormat,
  CompletionStatus,
  UUID
} from '../types/schema';
import { calculateOverallCourseGrade } from '../services/calculationEngine';
import { MarkbookDomainService, type SaveMarkbookCellParams } from '../services/markbookService';
import { getAppIdentity, getActiveTeacherId, getIdentityEpoch, subscribeIdentityChange } from '../services/identityService';
import { AuthorizationError } from '../services/authHelper';
import { db } from '../db/database';
import { LevelPicker } from './LevelPicker';
import { sortCategoriesForDisplay } from '../utils/categoryDisplay';

interface MarkbookViewProps {
  classSectionId: UUID;
  reportingPeriodId: UUID | null;
  policy: GradingPolicy;
  enrollments: ClassEnrollment[];
  students: Student[];
  assessments: Assessment[];
  categories: AssessmentCategory[];
  studentAssessments: StudentAssessment[];
  categoryResults: CategoryResult[];
  overrides: GradeOverride[];
  userId?: UUID;
  deviceId?: UUID;
  onOpenStudentProfile: (enrollmentId: UUID) => void;
  onOpenMarking?: (assessmentId: string, enrollmentId: string) => void;
  onRefresh: () => void;
}

/** Display one assessment with the existing engine and a temporary formative policy. */
export function calculateAssessmentSummary(enrollmentId: UUID, assessment: Assessment,
  categories: AssessmentCategory[], assignments: StudentAssessment[], results: CategoryResult[], policy: GradingPolicy) {
  return calculateOverallCourseGrade(enrollmentId, assessment.reportingPeriodId,
    [assessment], categories, assignments, results, { ...policy, excludeFormative: false }, []);
}

/** Feedback presence is display-only and restricted to this assignment's live categories. */
export function hasAssessmentFeedback(assignment: StudentAssessment | undefined, categories: AssessmentCategory[], results: CategoryResult[]): boolean {
  if (!assignment || assignment.deletedAt !== null) return false;
  if (assignment.overallFeedback?.trim()) return true;
  const categoryIds = new Set(categories.filter(category => category.assessmentId === assignment.assessmentId && category.deletedAt === null).map(category => category.id));
  return results.some(result => result.studentAssessmentId === assignment.id && result.deletedAt === null && categoryIds.has(result.assessmentCategoryId)
    && (!!result.feedback?.trim() || (result.inputFormat === 'descriptive' && !!result.rawScore.trim())));
}

/** Display only the saved representation; never infer a level from a percentage. */
export function getMarkbookResultLabel(result: CategoryResult | null | undefined): string {
  if (!result) return 'Unassessed';
  if (result.inputFormat === 'classroom_level' || result.inputFormat === 'scale_code') {
    if (result.rawScore.trim()) return result.rawScore;
  }
  if (result.normalizedPercentage !== null) return 'Direct mark';
  return result.feedback?.trim() || result.rawScore.trim() ? 'Feedback only' : 'Unassessed';
}

export const MarkbookView: React.FC<MarkbookViewProps> = ({
  classSectionId,
  reportingPeriodId,
  policy,
  enrollments,
  students,
  assessments,
  categories,
  studentAssessments,
  categoryResults,
  overrides,
  userId,
  deviceId,
  onOpenStudentProfile,
  onRefresh,
  onOpenMarking
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [showPercentages, setShowPercentages] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'summative' | 'formative'>('all');
  const [filterCategory, setFilterCategory] = useState<'all' | 'K' | 'T' | 'C' | 'A'>('all');
  const [sortField, setSortField] = useState<'lastName' | 'overall'>('lastName');
  const [sortAsc, setSortAsc] = useState(true);
  const [collapsedAssessments, setCollapsedAssessments] = useState<Set<UUID>>(new Set());
  const toggleAssessment = (id: UUID) => setCollapsedAssessments(previous => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // Cell Editor Popover state
  const [activeCell, setActiveCell] = useState<{
    identityEpoch: number;
    classSectionId: UUID;
    enrollmentId: UUID;
    assessmentId: UUID;
    categoryId: UUID;
    studentName: string;
    assessmentTitle: string;
    categoryCode: string;
    maxScore: number;
    currentRawScore: string;
    currentFormat: ScoreInputFormat;
    currentCompletion: CompletionStatus;
    currentIsLate: boolean;
    currentFeedback: string;
    expectedCellState: NonNullable<SaveMarkbookCellParams['expectedCellState']>;
  } | null>(null);

  const [editScore, setEditScore] = useState('');
  const [editFormat, setEditFormat] = useState<ScoreInputFormat>('classroom_level');
  const [editCompletion, setEditCompletion] = useState<CompletionStatus>('complete');
  const [editIsLate, setEditIsLate] = useState(false);
  const [editFeedback, setEditFeedback] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);

  const mounted = useRef(true);
  const context = useRef({ classSectionId, userId });
  context.current = { classSectionId, userId };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setActiveCell(null); setSaveError(null); }, [classSectionId, userId]);
  useEffect(() => subscribeIdentityChange(() => setActiveCell(null)), []);

  const markbookService = new MarkbookDomainService(db);

  // Student map
  const studentMap = new Map<UUID, Student>();
  students.forEach(s => studentMap.set(s.id, s));

  // Filtered Assessments
  const filteredAssessments = useMemo(() => {
    return assessments.filter(a => {
      if (a.deletedAt !== null) return false;
      if (reportingPeriodId && a.reportingPeriodId !== reportingPeriodId) return false;
      if (filterType !== 'all' && a.assessmentType !== filterType) return false;
      if (filterCategory !== 'all') {
        const hasCat = categories.some(c => c.assessmentId === a.id && c.categoryCode === filterCategory && c.deletedAt === null);
        if (!hasCat) return false;
      }
      return true;
    });
  }, [assessments, categories, reportingPeriodId, filterType, filterCategory]);

  // Flattened column structure: For each assessment, list its assessed categories
  const columnDefs = useMemo(() => {
    const list: {
      assessment: Assessment;
      category: AssessmentCategory | null;
    }[] = [];

    for (const a of filteredAssessments) {
      if (collapsedAssessments.has(a.id) && filterCategory === 'all') {
        list.push({ assessment: a, category: null });
        continue;
      }
      const cats = sortCategoriesForDisplay(categories.filter(c => c.assessmentId === a.id && c.deletedAt === null));
      for (const cat of cats) {
        if (filterCategory === 'all' || cat.categoryCode === filterCategory) {
          list.push({ assessment: a, category: cat });
        }
      }
    }
    return list;
  }, [filteredAssessments, categories, filterCategory, collapsedAssessments]);

  // Prepare Student Row Data with Calculated Grades
  const studentRows = useMemo(() => {
    const activeEnrollments = enrollments.filter(e => e.deletedAt === null && e.enrollmentStatus === 'active');

    const rows = activeEnrollments.map(enr => {
      const student = studentMap.get(enr.studentId);
      const gradeResult = calculateOverallCourseGrade(
        enr.id,
        reportingPeriodId,
        assessments,
        categories,
        studentAssessments,
        categoryResults,
        policy,
        overrides
      );

      return {
        enr,
        student,
        gradeResult
      };
    }).filter(r => r.student !== undefined);

    // Filter by search
    const filtered = rows.filter(r => {
      if (!searchQuery.trim()) return true;
      const s = r.student!;
      const q = searchQuery.toLowerCase();
      return (
        s.lastName.toLowerCase().includes(q) ||
        s.firstName.toLowerCase().includes(q) ||
        (s.preferredName && s.preferredName.toLowerCase().includes(q)) ||
        s.localStudentNumber.toLowerCase().includes(q)
      );
    });

    // Sort
    filtered.sort((a, b) => {
      if (sortField === 'lastName') {
        const comp = (a.student?.lastName ?? '').localeCompare(b.student?.lastName ?? '');
        return sortAsc ? comp : -comp;
      } else {
        const gA = a.gradeResult.finalOverall ?? -1;
        const gB = b.gradeResult.finalOverall ?? -1;
        return sortAsc ? gA - gB : gB - gA;
      }
    });

    return filtered;
  }, [enrollments, students, assessments, categories, studentAssessments, categoryResults, policy, overrides, reportingPeriodId, searchQuery, sortField, sortAsc]);

  const handleCellClick = (
    enrollmentId: UUID,
    assessment: Assessment,
    category: AssessmentCategory,
    studentName: string
  ) => {
    const sa = studentAssessments.find(s => s.classEnrollmentId === enrollmentId && s.assessmentId === assessment.id && s.deletedAt === null);
    const cr = sa ? categoryResults.find(r => r.studentAssessmentId === sa.id && r.assessmentCategoryId === category.id && r.deletedAt === null) : null;

    setActiveCell({
      identityEpoch: getIdentityEpoch(),
      classSectionId,
      enrollmentId,
      assessmentId: assessment.id,
      categoryId: category.id,
      studentName,
      assessmentTitle: assessment.title,
      categoryCode: category.categoryCode,
      maxScore: category.maxScore,
      currentRawScore: cr?.rawScore || '',
      currentFormat: cr?.inputFormat || 'classroom_level',
      currentCompletion: sa?.completionStatus || 'complete',
      currentIsLate: sa?.isLate || false,
      currentFeedback: cr?.feedback || '',
      expectedCellState: {
        studentAssessment: sa ? { id: sa.id, version: sa.version } : null,
        categoryResult: cr ? { id: cr.id, version: cr.version } : null,
      }
    });

    setEditScore(cr?.rawScore || '');
    setEditFormat(cr?.inputFormat || 'classroom_level');
    setEditCompletion(sa?.completionStatus || 'complete');
    setEditIsLate(sa?.isLate || false);
    setEditFeedback(cr?.feedback || '');
    setSaveError(null);
  };

  const handleSaveCell = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCell) return;
    setSaveError(null);

    try {
      const current = () => mounted.current && !!userId && context.current.userId === userId &&
        context.current.classSectionId === activeCell.classSectionId && classSectionId === activeCell.classSectionId &&
        getActiveTeacherId() === userId && getIdentityEpoch() === activeCell.identityEpoch;
      if (!current()) throw new AuthorizationError('Acting teacher or class changed. Please reopen the cell editor.');
      const currentIdentity = await getAppIdentity(db);
      if (!current() || userId !== currentIdentity.userId || (deviceId && deviceId !== currentIdentity.deviceId)) {
        throw new AuthorizationError('Acting teacher has changed. Please refresh and try again.');
      }

      await markbookService.saveMarkbookCell({
        assessmentId: activeCell.assessmentId,
        classEnrollmentId: activeCell.enrollmentId,
        classSectionId,
        completionStatus: editCompletion,
        isLate: editIsLate,
        assessmentCategoryId: activeCell.categoryId,
        rawScore: editScore.trim(),
        inputFormat: editFormat,
        feedback: editFeedback.trim() || null,
        expectedCellState: activeCell.expectedCellState,
        userId: currentIdentity.userId,
        deviceId: currentIdentity.deviceId
      });

      setActiveCell(null);
      onRefresh();
    } catch (err: any) {
      setSaveError(err?.message || 'Failed to save result.');
    }
  };

  const getCategoryColor = (code: string) => {
    switch (code) {
      case 'K': return 'bg-blue-600 text-white';
      case 'T': return 'bg-purple-600 text-white';
      case 'C': return 'bg-emerald-600 text-white';
      case 'A': return 'bg-amber-600 text-white';
      default: return 'bg-slate-600 text-white';
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Filter and Search Toolbar */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-3 flex-1 min-w-[280px]">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search student by name or ID..."
              className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50/50"
            />
          </div>

          {/* Assessment Type Filter */}
          <div className="flex items-center space-x-1 bg-slate-100 p-0.5 rounded-xl border border-slate-200 text-xs">
            <button
              onClick={() => setFilterType('all')}
              className={`px-3 py-1 rounded-lg font-medium transition ${
                filterType === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All Types
            </button>
            <button
              onClick={() => setFilterType('summative')}
              className={`px-3 py-1 rounded-lg font-medium transition ${
                filterType === 'summative' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Summative
            </button>
            <button
              onClick={() => setFilterType('formative')}
              className={`px-3 py-1 rounded-lg font-medium transition ${
                filterType === 'formative' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Formative
            </button>
          </div>

          {/* Category Filter */}
          <div className="flex items-center space-x-1 bg-slate-100 p-0.5 rounded-xl border border-slate-200 text-xs">
            {(['all', 'K', 'T', 'C', 'A'] as const).map(cat => (
              <button
                key={cat}
                onClick={() => setFilterCategory(cat)}
                className={`px-2.5 py-1 rounded-lg font-bold transition ${
                  filterCategory === cat
                    ? 'bg-white text-blue-700 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {cat === 'all' ? 'All Cats' : cat}
              </button>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center space-x-3 text-xs">
          <span className="flex items-center space-x-1">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-600" />
            <span className="text-slate-600">K (Knowledge/Understanding)</span>
          </span>
          <span className="flex items-center space-x-1">
            <span className="w-2.5 h-2.5 rounded-full bg-purple-600" />
            <span className="text-slate-600">T (Thinking)</span>
          </span>
          <span className="flex items-center space-x-1">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-600" />
            <span className="text-slate-600">C (Communication)</span>
          </span>
          <span className="flex items-center space-x-1">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-600" />
            <span className="text-slate-600">A (Application)</span>
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3 text-xs">
        <button type="button" onClick={() => { setFilterCategory('all'); setCollapsedAssessments(new Set(filteredAssessments.map(a => a.id))); }} className="text-blue-700 font-bold border rounded-lg px-3 py-2">Collapse assessment details</button>
        <button type="button" onClick={() => setCollapsedAssessments(new Set())} className="text-blue-700 font-bold border rounded-lg px-3 py-2">Expand assessment details</button>
        <button type="button" aria-pressed={showPercentages} onClick={() => setShowPercentages(value => !value)} className="inline-flex items-center gap-2 text-blue-700 font-bold border rounded-lg px-3 py-2"><Eye className="w-4 h-4" />{showPercentages ? 'Hide percentage details' : 'Show percentage details'}</button>
        <span className="text-slate-600">Recorded levels appear as assigned. Calculated summaries have percentage details; historical percentages are never converted to levels. Assessment summaries use class category weights. Formative summaries do not change the course grade.</span>
      </div>

      {/* Spreadsheet Master Markbook Table */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
        <div className="overflow-x-auto max-h-[72vh] relative">
          <table className="w-full text-left border-collapse text-xs">
            {/* Header Row */}
            <thead className="bg-slate-50/90 sticky top-0 z-20 backdrop-blur-sm border-b border-slate-200">
              <tr>
                {/* Frozen Student Column */}
                <th className="sticky left-0 z-30 bg-slate-100/95 px-4 py-3 font-bold text-slate-800 border-r border-slate-200 w-64 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">
                  <button
                    onClick={() => {
                      if (sortField === 'lastName') setSortAsc(!sortAsc);
                      else { setSortField('lastName'); setSortAsc(true); }
                    }}
                    className="flex items-center space-x-1 hover:text-blue-600 transition"
                  >
                    <span>Student Roster ({studentRows.length})</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400" />
                  </button>
                </th>

                {showPercentages && <>
                {/* Overall Course Mark */}
                <th className="px-4 py-3 font-extrabold text-blue-900 bg-blue-50/70 border-r border-blue-200 text-center w-28">
                  <button
                    onClick={() => {
                      if (sortField === 'overall') setSortAsc(!sortAsc);
                      else { setSortField('overall'); setSortAsc(false); }
                    }}
                    className="flex items-center justify-center space-x-1 w-full"
                  >
                    <span>Course summary</span>
                    <ArrowUpDown className="w-3 h-3 text-blue-400" />
                  </button>
                </th>

                {/* K, T, C, A Summary Columns */}
                <th className="px-3 py-3 font-bold text-blue-700 bg-blue-50/40 border-r border-slate-200 text-center min-w-[150px]">
                  Knowledge/Understanding
                </th>
                <th className="px-3 py-3 font-bold text-purple-700 bg-purple-50/40 border-r border-slate-200 text-center min-w-[120px]">
                  Thinking
                </th>
                <th className="px-3 py-3 font-bold text-emerald-700 bg-emerald-50/40 border-r border-slate-200 text-center min-w-[120px]">
                  Communication
                </th>
                <th className="px-3 py-3 font-bold text-amber-700 bg-amber-50/40 border-r border-slate-200 text-center min-w-[120px]">
                  Application
                </th>

                </>}
                {/* Assessment Category Columns */}
                {columnDefs.map(({ assessment, category }) => (
                  <th
                    key={`${assessment.id}-${category?.id ?? 'summary'}`}
                    data-testid={`markbook-header-${assessment.id}-${category?.categoryCode ?? 'summary'}`}
                    className="px-3 py-2.5 border-r border-slate-200 min-w-[130px] font-semibold text-slate-800"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold truncate text-slate-900 block" title={assessment.title}>
                        {assessment.title}
                      </span>
                      {category && <span title={category.categoryCode === 'K' ? 'Knowledge/Understanding' : category.categoryCode === 'T' ? 'Thinking' : category.categoryCode === 'C' ? 'Communication' : 'Application'} className={`w-4 h-4 rounded text-[10px] font-bold flex items-center justify-center ${getCategoryColor(category.categoryCode)}`}>
                        {category.categoryCode}
                      </span>}
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-slate-600 mt-0.5">
                      <span className="truncate max-w-[85px]">{assessment.assessmentType}</span>
                      <span className="text-slate-600 font-mono">{category ? `/${category.maxScore}` : 'Overall %'}</span>
                    </div>
                    {filterCategory === 'all' && <button type="button" aria-label={`${category ? 'Collapse' : 'Expand'} ${assessment.title} category details`} aria-expanded={!!category} onClick={() => toggleAssessment(assessment.id)} className="mt-1 min-h-[44px] px-2 text-blue-700 underline">{category ? 'Collapse' : 'Expand categories'}</button>}
                  </th>
                ))}
              </tr>
            </thead>

            {/* Table Body */}
            <tbody className="divide-y divide-slate-100">
              {studentRows.map(({ enr, student, gradeResult }, rIdx) => {
                const std = student!;
                const kScore = gradeResult.categoryBreakdown.K.score;
                const tScore = gradeResult.categoryBreakdown.T.score;
                const cScore = gradeResult.categoryBreakdown.C.score;
                const aScore = gradeResult.categoryBreakdown.A.score;

                return (
                  <tr
                    key={enr.id}
                    className={`hover:bg-slate-50/80 transition ${
                      rIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'
                    }`}
                  >
                    {/* Frozen Student Name */}
                    <td className="sticky left-0 z-10 bg-inherit px-4 py-2.5 font-medium text-slate-900 border-r border-slate-200 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">
                      <div className="flex items-center justify-between">
                        <div className="truncate">
                          <button
                            onClick={() => onOpenStudentProfile(enr.id)}
                            className="font-bold text-slate-900 hover:text-blue-600 transition text-left truncate block"
                          >
                            {std.lastName}, {std.preferredName || std.firstName}
                          </button>
                          <span className="text-[10px] text-slate-600 font-mono block">
                            #{std.localStudentNumber}
                          </span>
                        </div>
                        <button
                          onClick={() => onOpenStudentProfile(enr.id)}
                          className="p-1 text-slate-300 hover:text-blue-600 rounded"
                          title="Open Profile"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>

                    {showPercentages && <>
                    {/* Overall Calculated % */}
                    <td className="px-4 py-2.5 font-extrabold text-center border-r border-blue-200 bg-blue-50/20 text-blue-900 text-sm">
                      {gradeResult.finalOverall !== null ? (
                        <span className="flex items-center justify-center space-x-1">
                          <span>{showPercentages ? `${gradeResult.finalOverall}%` : 'Calculated'}</span>
                          {gradeResult.isOverridden && (
                            <span className="text-[10px] text-amber-600 font-bold" title={gradeResult.overrideRationale || 'Manual Override'}>
                              *
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-slate-600 font-normal">--</span>
                      )}
                    </td>

                    {/* K, T, C, A Category Averages */}
                    <td className="px-2 py-2.5 text-center font-bold text-blue-700 border-r border-slate-200">
                      {kScore !== null ? (showPercentages ? `${kScore.toFixed(policy.decimalPrecision)}%` : 'Calculated') : 'Unassessed'}
                    </td>
                    <td className="px-2 py-2.5 text-center font-bold text-purple-700 border-r border-slate-200">
                      {tScore !== null ? (showPercentages ? `${tScore.toFixed(policy.decimalPrecision)}%` : 'Calculated') : 'Unassessed'}
                    </td>
                    <td className="px-2 py-2.5 text-center font-bold text-emerald-700 border-r border-slate-200">
                      {cScore !== null ? (showPercentages ? `${cScore.toFixed(policy.decimalPrecision)}%` : 'Calculated') : 'Unassessed'}
                    </td>
                    <td className="px-2 py-2.5 text-center font-bold text-amber-700 border-r border-slate-200">
                      {aScore !== null ? (showPercentages ? `${aScore.toFixed(policy.decimalPrecision)}%` : 'Calculated') : 'Unassessed'}
                    </td>

                    </>}
                    {/* Assessment Subcolumn Cells */}
                    {columnDefs.map(({ assessment, category }) => {
                      const sa = studentAssessments.find(
                        s => s.classEnrollmentId === enr.id && s.assessmentId === assessment.id && s.deletedAt === null
                      );
                      if (!category) {
                        // Reuse the grading engine; this single-assessment display has no course overrides.
                        // Include formative evidence here only, without modifying the saved/course policy.
                        const summary = calculateAssessmentSummary(enr.id, assessment, categories, studentAssessments, categoryResults, policy);
                        return <td key={`${assessment.id}-summary`} data-testid={`markbook-summary-${enr.id}-${assessment.id}`} className="px-3 py-2 text-center border-r border-slate-200">
                          <span className="font-bold">{sa?.completionStatus === 'excused' ? 'EXC' : summary.finalOverall !== null ? (showPercentages ? `${summary.finalOverall}%` : 'Calculated') : hasAssessmentFeedback(sa, categories, categoryResults) ? 'Feedback only' : 'Unassessed'}</span>
                          {sa?.completionStatus === 'missing' && <span className="block text-[10px] text-red-700">Missing</span>}
                          {sa?.isLate && <span className="block text-[10px] text-amber-700">Late</span>}
                          <button type="button" onClick={() => toggleAssessment(assessment.id)} aria-label={`Edit ${assessment.title} categories for ${std.preferredName || std.firstName} ${std.lastName}`} className="block mx-auto mt-1 text-blue-700 underline">Edit categories</button>
                        </td>;
                      }
                      const cr = sa
                        ? categoryResults.find(r => r.studentAssessmentId === sa.id && r.assessmentCategoryId === category.id && r.deletedAt === null)
                        : null;

                      const isExcused = sa?.completionStatus === 'excused';
                      const isMissing = sa?.completionStatus === 'missing';
                      const isLate = sa?.isLate;

                      return (
                        <td
                          key={`${assessment.id}-${category.id}`}
                          data-testid={`markbook-cell-${enr.id}-${category.id}`}
                          tabIndex={0}
                          role="button"
                          aria-label={`Edit ${assessment.title}, ${category.categoryCode}, ${std.preferredName || std.firstName} ${std.lastName}`}
                          onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); handleCellClick(enr.id, assessment, category, `${std.preferredName || std.firstName} ${std.lastName}`); } }}
                          onClick={() => handleCellClick(enr.id, assessment, category, `${std.preferredName || std.firstName} ${std.lastName}`)}
                          className="px-3 py-2 text-center border-r border-slate-200 hover:bg-blue-100/40 cursor-pointer transition select-none group"
                        >
                          <div className="flex items-center justify-center space-x-1.5">
                            {/* Value Display */}
                            {isExcused ? (
                              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-bold text-[10px]">
                                EXC
                              </span>
                            ) : isMissing ? (
                              <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-bold text-[10px]">
                                MISS
                              </span>
                            ) : cr ? (
                              <span className="font-bold text-slate-800 text-xs">
                                {getMarkbookResultLabel(cr)}
                                {showPercentages && cr.normalizedPercentage !== null && <span className="block text-[10px] font-normal text-slate-600">{cr.normalizedPercentage}%</span>}
                              </span>
                            ) : (
                              <span className="text-slate-600 group-hover:text-slate-600">Unassessed</span>
                            )}

                            {/* Orthogonal Late Badge (never overwriting mark!) */}
                            {isLate && (
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" title="Submitted Late" />
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Focused Cell Editor Modal / Popover */}
      {activeCell && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-100">
          <div className="bg-white rounded-2xl max-w-md w-full max-h-[calc(100dvh-2rem)] overflow-y-auto p-6 shadow-2xl border border-slate-200">
            <div className="flex items-start justify-between pb-3 border-b border-slate-100 mb-4">
              <div>
                <span className="text-xs font-bold text-blue-600 uppercase tracking-wider block">
                  {activeCell.assessmentTitle}
                </span>
                <h3 className="text-base font-extrabold text-slate-900 mt-0.5">
                  {activeCell.studentName}
                </h3>
              </div>
              <button
                onClick={() => setActiveCell(null)}
                aria-label="Close result editor"
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {saveError && (
              <div className="mb-4 bg-red-50 text-red-700 border border-red-200 text-xs p-3 rounded-xl flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
                <span>{saveError}</span>
              </div>
            )}

            <form onSubmit={handleSaveCell} className="space-y-4">
              {/* Category Badge & Max Score */}
              <div className="flex items-center justify-between bg-slate-50 px-3 py-2 rounded-xl border border-slate-200 text-xs">
                <span className="font-semibold text-slate-700">
                  Category: <strong className="text-slate-900">{activeCell.categoryCode}</strong>
                </span>
                <span className="text-slate-500 font-mono">
                  Max Score: {activeCell.maxScore} pts
                </span>
              </div>

              <div className="space-y-3">
                <div className="flex flex-wrap gap-2" aria-label="Result type">
                  <button type="button" aria-pressed={editFormat === 'descriptive'} onClick={() => { setEditFormat('descriptive'); setEditScore(''); }} className="border-2 rounded-lg px-3 py-2 font-semibold">{editFormat === 'descriptive' ? '✓ ' : ''}Feedback only</button>
                  <button type="button" aria-pressed={editFormat === 'classroom_level'} onClick={() => { if (editFormat !== 'classroom_level') setEditScore(''); setEditFormat('classroom_level'); }} className="border-2 rounded-lg px-3 py-2 font-semibold">{editFormat === 'classroom_level' ? '✓ ' : ''}Level</button>
                </div>
                {editFormat === 'classroom_level' ? <LevelPicker value={editScore} onChange={setEditScore} label={`Assigned ${activeCell.categoryCode} level`} /> : editFormat === 'descriptive' ? <p className="text-xs text-slate-600">Feedback is saved without a grade.</p> : <div className="space-y-2">
                  <p className="text-xs text-slate-600">This saved result uses its original {editFormat === 'scale_code' ? 'assessment scale' : editFormat === 'raw_points' ? 'points' : 'percentage'}. Choose Level to assign a classroom level explicitly.</p>
                  <label className="block text-xs font-bold">Existing result<input aria-label="Existing result" value={editScore} onChange={event => setEditScore(event.target.value)} className="block w-full border rounded-lg p-2" /></label>
                </div>}
              </div>

              {/* Orthogonal Status Flags (Late, Missing, Excused, Incomplete) */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Completion status
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setEditCompletion('complete')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition border ${
                      editCompletion === 'complete'
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    Complete
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditCompletion('missing')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition border ${
                      editCompletion === 'missing'
                        ? 'bg-red-50 text-red-800 border-red-300'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    Missing
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditCompletion('excused')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition border ${
                      editCompletion === 'excused'
                        ? 'bg-blue-50 text-blue-800 border-blue-300'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    Excused
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditCompletion('incomplete')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition border ${
                      editCompletion === 'incomplete'
                        ? 'bg-amber-50 text-amber-800 border-amber-300'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    Incomplete
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditIsLate(!editIsLate)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition border ${
                      editIsLate
                        ? 'bg-amber-500 text-white border-amber-600'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    Late Flag
                  </button>
                </div>
              </div>

              <div className="rounded-lg bg-blue-50 p-3 text-sm">
                <p className="font-semibold">Official assessment feedback</p>
                <p className="whitespace-pre-wrap">{studentAssessments.find(sa => sa.assessmentId === activeCell.assessmentId && sa.classEnrollmentId === activeCell.enrollmentId && sa.deletedAt === null)?.overallFeedback || 'No overall assessment feedback saved.'}</p>
                <button type="button" className="mt-2 text-blue-700 underline" onClick={() => { onOpenMarking?.(activeCell.assessmentId, activeCell.enrollmentId); setActiveCell(null); }}>Open marking and feedback</button>
                <p className="mt-1 text-xs">Marking owns draft feedback. Finalizing replaces official feedback after checking for newer manual changes.</p>
              </div>
              {/* Feedback Note */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Qualitative Feedback
                </label>
                <textarea
                  rows={2}
                  value={editFeedback}
                  onChange={e => setEditFeedback(e.target.value)}
                  placeholder="Optional constructive feedback for this category..."
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setEditScore('');
                    setEditFormat('descriptive');
                  }}
                  className="text-xs text-red-600 hover:underline"
                >
                  Clear level
                </button>
                <div className="flex space-x-2">
                  <button
                    type="button"
                    onClick={() => setActiveCell(null)}
                    className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition active:scale-95"
                  >
                    Save Result
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
