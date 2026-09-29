import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { OntarioTeacherDB } from '../db/database';
import { seedDatabase } from '../db/seeds';
import { PortabilityService } from './portabilityService';
import { escapeCSVCell, formatCSVCell } from '../utils/csvUtils';
import { parseCSV } from './rosterParser';

describe('CSV Escaping and Portability Export Suite (RFC 4180)', () => {
  let db: OntarioTeacherDB;
  let portability: PortabilityService;

  beforeEach(async () => {
    db = new OntarioTeacherDB(`test-csvexport-${crypto.randomUUID()}`);
    await seedDatabase(db);
    portability = new PortabilityService(db);
  });

  describe('escapeCSVCell utility', () => {
    it('wraps simple values in double quotes', () => {
      expect(escapeCSVCell('Toronto')).toBe('"Toronto"');
      expect(escapeCSVCell(123)).toBe('"123"');
    });

    it('returns empty quotes for null and undefined', () => {
      expect(escapeCSVCell(null)).toBe('""');
      expect(escapeCSVCell(undefined)).toBe('""');
    });

    it('escapes existing double quotes by doubling them', () => {
      expect(escapeCSVCell('He said "Hello" to everyone')).toBe('"He said ""Hello"" to everyone"');
    });

    it('handles commas and newlines correctly', () => {
      expect(escapeCSVCell('Smith, Jr.')).toBe('"Smith, Jr."');
      expect(escapeCSVCell('Line 1\nLine 2')).toBe('"Line 1\nLine 2"');
      expect(escapeCSVCell('Line 1\r\nLine 2')).toBe('"Line 1\r\nLine 2"');
    });
  });

  describe('formatCSVCell utility', () => {
    it('leaves clean alphanumeric strings unquoted', () => {
      expect(formatCSVCell('Toronto')).toBe('Toronto');
      expect(formatCSVCell(123)).toBe('123');
      expect(formatCSVCell(null)).toBe('');
    });

    it('quotes strings with commas, quotes, or newlines', () => {
      expect(formatCSVCell('Smith, Jr.')).toBe('"Smith, Jr."');
      expect(formatCSVCell('A "Quote"')).toBe('"A ""Quote"""');
      expect(formatCSVCell('Line 1\nLine 2')).toBe('"Line 1\nLine 2"');
    });
  });

  describe('exportClassMarkbookCSV RFC 4180 Compliance', () => {
    it('produces RFC 4180 parseable CSV with properly escaped headers and data cells', async () => {
      const section = (await db.classSections.toCollection().first())!;
      const csv = await portability.exportClassMarkbookCSV(section.id, null);

      // Parse with strict RFC 4180 parser
      const parsed = parseCSV(csv, ',');
      expect(parsed.length).toBeGreaterThan(5);

      const header = parsed[0];
      expect(header[0]).toBe('Student ID');
      expect(header[1]).toBe('Last Name');
      expect(header[2]).toBe('First Name');
      expect(header[3]).toBe('Status');
      expect(header).toContain('Rhetorical Analysis Essay - T (100 pts)');
      expect(header.some(cell => cell.startsWith('U1-ESSAY - '))).toBe(false);

      // Verify that every student row has correct number of columns
      for (let i = 1; i < parsed.length; i++) {
        expect(parsed[i].length).toBe(header.length);
      }
    });

    it('keeps columns distinct when two assessments share a title with CSV punctuation', async () => {
      const essay = (await db.assessments.get('assess-eng-essay'))!;
      const seminar = (await db.assessments.get('assess-eng-seminar'))!;
      const repeatedTitle = 'Essay, "Identity"';
      await db.assessments.update(essay.id, { title: repeatedTitle });
      await db.assessments.update(seminar.id, { title: repeatedTitle });

      const parsed = parseCSV(await portability.exportClassMarkbookCSV(essay.classSectionId, null), ',');
      const header = parsed[0];
      expect(header).toContain(`${repeatedTitle} [${essay.code}] - T (100 pts)`);
      expect(header).toContain(`${repeatedTitle} [${seminar.code}] - C (100 pts)`);
      expect(new Set(header).size).toBe(header.length);
      for (const row of parsed.slice(1)) {
        expect(row.length).toBe(header.length);
      }
    });
  });

  describe('exportParticipationEventsCSV RFC 4180 Compliance', () => {
    it('properly escapes teacher notes containing quotes, commas, and newlines', async () => {
      const section = (await db.classSections.toCollection().first())!;
      const enrollment = (await db.classEnrollments.where('classSectionId').equals(section.id).first())!;

      // Add a participation event with quotes, commas, and newlines in note
      const now = new Date().toISOString();
      await db.participationEvents.add({
        id: crypto.randomUUID(),
        classEnrollmentId: enrollment.id,
        classSectionId: section.id,
        classSessionId: crypto.randomUUID(),
        batchId: crypto.randomUUID(),
        eventTypeId: null,
        snapshottedName: 'Complex Feedback',
        snapshottedClassification: 'positive',
        snapshottedPoints: 2.0,
        snapshottedRecordingMode: 'quick_tally',
        achievementLevel: null,
        occurredAt: now,
        localSchoolDate: '2026-09-24',
        timezone: 'America/Toronto',
        note: 'Stated: "This thesis is sound, yet needs evidence."\nFollow up tomorrow, please.',
        categoryCode: 'T',
        studentAssessmentId: null,
        createdByUserId: 'user-tyler',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        version: 1
      });

      const csv = await portability.exportParticipationEventsCSV(section.id);

      // Verify that RFC 4180 parser can parse the note back with exact quotes and newlines
      const parsed = parseCSV(csv, ',');
      const complexRow = parsed.find(r => r.some(cell => cell.includes('Complex Feedback')));
      expect(complexRow).toBeDefined();

      const noteCell = complexRow![complexRow!.length - 1];
      expect(noteCell).toContain('Stated: "This thesis is sound, yet needs evidence."');
      expect(noteCell).toContain('Follow up tomorrow, please.');
    });
  });
});
