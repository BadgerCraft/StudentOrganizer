export interface ParsedStudentRow {
  rowNumber: number;
  rawText: string;
  firstName: string;
  lastName: string;
  studentNumber: string;
  error: string | null;
  warning: string | null;
}

export interface RosterParseResult {
  detectedFormat: 'two_column_combined' | 'three_column_separate';
  detectedDelimiter: '\t' | ',';
  hasHeader: boolean;
  rows: ParsedStudentRow[];
  totalRawRows: number;
  validRowCount: number;
  errorRowCount: number;
}

/**
 * Tokenizes text according to RFC 4180 rules, supporting specified delimiter.
 */
export function tokenizeRFC4180(text: string, delimiter: string = ','): string[][] {
  const clean = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let insideQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    const next = clean[i + 1];

    if (insideQuotes) {
      if (char === '"') {
        if (next === '"') {
          currentCell += '"';
          i++; // skip escaped quote
        } else {
          insideQuotes = false;
        }
      } else {
        currentCell += char;
      }
    } else {
      if (char === '"') {
        insideQuotes = true;
      } else if (char === delimiter) {
        currentRow.push(currentCell.trim());
        currentCell = '';
      } else if (char === '\r') {
        if (next === '\n') i++;
        currentRow.push(currentCell.trim());
        rows.push(currentRow);
        currentRow = [];
        currentCell = '';
      } else if (char === '\n') {
        currentRow.push(currentCell.trim());
        rows.push(currentRow);
        currentRow = [];
        currentCell = '';
      } else {
        currentCell += char;
      }
    }
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    rows.push(currentRow);
  }

  return rows;
}

export const parseCSV = tokenizeRFC4180;

/**
 * Parses combined "LastName, FirstName" string.
 * Preserves hyphens, apostrophes, and accents.
 * Flags missing commas and multiple commas as errors.
 */
export function parseCombinedName(cell: string): {
  firstName: string;
  lastName: string;
  error: string | null;
} {
  const trimmed = cell.trim();
  if (!trimmed) {
    return { firstName: '', lastName: '', error: 'Missing student name.' };
  }

  const commaCount = (trimmed.match(/,/g) || []).length;

  if (commaCount === 0) {
    return {
      firstName: '',
      lastName: trimmed,
      error: `Name must be in "LastName, FirstName" format (missing comma in "${trimmed}").`
    };
  }

  if (commaCount > 1) {
    return {
      firstName: '',
      lastName: '',
      error: `Ambiguous name format: "${trimmed}" contains multiple commas. Please format as "LastName, FirstName" (for example: "Smith Jr., Jordan").`
    };
  }

  const commaPos = trimmed.indexOf(',');
  const last = trimmed.slice(0, commaPos).trim();
  const first = trimmed.slice(commaPos + 1).trim();

  if (!last) {
    return { firstName: first, lastName: '', error: 'Missing last name.' };
  }
  if (!first) {
    return { firstName: '', lastName: last, error: 'Missing first name.' };
  }

  return { firstName: first, lastName: last, error: null };
}

/**
 * Checks if a string looks like a standard header title (no numeric digits, header keywords).
 */
function isHeaderCell(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase().trim();
  return keywords.some(kw => lower.includes(kw));
}

/**
 * Detects whether input is tab-delimited (spreadsheet paste) or comma-delimited (CSV).
 */
export function detectDelimiter(text: string): '\t' | ',' {
  const hasTabs = text.split(/\r?\n/).some(line => line.includes('\t'));
  return hasTabs ? '\t' : ',';
}

/**
 * Primary parser for class roster pastes and files.
 */
