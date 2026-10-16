import { afterEach, describe, expect, it } from 'vitest';
import { clearActiveTeacherId, getIdentityEpoch, setActiveTeacherId } from '../services/identityService';
import { addReviewedBankComments, exportCommentBank, importCommentBankFile, loadCommentBank, parseCommentBank, saveCommentBank } from './commentBank';
import type { MarkingActor } from './types';
const storage = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
};
const actor = (userId: string): MarkingActor => { setActiveTeacherId(userId); return { userId, deviceId: 'fictional-device', epoch: getIdentityEpoch() }; };
afterEach(() => clearActiveTeacherId());
describe('teacher comment bank', () => {
  it('reviews plain text with one comment per line and removes exact duplicates', () => {
    expect(parseCommentBank('Useful evidence.\r\n\r\nDevelop your explanation.\nUseful evidence.')).toEqual(['Useful evidence.', 'Develop your explanation.']);
  });
  it('preserves quoted multiline CSV comments and round-trips exported banks', () => {
    const comments = ['Explain "why", using evidence.\nThen connect the ideas.', 'Clear communication.'];
    expect(parseCommentBank(exportCommentBank(comments), 'csv')).toEqual(comments);
  });
  it('rejects extra columns, unfinished CSV, empty and oversized banks without silently losing data', () => {
    expect(() => parseCommentBank('Comment,Category\nUseful,K', 'csv')).toThrow('single Comment column');
    expect(() => parseCommentBank('Comment\n"Unfinished', 'csv')).toThrow('unfinished');
    expect(() => parseCommentBank('')).toThrow();
    expect(() => parseCommentBank('a'.repeat(5001))).toThrow('5,000');
    expect(() => parseCommentBank(Array.from({ length: 501 }, (_, i) => `Comment ${i}`).join('\n'))).toThrow('500');
  });
  it('persists reviewed comments separately by explicitly selected teacher across picker reopen', () => {
    const local = storage(); const first = actor('first');
    saveCommentBank(local, first, ['Useful evidence.']);
    expect(loadCommentBank(local, first)).toEqual(['Useful evidence.']);
    const second = actor('second');
    expect(loadCommentBank(local, second)).toEqual([]);
    saveCommentBank(local, second, ['Clear communication.']);
    const reopenedFirst = actor('first');
    expect(loadCommentBank(local, reopenedFirst)).toEqual(['Useful evidence.']);
    expect(() => saveCommentBank(local, first, ['Stale operation'])).toThrow('acting teacher changed');
  });
  it('merges the latest bank when another mounted composer adds comments after this picker loaded', () => {
    const local = storage(); const selected = actor('first');
    saveCommentBank(local, selected, ['Original.']);
    const stalePickerSnapshot = loadCommentBank(local, selected);
    addReviewedBankComments(local, selected, ['Added by another composer.']);
    expect(stalePickerSnapshot).toEqual(['Original.']);
    expect(addReviewedBankComments(local, selected, ['Added by stale picker.'])).toEqual(['Original.', 'Added by another composer.', 'Added by stale picker.']);
    expect(loadCommentBank(local, selected)).toEqual(['Original.', 'Added by another composer.', 'Added by stale picker.']);
  });
  it('retains previous stored bank if an import or storage write fails', () => {
    const local = storage(); const selected = actor('first');
    saveCommentBank(local, selected, ['Keep this.']);
    expect(() => saveCommentBank(local, selected, [''])).toThrow();
    expect(loadCommentBank(local, selected)).toEqual(['Keep this.']);
    expect(() => saveCommentBank({ setItem: () => { throw new Error('Quota exceeded'); } }, selected, ['New'])).toThrow('Quota');
  });
  it('imports supported files and explains legacy Word rejection', async () => {
    expect(await importCommentBankFile(new File(['Comment\n"Good evidence, explained clearly."'], 'bank.csv'))).toEqual(['Good evidence, explained clearly.']);
    expect(await importCommentBankFile(new File(['Useful\nClear'], 'bank.txt'))).toEqual(['Useful', 'Clear']);
    await expect(importCommentBankFile(new File(['old'], 'bank.doc'))).rejects.toThrow('.docx');
  });
});
