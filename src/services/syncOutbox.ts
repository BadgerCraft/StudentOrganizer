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

  constructor(private db: OntarioTeacherDB) {}

  /**
   * Processes all unacknowledged sync mutations grouped by transactionId atomically.
   */
  async processOutbox(deviceId: UUID, organizationId: UUID): Promise<SyncPushResult> {
    const unacknowledged = await this.db.syncMutations
      .filter(m => m.acknowledgedAt === null)
      .toArray();
    unacknowledged.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    if (unacknowledged.length === 0) {
      return { processedMutations: 0, processedTransactions: 0, failedMutations: 0 };
    }

    // Group by transactionId to guarantee atomic transmission
    const txGroups = new Map<UUID, SyncMutation[]>();
    for (const m of unacknowledged) {
      const group = txGroups.get(m.transactionId) ?? [];
      group.push(m);
      txGroups.set(m.transactionId, group);
    }

    let processedCount = 0;
    let failedCount = 0;
    const now = new Date().toISOString();

    for (const [, mutations] of txGroups) {
      try {
        // Mock server push: verify idempotency
        for (const m of mutations) {
          if (SyncOutboxWorker.mockServerProcessedMutationIds.has(m.mutationId)) {
            // Server recognizes idempotent duplicate, returns success
          } else {
            SyncOutboxWorker.mockServerProcessedMutationIds.add(m.mutationId);
          }
        }

        // Mark as acknowledged locally
        await this.db.transaction('rw', [this.db.syncMutations, this.db.syncCursors], async () => {
          for (const m of mutations) {
            await this.db.syncMutations.update(m.id, {
              acknowledgedAt: now,
              attemptCount: m.attemptCount + 1,
              lastAttemptAt: now
            });
          }

          // Advance sync cursor
          const lastMutation = mutations[mutations.length - 1];
          await this.db.syncCursors.put({
            id: `cursor-${deviceId}-${organizationId}`,
            deviceId,
            organizationId,
            cursor: lastMutation.createdAt,
            updatedAt: now
          });
        });

        processedCount += mutations.length;
      } catch (err: any) {
        failedCount += mutations.length;
        for (const m of mutations) {
          await this.db.syncMutations.update(m.id, {
            attemptCount: m.attemptCount + 1,
            lastAttemptAt: now,
            lastError: err?.message ?? 'Sync transmission failed'
          });
        }
      }
    }

    return {
      processedMutations: processedCount,
      processedTransactions: txGroups.size,
      failedMutations: failedCount
    };
  }

  static resetMockServer(): void {
    this.mockServerProcessedMutationIds.clear();
  }
}

