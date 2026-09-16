// ============================================================================
// Enterprise Ontario Secondary Assessment Platform - Unified Schema Types
// ============================================================================

export type UUID = string;
export type ISODateString = string; // YYYY-MM-DD
export type ISOTimestampString = string; // ISO 8601 UTC

// 1. Organization & Identity Hierarchy
export type OrganizationType = 'board' | 'school' | 'program' | 'personal';

export interface Organization {
  id: UUID;
  parentOrganizationId: UUID | null;
  parentScopeKey: string; // parentOrganizationId ?? 'ROOT'
  organizationType: OrganizationType;
  name: string;
  code: string;
  createdAt: ISOTimestampString;
  updatedAt: ISOTimestampString;
  deletedAt: ISOTimestampString | null;
  version: number;
}

export interface User {
  id: UUID;
  authSubject: string;
  email: string;
  name: string;
  createdAt: ISOTimestampString;
  updatedAt: ISOTimestampString;
  deletedAt: ISOTimestampString | null;
  version: number;
}

export type OrgRole = 'teacher' | 'department_head' | 'admin' | 'guest';

export interface OrganizationMembership {
  id: UUID;
  organizationId: UUID;
  userId: UUID;
  role: OrgRole;
  status: 'active' | 'suspended';
  createdAt: ISOTimestampString;
  updatedAt: ISOTimestampString;
  deletedAt: ISOTimestampString | null;
  version: number;
}

export type ClassStaffRole = 'primary_teacher' | 'co_teacher' | 'support' | 'read_only';

export interface ClassSectionStaff {
  id: UUID;
  classSectionId: UUID;
  organizationMembershipId: UUID;
  role: ClassStaffRole;
  createdAt: ISOTimestampString;
  updatedAt: ISOTimestampString;
  deletedAt: ISOTimestampString | null;
  version: number;
}

export interface Device {
  id: UUID;
  userId: UUID;
  installationId: string;
  name: string;
  lastSeenAt: ISOTimestampString;
}

export interface UserPreference {
  id: UUID;
  userId: UUID;
  theme: 'light' | 'dark' | 'system';
  lastOpenedClassSectionId: UUID | null;
  markbookDensity: 'compact' | 'comfortable';
  seatingShowPhotos: boolean;
  createdAt: ISOTimestampString;
  updatedAt: ISOTimestampString;
  version: number;
}

// 2. Academic Calendar, Courses & Sessions
export interface AcademicYear {
  id: UUID;
  organizationId: UUID;
  name: string; // e.g. "2026-2027"
  startDate: ISODateString;
  endDate: ISODateString;
  isCurrent: boolean;
  createdAt: ISOTimestampString;
  updatedAt: ISOTimestampString;
  deletedAt: ISOTimestampString | null;
  version: number;
}

export interface Term {
  id: UUID;
  academicYearId: UUID;
  name: string; // e.g. "Semester 1"
  code: string; // e.g. "S1"
  startDate: ISODateString;
  endDate: ISODateString;
  createdAt: ISOTimestampString;
  updatedAt: ISOTimestampString;
  deletedAt: ISOTimestampString | null;
  version: number;
}

export interface ReportingPeriod {
  id: UUID;
  termId: UUID;
  name: string; // "Midterm", "Final", "Progress Report"
  sequenceNumber: number;
  startDate: ISODateString;
  endDate: ISODateString;
  isClosed: boolean;
  createdAt: ISOTimestampString;
  updatedAt: ISOTimestampString;
  deletedAt: ISOTimestampString | null;
  version: number;
}

export interface Course {
  id: UUID;
  organizationId: UUID;
  code: string; // e.g. "ENG4U", "SCH3U"
  title: string;
  department: string;
  gradeLevel: number;
  creditValue: number;
  createdAt: ISOTimestampString;
  updatedAt: ISOTimestampString;
  deletedAt: ISOTimestampString | null;
  version: number;
}

export interface ClassSection {
  id: UUID;
  courseId: UUID;
  termId: UUID;
  sectionNumber: string; // "01", "02"
  period: string; // "Period 2 (10:15 - 11:30 AM)"
  roomNumber: string; // "Room 214"
  colorToken: string; // Hex or theme token
  createdAt: ISOTimestampString;
  updatedAt: ISOTimestampString;
  deletedAt: ISOTimestampString | null;
  version: number;
}

