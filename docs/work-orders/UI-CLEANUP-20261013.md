# Approved UI cleanup batch — verification and review handoff

> **October 14 scope update:** Tyler approved integrating the latest verified UI cleanup source with modes/photo on an isolated branch. Current Windows/Mac source and runtime checks remain agent responsibilities. All iPad-specific work is shelved; preserve it using [the resume map](../SHELVED_FEATURES.md). Older iPad next gates below are historical. Main merge and release remain reserved.

Status: **development verified; ready for review; PR publication blocked by GitHub API access**.

Authority: the authoritative queue records October 13 approval, and Tyler's current “StudentOrganizer — UI Cleanup Batch” instruction explicitly authorizes QA01/04–10 through diagnosis, bounded implementation, tests/build/browser checks, documentation, commits, pushes and PR preparation. Main merge, releases, external distribution, spending and real-student use remain reserved. Publisher/Store work, OCR, new marking modes and cloud services remain shelved or outside scope.

Branch: `codex/ui-cleanup-20261013`. Latest-main base: `f25493f70db2e1919573868bdfc18a5b3493491f`. Verified implementation: **`5225bd38d9d1a6ae17bb37ec88e72de6baa74b2c`**. Documentation follows in a separate commit. No application dependency, database schema or grade calculation was changed.

## Existing work and concurrent-source preservation

Initial checkout was clean on `work` at `b9a8790`. Git access retrieved latest main `6f6612c` and discovered existing UI repair source `a1c79c6`, `d991cca`, `f0806ff` on `codex/ui-repairs-20261013`. Git PR refs independently associate `f0806ff` with **PR26**. Its live open/closed, review and CI status could not be read: GraphQL PR listing, Actions listing and one REST PR listing returned Forbidden. No identical repeated requests were made. No active writer was observed in this task's agent tree; that does not establish cross-chat ownership.

The existing implementation/tests were reused in the requested branch rather than rewritten. Its conflicting old queue was replaced with the latest authoritative register, retaining the actual approval and current statuses. Unrelated Windows/iPad documentation additions were excluded. During testing, main advanced to `f25493f` with PR29 routing documentation and a WF004 queue row. The unpublished branch was rebased onto that latest main; application, tests, browser scripts and workflow bytes compared identical before/after rebase. No force push, existing-PR branch update or main merge was performed.

## Baseline reproduction and measured fixes

Baseline: detached latest-main checkout at `6f6612c`, disposable fictional profile, actual Chromium UI, thirteen screenshots and read-only table snapshots. No browser exceptions. Only fictional participation configuration was deliberately cleared to exercise its empty state.

| Issue | Baseline finding | Implemented/verified result |
| --- | --- | --- |
| QA01 | Cold new session already required explicit teacher selection. Reload of an existing selected session retained that session. | Preserve this boundary; remembered last profile offers explicit Continue, never automatic identity. Production browser checks cold launch, reload and a new session retaining the database. |
| QA04 | Seeded defaults existed, but empty configuration had poor guidance/recovery, group creation defaulted positive, and observation tooltips were absent. | Clear group empty states, matching creation defaults, consistent explanatory tooltips/44px targets and configure shortcut. Four starter controls are created only by an explicit teacher action when empty, atomically; custom/history records remain intact, revisit does not reseed. |
| QA05 | Blank preset was not reproduced on the clean baseline. All entries were displayed rather than selected-version content; nonnumeric I misleadingly showed 0%. | Load/display the actual class version, with loading/unavailable/empty states and no substituted percentages. I shows no numeric conversion. This is display only. |
| QA06 | No remove-from-current-class control. | Confirmed dropped enrollment retains stable student/enrollment IDs and all marks, attendance, observations and audit. Active seats are archived, selection cleared, and subsequent roster/seat reactivation preserves identity. Cancel/confirm, backup/restore, authority/version and rollback checks pass. |
| QA07 | Existing upload auto-resized a fictional 640×320 image to 256×128, with no crop controls. | On-device square crop/zoom/reposition with 256×256 JPEG preview, explicit Apply then Save. Cancel, replacement, late FileReader completion, identity changes and failed writes preserve prior photo. JPEG/PNG/WebP input capped at 10 MB and decoded raster at 16 MP; existing 64 KB stored-photo limit remains. Decoder peak allocation is not claimed bounded before decode. |
| QA08 | No unit management controls. | Create/edit/rename units, dates/order and unique codes with stable IDs and assessment associations. No unit deletion introduced. Context/version checks and atomic audit/outbox writes; actual create/edit/cancel/reopen pass. |
| QA09 | No assessment-detail collapse controls; course overall already existed. | Per-assessment collapse/expand uses the existing calculation engine, including configured unequal weights and partial evidence. Formative assessment summary remains displayable while the stored formative-exclusion course policy and overrides stay unchanged. Expand/edit access and before/after grade record checks pass. |
| QA10 | Assessment Hub and Markbook displayed A,C,K,T. | Copy-only KTCA sorting for those views, marking judgments/preview/rubric mapping/current results, recovery review and saved reports. IDs, weights, rubric links and original judgment arrays are unchanged. |

