import type { OntarioTeacherDB } from '../db/database';
import type {
  AchievementCategoryCode,
  AuditEntry,
  EventClassification,
  ParticipationEventType,
  ParticipationRecordingMode,
  SyncMutation,
  UUID
} from '../types/schema';
import { ValidationError } from './markbookService';
import { ConcurrencyError } from './participationService';
import { assertClassSectionWriteAccess, AUTH_TABLES } from './authHelper';

export interface CreateEventTypeParams {
  classSectionId: UUID;
  name: string;
  classification: EventClassification;
  recordingMode: ParticipationRecordingMode;
  defaultPoints: number;
  defaultCategoryCode: AchievementCategoryCode | null;
  icon?: string;
  color?: string;
  userId: UUID;
  deviceId: UUID;
}

export interface UpdateEventTypeParams {
  eventTypeId: UUID;
  expectedVersion: number;
  classSectionId: UUID;
  name: string;
  classification: EventClassification;
  recordingMode: ParticipationRecordingMode;
  defaultPoints: number;
  defaultCategoryCode: AchievementCategoryCode | null;
  icon?: string;
  color?: string;
  userId: UUID;
  deviceId: UUID;
}

export interface ReorderEventTypesParams {
  classSectionId: UUID;
  eventTypeIdA: UUID;
  expectedVersionA: number;
  eventTypeIdB: UUID;
  expectedVersionB: number;
  userId: UUID;
  deviceId: UUID;
}

export interface ArchiveEventTypeParams {
  eventTypeId: UUID;
  expectedVersion: number;
  classSectionId: UUID;
  userId: UUID;
  deviceId: UUID;
}

export interface RestoreEventTypeParams {
  eventTypeId: UUID;
  expectedVersion: number;
  classSectionId: UUID;
  userId: UUID;
  deviceId: UUID;
}

export class ParticipationEventTypeService {
  constructor(private db: OntarioTeacherDB) {}

  /**
   * Scoped read query resolving visible event types for a given class section:
   * 1. Resolves classSection -> course -> organizationId.
   * 2. Reads organization-owned types via indexed lookup.
   * 3. Reads readable global presets using a filtered collection (avoiding indexed null lookup).
   * 4. Excludes types from other organizations and soft-deleted records.
   * 5. Excludes archived types when includeArchived === false (e.g. for Participation Dock).
   * 6. Deterministic sort within each classification: global presets first, then sortOrder, then name.
   */
  async listEventTypesForSection(classSectionId?: UUID | null, includeArchived = false): Promise<ParticipationEventType[]> {
    if (!classSectionId) {
      const globalPresets = await this.db.participationEventTypes
        .toCollection()
        .filter(t => t.organizationId === null && t.deletedAt === null && (includeArchived || !t.isArchived))
        .toArray();

      const classOrder: Record<EventClassification, number> = { positive: 1, neutral: 2, needs_followup: 3 };
      globalPresets.sort((a, b) => {
        if (a.classification !== b.classification) {
          return classOrder[a.classification] - classOrder[b.classification];
        }
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.name.localeCompare(b.name);
      });
      return globalPresets;
    }

    const section = await this.db.classSections.get(classSectionId);
    if (!section || section.deletedAt !== null) return [];

    const course = await this.db.courses.get(section.courseId);
    if (!course || course.deletedAt !== null) return [];

    const orgId = course.organizationId;

    // 1. Org-owned types through index
    const orgTypes = await this.db.participationEventTypes
      .where('organizationId')
      .equals(orgId)
      .filter(t => t.deletedAt === null && (includeArchived || !t.isArchived))
      .toArray();

    // 2. Global presets through filtered collection (avoiding .where('organizationId').equals(null))
    const globalPresets = await this.db.participationEventTypes
      .toCollection()
      .filter(t => t.organizationId === null && t.deletedAt === null && (includeArchived || !t.isArchived))
      .toArray();

    const combined = [...globalPresets, ...orgTypes];

    // Deterministic sort: classification group, global first, sortOrder, name
    const classOrder: Record<EventClassification, number> = { positive: 1, neutral: 2, needs_followup: 3 };
    combined.sort((a, b) => {
      if (a.classification !== b.classification) {
        return classOrder[a.classification] - classOrder[b.classification];
      }
      const aGlobal = a.organizationId === null ? 0 : 1;
      const bGlobal = b.organizationId === null ? 0 : 1;
      if (aGlobal !== bGlobal) return aGlobal - bGlobal;
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.name.localeCompare(b.name);
    });

    return combined;
  }

