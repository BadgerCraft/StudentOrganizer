import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import { parseCombinedName, tokenizeRFC4180, detectDelimiter, type ParsedStudentRow } from './rosterParser';

// Bound local parsing and preview work before tokenizing or constructing a syntax tree.
export const MAX_ROSTER_CHARS = 1_000_000;
export const MAX_ROSTER_ROWS = 2000;
export const MAX_ROSTER_COLUMNS = 100;
export type NameOrder = 'separate' | 'last_comma_first' | 'first_last';
export interface RosterMapping {
  first: number;
  last: number;
  name: number;
  number: number;
  nameOrder: NameOrder;
}
export interface RosterTable {
  rows: { rowNumber: number; cells: string[] }[];
  columnCount: number;
  hasHeader: boolean;
  mapping: RosterMapping;
}

function checkSize(text: string) {
  if (text.length > MAX_ROSTER_CHARS) throw new Error('Class list is too large. Limit: 1,000,000 characters. Split it into smaller lists.');
}

const headerKinds = {
  first: ['first', 'firstname', 'first name', 'given name', 'given names'],
  last: ['last', 'lastname', 'last name', 'surname', 'family name'],
  name: ['name', 'student', 'student name', 'full name', 'last name, first name'],
  number: ['id', 'local id', 'local number', 'studentid', 'studentnumber', 'student id', 'local student id', 'student number', 'student num', 'student no', 'student #', 'oen', 'oen number', 'oen #', 'ontario education number', 'local student number'],
};
const normalizeHeader = (text: string) => text.toLowerCase().trim().replace(/[_\s]+/g, ' ').replace(/\.$/, '');

/** Suggestions only. Duplicate ID/name headers deliberately remain unmapped. */
export function readRosterTable(text: string): RosterTable {
  checkSize(text);
  const rows = tokenizeRFC4180(text, detectDelimiter(text), { maxRows: MAX_ROSTER_ROWS, maxColumns: MAX_ROSTER_COLUMNS })
    .map((cells, i) => ({ rowNumber: i + 1, cells }))
    .filter(row => row.cells.some(Boolean));
  if (rows.length > MAX_ROSTER_ROWS) throw new Error('Too many rows. Limit: 2,000 rows including the header.');
  const columnCount = Math.max(0, ...rows.map(row => row.cells.length));
  if (columnCount > MAX_ROSTER_COLUMNS) throw new Error('Too many columns. Limit: 100.');
  const headers = rows[0]?.cells.map(normalizeHeader) ?? [];
  const matches = (kind: keyof typeof headerKinds) => headers.flatMap((cell, i) => headerKinds[kind].includes(cell) ? [i] : []);
  const unique = (kind: keyof typeof headerKinds) => matches(kind).length === 1 ? matches(kind)[0] : -1;
  const hasHeader = matches('number').length > 0 && (matches('first').length + matches('last').length + matches('name').length > 0);
  const mapping: RosterMapping = { first: -1, last: -1, name: -1, number: -1, nameOrder: 'separate' };
  if (hasHeader) {
    mapping.first = unique('first');
    mapping.last = unique('last');
    mapping.number = unique('number');
    mapping.name = unique('name');
    // Preserve the legacy Student Name format; generic Name/Full Name needs an explicit interpretation.
    if (mapping.first === -1 && mapping.last === -1 && ['student', 'student name', 'last name, first name'].includes(headers[mapping.name])) mapping.nameOrder = 'last_comma_first';
  } else if (columnCount === 2) {
    // Preserve the longstanding headerless Last, First + number format.
    mapping.name = 0;
    mapping.number = 1;
    mapping.nameOrder = 'last_comma_first';
  }
  return { rows, columnCount, hasHeader, mapping };
}

export function mappingError(table: RosterTable, mapping: RosterMapping): string | null {
  const selected = mapping.nameOrder === 'separate'
    ? [mapping.first, mapping.last, mapping.number] : [mapping.name, mapping.number];
  if (selected.some(i => i < 0 || i >= table.columnCount)) return 'Choose each required column. If both OEN and local ID are present, choose which student number to use.';
  if (new Set(selected).size !== selected.length) return 'Use a different column for each field.';
  return null;
}

export function validateEditedRosterRow(row: ParsedStudentRow): ParsedStudentRow {
  return { ...row, error: !row.firstName.trim() ? 'Missing first name.' : !row.lastName.trim() ? 'Missing last name.' : !row.studentNumber.trim() ? 'Missing student number.' : null, warning: null };
}

