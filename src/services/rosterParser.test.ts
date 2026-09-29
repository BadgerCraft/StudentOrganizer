import { describe, it, expect } from 'vitest';
import { parseRosterText, parseCombinedName, detectDelimiter } from './rosterParser';

describe('Roster Parser Suite (Teacher Spreadsheet & CSV Ingestion)', () => {
  describe('parseCombinedName', () => {
    it('correctly splits "LastName, FirstName"', () => {
      const res = parseCombinedName('Smith, Jordan');
      expect(res.error).toBeNull();
      expect(res.lastName).toBe('Smith');
      expect(res.firstName).toBe('Jordan');
    });

    it('preserves hyphens, apostrophes, and accents', () => {
      const res = parseCombinedName("O'Connor-Tremblay, Éloïse");
      expect(res.error).toBeNull();
      expect(res.lastName).toBe("O'Connor-Tremblay");
      expect(res.firstName).toBe('Éloïse');
    });

    it('flags names with 0 commas as a blocking error', () => {
      const res = parseCombinedName('Jordan Smith');
      expect(res.error).toContain('missing comma');
      expect(res.lastName).toBe('Jordan Smith');
      expect(res.firstName).toBe('');
    });

    it('flags names with multiple commas as ambiguous', () => {
      const res = parseCombinedName('Smith, Jr., Jordan');
      expect(res.error).toContain('contains multiple commas');
      expect(res.lastName).toBe('');
      expect(res.firstName).toBe('');
    });
  });

  describe('detectDelimiter', () => {
    it('detects tab delimiter when tabs are prevalent', () => {
      const text = 'Smith, Jordan\t0010981\nChen, Alex\t0010982';
      expect(detectDelimiter(text)).toBe('\t');
    });

    it('detects comma delimiter for standard CSV', () => {
      const text = '"Smith, Jordan",0010981\n"Chen, Alex",0010982';
      expect(detectDelimiter(text)).toBe(',');
    });
  });

  describe('parseRosterText Formats', () => {
    it('parses Format A: 2-column headerless tab-separated paste', () => {
      const text = `Smith, Jordan\t0010981\nChen, Alex\t0010982`;
      const result = parseRosterText(text);

      expect(result.detectedFormat).toBe('two_column_combined');
      expect(result.detectedDelimiter).toBe('\t');
      expect(result.hasHeader).toBe(false);
      expect(result.rows.length).toBe(2);
      expect(result.validRowCount).toBe(2);
      expect(result.errorRowCount).toBe(0);

      expect(result.rows[0].lastName).toBe('Smith');
      expect(result.rows[0].firstName).toBe('Jordan');
      expect(result.rows[0].studentNumber).toBe('0010981'); // Preserves leading zero

      expect(result.rows[1].lastName).toBe('Chen');
      expect(result.rows[1].firstName).toBe('Alex');
      expect(result.rows[1].studentNumber).toBe('0010982');
    });

    it('parses Format B: 2-column tab-separated with headers', () => {
      const text = `Student name\tStudent number\nSmith, Jordan\t0010981\nChen, Alex\t0010982`;
      const result = parseRosterText(text);

      expect(result.detectedFormat).toBe('two_column_combined');
      expect(result.detectedDelimiter).toBe('\t');
      expect(result.hasHeader).toBe(true);
      expect(result.rows.length).toBe(2);
      expect(result.validRowCount).toBe(2);

      expect(result.rows[0].lastName).toBe('Smith');
      expect(result.rows[0].firstName).toBe('Jordan');
      expect(result.rows[0].studentNumber).toBe('0010981');
    });

    it('parses Format C: 2-column CSV with quotes and commas', () => {
      const text = `"Student name","Student number"\n"Smith, Jordan","0010981"\n"Chen, Alex","0010982"`;
      const result = parseRosterText(text);

      expect(result.detectedFormat).toBe('two_column_combined');
      expect(result.hasHeader).toBe(true);
      expect(result.rows.length).toBe(2);
      expect(result.validRowCount).toBe(2);

      expect(result.rows[0].lastName).toBe('Smith');
      expect(result.rows[0].firstName).toBe('Jordan');
      expect(result.rows[0].studentNumber).toBe('0010981');
    });

    it('parses Format D: 3-column separate with headers', () => {
      const text = `Student ID,Last Name,First Name\n0010981,Smith,Jordan\n0010982,Chen,Alex`;
      const result = parseRosterText(text);

      expect(result.detectedFormat).toBe('three_column_separate');
      expect(result.hasHeader).toBe(true);
      expect(result.rows.length).toBe(2);
      expect(result.validRowCount).toBe(2);

      expect(result.rows[0].lastName).toBe('Smith');
      expect(result.rows[0].firstName).toBe('Jordan');
      expect(result.rows[0].studentNumber).toBe('0010981');
    });

    it('skips empty lines and trims whitespace', () => {
      const text = `

Smith, Jordan\t0010981

Chen, Alex\t0010982
      `;
      const result = parseRosterText(text);
      expect(result.rows.length).toBe(2);
      expect(result.validRowCount).toBe(2);
    });

    it('captures multi-comma name ambiguity as a row error', () => {
      const text = `Smith, Jr., Jordan\t0010981\nChen, Alex\t0010982`;
      const result = parseRosterText(text);

      expect(result.rows.length).toBe(2);
      expect(result.validRowCount).toBe(1);
      expect(result.errorRowCount).toBe(1);
      expect(result.rows[0].error).toContain('contains multiple commas');
    });

    it('captures zero-comma name as a row error', () => {
      const text = `Jordan Smith\t0010981\nChen, Alex\t0010982`;
      const result = parseRosterText(text);

      expect(result.rows.length).toBe(2);
      expect(result.validRowCount).toBe(1);
      expect(result.errorRowCount).toBe(1);
      expect(result.rows[0].error).toContain('missing comma');
    });
  });
});
