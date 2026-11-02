import { validateBackupJSONWithTables, type BackupMetadata } from './backupValidation';
import { normalizeLegacyCaptureTables, validateCaptureBackupFiles } from '../capture/portabilityValidation';
import { normalizeLegacyMarkingTables, validateMarkingBackupFiles } from '../marking/portabilityValidation';
import type { OntarioTeacherDB } from '../db/database';
import { calculateOverallCourseGrade } from './calculationEngine';
import { assertClassSectionWriteAccess, AUTH_TABLES } from './authHelper';
import type { UUID, Student, ClassEnrollment } from '../types/schema';
import { escapeCSVCell } from '../utils/csvUtils';
import { parseRosterText, parseCSV, type ParsedStudentRow } from './rosterParser';

export { parseCSV };

export interface CandidateStudentRow extends ParsedStudentRow {
  status: 'new' | 'existing_enrolling' | 'already_enrolled' | 'error';
  existingStudentId?: UUID;
}

export interface ImportRosterBatchParams {
  classSectionId: UUID;
  rows: CandidateStudentRow[];
  userId: UUID;
  deviceId: UUID;
}

export interface ImportRosterResult {
  totalRows: number;
  importedCount: number;
  newStudentsCount: number;
  existingLinkedCount: number;
  skippedDuplicates: number;
  rejectedCount: number;
  errors: string[];
}

export type { BackupMetadata } from './backupValidation';

export class PortabilityService {
  constructor(private db: OntarioTeacherDB) {}

  /**
   * Pre-validates parsed roster rows against live database records for the preview step.
   * Checks:
   * - Parser errors (missing fields, ambiguous commas)
   * - Duplicate student numbers within the pasted list
   * - Duplicate students within the pasted list
   * - Existing student number with conflicting name in organization (BLOCKING ERROR)
   * - Existing student already enrolled in this class section (NON-BLOCKING WARNING)
   * - Existing student ready to enroll
   * - Brand new student
   */
  async validateRosterCandidates(
    classSectionId: UUID,
    parsedRows: ParsedStudentRow[]
  ): Promise<CandidateStudentRow[]> {
    const section = await this.db.classSections.get(classSectionId);
    if (!section) throw new Error(`Class section ${classSectionId} not found.`);

    const course = await this.db.courses.get(section.courseId);
    if (!course) throw new Error(`Course ${section.courseId} not found.`);
    const orgId = course.organizationId;

    // Fetch existing enrollments for this class
    const existingEnrollments = await this.db.classEnrollments
      .where('classSectionId')
      .equals(classSectionId)
      .toArray();

    const activeEnrolledStudentIds = new Set(
      existingEnrollments
        .filter(e => e.deletedAt === null && e.enrollmentStatus === 'active')
        .map(e => e.studentId)
    );

    const enrollmentByStudentId = new Map<string, ClassEnrollment>();
    existingEnrollments.forEach(e => {
      enrollmentByStudentId.set(e.studentId, e);
    });

    // Intra-batch duplicate detection maps
    const studentNumberSeen = new Map<string, number>(); // num -> firstRowNumber
    const studentNameSeen = new Map<string, number>(); // "last,first" -> firstRowNumber

    // Pre-fetch all students in this organization with matching student numbers
    const validNumbers = parsedRows
      .map(r => r.studentNumber.trim())
      .filter(n => n.length > 0);

    const existingOrgStudents = await this.db.students
      .where('organizationId')
      .equals(orgId)
      .filter(s => s.deletedAt === null && validNumbers.includes(s.localStudentNumber))
      .toArray();

    const existingStudentMap = new Map<string, Student>();
    existingOrgStudents.forEach(s => existingStudentMap.set(s.localStudentNumber, s));

    const candidateRows: CandidateStudentRow[] = [];

    for (const r of parsedRows) {
      let status: 'new' | 'existing_enrolling' | 'already_enrolled' | 'error' = 'new';
      let rowError = r.error;
      let rowWarning = r.warning;
      let existingStudentId: UUID | undefined = undefined;

      const num = r.studentNumber.trim();
      const last = r.lastName.trim();
      const first = r.firstName.trim();

      // If parser already flagged an error, retain it
      if (rowError) {
        status = 'error';
      } else {
        // 1. Check intra-batch duplicate student number
        if (studentNumberSeen.has(num)) {
          const firstSeenRow = studentNumberSeen.get(num)!;
          status = 'error';
          rowError = `Duplicate student number "${num}" in pasted list (already appeared on row ${firstSeenRow}).`;
        } else {
          studentNumberSeen.set(num, r.rowNumber);
        }

        // 2. Check intra-batch duplicate student name
        const nameKey = `${last.toLowerCase()},${first.toLowerCase()}`;
        if (!rowError && studentNameSeen.has(nameKey)) {
          const firstSeenRow = studentNameSeen.get(nameKey)!;
          rowWarning = `Same name as row ${firstSeenRow}, with a different student number. Review both identities; they will remain separate students.`;
        } else {
          studentNameSeen.set(nameKey, r.rowNumber);
        }

        // 3. Check existing organization student database records
        if (!rowError) {
          const existing = existingStudentMap.get(num);
          if (existing) {
            existingStudentId = existing.id;
            // Validate name match
            const existingLast = existing.lastName.trim().toLowerCase();
            const existingFirst = existing.firstName.trim().toLowerCase();
            const existingPref = (existing.preferredName || '').trim().toLowerCase();

            const isMatch =
              existingLast === last.toLowerCase() &&
              (existingFirst === first.toLowerCase() || (existingPref && existingPref === first.toLowerCase()));

            if (!isMatch) {
              // Name Conflict: BLOCKING ERROR
              status = 'error';
              rowError = `Name conflict: Student number ${num} is already assigned to "${existing.lastName}, ${existing.firstName}" in your school records, but the pasted list has "${last}, ${first}". Please resolve this conflict before importing.`;
            } else {
              // Check if already enrolled in this class section
              const existingEnrollment = enrollmentByStudentId.get(existing.id);
              if (existingEnrollment && existingEnrollment.deletedAt === null && existingEnrollment.enrollmentStatus === 'active') {
                status = 'already_enrolled';
                rowWarning = [rowWarning, 'Already in this class (duplicate enrolment will be skipped safely).'].filter(Boolean).join(' ');
              } else if (existingEnrollment && (existingEnrollment.enrollmentStatus === 'dropped' || existingEnrollment.deletedAt !== null)) {
                status = 'existing_enrolling';
                rowWarning = [rowWarning, 'Re-enrolling previously dropped student (historical attendance and marks preserved).'].filter(Boolean).join(' ');
              } else {
                status = 'existing_enrolling';
              }
            }
          } else {
            status = 'new';
          }
        }
      }

      candidateRows.push({
        ...r,
        status,
        error: rowError,
        warning: rowWarning,
        existingStudentId
      });
    }

    return candidateRows;
  }