## Additional bounded repairs found during reuse

New roster/unit/starter methods initially trusted a supplied authorized teacher ID without validating active selection/device or surviving an away/back identity change. Regression cases reproduced unselected writes and mid-write commits. The shared local-write guard captures the identity epoch, validates the explicit actor/device inside transactions, and subscribes to identity revocation through transaction completion. Profile photo, assessment and policy writes used by these forms use the same boundary. Role/assignment checks remain authoritative; no authorization bypass was introduced.

Settings, Hub and Markbook drafts retire on class/teacher changes; profile/crop read callbacks cannot apply after cancellation or context replacement. Regression tests compare retained records, audit/outbox and atomic rollback, rather than only checking visible success messages. The reused dialog focus repair prevents delayed autofocus from redirecting typing in an already focused field.

## Verification

- **378/378 tests across 42 files pass**: `/tmp/ui-cleanup-tests.json`. Existing photo/scope test fixtures were updated to select a real local test identity/device; their privacy and preservation assertions remain intact.
- **Production TypeScript/Vite build passes**: `/tmp/ui-cleanup-build.log`. Existing chunk-size/mixed-import warnings remain. Node24.19.0/npm11.9.0, frozen `npm ci` with a writable `/tmp` cache. Electron binary download was skipped for this browser-only environment; no packaged runtime result is claimed.
- `npm run test:ui:cleanup`: teacher confirmation, assessment/unit/summary/order and photo/roster groups passed in the initial production run. Settings passed in a focused rerun after replacing an immediate post-commit DOM count with a wait for React's completed state. This corrected test timing, with no production delay. Every group reports zero external app requests/page exceptions. Earlier passes were retained because their code paths were unchanged.
- `npm run test:marking:browser` passes after final display changes: fictional import/annotations/restart/finalization/report/revision/markbook reopening; zero external requests.
- `npm run test:marking:category-recovery` passes all four cases after recovery-display ordering changes: pending feedback, removed/incompatible categories, storage failure, restart and unchanged official marks; zero external requests/page exceptions.
- Screenshots inspected include the narrow Settings layout with no horizontal overflow and the actual versioned conversion table. The baseline and final scripts operate only on fictional disposable profiles.

Reproduction commands:

```bash
npm ci --cache /tmp/studentorganizer-ui-npm-cache
npm test
npm run build
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:ui:cleanup
npm run test:marking:browser
npm run test:marking:category-recovery
```

The executable override is optional when Playwright-managed Chromium is installed. `UI_TEST_TASKS=participation-scale-settings` selects a focused task; invalid names fail rather than claiming an empty success. WebKit checks are wired into the existing browser CI job but could not run locally because its binary is unavailable. Latest CI could not be retrieved, and native Windows/Mac/iPad launch, photo picker, touch, dialogs and runtime checks remain unverified for this revision.

Temporary evidence: `/tmp/ui-baseline-summary.md`, `/tmp/ui-baseline-evidence.json`, `/tmp/ui-baseline-*.png`, `/tmp/ui-cleanup-browser.log`, `/tmp/ui-cleanup-first-browser-results.json`, `/tmp/ui-cleanup-settings-browser.log`, `/tmp/ui-cleanup-marking-browser.log`, `/tmp/ui-cleanup-recovery-browser.log`, and ignored `screenshots/ui-repairs-chromium/`. Scripts/source are committed; continuation requires none of these local files or a running worker.

## Review/publication and next action

Review text: `UI-CLEANUP-PR-DRAFT.md`. Preserve existing PR26; do not open a duplicate blindly. GitHub API access is the exact blocker to confirming its metadata, updating/retargeting review publication or verifying CI. The requested successor branch is the normal-push deliverable; no PR creation/update is claimed until actual API readback exists.

Next recommended batch: independently review the isolated diff and verify current CI/WebKit, then run available supported native interaction checks. Prioritize identity transaction boundaries, cancellation/read races, roster recovery and summary agreement with the existing grading engine. Main merge and release remain separate decisions. No new product decision was required for this bounded batch.

Routing recommendation to confirm in the receiving environment: GPT-6.1 Sol, high reasoning, for that bounded review/verification involving permissions and grading data. Model/effort availability in the receiving picker is unknown; no switch or launch is claimed. Escalate to supported extra-high effort if a data-loss race or grade disagreement is reproduced. Completion check: no unresolved consequential findings, exact tested source/CI recorded, queue updated and existing PR publication read back; native limits stated accurately.
