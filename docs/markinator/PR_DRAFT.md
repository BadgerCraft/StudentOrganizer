Add assessment-linked local marking drafts, rubric/import workflow and guarded grade finalization

This draft introduces optional essay marking from an existing assessment. Teachers confirm a rubric's KTAC mapping, preview and match local TXT/DOCX/pasted submissions, save passage feedback, and explicitly finalize category judgments into the existing markbook. Original files, immutable document/rubric versions, drafts and finalized history participate in full local backup/restore. Existing direct marks, participation, privacy boundaries and grade calculations remain authoritative.

Validation:256 tests pass; production build passes; fictional production Chromium flow covers two-student import, repeated/overlapping/pending comments, restart, finalization, saved safe report, revision and markbook reopening with no external requests. Native assets synchronized/static-audited. Full evidence and reproduction commands: docs/markinator/CHECKPOINT.md.

This is an incomplete development checkpoint. Category edits while a draft has unsaved feedback can block its save/reconciliation path; expanded UI acceptance and Windows/Mac/iPad packaged/native checks remain. No platform pilot or merge readiness claim. Reports are saved inert HTML suitable for local Print/Save as PDF. No legacy session import or file-based rubric import in this version.

Review src/marking service/validation/portability boundaries first, then MarkingWorkspace and original-file parser/report paths. Base main aa64da1 already includes PR18. No merge/release/distribution/spending or real-student use authorized by this draft.
