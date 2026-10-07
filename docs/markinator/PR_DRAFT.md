Add assessment-linked local marking with recoverable drafts and guarded finalization

This draft adds optional essay marking to an existing assessment. Teachers confirm a rubric's KTAC mapping, match local TXT/DOCX/pasted submissions to students, save passage feedback, and explicitly finalize category judgments through the existing markbook service. Original files, pinned documents/rubrics, drafts and finalized history participate in full local backup/restore. Existing direct marks, participation, privacy boundaries and grade calculations remain authoritative.

Changing assessment categories while feedback is pending now saves the original draft before explicit category/rubric review. Compatible judgments can be retained only by teacher choice; removed or incompatible originals remain visible in recovery history. Incompatible pinned rubrics remain saved and block finalization until required categories are restored. Reconciliation is atomic, preserves pending comments and manual-mark conflict handling, and never changes official results. Legacy sessions and historical finalized feedback remain restorable after category-ID replacement.

Verified recovery source: `e06e07ca3fa82e54afd537a7c7532c8bcca0a604`; previous checkpoint: `b27954a68a3e05b5910df72305b2b66cdd8a993d`. Base main: `aa64da1b9cc3a98d7f77fd797c0dfe7bd0a6fb9b` (includes PR18).

Validation on October 7, 2026:

- 278 tests pass across 31 files, including 22 category-recovery regressions; production TypeScript/Vite build passes with existing bundle warnings.
- Production Chromium acceptance passes: two-student import, repeated/overlapping/pending comments, restart, finalization, safe report, revision and markbook reopening.
- Four actual recovery UI scenarios pass: explicit category replacement, removed feedback retention, incompatible pinned rubric followed by authorized restoration, and incompatible score mapping. Pending feedback survives reload/reopen; pre-existing official marks remain unchanged. Failed save/reconciliation does not falsely report recovery. Both browser suites observe zero external requests or page exceptions.
- Backup/restore covers legacy/reconciled/incompatible drafts and reopened finalized history; malformed snapshots/history reject atomically. Teacher authorization, stale reviews/versions, audit rollback and separate manual-mark review are covered.

Remaining review batches: expanded UI acceptance, then independent full integration review, then Windows/macOS/iPad packaged/native runtime and CI checks. This remains an incomplete integration checkpoint, not platform pilot or merge readiness. Incompatible category repairs may require assistance because the existing assessment screen has no category editor. Retained originals/history deliberately increase local storage. Reports are inert HTML for local Print/Save as PDF; legacy session import and file-based rubric import remain deferred.

Review service/validation/portability boundaries first, then MarkingWorkspace and parser/report paths. Reproduction commands and exact scope are in docs/markinator/CHECKPOINT.md. No merge/release/distribution/spending or real-student use is authorized by this draft.

PR publication status: existing-PR lookup returned GitHub GraphQL Forbidden during this batch. No PR was created; check for an existing draft on `codex/markinator-integration-20261006` before publishing this saved text when access returns.
