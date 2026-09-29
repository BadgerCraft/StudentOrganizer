import React, { useState, useMemo } from 'react';
import {
  X,
  BookOpen,
  History,
  Lock,
  FileText,
  Plus,
  AlertCircle,
  Clock,
  Settings
} from 'lucide-react';
import { ModalDialog } from './ModalDialog';
import type {
  Student,
  ClassEnrollment,
  Assessment,
  AssessmentCategory,
  StudentAssessment,
  CategoryResult,
  ParticipationEvent,
  GradingPolicy,
  GradeOverride,
  StudentNote,
  AuditEntry,
  AchievementCategoryCode,
  UUID
} from '../types/schema';
import { calculateOverallCourseGrade } from '../services/calculationEngine';
import { MarkbookDomainService } from '../services/markbookService';
import { StudentDomainService } from '../services/studentService';
import { getAppIdentity } from '../services/identityService';
import { AuthorizationError } from '../services/authHelper';
import { db } from '../db/database';

interface StudentProfileModalProps {
  enrollmentId: UUID;
  enrollment: ClassEnrollment;
  student: Student;
  assessments: Assessment[];
  categories: AssessmentCategory[];
  studentAssessments: StudentAssessment[];
  categoryResults: CategoryResult[];
  participationEvents: ParticipationEvent[];
  policy: GradingPolicy;
  overrides: GradeOverride[];
  notes: StudentNote[];
  auditEntries: AuditEntry[];
  userId?: UUID;
  deviceId?: UUID;
  onOpenSettings?: (student: Student) => void;
  onClose: () => void;
  onRefresh: () => void;
}

