# Independent Markinator integration review — October 7, 2026

Reviewed complete integration aa64da1..157253670cd9db6a0f5ea0853da5ec7ee1ce4076. Tyler authorized this next batch with “Okay” after the independent-review recommendation. Root reviewed React action/autosave, rubric editing and integration connections; bounded independent reviewers inspected grade/authorization/history and import/restore/report boundaries. This is an integration review, not platform or general security certification.

## Result: scoped fixes applied; updated browser acceptance pending

1. **Grade integrity (confirmed by service reproduction).** Assessed finalization retained an existing missing/excused completion status. A saved/report score of 80 calculated as 0 for missing under zero_with_warning, or null for excused. `markingService.ts` now rejects assessed finalization for those two statuses before any official write. The teacher explicitly resolves completion in Organizer, then reviews/accepts the changed baseline. No implicit status conversion. Tests cover unchanged session/results/commit/audit records on rejection, explicit recovery, and supported not_assessed scoring.
2. **Original-document integrity (confirmed service boundary).** DOCX originals and marking text could individually pass hashes yet disagree. UI parsing ordinarily creates matching records, but importAttempt accepted changed/rehashed text that restore would reject. Shared `validateRetainedOriginal` now checks local extraction against marking text for both import and restore, before write transactions. Regression verifies mismatch rejection without attempt/audit mutation, plus valid original acceptance.
3. **Rubric editing (source-confirmed loss).** Changing tabs unmounted RubricEditor and discarded its unsaved matrix. It remains mounted while hidden, preserving tab navigation state. Close/teacher-switch and unload protect unsaved rubric edits. This is in-memory retention, not rubric-draft storage or crash recovery. The input acceptance script now checks tab retention and cancelled close. Build passes; actual updated browser behavior remains pending.

No additional concrete defect found in scoped teacher authorization/identity epoch, finalization transaction/idempotency, baseline conflicts, saved-history export, or bounded ZIP/XML and inert report paths. Source inspection is not a proof of absence. Report code escapes data and emits a restrictive CSP; no remote document/AI processing was added.

## Evidence and limits

- Fresh baseline: 281 tests pass at original tip. Fresh fixed source: **287 tests pass**, production TypeScript/Vite build passes; existing chunk/import warnings retained. `git diff --check` passes. No schema/dependency change.
- Existing expanded Chromium evidence at 0340661 remains historical evidence for unchanged behavior. It does not verify these fixes.
- Local Chromium unavailable; Playwright installation failed because the supplied downloads were empty/invalid archives. No successful browser run claimed. Existing browser CI now runs production marking, category recovery and expanded acceptance using its matching preinstalled browser.
- Windows/macOS/iPad runtime remains unverified. Browser CI is not native storage, touch, file picker or printer acceptance.
- GitHub access rechecked successfully; existing draft PR #20 found. Update it, do not duplicate it. Merge/release/real-student use remain reserved.

## Shared lessons applicability

Read Reuse Component Lessons index v8 and database document v6 (October 6). DB-001/DB-002 are SQLite-specific: reject engine-specific remedies, retain only the separate rollback versus retry questions and inspect existing Dexie regressions. DB-003/DB-004 are actual Dexie index lessons but seat replacement/tombstone deletion is inapplicable to immutable marking history; no such deletion introduced. Concrete review effect: require unchanged official and audit state on rejection, retain explicit retry/idempotency coverage, and keep original validation outside Dexie transactions. No new generic lesson claimed or shared collection updated.

## Next action

Observe the exact pushed revision's new browser CI step. Fix any demonstrated failure, then record its actual result before declaring this repair batch fully verified. Follow with the separate packaged/native runtime batch. No feature expansion or merge is needed to run these checks.

## Persistence and approval boundary

Source repairs committed locally at7bc967c. Automatic approval review rejected the push as remote mutation/code disclosure without explicit approval; no alternate write route attempted. PR20 existence and successful original-tip Windows/Mac/browser runs37720830159/37720830162 were read through the connector. These do not verify repairs. PR_DRAFT.md is prepared for an authorized update. Push approval is now the exact pending action; do not merge.

October7 at23:15 America/Toronto: Tyler explicitly approved pushing these repairs and updating PR20 (“Yeah nothing seems amiss there approved”). This resolves the prior approval blocker; merge/release remain separate.
