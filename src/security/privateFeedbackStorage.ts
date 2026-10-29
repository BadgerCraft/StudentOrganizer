import { addReviewedBankComments, assertCommentBankActor, loadCommentBank, saveCommentBank } from '../marking/commentBank';
import type { MarkingActor } from '../marking/types';
import { privateStorageRead, privateStorageWrite } from './encryptedRuntime';
export async function readFeedbackBank(actor: MarkingActor): Promise<string[]> {
  assertCommentBankActor(actor); const comments = await privateStorageRead(storage => loadCommentBank(storage, actor)); assertCommentBankActor(actor); return comments;
}
export async function writeFeedbackBank(actor: MarkingActor, comments: string[], mode: 'add' | 'replace'): Promise<string[]> {
  assertCommentBankActor(actor);
  const saved = await privateStorageWrite(storage => mode === 'add' ? addReviewedBankComments(storage, actor, comments) : saveCommentBank(storage, actor, comments));
  assertCommentBankActor(actor); return saved;
}
