import { describe, expect, it } from 'vitest';
import { WorkingDelta } from './workingDelta';
describe('structured renderer deltas', () => {
  it('never visits unchanged historical or attachment bodies for an editor/private save', () => {
    const historical = { id: 'retained', get json() { throw Error('Unchanged history was read'); } };
    const photo = { id: 'photo', get bytes() { throw Error('Unchanged photo was read'); } };
    const delta = new WorkingDelta({ markingAttempts: [photo], markingSessions: [{ id: 'session', draft: 'old' }] }, { backups: [historical], options: [], state: [] }, { theme: 'dark' });
    const pending = delta.prepare({ markingSessions: [{ id: 'session', draft: 'new', optional: undefined }] }, {}, { theme: 'light' });
    expect(pending.changes).toEqual([{ namespace: 'primary', table: 'markingSessions', key: 'session', value: { id: 'session', draft: 'new' } }, { namespace: 'storage', key: 'theme', value: 'light' }]); pending.accept();
    expect(delta.prepare({}, {}, { theme: 'light' }).changes).toEqual([]);
  });
  it('failed CAS leaves the accepted baseline and deletions retryable', () => {
    const delta = new WorkingDelta({ students: [{ id: 'a', name: 'Taylor' }, { id: 'b', name: 'Jordan' }] }, { backups: [], options: [], state: [] }, { commentbank: 'old' });
    const first = delta.prepare({ students: [{ id: 'a', name: 'Edited' }] }, {}, {});
    expect(first.changes).toEqual(delta.prepare({ students: [{ id: 'a', name: 'Edited' }] }, {}, {}).changes);
    expect(first.changes).toContainEqual({ namespace: 'primary', table: 'students', key: 'b', deleted: true });
    expect(first.changes).toContainEqual({ namespace: 'storage', key: 'commentbank', deleted: true });
    first.accept(); expect(delta.prepare({ students: [{ id: 'a', name: 'Edited' }] }, {}, {}).changes).toEqual([]); expect(() => first.accept()).toThrow(/already/);
  });
  it('rejects duplicate identities and unknown tables instead of losing a record', () => {
    const delta = new WorkingDelta({ students: [] }, {}, {});
    expect(() => delta.prepare({ students: [{ id: 'same' }, { id: 'same' }] }, {}, {})).toThrow(/identity/);
    expect(() => delta.prepare({ other: [] }, {}, {})).toThrow(/table/);
  });
});
