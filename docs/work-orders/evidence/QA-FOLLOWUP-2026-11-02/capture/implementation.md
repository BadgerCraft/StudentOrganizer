# QA05 reference-backed capture repair

Worktree `/workspace/StudentOrganizer-qa-followup`, approved branch `codex/qa-capacity-seating-20261102`, base `94851bf2d668d85a33672b688e24c6a9f275eaf5`. No commits/push/live data.

## Reproduced boundary
`baseline.log` reproduces current main before edits: valid 36,700,510-byte five-page capture ZIP decodes/confirms, retains attachment+receipt, then bind throws `Combined image pages exceed the batch size limit`, zero attempts. Original source reproduction recovered from prior saved review.

## Implementation
Over32MiB capture sets now store explicit version1 attachment+source-page references in the existing marking attempt, alongside immutable page ID/hash/size/mime/dimensions. Originals remain in existing captureAttachments; no table migration or limit increase. Ordinary inline <=32MiB imports unchanged. Late appends promote representation preserving page IDs/order, draft coordinates, crop/rotation, judgments and optimistic versions. No splitting attempts or marks.

Authorized selected-page resolver validates current attempt page membership, teacher/assessment/class/enrollment/student/root/source order/receipt/provenance, original hash/size/mime/dimensions, actor epoch after async work. Draft/finalize writes validate metadata provenance transactionally without decoding all originals. Backup validates refs against imported snapshot only. Archive without work clears attempt pages, prevents resolution, preserves independently retained capture originals/receipts per existing policy.

Editor serializes pending reference decode jobs and cancels obsolete presentation. Retained history selects one original at a time; exports resolve/decode sequentially, flattening only report copies. The source row still contains up to80MiB and IndexedDB retrieves that row; references eliminate repeated bytes in attempts/audits and whole-attempt eager rendering, not source-row storage cost. No new URL/sentinel bypass.

## Evidence
- Initial95 capture/marking tests PASS.
- Expanded14 capture tests PASS (44.6sec), including inline2-page draft +35MiB late append preserving existing IDs/crop/rotation/judgments and same receipt on retry.
- Real pixel-data test PASS139.5sec:36,692,440 original bytes,49,200,109-byte full backup. Actual codec→confirm→bind→read hashes→draft→finalize/retry→reopen→full backup/restore→corruption rejection preserves data→archive clears work while originals remain.
- App tsc and standalone strict script tsc PASS.
- Independent persistence reviewer small corruption/missing-source read/save/finalize probes PASS; independent UI delayed service/page switch/teacher switch/missing source+retry probes PASS.
- Final focused suite and browser report workflow pending at time of this checkpoint; see final-focused.log/browser.log for latest.

## Compatibility and limits
No maximum increased:10pages,8MiB/page, original pixel constraints,32MiB inline and256MiB complete-backup admission remain. Full capacity guard runs after final writes inside transaction. Impossible workloads preserve records and original ZIP with guidance; no automatic discard/split. Ref backups require updated readers; older validators fail closed. A rollback must retain a current-reader backup and original capture packages; do not blindly revert to an older binary and expect new attempts to load.

## Remaining physical gaps
Cloud Chromium verifies local UI/decode/PDF rendering; Electron native PDF bridge, physical phone camera, Android hardware and low-memory mobile behavior are not certified. No remote/sync/encryption activation tested or changed.

## Final delegated verification
- `scripts/qaCaptureReferenceSmoke.ts` PASS actual36,692,440-pixel-byte ZIP through UI confirm→same attempt→allfive page previews. Service draft/finalize/retry→restart→49,200,555-byte full backup+restore→byte-for-byte each page comparison→annotated report flattened sequentially→genuine Chromium PDF2,305,838bytes→reload/reimport dedup. No page errors or external requests. PDF: `/tmp/studentorganizer-qa05/fictional-reference-report.pdf`.
- Independent lifecycle script `scripts/qaCaptureReferenceLifecycleSmoke.ts` PASS delayed read/decode cancellation, teacher switch, missing-original Retry, retained-history recovery. Strict script TS PASS.
- Final focused rerun95tests passed incl14 expanded append tests; duplicate large test was interrupted at parent request because parent fullsuite includes it. Earlier large regression passed139.5sec. Orphaned interrupted worker explicitly terminated; no test worker leak retained.
- Parent fullsuite/build results supersede these scoped checks. Parent reported both production builds PASS before fullsuite.
- `git diff --check` clean; no commit/push or environment security changes.
