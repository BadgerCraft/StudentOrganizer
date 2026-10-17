import type { OntarioTeacherDB } from '../db/database';

/** Must remain equal to the native installer's mandatory backup ceiling. */
export const CAPTURE_BACKUP_MAX_BYTES = 256 * 1024 * 1024;

/**
 * Count the exact UTF-8 bytes of the existing pretty-printed full-backup format,
 * one record at a time. Call inside the transaction spanning every DB table so
 * concurrent changes cannot invalidate the budget before the attachment commits.
 * No full-class backup string or array of original photographs is allocated.
 */
export async function assertCaptureBackupCapacity(db: OntarioTeacherDB, maxBytes = CAPTURE_BACKUP_MAX_BYTES): Promise<number> {
  const encoder = new TextEncoder();
  const emptyTables = Object.fromEntries(db.tables.map(table => [table.name, []]));
  let size = encoder.encode(JSON.stringify({ version: 2, schemaVersion: 5, exportedAt: new Date().toISOString(), tables: emptyTables }, null, 2)).length;
  const check = () => {
    if (size > maxBytes) throw new Error('This page set would exceed the 256 MB complete-backup limit. Nothing from this match was saved. Keep the original ZIP. Existing records were preserved; resolve complete-backup capacity before retrying.');
  };
  check();
  for (const table of db.tables) {
    let first = true;
    await table.each(record => {
      // A record is indented six spaces within tables -> table array. The empty
      // array becomes multiline (+4), and each item contributes a separator (+2).
      const json = JSON.stringify(record, null, 2);
      size += encoder.encode(json).length + 6 * (1 + (json.match(/\n/g)?.length ?? 0)) + 2 + (first ? 4 : 0);
      first = false;
    });
    check();
  }
  check();
  return size;
}