  /**
   * Helper to check for duplicate active names in the organization (including visible active globals).
   */
  private async assertUniqueActiveName(orgId: UUID, name: string, excludeId?: UUID): Promise<void> {
    const trimmed = name.trim().toLowerCase();
    const visibleTypes = await this.db.participationEventTypes
      .toCollection()
      .filter(t => (t.organizationId === orgId || t.organizationId === null) && t.deletedAt === null && !t.isArchived)
      .toArray();

    const duplicate = visibleTypes.find(t => t.id !== excludeId && t.name.trim().toLowerCase() === trimmed);
    if (duplicate) {
      throw new ValidationError(`A participation button named "${name.trim()}" already exists in this workspace.`);
    }
  }

  /**
   * Helper to compute next sortOrder within a classification group for an organization.
   */
  private async getNextSortOrder(orgId: UUID, classification: EventClassification): Promise<number> {
    const groupTypes = await this.db.participationEventTypes
      .where('organizationId')
      .equals(orgId)
      .filter(t => t.deletedAt === null && !t.isArchived && t.classification === classification)
      .toArray();

    let maxOrder = 0;
    for (const t of groupTypes) {
      if (t.sortOrder > maxOrder) maxOrder = t.sortOrder;
    }
    return maxOrder + 1;
  }

  /**
   * Creates a new organization-owned participation event type transactionally.
   */
  async createEventType(params: CreateEventTypeParams): Promise<ParticipationEventType> {
    const trimmedName = params.name.trim();
    if (!trimmedName || trimmedName.length > 60) {
      throw new ValidationError('Button name must be between 1 and 60 characters.');
    }

    if (params.recordingMode === 'level_1_4' && params.defaultPoints !== 0) {
      params.defaultPoints = 0.0;
    }
    if (params.recordingMode === 'quick_tally' && !Number.isFinite(params.defaultPoints)) {
      throw new ValidationError('Quick Tally default points must be a finite number.');
    }

    return await this.db.transaction(
      'rw',
      [
        ...AUTH_TABLES(this.db),
        this.db.participationEventTypes,
        this.db.auditEntries,
        this.db.syncMutations
      ],
      async () => {
        const auth = await assertClassSectionWriteAccess(this.db, params.userId, params.classSectionId);
        const orgId = auth.organizationId;

        await this.assertUniqueActiveName(orgId, trimmedName);

        const nextSort = await this.getNextSortOrder(orgId, params.classification);
        const now = new Date().toISOString();
        const txId = crypto.randomUUID();
        const newId = crypto.randomUUID();
        const immutableCode = 'ET_' + crypto.randomUUID().replace(/-/g, '').toUpperCase();

        const eventType: ParticipationEventType = {
          id: newId,
          organizationId: orgId,
          name: trimmedName,
          code: immutableCode,
          icon: params.icon || (params.classification === 'positive' ? 'Sparkles' : params.classification === 'neutral' ? 'FileText' : 'AlertTriangle'),
          color: params.color || (params.classification === 'positive' ? '#10b981' : params.classification === 'neutral' ? '#64748b' : '#f59e0b'),
          classification: params.classification,
          defaultPoints: params.recordingMode === 'level_1_4' ? 0.0 : params.defaultPoints,
          isArchived: false,
          recordingMode: params.recordingMode,
          defaultCategoryCode: params.defaultCategoryCode ?? null,
          sortOrder: nextSort,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          version: 1
        };

        const audit: AuditEntry = {
          id: crypto.randomUUID(),
          entityName: 'participationEventTypes',
          entityId: newId,
          action: 'INSERT',
          transactionId: txId,
          previousStateJson: null,
          newStateJson: JSON.stringify(eventType),
          diffJson: JSON.stringify({ created: eventType }),
          userId: params.userId,
          timestamp: now,
          clientVersion: '1.0.0'
        };

        const sync: SyncMutation = {
          id: crypto.randomUUID(),
          deviceId: params.deviceId,
          organizationId: orgId,
          mutationId: crypto.randomUUID(),
          transactionId: txId,
          sequenceNumber: 1,
          transactionSize: 1,
          entityName: 'participationEventTypes',
          entityId: newId,
          operation: 'INSERT',
          payloadJson: JSON.stringify(eventType),
          baseVersion: 0,
          status: 'pending',
          createdAt: now,
          attemptCount: 0,
          lastAttemptAt: null,
          lastError: null,
          acknowledgedAt: null
        };

        await Promise.all([
          this.db.participationEventTypes.add(eventType),
          this.db.auditEntries.add(audit),
          this.db.syncMutations.add(sync)
        ]);

        return eventType;
      }
    );
  }

