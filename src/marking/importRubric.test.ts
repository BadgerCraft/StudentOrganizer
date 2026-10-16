import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { importRubricFile, rubricDocxText } from './importRubric';
const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const cell = (text: string) => `<w:tc>${text.split('\n').map(paragraph).join('')}</w:tc>`;
const row = (cells: string[]) => `<w:tr>${cells.map(cell).join('')}</w:tr>`;
const docx = (body: string) => zipSync({
  '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
  'word/document.xml': strToU8(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`),
});
const file = (bytes: Uint8Array, name = 'Fictional rubric.docx') => new File([new Uint8Array(bytes)], name);
describe('local rubric document import', () => {
  it('preserves actual DOCX table boundaries, instructions, categories, descriptor paragraphs and quoted text', async () => {
    const bytes = docx(paragraph('Fictional assessment') + paragraph('Instructions: revise your essay.') + `<w:tbl>${[
      ['Category and Description', 'Level 1', 'Level 4'],
      ['Knowledge/Understanding', '', ''],
      ['Accuracy', 'Limited accuracy\nNeeds detail', 'Accurate "facts"'],
      ['Connections', 'Few connections', 'Sound connections'],
      ['Thinking', '', ''],
      ['Reasoning', 'Limited reasoning', 'Insightful reasoning'],
    ].map(row).join('')}</w:tbl>`);
    const rubric = await importRubricFile(file(bytes));
    expect(rubric.title).toBe('Fictional assessment');
    expect(rubric.instructions).toBe('Instructions: revise your essay.');
    expect(rubric.criteria.map(c => c.categoryCode)).toEqual(['K', 'K', 'T']);
    expect(rubric.criteria[0].descriptors).toEqual({ 'Level 1': 'Limited accuracy\nNeeds detail', 'Level 4': 'Accurate "facts"' });
  });
  it('supports UTF-8 text, rejects unsupported/broken files with useful explanations', async () => {
    const rubric = await importRubricFile(new File(['Criterion\tKTCA\t1−\nReasoning\tT\tLimited'], 'Rubric.txt'));
    expect(rubric.title).toBe('Rubric');
    await expect(importRubricFile(new File(['old'], 'rubric.doc'))).rejects.toThrow('Older .doc');
    await expect(importRubricFile(new File([new Uint8Array([0xff])], 'rubric.txt'))).rejects.toThrow('UTF-8');
    await expect(importRubricFile(file(new Uint8Array([1, 2])))).rejects.toThrow('Invalid DOCX');
  });
  it('rejects nested tables rather than flattening them into invented criteria', async () => {
    await expect(rubricDocxText(docx('<w:tbl><w:tr><w:tc><w:tbl/></w:tc></w:tr></w:tbl>'))).rejects.toThrow('Nested');
  });
});
