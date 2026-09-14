import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db/database';
import { seedDatabase } from './db/seeds';
import { Header } from './components/Header';
import { DashboardView } from './components/DashboardView';
import { SeatingChartView } from './components/SeatingChartView';
import { MarkbookView } from './components/MarkbookView';
import { ParticipationDock } from './components/ParticipationDock';
import { StudentProfileModal } from './components/StudentProfileModal';
import { AssessmentHubView } from './components/AssessmentHubView';
import { ParticipationLedgerView } from './components/ParticipationLedgerView';
import { ImportExportModal } from './components/ImportExportModal';
import { SettingsView } from './components/SettingsView';
import { ParticipationDomainService } from './services/participationService';
import type { UUID } from './types/schema';

export function App() {
  const [currentView, setCurrentView] = useState<'dashboard' | 'seating' | 'markbook' | 'assessments' | 'participation' | 'settings' | 'portability'>('dashboard');
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [selectedEnrollmentIds, setSelectedEnrollmentIds] = useState<UUID[]>([]);
  const [profileEnrollmentId, setProfileEnrollmentId] = useState<UUID | null>(null);
  const [lastUndo, setLastUndo] = useState<{ batchId: UUID; eventName: string; studentCount: number } | null>(null);

  // Initialize DB Seeds
  useEffect(() => {
    seedDatabase(db).catch(console.error);
  }, []);

  // Live queries
  const userPref = useLiveQuery(() => db.userPreferences.toCollection().first());
  const classSections = useLiveQuery(() => db.classSections.filter(s => s.deletedAt === null).toArray()) || [];
  const courses = useLiveQuery(() => db.courses.filter(c => c.deletedAt === null).toArray()) || [];
  const terms = useLiveQuery(() => db.terms.filter(t => t.deletedAt === null).toArray()) || [];
  const allEnrollments = useLiveQuery(() => db.classEnrollments.filter(e => e.deletedAt === null).toArray()) || [];
  const allStudents = useLiveQuery(() => db.students.filter(s => s.deletedAt === null).toArray()) || [];
  const eventTypes = useLiveQuery(() => db.participationEventTypes.filter(e => e.deletedAt === null).toArray()) || [];
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

  const activeEvents = useLiveQuery(
    () => activeSectionId ? db.participationEvents.where('classSectionId').equals(activeSectionId).toArray() : [],
    [activeSectionId]
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

  const handleSelectClass = async (sectionId: string) => {
    setActiveSectionId(sectionId);
    setSelectedEnrollmentIds([]);
    if (userPref) {
      await db.userPreferences.update(userPref.id, {
        lastOpenedClassSectionId: sectionId
      });
    }
  };

  const handleOpenClass = (sectionId: string) => {
    handleSelectClass(sectionId);
    setCurrentView('seating'); // Open class workspace in Class View by default
  };

  const handleToggleSelectStudent = (enrollmentId: UUID) => {
    if (selectedEnrollmentIds.includes(enrollmentId)) {
      setSelectedEnrollmentIds(selectedEnrollmentIds.filter(id => id !== enrollmentId));
    } else {
      setSelectedEnrollmentIds([...selectedEnrollmentIds, enrollmentId]);
    }
  };

  const handleRecordParticipation = async (params: any) => {
    if (!activeSectionId || selectedEnrollmentIds.length === 0) return;
    const today = new Date().toISOString().slice(0, 10);
    const session = await db.classSessions.where('classSectionId').equals(activeSectionId).first();

    const events = await participationService.recordParticipation({
      classEnrollmentIds: selectedEnrollmentIds,
      classSectionId: activeSectionId,
      classSessionId: session ? session.id : null,
      eventTypeId: params.eventTypeId,
      name: params.name,
      classification: params.classification,
      points: params.points,
      categoryCode: params.categoryCode,
      note: params.note,
      localSchoolDate: today,
      userId: 'user-tyler',
      deviceId: 'desktop-client'
    });

    if (events.length > 0) {
      setLastUndo({
        batchId: events[0].batchId,
        eventName: params.name,
        studentCount: selectedEnrollmentIds.length
      });
      setTimeout(() => setLastUndo(null), 5000);
    }
  };

  const handleUndo = async (batchId: UUID) => {
    await participationService.undoBatch(batchId, 'user-tyler', 'desktop-client');
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

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col selection:bg-blue-100 selection:text-blue-900">
      {/* Persistent Navigation Header */}
      <Header
        currentView={currentView}
        onViewChange={setCurrentView}
        activeClass={activeClassObj}
        allClasses={allClasses}
        onSelectClass={handleSelectClass}
      />

      {/* Main Workspace Area */}
      <main className="flex-1 pb-20">
        {currentView === 'dashboard' && (
          <DashboardView
            classes={allClasses}
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
            onToggleSelectStudent={handleToggleSelectStudent}
            onOpenStudentProfile={setProfileEnrollmentId}
            onRefresh={() => {}}
          />
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
            events={activeEvents}
            eventTypes={eventTypes}
            onRefresh={() => {}}
          />
        )}

        {currentView === 'portability' && (
          <ImportExportModal
            classSection={activeClassObj ? activeClassObj.section : null}
            onRefresh={() => {}}
          />
        )}

        {currentView === 'settings' && (
          <SettingsView
            policy={activePolicy}
            scaleEntries={markScaleEntries}
            onRefresh={() => {}}
          />
        )}
      </main>

      {/* Real-Time Fast Participation Dock */}
      {currentView === 'seating' && (
        <ParticipationDock
          selectedEnrollments={selectedStudentsData}
          eventTypes={eventTypes}
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
          participationEvents={activeEvents}
          policy={activePolicy}
          overrides={activeOverrides}
          notes={activeNotes}
          auditEntries={allAuditEntries}
          onClose={() => setProfileEnrollmentId(null)}
          onRefresh={() => {}}
        />
      )}
    </div>
  );
}

export default App;
