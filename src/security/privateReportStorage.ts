import { clearBugReportDraft, loadBugReportDraft, saveBugReportDraft, type BugReportDraft, type DraftResult } from '../services/bugReportService';
import { privateStorageRead, privateStorageWrite } from './encryptedRuntime';
import { getIdentityEpoch } from '../services/identityService';
type Request = { epoch: number; kind: 'save' | 'clear' | 'read'; run: () => Promise<unknown>; done: (value: any) => void; fail: (error: unknown) => void };
const queue: Request[] = [];
let running = false;
function enqueue<T>(kind: Request['kind'], action: () => Promise<T>): Promise<T> {
  const epoch = getIdentityEpoch();
  return new Promise<T>((done, fail) => {
    const request: Request = { epoch, kind, done, fail, run: async () => {
      if (epoch !== getIdentityEpoch()) throw Error('Teacher context changed before private report storage access.');
      const result = await action(); if (epoch !== getIdentityEpoch()) throw Error('Teacher context changed before private report storage was verified.'); return result;
    } };
    const last = queue[queue.length - 1];
    // Coalesce consecutive typing only. A clear/read is an ordering boundary and cannot be jumped.
    if (kind === 'save' && last?.kind === 'save' && last.epoch === epoch) {
      queue.pop(); request.done = result => { last.done(result); done(result); }; request.fail = error => { last.fail(error); fail(error); };
    }
    queue.push(request); if (!running) void drain();
  });
}
async function drain(): Promise<void> {
  running = true;
  try { while (queue.length) { const next = queue.shift()!; try { next.done(await next.run()); } catch (error) { next.fail(error); } } }
  finally { running = false; }
}
export const readPrivateReport = () => enqueue('read', () => privateStorageRead(storage => loadBugReportDraft(storage)));
export const clearPrivateReport = () => enqueue('clear', () => privateStorageWrite(storage => clearBugReportDraft(storage)));
/** At most one full-workspace commit in flight; typing coalesces without early saved acknowledgment. */
export function savePrivateReport(draft: BugReportDraft): Promise<DraftResult<void>> {
  const copied = structuredClone(draft); return enqueue('save', () => privateStorageWrite(storage => saveBugReportDraft(storage, copied)));
}
