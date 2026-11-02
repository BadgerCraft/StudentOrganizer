# QA05 final independent persistence review

Reviewed frozen product source in /workspace/StudentOrganizer-qa-followup against baseline94851bf. Verdict: no remaining concrete blocker found in reviewed provenance, backup, archive and capacity paths. No product edits by this reviewer; root separately authorized one new fast test file, src/marking/captureReferenceIntegrity.test.ts. No commit/push.

Final review confirms metadata write/finalize checks include actual enrollment.studentId, source/root owner/assessment/class/enrollment, consistent root linkage, ordered page provenance, receipt contentHash/packageId/submissionId/student/class identity. Selected-page resolution validates original bytes/dimensions/hash and acting teacher epoch. Unknown references cannot enter ordinary inline import. Earlier finalize false-context gap is repaired with explicit validation before non-idempotent finalization.

Backup validators resolve only imported records and require ordered provenance plus cryptographically validated originals. Archive without marking work removes image references and visual drafts/audit snapshots but intentionally preserves independently held capture attachments/receipts. Archive with retained work resolves after restore. Capacity continues counting actual all-table pretty-printed backup bytes, including historical inline snapshots; no implicit historical byte deletion or inflated budget. Bind/append budget failure remains in same atomic transaction.

Compatibility note reviewed in docs/work-orders/QA-CAPACITY-SEATING-2026-11-02.md: reference records require updated reader; old strict readers fail closed. No table migration is not a promise of downgrade compatibility. Preserve current complete backup/original packages and use compatible reader or verified pre-change backup. The note accurately states retained independent archive policy.

Independent committed-candidate tests (test file uncommitted, owned by coordinator):
- 10/10 focused tests PASS; /tmp/studentorganizer-qa-followup/reference-integrity-tests.log (~2 seconds).
- Valid reference read/backup roundtrip; keep-work archive resolves after restore; no-work archive remains unresolvable while originals and receipts remain byte-for-byte retained.
- Four invalid backup variants: source page ID, unsupported reference version, wrong owner, missing source. Each rejects before changing any table, including newer fictional sentinel.
- Four live corruption variants: wrong student, wrong root owner, receipt package mismatch, missing source. Read, saveDraft and finalize each reject; every table unchanged. Restoring original provenance permits read retry.
- Force final assertCaptureBackupCapacity to fail during bind. Exact all-table rollback preserves captured originals/receipt and creates no partial attempt/session; restore actual guard and retry creates exactly one attempt/session.
- npx tsc --noEmit PASS; scoped diff whitespace check PASS. No heavy suite duplicated.

Large workflow evidence inspected (owner-run, not independently rerun): /tmp/studentorganizer-qa05/browser.log reports actual36,692,440-byte pixel payload, UI ZIP→match→five decoded pages, same-attempt draft/finalize/retry/reopen,49,200,555-byte complete backup/restore, annotated five-page PDF2,305,838bytes, reload dedup, zero browser errors/external requests. Parent owns whole-suite/integration/CI evidence; physical OS memory/power-loss behavior not certified here.

Reviewed source SHA256:
- markingService.ts:3e31d03c80ff3b3fdba1229bc7ae0fe8ae0dc8765bf8fda4f3bd7e3934ce305a
- captureReferences.ts:b092311fcfad4a824c5843815ba491b6923f08c6fc87e072ba4fbf2c9e642ac5
- capture/portabilityValidation.ts:96a784395e177c8a8ba02a854ac3415078413a5005ad4c6ea379dc1129ee9c19
- marking/portabilityValidation.ts:e5402dee10efc2bce1dddd1b27a3bc502c0074e3fe8b19c8c0ebd188e84cda41

Remaining gates: parent integration after newer main, full suite including new10 tests, exact-head CI and separately authorized merge/release. No encryption activation or live-data operations performed.
