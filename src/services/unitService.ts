import type { OntarioTeacherDB } from '../db/database';
import type { Unit, UUID } from '../types/schema';
import { assertClassSectionWriteAccess, AUTH_TABLES } from './authHelper';
import { ValidationError } from './markbookService';
import { ConcurrencyError } from './participationService';

interface Actor { userId: UUID; deviceId: UUID }
export type UnitDetails = Pick<Unit, 'code' | 'title' | 'sortOrder' | 'startsOn' | 'endsOn'>;

function validate(details: UnitDetails): UnitDetails {
  const code = details.code.trim().toUpperCase();
  const title = details.title.trim();
  const validDate = (date: string | null) => date === null ||
    (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date);
  if (!code || code.length > 30 || !title || title.length > 200)
    throw new ValidationError('Enter a unit code (up to 30 characters) and name (up to 200 characters).');
  if (!Number.isInteger(details.sortOrder) || details.sortOrder < 0 || !validDate(details.startsOn) ||
    !validDate(details.endsOn) || (details.startsOn && details.endsOn && details.startsOn > details.endsOn))
    throw new ValidationError('Use a nonnegative whole-number order and valid dates with the end on or after the start.');
  // Project only editable fields, including for callers supplying extra runtime keys.
  return { code, title, sortOrder: details.sortOrder, startsOn: details.startsOn, endsOn: details.endsOn };
}

/** Unit edits retain their identity and assessment links; deletion is deliberately absent. */
export class UnitService {
  constructor(private db: OntarioTeacherDB) {}

  private async record(next: Unit, previous: Unit | null, actor: Actor, organizationId: UUID) {
    const transactionId = crypto.randomUUID();
    const timestamp = next.updatedAt;
    await this.db.auditEntries.add({ id: crypto.randomUUID(), entityName: 'units', entityId: next.id,
      action: previous ? 'UPDATE' : 'INSERT', transactionId, previousStateJson: previous ? JSON.stringify(previous) : null,
      newStateJson: JSON.stringify(next), diffJson: null, userId: actor.userId, timestamp, clientVersion: '1.0.0' });
    await this.db.syncMutations.add({ id: crypto.randomUUID(), deviceId: actor.deviceId, organizationId,
      mutationId: crypto.randomUUID(), transactionId, sequenceNumber: 1, transactionSize: 1, entityName: 'units', entityId: next.id,
      operation: previous ? 'UPDATE' : 'INSERT', payloadJson: JSON.stringify(next), baseVersion: previous?.version ?? 0,
      status: 'pending', createdAt: timestamp, attemptCount: 0, lastAttemptAt: null, lastError: null, acknowledgedAt: null });
  }

  private async requireAvailableCode(classSectionId: UUID, code: string, exceptId?: UUID) {
    // Soft-deleted rows still own their compound unique key. Preserve them and reject reuse.
    const units = await this.db.units.where('classSectionId').equals(classSectionId).toArray();
    if (units.some(unit => unit.id !== exceptId && unit.code.trim().toUpperCase() === code))
      throw new ValidationError('That unit code already exists in this class, including retained archived units. Choose another code.');
  }

  async createUnit(classSectionId: UUID, details: UnitDetails, actor: Actor): Promise<Unit> {
    const changes = validate(details);
    return this.db.transaction('rw', [...AUTH_TABLES(this.db), this.db.units, this.db.auditEntries, this.db.syncMutations], async () => {
      const auth = await assertClassSectionWriteAccess(this.db, actor.userId, classSectionId);
      await this.requireAvailableCode(classSectionId, changes.code);
      const now = new Date().toISOString();
      const unit: Unit = { ...changes, id: crypto.randomUUID(), classSectionId,
        createdAt: now, updatedAt: now, deletedAt: null, version: 1 };
      await this.db.units.add(unit);
      await this.record(unit, null, actor, auth.organizationId);
      return unit;
    });
  }

  async updateUnit(id: UUID, expectedVersion: number, details: UnitDetails, actor: Actor): Promise<Unit> {
    const changes = validate(details);
    return this.db.transaction('rw', [...AUTH_TABLES(this.db), this.db.units, this.db.auditEntries, this.db.syncMutations], async () => {
      const previous = await this.db.units.get(id);
      if (!previous || previous.deletedAt !== null) throw new ValidationError('Unit is unavailable.');
      const auth = await assertClassSectionWriteAccess(this.db, actor.userId, previous.classSectionId);
      if (previous.version !== expectedVersion) throw new ConcurrencyError('Unit changed. Please refresh before editing.');
      await this.requireAvailableCode(previous.classSectionId, changes.code, previous.id);
      const next: Unit = { ...previous, ...changes, updatedAt: new Date().toISOString(), version: previous.version + 1 };
      await this.db.units.put(next);
      await this.record(next, previous, actor, auth.organizationId);
      return next;
    });
  }
}
