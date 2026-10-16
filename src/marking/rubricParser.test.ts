import { describe, expect, it } from 'vitest';
import { parseRubricPaste } from './rubricParser';

describe('rubric import review', () => {
  it('preserves every descriptor, arbitrary achievement suffix and supported weight with legacy KTAC input', () => {
    const rubric = parseRubricPaste('Fictional Essay Rubric\nCriterion\tKTAC\tWeight\t1-\t3+\t4+\nArgument\tThinking\t2\tLimited argument\tClear argument\tNuanced argument\nExpression\tC\t1\tLimited clarity\tClear voice\tFluent voice');
    expect(rubric.title).toBe('Fictional Essay Rubric');
    expect(rubric.levels).toEqual(['1-', '3+', '4+']);
    expect(rubric.criteria[0]).toMatchObject({ name: 'Argument', categoryCode: 'T', weight: 2, descriptors: { '1-': 'Limited argument', '3+': 'Clear argument', '4+': 'Nuanced argument' } });
    expect(rubric.criteria[1].categoryCode).toBe('C');
    expect(rubric).not.toHaveProperty('confirmed');
  });
  it('reproduces the full-rubric boundary with instructions, combined category/description header and several criteria per category', () => {
    const rubric = parseRubricPaste([
      'Fictional research report',
      'Instructions: Write a report. Include evidence and sources.',
      'Success criteria: use the rubric below to revise your work.',
      'Category and Description\tLevel 1\tLevel 2\tLevel 3\tLevel 4',
      'Knowledge/Understanding\t\t\t\t',
      'Content accuracy\tLimited accuracy\tSome accuracy\tAccurate\tThoroughly accurate',
      'Concepts\tFew concepts\tSome concepts\tRelevant concepts\tPrecise concepts',
      'Thinking\t\t\t\t',
      'Investigation\tLimited\tSome\tConsiderable\tThorough',
      'Analysis\tLimited analysis\tSome analysis\tSound analysis\tInsightful analysis',
      'Communication\t\t\t\t',
      'Clarity\tUnclear\tPartly clear\tClear\tPrecise',
      'Application\t\t\t\t',
      'Transfer\tLimited transfer\tSome transfer\tGood transfer\tStrong transfer',
    ].join('\n'));
    expect(rubric.criteria.map(c => [c.name, c.categoryCode])).toEqual([
      ['Content accuracy', 'K'], ['Concepts', 'K'], ['Investigation', 'T'], ['Analysis', 'T'], ['Clarity', 'C'], ['Transfer', 'A'],
    ]);
    expect(rubric.criteria).toHaveLength(6);
    expect(rubric.criteria[3].descriptors['Level 4']).toBe('Insightful analysis');
    expect(rubric.instructions).toContain('Instructions: Write a report.');
    expect(rubric.instructions).toContain('Success criteria:');
  });
  it('does not copy the first combined-row category across subsequent independent criterion rows', () => {
    const rubric = parseRubricPaste('Category and Description\tLevel 1\tLevel 4\nKnowledge/Understanding: Accuracy\tLimited\tThorough\nCommunication: Clarity\tUnclear\tClear\nUse of evidence\tFew details\tStrong details');
    expect(rubric.criteria.map(c => [c.name, c.categoryCode])).toEqual([['Accuracy', 'K'], ['Clarity', 'C'], ['Use of evidence', null]]);
  });
  it('supports separate category and description columns including blank merged-category continuations and unknown mappings', () => {
    const rubric = parseRubricPaste('Category\tDescription\tBeginning\tSecure\nThinking\tPlan\tLimited plan\tUseful plan\n\tReason\tLimited reasoning\tSound reasoning\nUnknown\tExplain\tLimited explanation\tClear explanation\n\tTransfer\tLimited transfer\tStrong transfer');
    expect(rubric.criteria.map(c => c.categoryCode)).toEqual(['T', 'T', null, null]);
    expect(rubric.levels).toEqual(['Beginning', 'Secure']);
  });
  it('preserves quoted multiline/escaped-quote cells, empty descriptors and repeat header rows', () => {
    const rubric = parseRubricPaste('Criterion\tEmerging\tProficient\nVoice\t"Two lines\nwith ""quotes"""\t\nCriterion\tEmerging\tProficient\nEvidence\tSome\tStrong');
    expect(rubric.criteria[0].descriptors).toEqual({ Emerging: 'Two lines\nwith "quotes"', Proficient: '' });
    expect(rubric.criteria[0].categoryCode).toBeNull();
    expect(rubric.criteria).toHaveLength(2);
  });
  it('retains flattened prose without multiplying descriptor paragraphs into criteria or assigning K', () => {
    const text = 'Instructions: Write an essay.\n\nKnowledge/Understanding\n\nLimited accuracy\n\nConsiderable accuracy\n\nClarity matters. <img src="https://example.invalid">';
    const rubric = parseRubricPaste(text);
    expect(rubric.levels).toEqual(['Evidence']);
    expect(rubric.criteria).toHaveLength(1);
    expect(rubric.criteria[0].categoryCode).toBeNull();
    expect(rubric.criteria[0].descriptors.Evidence).toBe(text);
    expect(rubric.instructions).toContain('no reliable table structure');
  });
  it('keeps an unrecognized explicit mapping for confirmation rather than rejecting or assigning the first category', () => {
    const rubric = parseRubricPaste('Criterion\tKTCA\tLevel 1\nEvidence\tUnknown\tA');
    expect(rubric.criteria[0].categoryCode).toBeNull();
    expect(rubric.criteria[0].name).toBe('Evidence');
  });
  it('fails rather than silently dropping malformed table cells', () => {
    for (const text of [
      'Criterion\tLevel 1\tLevel 2\nEvidence\tOnly one cell',
      'Criterion\tLevel 1\tLevel 2\nEvidence\tA\tB\tLost data',
      'Criterion\tLevel 1\tLevel 1\nEvidence\tA\tB',
      'Criterion\tLevel 1\nEvidence\t"Unfinished',
    ]) expect(() => parseRubricPaste(text)).toThrow();
  });
});