export interface Unit {
  id: UUID;
  classSectionId: UUID;
  code: string; // "U1"
  title: string;
  sortOrder: number;
  startsOn: ISODateString | null;
  endsOn: ISODateString | null;
  createdAt: ISOTimestampString;
  updatedAt: ISOTimestampString;
  deletedAt: ISOTimestampString | null;
  version: number;
}

export interface ClassSession {
  id: UUID;
  classSectionId: UUID;
  startsAt: ISOTimestampString;
  endsAt: ISOTimestampString;
  localSchoolDate: ISODateString; // YYYY-MM-DD
  timezone: string; // "America/Toronto"
  title: string;
  sessionType: 'regular' | 'exam' | 'field_trip' | 'assembly';
  createdAt: ISOTimestampString;
  updatedAt: ISOTimestampString;
  deletedAt: ISOTimestampString | null;
  version: number;
}

// 3. Students, Enrollments, Attendance & Seating
export interface Student {
  id: UUID;
  organizationId: UUID;
  localStudentNumber: string; // Local School Student ID
  oenEncrypted: string | null; // Optional encrypted OEN (never plaintext)
  firstName: string;
  lastName: string;
  preferredName: string | null;
  pronouns: string | null;
  photoUrl: string | null;
  createdAt: ISOTimestampString;
  updatedAt: ISOTimestampString;
  deletedAt: ISOTimestampString | null;
  version: number;
}

export type EnrollmentStatus = 'active' | 'dropped' | 'transferred' | 'completed';

export interface ClassEnrollment {
  id: UUID;
  classSectionId: UUID;
  studentId: UUID;
  enrollmentStatus: EnrollmentStatus;
  enrolledDate: ISODateString;
  droppedDate: ISODateString | null;
  customDisplayOrder: number | null;
  createdAt: ISOTimestampString;
  updatedAt: ISOTimestampString;
  deletedAt: ISOTimestampString | null;
  version: number;
}

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';

export interface AttendanceRecord {
  id: UUID;
  classEnrollmentId: UUID;
  classSessionId: UUID;
  localSchoolDate: ISODateString;
  status: AttendanceStatus;
  reason: string | null;
  createdAt: ISOTimestampString;
  updatedAt: ISOTimestampString;
  deletedAt: ISOTimestampString | null;
  version: number;
}

export interface SeatingLayout {
  id: UUID;
  classSectionId: UUID;
  name: string;
  rows: number;
  cols: number;
  isLocked: boolean;
  cardSize: 'standard' | 'compact';
  createdAt: ISOTimestampString;
  updatedAt: ISOTimestampString;
  deletedAt: ISOTimestampString | null;
  version: number;
}

export interface SeatPosition {
  id: UUID;
  seatingLayoutId: UUID;
  row: number;
  col: number;
  classEnrollmentId: UUID; // Occupied-only: null seats are not stored
  createdAt: ISOTimestampString;
  updatedAt: ISOTimestampString;
  deletedAt: ISOTimestampString | null;
  version: number;
}

// 4. Mark Scales & Grading Policies
export interface MarkScaleFamily {
  id: UUID;
  organizationId: UUID;
  code: string;
  name: string;
  isDefault: boolean;
  createdAt: ISOTimestampString;
  updatedAt: ISOTimestampString;
  deletedAt: ISOTimestampString | null;
  version: number;
}

export interface MarkScaleVersion {
  id: UUID;
  markScaleFamilyId: UUID;
  revision: number;
  effectiveFrom: ISODateString;
  retiredAt: ISODateString | null;
  createdAt: ISOTimestampString;
  updatedAt: ISOTimestampString;
  deletedAt: ISOTimestampString | null;
  version: number;
}

export interface MarkScaleEntry {
  id: UUID;
  markScaleVersionId: UUID;
  code: string; // e.g. "4+", "4", "4-", "3+", "R"
  label: string;
  minimumPercentage: number;
  benchmarkPercentage: number; // Canonical benchmark mapped to this level
  maximumPercentage: number;
  description: string;
  isPassing: boolean;
  isNumeric: boolean;
  sortOrder: number;
}