export function parseRosterText(rawInput: string): RosterParseResult {
  const trimmedInput = rawInput.trim();
  if (!trimmedInput) {
    return {
      detectedFormat: 'two_column_combined',
      detectedDelimiter: '\t',
      hasHeader: false,
      rows: [],
      totalRawRows: 0,
      validRowCount: 0,
      errorRowCount: 0
    };
  }

  // 1. Detect delimiter: Tab takes priority if present on non-empty lines
  const delimiter = detectDelimiter(trimmedInput);

  // 2. Tokenize
  const rawTokenized = tokenizeRFC4180(trimmedInput, delimiter);

  // 3. Filter out completely blank lines while preserving line indices
  interface IndexedRow {
    lineIndex: number;
    cells: string[];
  }
  const nonEmptyRows: IndexedRow[] = [];
  rawTokenized.forEach((cells, idx) => {
    if (cells.some(c => c.length > 0)) {
      nonEmptyRows.push({ lineIndex: idx + 1, cells });
    }
  });

  if (nonEmptyRows.length === 0) {
    return {
      detectedFormat: 'two_column_combined',
      detectedDelimiter: delimiter,
      hasHeader: false,
      rows: [],
      totalRawRows: 0,
      validRowCount: 0,
      errorRowCount: 0
    };
  }

  // 4. Detect format (2-column combined name vs 3-column separate name)
  const firstRowCells = nonEmptyRows[0].cells;
  const isThreeColumn = firstRowCells.length === 3;

  let hasHeader = false;
  let numIdx = -1;
  let lastIdx = -1;
  let firstIdx = -1;
  let detectedFormat: 'two_column_combined' | 'three_column_separate' = isThreeColumn
    ? 'three_column_separate'
    : 'two_column_combined';

  let headerError: string | null = null;

  if (isThreeColumn) {
    // 3-column separate format
    const h0 = firstRowCells[0].toLowerCase();
    const h1 = firstRowCells[1].toLowerCase();
    const h2 = firstRowCells[2].toLowerCase();

    // Check if row 0 has headers
    const findIndex = (kws: string[]) =>
      firstRowCells.findIndex(cell => kws.some(kw => cell.toLowerCase().includes(kw)));

    const num = findIndex(['id', 'number', 'num', 'oen']);
    const last = findIndex(['last', 'surname']);
    const first = findIndex(['first', 'given']);

    if (num !== -1 && last !== -1 && first !== -1 && new Set([num, last, first]).size === 3) {
      hasHeader = true;
      numIdx = num;
      lastIdx = last;
      firstIdx = first;
    } else {
      // 3 columns without recognizable header
      hasHeader = false;
      headerError =
        '3-column format requires a header row with "Student ID", "Last Name", and "First Name".';
    }
  } else {
    // 2-column combined name format
    const col0 = firstRowCells[0];
    const col1 = firstRowCells[1] || '';

    // Check if row 0 is header: "Student Name" / "Student Number"
    const col0IsNameHeader = isHeaderCell(col0, ['student', 'name']) && !col0.includes(',');
    const col1IsNumHeader = isHeaderCell(col1, ['number', 'id', 'num', 'oen']) && !/^\d+$/.test(col1);

    if (col0IsNameHeader && col1IsNumHeader) {
      hasHeader = true;
    } else {
      hasHeader = false;
      // If col 0 doesn't have a comma and col 1 doesn't look like a student number, flag ambiguous header
      if (!col0.includes(',') && !/^[A-Za-z0-9_-]+$/.test(col1)) {
        headerError = `Unrecognized or ambiguous header row: "${col0} ${delimiter} ${col1}". Expected "Student Name" and "Student Number", or records formatted as "LastName, FirstName".`;
      }
    }
  }

  // 5. Parse data rows
  const parsedRows: ParsedStudentRow[] = [];
  const startIndex = hasHeader ? 1 : 0;

  if (headerError && !hasHeader) {
    parsedRows.push({
      rowNumber: nonEmptyRows[0].lineIndex,
      rawText: nonEmptyRows[0].cells.join(delimiter),
      firstName: '',
      lastName: '',
      studentNumber: '',
      error: headerError,
      warning: null
    });
  }

  const loopStart = headerError ? 1 : startIndex;

  for (let i = loopStart; i < nonEmptyRows.length; i++) {
    const { lineIndex, cells } = nonEmptyRows[i];
    const rawText = cells.join(delimiter);

    if (detectedFormat === 'three_column_separate') {
      if (cells.length !== 3) {
        parsedRows.push({
          rowNumber: lineIndex,
          rawText,
          firstName: '',
          lastName: '',
          studentNumber: '',
          error: `Unexpected number of columns: found ${cells.length} columns, expected 3.`,
          warning: null
        });
        continue;
      }

      const num = cells[numIdx]?.trim() || '';
      const last = cells[lastIdx]?.trim() || '';
      const first = cells[firstIdx]?.trim() || '';

      let rowErr: string | null = null;
      if (!last) rowErr = 'Missing last name.';
      else if (!first) rowErr = 'Missing first name.';
      else if (!num) rowErr = 'Missing student number.';

      parsedRows.push({
        rowNumber: lineIndex,
        rawText,
        firstName: first,
        lastName: last,
        studentNumber: num,
        error: rowErr,
        warning: null
      });
    } else {
      // 2-column combined name
      if (cells.length > 2) {
        parsedRows.push({
          rowNumber: lineIndex,
          rawText,
          firstName: '',
          lastName: '',
          studentNumber: cells[1]?.trim() || '',
          error: `Unexpected additional columns: found ${cells.length} columns, expected 2 ("Student Name" and "Student Number").`,
          warning: null
        });
        continue;
      }

      const nameCell = cells[0]?.trim() || '';
      const numCell = cells[1]?.trim() || '';

      const { firstName, lastName, error: nameError } = parseCombinedName(nameCell);
      let rowErr = nameError;
      if (!rowErr && !numCell) {
        rowErr = 'Missing student number.';
      }

      parsedRows.push({
        rowNumber: lineIndex,
        rawText,
        firstName,
        lastName,
        studentNumber: numCell,
        error: rowErr,
        warning: null
      });
    }
  }

  const validRowCount = parsedRows.filter(r => r.error === null).length;
  const errorRowCount = parsedRows.filter(r => r.error !== null).length;

  return {
    detectedFormat,
    detectedDelimiter: delimiter,
    hasHeader,
    rows: parsedRows,
    totalRawRows: parsedRows.length,
    validRowCount,
    errorRowCount
  };
}
