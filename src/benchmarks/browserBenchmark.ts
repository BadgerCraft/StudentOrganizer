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

function log(msg: string) {
  console.log(msg);
  const out = document.getElementById('output');
  if (out) out.textContent += msg + '\n';
}

function updateStatus(status: string) {
  const el = document.getElementById('status');
  if (el) el.textContent = status;
}

function computePercentiles(latencies: number[]) {
  const sorted = [...latencies].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.50)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  return { p50, p95, p99 };
}

async function runBrowserScaleBenchmark() {
  log('===============================================================');
  log('REAL-BROWSER ENTERPRISE SCALE BENCHMARK SUITE');
  log('Native IndexedDB Engine: Chromium / LevelDB');
  log('Targets: 2,000 Students | 65 Sections | 500 Assessments');
  log('Heavy Class: 40 Students | 350 Category Columns | 14,000 Cells');
  log('Events: 250,000 Raw Participation Events Across School Year');
  log('===============================================================');

  updateStatus('Initializing database & seeds...');
  const dbName = `browser-scale-db-${Date.now()}`;
  const db = new OntarioTeacherDB(dbName);
  await seedDatabase(db);
  const participationService = new ParticipationDomainService(db);

  const now = new Date().toISOString();
  const schoolId = 'org-school-port-credit';
  const term = await db.terms.toCollection().first();
  const termId = term!.id;
  const repPeriod = await db.reportingPeriods.toCollection().first();
  const repId = repPeriod!.id;

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
    id: 'staff-heavy-browser-tyler',
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

  // 1. Ingest 2,000 Students across 65 Sections
  updateStatus('[1/5] Ingesting 2,000 students & 65 class sections...');
  log('[1/5] Ingesting 2,000 students & 65 class sections...');
  const totalStudents = 2000;
  const students: Student[] = [];
  const heavyEnrollments: ClassEnrollment[] = [];

  for (let i = 1; i <= totalStudents; i++) {
    students.push({
      id: `bench-std-${i}`,
      organizationId: schoolId,
      localStudentNumber: `S${100000 + i}`,
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
  }
  await db.students.bulkAdd(students);

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

  // 2. Generate 500 Assessments and 100 in Heavy Class (350 category columns, 14,000 cells)
  updateStatus('[2/5] Creating 500 assessments with 350 category columns for heavy class...');
  log('[2/5] Creating 500 assessments with 350 category columns for heavy class...');
  const assessments: Assessment[] = [];
  const categories: AssessmentCategory[] = [];
  const studentAssessments: StudentAssessment[] = [];
  const categoryResults: CategoryResult[] = [];

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

  // 3. Ingest Full 250,000 Raw Participation Events Across School Year
  updateStatus('[3/5] Bulk-ingesting 250,000 raw participation events (chunked)...');
  log('[3/5] Bulk-ingesting 250,000 raw participation events (chunked)...');
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
  const t0Ingest = performance.now();

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
    log(`  -> Ingested ${eventCount.toLocaleString()} / ${targetEvents.toLocaleString()} events...`);
  }
  const ingestDuration = (performance.now() - t0Ingest) / 1000;
  log(`  -> Ingestion completed in ${ingestDuration.toFixed(2)}s`);

  const dailySummariesToSeed: ParticipationDailySummary[] = [];
  for (const enr of heavyEnrollments) {
    dailySummariesToSeed.push({
      id: `pds-init-${enr.id}-2026-09-14`,
      classEnrollmentId: enr.id,
      localSchoolDate: '2026-09-14',
      positiveCount: 2,
      needsFollowupCount: 0,
      totalPoints: 2.0,
      lastEventAt: '2026-09-14T14:00:00.000Z'
    });
  }
  await db.participationDailySummaries.bulkAdd(dailySummariesToSeed);

  // 4. Run Official SLA Operations
  updateStatus('[4/5] Running latency benchmarks with explicit SLA assertions...');
  log('\n[4/5] Running latency benchmarks with explicit SLA assertions...');

  const SLAS = {
    singleClickP95: { limit: 25.0, target: 16.0 },
    batchStamp: { limit: 100.0, target: 50.0 },
    batchUndo: { limit: 100.0, target: 50.0 },
    seatingQuery: { limit: 25.0, target: 16.0 },
    markbookLoad: { limit: 350.0, target: 200.0 },
    calcEngineTotal: { limit: 200.0, target: 50.0 }
  };

  const results: { name: string; measured: number; limit: number; target: number; passed: boolean }[] = [];

  // A: 50 Rapid Entries
  const singleClickLatencies: number[] = [];
  for (let i = 0; i < 50; i++) {
    const t0 = performance.now();
    await participationService.recordParticipation({
      classEnrollmentIds: [heavyEnrollments[i % 40].id],
      classSectionId: heavySectionId,
      name: 'Asked a useful question',
      classification: 'positive',
      points: 1.0,
      occurredAt: '2026-09-14T14:00:00.000Z',
      localSchoolDate: '2026-09-14',
      userId: 'user-tyler',
      deviceId: 'browser-dev'
    });
    singleClickLatencies.push(performance.now() - t0);
  }
  const clickPercentiles = computePercentiles(singleClickLatencies);
  results.push({
    name: '50 Rapid Participation Entries (p95)',
    measured: clickPercentiles.p95,
    limit: SLAS.singleClickP95.limit,
    target: SLAS.singleClickP95.target,
    passed: clickPercentiles.p95 <= SLAS.singleClickP95.limit
  });

  // B: 32-Student Batch Stamp
  const tBatch0 = performance.now();
  const batchStudents = heavyEnrollments.slice(0, 32).map(e => e.id);
  const batchEvents = await participationService.recordParticipation({
    classEnrollmentIds: batchStudents,
    classSectionId: heavySectionId,
    name: 'Demonstrated preparation',
    classification: 'positive',
    points: 1.0,
    occurredAt: '2026-09-14T14:00:00.000Z',
    localSchoolDate: '2026-09-14',
    userId: 'user-tyler',
    deviceId: 'browser-dev'
  });
  const batchTime = performance.now() - tBatch0;
  results.push({
    name: '32-Student Batch Participation Stamp',
    measured: batchTime,
    limit: SLAS.batchStamp.limit,
    target: SLAS.batchStamp.target,
    passed: batchTime <= SLAS.batchStamp.limit
  });

  // C: 1-Click Atomic Batch Undo
  const tUndo0 = performance.now();
  await participationService.undoBatch(batchEvents[0].batchId, 'user-tyler', 'browser-dev');
  const undoTime = performance.now() - tUndo0;
  results.push({
    name: '1-Click Atomic Batch Undo (32 students)',
    measured: undoTime,
    limit: SLAS.batchUndo.limit,
    target: SLAS.batchUndo.target,
    passed: undoTime <= SLAS.batchUndo.limit
  });

  // D: Seating Card Query
  const tProj0 = performance.now();
  await db.participationDailySummaries.where('localSchoolDate').equals('2026-09-14').toArray();
  const projTime = performance.now() - tProj0;
  results.push({
    name: 'Seating Card Summary Query (via daily projection)',
    measured: projTime,
    limit: SLAS.seatingQuery.limit,
    target: SLAS.seatingQuery.target,
    passed: projTime <= SLAS.seatingQuery.limit
  });

  // E: Heavy Markbook Retrieval (14,000 results)
  const tMarkbook0 = performance.now();
  const heavyAssessments = await db.assessments.where('classSectionId').equals(heavySectionId).toArray();
  const assessIds = new Set(heavyAssessments.map(a => a.id));
  const heavyCategories = (await db.assessmentCategories.toArray()).filter(c => assessIds.has(c.assessmentId));
  const heavySAs = await db.studentAssessments.where('classSectionId').equals(heavySectionId).toArray();
  const catIds = new Set(heavyCategories.map(c => c.id));
  const heavyCRs = (await db.categoryResults.toArray()).filter(c => catIds.has(c.assessmentCategoryId) && c.deletedAt === null);
  const markbookLoadTime = performance.now() - tMarkbook0;
  results.push({
    name: 'Heavy Markbook Load (40 students x 350 category columns)',
    measured: markbookLoadTime,
    limit: SLAS.markbookLoad.limit,
    target: SLAS.markbookLoad.target,
    passed: markbookLoadTime <= SLAS.markbookLoad.limit
  });

  // F: Calculation Engine Execution
  const tCalcAll0 = performance.now();
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
  const calcAllTime = performance.now() - tCalcAll0;
  results.push({
    name: 'Calculation Engine (40 students across 350 columns)',
    measured: calcAllTime,
    limit: SLAS.calcEngineTotal.limit,
    target: SLAS.calcEngineTotal.target,
    passed: calcAllTime <= SLAS.calcEngineTotal.limit
  });

  // Report
  log('\n===============================================================');
  log('REAL-BROWSER BENCHMARK EVALUATION REPORT:');
  log('---------------------------------------------------------------');
  let allPassed = true;
  for (const r of results) {
    const status = r.passed ? 'PASS' : 'FAIL';
    if (!r.passed) allPassed = false;
    log(`- ${r.name}:`);
    log(`    Measured: ${r.measured.toFixed(2)}ms | Limit: ${r.limit.toFixed(2)}ms | Target: ${r.target.toFixed(2)}ms => [${status}]`);
  }
  log('===============================================================');

  updateStatus(allPassed ? '[PASS] All SLAs Passed' : '[FAIL] One or more SLAs failed');

  await db.delete();

  const finalPayload = { allPassed, results };
  (window as any).__BENCHMARK_RESULTS__ = finalPayload;
  return finalPayload;
}

runBrowserScaleBenchmark().catch(err => {
  log(`Error running browser benchmark: ${err}`);
  updateStatus('Error: ' + err.message);
  (window as any).__BENCHMARK_RESULTS__ = { allPassed: false, error: String(err) };
});