  /**
   * Updates an existing event type with optimistic concurrency.
   */
  async updateEventType(params: UpdateEventTypeParams): Promise<ParticipationEventType> {
    const trimmedName = params.name.trim();
    if (!trimmedName || trimmedName.length > 60) {
      throw new ValidationError('Button name must be between 1 and 60 characters.');
    }

    return await this.db.transaction(
      'rw',
      [
        ...AUTH_TABLES(this.db),
        this.db.participationEventTypes,
        this.db.auditEntries,
        this.db.syncMutations
      ],
      async () => {
        const auth = await assertClassSectionWriteAccess(this.db, params.userId, params.classSectionId);
        const orgId = auth.organizationId;

        const current = await this.db.participationEventTypes.get(params.eventTypeId);
        if (!current || current.deletedAt !== null) {
          throw new ValidationError(`Participation button ${params.eventTypeId} not found.`);
        }

        if (current.organizationId === null) {
          throw new ValidationError('Global preset event types are read-only and cannot be modified.');
        }

        if (current.organizationId !== orgId) {
          throw new ValidationError('Cannot modify an event type belonging to another organization.');
        }

        if (current.version !== params.expectedVersion) {
          throw new ConcurrencyError(
            `Stale version for button ${current.name}. Expected ${params.expectedVersion}, found ${current.version}.`
          );
        }

        await this.assertUniqueActiveName(orgId, trimmedName, current.id);

        const now = new Date().toISOString();
        const txId = crypto.randomUUID();

        // If classification changed, append to end of new classification group
        let nextSort = current.sortOrder;
        if (current.classification !== params.classification) {
          nextSort = await this.getNextSortOrder(orgId, params.classification);
        }

        const effectivePoints = params.recordingMode === 'level_1_4' ? 0.0 : params.defaultPoints;

        const updated: ParticipationEventType = {
          ...current,
          name: trimmedName,
          classification: params.classification,
          recordingMode: params.recordingMode,
          defaultPoints: effectivePoints,
          defaultCategoryCode: params.defaultCategoryCode ?? null,
          icon: params.icon || current.icon,
          color: params.color || current.color,
          sortOrder: nextSort,
          updatedAt: now,
          version: current.version + 1
        };

        const audit: AuditEntry = {
          id: crypto.randomUUID(),
          entityName: 'participationEventTypes',
          entityId: current.id,
          action: 'UPDATE',
          transactionId: txId,
          previousStateJson: JSON.stringify(current),
          newStateJson: JSON.stringify(updated),
          diffJson: JSON.stringify({
            name: { old: current.name, new: updated.name },
            classification: { old: current.classification, new: updated.classification },
            recordingMode: { old: current.recordingMode, new: updated.recordingMode },
            defaultPoints: { old: current.defaultPoints, new: updated.defaultPoints },
            defaultCategoryCode: { old: current.defaultCategoryCode, new: updated.defaultCategoryCode }
          }),
          userId: params.userId,
          timestamp: now,
          clientVersion: '1.0.0'
        };

        const sync: SyncMutation = {
          id: crypto.randomUUID(),
          deviceId: params.deviceId,
          organizationId: orgId,
          mutationId: crypto.randomUUID(),
          transactionId: txId,
          sequenceNumber: 1,
          transactionSize: 1,
          entityName: 'participationEventTypes',
          entityId: current.id,
          operation: 'UPDATE',
          payloadJson: JSON.stringify(updated),
          baseVersion: current.version,
          status: 'pending',
          createdAt: now,
          attemptCount: 0,
          lastAttemptAt: null,
          lastError: null,
          acknowledgedAt: null
        };

        await Promise.all([
          this.db.participationEventTypes.put(updated),
          this.db.auditEntries.add(audit),
          this.db.syncMutations.add(sync)
        ]);

        return updated;
      }
    );
  }

