import { describe, expect, it } from 'vitest';
import { parseRubricPaste } from './rubricParser';

describe('rubric paste preview', () => {
  it('preserves every descriptor, arbitrary achievement suffix and supported weight', () => {
    const rubric = parseRubricPaste('Fictional Essay Rubric\nCriterion\tKTAC\tWeight\t1-\t3+\t4+\nArgument\tThinking\t2\tLimited argument\tClear argument\tNuanced argument\nExpression\tC\t1\tLimited clarity\tClear voice\tFluent voice');
    expect(rubric.title).toBe('Fictional Essay Rubric');
    expect(rubric.levels).toEqual(['1-', '3+', '4+']);
    expect(rubric.criteria[0]).toMatchObject({ name: 'Argument', categoryCode: 'T', weight: 2, descriptors: { '1-': 'Limited argument', '3+': 'Clear argument', '4+': 'Nuanced argument' } });
    expect(rubric.criteria[1].categoryCode).toBe('C');
    expect(rubric).not.toHaveProperty('confirmed');
  });
  it('preserves quoted multiline/escaped-quote cells and empty descriptors for teacher correction', () => {
    const rubric = parseRubricPaste('Criterion\tEmerging\tProficient\nVoice\t"Two lines\nwith ""quotes"""\t');
    expect(rubric.criteria[0].descriptors).toEqual({ Emerging: 'Two lines\nwith "quotes"', Proficient: '' });
  });
  it('retains all plain prose without pretending it has parsed an achievement matrix', () => {
    const text = 'Argument uses evidence.\nIncludes supporting details.\n\nClarity matters. <img src="https://example.invalid">';
    const rubric = parseRubricPaste(text);
    expect(rubric.levels).toEqual(['Evidence']);
    expect(rubric.criteria.map(value => value.descriptors.Evidence).join('\n\n')).toBe(text);
  });
  it('fails rather than silently dropping malformed or ambiguous table cells', () => {
    for (const text of [
      'Criterion\tLevel 1\tLevel 2\nEvidence\tOnly one cell',
      'Criterion\tLevel 1\tLevel 2\nEvidence\tA\tB\tLost data',
      'Criterion\tLevel 1\tLevel 1\nEvidence\tA\tB',
      'Criterion\tKTAC\tLevel 1\nEvidence\tUnknown\tA',
      'Criterion\tLevel 1\nEvidence\t"Unfinished',
    ]) expect(() => parseRubricPaste(text)).toThrow();
  });
});
