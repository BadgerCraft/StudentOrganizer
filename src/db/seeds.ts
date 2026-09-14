import type { OntarioTeacherDB } from './database';
import type {
  Organization,
  User,
  OrganizationMembership,
  ClassSession,
  Student,
  ClassEnrollment,
  AttendanceRecord,
  SeatPosition,
  MarkScaleEntry,
  Assessment,
  AssessmentCategory,
  StudentAssessment,
  CategoryResult,
  ParticipationEventType,
  ParticipationEvent,
  ParticipationDailySummary,
  UserPreference
} from '../types/schema';

export async function seedDatabase(db: OntarioTeacherDB): Promise<void> {
  const orgCount = await db.organizations.count();
  if (orgCount > 0) return;

  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  const boardId = 'org-board-peel';
  const schoolId = 'org-school-port-credit';

  const board: Organization = {
    id: boardId,
    parentOrganizationId: null,
    parentScopeKey: 'ROOT',
    organizationType: 'board',
    name: 'Peel District School Board',
    code: 'PDSB',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    version: 1
  };

  const school: Organization = {
    id: schoolId,
    parentOrganizationId: boardId,
    parentScopeKey: boardId,
    organizationType: 'school',
    name: 'Port Credit Secondary School',
    code: 'PCSS',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    version: 1
  };
  await db.organizations.bulkAdd([board, school]);

  const teacherId = 'user-tyler';
  const teacherUser: User = {
    id: teacherId,
    authSubject: 'google-oauth2|local-teacher-demo',
    email: 't.henderson@pdsb.net',
    name: 'Tyler Henderson',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    version: 1
  };
  await db.users.add(teacherUser);

  const membershipId = 'membership-tyler-school';
  const teacherMembership: OrganizationMembership = {
    id: membershipId,
    organizationId: schoolId,
    userId: teacherId,
    role: 'teacher',
    status: 'active',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    version: 1
  };
  await db.organizationMemberships.add(teacherMembership);

  const userPref: UserPreference = {
    id: 'pref-tyler',
    userId: teacherId,
    theme: 'light',
    lastOpenedClassSectionId: 'class-eng4u-01',
    markbookDensity: 'comfortable',
    seatingShowPhotos: true,
    createdAt: now,
    updatedAt: now,
    version: 1
  };
  await db.userPreferences.add(userPref);

  const yearId = 'ay-2026-2027';
  await db.academicYears.add({
    id: yearId,
    organizationId: schoolId,
    name: '2026-2027 Academic Year',
    startDate: '2026-09-01',
    endDate: '2027-06-30',
    isCurrent: true,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    version: 1
  });

  const termId = 'term-s1';
  await db.terms.add({
    id: termId,
    academicYearId: yearId,
    name: 'Semester 1',
    code: 'S1',
    startDate: '2026-09-02',
    endDate: '2027-01-28',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    version: 1
  });

  const rep1Id = 'rp-midterm';
  const rep2Id = 'rp-final';
  await db.reportingPeriods.bulkAdd([
    { id: rep1Id, termId: termId, name: 'Midterm', sequenceNumber: 1, startDate: '2026-09-02', endDate: '2026-11-15', isClosed: false, createdAt: now, updatedAt: now, deletedAt: null, version: 1 },
    { id: rep2Id, termId: termId, name: 'Final', sequenceNumber: 2, startDate: '2026-11-16', endDate: '2027-01-28', isClosed: false, createdAt: now, updatedAt: now, deletedAt: null, version: 1 }
  ]);

  const familyId = 'scale-fam-ont-levels';
  await db.markScaleFamilies.add({
    id: familyId,
    organizationId: schoolId,
    code: 'ONT_LEVELS',
    name: 'Ontario Achievement-Level Teacher Conversion Preset',
    isDefault: true,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    version: 1
  });

  const versionId = 'scale-ver-ont-levels-v1';
  await db.markScaleVersions.add({
    id: versionId,
    markScaleFamilyId: familyId,
    revision: 1,
    effectiveFrom: '2026-09-01',
    retiredAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    version: 1
  });

  const scaleEntries: MarkScaleEntry[] = [
    { id: 'lvl-4pp', markScaleVersionId: versionId, code: '4++', label: 'Level 4++', minimumPercentage: 98, benchmarkPercentage: 100, maximumPercentage: 100, description: 'Exceeds standard thoroughly', isPassing: true, isNumeric: true, sortOrder: 1 },
    { id: 'lvl-4p', markScaleVersionId: versionId, code: '4+', label: 'Level 4+', minimumPercentage: 90, benchmarkPercentage: 95, maximumPercentage: 97.9, description: 'Exceeds standard with high degree', isPassing: true, isNumeric: true, sortOrder: 2 },
    { id: 'lvl-4', markScaleVersionId: versionId, code: '4', label: 'Level 4', minimumPercentage: 85, benchmarkPercentage: 87, maximumPercentage: 89.9, description: 'Exceeds provincial standard', isPassing: true, isNumeric: true, sortOrder: 3 },
    { id: 'lvl-4m', markScaleVersionId: versionId, code: '4-', label: 'Level 4-', minimumPercentage: 80, benchmarkPercentage: 80, maximumPercentage: 84.9, description: 'Exceeds standard with some limits', isPassing: true, isNumeric: true, sortOrder: 4 },
    { id: 'lvl-3p', markScaleVersionId: versionId, code: '3+', label: 'Level 3+', minimumPercentage: 77, benchmarkPercentage: 78, maximumPercentage: 79.9, description: 'At provincial standard solidly', isPassing: true, isNumeric: true, sortOrder: 5 },
    { id: 'lvl-3', markScaleVersionId: versionId, code: '3', label: 'Level 3', minimumPercentage: 73, benchmarkPercentage: 75, maximumPercentage: 76.9, description: 'Meets provincial standard', isPassing: true, isNumeric: true, sortOrder: 6 },
    { id: 'lvl-3m', markScaleVersionId: versionId, code: '3-', label: 'Level 3-', minimumPercentage: 70, benchmarkPercentage: 71, maximumPercentage: 72.9, description: 'Meets standard with minor gaps', isPassing: true, isNumeric: true, sortOrder: 7 },
    { id: 'lvl-2p', markScaleVersionId: versionId, code: '2+', label: 'Level 2+', minimumPercentage: 67, benchmarkPercentage: 68, maximumPercentage: 69.9, description: 'Approaching standard closely', isPassing: true, isNumeric: true, sortOrder: 8 },
    { id: 'lvl-2', markScaleVersionId: versionId, code: '2', label: 'Level 2', minimumPercentage: 63, benchmarkPercentage: 65, maximumPercentage: 66.9, description: 'Approaching provincial standard', isPassing: true, isNumeric: true, sortOrder: 9 },
    { id: 'lvl-2m', markScaleVersionId: versionId, code: '2-', label: 'Level 2-', minimumPercentage: 60, benchmarkPercentage: 61, maximumPercentage: 62.9, description: 'Approaching with inconsistency', isPassing: true, isNumeric: true, sortOrder: 10 },
    { id: 'lvl-1p', markScaleVersionId: versionId, code: '1+', label: 'Level 1+', minimumPercentage: 57, benchmarkPercentage: 58, maximumPercentage: 59.9, description: 'Falls below standard with effort', isPassing: true, isNumeric: true, sortOrder: 11 },
    { id: 'lvl-1', markScaleVersionId: versionId, code: '1', label: 'Level 1', minimumPercentage: 53, benchmarkPercentage: 55, maximumPercentage: 56.9, description: 'Falls below standard', isPassing: true, isNumeric: true, sortOrder: 12 },
    { id: 'lvl-1m', markScaleVersionId: versionId, code: '1-', label: 'Level 1-', minimumPercentage: 50, benchmarkPercentage: 51, maximumPercentage: 52.9, description: 'Marginal pass', isPassing: true, isNumeric: true, sortOrder: 13 },
    { id: 'lvl-r', markScaleVersionId: versionId, code: 'R', label: 'Level R', minimumPercentage: 0, benchmarkPercentage: 35, maximumPercentage: 49.9, description: 'Insufficient achievement to pass', isPassing: false, isNumeric: true, sortOrder: 14 },
    { id: 'lvl-i', markScaleVersionId: versionId, code: 'I', label: 'Insufficient Evidence', minimumPercentage: 0, benchmarkPercentage: 0, maximumPercentage: 0, description: 'Not enough evidence evaluated', isPassing: false, isNumeric: false, sortOrder: 15 }
  ];
  await db.markScaleEntries.bulkAdd(scaleEntries);
  const courseEngId = 'course-eng4u';
  const courseSchId = 'course-sch3u';

  await db.courses.bulkAdd([
    { id: courseEngId, organizationId: schoolId, code: 'ENG4U', title: 'Grade 12 University English', department: 'English', gradeLevel: 12, creditValue: 1.0, createdAt: now, updatedAt: now, deletedAt: null, version: 1 },
    { id: courseSchId, organizationId: schoolId, code: 'SCH3U', title: 'Grade 11 University Chemistry', department: 'Science', gradeLevel: 11, creditValue: 1.0, createdAt: now, updatedAt: now, deletedAt: null, version: 1 }
  ]);

  const sectionEngId = 'class-eng4u-01';
  const sectionSchId = 'class-sch3u-02';

  await db.classSections.bulkAdd([
    { id: sectionEngId, courseId: courseEngId, termId: termId, sectionNumber: '01', period: 'Period 2 (10:15 - 11:30 AM)', roomNumber: 'Room 214', colorToken: '#2563eb', createdAt: now, updatedAt: now, deletedAt: null, version: 1 },
    { id: sectionSchId, courseId: courseSchId, termId: termId, sectionNumber: '02', period: 'Period 3 (12:30 - 1:45 PM)', roomNumber: 'Room 308', colorToken: '#059669', createdAt: now, updatedAt: now, deletedAt: null, version: 1 }
  ]);

  await db.classSectionStaff.bulkAdd([
    { id: 'staff-eng4u-tyler', classSectionId: sectionEngId, organizationMembershipId: membershipId, role: 'primary_teacher', createdAt: now, updatedAt: now, deletedAt: null, version: 1 },
    { id: 'staff-sch3u-tyler', classSectionId: sectionSchId, organizationMembershipId: membershipId, role: 'primary_teacher', createdAt: now, updatedAt: now, deletedAt: null, version: 1 }
  ]);

  await db.units.bulkAdd([
    { id: 'unit-eng-1', classSectionId: sectionEngId, code: 'U1', title: 'Rhetorical Analysis & Persuasion', sortOrder: 1, startsOn: '2026-09-02', endsOn: '2026-10-15', createdAt: now, updatedAt: now, deletedAt: null, version: 1 },
    { id: 'unit-eng-2', classSectionId: sectionEngId, code: 'U2', title: 'Shakespeare & Critical Theory', sortOrder: 2, startsOn: '2026-10-16', endsOn: '2026-11-25', createdAt: now, updatedAt: now, deletedAt: null, version: 1 },
    { id: 'unit-eng-3', classSectionId: sectionEngId, code: 'U3', title: 'Independent Inquiry Seminar', sortOrder: 3, startsOn: '2026-11-26', endsOn: '2027-01-20', createdAt: now, updatedAt: now, deletedAt: null, version: 1 },
    { id: 'unit-sch-1', classSectionId: sectionSchId, code: 'U1', title: 'Matter, Trends, and Chemical Bonding', sortOrder: 1, startsOn: '2026-09-02', endsOn: '2026-10-20', createdAt: now, updatedAt: now, deletedAt: null, version: 1 }
  ]);

  await db.gradingPolicies.bulkAdd([
    { id: 'policy-eng4u-default', classSectionId: sectionEngId, reportingPeriodId: null, scopeKey: 'DEFAULT', weightK: 25.0, weightT: 25.0, weightC: 25.0, weightA: 25.0, excludeFormative: true, missingWorkPolicy: 'exclude', defaultMarkScaleVersionId: versionId, decimalPrecision: 1, createdAt: now, updatedAt: now, deletedAt: null, version: 1 },
    { id: 'policy-sch3u-default', classSectionId: sectionSchId, reportingPeriodId: null, scopeKey: 'DEFAULT', weightK: 30.0, weightT: 30.0, weightC: 15.0, weightA: 25.0, excludeFormative: true, missingWorkPolicy: 'exclude', defaultMarkScaleVersionId: versionId, decimalPrecision: 1, createdAt: now, updatedAt: now, deletedAt: null, version: 1 }
  ]);

  const sessionEng: ClassSession = {
    id: 'session-eng-today',
    classSectionId: sectionEngId,
    startsAt: `${today}T10:15:00Z`,
    endsAt: `${today}T11:30:00Z`,
    localSchoolDate: today,
    timezone: 'America/Toronto',
    title: 'Rhetorical Devices & Argument Structure',
    sessionType: 'regular',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    version: 1
  };
  await db.classSessions.add(sessionEng);

  const fictionalNames = [
    { first: 'Jordan', last: 'Avery', pref: 'Jordan', num: 'S10482', pronouns: 'they/them' },
    { first: 'Taylor', last: 'Morgan', pref: 'Taylor', num: 'S10483', pronouns: 'she/her' },
    { first: 'Casey', last: 'Riley', pref: 'Case', num: 'S10484', pronouns: 'he/him' },
    { first: 'Sam', last: 'Alex', pref: 'Sammy', num: 'S10485', pronouns: 'he/him' },
    { first: 'Morgan', last: 'Quinn', pref: 'Morgan', num: 'S10486', pronouns: 'she/her' },
    { first: 'Dakota', last: 'River', pref: 'Kody', num: 'S10487', pronouns: 'they/them' },
    { first: 'Jesse', last: 'Cameron', pref: 'Jesse', num: 'S10488', pronouns: 'he/him' },
    { first: 'Rowan', last: 'Bailey', pref: 'Row', num: 'S10489', pronouns: 'she/her' },
    { first: 'Skyler', last: 'Reese', pref: 'Sky', num: 'S10490', pronouns: 'she/they' },
    { first: 'Parker', last: 'Ellis', pref: 'Parker', num: 'S10491', pronouns: 'he/him' },
    { first: 'Hayden', last: 'Jamie', pref: 'Hade', num: 'S10492', pronouns: 'he/him' },
    { first: 'Peyton', last: 'Emery', pref: 'Pey', num: 'S10493', pronouns: 'she/her' },
    { first: 'Kendall', last: 'Finley', pref: 'Ken', num: 'S10494', pronouns: 'they/them' },
    { first: 'Logan', last: 'Micah', pref: 'Logan', num: 'S10495', pronouns: 'he/him' },
  ];

  const students: Student[] = [];
  const enrollmentsEng: ClassEnrollment[] = [];
  const enrollmentsSch: ClassEnrollment[] = [];

  fictionalNames.forEach((fn, idx) => {
    const studentId = `student-${idx + 1}`;
    students.push({
      id: studentId,
      organizationId: schoolId,
      localStudentNumber: fn.num,
      oenEncrypted: null,
      firstName: fn.first,
      lastName: fn.last,
      preferredName: fn.pref,
      pronouns: fn.pronouns,
      photoUrl: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    });

    enrollmentsEng.push({
      id: `enroll-eng-${idx + 1}`,
      classSectionId: sectionEngId,
      studentId: studentId,
      enrollmentStatus: 'active',
      enrolledDate: '2026-09-02',
      droppedDate: null,
      customDisplayOrder: idx + 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    });

    if (idx < 12) {
      enrollmentsSch.push({
        id: `enroll-sch-${idx + 1}`,
        classSectionId: sectionSchId,
        studentId: studentId,
        enrollmentStatus: 'active',
        enrolledDate: '2026-09-02',
        droppedDate: null,
        customDisplayOrder: idx + 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        version: 1
      });
    }
  });

  await db.students.bulkAdd(students);
  await db.classEnrollments.bulkAdd([...enrollmentsEng, ...enrollmentsSch]);

  const attendanceList: AttendanceRecord[] = enrollmentsEng.map((e, idx) => ({
    id: `att-eng-${idx + 1}`,
    classEnrollmentId: e.id,
    classSessionId: sessionEng.id,
    localSchoolDate: today,
    status: idx === 2 ? 'absent' : 'present',
    reason: idx === 2 ? 'Dental appointment' : null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    version: 1
  }));
  await db.attendanceRecords.bulkAdd(attendanceList);

  const layoutEngId = 'layout-eng-main';
  await db.seatingLayouts.add({
    id: layoutEngId,
    classSectionId: sectionEngId,
    name: 'Classroom Grid 4x5',
    rows: 4,
    cols: 5,
    isLocked: false,
    cardSize: 'standard',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    version: 1
  });

  const seatPositions: SeatPosition[] = [];
  let seatIdx = 0;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 5; c++) {
      if (c === 2) continue; // aisle
      if (seatIdx < enrollmentsEng.length) {
        seatPositions.push({
          id: `seat-${r}-${c}`,
          seatingLayoutId: layoutEngId,
          row: r,
          col: c,
          classEnrollmentId: enrollmentsEng[seatIdx].id,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          version: 1
        });
        seatIdx++;
      }
    }
  }
  await db.seatPositions.bulkAdd(seatPositions);
  const eventTypes: ParticipationEventType[] = [
    { id: 'pet-idea', organizationId: schoolId, name: 'Contributed an idea', code: 'CONTRIB_IDEA', icon: 'Lightbulb', color: '#2563eb', classification: 'positive', defaultPoints: 1.0, isArchived: false, createdAt: now, updatedAt: now, deletedAt: null, version: 1 },
    { id: 'pet-question', organizationId: schoolId, name: 'Asked a useful question', code: 'ASK_QUESTION', icon: 'HelpCircle', color: '#059669', classification: 'positive', defaultPoints: 1.0, isArchived: false, createdAt: now, updatedAt: now, deletedAt: null, version: 1 },
    { id: 'pet-peer', organizationId: schoolId, name: 'Responded to a peer', code: 'PEER_RESPONSE', icon: 'MessageSquare', color: '#7c3aed', classification: 'positive', defaultPoints: 1.0, isArchived: false, createdAt: now, updatedAt: now, deletedAt: null, version: 1 },
    { id: 'pet-evidence', organizationId: schoolId, name: 'Used evidence', code: 'USED_EVIDENCE', icon: 'BookOpen', color: '#0284c7', classification: 'positive', defaultPoints: 1.5, isArchived: false, createdAt: now, updatedAt: now, deletedAt: null, version: 1 },
    { id: 'pet-risk', organizationId: schoolId, name: 'Took an intellectual risk', code: 'INTELLECT_RISK', icon: 'Flame', color: '#ea580c', classification: 'positive', defaultPoints: 2.0, isArchived: false, createdAt: now, updatedAt: now, deletedAt: null, version: 1 },
    { id: 'pet-group', organizationId: schoolId, name: 'Supported group learning', code: 'GROUP_SUPPORT', icon: 'Users', color: '#16a34a', classification: 'positive', defaultPoints: 1.0, isArchived: false, createdAt: now, updatedAt: now, deletedAt: null, version: 1 },
    { id: 'pet-prep', organizationId: schoolId, name: 'Demonstrated preparation', code: 'DEMO_PREP', icon: 'CheckCircle', color: '#0891b2', classification: 'positive', defaultPoints: 1.0, isArchived: false, createdAt: now, updatedAt: now, deletedAt: null, version: 1 },
    { id: 'pet-offtask', organizationId: schoolId, name: 'Off task', code: 'OFF_TASK', icon: 'AlertCircle', color: '#dc2626', classification: 'needs_followup', defaultPoints: -1.0, isArchived: false, createdAt: now, updatedAt: now, deletedAt: null, version: 1 },
    { id: 'pet-unprep', organizationId: schoolId, name: 'Unprepared', code: 'UNPREPARED', icon: 'XCircle', color: '#e11d48', classification: 'needs_followup', defaultPoints: -1.0, isArchived: false, createdAt: now, updatedAt: now, deletedAt: null, version: 1 },
    { id: 'pet-prompting', organizationId: schoolId, name: 'Needed prompting', code: 'NEEDED_PROMPT', icon: 'AlertTriangle', color: '#d97706', classification: 'needs_followup', defaultPoints: 0.0, isArchived: false, createdAt: now, updatedAt: now, deletedAt: null, version: 1 },
    { id: 'pet-dominate', organizationId: schoolId, name: 'Dominated discussion', code: 'DOM_DISCUSS', icon: 'Volume2', color: '#ca8a04', classification: 'needs_followup', defaultPoints: 0.0, isArchived: false, createdAt: now, updatedAt: now, deletedAt: null, version: 1 },
    { id: 'pet-noparticipate', organizationId: schoolId, name: 'Did not participate when expected', code: 'NO_PARTICIPATE', icon: 'EyeOff', color: '#9333ea', classification: 'needs_followup', defaultPoints: 0.0, isArchived: false, createdAt: now, updatedAt: now, deletedAt: null, version: 1 },
  ];
  await db.participationEventTypes.bulkAdd(eventTypes);

  const sampleEvents: ParticipationEvent[] = [
    {
      id: 'pe-1',
      classEnrollmentId: enrollmentsEng[0].id,
      classSectionId: sectionEngId,
      classSessionId: sessionEng.id,
      batchId: 'batch-init-1',
      eventTypeId: 'pet-idea',
      snapshottedName: 'Contributed an idea',
      snapshottedClassification: 'positive',
      snapshottedPoints: 1.0,
      occurredAt: `${today}T10:25:00Z`,
      localSchoolDate: today,
      timezone: 'America/Toronto',
      note: 'Analyzed ethos in Churchill speech effectively',
      categoryCode: 'T',
      studentAssessmentId: null,
      createdByUserId: teacherId,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    },
    {
      id: 'pe-2',
      classEnrollmentId: enrollmentsEng[1].id,
      classSectionId: sectionEngId,
      classSessionId: sessionEng.id,
      batchId: 'batch-init-2',
      eventTypeId: 'pet-evidence',
      snapshottedName: 'Used evidence',
      snapshottedClassification: 'positive',
      snapshottedPoints: 1.5,
      occurredAt: `${today}T10:32:00Z`,
      localSchoolDate: today,
      timezone: 'America/Toronto',
      note: 'Directly cited line 42 to counter counter-argument',
      categoryCode: 'C',
      studentAssessmentId: null,
      createdByUserId: teacherId,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    }
  ];
  await db.participationEvents.bulkAdd(sampleEvents);

  const dailySummaries: ParticipationDailySummary[] = [
    { id: 'pds-1', classEnrollmentId: enrollmentsEng[0].id, localSchoolDate: today, positiveCount: 1, needsFollowupCount: 0, totalPoints: 1.0, lastEventAt: `${today}T10:25:00Z` },
    { id: 'pds-2', classEnrollmentId: enrollmentsEng[1].id, localSchoolDate: today, positiveCount: 1, needsFollowupCount: 0, totalPoints: 1.5, lastEventAt: `${today}T10:32:00Z` }
  ];
  await db.participationDailySummaries.bulkAdd(dailySummaries);

  const assessEssayId = 'assess-eng-essay';
  const assessSeminarId = 'assess-eng-seminar';
  const assessWorkshopId = 'assess-eng-formative';

  const assessments: Assessment[] = [
    { id: assessEssayId, classSectionId: sectionEngId, unitId: 'unit-eng-1', reportingPeriodId: rep1Id, code: 'U1-ESSAY', title: 'Rhetorical Analysis Essay', assessmentType: 'summative', assignedAt: '2026-09-08T09:00:00Z', dueAt: '2026-09-25T23:59:00Z', isLocked: false, createdAt: now, updatedAt: now, deletedAt: null, version: 1 },
    { id: assessSeminarId, classSectionId: sectionEngId, unitId: 'unit-eng-1', reportingPeriodId: rep1Id, code: 'U1-SEMINAR', title: 'Socratic Seminar: Speeches', assessmentType: 'summative', assignedAt: '2026-09-15T09:00:00Z', dueAt: '2026-10-02T15:00:00Z', isLocked: false, createdAt: now, updatedAt: now, deletedAt: null, version: 1 },
    { id: assessWorkshopId, classSectionId: sectionEngId, unitId: 'unit-eng-1', reportingPeriodId: rep1Id, code: 'U1-WORKSHOP', title: 'Formative Thesis Check-in', assessmentType: 'formative', assignedAt: '2026-09-12T09:00:00Z', dueAt: '2026-09-18T15:00:00Z', isLocked: false, createdAt: now, updatedAt: now, deletedAt: null, version: 1 }
  ];
  await db.assessments.bulkAdd(assessments);

  const categories: AssessmentCategory[] = [
    { id: 'cat-essay-k', assessmentId: assessEssayId, categoryCode: 'K', maxScore: 100, evidenceWeight: 1.0, markScaleVersionId: versionId, createdAt: now, updatedAt: now, deletedAt: null, version: 1 },
    { id: 'cat-essay-t', assessmentId: assessEssayId, categoryCode: 'T', maxScore: 100, evidenceWeight: 1.5, markScaleVersionId: versionId, createdAt: now, updatedAt: now, deletedAt: null, version: 1 },
    { id: 'cat-essay-c', assessmentId: assessEssayId, categoryCode: 'C', maxScore: 100, evidenceWeight: 1.0, markScaleVersionId: versionId, createdAt: now, updatedAt: now, deletedAt: null, version: 1 },
    { id: 'cat-essay-a', assessmentId: assessEssayId, categoryCode: 'A', maxScore: 100, evidenceWeight: 1.0, markScaleVersionId: versionId, createdAt: now, updatedAt: now, deletedAt: null, version: 1 },
    { id: 'cat-seminar-c', assessmentId: assessSeminarId, categoryCode: 'C', maxScore: 100, evidenceWeight: 1.0, markScaleVersionId: versionId, createdAt: now, updatedAt: now, deletedAt: null, version: 1 },
    { id: 'cat-seminar-a', assessmentId: assessSeminarId, categoryCode: 'A', maxScore: 100, evidenceWeight: 1.0, markScaleVersionId: versionId, createdAt: now, updatedAt: now, deletedAt: null, version: 1 },
    { id: 'cat-work-k', assessmentId: assessWorkshopId, categoryCode: 'K', maxScore: 20, evidenceWeight: 1.0, markScaleVersionId: versionId, createdAt: now, updatedAt: now, deletedAt: null, version: 1 },
    { id: 'cat-work-t', assessmentId: assessWorkshopId, categoryCode: 'T', maxScore: 20, evidenceWeight: 1.0, markScaleVersionId: versionId, createdAt: now, updatedAt: now, deletedAt: null, version: 1 }
  ];
  await db.assessmentCategories.bulkAdd(categories);

  const studentAssessments: StudentAssessment[] = [];
  const categoryResults: CategoryResult[] = [];

  enrollmentsEng.forEach((enr, idx) => {
    const saEssayId = `sa-essay-${enr.id}`;
    const isLate = idx === 4;
    const isMissing = idx === 11;
    const isExcused = idx === 12;

    studentAssessments.push({
      id: saEssayId,
      assessmentId: assessEssayId,
      classEnrollmentId: enr.id,
      workflowStatus: isMissing ? 'assigned' : 'assessed',
      completionStatus: isMissing ? 'missing' : isExcused ? 'excused' : 'complete',
      isLate: isLate,
      assignedAt: '2026-09-08T09:00:00Z',
      dueAt: '2026-09-25T23:59:00Z',
      submittedAt: isMissing ? null : '2026-09-24T18:30:00Z',
      assessedAt: isMissing || isExcused ? null : now,
      returnedAt: isMissing || isExcused ? null : now,
      overallFeedback: isMissing ? null : isExcused ? 'Excused by teacher' : 'Well structured rhetorical analysis.',
      privateNotes: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    });

    if (!isMissing && !isExcused) {
      const levels = ['4+', '4', '4-', '3+', '3', '3-', '2+'];
      const kLevel = levels[idx % levels.length];
      const tLevel = levels[(idx + 1) % levels.length];
      const cLevel = levels[(idx + 2) % levels.length];
      const aLevel = levels[(idx + 3) % levels.length];

      const getBenchmark = (lvl: string) => {
        const found = scaleEntries.find(e => e.code === lvl);
        return found ? found.benchmarkPercentage : 75;
      };

      categoryResults.push(
        { id: `cr-essay-k-${enr.id}`, studentAssessmentId: saEssayId, assessmentCategoryId: 'cat-essay-k', rawScore: kLevel, inputFormat: 'scale_code', normalizedPercentage: getBenchmark(kLevel), pointsEarned: getBenchmark(kLevel), pointsPossibleSnapshot: 100, feedback: 'Accurate rhetorical concepts.', assessedAt: now, createdAt: now, updatedAt: now, deletedAt: null, version: 1 },
        { id: `cr-essay-t-${enr.id}`, studentAssessmentId: saEssayId, assessmentCategoryId: 'cat-essay-t', rawScore: tLevel, inputFormat: 'scale_code', normalizedPercentage: getBenchmark(tLevel), pointsEarned: getBenchmark(tLevel), pointsPossibleSnapshot: 100, feedback: 'Strong critical analysis.', assessedAt: now, createdAt: now, updatedAt: now, deletedAt: null, version: 1 },
        { id: `cr-essay-c-${enr.id}`, studentAssessmentId: saEssayId, assessmentCategoryId: 'cat-essay-c', rawScore: `${getBenchmark(cLevel)}%`, inputFormat: 'percentage', normalizedPercentage: getBenchmark(cLevel), pointsEarned: getBenchmark(cLevel), pointsPossibleSnapshot: 100, feedback: 'Clear stylistic voice.', assessedAt: now, createdAt: now, updatedAt: now, deletedAt: null, version: 1 },
        { id: `cr-essay-a-${enr.id}`, studentAssessmentId: saEssayId, assessmentCategoryId: 'cat-essay-a', rawScore: aLevel, inputFormat: 'scale_code', normalizedPercentage: getBenchmark(aLevel), pointsEarned: getBenchmark(aLevel), pointsPossibleSnapshot: 100, feedback: 'Effective application of tropes.', assessedAt: now, createdAt: now, updatedAt: now, deletedAt: null, version: 1 }
      );
    }

    if (idx < 8) {
      const saSemId = `sa-sem-${enr.id}`;
      studentAssessments.push({
        id: saSemId,
        assessmentId: assessSeminarId,
        classEnrollmentId: enr.id,
        workflowStatus: 'assessed',
        completionStatus: 'complete',
        isLate: false,
        assignedAt: '2026-09-15T09:00:00Z',
        dueAt: '2026-10-02T15:00:00Z',
        submittedAt: '2026-10-02T14:30:00Z',
        assessedAt: now,
        returnedAt: now,
        overallFeedback: 'Engaged thoughtfully in dialogue with peers.',
        privateNotes: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        version: 1
      });

      categoryResults.push(
        { id: `cr-sem-c-${enr.id}`, studentAssessmentId: saSemId, assessmentCategoryId: 'cat-seminar-c', rawScore: '4', inputFormat: 'scale_code', normalizedPercentage: 87, pointsEarned: 87, pointsPossibleSnapshot: 100, feedback: 'Articulate vocal delivery.', assessedAt: now, createdAt: now, updatedAt: now, deletedAt: null, version: 1 },
        { id: `cr-sem-a-${enr.id}`, studentAssessmentId: saSemId, assessmentCategoryId: 'cat-seminar-a', rawScore: '4-', inputFormat: 'scale_code', normalizedPercentage: 80, pointsEarned: 80, pointsPossibleSnapshot: 100, feedback: 'Connected themes effectively.', assessedAt: now, createdAt: now, updatedAt: now, deletedAt: null, version: 1 }
      );
    }
  });

  await db.studentAssessments.bulkAdd(studentAssessments);
  await db.categoryResults.bulkAdd(categoryResults);
}