  /**
   * Swaps the sortOrder of two adjacent organization-owned buttons within the same classification group.
   * Emits 2 AuditEntry records and 2 SyncMutation records with shared transactionId and transactionSize: 2.
   */
  async reorderEventTypes(params: ReorderEventTypesParams): Promise<void> {
    return await this.db.transaction(
      'rw',
      [
        ...AUTH_TABLES(this.db),
        this.db.participationEventTypes,
        this.db.auditEntries,
        this.db.syncMutations
      ],
      async () => {
        const auth = await assertClassSectionWriteAccess(this.db, params.userId, params.classSectionId);
        const orgId = auth.organizationId;

        const [itemA, itemB] = await Promise.all([
          this.db.participationEventTypes.get(params.eventTypeIdA),
          this.db.participationEventTypes.get(params.eventTypeIdB)
        ]);

        if (!itemA || itemA.deletedAt !== null || !itemB || itemB.deletedAt !== null) {
          throw new ValidationError('One or both event types to reorder were not found.');
        }

        if (itemA.organizationId === null || itemB.organizationId === null) {
          throw new ValidationError('Global preset event types cannot be reordered.');
        }

        if (itemA.organizationId !== orgId || itemB.organizationId !== orgId) {
          throw new ValidationError('Cannot reorder event types belonging to another organization.');
        }

        if (itemA.classification !== itemB.classification) {
          throw new ValidationError('Move Up / Down can only operate within the same classification group.');
        }

        if (itemA.version !== params.expectedVersionA) {
          throw new ConcurrencyError(`Stale version for button ${itemA.name}.`);
        }
        if (itemB.version !== params.expectedVersionB) {
          throw new ConcurrencyError(`Stale version for button ${itemB.name}.`);
        }

        const now = new Date().toISOString();
        const txId = crypto.randomUUID();

        const updatedA: ParticipationEventType = {
          ...itemA,
          sortOrder: itemB.sortOrder,
          updatedAt: now,
          version: itemA.version + 1
        };

        const updatedB: ParticipationEventType = {
          ...itemB,
          sortOrder: itemA.sortOrder,
          updatedAt: now,
          version: itemB.version + 1
        };

        const auditA: AuditEntry = {
          id: crypto.randomUUID(),
          entityName: 'participationEventTypes',
          entityId: itemA.id,
          action: 'UPDATE',
          transactionId: txId,
          previousStateJson: JSON.stringify(itemA),
          newStateJson: JSON.stringify(updatedA),
          diffJson: JSON.stringify({ sortOrder: { old: itemA.sortOrder, new: updatedA.sortOrder } }),
          userId: params.userId,
          timestamp: now,
          clientVersion: '1.0.0'
        };

        const auditB: AuditEntry = {
          id: crypto.randomUUID(),
          entityName: 'participationEventTypes',
          entityId: itemB.id,
          action: 'UPDATE',
          transactionId: txId,
          previousStateJson: JSON.stringify(itemB),
          newStateJson: JSON.stringify(updatedB),
          diffJson: JSON.stringify({ sortOrder: { old: itemB.sortOrder, new: updatedB.sortOrder } }),
          userId: params.userId,
          timestamp: now,
          clientVersion: '1.0.0'
        };

        const syncA: SyncMutation = {
          id: crypto.randomUUID(),
          deviceId: params.deviceId,
          organizationId: orgId,
          mutationId: crypto.randomUUID(),
          transactionId: txId,
          sequenceNumber: 1,
          transactionSize: 2,
          entityName: 'participationEventTypes',
          entityId: itemA.id,
          operation: 'UPDATE',
          payloadJson: JSON.stringify(updatedA),
          baseVersion: itemA.version,
          status: 'pending',
          createdAt: now,
          attemptCount: 0,
          lastAttemptAt: null,
          lastError: null,
          acknowledgedAt: null
        };

        const syncB: SyncMutation = {
          id: crypto.randomUUID(),
          deviceId: params.deviceId,
          organizationId: orgId,
          mutationId: crypto.randomUUID(),
          transactionId: txId,
          sequenceNumber: 2,
          transactionSize: 2,
          entityName: 'participationEventTypes',
          entityId: itemB.id,
          operation: 'UPDATE',
          payloadJson: JSON.stringify(updatedB),
          baseVersion: itemB.version,
          status: 'pending',
          createdAt: now,
          attemptCount: 0,
          lastAttemptAt: null,
          lastError: null,
          acknowledgedAt: null
        };

        await Promise.all([
          this.db.participationEventTypes.put(updatedA),
          this.db.participationEventTypes.put(updatedB),
          this.db.auditEntries.add(auditA),
          this.db.auditEntries.add(auditB),
          this.db.syncMutations.add(syncA),
          this.db.syncMutations.add(syncB)
        ]);
      }
    );
  }

