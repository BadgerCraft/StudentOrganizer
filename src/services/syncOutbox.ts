import type { OntarioTeacherDB } from '../db/database';
import type { SyncMutation, UUID } from '../types/schema';

export interface SyncPushResult {
  processedMutations: number;
  processedTransactions: number;
  failedMutations: number;
}

export class SyncOutboxWorker {
  // In-memory mock server ledger to test idempotency
  private static mockServerProcessedMutationIds = new Set<string>();
  public static simulateTransientNetworkError = false;

  constructor(private db: OntarioTeacherDB) {}

  /**
   * Processes all pending sync mutations for a specific device and organization.
   * Enforces:
   * - Strict deviceId and organizationId filtering.
   * - Transaction-level completeness: group size === transactionSize, contiguous 1..N sequence.
   * - Exponential backoff on transient errors up to 5 attempts before terminal 'failed' status.
   * - Atomic server ledger update: failed transactions commit zero records to mock server.
   */
  async processOutbox(deviceId: UUID, organizationId: UUID): Promise<SyncPushResult> {
    const pendingMutations = await this.db.syncMutations
      .where('[deviceId+organizationId+status]')
      .equals([deviceId, organizationId, 'pending'])
      .toArray();

    pendingMutations.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    if (pendingMutations.length === 0) {
      return { processedMutations: 0, processedTransactions: 0, failedMutations: 0 };
    }

    // Filter out records under exponential backoff
    const nowMs = Date.now();
    const readyMutations = pendingMutations.filter(m => {
      if (!m.lastAttemptAt || m.attemptCount === 0) return true;
      const lastAttemptMs = new Date(m.lastAttemptAt).getTime();
      const backoffMs = Math.min(300000, 1000 * Math.pow(2, m.attemptCount - 1));
      return nowMs - lastAttemptMs >= backoffMs;
    });

    if (readyMutations.length === 0) {
      return { processedMutations: 0, processedTransactions: 0, failedMutations: 0 };
    }

    // Group by transactionId to guarantee atomic transmission
    const txGroups = new Map<UUID, SyncMutation[]>();
    for (const m of readyMutations) {
      const group = txGroups.get(m.transactionId) ?? [];
      group.push(m);
      txGroups.set(m.transactionId, group);
    }

    let processedMutationsCount = 0;
    let processedTxCount = 0;
    let failedMutationsCount = 0;
    const now = new Date().toISOString();

    for (const [, mutations] of txGroups) {
      const firstMutation = mutations[0];
      const expectedSize = firstMutation.transactionSize;

      // 1. Transaction-level structural validations
      let integrityError: string | null = null;

      if (mutations.length !== expectedSize) {
        integrityError = `Incomplete transaction: expected ${expectedSize} mutations, found ${mutations.length}.`;
      } else {
        const seqs = mutations.map(m => m.sequenceNumber).sort((a, b) => a - b);
        for (let i = 0; i < expectedSize; i++) {
          if (seqs[i] !== i + 1) {
            integrityError = `Invalid transaction sequence numbers: expected contiguous [1..${expectedSize}], got [${seqs.join(',')}].`;
            break;
          }
        }
      }

      if (integrityError) {
        // Structural failures are terminally failed immediately
        failedMutationsCount += mutations.length;
        await this.db.transaction('rw', this.db.syncMutations, async () => {
          for (const m of mutations) {
            await this.db.syncMutations.update(m.id, {
              status: 'failed',
              attemptCount: m.attemptCount + 1,
              lastAttemptAt: now,
              lastError: integrityError
            });
          }
        });
        continue;
      }

      // 2. Simulated server transmission
      try {
        if (SyncOutboxWorker.simulateTransientNetworkError) {
          throw new Error('Simulated transient 503 network timeout');
        }

        // Atomic commit to server ledger only after all verifications pass
        for (const m of mutations) {
          SyncOutboxWorker.mockServerProcessedMutationIds.add(m.mutationId);
        }

        // Acknowledge locally and advance sync cursor
        await this.db.transaction('rw', [this.db.syncMutations, this.db.syncCursors], async () => {
          for (const m of mutations) {
            await this.db.syncMutations.update(m.id, {
              status: 'acknowledged',
              acknowledgedAt: now,
              attemptCount: m.attemptCount + 1,
              lastAttemptAt: now,
              lastError: null
            });
          }

          const lastMutation = mutations[mutations.length - 1];
          await this.db.syncCursors.put({
            id: `cursor-${deviceId}-${organizationId}`,
            deviceId,
            organizationId,
            cursor: lastMutation.createdAt,
            updatedAt: now
          });
        });

        processedMutationsCount += mutations.length;
        processedTxCount++;
      } catch (err: any) {
        // Transient error handling: keep 'pending' unless max retries exceeded
        failedMutationsCount += mutations.length;
        await this.db.transaction('rw', this.db.syncMutations, async () => {
          for (const m of mutations) {
            const nextAttempts = m.attemptCount + 1;
            const terminal = nextAttempts >= 5;
            await this.db.syncMutations.update(m.id, {
              status: terminal ? 'failed' : 'pending',
              attemptCount: nextAttempts,
              lastAttemptAt: now,
              lastError: err?.message ?? 'Sync transmission failed'
            });
          }
        });
      }
    }

    return {
      processedMutations: processedMutationsCount,
      processedTransactions: processedTxCount,
      failedMutations: failedMutationsCount
    };
  }

  static resetMockServer(): void {
    this.mockServerProcessedMutationIds.clear();
    this.simulateTransientNetworkError = false;
  }

  static isServerProcessed(mutationId: string): boolean {
    return this.mockServerProcessedMutationIds.has(mutationId);
  }

  /**
   * Applies an inbound mutation from remote server to local database.
   * Enforces photo preservation: If entity is 'students' and incoming payload
   * omits photoUrl, preserves the device's local photo.
   */
  async applyInboundMutation(mutation: SyncMutation): Promise<void> {
    if (mutation.entityName === 'students') {
      const payload = JSON.parse(mutation.payloadJson);
      await this.db.transaction('rw', this.db.students, async () => {
        const localStudent = await this.db.students.get(mutation.entityId);
        const mergedPhotoUrl = ('photoUrl' in payload)
          ? payload.photoUrl
          : (localStudent?.photoUrl ?? null);

        const updatedStudent = {
          ...payload,
          photoUrl: mergedPhotoUrl
        };
        await this.db.students.put(updatedStudent);
      });
    }
  }
}
