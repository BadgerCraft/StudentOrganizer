import { BACKUP_TABLE_NAMES, validateBackupDataWithTables } from '../services/backupValidation';
import { normalizeLegacyMarkingTables, validateMarkingBackupFiles } from '../marking/portabilityValidation';
import { normalizeLegacyCaptureTables, validateCaptureBackupFiles } from '../capture/portabilityValidation';
import { assertClassSectionPolicy } from '../services/classAccessPolicy';
export interface MainSnapshot { version: number; schemaVersion: number; exportedAt: string; tables: Record<string, any[]> }
export interface StudentOrganizerWorkingBundle { format: 'student-organizer-working'; version: 1; primary: MainSnapshot; recovery: { backups: {id: string; createdAt: string; reason: string; json: string}[]; options: {id: string; automatic: boolean; intervalHours: number; retain: number}[]; state: {id: string; lastRemoteId?: string; base?: MainSnapshot}[] }; applicationStorage: Record<string, string> };

const TABLES = Object.freeze(BACKUP_TABLE_NAMES.map(name => Object.freeze({ name })));
const MAX_STORAGE_CHARS = 128 * 1024 * 1024;
const fail = (): never => { throw new Error('Encrypted workspace validation failed. Keep the original workspace and choose a verified recovery source.'); };
function object(value: unknown): asserts value is Record<string, any> { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(); }
function keys(value: Record<string, unknown>, expected: string[]): void { if (Object.keys(value).sort().join('|') !== [...expected].sort().join('|')) fail(); }
function* snapshots(bundle: StudentOrganizerWorkingBundle): Generator<any> {
  yield bundle.primary;
  for (const value of bundle.recovery.backups) yield JSON.parse(value.json);
  for (const value of bundle.recovery.state) if (value.base) yield value.base;
}
function normalizedTables(snapshot: any): Record<string, any[]> {
  const copy = { ...snapshot.tables }; normalizeLegacyMarkingTables(copy, snapshot.schemaVersion); normalizeLegacyCaptureTables(copy, snapshot.schemaVersion); return copy;
}
function snapshotShape(value: unknown, verifiedCaptureBytes?: WeakSet<object>, verifiedAttempts?: WeakSet<object>): void {
  object(value); validateBackupDataWithTables({ ...value, tables: { ...value.tables } }, TABLES, verifiedCaptureBytes, verifiedAttempts);
}
/** Canonical structural validation, suitable for a synchronous host/session callback. No renderer globals or database access. */
export function assertMainWorkingBundle(value: unknown): asserts value is StudentOrganizerWorkingBundle { assertBundleShape(value); }
function assertBundleShape(value: unknown, retained?: { backups: WeakSet<object>; bases: WeakSet<object>; captures: WeakSet<object>; attempts: WeakSet<object> }): asserts value is StudentOrganizerWorkingBundle {
  try {
    object(value); keys(value, ['format', 'version', 'primary', 'recovery', 'applicationStorage']);
    if (value.format !== 'student-organizer-working' || value.version !== 1) fail();
    snapshotShape(value.primary, retained?.captures, retained?.attempts);
    if (value.primary.version !== 2 || value.primary.schemaVersion !== 5) fail();
    object(value.recovery); keys(value.recovery, ['backups', 'options', 'state']);
    const { backups, options, state } = value.recovery;
    if (!Array.isArray(backups) || !Array.isArray(options) || !Array.isArray(state) || options.length > 1 || state.length > 1) fail();
    const ids = new Set<string>();
    for (const backup of backups) {
      object(backup); keys(backup, ['id', 'createdAt', 'reason', 'json']);
      if (typeof backup.id !== 'string' || !backup.id || ids.has(backup.id) || !['automatic', 'manual', 'before-restore', 'before-sync'].includes(backup.reason) || !Number.isFinite(Date.parse(backup.createdAt)) || typeof backup.json !== 'string') fail();
      ids.add(backup.id); if (!retained?.backups.has(backup)) snapshotShape(JSON.parse(backup.json));
    }
    for (const option of options) { object(option); keys(option, ['id', 'automatic', 'intervalHours', 'retain']); if (option.id !== 'options' || typeof option.automatic !== 'boolean' || ![1, 6, 24].includes(option.intervalHours) || ![7, 14, 30].includes(option.retain)) fail(); }
    for (const checkpoint of state) { object(checkpoint); if (Object.keys(checkpoint).some(key => !['id', 'lastRemoteId', 'base'].includes(key)) || checkpoint.id !== 'sync' || (checkpoint.lastRemoteId !== undefined && (typeof checkpoint.lastRemoteId !== 'string' || !checkpoint.lastRemoteId))) fail(); if (checkpoint.base !== undefined && !retained?.bases.has(checkpoint.base)) snapshotShape(checkpoint.base); }
    object(value.applicationStorage); let storageSize = 0;
    for (const [key, raw] of Object.entries(value.applicationStorage)) {
      if (typeof raw !== 'string' || raw.length > 2 * 1024 * 1024 || (storageSize += key.length + raw.length) > MAX_STORAGE_CHARS) fail();
      if (key.startsWith('ota.comment-bank.v1.')) {
        // This is the same format/limits as validateBankComments; actor confirmation remains outside stored hints.
        const comments: unknown = JSON.parse(raw);
        if (!Array.isArray(comments) || comments.length > 500 || comments.some(text => typeof text !== 'string' || !text.trim() || text.length > 5000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/u.test(text)) || comments.reduce((n, text) => n + text.length, 0) > 200000) fail();
        if (!key.slice('ota.comment-bank.v1.'.length)) fail();
      } else if (!['ota.bug-report-draft.v1', 'ota.last-confirmed-teacher.v1', 'ontario_teacher_device_id', 'student-organizer-appearance'].includes(key)) fail();
    }
  } catch { fail(); }
}
/** Byte/hash/archive checks run before exposing decrypted contents or accepting any commit. */
export async function validateMainWorkingBundleFiles(value: unknown): Promise<void> {
  await validateMainBundleIntegrity(value);
}