  /**
   * Helper to move an event type up or down within its classification group.
   * Finds the adjacent organization-owned item in the same classification group and reorders them.
   */
  async moveEventType(
    classSectionId: UUID,
    eventTypeId: UUID,
    direction: 'up' | 'down',
    userId: UUID,
    deviceId: UUID
  ): Promise<void> {
    const section = await this.db.classSections.get(classSectionId);
    if (!section || section.deletedAt !== null) {
      throw new ValidationError(`Class section ${classSectionId} not found.`);
    }
    const course = await this.db.courses.get(section.courseId);
    if (!course || course.deletedAt !== null) {
      throw new ValidationError(`Course ${section.courseId} not found.`);
    }
    const orgId = course.organizationId;

    const target = await this.db.participationEventTypes.get(eventTypeId);
    if (!target || target.deletedAt !== null) {
      throw new ValidationError(`Participation button ${eventTypeId} not found.`);
    }
    if (target.organizationId === null) {
      throw new ValidationError('Global preset event types cannot be reordered.');
    }
    if (target.organizationId !== orgId) {
      throw new ValidationError('Cannot reorder an event type belonging to another organization.');
    }

    // Get all active organization-owned types in the same classification group, sorted by sortOrder
    const groupTypes = await this.db.participationEventTypes
      .where('organizationId')
      .equals(orgId)
      .filter(t => t.deletedAt === null && !t.isArchived && t.classification === target.classification)
      .sortBy('sortOrder');

    const index = groupTypes.findIndex(t => t.id === target.id);
    if (index === -1) return;

    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= groupTypes.length) {
      return; // Already at boundary
    }

