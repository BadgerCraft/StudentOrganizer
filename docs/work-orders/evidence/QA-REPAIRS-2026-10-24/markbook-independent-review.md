# Independent QA-01 review

Reviewed MarkbookView.tsx opening snapshot/save changes, markbookService.ts expectedCellState checks, markbookConcurrency.test.ts and qaMarkbookConcurrencySmoke.ts. Read-only review; no product edits.

Verdict: no concrete blocker in QA-01.

- Opening SA/CR IDs and versions are captured before live-query refreshes. Save uses that snapshot rather than rereading newer prop versions.
- Explicit null distinguishes expected absence from legacy caller omitted concurrency checks. Existing/new competing rows, replacement IDs and changed versions fail.
- Queries and checks run inside the same rw transaction as metadata/score/audit/outbox changes. CR check occurs after an SA put but rejection aborts the whole transaction. No time-of-check gap to another IndexedDB writer on these tables.
- Soft-deleted records fail; no resurrection/overwrite. UI may not edit a tombstoned assignment, matching existing service restriction.
- Metadata-only writes validate the parent and do not touch category results. Blank-score UI still passes a string and validates CR baseline before clearing a mark.
- Old expected-version parameters remain functional; omitted-baseline callers retain their previous contract. This does not claim all older callers now enforce identity epochs or CAS.
- Error handler keeps activeCell, score, feedback and selections; user explicitly cancels/reopens to review current data. Browser harness exercises real app existing/absent editors with live-query updates and persisted audit/outbox equality.

Verification: markbookConcurrency.test.ts 5/5 passed independently. Additional disposable fake-indexeddb probes passed: soft-deleted SA and CR each reject with all tables unchanged; same-version parent replacement rejects; metadata-only update retains category exactly and invalidates older editor. Existing coordinator browser log is separate evidence, not independently rerun here.

Profile review is separate; preliminary P2 archived-U1 collision sent to coordinator for repair. No additional QA-01 repair requested.
