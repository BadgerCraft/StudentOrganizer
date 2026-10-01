import { useState, useEffect, useMemo, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db/database';
import { seedDatabase } from './db/seeds';
import { Header } from './components/Header';
import { BugReportModal } from './components/BugReportModal';
import { DashboardView } from './components/DashboardView';
import { SeatingChartView } from './components/SeatingChartView';
import { MarkbookView } from './components/MarkbookView';
import { ParticipationDock } from './components/ParticipationDock';
import { StudentProfileModal } from './components/StudentProfileModal';
import { AssessmentHubView } from './components/AssessmentHubView';
import { ParticipationLedgerView } from './components/ParticipationLedgerView';
import { ImportExportModal } from './components/ImportExportModal';
import { SettingsView } from './components/SettingsView';
import { StudentSettingsModal } from './components/StudentSettingsModal';
import { TeacherSelectorModal } from './components/TeacherSelectorModal';
import { ParticipationDomainService } from './services/participationService';
import { ParticipationEventTypeService } from './services/eventTypeService';
import { ClassSessionService } from './services/sessionService';
import { getAppIdentity, selectActingTeacher, clearActiveTeacherId } from './services/identityService';
import { AuthorizationError } from './services/authHelper';
import { getSchoolLocalDate, getCurrentTorontoTime, buildTorontoTimestamp } from './utils/dateUtils';
import { AlertTriangle, AlertCircle } from 'lucide-react';
import type { UUID, Student, User } from './types/schema';

export function App() {
  const [currentView, setCurrentView] = useState<'dashboard' | 'seating' | 'markbook' | 'assessments' | 'participation' | 'settings' | 'portability'>(() => {
    try {
      const saved = sessionStorage.getItem('ontario_active_view');
      if (saved && ['dashboard', 'seating', 'markbook', 'assessments', 'participation', 'settings', 'portability'].includes(saved)) {
        return saved as any;
      }
    } catch (_) {}
    return 'dashboard';
  });

  const handleViewChange = (view: 'dashboard' | 'seating' | 'markbook' | 'assessments' | 'participation' | 'settings' | 'portability') => {
    setCurrentView(view);
    try {
      sessionStorage.setItem('ontario_active_view', view);
    } catch (_) {}
  };

  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [selectedEnrollmentIds, setSelectedEnrollmentIds] = useState<UUID[]>([]);
  const [selectedSchoolDate, setSelectedSchoolDate] = useState<string>(() => getSchoolLocalDate());
  const [historicalTime, setHistoricalTime] = useState<string>(() => getCurrentTorontoTime());
  const [profileEnrollmentId, setProfileEnrollmentId] = useState<UUID | null>(null);
  const [suspendedProfileEnrollmentId, setSuspendedProfileEnrollmentId] = useState<UUID | null>(null);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [lastUndo, setLastUndo] = useState<{ batchId: UUID; eventName: string; studentCount: number } | null>(null);
  const [appIdentity, setAppIdentity] = useState<{ userId: UUID; deviceId: UUID } | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [switchingFromTeacherId, setSwitchingFromTeacherId] = useState<UUID | null>(null);
  const switchingFromTeacherIdRef = useRef<UUID | null>(null);
  const isSelectionCommittedRef = useRef<boolean>(false);
  const [isTeacherSelectorOpen, setIsTeacherSelectorOpen] = useState(false);
  const [isBugReportOpen, setIsBugReportOpen] = useState(false);
  const [identityError, setIdentityError] = useState<string | null>(null);

  const handleOpenStudentSettings = (student: Student) => {
    setEditingStudent(student);
  };

  const handleOpenStudentSettingsFromProfile = (student: Student) => {
    setSuspendedProfileEnrollmentId(profileEnrollmentId);
    setProfileEnrollmentId(null);
    setEditingStudent(student);
  };

  const handleCloseStudentSettings = () => {
    setEditingStudent(null);
    if (suspendedProfileEnrollmentId) {
      setProfileEnrollmentId(suspendedProfileEnrollmentId);
      setSuspendedProfileEnrollmentId(null);
    }
  };

  // Initialize DB Seeds first
  useEffect(() => {
    seedDatabase(db).catch(console.error);
  }, []);

  // Resolve explicit session identity on mount (independent of active class)
  useEffect(() => {
    let isMounted = true;
    getAppIdentity(db)
      .then(id => {
        if (isMounted) {
          setAppIdentity({ userId: id.userId, deviceId: id.deviceId });
          setCurrentUser(id.user);
          setIdentityError(null);
        }
      })
      .catch(err => {
        if (isMounted) {
          setAppIdentity(null);
          setCurrentUser(null);
          if (err instanceof AuthorizationError && err.message.includes('No acting teacher selected')) {
            // Unselected session state -> open teacher selector modal
            setIsTeacherSelectorOpen(true);
          } else {
            setIdentityError(err.message || 'Failed to resolve active teacher identity.');
          }
        }
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const handleStartSwitchTeacher = () => {
    // Clear old identity immediately to prevent pending/stale forms from submitting under old teacher ID
    const prevTeacherId = appIdentity?.userId || currentUser?.id || null;
    switchingFromTeacherIdRef.current = prevTeacherId;
    isSelectionCommittedRef.current = false;
    setSwitchingFromTeacherId(prevTeacherId);
    setAppIdentity(null);
    setCurrentUser(null);
    clearActiveTeacherId();
    setIsTeacherSelectorOpen(true);
  };

  const handleSelectTeacher = async (userId: UUID) => {
    // Synchronously commit selection to prevent any cancel/close callback from rolling back
    isSelectionCommittedRef.current = true;
    const prevId = switchingFromTeacherIdRef.current;
    switchingFromTeacherIdRef.current = null;
    setSwitchingFromTeacherId(null);

    try {
      const identity = await selectActingTeacher(db, userId);
      setAppIdentity({ userId: identity.userId, deviceId: identity.deviceId });
      setCurrentUser(identity.user);
      setIdentityError(null);
      setIsTeacherSelectorOpen(false);
    } catch (err: any) {
      // If selection failed, restore previous switch ref so user can still cancel or retry
      isSelectionCommittedRef.current = false;
      switchingFromTeacherIdRef.current = prevId;
      setSwitchingFromTeacherId(prevId);
      setIdentityError(err.message || 'Failed to select acting teacher.');
      throw err;
    }
  };

  const handleCancelSwitchTeacher = async () => {
    // If a selection has been committed or is in progress, ignore cancellation
    if (isSelectionCommittedRef.current) {
      return;
    }

    const prevId = switchingFromTeacherIdRef.current;
    switchingFromTeacherIdRef.current = null;
    setSwitchingFromTeacherId(null);

    if (prevId) {
      try {
        const identity = await selectActingTeacher(db, prevId);
        setAppIdentity({ userId: identity.userId, deviceId: identity.deviceId });
        setCurrentUser(identity.user);
        setIdentityError(null);
      } catch (err: any) {
        setIdentityError(err.message || 'Failed to restore acting teacher.');
      }
    }
    setIsTeacherSelectorOpen(false);
  };

  // Live queries
  const userPref = useLiveQuery(() => db.userPreferences.toCollection().first());
  const classSections = useLiveQuery(() => db.classSections.filter(s => s.deletedAt === null).toArray()) || [];
  const courses = useLiveQuery(() => db.courses.filter(c => c.deletedAt === null).toArray()) || [];
  const terms = useLiveQuery(() => db.terms.filter(t => t.deletedAt === null).toArray()) || [];
  const allEnrollments = useLiveQuery(() => db.classEnrollments.filter(e => e.deletedAt === null).toArray()) || [];
  const allStudents = useLiveQuery(() => db.students.filter(s => s.deletedAt === null).toArray()) || [];
  const eventTypeService = useMemo(() => new ParticipationEventTypeService(db), []);
  const eventTypes = useLiveQuery(
    () => eventTypeService.listEventTypesForSection(activeSectionId, false),
    [activeSectionId]
  ) || [];
  const markScaleEntries = useLiveQuery(() => db.markScaleEntries.toArray()) || [];

  // Set initial active class from preference
  useEffect(() => {
    if (!activeSectionId && classSections.length > 0) {
      if (userPref?.lastOpenedClassSectionId && classSections.some(s => s.id === userPref.lastOpenedClassSectionId)) {
        setActiveSectionId(userPref.lastOpenedClassSectionId);
      } else {
        setActiveSectionId(classSections[0].id);
      }
    }
  }, [classSections, userPref, activeSectionId]);

  // Combined class cards
  const allClasses = classSections.map(section => {
    const course = courses.find(c => c.id === section.courseId) || {
      id: section.courseId,
      organizationId: '',
      code: 'COURSE',
      title: 'Course',
      department: '',
      gradeLevel: 12,
      creditValue: 1.0,
      createdAt: '',
      updatedAt: '',
      deletedAt: null,
      version: 1
    };
    const enrollments = allEnrollments.filter(e => e.classSectionId === section.id);
    const term = terms.find(t => t.id === section.termId);
    return { section, course, enrollments, term };
  });

  const activeClassObj = allClasses.find(c => c.section.id === activeSectionId) || null;

  // Active Class Specific Live Queries
  const activeLayout = useLiveQuery(
    () => activeSectionId ? db.seatingLayouts.where('classSectionId').equals(activeSectionId).first() : undefined,
    [activeSectionId]
  );
  const activeSeats = useLiveQuery(
    () => activeLayout ? db.seatPositions.where('seatingLayoutId').equals(activeLayout.id).toArray() : [],
    [activeLayout]
  ) || [];

  const activeEnrollments = useLiveQuery(
    () => activeSectionId ? db.classEnrollments.where('classSectionId').equals(activeSectionId).toArray() : [],
    [activeSectionId]
  ) || [];

  const activeUnits = useLiveQuery(
    () => activeSectionId ? db.units.where('classSectionId').equals(activeSectionId).toArray() : [],
    [activeSectionId]
  ) || [];

  const activeAssessments = useLiveQuery(
    () => activeSectionId ? db.assessments.where('classSectionId').equals(activeSectionId).toArray() : [],
    [activeSectionId]
  ) || [];

  const activeCategories = useLiveQuery(
    () => activeAssessments.length > 0 ? db.assessmentCategories.where('assessmentId').anyOf(activeAssessments.map(a => a.id)).toArray() : [],
    [activeAssessments]
  ) || [];

  const activeStudentAssessments = useLiveQuery(
    () => activeEnrollments.length > 0 ? db.studentAssessments.where('classEnrollmentId').anyOf(activeEnrollments.map(e => e.id)).toArray() : [],
    [activeEnrollments]
  ) || [];

  const activeCategoryResults = useLiveQuery(
    () => activeStudentAssessments.length > 0 ? db.categoryResults.where('studentAssessmentId').anyOf(activeStudentAssessments.map(sa => sa.id)).toArray() : [],
    [activeStudentAssessments]
  ) || [];

  const activeAttendance = useLiveQuery(
    () => activeEnrollments.length > 0 ? db.attendanceRecords.where('classEnrollmentId').anyOf(activeEnrollments.map(e => e.id)).toArray() : [],
    [activeEnrollments]
  ) || [];

  const activeDailySummaries = useLiveQuery(
    () => activeEnrollments.length > 0 ? db.participationDailySummaries.where('classEnrollmentId').anyOf(activeEnrollments.map(e => e.id)).toArray() : [],
    [activeEnrollments]
  ) || [];

  const profileEvents = useLiveQuery(
    () => profileEnrollmentId
      ? db.participationEvents
          .where('classEnrollmentId')
          .equals(profileEnrollmentId)
          .filter(e => e.deletedAt === null)
          .toArray()
      : [],
    [profileEnrollmentId]
  ) || [];

  const activePolicy = useLiveQuery(
    () => activeSectionId ? db.gradingPolicies.where('classSectionId').equals(activeSectionId).first() : undefined,
    [activeSectionId]
  ) || {
    id: 'policy-default',
    classSectionId: activeSectionId || '',
    reportingPeriodId: null,
    scopeKey: 'DEFAULT',
    weightK: 25,
    weightT: 25,
    weightC: 25,
    weightA: 25,
    excludeFormative: true,
    missingWorkPolicy: 'exclude',
    defaultMarkScaleVersionId: 'scale-ver-ont-levels-v1',
    decimalPrecision: 1,
    createdAt: '',
    updatedAt: '',
    deletedAt: null,
    version: 1
  };

  const activeOverrides = useLiveQuery(
    () => activeEnrollments.length > 0 ? db.gradeOverrides.where('classEnrollmentId').anyOf(activeEnrollments.map(e => e.id)).toArray() : [],
    [activeEnrollments]
  ) || [];

  const activeNotes = useLiveQuery(
    () => activeEnrollments.length > 0 ? db.studentNotes.where('classEnrollmentId').anyOf(activeEnrollments.map(e => e.id)).toArray() : [],
    [activeEnrollments]
  ) || [];

  const allAuditEntries = useLiveQuery(() => db.auditEntries.toArray()) || [];
  const participationService = new ParticipationDomainService(db);
  const sessionService = new ClassSessionService(db);

  const handleSelectClass = async (sectionId: string) => {
    setActiveSectionId(sectionId);
    setSelectedEnrollmentIds([]);
    setSelectedSchoolDate(getSchoolLocalDate());
    setHistoricalTime(getCurrentTorontoTime());
    if (userPref) {
      await db.userPreferences.update(userPref.id, {
        lastOpenedClassSectionId: sectionId
      });
    }
  };

  const handleOpenClass = (sectionId: string) => {
    handleSelectClass(sectionId);
    handleViewChange('seating'); // Open class workspace in Class View by default
  };

  const handleToggleSelectStudent = (enrollmentId: UUID) => {
    if (selectedEnrollmentIds.includes(enrollmentId)) {
      setSelectedEnrollmentIds(selectedEnrollmentIds.filter(id => id !== enrollmentId));
    } else {
      setSelectedEnrollmentIds([...selectedEnrollmentIds, enrollmentId]);
    }
  };

  const handleRecordParticipation = async (params: any) => {
    let liveIdentity: { userId: UUID; deviceId: UUID };
    try {
      liveIdentity = await getAppIdentity(db);
    } catch {
      setIsTeacherSelectorOpen(true);
      return;
    }
    if (!activeSectionId || selectedEnrollmentIds.length === 0) return;

    const schoolDate = selectedSchoolDate;
    const today = getSchoolLocalDate();

    let occurredAt: string;
    if (schoolDate === today) {
      occurredAt = new Date().toISOString();
    } else {
      occurredAt = buildTorontoTimestamp(schoolDate, historicalTime);
    }

    const session = await sessionService.getOrCreateSession(activeSectionId, schoolDate, {
      startsAt: occurredAt
    });

    const events = await participationService.recordParticipation({
      classEnrollmentIds: selectedEnrollmentIds,
      classSectionId: activeSectionId,
      classSessionId: session.id,
      eventTypeId: params.eventTypeId,
      achievementLevel: params.achievementLevel,
      categoryOverride: params.categoryOverride,
      note: params.note,
      localSchoolDate: schoolDate,
      occurredAt,
      userId: liveIdentity.userId,
      deviceId: liveIdentity.deviceId
    });

    if (events.length > 0) {
      setLastUndo({
        batchId: events[0].batchId,
        eventName: events[0].snapshottedName,
        studentCount: selectedEnrollmentIds.length
      });
      setSelectedEnrollmentIds([]);
      setTimeout(() => setLastUndo(null), 8000);
    }
  };

  const handleUndo = async (batchId: UUID) => {
    let liveIdentity: { userId: UUID; deviceId: UUID };
    try {
      liveIdentity = await getAppIdentity(db);
    } catch {
      setIsTeacherSelectorOpen(true);
      return;
    }
    await participationService.undoBatch(batchId, liveIdentity.userId, liveIdentity.deviceId);
    setLastUndo(null);
  };

  const selectedStudentsData = selectedEnrollmentIds.map(id => {
    const enr = activeEnrollments.find(e => e.id === id);
    const std = allStudents.find(s => s.id === enr?.studentId);
    return { enrollment: enr!, student: std! };
  }).filter(s => s.enrollment && s.student);

  const profileData = profileEnrollmentId ? {
    enr: allEnrollments.find(e => e.id === profileEnrollmentId),
    std: allStudents.find(s => s.id === (allEnrollments.find(e => e.id === profileEnrollmentId)?.studentId))
  } : null;

  const isSelectionRequired = isTeacherSelectorOpen && !appIdentity && !switchingFromTeacherId;

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col selection:bg-blue-100 selection:text-blue-900">
      <div
        id="app-workspace"
        className={`flex-1 flex flex-col ${isSelectionRequired ? 'pointer-events-none select-none' : ''}`}
        aria-hidden={isSelectionRequired ? 'true' : undefined}
      >
        {/* Persistent Navigation Header */}
        <Header
        currentView={currentView}
        onViewChange={handleViewChange}
        activeClass={activeClassObj}
        allClasses={allClasses}
        onSelectClass={handleSelectClass}
        currentUser={currentUser}
        onOpenTeacherSelector={handleStartSwitchTeacher}
        onReportProblem={() => setIsBugReportOpen(true)}
      />

      <BugReportModal isOpen={isBugReportOpen} onClose={() => setIsBugReportOpen(false)} currentView={currentView} />

      {/* Identity Error Banner */}
      {identityError && (
        <div role="alert" className="bg-rose-50 border-b border-rose-200 px-4 py-2.5 text-xs text-rose-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span><strong>Identity Notice:</strong> {identityError}</span>
          </div>
          <button
            onClick={handleStartSwitchTeacher}
            className="px-2.5 py-1 bg-rose-600 text-white rounded font-medium hover:bg-rose-700 transition"
          >
            Select Teacher
          </button>
        </div>
      )}

      {/* Unselected Teacher Warning Banner (if modal was somehow dismissed without selection) */}
      {!appIdentity && !identityError && !isTeacherSelectorOpen && (
        <div role="alert" className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 text-xs text-amber-900 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span><strong>No acting teacher selected:</strong> Data write actions are disabled until a teacher is selected for this session.</span>
          </div>
          <button
            onClick={handleStartSwitchTeacher}
            className="px-2.5 py-1 bg-amber-600 text-white rounded font-semibold hover:bg-amber-700 transition"
          >
            Select Acting Teacher
          </button>
        </div>
      )}

      {/* Main Workspace Area */}
      <main className="flex-1 pb-20">
        {currentView === 'dashboard' && (
          <DashboardView
            classes={allClasses}
            userId={appIdentity?.userId}
            deviceId={appIdentity?.deviceId}
            onOpenClass={handleOpenClass}
            onRefresh={() => {}}
          />
        )}

        {currentView === 'seating' && activeLayout && (
          <SeatingChartView
            layout={activeLayout}
            seatPositions={activeSeats}
            enrollments={activeEnrollments}
            students={allStudents}
            attendanceRecords={activeAttendance}
            dailySummaries={activeDailySummaries}
            selectedEnrollmentIds={selectedEnrollmentIds}
            selectedSchoolDate={selectedSchoolDate}
            userId={appIdentity?.userId}
            deviceId={appIdentity?.deviceId}
            onSelectDate={setSelectedSchoolDate}
            onToggleSelectStudent={handleToggleSelectStudent}
            onOpenStudentProfile={setProfileEnrollmentId}
            onOpenStudentSettings={handleOpenStudentSettings}
            onRefresh={() => {}}
          />
        )}

        {currentView === 'seating' && !activeLayout && (
          <div className="max-w-md mx-auto mt-20 p-8 bg-white rounded-2xl border border-slate-200 text-center shadow-sm">
            <h2 className="text-lg font-bold text-slate-800 mb-2">No Seating Layout Found</h2>
            <p className="text-xs text-slate-500 mb-6">
              This class section does not currently have an active seating chart layout.
            </p>
            <button
              onClick={async () => {
                if (!appIdentity) {
                  setIsTeacherSelectorOpen(true);
                  return;
                }
                if (!activeSectionId) return;
                const now = new Date().toISOString();
                await db.seatingLayouts.add({
                  id: `layout-${activeSectionId}`,
                  classSectionId: activeSectionId,
                  name: 'Standard Classroom 4x5',
                  rows: 4,
                  cols: 5,
                  isLocked: false,
                  cardSize: 'standard',
                  createdAt: now,
                  updatedAt: now,
                  deletedAt: null,
                  version: 1
                });
              }}
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs px-4 py-2.5 rounded-xl shadow-sm transition"
            >
              Initialize Classroom Grid (4x5)
            </button>
          </div>
        )}

        {currentView === 'markbook' && activeSectionId && (
          <MarkbookView
            classSectionId={activeSectionId}
            reportingPeriodId={null}
            policy={activePolicy}
            enrollments={activeEnrollments}
            students={allStudents}
            assessments={activeAssessments}
            categories={activeCategories}
            studentAssessments={activeStudentAssessments}
            categoryResults={activeCategoryResults}
            overrides={activeOverrides}
            userId={appIdentity?.userId}
            deviceId={appIdentity?.deviceId}
            onOpenStudentProfile={setProfileEnrollmentId}
            onRefresh={() => {}}
          />
        )}

        {currentView === 'assessments' && activeClassObj && (
          <AssessmentHubView
            classSection={activeClassObj.section}
            assessments={activeAssessments}
            categories={activeCategories}
            units={activeUnits}
            enrollments={activeEnrollments}
            students={allStudents}
            onRefresh={() => {}}
          />
        )}

        {currentView === 'participation' && activeClassObj && (
          <ParticipationLedgerView
            classSection={activeClassObj.section}
            enrollments={activeEnrollments}
            students={allStudents}
            eventTypes={eventTypes}
            userId={appIdentity?.userId}
            deviceId={appIdentity?.deviceId}
            onRefresh={() => {}}
          />
        )}

        {currentView === 'portability' && (
          <ImportExportModal
            classSection={activeClassObj ? activeClassObj.section : null}
            course={activeClassObj ? activeClassObj.course : null}
            userId={appIdentity?.userId}
            deviceId={appIdentity?.deviceId}
            onRefresh={() => {}}
          />
        )}

        {currentView === 'settings' && (
          <SettingsView
            policy={activePolicy}
            scaleEntries={markScaleEntries}
            activeSectionId={activeSectionId}
            userId={appIdentity?.userId}
            deviceId={appIdentity?.deviceId}
            onRefresh={() => {}}
          />
        )}
      </main>

      {/* Real-Time Fast Participation Dock */}
      {currentView === 'seating' && (
        <ParticipationDock
          selectedEnrollments={selectedStudentsData}
          eventTypes={eventTypes}
          selectedSchoolDate={selectedSchoolDate}
          historicalLocalTime={historicalTime}
          onHistoricalTimeChange={setHistoricalTime}
          onRecordEvent={handleRecordParticipation}
          onClearSelection={() => setSelectedEnrollmentIds([])}
          lastBatchUndo={lastUndo}
          onUndo={handleUndo}
        />
      )}

      {/* Student Profile Modal */}
      {profileData && profileData.enr && profileData.std && (
        <StudentProfileModal
          enrollmentId={profileData.enr.id}
          enrollment={profileData.enr}
          student={profileData.std}
          assessments={activeAssessments}
          categories={activeCategories}
          studentAssessments={activeStudentAssessments}
          categoryResults={activeCategoryResults}
          participationEvents={profileEvents}
          policy={activePolicy}
          overrides={activeOverrides}
          notes={activeNotes}
          auditEntries={allAuditEntries}
          userId={appIdentity?.userId}
          deviceId={appIdentity?.deviceId}
          onOpenSettings={handleOpenStudentSettingsFromProfile}
          onClose={() => setProfileEnrollmentId(null)}
          onRefresh={() => {}}
        />
      )}

      {/* Student Settings Modal */}
      {editingStudent && (
        <StudentSettingsModal
          isOpen={true}
          onClose={handleCloseStudentSettings}
          student={editingStudent}
          onSaveSuccess={() => {
            setEditingStudent(null);
            if (suspendedProfileEnrollmentId) {
              setProfileEnrollmentId(suspendedProfileEnrollmentId);
              setSuspendedProfileEnrollmentId(null);
            }
          }}
          userId={appIdentity?.userId || ''}
          deviceId={appIdentity?.deviceId || ''}
        />
      )}
      </div>

      {/* Teacher Selector Modal */}
      <TeacherSelectorModal
        isOpen={isTeacherSelectorOpen}
        canDismiss={appIdentity !== null || switchingFromTeacherId !== null}
        currentTeacherId={appIdentity?.userId || switchingFromTeacherId || undefined}
        onSelectTeacher={handleSelectTeacher}
        onCancel={handleCancelSwitchTeacher}
        onClose={handleCancelSwitchTeacher}
      />
    </div>
  );
}

export default App;