  /**
   * Confirmed transactional import of a validated candidate roster:
   * - In-transaction authorization check using current authenticated user
   * - In-transaction re-check of conflicts against live DB records
   * - Atomic creation of students and enrollments
   * - Exact SyncMutation.transactionSize calculation
   * - Full rollback on any error
   */
  async importRosterBatch(params: ImportRosterBatchParams): Promise<ImportRosterResult> {
    const { classSectionId, rows, userId, deviceId } = params;

    // Fail immediately if client submitted with blocking errors
    const blockingErrors = rows.filter(r => r.status === 'error' || r.error !== null);
    if (blockingErrors.length > 0) {
      throw new Error(
        `Cannot import class list with blocking errors. Please resolve ${blockingErrors.length} error(s) before importing.`
      );
    }

    return await this.db.transaction(
      'rw',
      [
        ...AUTH_TABLES(this.db),
        this.db.students,
        this.db.classEnrollments,
        this.db.auditEntries,
        this.db.syncMutations
      ],
      async () => {
        // 1. In-transaction authorization check
        const auth = await assertClassSectionWriteAccess(this.db, userId, classSectionId);
        const orgId = auth.organizationId;
        const now = new Date().toISOString();
        const txId = crypto.randomUUID();

        // 2. In-transaction conflict re-check: pre-fetch live enrollments and students
        const existingClassEnrollments = await this.db.classEnrollments
          .where('classSectionId')
          .equals(classSectionId)
          .toArray();
        const activeEnrolledStudentIds = new Set(
          existingClassEnrollments
            .filter(e => e.deletedAt === null && e.enrollmentStatus === 'active')
            .map(e => e.studentId)
        );
        const priorEnrollmentMap = new Map<string, ClassEnrollment>();
        existingClassEnrollments.forEach(e => {
          priorEnrollmentMap.set(e.studentId, e);
        });

        // Pre-calculate exact operations to determine exact mutation count
        interface PlannedOp {
          isNew: boolean;
          isReactivation?: boolean;
          studentId: UUID;
          studentData?: Student;
          enrollmentId: UUID;
          enrollmentData: ClassEnrollment;
          previousEnrollmentData?: ClassEnrollment;
        }

        const plannedOps: PlannedOp[] = [];
        let skippedDuplicates = 0;
        let newStudentsCount = 0;
        let existingLinkedCount = 0;

        const seenNumbersInTx = new Set<string>();

        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          const num = r.studentNumber.trim();
          const last = r.lastName.trim();
          const first = r.firstName.trim();

          if (!num || !last || !first) throw new Error('Transaction aborted: first name, last name and student number are required.');

          // Check intra-batch duplicate student number
          if (seenNumbersInTx.has(num)) {
            throw new Error(`Transaction aborted: duplicate student number "${num}" detected in import list.`);
          }
          seenNumbersInTx.add(num);

          // In-transaction database query for student in organization
          const liveStudent = await this.db.students
            .where('organizationId')
            .equals(orgId)
            .filter(s => s.deletedAt === null && s.localStudentNumber === num)
            .first();

          let studentId: UUID;

          if (liveStudent && liveStudent.deletedAt === null) {
            // Verify name match
            const liveLast = liveStudent.lastName.trim().toLowerCase();
            const liveFirst = liveStudent.firstName.trim().toLowerCase();
            const livePref = (liveStudent.preferredName || '').trim().toLowerCase();

            const isMatch =
              liveLast === last.toLowerCase() &&
              (liveFirst === first.toLowerCase() || (livePref && livePref === first.toLowerCase()));

            if (!isMatch) {
              throw new Error(
                `Transaction aborted due to name conflict: Student number "${num}" is registered as "${liveStudent.lastName}, ${liveStudent.firstName}" in database, which conflicts with "${last}, ${first}".`
              );
            }

            studentId = liveStudent.id;

            // Check if already actively enrolled in this class section
            if (activeEnrolledStudentIds.has(studentId)) {
              skippedDuplicates++;
              continue;
            }

            const priorEnrollment = priorEnrollmentMap.get(studentId);
            let enrollment: ClassEnrollment;
            let isReactivation = false;

            if (priorEnrollment) {
              // Reactivate existing enrollment record to avoid ConstraintError on [classSectionId+studentId]
              // and preserve all linked historical attendance, assessments, and participation events!
              isReactivation = true;
              enrollment = {
                ...priorEnrollment,
                enrollmentStatus: 'active',
                droppedDate: null,
                updatedAt: now,
                deletedAt: null,
                version: (priorEnrollment.version || 1) + 1
              };
            } else {
              // Brand new enrollment for this class section
              enrollment = {
                id: crypto.randomUUID(),
                classSectionId,
                studentId,
                enrollmentStatus: 'active',
                enrolledDate: now.slice(0, 10),
                droppedDate: null,
                customDisplayOrder: i + 1,
                createdAt: now,
                updatedAt: now,
                deletedAt: null,
                version: 1
              };
            }

            existingLinkedCount++;

            plannedOps.push({
              isNew: false,
              isReactivation,
              studentId,
              enrollmentId: enrollment.id,
              enrollmentData: enrollment,
              previousEnrollmentData: priorEnrollment
            });
            activeEnrolledStudentIds.add(studentId);
          } else {
            studentId = crypto.randomUUID();
            newStudentsCount++;

            const newStudent: Student = {
              id: studentId,
              organizationId: orgId,
              localStudentNumber: num,
              oenEncrypted: null,
              firstName: first,
              lastName: last,
              preferredName: null,
              pronouns: null,
              photoUrl: null, // photos stay local, start empty
              createdAt: now,
              updatedAt: now,
              deletedAt: null,
              version: 1
            };

            const enrId = crypto.randomUUID();
            const enrollment: ClassEnrollment = {
              id: enrId,
              classSectionId,
              studentId,
              enrollmentStatus: 'active',
              enrolledDate: now.slice(0, 10),
              droppedDate: null,
              customDisplayOrder: i + 1,
              createdAt: now,
              updatedAt: now,
              deletedAt: null,
              version: 1
            };

            plannedOps.push({
              isNew: true,
              studentId,
              studentData: newStudent,
              enrollmentId: enrId,
              enrollmentData: enrollment
            });
            activeEnrolledStudentIds.add(studentId);
          }
        }

        // 3. Exact mutation count calculation
        const totalMutations = newStudentsCount * 2 + existingLinkedCount * 1;
        let sequenceNumber = 1;

        // 4. Execute writes atomically
        for (const op of plannedOps) {
          if (op.isNew && op.studentData) {
            await this.db.students.add(op.studentData);

            // Audit entry for new student
            await this.db.auditEntries.add({
              id: crypto.randomUUID(),
              entityName: 'students',
              entityId: op.studentId,
              action: 'INSERT',
              transactionId: txId,
              previousStateJson: null,
              newStateJson: JSON.stringify(op.studentData),
              diffJson: JSON.stringify(op.studentData),
              userId,
              timestamp: now,
              clientVersion: '1.0.0'
            });

            // Sync mutation for new student (photoUrl omitted completely)
            const { photoUrl: _, ...syncStudentPayload } = op.studentData;
            await this.db.syncMutations.add({
              id: crypto.randomUUID(),
              deviceId,
              organizationId: orgId,
              mutationId: crypto.randomUUID(),
              transactionId: txId,
              sequenceNumber: sequenceNumber++,
              transactionSize: totalMutations,
              entityName: 'students',
              entityId: op.studentId,
              operation: 'INSERT',
              payloadJson: JSON.stringify(syncStudentPayload),
              baseVersion: 0,
              status: 'pending',
              createdAt: now,
              attemptCount: 0,
              lastAttemptAt: null,
              lastError: null,
              acknowledgedAt: null
            });
          }

          if (op.isReactivation) {
            // Update existing enrollment record to reactivate
            await this.db.classEnrollments.put(op.enrollmentData);

            // Audit entry for enrollment reactivation
            await this.db.auditEntries.add({
              id: crypto.randomUUID(),
              entityName: 'classEnrollments',
              entityId: op.enrollmentId,
              action: 'UPDATE',
              transactionId: txId,
              previousStateJson: JSON.stringify(op.previousEnrollmentData || null),
              newStateJson: JSON.stringify(op.enrollmentData),
              diffJson: JSON.stringify({ enrollmentStatus: 'active', droppedDate: null, deletedAt: null }),
              userId,
              timestamp: now,
              clientVersion: '1.0.0'
            });

            // Sync mutation for enrollment reactivation
            await this.db.syncMutations.add({
              id: crypto.randomUUID(),
              deviceId,
              organizationId: orgId,
              mutationId: crypto.randomUUID(),
              transactionId: txId,
              sequenceNumber: sequenceNumber++,
              transactionSize: totalMutations,
              entityName: 'classEnrollments',
              entityId: op.enrollmentId,
              operation: 'UPDATE',
              payloadJson: JSON.stringify(op.enrollmentData),
              baseVersion: op.previousEnrollmentData?.version || 1,
              status: 'pending',
              createdAt: now,
              attemptCount: 0,
              lastAttemptAt: null,
              lastError: null,
              acknowledgedAt: null
            });
          } else {
            // Write brand new enrollment
            await this.db.classEnrollments.add(op.enrollmentData);

            // Audit entry for new enrollment
            await this.db.auditEntries.add({
              id: crypto.randomUUID(),
              entityName: 'classEnrollments',
              entityId: op.enrollmentId,
              action: 'INSERT',
              transactionId: txId,
              previousStateJson: null,
              newStateJson: JSON.stringify(op.enrollmentData),
              diffJson: JSON.stringify(op.enrollmentData),
              userId,
              timestamp: now,
              clientVersion: '1.0.0'
            });

            // Sync mutation for new enrollment
            await this.db.syncMutations.add({
              id: crypto.randomUUID(),
              deviceId,
              organizationId: orgId,
              mutationId: crypto.randomUUID(),
              transactionId: txId,
              sequenceNumber: sequenceNumber++,
              transactionSize: totalMutations,
              entityName: 'classEnrollments',
              entityId: op.enrollmentId,
              operation: 'INSERT',
              payloadJson: JSON.stringify(op.enrollmentData),
              baseVersion: 0,
              status: 'pending',
              createdAt: now,
              attemptCount: 0,
              lastAttemptAt: null,
              lastError: null,
              acknowledgedAt: null
            });
          }
        }

        return {
          totalRows: rows.length,
          importedCount: newStudentsCount + existingLinkedCount,
          newStudentsCount,
          existingLinkedCount,
          skippedDuplicates,
          rejectedCount: 0,
          errors: []
        };
      }
    );
  }

  /**
   * Convenience wrapper that parses raw CSV/roster text, pre-validates candidates,
   * and executes the import batch inside an atomic transaction.
   */
  async importRosterCSV(params: {
    classSectionId: UUID;
    csvText: string;
    userId: UUID;
    deviceId: UUID;
  }): Promise<ImportRosterResult> {
    const parsed = parseRosterText(params.csvText);
    const candidates = await this.validateRosterCandidates(params.classSectionId, parsed.rows);
    return await this.importRosterBatch({
      classSectionId: params.classSectionId,
      rows: candidates,
      userId: params.userId,
      deviceId: params.deviceId
    });
  }

  /**
   * Generates a clean Ontario-formatted Class Markbook CSV export.
   * Uses RFC 4180 escaping for all fields.
   */
  async exportClassMarkbookCSV(classSectionId: UUID, reportingPeriodId: UUID | null): Promise<string> {
    const section = await this.db.classSections.get(classSectionId);
    if (!section) throw new Error('Class section not found');

    const policy =
      (await this.db.gradingPolicies
        .where({ classSectionId, scopeKey: reportingPeriodId ?? 'DEFAULT' })
        .first()) ||
      (await this.db.gradingPolicies.where({ classSectionId, scopeKey: 'DEFAULT' }).first())!;

    const enrollments = await this.db.classEnrollments
      .where('classSectionId')
      .equals(classSectionId)
      .toArray();

    const activeEnrollments = enrollments.filter(e => e.deletedAt === null);
    const students = await this.db.students.bulkGet(activeEnrollments.map(e => e.studentId));

    // Sort alphabetically by student last name
    const studentEnrollmentPairs = activeEnrollments
      .map((enr, i) => ({
        enr,
        student: students[i]
      }))
      .filter(p => p.student && p.student.deletedAt === null);

    studentEnrollmentPairs.sort((a, b) => {
      const l = (a.student?.lastName ?? '').localeCompare(b.student?.lastName ?? '');
      if (l !== 0) return l;
      return (a.student?.firstName ?? '').localeCompare(b.student?.firstName ?? '');
    });

    const allAssessments = await this.db.assessments
      .where('classSectionId')
      .equals(classSectionId)
      .toArray();

    const assessments = allAssessments.filter(
      a => a.deletedAt === null && (!reportingPeriodId || a.reportingPeriodId === reportingPeriodId)
    );

    const categories = await this.db.assessmentCategories
      .where('assessmentId')
      .anyOf(assessments.map(a => a.id))
      .toArray();

    const activeCategories = categories.filter(c => c.deletedAt === null);

    const studentAssessments = await this.db.studentAssessments
      .where('classEnrollmentId')
      .anyOf(activeEnrollments.map(e => e.id))
      .toArray();

    const categoryResults = await this.db.categoryResults
      .where('studentAssessmentId')
      .anyOf(studentAssessments.map(sa => sa.id))
      .toArray();

    const overrides = await this.db.gradeOverrides
      .where('classEnrollmentId')
      .anyOf(activeEnrollments.map(e => e.id))
      .toArray();

    // Build Headers
    const headers = [
      escapeCSVCell('Student ID'),
      escapeCSVCell('Last Name'),
      escapeCSVCell('First Name'),
      escapeCSVCell('Status')
    ];

    interface ColDef {
      assessmentId: UUID;
      categoryId: UUID;
      headerLabel: string;
    }
    const columnDefs: ColDef[] = [];
    const titleCounts = new Map<string, number>();
    for (const assessment of assessments) {
      const key = assessment.title.trim().toLowerCase();
      titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1);
    }

    for (const a of assessments) {
      const titleIsRepeated = (titleCounts.get(a.title.trim().toLowerCase()) ?? 0) > 1;
      const assessmentLabel = titleIsRepeated ? `${a.title} [${a.code}]` : a.title;
      const catsForA = activeCategories.filter(c => c.assessmentId === a.id);
      for (const cat of catsForA) {
        const headerLabel = `${assessmentLabel} - ${cat.categoryCode} (${cat.maxScore} pts)`;
        columnDefs.push({
          assessmentId: a.id,
          categoryId: cat.id,
          headerLabel
        });
        headers.push(escapeCSVCell(headerLabel));
      }
    }

    headers.push(escapeCSVCell('Overall Calculated %'), escapeCSVCell('Overall Final %'));

    const csvLines: string[] = [headers.join(',')];

    // Build Rows
    for (const pair of studentEnrollmentPairs) {
      const enr = pair.enr;
      const std = pair.student!;

      const grade = calculateOverallCourseGrade(
        enr.id,
        reportingPeriodId,
        assessments,
        activeCategories,
        studentAssessments,
        categoryResults,
        policy,
        overrides
      );

      const rowValues: string[] = [
        escapeCSVCell(std.localStudentNumber),
        escapeCSVCell(std.lastName),
        escapeCSVCell(std.preferredName || std.firstName),
        escapeCSVCell(enr.enrollmentStatus)
      ];

      for (const col of columnDefs) {
        const sa = studentAssessments.find(
          s => s.classEnrollmentId === enr.id && s.assessmentId === col.assessmentId
        );
        if (!sa) {
          rowValues.push(escapeCSVCell(''));
          continue;
        }

        if (sa.completionStatus === 'excused') {
          rowValues.push(escapeCSVCell('EXC'));
          continue;
        }
        if (sa.completionStatus === 'missing') {
          rowValues.push(escapeCSVCell('MISS'));
          continue;
        }

        const cr = categoryResults.find(
          r => r.studentAssessmentId === sa.id && r.assessmentCategoryId === col.categoryId
        );
        rowValues.push(escapeCSVCell(cr ? cr.rawScore : ''));
      }

      rowValues.push(
        escapeCSVCell(grade.calculatedOverall !== null ? grade.calculatedOverall : ''),
        escapeCSVCell(grade.finalOverall !== null ? grade.finalOverall : '')
      );

      csvLines.push(rowValues.join(','));
    }

    return csvLines.join('\r\n');
  }

  /**
   * Exports raw participation events with timestamps and notes.
   * Uses RFC 4180 escaping for all fields, safely handling quotes and newlines.
   */
  async exportParticipationEventsCSV(classSectionId: UUID): Promise<string> {
    const events = await this.db.participationEvents
      .where('classSectionId')
      .equals(classSectionId)
      .toArray();

    const activeEvents = events.filter(e => e.deletedAt === null);
    activeEvents.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

    const enrollments = await this.db.classEnrollments.bulkGet(activeEvents.map(e => e.classEnrollmentId));
    const studentIds = enrollments.map(enr => enr?.studentId).filter(Boolean) as UUID[];
    const students = await this.db.students.bulkGet(studentIds);

    const studentMap = new Map<UUID, { num: string; name: string }>();
    enrollments.forEach((enr, i) => {
      if (!enr) return;
      const std = students[i];
      if (std) {
        studentMap.set(enr.id, {
          num: std.localStudentNumber,
          name: `${std.lastName}, ${std.preferredName || std.firstName}`
        });
      }
    });

    const timeFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Toronto',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });

    const headers = [
      'Event ID',
      'Student ID',
      'Student Name',
      'Date',
      'Time (America/Toronto)',
      'Classification',
      'Event Name',
      'Recording Mode',
      'Achievement Level',
      'Points',
      'Category',
      'Note'
    ].map(escapeCSVCell);

    const csvLines: string[] = [headers.join(',')];

    for (const ev of activeEvents) {
      const stdInfo = studentMap.get(ev.classEnrollmentId) || { num: '', name: '' };
      let localTime = '';
      try {
        localTime = timeFormatter.format(new Date(ev.occurredAt));
      } catch {
        localTime = ev.occurredAt.slice(11, 19);
      }

      csvLines.push([
        escapeCSVCell(ev.id),
        escapeCSVCell(stdInfo.num),
        escapeCSVCell(stdInfo.name),
        escapeCSVCell(ev.localSchoolDate),
        escapeCSVCell(localTime),
        escapeCSVCell(ev.snapshottedClassification),
        escapeCSVCell(ev.snapshottedName),
        escapeCSVCell(ev.snapshottedRecordingMode || 'quick_tally'),
        escapeCSVCell(ev.achievementLevel !== null && ev.achievementLevel !== undefined ? ev.achievementLevel : ''),
        escapeCSVCell(ev.snapshottedPoints),
        escapeCSVCell(ev.categoryCode || ''),
        escapeCSVCell(ev.note || '')
      ].join(','));
    }

    return csvLines.join('\r\n');
  }

  /**
   * Full database JSON backup.
   */
  async createFullBackupJSON(): Promise<string> {
    const backup: Record<string, any> = {
      version: 2,
      schemaVersion: 5,
      exportedAt: new Date().toISOString(),
      tables: {}
    };

    await this.db.transaction('r', this.db.tables, async () => {
      for (const table of this.db.tables) backup.tables[table.name] = await table.toArray();
    });

    return JSON.stringify(backup, null, 2);
  }

  /**
   * Pre-validates backup JSON format and contents before replacing any data.
   * Throws descriptive error if file is malformed, has unsupported schema version,
   * is missing any database table, or has invalid record shapes.
   */
  validateBackupJSON(jsonString: string): BackupMetadata {
    return validateBackupJSONWithTables(jsonString, this.db.tables);
  }

  /**
   * Restores full database from JSON backup.
   * Validates format and contents FIRST; leaves database intact if validation fails.
   */
  async restoreFromJSON(jsonString: string): Promise<{ restoredTables: number; totalRecords: number }> {
    // 1. Pre-validation: halts before modifying or clearing any table
    const metadata = this.validateBackupJSON(jsonString);
    const data = JSON.parse(jsonString);
    normalizeLegacyMarkingTables(data.tables, data.schemaVersion);
    normalizeLegacyCaptureTables(data.tables, data.schemaVersion);
    await validateMarkingBackupFiles(data.tables);
    await validateCaptureBackupFiles(data.tables);

    // 2. Backfill legacy participationEventTypes
    if (Array.isArray(data.tables.participationEventTypes)) {
      const groupCounters: Record<string, number> = { positive: 0, neutral: 0, needs_followup: 0 };
      data.tables.participationEventTypes.forEach((t: any) => {
        const cls = t.classification || 'positive';
        groupCounters[cls] = (groupCounters[cls] || 0) + 1;
        if (!t.recordingMode) t.recordingMode = 'quick_tally';
        if (t.defaultCategoryCode === undefined) t.defaultCategoryCode = null;
        if (typeof t.sortOrder !== 'number') t.sortOrder = groupCounters[cls];
        if (t.name === undefined && typeof t.label === 'string') t.name = t.label;
        if (t.label === undefined && typeof t.name === 'string') t.label = t.name;
      });
    }

    // 3. Backfill legacy participationEvents without fabricating eventTypeId references
    if (Array.isArray(data.tables.participationEvents)) {
      data.tables.participationEvents.forEach((ev: any) => {
        if (!ev.snapshottedRecordingMode) ev.snapshottedRecordingMode = 'quick_tally';
        if (ev.achievementLevel === undefined) ev.achievementLevel = null;
        if (ev.eventTypeId === undefined) ev.eventTypeId = null;
      });
    }

    // 3b. Backfill legacy assessmentCategories: weight -> evidenceWeight
    if (Array.isArray(data.tables.assessmentCategories)) {
      data.tables.assessmentCategories.forEach((cat: any) => {
        if (cat.evidenceWeight === undefined && typeof cat.weight === 'number') {
          cat.evidenceWeight = cat.weight;
        }
      });
    }

    // 3c. Backfill legacy markScaleEntries: name -> label
    if (Array.isArray(data.tables.markScaleEntries)) {
      data.tables.markScaleEntries.forEach((entry: any) => {
        if (entry.label === undefined && typeof entry.name === 'string') {
          entry.label = entry.name;
        }
      });
    }

    // 3d. Backfill legacy studentAssessments: missing classSectionId from classEnrollment
    if (Array.isArray(data.tables.studentAssessments) && Array.isArray(data.tables.classEnrollments)) {
      const enrMap = new Map<string, string>();
      for (const enr of data.tables.classEnrollments) {
        if (enr && enr.id && enr.classSectionId) enrMap.set(enr.id, enr.classSectionId);
      }
      data.tables.studentAssessments.forEach((sa: any) => {
        if (!sa.classSectionId && sa.classEnrollmentId) {
          sa.classSectionId = enrMap.get(sa.classEnrollmentId) || null;
        }
      });
    }

    // 4. Capture existing summary IDs to preserve them if present
    const existingSummaryMap = new Map<string, string>();
    if (Array.isArray(data.tables.participationDailySummaries)) {
      for (const s of data.tables.participationDailySummaries) {
        if (s.classEnrollmentId && s.localSchoolDate && s.id) {
          existingSummaryMap.set(`${s.classEnrollmentId}_${s.localSchoolDate}`, s.id);
        }
      }
    }

    // 5. Rebuild the entire daily-summary projection in a single pass over active events
    interface DailyAgg {
      classEnrollmentId: string;
      localSchoolDate: string;
      positiveCount: number;
      needsFollowupCount: number;
      neutralCount: number;
      totalPoints: number;
      lastEventAt: string | null;
    }
    const aggregated = new Map<string, DailyAgg>();

    if (Array.isArray(data.tables.participationEvents)) {
      for (const ev of data.tables.participationEvents) {
        if (ev.deletedAt !== null && ev.deletedAt !== undefined) continue;
        const key = `${ev.classEnrollmentId}_${ev.localSchoolDate}`;
        let agg = aggregated.get(key);
        if (!agg) {
          agg = {
            classEnrollmentId: ev.classEnrollmentId,
            localSchoolDate: ev.localSchoolDate,
            positiveCount: 0,
            needsFollowupCount: 0,
            neutralCount: 0,
            totalPoints: 0,
            lastEventAt: null
          };
          aggregated.set(key, agg);
        }

        if (ev.snapshottedClassification === 'positive') agg.positiveCount++;
        else if (ev.snapshottedClassification === 'needs_followup') agg.needsFollowupCount++;
        else if (ev.snapshottedClassification === 'neutral') agg.neutralCount++;

        agg.totalPoints += typeof ev.snapshottedPoints === 'number' ? ev.snapshottedPoints : 0;
        if (!agg.lastEventAt || (ev.occurredAt && ev.occurredAt.localeCompare(agg.lastEventAt) > 0)) {
          agg.lastEventAt = ev.occurredAt;
        }
      }
    }

    const rebuiltSummaries: any[] = [];
    for (const [key, agg] of aggregated.entries()) {
      const existingId = existingSummaryMap.get(key);
      rebuiltSummaries.push({
        id: existingId || crypto.randomUUID(),
        classEnrollmentId: agg.classEnrollmentId,
        localSchoolDate: agg.localSchoolDate,
        positiveCount: agg.positiveCount,
        needsFollowupCount: agg.needsFollowupCount,
        neutralCount: agg.neutralCount,
        totalPoints: agg.totalPoints,
        lastEventAt: agg.lastEventAt
      });
    }

    data.tables.participationDailySummaries = rebuiltSummaries;

    let totalRecords = 0;
    let restoredTables = 0;

    // 6. Atomic table replacement in a single Dexie write transaction
    await this.db.transaction('rw', this.db.tables, async () => {
      for (const table of this.db.tables) {
        if (data.tables[table.name]) {
          await table.clear();
          const records = data.tables[table.name];
          if (records.length > 0) {
            const CHUNK_SIZE = 500;
            for (let i = 0; i < records.length; i += CHUNK_SIZE) {
              await table.bulkAdd(records.slice(i, i + CHUNK_SIZE));
            }
            totalRecords += records.length;
          }
          restoredTables++;
        }
      }
    });

    return { restoredTables, totalRecords };
  }
}