/** Full-workspace disclosure/replacement policy; never run this as a new class-write policy on every autosave. */
async function authority(tables: Record<string, any[]>, userId: string): Promise<void> {
  const user = tables.users.find(user => user.id === userId);
  if (!user || user.deletedAt !== null) fail();
  const memberships = tables.organizationMemberships.filter(m => m.userId === userId && m.deletedAt === null && m.status === 'active');
  if (!memberships.some(m => ['teacher', 'admin', 'department_head'].includes(m.role))) fail();
  const orgs = tables.organizations;
  const orgChain = (id: string) => { const ids: string[] = []; let current: string | null = id; while (current && !ids.includes(current) && ids.length < 100) { ids.push(current); current = orgs.find(o => o.id === current)?.parentOrganizationId ?? null; } return ids; };
  const adminFor = (id: string) => memberships.some(m => m.role === 'admin' && orgChain(id).includes(m.organizationId));
  if ((tables.users.some(user => user.id !== userId) || tables.studentNotes.some(note => note.authorUserId !== userId)) && orgs.some(org => !adminFor(org.id))) fail();
  for (const section of tables.classSections) {
    if (section.deletedAt === null) assertClassSectionPolicy({ user, classSection: section, course: tables.courses.find(course => course.id === section.courseId), organizations: orgs as any, memberships: tables.organizationMemberships as any, staff: tables.classSectionStaff as any }, userId, section.id);
    else {
      const course = tables.courses.find(course => course.id === section.courseId);
      const staff = tables.classSectionStaff.filter(s => s.classSectionId === section.id);
      if (!course || (!adminFor(course.organizationId) && !staff.some(s => memberships.some(m => m.id === s.organizationMembershipId) && s.deletedAt === null && ['primary_teacher', 'co_teacher', 'support'].includes(s.role) && memberships.some(m => m.organizationId === course.organizationId && m.role === 'teacher')))) fail();
    }
  }
  for (const student of tables.students) if (!adminFor(student.organizationId) && !memberships.some(m => m.organizationId === student.organizationId && ['teacher', 'department_head'].includes(m.role))) fail();
}
/** Caller supplies a main-bound operator ID; a bundle field/renderer 'authorized' flag is never accepted. */
export async function assertMainFullWorkspaceAuthority(value: unknown, boundUserId: string): Promise<void> {
  const checked: unknown = structuredClone(value);
  assertMainWorkingBundle(checked);
  if (typeof boundUserId !== 'string' || !boundUserId) fail();
  try { for (const snapshot of snapshots(checked)) await authority(normalizedTables(snapshot), boundUserId); }
  catch { fail(); }
}