export type MissingWorkPolicy = 'exclude' | 'zero_with_warning' | 'floor_r';

export interface GradingPolicy {
  id: UUID;
  classSectionId: UUID;
  reportingPeriodId: UUID | null;
  scopeKey: string; // reportingPeriodId ?? 'DEFAULT'
  weightK: number; // e.g. 25.0
  weightT: number; // e.g. 25.0
  weightC: number; // e.g. 25.0
  weightA: number; // e.g. 25.0
  excludeFormative: boolean;
  missingWorkPolicy: MissingWorkPolicy;
  defaultMarkScaleVersionId: UUID;
  decimalPrecision: number;
  createdAt: ISOTimestampString;
  updatedAt: ISOTimestampString;
  deletedAt: ISOTimestampString | null;
  version: number;
}

export type AchievementCategoryCode = 'K' | 'T' | 'C' | 'A';
export type OverrideCategoryCode = 'OVERALL' | AchievementCategoryCode;

export interface GradeOverride {
  id: UUID;
  classEnrollmentId: UUID;
  reportingPeriodId: UUID;
  categoryCode: OverrideCategoryCode;
  overridePercentage: number;
  rationale: string;
  teacherUserId: UUID;
  createdAt: ISOTimestampString;
  updatedAt: ISOTimestampString;
  deletedAt: ISOTimestampString | null;
  version: number;
}

export type SnapshotStatus = 'provisional' | 'finalized' | 'superseded';

export interface GradeSnapshot {
  id: UUID;
  classEnrollmentId: UUID;
  reportingPeriodId: UUID;
  revision: number;
  snapshotStatus: SnapshotStatus;
  calculationPolicyId: UUID;
  calculationPolicyVersion: number;
  calculatedCategoryScoresJson: string; // Record<AchievementCategoryCode, number | null>
  calculatedOverall: number | null;
  finalOverall: number | null;
  evidenceManifestJson: string;
  createdAt: ISOTimestampString;
  finalizedAt: ISOTimestampString | null;
  finalizedByUserId: UUID | null;
}

// 5. Assessments, Criteria & Results
export type AssessmentType = 'summative' | 'formative' | 'diagnostic';

export interface Assessment {
  id: UUID;
  classSectionId: UUID;
  unitId: UUID;
  reportingPeriodId: UUID;
  code: string; // "U1-ESSAY"
  title: string;
  assessmentType: AssessmentType;
  assignedAt: ISOTimestampString;
  dueAt: ISOTimestampString;
  isLocked: boolean;
  createdAt: ISOTimestampString;
  updatedAt: ISOTimestampString;
  deletedAt: ISOTimestampString | null;
  version: number;
}

export interface AssessmentCategory {
  id: UUID;
  assessmentId: UUID;
  categoryCode: AchievementCategoryCode;
  maxScore: number; // Max possible points (e.g. 100 or 20)
  evidenceWeight: number; // Direct relative influence within category (default 1.0)
  markScaleVersionId: UUID | null;
  createdAt: ISOTimestampString;
  updatedAt: ISOTimestampString;
  deletedAt: ISOTimestampString | null;
  version: number;
}

export type WorkflowStatus = 'assigned' | 'submitted' | 'assessed' | 'returned';
export type CompletionStatus = 'complete' | 'incomplete' | 'missing' | 'excused' | 'not_assessed';

export interface StudentAssessment {
  id: UUID;
  assessmentId: UUID;
  classEnrollmentId: UUID;
  classSectionId: UUID; // Denormalized for fast section query indexing
  workflowStatus: WorkflowStatus;
  completionStatus: CompletionStatus;
  isLate: boolean;
  assignedAt: ISOTimestampString;
  dueAt: ISOTimestampString; // Individualized due date
  submittedAt: ISOTimestampString | null;
  assessedAt: ISOTimestampString | null;
  returnedAt: ISOTimestampString | null;
  overallFeedback: string | null;
  privateNotes: string | null;
  createdAt: ISOTimestampString;
  updatedAt: ISOTimestampString;
  deletedAt: ISOTimestampString | null;
  version: number;
}

