import type { OntarioTeacherDB } from '../db/database';
import type { ClassSection, SeatingLayout, UUID } from '../types/schema';
import { AUTH_TABLES, assertClassSectionWriteAccess } from './authHelper';
import { captureLocalWriteActor, guardLocalWriteIdentity, type LocalWriteActor } from './localWriteIdentity';
import { ConcurrencyError } from './participationService';
import { ValidationError } from './markbookService';

type LayoutChanges = Partial<Pick<SeatingLayout, 'rows' | 'cols' | 'isLocked' | 'cardSize'>>;

/** Class and layout metadata writes share the same atomic authority and attribution boundary. */
export class ClassroomStructureService {
  constructor(private db: OntarioTeacherDB) {}

  private tables() {
    return [...AUTH_TABLES(this.db), this.db.devices, this.db.seatingLayouts, this.db.auditEntries, this.db.syncMutations];
  }

  private async record(entityName: 'classSections' | 'seatingLayouts', next: ClassSection | SeatingLayout,
    previous: ClassSection | SeatingLayout | null, actor: LocalWriteActor, organizationId: UUID) {
    const transactionId = crypto.randomUUID();
    await this.db.auditEntries.add({ id: crypto.randomUUID(), entityName, entityId: next.id,
      action: previous ? 'UPDATE' : 'INSERT', transactionId, previousStateJson: previous ? JSON.stringify(previous) : null,
      newStateJson: JSON.stringify(next), diffJson: null, userId: actor.userId, timestamp: next.updatedAt, clientVersion: '1.0.0' });
    await this.db.syncMutations.add({ id: crypto.randomUUID(), deviceId: actor.deviceId, organizationId,
      mutationId: crypto.randomUUID(), transactionId, sequenceNumber: 1, transactionSize: 1, entityName, entityId: next.id,
      operation: previous ? 'UPDATE' : 'INSERT', payloadJson: JSON.stringify(next), baseVersion: previous?.version ?? 0,
      status: 'pending', createdAt: next.updatedAt, attemptCount: 0, lastAttemptAt: null, lastError: null, acknowledgedAt: null });
  }

  async archiveClass(id: UUID, expectedVersion: number, actor: LocalWriteActor): Promise<void> {
    actor = captureLocalWriteActor(actor);
    await this.db.transaction('rw', this.tables(), async () => {
      const check = await guardLocalWriteIdentity(this.db, actor);
      const auth = await assertClassSectionWriteAccess(this.db, actor.userId, id);
      const previous = auth.classSection;
      if (previous.version !== expectedVersion) throw new ConcurrencyError('Class changed. Refresh before archiving.');
      const now = new Date().toISOString();
      const next = { ...previous, deletedAt: now, updatedAt: now, version: previous.version + 1 };
      await this.db.classSections.put(next);
      await this.record('classSections', next, previous, actor, auth.organizationId);
      check();
    });
  }

  async createDefaultLayout(classSectionId: UUID, actor: LocalWriteActor): Promise<SeatingLayout> {
    actor = captureLocalWriteActor(actor);
    return this.db.transaction('rw', this.tables(), async () => {
      const check = await guardLocalWriteIdentity(this.db, actor);
      const auth = await assertClassSectionWriteAccess(this.db, actor.userId, classSectionId);
      const existing = await this.db.seatingLayouts.where('classSectionId').equals(classSectionId).toArray();
      if (existing.some(layout => layout.deletedAt === null) || await this.db.seatingLayouts.get(`layout-${classSectionId}`))
        throw new ConcurrencyError('Classroom layout already exists. Refresh before continuing.');
      const now = new Date().toISOString();
      const next: SeatingLayout = { id: `layout-${classSectionId}`, classSectionId, name: 'Standard Classroom 4x5',
        rows: 4, cols: 5, isLocked: false, cardSize: 'standard', createdAt: now, updatedAt: now, deletedAt: null, version: 1 };
      await this.db.seatingLayouts.add(next);
      await this.record('seatingLayouts', next, null, actor, auth.organizationId);
      check();
      return next;
    });
  }

  async updateLayout(id: UUID, expectedVersion: number, changes: LayoutChanges, actor: LocalWriteActor): Promise<SeatingLayout> {
    // Project the four existing controls only; callers cannot reassign class or overwrite identity/history.
    const patch: LayoutChanges = {};
    for (const key of ['rows', 'cols'] as const) if (changes[key] !== undefined) {
      if (!Number.isSafeInteger(changes[key]) || changes[key]! < 2) throw new ValidationError('Use at least two whole rows and columns.');
      patch[key] = changes[key];
    }
    if (changes.isLocked !== undefined) {
      if (typeof changes.isLocked !== 'boolean') throw new ValidationError('Invalid classroom lock setting.');
      patch.isLocked = changes.isLocked;
    }
    if (changes.cardSize !== undefined) {
      if (!['standard', 'compact'].includes(changes.cardSize)) throw new ValidationError('Invalid classroom card size.');
      patch.cardSize = changes.cardSize;
    }
    if (!Object.keys(patch).length) throw new ValidationError('Choose a classroom layout change.');
    actor = captureLocalWriteActor(actor);
    return this.db.transaction('rw', this.tables(), async () => {
      const check = await guardLocalWriteIdentity(this.db, actor);
      const previous = await this.db.seatingLayouts.get(id);
      if (!previous || previous.deletedAt !== null) throw new ValidationError('Classroom layout is unavailable.');
      const auth = await assertClassSectionWriteAccess(this.db, actor.userId, previous.classSectionId);
      if (previous.version !== expectedVersion) throw new ConcurrencyError('Classroom layout changed. Refresh before editing.');
      // Existing resize semantics deliberately remain unchanged: no seat relocation or deletion here.
      const next = { ...previous, ...patch, updatedAt: new Date().toISOString(), version: previous.version + 1 };
      await this.db.seatingLayouts.put(next);
      await this.record('seatingLayouts', next, previous, actor, auth.organizationId);
      check();
      return next;
    });
  }
}