export const StudentProfileModal: React.FC<StudentProfileModalProps> = ({
  enrollmentId,
  enrollment,
  student,
  assessments,
  categories,
  studentAssessments,
  categoryResults,
  participationEvents,
  policy,
  overrides,
  notes,
  auditEntries,
  userId,
  deviceId,
  onOpenSettings,
  onClose,
  onRefresh
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'assessments' | 'participation' | 'notes' | 'audit'>('overview');
  const [showAddCustomAssessment, setShowAddCustomAssessment] = useState(false);
  const [customTitle, setCustomTitle] = useState('');
  const [customType, setCustomType] = useState<'formative' | 'summative'>('summative');
  const [customCategory, setCustomCategory] = useState<AchievementCategoryCode>('K');
  const [customMaxScore, setCustomMaxScore] = useState(100);
  const [customScore, setCustomScore] = useState('');
  const [customFeedback, setCustomFeedback] = useState('');

  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [overrideCategory, setOverrideCategory] = useState<'OVERALL' | AchievementCategoryCode>('OVERALL');
  const [overrideValue, setOverrideValue] = useState<number>(85);
  const [overrideRationale, setOverrideRationale] = useState('');
  const [newNoteContent, setNewNoteContent] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const isNoteDirty = newNoteContent.trim() !== '';
  const isCustomAssessmentDirty =
    customTitle.trim() !== '' ||
    customScore.trim() !== '' ||
    customFeedback.trim() !== '' ||
    customType !== 'summative' ||
    customCategory !== 'K' ||
    customMaxScore !== 100;
  const isOverrideDirty =
    showOverrideModal &&
    (overrideCategory !== 'OVERALL' ||
      overrideValue !== 85 ||
      overrideRationale.trim() !== '');

  const isProfileDirty = isNoteDirty || isCustomAssessmentDirty || isOverrideDirty;

  const handleOpenSettingsGuarded = () => {
    if (isProfileDirty) {
      const confirmed = window.confirm(
        'You have unsaved changes in this student profile. Navigating to settings will discard them. Are you sure you want to discard them?'
      );
      if (!confirmed) return;
    }
    onOpenSettings?.(student);
  };

  const handleToggleCustomAssessment = () => {
    if (showAddCustomAssessment && isCustomAssessmentDirty) {
      const confirmed = window.confirm(
        'You have an unfinished custom assignment draft. Discard this draft?'
      );
      if (!confirmed) return;
      setCustomTitle('');
      setCustomType('summative');
      setCustomCategory('K');
      setCustomMaxScore(100);
      setCustomScore('');
      setCustomFeedback('');
    }
    setShowAddCustomAssessment(!showAddCustomAssessment);
  };

  const markbookService = new MarkbookDomainService(db);
  const studentService = new StudentDomainService(db);

  const gradeSummary = useMemo(() => {
    return calculateOverallCourseGrade(
      enrollmentId,
      null,
      assessments,
      categories,
      studentAssessments,
      categoryResults,
      policy,
      overrides
    );
  }, [enrollmentId, assessments, categories, studentAssessments, categoryResults, policy, overrides]);

  const studentAssessmentList = useMemo(() => {
    const list = [];
    for (const a of assessments) {
      if (a.deletedAt !== null) continue;
      const sa = studentAssessments.find(s => s.classEnrollmentId === enrollmentId && s.assessmentId === a.id && s.deletedAt === null);
      const cats = categories.filter(c => c.assessmentId === a.id && c.deletedAt === null);
      const results = cats.map(c => {
        const r = sa ? categoryResults.find(res => res.studentAssessmentId === sa.id && res.assessmentCategoryId === c.id && res.deletedAt === null) : null;
        return { category: c, result: r };
      });
      if (sa || a.classSectionId === enrollment.classSectionId) {
        list.push({ assessment: a, sa, results });
      }
    }
    return list;
  }, [assessments, categories, studentAssessments, categoryResults, enrollmentId, enrollment.classSectionId]);

  const studentEvents = useMemo(() => {
    return participationEvents
      .filter(e => e.classEnrollmentId === enrollmentId && e.deletedAt === null)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  }, [participationEvents, enrollmentId]);

  const studentNotes = useMemo(() => {
    return notes
      .filter(n => n.classEnrollmentId === enrollmentId && n.deletedAt === null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [notes, enrollmentId]);

  const studentAudit = useMemo(() => {
    const saIds = new Set(studentAssessments.filter(s => s.classEnrollmentId === enrollmentId).map(s => s.id));
    const crIds = new Set(categoryResults.filter(r => saIds.has(r.studentAssessmentId)).map(r => r.id));
    return auditEntries
      .filter(a => crIds.has(a.entityId) || a.entityId === enrollmentId)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [auditEntries, studentAssessments, categoryResults, enrollmentId]);

  const missingCount = studentAssessments.filter(
    s => s.classEnrollmentId === enrollmentId && s.completionStatus === 'missing' && s.deletedAt === null
  ).length;

  const handleCreateCustomAssessment = async (e: React.FormEvent) => {
    e.preventDefault();
    const now = new Date().toISOString();
    const assessId = crypto.randomUUID();
    const catId = crypto.randomUUID();
    const saId = crypto.randomUUID();

    await db.transaction(
      'rw',
      [db.units, db.assessments, db.assessmentCategories, db.studentAssessments, db.categoryResults, db.auditEntries, db.syncMutations],
      async () => {
        let unit = await db.units.where('classSectionId').equals(enrollment.classSectionId).first();
        if (!unit) {
          const newUnit = {
            id: `unit-${enrollment.classSectionId}-1`,
            classSectionId: enrollment.classSectionId,
            code: 'U1',
            title: 'Unit 1: Course Foundations',
            sortOrder: 1,
            startsOn: null,
            endsOn: null,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            version: 1
          };
          await db.units.add(newUnit);
          unit = newUnit;
        }

        await db.assessments.add({
          id: assessId,
          classSectionId: enrollment.classSectionId,
          unitId: unit.id,
          reportingPeriodId: policy.reportingPeriodId || 'rp-midterm',
          code: `IND-${Date.now().toString().slice(-4)}`,
          title: customTitle.trim(),
          assessmentType: customType,
          assignedAt: now,
          dueAt: now,
          isLocked: false,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          version: 1
        });

        await db.assessmentCategories.add({
          id: catId,
          assessmentId: assessId,
          categoryCode: customCategory,
          maxScore: customMaxScore,
          evidenceWeight: 1.0,
          markScaleVersionId: policy.defaultMarkScaleVersionId,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          version: 1
        });

        await db.studentAssessments.add({
          id: saId,
          assessmentId: assessId,
          classEnrollmentId: enrollmentId,
          classSectionId: enrollment.classSectionId,
          workflowStatus: 'assessed',
          completionStatus: 'complete',
          isLate: false,
          assignedAt: now,
          dueAt: now,
          submittedAt: now,
          assessedAt: now,
          returnedAt: now,
          overallFeedback: customFeedback.trim() || null,
          privateNotes: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          version: 1
        });
      }
    );

    try {
      const currentIdentity = await getAppIdentity(db);
      if (userId && userId !== currentIdentity.userId) {
        throw new AuthorizationError('Acting teacher has changed since opening this profile. Please reopen the profile.');
      }

      if (customScore.trim() !== '') {
        await markbookService.recordCategoryResult({
          studentAssessmentId: saId,
          assessmentCategoryId: catId,
          rawScore: customScore.trim(),
          inputFormat: 'percentage',
          feedback: customFeedback.trim() || null,
          expectedStudentAssessmentVersion: 1,
          userId: currentIdentity.userId,
          deviceId: currentIdentity.deviceId
        });
      }

      setShowAddCustomAssessment(false);
      setCustomTitle('');
      setCustomScore('');
      setCustomFeedback('');
      setActionError(null);
      onRefresh();
    } catch (err: any) {
      setActionError(err.message || 'Failed to record custom assessment.');
    }
  };

  const handleSaveOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    try {
      const currentIdentity = await getAppIdentity(db);
      if (userId && userId !== currentIdentity.userId) {
        throw new AuthorizationError('Acting teacher has changed since opening this profile. Please reopen the profile.');
      }

      await markbookService.saveGradeOverride({
        classEnrollmentId: enrollmentId,
        reportingPeriodId: policy.reportingPeriodId || 'rp-midterm',
        categoryCode: overrideCategory,
        overridePercentage: overrideValue,
        rationale: overrideRationale.trim(),
        userId: currentIdentity.userId,
        deviceId: currentIdentity.deviceId
      });

      setShowOverrideModal(false);
      setOverrideRationale('');
      onRefresh();
    } catch (err: any) {
      setActionError(err.message || 'Failed to save grade override.');
    }
  };

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoteContent.trim()) return;
    setActionError(null);
    try {
      const currentIdentity = await getAppIdentity(db);
      if (userId && userId !== currentIdentity.userId) {
        throw new AuthorizationError('Acting teacher has changed since opening this profile. Please reopen the profile.');
      }

      await studentService.createStudentNote({
        classEnrollmentId: enrollmentId,
        content: newNoteContent.trim(),
        isConfidential: true,
        userId: currentIdentity.userId,
        deviceId: currentIdentity.deviceId
      });

      setNewNoteContent('');
      onRefresh();
    } catch (err: any) {
      setActionError(err.message || 'Failed to create student note.');
    }
  };
  return (
    <ModalDialog
      isOpen={true}
      onClose={onClose}
      isDirty={isProfileDirty}
      confirmDiscardMessage="You have unsaved changes in this student profile. Are you sure you want to discard them?"
      title={`Student Profile: ${student.preferredName || student.firstName} ${student.lastName}`}
      hideHeader={true}
      maxWidthClass="max-w-4xl"
      contentClassName="!p-0 h-[90vh] !rounded-3xl"
      testId="student-profile-modal"
    >
      {({ requestDismiss }) => (
        <div className="bg-white rounded-3xl w-full h-full shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
          {/* Header Profile Bar */}
          <div className="bg-slate-900 text-white p-6 flex items-start justify-between">
            <div className="flex items-center space-x-4">
              {student.photoUrl ? (
                <img
                  src={student.photoUrl}
                  alt={`${student.firstName} ${student.lastName}`}
                  className="w-14 h-14 rounded-2xl object-cover shadow-md border-2 border-white/20"
                />
              ) : (
                <div className="w-14 h-14 rounded-2xl bg-blue-600 text-white flex items-center justify-center text-xl font-extrabold shadow-md border-2 border-white/20">
                  {student.preferredName?.[0] || student.firstName[0]}
                  {student.lastName[0]}
                </div>
              )}
              <div>
                <div className="flex items-center space-x-2">
                  <h2 className="text-xl font-extrabold tracking-tight">
                    {student.preferredName ? `${student.preferredName} (${student.firstName})` : student.firstName} {student.lastName}
                  </h2>
                  {student.pronouns && (
                    <span className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full">
                      {student.pronouns}
                    </span>
                  )}
                </div>
                <div className="flex items-center space-x-3 text-xs text-slate-400 mt-1">
                  <span>Student ID: <strong className="text-slate-200 font-mono">#{student.localStudentNumber}</strong></span>
                  <span>&bull;</span>
                  <span className="capitalize">Status: <strong className="text-emerald-400">{enrollment.enrollmentStatus}</strong></span>
                  <span>&bull;</span>
                  <span className="flex items-center space-x-1 text-slate-300">
                    <Lock className="w-3 h-3 text-amber-400" />
                    <span>Private Records</span>
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              {onOpenSettings && (
                <button
                  type="button"
                  data-testid="profile-settings-gear-btn"
                  onClick={handleOpenSettingsGuarded}
                  className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition"
                  title="Edit Student Settings"
                  aria-label={`Edit ${student.firstName} ${student.lastName} settings`}
                >
                  <Settings className="w-5 h-5" />
                </button>
              )}
              <button
                type="button"
                onClick={requestDismiss}
                data-testid="profile-close-btn"
                aria-label="Close profile"
                className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {actionError && (
            <div
              role="alert"
              className="bg-rose-50 border-b border-rose-200 px-6 py-2.5 text-xs text-rose-800 flex items-center justify-between"
            >
              <span><strong>Action Error:</strong> {actionError}</span>
              <button
                type="button"
                onClick={() => setActionError(null)}
                className="text-rose-500 hover:text-rose-800 font-bold ml-4"
              >
                &times;
              </button>
            </div>
          )}

        {/* Tab Navigation */}
        <div className="bg-slate-100 border-b border-slate-200 px-6 flex items-center justify-between">
          <div className="flex items-center space-x-1">
            {[
              { id: 'overview', label: 'Overview', icon: BookOpen },
              { id: 'assessments', label: `Assessments (${studentAssessmentList.length})`, icon: FileText },
              { id: 'participation', label: `Participation (${studentEvents.length})`, icon: History },
              { id: 'notes', label: `Notes (${studentNotes.length})`, icon: Lock },
              { id: 'audit', label: `Audit (${studentAudit.length})`, icon: Clock }
            ].map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  data-testid={`profile-tab-${tab.id}`}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center space-x-2 py-3 px-4 text-xs font-bold border-b-2 transition ${
                    activeTab === tab.id
                      ? 'border-blue-600 text-blue-700 bg-white shadow-sm rounded-t-xl'
                      : 'border-transparent text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
          <button
            data-testid="open-grade-override-btn"
            onClick={() => setShowOverrideModal(true)}
            className="text-xs font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-3 py-1.5 rounded-lg transition"
          >
            Manual Grade Override
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                <div className="bg-white p-5 rounded-2xl border border-blue-200 shadow-sm bg-gradient-to-br from-blue-50/50 to-white">
                  <span className="text-xs font-bold text-blue-700 uppercase tracking-wider block">Overall Mark</span>
                  <div className="mt-2 flex items-baseline space-x-2">
                    <span className="text-3xl font-extrabold text-blue-900">
                      {gradeSummary.finalOverall !== null ? `${gradeSummary.finalOverall}%` : '--'}
                    </span>
                    {gradeSummary.isOverridden && (
                      <span className="text-xs font-bold text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">Overridden</span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Calculated: {gradeSummary.calculatedOverall !== null ? `${gradeSummary.calculatedOverall}%` : '--'}
                  </p>
                </div>

                {[
                  { code: 'K', label: 'Knowledge', res: gradeSummary.categoryBreakdown.K },
                  { code: 'T', label: 'Thinking', res: gradeSummary.categoryBreakdown.T },
                  { code: 'C', label: 'Communication', res: gradeSummary.categoryBreakdown.C },
                  { code: 'A', label: 'Application', res: gradeSummary.categoryBreakdown.A }
                ].map(item => (
                  <div key={item.code} className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="font-extrabold text-xs text-slate-900">{item.code}</span>
                        <span className="text-[10px] text-slate-400">{item.res.validAssessmentCount} tasks</span>
                      </div>
                      <span className="text-[11px] font-medium text-slate-500 block truncate mt-0.5">{item.label}</span>
                    </div>
                    <div className="mt-3">
                      <span className="text-2xl font-bold text-slate-900">
                        {item.res.score !== null ? `${item.res.score.toFixed(1)}%` : '--'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {missingCount > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center space-x-3 text-amber-900 text-xs">
                  <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
                  <span>Missing Work Alert: {missingCount} assignment(s) marked as missing.</span>
                </div>
              )}
            </div>
          )}

          {activeTab === 'assessments' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-bold text-slate-700">Assignments for {student.preferredName || student.firstName}</span>
                <button
                  onClick={handleToggleCustomAssessment}
                  data-testid="profile-add-assignment-btn"
                  className="inline-flex items-center space-x-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{showAddCustomAssessment ? 'Hide Assignment Form' : 'Add Individual Assignment'}</span>
                </button>
              </div>

              {showAddCustomAssessment && (
                <form onSubmit={handleCreateCustomAssessment} data-testid="custom-assessment-form" className="bg-white p-4 rounded-2xl border border-blue-200 shadow-md space-y-3 mb-4">
                  <h4 className="text-xs font-bold text-blue-900">Create Differentiated Assignment</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700">Title</label>
                      <input type="text" required data-testid="custom-assessment-title-input" value={customTitle} onChange={e => setCustomTitle(e.target.value)} placeholder="Oral Defense Alternative" className="w-full px-2.5 py-1.5 text-xs border rounded-lg" />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700">Type</label>
                        <select value={customType} data-testid="custom-assessment-type-select" onChange={e => setCustomType(e.target.value as any)} className="w-full px-2 py-1.5 text-xs border rounded-lg bg-white">
                          <option value="summative">Summative</option>
                          <option value="formative">Formative</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700">Category</label>
                        <select value={customCategory} data-testid="custom-assessment-category-select" onChange={e => setCustomCategory(e.target.value as any)} className="w-full px-2 py-1.5 text-xs border rounded-lg bg-white">
                          <option value="K">K</option><option value="T">T</option><option value="C">C</option><option value="A">A</option>
                        </select>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700">Score</label>
                      <input type="text" data-testid="custom-assessment-score-input" value={customScore} onChange={e => setCustomScore(e.target.value)} placeholder="e.g. 88% or 4+" className="w-full px-2.5 py-1.5 text-xs border rounded-lg" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700">Feedback</label>
                      <input type="text" data-testid="custom-assessment-feedback-input" value={customFeedback} onChange={e => setCustomFeedback(e.target.value)} placeholder="Optional feedback..." className="w-full px-2.5 py-1.5 text-xs border rounded-lg" />
                    </div>
                  </div>
                  <div className="flex justify-end space-x-2 pt-2 border-t">
                    <button type="button" data-testid="cancel-custom-assessment-btn" onClick={handleToggleCustomAssessment} className="px-3 py-1 text-xs text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
                    <button type="submit" data-testid="save-custom-assessment-btn" className="px-3 py-1 text-xs font-bold text-white bg-blue-600 rounded-lg">Save</button>
                  </div>
                </form>
              )}

              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 border-b">
                    <tr>
                      <th className="py-2.5 px-3">Title</th>
                      <th className="py-2.5 px-3">Type</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3">Results</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {studentAssessmentList.map(({ assessment, sa, results }) => (
                      <tr key={assessment.id}>
                        <td className="py-3 px-3">
                          <span className="font-bold text-slate-900 block">{assessment.title}</span>
                        </td>
                        <td className="py-3 px-3 uppercase text-[10px] font-bold text-slate-600">{assessment.assessmentType}</td>
                        <td className="py-3 px-3 font-bold text-slate-800">{sa?.completionStatus || 'assigned'}</td>
                        <td className="py-3 px-3">
                          <div className="flex items-center space-x-1.5">
                            {results.map(({ category, result }) => (
                              <span key={category.id} className="bg-slate-100 px-2 py-0.5 rounded font-bold">
                                {category.categoryCode}: {result ? result.rawScore : '--'}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'participation' && (
            <div className="space-y-3">
              {studentEvents.map(ev => (
                <div key={ev.id} className="bg-white p-3.5 rounded-xl border border-slate-200 flex items-center justify-between">
                  <div>
                    <span className="font-bold text-slate-900 text-xs">{ev.snapshottedName}</span>
                    {ev.note && <p className="text-xs text-slate-600 mt-0.5">{ev.note}</p>}
                    <span className="text-[10px] text-slate-400 block mt-1">{ev.localSchoolDate} &bull; {ev.snapshottedPoints} pts</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${ev.snapshottedClassification === 'positive' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                    {ev.snapshottedClassification}
                  </span>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'notes' && (
            <div className="space-y-4">
              <form onSubmit={handleAddNote} className="bg-white p-4 rounded-2xl border border-slate-200 space-y-2">
                <textarea rows={2} data-testid="profile-note-textarea" value={newNoteContent} onChange={e => setNewNoteContent(e.target.value)} placeholder="Record private observation..." className="w-full px-3 py-2 text-xs border rounded-xl" />
                <div className="flex justify-end">
                  <button type="submit" data-testid="profile-save-note-btn" className="px-4 py-1.5 text-xs font-bold text-white bg-blue-600 rounded-xl">Save Private Note</button>
                </div>
              </form>
              {studentNotes.map(n => (
                <div key={n.id} className="bg-white p-4 rounded-2xl border border-slate-200 text-xs">
                  <p className="text-slate-800">{n.content}</p>
                  <span className="text-[10px] text-slate-400 block mt-2">{n.createdAt.slice(0, 10)}</span>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'audit' && (
            <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
              {studentAudit.map(entry => (
                <div key={entry.id} className="p-3 text-xs">
                  <div className="flex justify-between font-bold text-slate-800">
                    <span>{entry.action} on {entry.entityName}</span>
                    <span className="text-[10px] text-slate-400 font-mono">{entry.timestamp.slice(0, 19).replace('T', ' ')}</span>
                  </div>
                  {entry.diffJson && <pre className="mt-1 text-[10px] bg-slate-50 p-2 rounded font-mono text-slate-600">{entry.diffJson}</pre>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Override Modal */}
        {showOverrideModal && (
          <ModalDialog
            isOpen={showOverrideModal}
            onClose={() => {
              setShowOverrideModal(false);
              setOverrideRationale('');
              setOverrideValue(85);
              setOverrideCategory('OVERALL');
            }}
            title="Teacher Manual Grade Override"
            maxWidthClass="max-w-sm"
            isDirty={overrideRationale.trim() !== '' || overrideValue !== 85 || overrideCategory !== 'OVERALL'}
            confirmDiscardMessage="You have unsaved grade override entries. Are you sure you want to discard them?"
            testId="override-modal"
          >
            {({ requestDismiss: requestDismissOverride }) => (
              <form onSubmit={handleSaveOverride} className="space-y-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700">Scope</label>
                  <select
                    data-testid="override-category-select"
                    value={overrideCategory}
                    onChange={e => setOverrideCategory(e.target.value as any)}
                    className="w-full px-2 py-1.5 text-xs border rounded-lg bg-white"
                  >
                    <option value="OVERALL">Overall Course Mark</option>
                    <option value="K">K (Knowledge)</option>
                    <option value="T">T (Thinking)</option>
                    <option value="C">C (Communication)</option>
                    <option value="A">A (Application)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700">Override %</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    data-testid="override-percentage-input"
                    value={overrideValue}
                    onChange={e => setOverrideValue(parseFloat(e.target.value))}
                    className="w-full px-2.5 py-1.5 text-xs border rounded-lg font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700">Rationale</label>
                  <textarea
                    required
                    rows={2}
                    data-testid="override-rationale-input"
                    value={overrideRationale}
                    onChange={e => setOverrideRationale(e.target.value)}
                    placeholder="Mandatory rationale note..."
                    className="w-full px-2.5 py-1.5 text-xs border rounded-lg"
                  />
                </div>
                <div className="flex justify-end space-x-2 pt-2 border-t">
                  <button
                    type="button"
                    data-testid="cancel-override-btn"
                    onClick={requestDismissOverride}
                    className="px-3 py-1 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    data-testid="save-override-btn"
                    className="px-3.5 py-1 text-xs font-bold text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                  >
                    Apply
                  </button>
                </div>
              </form>
            )}
          </ModalDialog>
        )}
      </div>
      )}
    </ModalDialog>
  );
};
