# Independent profile UI/replay/audit review

Reviewed `profileAssessmentService.ts`, `StudentProfileModal.tsx`, `profileAssessmentService.test.ts` and `qaCustomAssessmentSmoke.ts` in the approved repair batch working tree. Reviewer: desktop_review. Read-only review; owner applied all fixes. No remaining concrete blocker in this review slice after recheck.

## Found and resolved during review

Confirmed in real Chromium with delayed invocation of actual ProfileAssessmentService: Save captured 'Opening draft'; while pending the input accepted 'Later unsaved edit'; completion saved the opening title and hid/cleared the later text with no errors. Local log `profile-review-repro.log` preserves fictional evidence. Owner repaired with disabled fieldsets, pending close/settings/Cancel guards and `allowStudentTransfer={!profileSaving}`. The latter matters because ModalDialog's dismissal helper otherwise reports success even when a supplied onClose no-ops.

Also identified override save/conflict error rendered behind its active modal. Owner moved a visible scoped alert into the override modal and retained entered values after a version conflict. Regression now asserts visible alert within that dialog rather than only attached background text.

## Final evidence

- Independently reran `QA_CUSTOM_PORT=4275 node --import tsx scripts/qaCustomAssessmentSmoke.ts`: PASS. Real component/IndexedDB, fictional records, loopback traffic only. Pending custom and override fields/Cancel/settings/close disabled; Escape cannot dismiss; invalid score rolls back and correction double-submit saves once; newer override remains95 while failed editor retains92 with visible error; period removal does not silently retarget; explicit next-period recovery succeeds; read-only save denied; backup roundtrip passes. Log `profile-independent-browser.log`.
- Independently reran `npx vitest run src/services/profileAssessmentService.test.ts`: 7/7 PASS at review time. Log `profile-independent-tests.log`.
- Receipt review: request-derived stable ID + atomic audit receipt compares actor and submitted signature; identical replay returns existing assessment without new inserts. Tests replay after backup/restore without count increase and after a newer mark93 without reverting it. Different payload under same operation ID fails. Authorization and epoch are checked before replay, preventing the receipt from granting revoked access.
- Attribution review: creation group uses contiguous outbox sequence and full group size (three rows or optional unit fourth row), actor and owning organization; category result service appends its own group inside the same encompassing Dexie write transaction. Failure-injected later outbox errors roll back creation and mark together. These are local atomicity guarantees; there is no production sync sender, so do not imply remote atomic application of separate groups.
- Opening override snapshot, expected ID/version/absence, actor epoch and in-transaction guard preserve caller intent and reject concurrent overwrites. Form target is keyed to enrollment in App; service also checks enrollment/class/organization ownership. Reporting-period/calendar and broader backup graph semantics reviewed separately by persistence reviewer.

Temporary reproduction script `scripts/.qaProfileLifecycleReview.ts` removed after the owner incorporated permanent regression; no source edits made by reviewer. Native packaged UI and physical platform acceptance not exercised by this focused browser fixture. Parent owns combined final suite/build/commit/PR evidence.

This report was preserved under its distinct UI-specific filename after two reviewers inadvertently used `profile-independent-review.md`. It does not overwrite or replace the domain review.
