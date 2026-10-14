# Integrate classroom UI and Markinator with local PDF export and minimal Archive

Teachers can use the verified classroom UI repairs together with all three marking modes and local multi-page photo markup. Finalized work now has a marked PDF action: Windows/Mac generate actual PDF bytes locally; browser development use downloads clearly labeled print-ready HTML. Photograph crop/rotation, strokes/highlights, numbered comments, written work, rubric and feedback are included without changing grades.

A separate read-only Archive tab retains student/class/assessment/date, final judgments and marks, pinned rubric and written feedback, and revision records. **Keep student work** defaults off beside export controls. Explicit archive removes known submitted source files/text/quotes/visual anchors from current records and internal audit/outbox copies in one transaction; opt-in retains work. Export alone never archives. Dropped-student names, private oral observations and retained category feedback remain visible. Previously soft-deleted archives and previously exported backups are not automatically purged.

Tyler approved this integration, PDF output, archive rule and immediate iPad shelving October14. iPad source/config/scripts and historical evidence remain intact with [a resume map](../blob/codex/desktop-export-archive-20261014/docs/SHELVED_FEATURES.md). iPad-only compilation is disabled; shared Chromium/WebKit checks remain. Phone capture is design-only. No new dependencies or schema version.

## Validation

- 474 tests/49 files pass; production TypeScript/Vite build passes. Existing mixed-import/chunk warnings remain.
- Typecheck for new browser scripts, Electron syntax checks, workflow YAML parsing and diff checks pass.
- Independent review reproduced and verified repairs for duplicate archived comment IDs and archived names after unenrollment;26 focused tests pass independently.
- Archive tests exercise source removal across live/audit/outbox/full backup, actual restore, grades/feedback preservation, opt-in, failed audit/identity rollback, repeat archive and stale authorization/version rejection.
- New browser archive/PDF tests and actual packaged Electron PDF tests are wired to CI. Packaged tests control only the save-dialog destination; they do not claim physical OS-dialog acceptance.

## Review boundaries

Remote final-head CI and native runtime remain pending. Local browser execution is unavailable because Chromium download returned truncated ZIP files. No browser/native pass is inferred from unit mocks. Windows/Mac physical file-picker/save-dialog/Gatekeeper/managed-device/capacity acceptance remains separate. iPad runtime is deliberately shelved.

This branch contains modes/photo PR30 source and latest verified UI cleanup66a3477 (not stale PR26 head), preserving their history. Review this combined candidate; do not merge older overlapping PRs independently without checking the final graph. Main merge, release/distribution, spending, service adoption and real-student use remain reserved.

Current queue and execution evidence: docs/FEATURE_QUEUE.md and docs/work-orders/MARKINATOR-MODES-PHOTO-P0-2026-10-13.md.