/** Use the returned detached value for the host operation; never validate one object and then persist a caller's mutable alias. */
export async function validateMainBundleIntegrity(value: unknown): Promise<StudentOrganizerWorkingBundle> {
  const checked: unknown = structuredClone(value);
  assertMainWorkingBundle(checked);
  try { for (const snapshot of snapshots(checked)) { const tables = normalizedTables(snapshot); await validateMarkingBackupFiles(tables); await validateCaptureBackupFiles(tables); } }
  catch { fail(); }
  return checked;
}

/** Main-only cache. Exact deeply frozen verified identities may reuse bytes, never renderer flags or IDs. */
export function createMainBundleValidationCache() {
  let retained = { backups: new WeakSet<object>(), bases: new WeakSet<object>(), captures: new WeakSet<object>() };
  let attempts = new WeakSet<object>(), owned = new WeakSet<object>(), initialized = false, epoch = 0;
  function freeze(value: any, visiting = new Set<object>()): void {
    if (!value || typeof value !== 'object' || owned.has(value)) return;
    if (visiting.has(value) || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype)) fail();
    visiting.add(value); for (const child of Object.values(value)) freeze(child, visiting); visiting.delete(value); Object.freeze(value);
  }
  function remember(value: any): void {
    if (!value || typeof value !== 'object' || owned.has(value)) return;
    owned.add(value); for (const child of Object.values(value)) remember(child);
  }
  function accept(bundle: StudentOrganizerWorkingBundle): StudentOrganizerWorkingBundle {
    for (const value of bundle.primary.tables.markingAttempts) attempts.add(value);
    for (const value of bundle.primary.tables.captureAttachments) retained.captures.add(value);
    for (const value of bundle.recovery.backups) retained.backups.add(value);
    for (const value of bundle.recovery.state) if (value.base) retained.bases.add(value.base);
    remember(bundle); initialized = true; return bundle;
  }
  return {
    async initialize(value: unknown): Promise<StudentOrganizerWorkingBundle> {
      const enteredEpoch = epoch, verified = await validateMainBundleIntegrity(value); if (enteredEpoch !== epoch) fail(); freeze(verified); return accept(verified);
    },
    async validateCandidate(value: unknown): Promise<StudentOrganizerWorkingBundle> {
      if (!initialized) fail(); const enteredEpoch = epoch;
      // Freeze synchronously before the first await; unchanged subtrees were already frozen by this cache.
      freeze(value); assertBundleShape(value, { ...retained, attempts }); const checked = value;
      try {
        const tables = normalizedTables(checked.primary);
        await validateMarkingBackupFiles({ ...tables, markingAttempts: tables.markingAttempts.filter(record => !attempts.has(record)) });
        await validateCaptureBackupFiles({ ...tables, captureAttachments: tables.captureAttachments.filter(record => !retained.captures.has(record)) });
        for (const backup of checked.recovery.backups) if (!retained.backups.has(backup)) {
          const historical = normalizedTables(JSON.parse(backup.json)); await validateMarkingBackupFiles(historical); await validateCaptureBackupFiles(historical);
        }
        for (const state of checked.recovery.state) if (state.base && !retained.bases.has(state.base)) {
          const historical = normalizedTables(state.base); await validateMarkingBackupFiles(historical); await validateCaptureBackupFiles(historical);
        }
      } catch { fail(); }
      if (enteredEpoch !== epoch) fail(); return accept(checked);
    },
    clear(): void { epoch++; retained = { backups: new WeakSet<object>(), bases: new WeakSet<object>(), captures: new WeakSet<object>() }; attempts = new WeakSet<object>(); owned = new WeakSet<object>(); initialized = false; }
  };
}
