import { MARKING_LIMITS, type KTAC, type RubricContent, type RubricCriterion } from './types';
import { parseDelimitedText } from './delimitedText';

export type ImportedCriterion = Omit<RubricCriterion, 'categoryCode'> & { categoryCode: KTAC | null };
/** A null category is deliberately unsavable until the teacher chooses its mapping. */
export type RubricImportContent = Omit<RubricContent, 'criteria'> & { criteria: ImportedCriterion[]; instructions?: string };

export function rubricCategory(value: string): KTAC | null {
  const code = value.trim().toLowerCase().replace(/\s*\([ktca]\)\s*$/i, '').replace(/:$/, '').trim();
  if (/^(k|knowledge|knowledge(?:\s*[\u002f&]\s*|\s+and\s+)understanding)$/.test(code)) return 'K';
  if (/^(t|thinking(?:\s*[\u002f&]\s*|\s+and\s+)inquiry|thinking)$/.test(code)) return 'T';
  if (/^(a|application)$/.test(code)) return 'A';
  if (/^(c|communication)$/.test(code)) return 'C';
  return null;
}
const criterionHeader = /^(criterion|criteria|categor(?:y|ies)|category\s+(?:and|&)\s+description|skill|expectation|description)$/i;
const mappingHeader = /^(KTCA|KTAC|mapping|category)$/i;
const descriptionHeader = /^(description|criterion|criteria|skill|expectation)$/i;

function categoryAndCriterion(value: string): { code: KTAC | null; name: string } {
  const exact = rubricCategory(value);
  if (exact) return { code: exact, name: value.trim() };
  const parts = value.split(/\n|:\s*/);
  if (parts.length > 1) {
    const code = rubricCategory(parts[0]);
    if (code) return { code, name: parts.slice(1).join('\n').trim() || parts[0].trim() };
  }
  return { code: null, name: value.trim() };
}

/** Keep instruction prose separate from a matrix, and never infer a category from row order. */
export function parseRubricPaste(input: string): RubricImportContent {
  const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/^\n+|\n+$/g, '');
  if (!text.trim()) throw new Error('Paste rubric text or a tab-separated rubric table.');
  if (text.length > MARKING_LIMITS.textCharacters || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/u.test(text)) throw new Error('Rubric text is too large or contains unsupported characters.');
  if (!text.includes('\t')) {
    // Flattened Word tables cannot be reconstructed reliably. Preserve the source for
    // editing rather than guessing that each achievement descriptor is a criterion.
    return { title: 'Pasted rubric', levels: ['Evidence'], instructions: 'Plain text has no reliable table structure. Review this criterion, split or remove instructions as needed, and choose its KTCA category. Import the original .docx to preserve table rows.', criteria: [{ id: crypto.randomUUID(), name: 'Review imported success criteria', categoryCode: null, descriptors: { Evidence: text } }] };
  }
  const rows = parseDelimitedText(text, '\t');
  const headerAt = rows.findIndex(row => row.length > 1 && criterionHeader.test(row[0].trim()));
  if (headerAt < 0) throw new Error('No rubric table header was found. Use Criterion or Category and Description, followed by achievement-level columns.');
  const before = rows.slice(0, headerAt);
  const header = rows[headerAt].map(value => value.trim());
  const separateCategory = /^category$/i.test(header[0]) && descriptionHeader.test(header[1] ?? '');
  const nameIndex = separateCategory ? 1 : 0;
  const categoryIndex = separateCategory ? 0 : header.findIndex((value, index) => index > 0 && mappingHeader.test(value));
  const weightIndex = header.findIndex((value, index) => index > 0 && /^weight$/i.test(value));
  const levelIndexes = header.map((_, index) => index).filter(index => index !== nameIndex && index !== categoryIndex && index !== weightIndex);
  const levels = levelIndexes.map(index => header[index]);
  if (!levels.length || levels.length > MARKING_LIMITS.levels || levels.some(level => !level) || new Set(levels).size !== levels.length) throw new Error('Use 1–30 distinct achievement labels.');
  let headingCategory: KTAC | null = null;
  const criteria: ImportedCriterion[] = [];
  for (let index = headerAt + 1; index < rows.length; index++) {
    const row = rows[index];
    if (row.length === header.length && row.every((cell, column) => cell.trim() === header[column])) continue;
    const heading = rubricCategory(row[0]);
    if (heading && row.slice(1).every(cell => !cell.trim())) { headingCategory = heading; continue; }
    if (row.length !== header.length) throw new Error(`Rubric row ${index + 1} has ${row.length} cells; expected ${header.length}. No descriptors were imported. Correct the table and try again.`);
    const parsed = categoryAndCriterion(row[nameIndex]);
    if (!parsed.name) throw new Error(`Rubric row ${index + 1} needs a criterion name.`);
    // Explicit mapping always wins, including an unknown mapping: do not inherit a
    // prior category over an ambiguous or unrecognized value.
    const explicitMapping = categoryIndex >= 0 ? row[categoryIndex].trim() : '';
    const code: KTAC | null = explicitMapping ? rubricCategory(explicitMapping) : parsed.code ?? headingCategory;
    if (separateCategory && explicitMapping) headingCategory = code;
    const weight = weightIndex < 0 || !row[weightIndex].trim() ? undefined : Number(row[weightIndex]);
    if (weight !== undefined && (!Number.isFinite(weight) || weight < 0 || weight > 10000)) throw new Error(`Rubric row ${index + 1} has an invalid weight.`);
    criteria.push({ id: crypto.randomUUID(), name: parsed.name, categoryCode: code, descriptors: Object.fromEntries(levelIndexes.map(column => [header[column], row[column]])), ...(weight === undefined ? {} : { weight }) });
    // A category embedded in one row is not a section heading: it must not leak
    // into subsequent independent rows in a complete rubric.
  }
  if (!criteria.length || criteria.length > MARKING_LIMITS.criteria) throw new Error('Use 1–40 rubric criteria.');
  return { title: before[0]?.[0].trim() || 'Pasted rubric', levels, criteria, ...(before.length > 1 ? { instructions: before.slice(1).map(row => row.join('\t')).join('\n') } : {}) };
}
