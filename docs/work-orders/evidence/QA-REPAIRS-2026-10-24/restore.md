# QA-04 restore integrity repair

Branch: codex/qa-integrity-repairs-20261024; baseline ca9523735325a1b8873ce824f8cf4066b9991da3. No commit/push, no live-data access.

Owned changes only:
- src/services/portabilityService.ts
- src/services/restoreGraphIntegrity.test.ts (new)

Implemented:
- Reject leading/trailing whitespace in all primary IDs and in references checked by the central restore validator; compare exact stored keys rather than trimmed keys. Existing marking/capture validators already resolve exact keys, and primary IDs now reject whitespace globally.
- Validate assessment→unit/class, studentAssessment→assessment/enrollment/optional redundant class, categoryResult→studentAssessment/assessmentCategory agreement.
- Validate assessment, policy, override and snapshot reporting period belongs to the owning class term. Added missing optional gradingPolicy period foreign-key validation.
- At coordinator request, enforce existing domain invariants for attendance enrollment/session class, seating enrollment/layout class, and participation enrollment/session class and non-null event-type organization.
- Validate imported snapshot only before replacement; no destructive repair or normalization of malformed links. Keep original atomic replacement transaction.
- Retain optional null/empty historical links, legacy missing assignment class backfill, soft-deleted historical records and historical audit/outbox references. No requirement that periods be current/open or data active.
- Index only relevant graph tables for the new checks rather than duplicating maps of large unrelated tables.

Tests:
- 22 new regression cases: 17 invalid-input rejection/preservation cases, a legacy missing-section cross-class rejection, and valid schema 2/3/4/5 roundtrips (includes absent additive tables and null/empty historical links).
- Every invalid fixture snapshots all DB tables after adding a newer fictional sentinel and asserts exact preservation after rejection.
- 9-file focused+nearby suite: 101/101 pass (restoreGraphIntegrity, backupValidation, portabilityService, migration, securityBoundaries, markingBackup, legacyBackup, modesPhotoBackup, capture attachmentService). Log restore-final-tests.log.
- After narrowing graph indexing to used tables, final new regression suite rerun: 22/22 pass; restore-final-focused.log.
- npx tsc --noEmit passes; restore-types.log. Scoped git diff --check passes.
- Initial seat regression fixture assumed a second seeded layout; corrected fixture explicitly creates a fictional second-class layout. This was a test fixture failure, not hidden product behavior.

Compatibility/risk:
- Existing backups with genuinely contradictory links or whitespace-corrupted identifiers now fail safely instead of replacing current data; no claim of automatic recovery for already corrupt backups.
- No live/historical private backups inspected. Existing supported fixture migrations and marking/capture backup suites passed. Root owns whole-repository integration checks and browser acceptance.
- Component-lessons authoritative references were unavailable in review context; no shared lesson modification claimed.

Recommended next action: independent review plus integration checks of the full repair batch; no remaining blocker specific to QA-04.
