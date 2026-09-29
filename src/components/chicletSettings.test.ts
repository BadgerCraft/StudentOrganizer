import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import {
  formatChicletTitle,
  DEFAULT_CHICLET_DISPLAY,
  type Course,
  type ClassSection,
  type UserPreference
} from '../types/schema';

describe('Chiclet Settings & Preference Merging Suite', () => {
  const dummyCourse: Course = {
    id: 'c1',
    organizationId: 'org1',
    code: 'ENG4U',
    title: 'Grade 12 English',
    department: 'English',
    gradeLevel: 12,
    creditValue: 1.0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    version: 1
  };

  const dummySection: ClassSection = {
    id: 's1',
    courseId: 'c1',
    termId: 't1',
    sectionNumber: '01',
    period: 'Period 1',
    roomNumber: 'Room 101',
    colorToken: '#2563eb',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    version: 1
  };

  describe('formatChicletTitle', () => {
    it('formats title_only as course.title ("Grade 12 English")', () => {
      const title = formatChicletTitle(dummyCourse, dummySection, 'title_only');
      expect(title).toBe('Grade 12 English');
    });

    it('formats code_only as course.code - Sec section.sectionNumber ("ENG4U - Sec 01")', () => {
      const title = formatChicletTitle(dummyCourse, dummySection, 'code_only');
      expect(title).toBe('ENG4U - Sec 01');
    });

    it('formats code_and_title as course.code - Sec section.sectionNumber: course.title ("ENG4U - Sec 01: Grade 12 English")', () => {
      const title = formatChicletTitle(dummyCourse, dummySection, 'code_and_title');
      expect(title).toBe('ENG4U - Sec 01: Grade 12 English');
    });

    it('defaults to title_only if format is undefined or omitted', () => {
      const title = formatChicletTitle(dummyCourse, dummySection);
      expect(title).toBe('Grade 12 English');
    });
  });

  describe('UserPreference Merging', () => {
    let db: OntarioTeacherDB;

    beforeEach(async () => {
      db = new OntarioTeacherDB(`pref-test-${crypto.randomUUID()}`);
      await seedDatabase(db);
    });

    it('merges chicletDisplay without overwriting unrelated preference fields', async () => {
      const existing = await db.userPreferences.toCollection().first();
      expect(existing).toBeDefined();

      const originalTheme = existing!.theme;
      const originalDensity = existing!.markbookDensity;
      const originalPhotos = existing!.seatingShowPhotos;

      // Update chiclet display settings
      const newChicletSettings = {
        primaryTitleFormat: 'code_and_title' as const,
        showRoom: false,
        showStudentCount: false
      };

      await db.userPreferences.update(existing!.id, {
        chicletDisplay: {
          ...DEFAULT_CHICLET_DISPLAY,
          ...(existing!.chicletDisplay || {}),
          ...newChicletSettings
        },
        updatedAt: new Date().toISOString()
      });

      const updated = await db.userPreferences.get(existing!.id);
      expect(updated).toBeDefined();

      // Verify chicletDisplay updated
      expect(updated!.chicletDisplay!.primaryTitleFormat).toBe('code_and_title');
      expect(updated!.chicletDisplay!.showRoom).toBe(false);
      expect(updated!.chicletDisplay!.showStudentCount).toBe(false);
      expect(updated!.chicletDisplay!.showTerm).toBe(true); // preserved from DEFAULT

      // Verify unrelated fields preserved intact
      expect(updated!.theme).toBe(originalTheme);
      expect(updated!.markbookDensity).toBe(originalDensity);
      expect(updated!.seatingShowPhotos).toBe(originalPhotos);
    });
  });
});
