import 'fake-indexeddb/auto';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { ParticipationDomainService } from '../services/participationService';
import { calculateOverallCourseGrade } from '../services/calculationEngine';
import type {
  Student,
  ClassEnrollment,
  Assessment,
  AssessmentCategory,
  StudentAssessment,
  CategoryResult,
  ParticipationEvent,
  ParticipationDailySummary,
  GradingPolicy
} from '../types/schema';

function computePercentiles(latencies: number[]) {
  const sorted = [...latencies].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.50)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  return { p50, p95, p99 };
}

async function runNodeBenchmark() {
  console.log('===============================================================');
  console.log('NODE CI / REGRESSION BENCHMARK SUITE (SIMULATOR-BOUNDED)');
  console.log('Targets: 2,000 Students | 65 Sections | 500 Assessments');
  console.log('Heavy Class: 40 Students | 350 Category Columns | 14,000 Cells');
  console.log('Events: 5,000 Participation Events (Bounded for Pure-JS Simulator)');
  console.log('===============================================================');

  const db = new OntarioTeacherDB(`node-benchmark-db-${Date.now()}`);
  await seedDatabase(db);
  const participationService = new ParticipationDomainService(db);

  const now = new Date().toISOString();
  const schoolId = 'org-school-port-credit';
  const term = await db.terms.toCollection().first();
  const termId = term!.id;
  const repPeriod = await db.reportingPeriods.toCollection().first();
  const repId = repPeriod!.id;

  const heavySectionId = 'section-heavy-eng';
  await db.classSections.add({
    id: heavySectionId,
    courseId: 'course-eng4u',
    termId,
    sectionNumber: '09',
    period: 'Period 1',
    roomNumber: 'Room 101',
    colorToken: '#8b5cf6',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    version: 1
  });

  await db.classSectionStaff.add({
    id: 'staff-heavy-node-tyler',
    classSectionId: heavySectionId,
    organizationMembershipId: 'membership-tyler-school',
    role: 'primary_teacher',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    version: 1
  });

  const heavyPolicy: GradingPolicy = {
    id: 'policy-heavy',
    classSectionId: heavySectionId,
    reportingPeriodId: null,
    scopeKey: 'DEFAULT',
    weightK: 25.0,
    weightT: 25.0,
    weightC: 25.0,
    weightA: 25.0,
    excludeFormative: true,
    missingWorkPolicy: 'exclude',
    defaultMarkScaleVersionId: 'scale-ver-ont-levels-v1',
    decimalPrecision: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    version: 1
  };
  await db.gradingPolicies.add(heavyPolicy);

  // Ingest 2,000 Students across 65 sections
  console.log('[1/4] Ingesting 2,000 students & 65 class sections...');
  const students: Student[] = [];
  const allEnrollments: ClassEnrollment[] = [];
  const heavyEnrollments: ClassEnrollment[] = [];

  for (let i = 1; i <= 2000; i++) {
    const sId = `node-stu-${i}`;
    students.push({
      id: sId,
      organizationId: schoolId,
      localStudentNumber: `S-N-${100000 + i}`,
      oenEncrypted: null,
      firstName: `StudentFirst${i}`,
      lastName: `StudentLast${i}`,
      preferredName: null,
      pronouns: 'they/them',
      photoUrl: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    });

    const isHeavy = i <= 40;
    const targetSection = isHeavy ? heavySectionId : `section-gen-${(i % 64) + 1}`;
    const enrId = `node-enr-${i}`;
    const enr: ClassEnrollment = {
      id: enrId,
      classSectionId: targetSection,
      studentId: sId,
      enrollmentStatus: 'active',
      enrolledDate: '2026-09-02',
      droppedDate: null,
      customDisplayOrder: i,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    };
    allEnrollments.push(enr);
    if (isHeavy) heavyEnrollments.push(enr);
  }

  await db.students.bulkAdd(students);
  await db.classEnrollments.bulkAdd(allEnrollments);

  // 500 Assessments with 350 category columns for heavy class
  console.log('[2/4] Creating 500 assessments with 350 category columns for heavy class...');
  const assessments: Assessment[] = [];
  const categories: AssessmentCategory[] = [];
  const studentAssessments: StudentAssessment[] = [];
  const categoryResults: CategoryResult[] = [];

  for (let a = 1; a <= 100; a++) {
    const assessId = `assess-h-${a}`;
    assessments.push({
      id: assessId,
      classSectionId: heavySectionId,
      unitId: 'unit-eng-1',
      reportingPeriodId: repId,
      code: `A${a}`,
      title: `Assessment ${a}`,
      assessmentType: 'summative',
      assignedAt: now,
      dueAt: now,
      isLocked: false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    });

    const catCodes: ('K' | 'T' | 'C' | 'A')[] = a <= 50 ? ['K', 'T', 'C', 'A'] : ['K', 'T', 'C'];
    for (const code of catCodes) {
      const catId = `cat-h-${a}-${code}`;
      categories.push({
        id: catId,
        assessmentId: assessId,
        categoryCode: code as any,
        maxScore: 100,
        evidenceWeight: 1.0,
        markScaleVersionId: 'scale-ver-ont-levels-v1',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        version: 1
      });

      for (const enr of heavyEnrollments) {
        categoryResults.push({
          id: `cr-h-${a}-${code}-${enr.id}`,
          studentAssessmentId: `sa-h-${a}-${enr.id}`,
          assessmentCategoryId: catId,
          rawScore: '85%',
          inputFormat: 'percentage',
          normalizedPercentage: 85,
          pointsEarned: 85,
          pointsPossibleSnapshot: 100,
          feedback: null,
          assessedAt: now,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          version: 1
        });
      }
    }

    for (const enr of heavyEnrollments) {
      studentAssessments.push({
        id: `sa-h-${a}-${enr.id}`,
        assessmentId: assessId,
        classEnrollmentId: enr.id,
        classSectionId: heavySectionId,
        workflowStatus: 'assessed',
        completionStatus: 'complete',
        isLate: false,
        assignedAt: now,
        dueAt: now,
        submittedAt: now,
        assessedAt: now,
        returnedAt: now,
        overallFeedback: null,
        privateNotes: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        version: 1
      });
    }
  }

  for (let a = 101; a <= 500; a++) {
    assessments.push({
      id: `assess-other-${a}`,
      classSectionId: 'section-gen-2',
      unitId: 'unit-eng-1',
      reportingPeriodId: repId,
      code: `O-A${a}`,
      title: `General Assessment ${a}`,
      assessmentType: 'summative',
      assignedAt: now,
      dueAt: now,
      isLocked: false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    });
  }

  await db.assessments.bulkAdd(assessments);
  await db.assessmentCategories.bulkAdd(categories);
  await db.studentAssessments.bulkAdd(studentAssessments);
  await db.categoryResults.bulkAdd(categoryResults);

  // Ingest 5,000 Participation Events (bounded for Node simulator)
  console.log('[3/4] Ingesting 5,000 raw participation events (simulator-bounded)...');
  const peChunk: ParticipationEvent[] = [];
  for (let i = 0; i < 5000; i++) {
    const enr = allEnrollments[i % allEnrollments.length];
    peChunk.push({
      id: `pe-node-${i}`,
      classEnrollmentId: enr.id,
      classSectionId: enr.classSectionId,
      classSessionId: null,
      batchId: `batch-node-${Math.floor(i / 50)}`,
      eventTypeId: 'pet-idea',
      snapshottedName: 'Idea',
      snapshottedClassification: 'positive',
      snapshottedRecordingMode: 'quick_tally',
      achievementLevel: null,
      snapshottedPoints: 1.0,
      occurredAt: '2026-09-14T14:00:00.000Z',
      localSchoolDate: '2026-09-14',
      timezone: 'America/Toronto',
      note: null,
      categoryCode: 'T',
      studentAssessmentId: null,
      createdByUserId: 'user-tyler',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    });
  }
  await db.participationEvents.bulkAdd(peChunk);

  const dailySummariesToSeed: ParticipationDailySummary[] = [];
  for (const enr of heavyEnrollments) {
    dailySummariesToSeed.push({
      id: `pds-node-${enr.id}-2026-09-14`,
      classEnrollmentId: enr.id,
      localSchoolDate: '2026-09-14',
      positiveCount: 2,
      needsFollowupCount: 0,
      neutralCount: 0,
      totalPoints: 2.0,
      lastEventAt: '2026-09-14T14:00:00.000Z'
    });
  }
  await db.participationDailySummaries.bulkAdd(dailySummariesToSeed);

  // 4. Execute Operations & Report Latencies
  console.log('\n[4/4] Executing 6 core operations...');
  const results: { name: string; measured: number }[] = [];

  // A: 50 Rapid Entries
  const clickLatencies: number[] = [];
  for (let i = 0; i < 50; i++) {
    const t0 = performance.now();
    await participationService.recordParticipation({
      classEnrollmentIds: [heavyEnrollments[i % 40].id],
      classSectionId: heavySectionId,
      eventTypeId: 'pet-idea',
      occurredAt: '2026-09-14T14:00:00.000Z',
      localSchoolDate: '2026-09-14',
      userId: 'user-tyler',
      deviceId: 'node-dev'
    });
    clickLatencies.push(performance.now() - t0);
  }
  const clickPercentiles = computePercentiles(clickLatencies);
  results.push({ name: '50 Rapid Entries (p95)', measured: clickPercentiles.p95 });

  // B: 32-Student Batch Stamp
  const tBatch0 = performance.now();
  const batchStudents = heavyEnrollments.slice(0, 32).map(e => e.id);
  const batchEvents = await participationService.recordParticipation({
    classEnrollmentIds: batchStudents,
    classSectionId: heavySectionId,
    eventTypeId: 'pet-group',
    occurredAt: '2026-09-14T14:00:00.000Z',
    localSchoolDate: '2026-09-14',
    userId: 'user-tyler',
    deviceId: 'node-dev'
  });
  const tBatch = performance.now() - tBatch0;
  results.push({ name: '32-Student Batch Stamp', measured: tBatch });

  // C: 1-Click Atomic Batch Undo
  const tUndo0 = performance.now();
  await participationService.undoBatch(batchEvents[0].batchId, 'user-tyler', 'node-dev');
  const tUndo = performance.now() - tUndo0;
  results.push({ name: '1-Click Atomic Batch Undo (32 students)', measured: tUndo });

  // D: Seating Card Query
  const tProj0 = performance.now();
  await db.participationDailySummaries.where('localSchoolDate').equals('2026-09-14').toArray();
  const tProj = performance.now() - tProj0;
  results.push({ name: 'Seating Card Query (daily projection)', measured: tProj });

  // E: Heavy Markbook Retrieval (14,000 results)
  const tMarkbook0 = performance.now();
  const heavyAssessments = await db.assessments.where('classSectionId').equals(heavySectionId).toArray();
  const assessIds = new Set(heavyAssessments.map(a => a.id));
  const heavyCategories = (await db.assessmentCategories.toArray()).filter(c => assessIds.has(c.assessmentId));
  const heavySAs = await db.studentAssessments.where('classSectionId').equals(heavySectionId).toArray();
  const catIds = new Set(heavyCategories.map(c => c.id));
  const heavyCRs = (await db.categoryResults.toArray()).filter(c => catIds.has(c.assessmentCategoryId) && c.deletedAt === null);
  const tMarkbook = performance.now() - tMarkbook0;
  results.push({ name: 'Heavy Markbook Load (40 students x 350 cols)', measured: tMarkbook });

  // F: Calculation Engine (40 students across 350 columns)
  const tCalc0 = performance.now();
  for (const enr of heavyEnrollments) {
    calculateOverallCourseGrade(
      enr.id,
      repId,
      heavyAssessments,
      heavyCategories,
      heavySAs,
      heavyCRs,
      heavyPolicy,
      []
    );
  }
  const tCalc = performance.now() - tCalc0;
  results.push({ name: 'Calculation Engine (40 students x 350 cols)', measured: tCalc });

  console.log('\n===============================================================');
  console.log('NODE CI / REGRESSION REPORT:');
  console.log('---------------------------------------------------------------');
  for (const r of results) {
    console.log(`- ${r.name}: ${r.measured.toFixed(2)} ms`);
  }
  console.log('===============================================================');
  console.log('Node regression suite completed successfully.');

  await db.delete();
}

runNodeBenchmark().catch(err => {
  console.error('Node benchmark failed:', err);
  process.exit(1);
});