    const partner = groupTypes[targetIndex];
    await this.reorderEventTypes({
      classSectionId,
      eventTypeIdA: target.id,
      expectedVersionA: target.version,
      eventTypeIdB: partner.id,
      expectedVersionB: partner.version,
      userId,
      deviceId
    });
  }

  /**
   * Archives an event type. Existing historical events remain unaffected.
   */
  async archiveEventType(
    paramsOrId: ArchiveEventTypeParams | UUID,
    expectedVersion?: number,
    classSectionId?: UUID,
    userId?: UUID,
    deviceId?: UUID
  ): Promise<ParticipationEventType> {
    const params: ArchiveEventTypeParams =
      typeof paramsOrId === 'object'
        ? paramsOrId
        : {
            eventTypeId: paramsOrId,
            expectedVersion: expectedVersion!,
            classSectionId: classSectionId!,
            userId: userId!,
            deviceId: deviceId!
          };

    return await this.db.transaction(
      'rw',
      [
        ...AUTH_TABLES(this.db),
        this.db.participationEventTypes,
        this.db.auditEntries,
        this.db.syncMutations
      ],
      async () => {
        const auth = await assertClassSectionWriteAccess(this.db, params.userId, params.classSectionId);
        const orgId = auth.organizationId;

        const current = await this.db.participationEventTypes.get(params.eventTypeId);
        if (!current || current.deletedAt !== null) {
          throw new ValidationError(`Participation button ${params.eventTypeId} not found.`);
        }

        if (current.organizationId === null) {
          throw new ValidationError('Global preset event types cannot be archived.');
        }

        if (current.organizationId !== orgId) {
          throw new ValidationError('Cannot archive an event type belonging to another organization.');
        }

        if (current.version !== params.expectedVersion) {
          throw new ConcurrencyError(`Stale version for button ${current.name}.`);
        }

        const now = new Date().toISOString();
        const txId = crypto.randomUUID();

        const updated: ParticipationEventType = {
          ...current,
          isArchived: true,
          updatedAt: now,
          version: current.version + 1
        };

        const audit: AuditEntry = {
          id: crypto.randomUUID(),
          entityName: 'participationEventTypes',
          entityId: current.id,
          action: 'UPDATE',
          transactionId: txId,
          previousStateJson: JSON.stringify(current),
          newStateJson: JSON.stringify(updated),
          diffJson: JSON.stringify({ isArchived: { old: false, new: true } }),
          userId: params.userId,
          timestamp: now,
          clientVersion: '1.0.0'
        };

        const sync: SyncMutation = {
          id: crypto.randomUUID(),
          deviceId: params.deviceId,
          organizationId: orgId,
          mutationId: crypto.randomUUID(),
          transactionId: txId,
          sequenceNumber: 1,
          transactionSize: 1,
          entityName: 'participationEventTypes',
          entityId: current.id,
          operation: 'UPDATE',
          payloadJson: JSON.stringify(updated),
          baseVersion: current.version,
          status: 'pending',
          createdAt: now,
          attemptCount: 0,
          lastAttemptAt: null,
          lastError: null,
          acknowledgedAt: null
        };

        await Promise.all([
          this.db.participationEventTypes.put(updated),
          this.db.auditEntries.add(audit),
          this.db.syncMutations.add(sync)
        ]);

        return updated;
      }
    );
  }

  /**
   * Restores an archived event type. Appends to the end of its classification group to prevent sort collisions.
   */
  async restoreEventType(
    paramsOrId: RestoreEventTypeParams | UUID,
    expectedVersion?: number,
    classSectionId?: UUID,
    userId?: UUID,
    deviceId?: UUID
  ): Promise<ParticipationEventType> {
    const params: RestoreEventTypeParams =
      typeof paramsOrId === 'object'
        ? paramsOrId
        : {
            eventTypeId: paramsOrId,
            expectedVersion: expectedVersion!,
            classSectionId: classSectionId!,
            userId: userId!,
            deviceId: deviceId!
          };

    return await this.db.transaction(
      'rw',
      [
        ...AUTH_TABLES(this.db),
        this.db.participationEventTypes,
        this.db.auditEntries,
        this.db.syncMutations
      ],
      async () => {
        const auth = await assertClassSectionWriteAccess(this.db, params.userId, params.classSectionId);
        const orgId = auth.organizationId;

        const current = await this.db.participationEventTypes.get(params.eventTypeId);
        if (!current || current.deletedAt !== null) {
          throw new ValidationError(`Participation button ${params.eventTypeId} not found.`);
        }

        if (current.organizationId === null) {
          throw new ValidationError('Global preset event types cannot be modified.');
        }

        if (current.organizationId !== orgId) {
          throw new ValidationError('Cannot restore an event type belonging to another organization.');
        }

        if (current.version !== params.expectedVersion) {
          throw new ConcurrencyError(`Stale version for button ${current.name}.`);
        }

        await this.assertUniqueActiveName(orgId, current.name, current.id);

        const nextSort = await this.getNextSortOrder(orgId, current.classification);
        const now = new Date().toISOString();
        const txId = crypto.randomUUID();

        const updated: ParticipationEventType = {
          ...current,
          isArchived: false,
          sortOrder: nextSort,
          updatedAt: now,
          version: current.version + 1
        };

        const audit: AuditEntry = {
          id: crypto.randomUUID(),
          entityName: 'participationEventTypes',
          entityId: current.id,
          action: 'UPDATE',
          transactionId: txId,
          previousStateJson: JSON.stringify(current),
          newStateJson: JSON.stringify(updated),
          diffJson: JSON.stringify({
            isArchived: { old: true, new: false },
            sortOrder: { old: current.sortOrder, new: nextSort }
          }),
          userId: params.userId,
          timestamp: now,
          clientVersion: '1.0.0'
        };

        const sync: SyncMutation = {
          id: crypto.randomUUID(),
          deviceId: params.deviceId,
          organizationId: orgId,
          mutationId: crypto.randomUUID(),
          transactionId: txId,
          sequenceNumber: 1,
          transactionSize: 1,
          entityName: 'participationEventTypes',
          entityId: current.id,
          operation: 'UPDATE',
          payloadJson: JSON.stringify(updated),
          baseVersion: current.version,
          status: 'pending',
          createdAt: now,
          attemptCount: 0,
          lastAttemptAt: null,
          lastError: null,
          acknowledgedAt: null
        };

        await Promise.all([
          this.db.participationEventTypes.put(updated),
          this.db.auditEntries.add(audit),
          this.db.syncMutations.add(sync)
        ]);

        return updated;
      }
    );
  }
}
