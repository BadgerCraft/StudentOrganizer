import { describe, it, expect } from 'vitest';
import { clipboardRosterText, readRosterTable, mapRosterTable, mappingError, MAX_ROSTER_CHARS, validateEditedRosterRow } from './rosterTable';

const separate = { first: 2, last: 0, number: 3, name: -1, nameOrder: 'separate' as const };
describe('Flexible fictional roster tables', () => {
  it('suggests reordered clear headers and ignores extras without changing string IDs', () => {
    const table = readRosterTable('Last Name,Homeroom,First Name,Student ID,Other\nVale,201,Ari,00017,ignored');
    expect(table.hasHeader).toBe(true);
    expect(table.mapping).toMatchObject(separate);
    expect(mapRosterTable(table, table.mapping, true)[0]).toMatchObject({ firstName: 'Ari', lastName: 'Vale', studentNumber: '00017', error: null, rowNumber: 2 });
  });
  it('never chooses between OEN and local ID or duplicate name headers', () => {
    const table = readRosterTable('First Name,Last Name,OEN,Student ID\nAri,Vale,001,002');
    expect(table.mapping.number).toBe(-1);
    expect(mappingError(table, table.mapping)).toContain('OEN');
    expect(() => mapRosterTable(table, table.mapping, true)).toThrow('Choose');
    expect(mapRosterTable(table, { ...table.mapping, number: 3 }, true)[0].studentNumber).toBe('002');
    expect(readRosterTable('First Name,First Name,Last Name,ID\nAri,Other,Vale,001').mapping.first).toBe(-1);
  });
  it('retains headerless rows and lets users map extra columns explicitly', () => {
    const table = readRosterTable('Vale,Room 2,Ari,00017,extra\nLake,Room 2,Sam,00018,more');
    expect(table.hasHeader).toBe(false);
    expect(mappingError(table, table.mapping)).not.toBeNull();
    const rows = mapRosterTable(table, separate, false);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ firstName: 'Ari', lastName: 'Vale', studentNumber: '00017' });
  });
  it('requires different mapped fields and exposes short or uncertain rows', () => {
    const table = readRosterTable('Vale,Room 2,Ari,00017\nLake,Room 2');
    expect(mappingError(table, { ...separate, first: 0 })).toContain('different');
    const rows = mapRosterTable(table, separate, false);
    expect(rows).toHaveLength(2);
    expect(rows[1].error).toBe('Missing first name.');
    expect(rows[1].rawText).toContain('Lake');
  });
  it('supports explicitly interpreted two-part names without guessing multipart identities', () => {
    const table = readRosterTable('Name,ID\nAri Vale,00017\nSam de Lake,00018');
    const rows = mapRosterTable(table, { ...table.mapping, nameOrder: 'first_last', name: 0 }, true);
    expect(rows[0]).toMatchObject({ firstName: 'Ari', lastName: 'Vale', error: null });
    expect(rows[1].error).toContain('Multipart');
    expect(validateEditedRosterRow({ ...rows[1], firstName: 'Sam', lastName: 'de Lake' }).error).toBeNull();
    expect(validateEditedRosterRow({ ...rows[0], studentNumber: '' }).error).toContain('student number');
  });
  it('keeps legacy combined TSV/CSV, quotes, embedded tabs/newlines and BOM', () => {
    for (const text of ['\uFEFFStudent Name\tStudent Number\n"Vale, Ari"\t00017', '"Student Name","Student Number"\n"Vale, Ari",00017']) {
      const table = readRosterTable(text);
      expect(mapRosterTable(table, table.mapping, table.hasHeader)[0]).toMatchObject({ firstName: 'Ari', studentNumber: '00017', error: null });
    }
    const table = readRosterTable('Student ID,Last Name,First Name,Note\n00017,"Va""le","Ari\tJo","line1\nline2"');
    expect(table.rows[1].cells).toEqual(['00017', 'Va"le', 'Ari\tJo', 'line1\nline2']);
    expect(mapRosterTable(table, table.mapping, true)[0].firstName).toBe('Ari\tJo');
  });
  it('rejects malformed quotes and oversized text/row/column counts before preview', () => {
    for (const text of ['"Unclosed,0001', '"Closed"oops,0001', 'un"quoted,0001']) expect(() => readRosterTable(text)).toThrow();
    expect(() => readRosterTable('x'.repeat(MAX_ROSTER_CHARS + 1))).toThrow('large');
    expect(() => readRosterTable('x\ty\n'.repeat(2001))).toThrow('rows');
    expect(() => readRosterTable(Array(101).fill('x').join('\t'))).toThrow('columns');
  });
  it('extracts HTML cell text and entities without DOM execution or resource loading', () => {
    const html = '<html><head><link href="https://invalid.example/style"></head><body><table><tr><th>First Name</th><th>Last Name</th><th>ID</th></tr><tr><td><b>Ari</b>&amp;Jo<img src="https://invalid.example/image" onerror="throw 1"><script>throw 1</script></td><td>Vale<br>Lake</td><td>00017</td></tr></table><iframe src="https://invalid.example/frame"></iframe></body></html>';
    const extracted = clipboardRosterText(html, 'wrong plain fallback');
    const table = readRosterTable(extracted.text);
    expect(table.rows[1].cells).toEqual(['Ari&Jo', 'Vale\nLake', '00017']);
    expect(extracted.notice).toContain('locally');
  });
  it('falls back to plain text only when there is no HTML table, rejecting ambiguous tables', () => {
    expect(clipboardRosterText('<b>not a table</b>', 'Vale, Ari\t00017')).toMatchObject({ text: 'Vale, Ari\t00017' });
    expect(clipboardRosterText('', 'Vale, Ari\t00017').text).toBe('Vale, Ari\t00017');
    expect(() => clipboardRosterText('<table><tr><td colspan="2">Ari</td></tr></table>', 'fallback')).toThrow('Merged');
    expect(() => clipboardRosterText('<table><tr><td>Vale, Ari</td><td>001</td></tr><tr>Uncertain row 002</tr></table>', 'fallback')).toThrow('outside');
    expect(() => clipboardRosterText('<table><tr></tr></table>', 'fallback')).toThrow('without cells');
    expect(() => clipboardRosterText('<table></table><table></table>', 'fallback')).toThrow('one table');
    expect(() => clipboardRosterText('x'.repeat(MAX_ROSTER_CHARS + 1), 'fallback')).toThrow('large');
  });
});
