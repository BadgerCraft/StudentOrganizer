import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { ParticipationEventTypeService } from './eventTypeService';
import { ValidationError } from './markbookService';
import type { ParticipationEventType } from '../types/schema';

describe('ParticipationEventTypeService Suite', () => {
  let db: OntarioTeacherDB;
  let service: ParticipationEventTypeService;

  beforeEach(async () => {
    db = new OntarioTeacherDB(`event-type-test-${crypto.randomUUID()}`);
    await seedDatabase(db);
    service = new ParticipationEventTypeService(db);
  });

  describe('Scoped Reads and Global Presets', () => {
    it('returns global presets via filtered collection without indexed null errors', async () => {
      const globalId = crypto.randomUUID();
      const globalPreset: ParticipationEventType = {
        id: globalId,
        organizationId: null,
        name: 'Global Questioning',
        code: 'GLOBAL_QUESTION',
        icon: 'HelpCircle',
        color: '#3b82f6',
        classification: 'positive',
        defaultPoints: 1.0,
        isArchived: false,
        recordingMode: 'quick_tally',
        defaultCategoryCode: 'T',
        sortOrder: 99,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null,
        version: 1
      };
      await db.participationEventTypes.add(globalPreset);

      const section = await db.classSections.toCollection().first();
      expect(section).toBeDefined();

      const types = await service.listEventTypesForSection(section!.id, false);
      const foundGlobal = types.find(t => t.id === globalId);
      expect(foundGlobal).toBeDefined();
      expect(foundGlobal!.organizationId).toBeNull();
      expect(foundGlobal!.name).toBe('Global Questioning');
    });

    it('returns global presets even when classSectionId is null or undefined', async () => {
      const globalId = crypto.randomUUID();
      await db.participationEventTypes.add({
        id: globalId,
        organizationId: null,
        name: 'Global Free Preset',
        code: 'GLOBAL_FREE',
        icon: 'HelpCircle',
        color: '#3b82f6',
        classification: 'positive',
        defaultPoints: 1.0,
        isArchived: false,
        recordingMode: 'quick_tally',
        defaultCategoryCode: 'T',
        sortOrder: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null,
        version: 1
      });

      const types = await service.listEventTypesForSection(null, false);
      expect(types.length).toBeGreaterThanOrEqual(1);
      const found = types.find(t => t.id === globalId);
      expect(found).toBeDefined();
    });

    it('excludes archived buttons when includeArchived is false, and includes them when true', async () => {
      const section = await db.classSections.toCollection().first();
      const course = await db.courses.get(section!.courseId);

      const archivedId = crypto.randomUUID();
      await db.participationEventTypes.add({
        id: archivedId,
        organizationId: course!.organizationId,
        name: 'Archived Button',
        code: 'ARCHIVED_BTN',
        icon: 'Archive',
        color: '#64748b',
        classification: 'positive',
        defaultPoints: 1.0,
        isArchived: true,
        recordingMode: 'quick_tally',
        defaultCategoryCode: null,
        sortOrder: 50,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null,
        version: 1
      });

      const activeOnly = await service.listEventTypesForSection(section!.id, false);
      expect(activeOnly.find(t => t.id === archivedId)).toBeUndefined();

      const withArchived = await service.listEventTypesForSection(section!.id, true);
      expect(withArchived.find(t => t.id === archivedId)).toBeDefined();
    });

    it('orders event types deterministically: positive -> neutral -> needs_followup', async () => {
      const section = await db.classSections.toCollection().first();
      const types = await service.listEventTypesForSection(section!.id, false);

      const classOrder: Record<string, number> = { positive: 1, neutral: 2, needs_followup: 3 };
      for (let i = 0; i < types.length - 1; i++) {
        const curr = types[i];
        const next = types[i + 1];
        if (curr.classification !== next.classification) {
          expect(classOrder[curr.classification]).toBeLessThanOrEqual(classOrder[next.classification]);
        }
      }
    });
  });

  describe('Creation and Validation', () => {
    it('creates a quick_tally event type with atomic audit and sync entries', async () => {
      const section = await db.classSections.toCollection().first();
      const course = await db.courses.get(section!.courseId);

      const created = await service.createEventType({
        classSectionId: section!.id,
        name: 'Critical Analysis',
        classification: 'positive',
        recordingMode: 'quick_tally',
        defaultPoints: 2.5,
        defaultCategoryCode: 'T',
        userId: 'user-tyler',
        deviceId: 'dev-desktop'
      });

      expect(created.id).toBeDefined();
      expect(created.name).toBe('Critical Analysis');
      expect(created.defaultPoints).toBe(2.5);
      expect(created.recordingMode).toBe('quick_tally');
      expect(created.defaultCategoryCode).toBe('T');
      expect(created.organizationId).toBe(course!.organizationId);

      const audit = await db.auditEntries.where('entityId').equals(created.id).first();
      expect(audit).toBeDefined();
      expect(audit!.action).toBe('INSERT');
      expect(audit!.userId).toBe('user-tyler');

      const sync = await db.syncMutations.where('entityId').equals(created.id).first();
      expect(sync).toBeDefined();
      expect(sync!.operation).toBe('INSERT');
      expect(sync!.organizationId).toBe(course!.organizationId);
    });

    it('forces defaultPoints to 0.0 when recordingMode is level_1_4', async () => {
      const section = await db.classSections.toCollection().first();

      const created = await service.createEventType({
        classSectionId: section!.id,
        name: 'Writing Conventions Check',
        classification: 'neutral',
        recordingMode: 'level_1_4',
        defaultPoints: 5.0,
        defaultCategoryCode: 'C',
        userId: 'user-tyler',
        deviceId: 'dev-desktop'
      });

      expect(created.recordingMode).toBe('level_1_4');
      expect(created.defaultPoints).toBe(0.0);
    });

    it('prevents duplicate active button names within the same workspace', async () => {
      const section = await db.classSections.toCollection().first();

      await service.createEventType({
        classSectionId: section!.id,
        name: 'Unique Assessment Note',
        classification: 'positive',
        recordingMode: 'quick_tally',
        defaultPoints: 1.0,
        defaultCategoryCode: null,
        userId: 'user-tyler',
        deviceId: 'dev-desktop'
      });

      await expect(
        service.createEventType({
          classSectionId: section!.id,
          name: '  unique assessment note  ',
          classification: 'needs_followup',
          recordingMode: 'quick_tally',
          defaultPoints: 0.0,
          defaultCategoryCode: null,
          userId: 'user-tyler',
          deviceId: 'dev-desktop'
        })
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('Immutability of Global Presets and Organization Isolation', () => {
    it('rejects updates and archiving on global presets', async () => {
      const globalId = crypto.randomUUID();
      await db.participationEventTypes.add({
        id: globalId,
        organizationId: null,
        name: 'Global Preset Unchangeable',
        code: 'GLOBAL_PRESET_TEST',
        icon: 'Flame',
        color: '#f59e0b',
        classification: 'positive',
        defaultPoints: 1.0,
        isArchived: false,
        recordingMode: 'quick_tally',
        defaultCategoryCode: null,
        sortOrder: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null,
        version: 1
      });

      const section = await db.classSections.toCollection().first();

      await expect(
        service.updateEventType({
          eventTypeId: globalId,
          expectedVersion: 1,
          classSectionId: section!.id,
          name: 'Modified Global Name',
          classification: 'positive',
          recordingMode: 'quick_tally',
          defaultPoints: 2.0,
          defaultCategoryCode: null,
          userId: 'user-tyler',
          deviceId: 'dev-desktop'
        })
      ).rejects.toThrow(ValidationError);

      await expect(
        service.archiveEventType({
          eventTypeId: globalId,
          expectedVersion: 1,
          classSectionId: section!.id,
          userId: 'user-tyler',
          deviceId: 'dev-desktop'
        })
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('Reordering within Classification Groups', () => {
    it('swaps sortOrder between two buttons in the same classification and logs 2 audit & sync records', async () => {
      const section = await db.classSections.toCollection().first();

      const btnA = await service.createEventType({
        classSectionId: section!.id,
        name: 'Button Alpha',
        classification: 'positive',
        recordingMode: 'quick_tally',
        defaultPoints: 1.0,
        defaultCategoryCode: null,
        userId: 'user-tyler',
        deviceId: 'dev-desktop'
      });

      const btnB = await service.createEventType({
        classSectionId: section!.id,
        name: 'Button Beta',
        classification: 'positive',
        recordingMode: 'quick_tally',
        defaultPoints: 2.0,
        defaultCategoryCode: null,
        userId: 'user-tyler',
        deviceId: 'dev-desktop'
      });

      const sortAOriginal = btnA.sortOrder;
      const sortBOriginal = btnB.sortOrder;

      await service.reorderEventTypes({
        classSectionId: section!.id,
        eventTypeIdA: btnA.id,
        expectedVersionA: btnA.version,
        eventTypeIdB: btnB.id,
        expectedVersionB: btnB.version,
        userId: 'user-tyler',
        deviceId: 'dev-desktop'
      });

      const updatedA = await db.participationEventTypes.get(btnA.id);
      const updatedB = await db.participationEventTypes.get(btnB.id);

      expect(updatedA!.sortOrder).toBe(sortBOriginal);
      expect(updatedB!.sortOrder).toBe(sortAOriginal);
      expect(updatedA!.version).toBe(btnA.version + 1);
      expect(updatedB!.version).toBe(btnB.version + 1);

      const syncMutations = await db.syncMutations
        .where('entityId')
        .anyOf(btnA.id, btnB.id)
        .filter(m => m.operation === 'UPDATE')
        .toArray();

      expect(syncMutations.length).toBe(2);
      expect(syncMutations[0].transactionId).toBe(syncMutations[1].transactionId);
      expect(syncMutations[0].transactionSize).toBe(2);
      expect(syncMutations[1].transactionSize).toBe(2);
    });

    it('rejects reordering buttons belonging to different classification groups', async () => {
      const section = await db.classSections.toCollection().first();

      const btnPos = await service.createEventType({
        classSectionId: section!.id,
        name: 'Positive Button X',
        classification: 'positive',
        recordingMode: 'quick_tally',
        defaultPoints: 1.0,
        defaultCategoryCode: null,
        userId: 'user-tyler',
        deviceId: 'dev-desktop'
      });

      const btnNeu = await service.createEventType({
        classSectionId: section!.id,
        name: 'Neutral Button Y',
        classification: 'neutral',
        recordingMode: 'quick_tally',
        defaultPoints: 0.0,
        defaultCategoryCode: null,
        userId: 'user-tyler',
        deviceId: 'dev-desktop'
      });

      await expect(
        service.reorderEventTypes({
          classSectionId: section!.id,
          eventTypeIdA: btnPos.id,
          expectedVersionA: btnPos.version,
          eventTypeIdB: btnNeu.id,
          expectedVersionB: btnNeu.version,
          userId: 'user-tyler',
          deviceId: 'dev-desktop'
        })
      ).rejects.toThrow('Move Up / Down can only operate within the same classification group');
    });

    it('moveEventType helper properly moves an item down and up adjacent within group', async () => {
      const section = await db.classSections.toCollection().first();

      const b1 = await service.createEventType({
        classSectionId: section!.id,
        name: 'Move 1',
        classification: 'neutral',
        recordingMode: 'quick_tally',
        defaultPoints: 0.0,
        defaultCategoryCode: null,
        userId: 'user-tyler',
        deviceId: 'dev-desktop'
      });

      const b2 = await service.createEventType({
        classSectionId: section!.id,
        name: 'Move 2',
        classification: 'neutral',
        recordingMode: 'quick_tally',
        defaultPoints: 0.0,
        defaultCategoryCode: null,
        userId: 'user-tyler',
        deviceId: 'dev-desktop'
      });

      expect(b1.sortOrder).toBeLessThan(b2.sortOrder);

      await service.moveEventType(section!.id, b1.id, 'down', 'user-tyler', 'dev-desktop');
      const b1AfterDown = await db.participationEventTypes.get(b1.id);
      const b2AfterDown = await db.participationEventTypes.get(b2.id);
      expect(b1AfterDown!.sortOrder).toBeGreaterThan(b2AfterDown!.sortOrder);

      await service.moveEventType(section!.id, b1.id, 'up', 'user-tyler', 'dev-desktop');
      const b1AfterUp = await db.participationEventTypes.get(b1.id);
      const b2AfterUp = await db.participationEventTypes.get(b2.id);
      expect(b1AfterUp!.sortOrder).toBeLessThan(b2AfterUp!.sortOrder);
    });
  });

  describe('Archiving and Restoring', () => {
    it('archives a button and restores it with appended sort order', async () => {
      const section = await db.classSections.toCollection().first();

      const btn = await service.createEventType({
        classSectionId: section!.id,
        name: 'Temporary Practice',
        classification: 'positive',
        recordingMode: 'quick_tally',
        defaultPoints: 1.0,
        defaultCategoryCode: null,
        userId: 'user-tyler',
        deviceId: 'dev-desktop'
      });
      // Archive btn
      const archived = await service.archiveEventType({
        eventTypeId: btn.id,
        expectedVersion: btn.version,
        classSectionId: section!.id,
        userId: 'user-tyler',
        deviceId: 'dev-desktop'
      });
      expect(archived.isArchived).toBe(true);

      // Create another active button while btn is archived
      const anotherBtn = await service.createEventType({
        classSectionId: section!.id,
        name: 'Another Active Button',
        classification: 'positive',
        recordingMode: 'quick_tally',
        defaultPoints: 1.0,
        defaultCategoryCode: null,
        userId: 'user-tyler',
        deviceId: 'dev-desktop'
      });

      // Restore btn - must append after anotherBtn
      const restored = await service.restoreEventType({
        eventTypeId: btn.id,
        expectedVersion: archived.version,
        classSectionId: section!.id,
        userId: 'user-tyler',
        deviceId: 'dev-desktop'
      });
      expect(restored.isArchived).toBe(false);
      expect(restored.sortOrder).toBeGreaterThan(anotherBtn.sortOrder);
    });

    it('rejects restore if an active button with the same name was created while archived', async () => {
      const section = await db.classSections.toCollection().first();

      const btn = await service.createEventType({
        classSectionId: section!.id,
        name: 'Shared Name Task',
        classification: 'positive',
        recordingMode: 'quick_tally',
        defaultPoints: 1.0,
        defaultCategoryCode: null,
        userId: 'user-tyler',
        deviceId: 'dev-desktop'
      });

      const archived = await service.archiveEventType({
        eventTypeId: btn.id,
        expectedVersion: btn.version,
        classSectionId: section!.id,
        userId: 'user-tyler',
        deviceId: 'dev-desktop'
      });

      await service.createEventType({
        classSectionId: section!.id,
        name: 'Shared Name Task',
        classification: 'positive',
        recordingMode: 'quick_tally',
        defaultPoints: 2.0,
        defaultCategoryCode: null,
        userId: 'user-tyler',
        deviceId: 'dev-desktop'
      });

      await expect(
        service.restoreEventType({
          eventTypeId: btn.id,
          expectedVersion: archived.version,
          classSectionId: section!.id,
          userId: 'user-tyler',
          deviceId: 'dev-desktop'
        })
      ).rejects.toThrow(ValidationError);
    });
  });
});
