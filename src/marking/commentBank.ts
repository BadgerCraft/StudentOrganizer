import { parseDelimitedText } from './delimitedText';
import { parseMarkingFiles } from './importDocuments';
import type { MarkingActor } from './types';
import { getActiveTeacherId, getIdentityEpoch } from '../services/identityService';

export const COMMENT_BANK_LIMITS = { entries: 500, characters: 5000, totalCharacters: 200000 } as const;
const key = (userId: string) => `ota.comment-bank.v1.${encodeURIComponent(userId)}`;
export function assertCommentBankActor(actor: MarkingActor): void {
  if (!actor || actor.userId !== getActiveTeacherId() || actor.epoch !== getIdentityEpoch()) throw new Error('The acting teacher changed. Reopen the comment editor before continuing.');
}
export function validateBankComments(comments: unknown): string[] {
  if (!Array.isArray(comments) || comments.length > COMMENT_BANK_LIMITS.entries || comments.some(text => typeof text !== 'string' || !text.trim() || text.length > COMMENT_BANK_LIMITS.characters || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/u.test(text))) throw new Error('Use at most 500 nonempty comments, each up to 5,000 characters, without unsupported characters.');
  if (comments.reduce((count, text) => count + text.length, 0) > COMMENT_BANK_LIMITS.totalCharacters) throw new Error('The comment bank exceeds 200,000 characters.');
  return [...new Set(comments.map(text => text.trim()))];
}
export function parseCommentBank(input: string, format: 'text' | 'csv' | 'tsv' = 'text'): string[] {
  const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!text.trim()) throw new Error('Add comments before reviewing the bank.');
  if (text.length > COMMENT_BANK_LIMITS.totalCharacters) throw new Error('The comment bank exceeds 200,000 characters.');
  let comments: string[];
  if (format === 'text') comments = text.split('\n').filter(line => line.trim());
  else {
    const rows = parseDelimitedText(text, format === 'csv' ? ',' : '\t');
    if (rows.some(row => row.length !== 1)) throw new Error('Use a single Comment column for CSV or tab-separated banks. Export other columns separately before importing.');
    if (/^(comment|comments|feedback)$/i.test(rows[0]?.[0].trim() ?? '')) rows.shift();
    comments = rows.map(row => row[0]);
  }
  if (!comments.length) throw new Error('No comments were found.');
  return validateBankComments(comments);
}
export async function importCommentBankFile(file: File): Promise<string[]> {
  const extension = file.name.toLowerCase().split('.').pop();
  if (extension === 'csv' || extension === 'tsv') {
    if (file.size > COMMENT_BANK_LIMITS.totalCharacters * 4) throw new Error('Comment-bank file is too large.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length !== file.size || bytes.length > COMMENT_BANK_LIMITS.totalCharacters * 4) throw new Error('Comment-bank file size changed or exceeds its limit.');
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Error('Comment-bank files must use valid UTF-8 encoding.'); }
    return parseCommentBank(text, extension);
  }
  if (extension === 'doc') throw new Error('Older .doc files are unsupported. Save the comment bank as .docx, UTF-8 .txt, or a single-column CSV.');
  const result = await parseMarkingFiles([file]);
  if (result.errors.length) throw new Error(result.errors[0].message);
  return parseCommentBank(result.documents[0].text);
}
export function loadCommentBank(storage: Pick<Storage, 'getItem'>, actor: MarkingActor): string[] {
  assertCommentBankActor(actor);
  const raw = storage.getItem(key(actor.userId));
  if (raw === null) return [];
  try { return validateBankComments(JSON.parse(raw)); }
  catch { throw new Error('The saved comment bank could not be read. Import an exported bank to recover it; the saved data has not been changed.'); }
}
export function saveCommentBank(storage: Pick<Storage, 'setItem'>, actor: MarkingActor, comments: string[]): string[] {
  assertCommentBankActor(actor);
  const checked = validateBankComments(comments);
  storage.setItem(key(actor.userId), JSON.stringify(checked));
  return checked;
}
/** Additive saves merge the latest stored bank, including additions from another
 * mounted composer. A stale picker snapshot must never erase newer comments. */
export function addReviewedBankComments(storage: Pick<Storage, 'getItem' | 'setItem'>, actor: MarkingActor, reviewed: string[]): string[] {
  const incoming = validateBankComments(reviewed);
  const current = loadCommentBank(storage, actor);
  return saveCommentBank(storage, actor, [...new Set([...current, ...incoming])]);
}
export function exportCommentBank(comments: string[]): string {
  return ['Comment', ...validateBankComments(comments).map(text => `"${text.replace(/"/g, '""')}"`)].join('\r\n');
}
