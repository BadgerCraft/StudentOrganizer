import { unzipSync } from 'fflate';
import { SaxesParser } from 'saxes';
import { validateDocxArchive, normalizeMarkingText } from './importDocuments';
import { encodeTsv } from './delimitedText';
import { parseRubricPaste, type RubricImportContent } from './rubricParser';
import { MARKING_LIMITS } from './types';

/** Word's plain-text extraction loses cell boundaries. Read only the verified local
 * document XML, preserving paragraphs inside cells and rows outside the table. */
export async function rubricDocxText(bytes: Uint8Array): Promise<string> {
  const checked = await validateDocxArchive(bytes);
  const xml = new TextDecoder('utf-8', { fatal: true }).decode(unzipSync(checked)['word/document.xml']);
  const rows: string[][] = [];
  let tableDepth = 0, inText = false, inCell = false, cell = '', paragraph = '', row: string[] = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on('opentag', tag => {
    if (tag.local === 'tbl' && ++tableDepth > 1) throw new Error('Nested rubric tables need review. Copy the rubric as a tab-separated table.');
    if (tag.local === 'tr') row = [];
    if (tag.local === 'tc') { inCell = true; cell = ''; }
    if (tag.local === 'p' && !inCell) paragraph = '';
    if (tag.local === 't') inText = true;
    if (tag.local === 'tab') { if (inCell) cell += '\t'; else paragraph += '\t'; }
    if (tag.local === 'br') { if (inCell) cell += '\n'; else paragraph += '\n'; }
  });
  parser.on('text', value => { if (inText) { if (inCell) cell += value; else paragraph += value; } });
  parser.on('closetag', tag => {
    if (tag.local === 't') inText = false;
    if (tag.local === 'p') {
      if (inCell) cell += '\n';
      else if (paragraph.trim()) rows.push([paragraph.trim()]);
    }
    if (tag.local === 'tc') { row.push(cell.replace(/\n$/, '')); inCell = false; }
    if (tag.local === 'tr' && row.some(value => value.trim())) rows.push(row);
    if (tag.local === 'tbl') tableDepth--;
  });
  parser.write(xml).close();
  return normalizeMarkingText(encodeTsv(rows));
}

export async function importRubricFile(file: File): Promise<RubricImportContent> {
  if (file.size > MARKING_LIMITS.fileBytes) throw new Error('Rubric file exceeds 2 MB.');
  const extension = file.name.toLowerCase().split('.').pop();
  if (extension !== 'txt' && extension !== 'docx') throw new Error('Choose a UTF-8 .txt or .docx rubric. Older .doc files and PDF are unsupported; save as .docx or paste a table.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length !== file.size || bytes.length > MARKING_LIMITS.fileBytes) throw new Error('Rubric file size changed or exceeds 2 MB.');
  let text: string;
  if (extension === 'docx') text = await rubricDocxText(bytes);
  else {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new Error('Text files must use valid UTF-8 encoding.'); }
  }
  const result = parseRubricPaste(text);
  if (result.title === 'Pasted rubric') result.title = file.name.replace(/\.(?:txt|docx)$/i, '');
  return result;
}
