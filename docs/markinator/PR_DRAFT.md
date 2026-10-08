# Add assessment-linked local marking with guarded finalization and recovery

Teachers confirm a rubric's KTAC mapping, preview and match local TXT/DOCX/pasted work, save passage feedback, and explicitly finalize category judgments through the existing markbook. Immutable originals, rubrics, drafts and finalized history participate in full local backup/restore. Draft changes do not change official marks. Student content remains local unless explicitly exported.

Independent integration review of aa64da1..1572536 found three scoped gaps. Repaired source at 7bc967c blocks scored finalization while completion remains missing/excused, validates retained DOCX against its marking text on import as well as restore, and preserves unsaved rubric edits across tabs with exit protection. Teacher completion choices remain explicit; no grade conversion or new schema was introduced.

Validation: original 281-test baseline rerun; repaired source 287 tests pass, production TypeScript/Vite build passes and diff whitespace check passes. Meaningful regressions cover failed-finalization no-write preservation, explicit status recovery, supported not_assessed scores, mismatched DOCX import and atomic restore rejection. Prior production/expanded Chromium evidence at 0340661 remains historical. Updated UI/browser checks have not run here: no browser executable and empty/invalid download archives. Existing browser CI gains production marking, recovery and expanded acceptance checks using its matching preinstalled browser.

Tyler explicitly approved pushing the repairs and updating existing draft PR #20 on October 7. Browser acceptance for the repaired revision remains pending; no merge or release approved. Source1572536 Windows CI37720830159 and Mac/browser CI37720830162 independently observed successful; these results do not verify local7bc967c or the new Markinator-specific native flows.

Remaining gates: push repairs; observe exact-source browser acceptance; then Windows/macOS/iPad Markinator runtime import, durable originals, finalization/restart, Files/printing/export and touch checks. No pilot or merge readiness claim. No merge/release/distribution/spending or real-student use authorized.

Evidence: docs/markinator/INTEGRATION_REVIEW.md, CHECKPOINT.md, UI_ACCEPTANCE.md and CONNECTIONS.md. Existing draft PR #20 confirmed; do not create a duplicate.
