import Dexie from 'dexie';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import type { OntarioTeacherDB } from '../db/database';
import { PortabilityService } from '../services/portabilityService';
import { assertWorkspaceAccess, type Snapshot } from '../sync/snapshot';
import { getIdentityEpoch } from '../services/identityService';
import { validateMarkingBackupFiles } from '../marking/portabilityValidation';
import { validateCaptureBackupFiles } from '../capture/portabilityValidation';
import { validateBankComments } from '../marking/commentBank';
import type { RecoveryStore, RecoveryOptions, SavedBackup, SyncState } from '../sync/backupStore';
import type { MigrationSource } from './encryptedWorkspace';
import { DurableDexieGate, type FrozenDatabases } from './durableDexieGate';

export interface StudentOrganizerWorkingBundle {
  format: 'student-organizer-working'; version: 1;
  primary: Snapshot;
  recovery: { backups: SavedBackup[]; options: RecoveryOptions[]; state: SyncState[] };
  /** App-owned private drafts, comment banks and device/teacher convenience hints. Never transfer verbatim to another app. */
  applicationStorage: Record<string, string>;
}
const MAX_CHARS = 128 * 1024 * 1024;
function storageKey(key: string): boolean {
  return key.startsWith('ota.comment-bank.v1.') || ['ota.bug-report-draft.v1', 'ota.last-confirmed-teacher.v1', 'ontario_teacher_device_id', 'student-organizer-appearance'].includes(key);
}
function collectStorage(source: Readonly<Record<string, string>>): Record<string, string> {
  const result: Record<string, string> = {}; let size = 0;
  for (const key of Object.keys(source).sort()) {
    const value = source[key];
    if (!storageKey(key) || typeof value !== 'string' || value.length > 2 * 1024 * 1024 || (size += key.length + value.length) > MAX_CHARS) throw new Error('Unsupported or oversized application storage. Encryption preparation stopped.');
    if (key.startsWith('ota.comment-bank.v1.')) validateBankComments(JSON.parse(value));
    result[key] = value;
  }
  return result;
}
function rows(snapshots: FrozenDatabases, db: Dexie): Record<string, any[]> {
  const captured = snapshots.get(db); if (!captured) throw new Error('Every source database must be registered with the durable writer gate.');
  if (Object.keys(captured).sort().join('|') !== db.tables.map(table => table.name).sort().join('|')) throw new Error('The encrypted source is missing database tables.');
  return structuredClone(captured) as Record<string, any[]>;
}
/** Memory-only inspection preserves existing authorization queries without granting live-RAM read bypasses. */
async function inspectAuthority(database: OntarioTeacherDB, tables: Record<string, any[]>, userId: string, epoch: number): Promise<void> {
  const inspection = new Dexie('encryption-inspection-' + crypto.randomUUID(), { indexedDB: new IDBFactory(), IDBKeyRange, cache: 'disabled' });
  const schema = Object.fromEntries(database.tables.map(table => [table.name, [table.schema.primKey.src, ...table.schema.indexes.map(index => index.src)].join(',')]));
  inspection.version(1).stores(schema);
  try {
    await inspection.open();
    await inspection.transaction('rw', inspection.tables, async () => { for (const table of inspection.tables) await table.bulkAdd(tables[table.name]); });
    await assertWorkspaceAccess(inspection as OntarioTeacherDB, userId, epoch);
  } finally { inspection.close(); await inspection.delete(); }
}
/**
 * All applicationStorage writers must use the SAME gate's externalWrite boundary.
 * The adapter reads only memory; do not supply live localStorage while legacy writers are active.
 * The original databases/storage are never changed by collection or migration.
 */
export function createStudentOrganizerMigrationSource(options: {
  gate: DurableDexieGate; database: OntarioTeacherDB; recovery: RecoveryStore; userId: string;
  captureApplicationStorage: () => Readonly<Record<string, string>>;
}): MigrationSource<StudentOrganizerWorkingBundle> {
  const { gate, database, recovery, userId } = options;
  const epoch = getIdentityEpoch(), exportedAt = new Date().toISOString();
  return {
    withReadLock: task => gate.withReadLock(async snapshots => {
      const primaryTables = rows(snapshots, database), recoveryTables = rows(snapshots, recovery);
      // Existing retained-user/archived-class/organization authority applies before exposing captured content.
      await inspectAuthority(database, primaryTables, userId, epoch);
      const primary: Snapshot = { version: 2, schemaVersion: 5, exportedAt, tables: primaryTables };
      const service = new PortabilityService(database);
      const primaryJSON = JSON.stringify(primary); if (primaryJSON.length > MAX_CHARS) throw new Error('Workspace exceeds the supported encrypted container size.');
      service.validateBackupJSON(primaryJSON); await validateMarkingBackupFiles(primary.tables); await validateCaptureBackupFiles(primary.tables);
      if (Object.keys(recoveryTables).sort().join('|') !== 'backups|options|state') throw new Error('Unsupported recovery storage schema.');
      const backups = recoveryTables.backups as SavedBackup[], settings = recoveryTables.options as RecoveryOptions[], state = recoveryTables.state as SyncState[];
      let size = primaryJSON.length;
      for (const backup of backups) {
        if (!backup || typeof backup.id !== 'string' || !['automatic', 'manual', 'before-restore', 'before-sync'].includes(backup.reason) || !Number.isFinite(Date.parse(backup.createdAt)) || typeof backup.json !== 'string' || (size += backup.json.length) > MAX_CHARS) throw new Error('Invalid or oversized recovery snapshot.');
        service.validateBackupJSON(backup.json); const parsed = JSON.parse(backup.json); await validateMarkingBackupFiles(parsed.tables); await validateCaptureBackupFiles(parsed.tables); await inspectAuthority(database, parsed.tables, userId, epoch);
      }
      if (settings.length > 1 || settings.some(value => value.id !== 'options' || typeof value.automatic !== 'boolean' || ![1, 6, 24].includes(value.intervalHours) || ![7, 14, 30].includes(value.retain))) throw new Error('Invalid recovery settings.');
      if (state.length > 1 || state.some(value => value.id !== 'sync' || (value.lastRemoteId !== undefined && typeof value.lastRemoteId !== 'string'))) throw new Error('Invalid recovery checkpoint.');
      for (const value of state) if (value.base) { service.validateBackupJSON(JSON.stringify(value.base)); await validateMarkingBackupFiles(value.base.tables); await validateCaptureBackupFiles(value.base.tables); await inspectAuthority(database, value.base.tables, userId, epoch); }
      const applicationStorage = collectStorage(options.captureApplicationStorage());
      const bundle: StudentOrganizerWorkingBundle = { format: 'student-organizer-working', version: 1, primary, recovery: { backups, options: settings, state }, applicationStorage };
      if (JSON.stringify(bundle).length > MAX_CHARS) throw new Error('Workspace and recovery history exceed the supported encrypted container size.');
      await inspectAuthority(database, primaryTables, userId, epoch);
      return task(bundle);
    })
  };
}
