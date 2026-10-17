import { describe, expect, it, vi } from 'vitest';
import { createPastedDocument, parseMarkingFiles } from '../importDocuments';
import { confirmEvidenceMatch, createEvidenceGroups, evidenceImportGroups, mergeEvidenceWork, retainEvidenceMatches, workId, type EvidenceWork } from './evidenceImport';

const work = async (name: string, text = name): Promise<EvidenceWork> => ({ kind: 'documents', document: await createPastedDocument(name, text) });

describe('guided work matching and local import recovery', () => {
  it('requires every item and every selected student to be matched, without replicating one item across students', async () => {
    const items = [await work('Page one')], id = workId(items[0]);
    expect(() => evidenceImportGroups(items, ['student-a', 'student-b'], {})).toThrow('every work item');
    const matches = confirmEvidenceMatch(items, ['student-a', 'student-b'], {}, id, 'student-a');
    expect(() => evidenceImportGroups(items, ['student-a', 'student-b'], matches)).toThrow('Each selected student');
    expect(() => confirmEvidenceMatch(items, ['student-a', 'student-b'], matches, id, 'student-b')).toThrow('Undo');
    expect(() => confirmEvidenceMatch(items, ['student-a'], {}, id, 'student-b')).toThrow('selected student');
    expect(() => confirmEvidenceMatch(items, ['student-a'], {}, 'missing', 'student-a')).toThrow('added work');
  });

  it('allows several files for one student and retains confirmed matches across Back/selection correction', async () => {
    const items = [await work('A page one'), await work('A page two'), await work('B page one')];
    const selected = ['student-a', 'student-b'];
    let matches = confirmEvidenceMatch(items, selected, {}, workId(items[0]), 'student-a');
    matches = confirmEvidenceMatch(items, selected, matches, workId(items[1]), 'student-a');
    matches = confirmEvidenceMatch(items, selected, matches, workId(items[2]), 'student-b');
    const preserved = retainEvidenceMatches(matches, selected, items);
    expect(preserved).toEqual(matches);
    const groups = evidenceImportGroups(items, selected, preserved, { 'student-a': 'previous-a' });
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ kind: 'documents', enrollmentId: 'student-a', previousAttemptId: 'previous-a' });
    expect(groups[0].kind === 'documents' && groups[0].documents.map(doc => doc.name)).toEqual(['A page one', 'A page two']);
    expect(groups[1].kind === 'documents' && groups[1].documents.map(doc => doc.name)).toEqual(['B page one']);
    expect(retainEvidenceMatches(matches, ['student-a'], items)).toEqual({ [workId(items[0])]: 'student-a', [workId(items[1])]: 'student-a' });
    const undone = { ...preserved }; delete undone[workId(items[1])];
    expect(confirmEvidenceMatch(items, selected, undone, workId(items[1]), 'student-b')[workId(items[1])]).toBe('student-b');
  });

  it('retains successful local originals after a sibling failure and deduplicates reselected files without altering the original bytes', async () => {
    const raw = 'Fictional first line\r\nSecond line';
    const first = await parseMarkingFiles([new File([raw], 'A.txt'), new File(['old Word'], 'unsupported.doc')]);
    expect(first.errors.map(row => row.name)).toEqual(['unsupported.doc']);
    const initial = mergeEvidenceWork([], first.documents.map(document => ({ kind: 'documents', document })));
    const retry = await parseMarkingFiles([new File([raw], 'A.txt'), new File(['Fictional B'], 'B.txt')]);
    const recovered = mergeEvidenceWork(initial.items, retry.documents.map(document => ({ kind: 'documents', document })));
    expect(recovered.items).toHaveLength(2);
    expect(recovered.skipped).toEqual(['A.txt']);
    expect(recovered.items[0]).toBe(initial.items[0]);
    expect(recovered.items[0].kind === 'documents' && atob(recovered.items[0].document.original!.base64)).toBe(raw);
  });

  it('rejects duplicate entries and bounded batches instead of silently finalizing duplicates', async () => {
    const a = await work('A');
    expect(() => evidenceImportGroups([a, a], ['student-a'], { [workId(a)]: 'student-a' })).toThrow('duplicate');
    const sameContent = await work('Other name', 'A');
    expect(() => evidenceImportGroups([a, sameContent], ['student-a'], { [workId(a)]: 'student-a', [workId(sameContent)]: 'student-a' })).toThrow('duplicate');
    const items = await Promise.all(Array.from({ length: 11 }, (_, index) => work(`Page ${index}`)));
    expect(() => mergeEvidenceWork(items.slice(0, 10), items.slice(10))).toThrow();
  });

  it('retries only failed student submissions, then returns all IDs for a separate retryable opening step', async () => {
    const items = [await work('A'), await work('B')];
    const groups = evidenceImportGroups(items, ['student-a', 'student-b'], { [workId(items[0])]: 'student-a', [workId(items[1])]: 'student-b' });
    const receipts: Record<string, string> = {}, saved = vi.fn(), validate = vi.fn();
    const create = vi.fn().mockResolvedValueOnce({ attemptId: 'attempt-a' }).mockRejectedValueOnce(new Error('Disk unavailable'));
    await expect(createEvidenceGroups(groups, receipts, create, saved, validate)).rejects.toThrow('Disk unavailable');
    expect(receipts).toEqual({ [groups[0].key]: 'attempt-a' });
    create.mockResolvedValueOnce({ attemptId: 'attempt-b' });
    await expect(createEvidenceGroups(groups, receipts, create, saved, validate)).resolves.toEqual(['attempt-a', 'attempt-b']);
    expect(create.mock.calls.map(([group]) => group.enrollmentId)).toEqual(['student-a', 'student-b', 'student-b']);
    // If opening marking subsequently fails, retrying creation uses only the receipts.
    await expect(createEvidenceGroups(groups, receipts, create, saved, validate)).resolves.toEqual(['attempt-a', 'attempt-b']);
    expect(create).toHaveBeenCalledTimes(3);
    expect(saved).toHaveBeenCalledTimes(2);
  });

  it('treats an uncompleted callback as a failure and blocks further work after a teacher change', async () => {
    const items = [await work('A'), await work('B')];
    const groups = evidenceImportGroups(items, ['a', 'b'], { [workId(items[0])]: 'a', [workId(items[1])]: 'b' });
    const receipts: Record<string, string> = {}, saved = vi.fn();
    await expect(createEvidenceGroups(groups, receipts, async () => null, saved, () => {})).rejects.toThrow('not saved');
    expect(receipts).toEqual({}); expect(saved).not.toHaveBeenCalled();
    let teacher = 'a';
    const create = vi.fn(async () => { teacher = 'changed'; return { attemptId: 'old-teacher-attempt' }; });
    const validate = () => { if (teacher !== 'a') throw new Error('Teacher changed'); };
    await expect(createEvidenceGroups(groups, receipts, create, saved, validate)).rejects.toThrow('Teacher changed');
    expect(create).toHaveBeenCalledTimes(1);
    expect(saved).not.toHaveBeenCalled();
    // Retain the committed receipt internally even though it must not be shown to the new teacher.
    expect(receipts[groups[0].key]).toBe('old-teacher-attempt');
  });

  it('groups picture pages for the same student while preserving each retained page', () => {
    const page = (id: string): EvidenceWork => ({ kind: 'pictures', page: { id, name: `${id}.png`, mime: 'image/png', base64: 'AQ==', size: 1, hash: id.repeat(64), width: 1, height: 1 } });
    const items = [page('a'), page('b'), page('c')];
    const groups = evidenceImportGroups(items, ['student-a', 'student-b'], { a: 'student-a', b: 'student-a', c: 'student-b' });
    expect(groups[0].kind === 'pictures' && groups[0].pages.map(item => item.name)).toEqual(['a.png', 'b.png']);
    expect(groups[1].kind === 'pictures' && groups[1].pages.map(item => item.name)).toEqual(['c.png']);
  });
});


describe('class ZIP staging before explicit student matching', () => {
  it('retains 40 separate source paths including equal essays, deduplicates re-adding that archive, and enforces per-student limits at review', async () => {
    const incoming: EvidenceWork[] = await Promise.all(Array.from({ length: 40 }, async (_, i) => ({ kind: 'documents' as const, document: await createPastedDocument('Essay.docx', 'Same fictional response'), sourceKey: `archive-hash:Folder-${i}/Essay.docx`, sourceLabel: `Folder-${i}/Essay.docx` })));
    const staged = mergeEvidenceWork([], incoming);
    expect(staged.items).toHaveLength(40);
    expect(mergeEvidenceWork(staged.items, incoming).items).toHaveLength(40);
    const ids = incoming.map((_, i) => `student-${i}`);
    const matches = Object.fromEntries(incoming.map((item, i) => [workId(item), ids[i]]));
    expect(evidenceImportGroups(staged.items, ids, matches)).toHaveLength(40);
    expect(() => evidenceImportGroups(staged.items, ['student-one'], Object.fromEntries(incoming.map(item => [workId(item), 'student-one'])))).toThrow();
  });
});
