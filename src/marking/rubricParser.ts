import { MARKING_LIMITS, type KTAC, type RubricContent } from './types';

/** TSV supports quoted multiline cells, as copied from spreadsheet rubric tables. */
function rowsOfTsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false, afterQuote = false;
  const finishCell = () => { row.push(cell); cell = ''; afterQuote = false; };
  const finishRow = () => { finishCell(); rows.push(row); row = []; };
  for (let at = 0; at < input.length; at++) {
    const character = input[at];
    if (quoted) {
      if (character === '"' && input[at + 1] === '"') { cell += '"'; at++; }
      else if (character === '"') { quoted = false; afterQuote = true; }
      else cell += character;
    } else if (character === '"' && !cell && !afterQuote) quoted = true;
    else if (character === '\t') finishCell();
    else if (character === '\n') finishRow();
    else if (afterQuote) throw new Error('Unexpected text after a quoted rubric cell.');
    else cell += character;
  }
  if (quoted) throw new Error('A quoted rubric cell is unfinished.');
  if (cell || row.length || afterQuote) finishRow();
  return rows.filter(row => row.some(value => value.trim()));
}

const category = (value: string): KTAC | undefined => {
  const code = value.trim().toLowerCase();
  if (/^(k|knowledge|knowledge(?:\s*\/\s*|\s+and\s+)understanding)$/.test(code)) return 'K';
  if (/^(t|thinking)$/.test(code)) return 'T';
  if (/^(a|application)$/.test(code)) return 'A';
  if (/^(c|communication)$/.test(code)) return 'C';
};

/** Nothing is auto-confirmed: the teacher reviews every descriptor and confirms KTAC mapping. */
export function parseRubricPaste(input: string): RubricContent {
  const text = input.replace(/\r\n?/g, '\n').replace(/^\n+|\n+$/g, '');
  if (!text.trim()) throw new Error('Paste rubric text or a tab-separated rubric table.');
  if (text.length > MARKING_LIMITS.textCharacters || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(text)) throw new Error('Rubric text is too large or contains unsupported control characters.');
  if (!text.includes('\t')) {
    const paragraphs = text.split(/\n\s*\n/).filter(value => value.trim());
    if (paragraphs.length > MARKING_LIMITS.criteria) throw new Error('Use at most 40 rubric criteria.');
    return {
      title: 'Pasted rubric', levels: ['Evidence'],
      criteria: paragraphs.map((paragraph, index) => ({ id: crypto.randomUUID(), name: `Criterion ${index + 1}`, categoryCode: 'K', descriptors: { Evidence: paragraph } })),
    };
  }
  const rows = rowsOfTsv(text);
  let title = 'Pasted rubric';
  if (rows[0]?.length === 1) title = rows.shift()![0];
  const header = rows.shift();
  if (!header || header.length < 2 || !rows.length) throw new Error('Use a header row: Criterion, optional KTAC and Weight columns, then one column per achievement level.');
  const labels = header.map(value => value.trim());
  if (!/^(criterion|criteria|category|skill|expectation)$/i.test(labels[0])) throw new Error('The first table header must be Criterion, Criteria, Category, Skill or Expectation.');
  const categoryIndex = labels.findIndex((value, index) => index > 0 && /^(KTAC|mapping)$/i.test(value));
  const weightIndex = labels.findIndex((value, index) => index > 0 && /^weight$/i.test(value));
  const levelIndexes = labels.map((_, index) => index).filter(index => index > 0 && index !== categoryIndex && index !== weightIndex);
  const levels = levelIndexes.map(index => labels[index]);
  if (!levels.length || levels.length > MARKING_LIMITS.levels || levels.some(level => !level) || new Set(levels).size !== levels.length || rows.length > MARKING_LIMITS.criteria) throw new Error('Use 1–30 distinct achievement labels and at most 40 criteria.');
  const criteria = rows.map((row, index) => {
    if (row.length !== header.length) throw new Error(`Rubric row ${index + 2} has ${row.length} cells; expected ${header.length}. No descriptors were imported. Correct the table and try again.`);
    if (!row[0].trim()) throw new Error(`Rubric row ${index + 2} needs a criterion name.`);
    const code = categoryIndex < 0 ? 'K' : category(row[categoryIndex]);
    if (!code) throw new Error(`Rubric row ${index + 2} needs K, T, A or C in its KTAC column.`);
    const weight = weightIndex < 0 || !row[weightIndex].trim() ? undefined : Number(row[weightIndex]);
    if (weight !== undefined && (!Number.isFinite(weight) || weight < 0 || weight > 10000)) throw new Error(`Rubric row ${index + 2} has an invalid weight.`);
    return { id: crypto.randomUUID(), name: row[0], categoryCode: code, descriptors: Object.fromEntries(levelIndexes.map(column => [labels[column], row[column]])), ...(weight === undefined ? {} : { weight }) };
  });
  return { title, levels, criteria };
}
