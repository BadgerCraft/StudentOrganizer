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

async function runScaleBenchmark() {
  console.log('===============================================================');
  console.log('ENTERPRISE SCALE & HEAVY-CLASS BENCHMARK SUITE');
  console.log('Targets: 2,000 Students | 500 Assessments | 250,000 Events');
  console.log('Heavy Class: 40 Students | 100 Assessments | 350 Category Columns');
  console.log('===============================================================');

  const db = new OntarioTeacherDB(`benchmark-db-${Date.now()}`);
  await seedDatabase(db);
  const participationService = new ParticipationDomainService(db);

  const now = new Date().toISOString();
  const schoolId = 'org-school-port-credit';
  const term = await db.terms.toCollection().first();
  const termId = term!.id;
  const repPeriod = await db.reportingPeriods.toCollection().first();
  const repId = repPeriod!.id;

  // 1. Generate 2,000 Students across 65 classes
  console.log('\n[1/5] Ingesting 2,000 students & 65 class sections...');
  const startIngest = performance.now();

  const totalStudents = 2000;
  const students: Student[] = [];
  for (let i = 1; i <= totalStudents; i++) {
    students.push({
      id: `bench-std-${i}`,
      organizationId: schoolId,
      localStudentNumber: `S${100000 + i}`,
      oenEncrypted: null,
      firstName: `First${i}`,
      lastName: `Last${i}`,
      preferredName: null,
      pronouns: 'they/them',
      photoUrl: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    });
  }
  await db.students.bulkAdd(students);

  // Create Heavy Class Section
  const heavySectionId = 'class-heavy-section-40';
  await db.classSections.add({
    id: heavySectionId,
    courseId: 'course-eng4u',
    termId,
    sectionNumber: '09-HEAVY',
    period: 'Period 1 (Heavy Load)',
    roomNumber: 'Lecture Hall A',
    colorToken: '#7c3aed',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    version: 1
  });

  await db.classSectionStaff.add({
    id: 'staff-heavy-tyler',
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
    weightK: 25,
    weightT: 25,
    weightC: 25,
    weightA: 25,
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

  // Enroll 40 students in the Heavy Class
  const heavyEnrollments: ClassEnrollment[] = [];
  for (let i = 1; i <= 40; i++) {
    heavyEnrollments.push({
      id: `enr-heavy-${i}`,
      classSectionId: heavySectionId,
      studentId: `bench-std-${i}`,
      enrollmentStatus: 'active',
      enrolledDate: '2026-09-02',
      droppedDate: null,
      customDisplayOrder: i,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    });
  }
  await db.classEnrollments.bulkAdd(heavyEnrollments);

  // Enroll remaining students across other sections
  const otherEnrollments: ClassEnrollment[] = [];
  let sIndex = 41;
  for (let c = 2; c <= 65; c++) {
    const sectionId = `section-gen-${c}`;
    await db.classSections.add({
      id: sectionId,
      courseId: 'course-eng4u',
      termId,
      sectionNumber: `0${c}`,
      period: 'Period 2',
      roomNumber: `R${c}`,
      colorToken: '#2563eb',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    });

    for (let j = 0; j < 30 && sIndex <= totalStudents; j++, sIndex++) {
      otherEnrollments.push({
        id: `enr-gen-${sIndex}`,
        classSectionId: sectionId,
        studentId: `bench-std-${sIndex}`,
        enrollmentStatus: 'active',
        enrolledDate: '2026-09-02',
        droppedDate: null,
        customDisplayOrder: j + 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        version: 1
      });
    }
  }
  await db.classEnrollments.bulkAdd(otherEnrollments);
  const allEnrollments = [...heavyEnrollments, ...otherEnrollments];

  // 2. Generate 500 Assessments and 100 in Heavy Class (350 category columns)
  console.log('[2/5] Creating 500 assessments with 350 category columns for heavy class...');
  const assessments: Assessment[] = [];
  const categories: AssessmentCategory[] = [];
  const studentAssessments: StudentAssessment[] = [];
  const categoryResults: CategoryResult[] = [];

  // Heavy class: 100 assessments
  for (let a = 1; a <= 100; a++) {
    const assessId = `assess-heavy-${a}`;
    assessments.push({
      id: assessId,
      classSectionId: heavySectionId,
      unitId: 'unit-eng-1',
      reportingPeriodId: repId,
      code: `H-A${a}`,
      title: `Heavy Assessment ${a}`,
      assessmentType: a % 5 === 0 ? 'formative' : 'summative',
      assignedAt: now,
      dueAt: now,
      isLocked: false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1
    });

    // Alternate 3 or 4 categories to total ~350 categories across 100 assessments
    const catsForAssess = (a % 2 === 0) ? ['K', 'T', 'C', 'A'] : ['K', 'T', 'C'];
    for (const code of catsForAssess) {
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

      // 40 student results per category column = 14,000 total results in heavy class
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

  // Add remaining assessments to hit 500 total
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

  // 3. Ingest 250,000 Participation Events spread across 100 school days and 2,000 students
  console.log('[3/5] Bulk-ingesting 250,000 raw participation events (chunked across school year)...');
  const schoolDates: string[] = [];
  const startDay = new Date('2026-09-02T12:00:00Z');
  for (let d = 0; d < 150 && schoolDates.length < 100; d++) {
    const cur = new Date(startDay.getTime() + d * 86400000);
    const dayOfWeek = cur.getUTCDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      schoolDates.push(cur.toISOString().slice(0, 10));
    }
  }

  const targetEvents = 250000;
  const chunkSize = 25000;
  let eventCount = 0;

  while (eventCount < targetEvents) {
    const chunk: ParticipationEvent[] = [];
    for (let c = 0; c < chunkSize && eventCount < targetEvents; c++, eventCount++) {
      const enr = allEnrollments[eventCount % allEnrollments.length];
      const date = schoolDates[eventCount % schoolDates.length];
      chunk.push({
        id: `bench-pe-${eventCount}`,
        classEnrollmentId: enr.id,
        classSectionId: enr.classSectionId,
        classSessionId: null,
        batchId: `batch-${Math.floor(eventCount / 100)}`,
        eventTypeId: 'pet-idea',
        snapshottedName: 'Contributed an idea',
        snapshottedClassification: 'positive',
        snapshottedRecordingMode: 'quick_tally',
        achievementLevel: null,
        snapshottedPoints: 1.0,
        occurredAt: `${date}T14:00:00.000Z`,
        localSchoolDate: date,
        timezone: 'America/Toronto',
        note: 'Solid analysis',
        categoryCode: 'T',
        studentAssessmentId: null,
        createdByUserId: 'user-tyler',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        version: 1
      });
    }
    await db.participationEvents.bulkAdd(chunk);
    process.stdout.write(`\r  -> Ingested ${eventCount.toLocaleString()} / ${targetEvents.toLocaleString()} events...`);
  }
  console.log('\n  -> 250,000 Participation Events ingested.');

  // Pre-seed projection summaries for the benchmark test date 2026-09-14 across heavy class
  const dailySummariesToSeed: ParticipationDailySummary[] = [];
  for (const enr of heavyEnrollments) {
    dailySummariesToSeed.push({
      id: `pds-init-${enr.id}-2026-09-14`,
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

  const totalIngestTime = performance.now() - startIngest;
  console.log(`Ingestion completed in ${(totalIngestTime / 1000).toFixed(2)}s`);

  // 4. BENCHMARK WORKFLOWS (Latency p50, p95, p99)
  console.log('\n[4/5] Running latency benchmarks with explicit SLA assertions...');

  // SLA Definitions - Hard regression limits must never be weakened
  const SLAS = {
    singleClickP95: { limit: 25.0, target: 16.0 },
    batchStamp: { limit: 100.0, target: 50.0 },
    batchUndo: { limit: 100.0, target: 50.0 },
    seatingQuery: { limit: 25.0, target: 16.0 },
    markbookLoad: { limit: 350.0, target: 200.0 },
    calcEngineTotal: { limit: 200.0, target: 50.0 }
  };

  const results: { name: string; measured: number; limit: number; target: number; passed: boolean }[] = [];

  // Test A: 50 Consecutive 1-Click Participation Entries
  const singleClickLatencies: number[] = [];
  for (let i = 0; i < 50; i++) {
    const t0 = performance.now();
    await participationService.recordParticipation({
      classEnrollmentIds: [heavyEnrollments[i % 40].id],
      classSectionId: heavySectionId,
      eventTypeId: 'pet-question',
      occurredAt: '2026-09-14T14:00:00.000Z',
      localSchoolDate: '2026-09-14',
      userId: 'user-tyler',
      deviceId: 'bench-dev'
    });
    singleClickLatencies.push(performance.now() - t0);
  }
  const clickPercentiles = computePercentiles(singleClickLatencies);
  const clickPassed = clickPercentiles.p95 <= SLAS.singleClickP95.limit;
  results.push({
    name: '50 Rapid Participation Entries (p95)',
    measured: clickPercentiles.p95,
    limit: SLAS.singleClickP95.limit,
    target: SLAS.singleClickP95.target,
    passed: clickPassed
  });

  // Test B: 32-Student Batch Participation Event
  const tBatch0 = performance.now();
  const batchStudents = heavyEnrollments.slice(0, 32).map(e => e.id);
  const batchEvents = await participationService.recordParticipation({
    classEnrollmentIds: batchStudents,
    classSectionId: heavySectionId,
    eventTypeId: 'pet-prep',
    occurredAt: '2026-09-14T14:00:00.000Z',
    localSchoolDate: '2026-09-14',
    userId: 'user-tyler',
    deviceId: 'bench-dev'
  });
  const batchTime = performance.now() - tBatch0;
  const batchPassed = batchTime <= SLAS.batchStamp.limit;
  results.push({
    name: '32-Student Batch Participation Stamp',
    measured: batchTime,
    limit: SLAS.batchStamp.limit,
    target: SLAS.batchStamp.target,
    passed: batchPassed
  });

  // Test C: 1-Click Atomic Undo of 32-Student Batch
  const tUndo0 = performance.now();
  const undoResult = await participationService.undoBatch(batchEvents[0].batchId, 'user-tyler', 'bench-dev');
  const undoTime = performance.now() - tUndo0;
  const undoPassed = undoTime <= SLAS.batchUndo.limit;
  results.push({
    name: '1-Click Atomic Batch Undo (32 students)',
    measured: undoTime,
    limit: SLAS.batchUndo.limit,
    target: SLAS.batchUndo.target,
    passed: undoPassed
  });

  // Test D: Seating Card Query (via local projection vs raw 250k table)
  const tProj0 = performance.now();
  const summaries = await db.participationDailySummaries
    .where('localSchoolDate')
    .equals('2026-09-14')
    .toArray();
  const projTime = performance.now() - tProj0;
  const projPassed = projTime <= SLAS.seatingQuery.limit;
  results.push({
    name: 'Seating Card Summary Query (via daily projection)',
    measured: projTime,
    limit: SLAS.seatingQuery.limit,
    target: SLAS.seatingQuery.target,
    passed: projPassed
  });

  // Test E: Heavy Markbook Retrieval (40 students x 100 assessments = 350 columns, 14,000 results)
  const tMarkbook0 = performance.now();
  const heavyAssessments = await db.assessments.where('classSectionId').equals(heavySectionId).toArray();
  const assessIds = new Set(heavyAssessments.map(a => a.id));
  const heavyCategories = (await db.assessmentCategories.toArray()).filter(c => assessIds.has(c.assessmentId));
  const heavySAs = await db.studentAssessments.where('classSectionId').equals(heavySectionId).toArray();
  const catIds = new Set(heavyCategories.map(c => c.id));
  const heavyCRs = (await db.categoryResults.toArray()).filter(c => catIds.has(c.assessmentCategoryId) && c.deletedAt === null);
  const markbookLoadTime = performance.now() - tMarkbook0;
  const markbookPassed = markbookLoadTime <= SLAS.markbookLoad.limit;
  results.push({
    name: 'Heavy Markbook Load (40 students x 350 category columns)',
    measured: markbookLoadTime,
    limit: SLAS.markbookLoad.limit,
    target: SLAS.markbookLoad.target,
    passed: markbookPassed
  });

  // Test F: Calculation Engine Execution for all 40 students
  const calcLatencies: number[] = [];
  const tCalcAll0 = performance.now();
  for (const enr of heavyEnrollments) {
    const t0 = performance.now();
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
    calcLatencies.push(performance.now() - t0);
  }
  const calcAllTime = performance.now() - tCalcAll0;
  const calcPassed = calcAllTime <= SLAS.calcEngineTotal.limit;
  results.push({
    name: 'Calculation Engine (40 students across 350 columns)',
    measured: calcAllTime,
    limit: SLAS.calcEngineTotal.limit,
    target: SLAS.calcEngineTotal.target,
    passed: calcPassed
  });

  // Print Formatted Report
  console.log('\n===============================================================');
  console.log('BENCHMARK EVALUATION REPORT:');
  console.log('---------------------------------------------------------------');
  let allPassed = true;
  for (const r of results) {
    const status = r.passed ? 'PASS' : 'FAIL';
    if (!r.passed) allPassed = false;
    console.log(`- ${r.name}:`);
    console.log(`    Measured: ${r.measured.toFixed(2)}ms | Limit: ${r.limit.toFixed(2)}ms | Target: ${r.target.toFixed(2)}ms => [${status}]`);
  }
  console.log('===============================================================');

  if (!allPassed) {
    console.error('\nBENCHMARK FAILED: One or more operations exceeded regression limits!');
    process.exit(1);
  }

  console.log('\n[5/5] ALL BENCHMARK REGRESSION LIMITS PASSED!');
  console.log('===============================================================');
}

runScaleBenchmark().catch(err => {
  console.error('Scale benchmark failed:', err);
  process.exit(1);
});
