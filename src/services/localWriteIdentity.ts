import Dexie from 'dexie';
import type { OntarioTeacherDB } from '../db/database';
import { AuthorizationError } from './authHelper';
import { getActiveTeacherId, getIdentityEpoch, subscribeIdentityChange } from './identityService';

export interface LocalWriteActor { userId: string; deviceId: string; identityEpoch?: number }
export function captureLocalWriteActor(actor: LocalWriteActor) {
  const captured = { ...actor, identityEpoch: actor.identityEpoch ?? getIdentityEpoch() };
  assertLocalWriteIdentity(captured);
  return captured;
}
function assertLocalWriteIdentity(actor: LocalWriteActor) {
  if (getActiveTeacherId() !== actor.userId || getIdentityEpoch() !== actor.identityEpoch)
    throw new AuthorizationError('Acting teacher changed. Reopen this form before saving.');
}

/** Call inside a write transaction containing devices; abort even during queued final writes. */
export async function guardLocalWriteIdentity(db: OntarioTeacherDB, actor: LocalWriteActor) {
  const check = () => assertLocalWriteIdentity(actor);
  check();
  const transaction = Dexie.currentTransaction;
  if (!transaction) throw new Error('Local write identity requires an active transaction.');
  const unsubscribe = subscribeIdentityChange(() => transaction.abort());
  transaction.on('complete', unsubscribe);
  transaction.on('abort', unsubscribe);
  transaction.on('error', unsubscribe);
  const device = await db.devices.get(actor.deviceId);
  if (!device || device.userId !== actor.userId) throw new AuthorizationError('The acting teacher has no matching local device identity.');
  check();
  return check;
}