export type ScoreInputFormat = 'scale_code' | 'raw_points' | 'percentage' | 'descriptive';

export interface CategoryResult {
  id: UUID;
  studentAssessmentId: UUID;
  assessmentCategoryId: UUID;
  rawScore: string; // "4+", "18.5/20", "88%"
  inputFormat: ScoreInputFormat;
  normalizedPercentage: number | null; // 0.0 to 100.0, calculated by domain service
  pointsEarned: number | null;
  pointsPossibleSnapshot: number | null; // Max possible points at time of scoring
  feedback: string | null;
  assessedAt: ISOTimestampString;
  createdAt: ISOTimestampString;
  updatedAt: ISOTimestampString;
  deletedAt: ISOTimestampString | null;
  version: number;
}

// 6. Real-Time Participation
export type EventClassification = 'positive' | 'needs_followup' | 'neutral';

export interface ParticipationEventType {
  id: UUID;
  organizationId: UUID | null;
  name: string;
  code: string;
  icon: string;
  color: string;
  classification: EventClassification;
  defaultPoints: number;
  isArchived: boolean;
  createdAt: ISOTimestampString;
  updatedAt: ISOTimestampString;
  deletedAt: ISOTimestampString | null;
  version: number;
}

export interface ParticipationEvent {
  id: UUID;
  classEnrollmentId: UUID;
  classSectionId: UUID; // Denormalized for high-performance class-wide indexing
  classSessionId: UUID | null;
  batchId: UUID; // For multi-student logging and atomic batch undo
  eventTypeId: UUID | null;
  snapshottedName: string;
  snapshottedClassification: EventClassification;
  snapshottedPoints: number;
  occurredAt: ISOTimestampString;
  localSchoolDate: ISODateString; // YYYY-MM-DD
  timezone: string; // "America/Toronto"
  note: string | null;
  categoryCode: AchievementCategoryCode | null;
  studentAssessmentId: UUID | null;
  createdByUserId: UUID;
  createdAt: ISOTimestampString;
  updatedAt: ISOTimestampString;
  deletedAt: ISOTimestampString | null;
  version: number;
}

export interface ParticipationDailySummary {
  id: UUID;
  classEnrollmentId: UUID;
  localSchoolDate: ISODateString;
  positiveCount: number;
  needsFollowupCount: number;
  totalPoints: number;
  lastEventAt: ISOTimestampString | null;
}

// 7. Student Notes & Structured Audit Log
export interface StudentNote {
  id: UUID;
  classEnrollmentId: UUID;
  authorUserId: UUID;
  content: string;
  isConfidential: boolean;
  createdAt: ISOTimestampString;
  updatedAt: ISOTimestampString;
  deletedAt: ISOTimestampString | null;
  version: number;
}

export type AuditAction = 'INSERT' | 'UPDATE' | 'DELETE';

export interface AuditEntry {
  id: UUID;
  entityName: string;
  entityId: UUID;
  action: AuditAction;
  transactionId: UUID;
  previousStateJson: string | null;
  newStateJson: string | null;
  diffJson: string | null;
  userId: UUID;
  timestamp: ISOTimestampString;
  clientVersion: string;
}

// 8. Sync Infrastructure
export type SyncOperation = 'INSERT' | 'UPDATE' | 'DELETE';
export type SyncMutationStatus = 'pending' | 'acknowledged' | 'failed';

export interface SyncMutation {
  id: UUID;
  deviceId: UUID;
  organizationId: UUID;
  mutationId: UUID; // Idempotent key
  transactionId: UUID;
  sequenceNumber: number;
  transactionSize: number;
  entityName: string;
  entityId: UUID;
  operation: SyncOperation;
  payloadJson: string;
  baseVersion: number;
  status: SyncMutationStatus;
  createdAt: ISOTimestampString;
  attemptCount: number;
  lastAttemptAt: ISOTimestampString | null;
  lastError: string | null;
  acknowledgedAt: ISOTimestampString | null;
}

export interface SyncCursor {
  id: UUID;
  deviceId: UUID;
  organizationId: UUID;
  cursor: string;
  updatedAt: ISOTimestampString;
}