export function mapRosterTable(table: RosterTable, mapping: RosterMapping, hasHeader: boolean): ParsedStudentRow[] {
  const error = mappingError(table, mapping);
  if (error) throw new Error(error);
  return table.rows.slice(hasHeader ? 1 : 0).map(({ rowNumber, cells }) => {
    const get = (index: number) => cells[index]?.trim() ?? '';
    let firstName = get(mapping.first);
    let lastName = get(mapping.last);
    let nameError: string | null = null;
    if (mapping.nameOrder === 'last_comma_first') {
      ({ firstName, lastName, error: nameError } = parseCombinedName(get(mapping.name)));
    } else if (mapping.nameOrder === 'first_last') {
      const parts = get(mapping.name).split(/\s+/);
      if (parts.length !== 2 || !parts[0]) {
        firstName = ''; lastName = '';
        nameError = 'Multipart or missing name: enter first and last names explicitly in the preview.';
      } else [firstName, lastName] = parts;
    }
    const row = validateEditedRosterRow({ rowNumber, rawText: cells.join('\t'), firstName, lastName, studentNumber: get(mapping.number), error: null, warning: null });
    return { ...row, error: nameError || row.error };
  });
}

// parse5 builds plain JS nodes. It creates no DOM, executes no markup, and has no
// resource loader. Never insert clipboard HTML into the browser document.
export function clipboardRosterText(html: string, plainText: string): { text: string; notice: string } {
  checkSize(html); checkSize(plainText);
  if (!html.trim()) return { text: plainText, notice: 'Using pasted TSV/CSV text.' };
  const document = parse(html, { sourceCodeLocationInfo: true });
  type Node = DefaultTreeAdapterTypes.Node;
  type Element = DefaultTreeAdapterTypes.Element;
  const isElement = (node: Node): node is Element => 'tagName' in node;
  const children = (node: Node): Node[] => 'childNodes' in node ? node.childNodes : [];
  const find = (root: Node, tag: string): Element[] => {
    const found: Element[] = [];
    const pending: Node[] = [root];
    while (pending.length) {
      const node = pending.pop()!;
      if (isElement(node) && node.tagName === tag) found.push(node);
      pending.push(...children(node).slice().reverse());
    }
    return found;
  };
  const tables = find(document, 'table');
  if (!tables.length) return { text: plainText, notice: 'No HTML table found; using pasted TSV/CSV text.' };
  if (tables.length !== 1) throw new Error('Copy one table at a time. Multiple or nested tables need separate review.');
  // HTML error recovery can move text out of a table. Reject such content instead
  // of losing an uncertain row during extraction (including cell-less rows).
  const location = tables[0].sourceCodeLocation;
  const pending: { node: Node; inCell: boolean }[] = [{ node: document, inCell: false }];
  while (pending.length) {
    const { node, inCell } = pending.pop()!;
    const offset = node.sourceCodeLocation?.startOffset;
    if ('value' in node && node.value.trim() && !inCell && offset !== undefined && location && offset >= location.startOffset && offset < location.endOffset) {
      throw new Error('Table contains text outside its cells. No rows imported. Copy a regular table or paste TSV/CSV text.');
    }
    const childInCell = inCell || (isElement(node) && ['td', 'th'].includes(node.tagName));
    pending.push(...children(node).map(child => ({ node: child, inCell: childInCell })));
  }
  const textOf = (root: Node): string => {
    const parts: string[] = [];
    const pending: Node[] = [root];
    while (pending.length) {
      const node = pending.pop()!;
      if (isElement(node) && ['script', 'style', 'template', 'svg', 'math', 'iframe', 'object'].includes(node.tagName)) continue;
      if ('value' in node) parts.push(node.value);
      else if (isElement(node) && node.tagName === 'br') parts.push('\n');
      else pending.push(...children(node).slice().reverse());
    }
    return parts.join('');
  };
  const rows = find(tables[0], 'tr').map(row => {
    const cells = children(row).filter((node): node is Element => isElement(node) && ['td', 'th'].includes(node.tagName));
    if (!cells.length) throw new Error('Table has a row without cells. Copy a regular table or paste TSV/CSV text.');
    return cells.map(cell => {
      if (cell.attrs.some(attr => ['rowspan', 'colspan'].includes(attr.name) && attr.value !== '1')) {
        throw new Error('Merged table cells are ambiguous. Copy an unmerged table or paste TSV/CSV text.');
      }
      return textOf(cell).trim();
    });
  });
  if (rows.length > MAX_ROSTER_ROWS || rows.some(row => row.length > MAX_ROSTER_COLUMNS)) throw new Error('Table exceeds 2,000 rows or 100 columns. Copy a smaller table.');
  const text = rows.map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join('\t')).join('\n');
  checkSize(text);
  return { text, notice: 'Copied HTML table extracted locally as text. Review the mapping and every row. Pasted markup and resources are never loaded.' };
}
