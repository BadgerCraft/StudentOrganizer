# Externally marked rubrics — November 5, 2026

## Authority and completion criteria

Tyler requested: choose/create assignment, upload already marked rubrics, match filenames to students, view document beside grade entry linked to Markbook. Clarification: this is an easy way to add information already marked outside SO. Implementation, checks and draft PR authorized by delegated task; no merge, release or deployment. Start: current main `7860bb6`, no open PRs returned by live connector search; clean checkout. Branch `codex/external-marked-rubrics-20261105`.

Acceptance: an assignment-local entry works without reconstructing rubric criteria; local batch intake has explicit format/size limits; every student association is reviewed and correctable before saving; identical content for different filenames stays separate; existing saved submissions/grades remain intact; uploaded work is visible beside manual grade entry; explicit save uses existing Markbook finalization; failures and interruption guidance are truthful. No new persistence schema, network sender, extraction of grades or change to grading arithmetic.

One implementation stream, bounded read-only review used inherited model/effort for consequential grading UI; escalation condition was a demonstrated data-preservation, authorization or verification failure. Observable review completion: actionable findings and source evidence. No model-setting change claimed.

## Implementation and teacher walkthrough

Open/create the assignment through the existing Markbook/assignment controls, then open its marking workspace and choose **Import already marked rubrics**. The app creates/reuses a category-entry template using that assignment's existing K/T/C/A categories. This is not an inferred reconstruction of the external rubric. Upload files, choose students, explicitly match each filename, correct matches with Undo/change, and review before saving. Same-name ambiguity is never resolved by an automatic student assignment; enrollment IDs remain authoritative.

The first saved submission opens in Final grading with its uploaded work visible beside category buttons. Choose a category and enter its existing grade directly; this route skips collected-evidence controls. Save and next / Save and return to Markbook use the existing protected finalization. Ordinary annotation remains available, and the standard grading view also gains a reference pane when documents exist. Oral/rubric-only layouts remain full-width.

Draft grades are separate from official grades: editing is saved locally, but official Markbook entries change only on explicit finalization/save. Existing concurrent-result and changed-category checks are unchanged. A grading template is a saved configuration, not a second assessment or imported mark.

## Formats and recovery limits

- PNG/JPEG/WebP preserve visible marks. Existing limits: 10 images per batch, 8 MB each, 32 MB total. Import additional batches for a larger class.
- TXT/DOCX: 10 files, 2 MB each, 10 MB total. DOCX ZIP: 40 documents, 2 MB each, 10 MB total. Original bytes remain local and existing backup/archive behavior is unchanged.
- DOCX display is **extracted text only**: no faithful table layout, colour, highlighting or handwritten/image-only marks. Use image exports for those rubrics. PDF and legacy DOC are unsupported. No PDF or faithful DOCX viewing claim.
- Within a batch, filename + content identity prevents identical differently named rubric files from collapsing. Reselecting a same-name/same-content file is deduplicated. Same-name/same-content copies require distinct names if they are intended as separate students' work; no automatic guessing.
- Existing per-student duplicate detection blocks repeated saved submissions. Already saved records are retained. Partial saves retain in-memory receipts so retry only creates missing submissions. Unsaved previews/matches do not survive a restart; inspect the saved marking queue before reimporting remaining files. Existing page-departure warnings remain.
- No new upload destination. Optional sync behavior is unchanged; this feature adds no transmission. No live student data was used.

## Skills and applicable lessons

No repository `.agents/skills` exists in this checkout; executor skill catalog is empty. Installed cloud `reuse-component-lessons`, `verify-build`, and `explain-back` read. Shared index v10 (2026-10-10), workflow backlog v2 (2026-10-07), database v6 (2026-10-06), browser-touch v2 (2026-10-01) consulted.

DB-001/002's rollback-versus-retry distinction prompted explicit duplicate and partial-save checks, but their SQLite pilot does not establish Dexie correctness; actual existing service and browser/unit evidence is used here. DB-003/004 index swap/tombstone remedies do not apply and were not copied. BRW-001's actual action/geometry principle prompted real browser matching, decoded image and side-by-side bounds assertions; the seating-specific CSS remedy does not apply. BRW-002/003 cache remedies are unrelated; no cache changes. Shared lesson updates are not claimed.

## Verification

- `npm test`: PASS, 130 files; 1,379 passed and 15 pre-existing skips. Includes two new file-identity regressions plus existing partial receipt, authorization, Markbook, backup and interruption coverage.
- `npm run build`: PASS after final source changes; existing large-chunk warning only. Linux native build hooks completed; this is not a Windows/Mac packaged run.
- `npm run test:marking:external-rubrics`: PASS in real Chromium: empty-template assignment entry, two identical text files, explicit unsupported PDF exclusion, corrected matches, review, visible original, draft preserves official results, explicit exact-level transfer, next submission, queue reopening, two identical image files, decoded image and side-by-side layout.
- `node --import tsx scripts/focusedMarkingSmoke.ts`: PASS, existing annotation, evidence order, keyboard guards, category decisions and exact-level finalization.
- `git diff --check`: PASS. No new dependency, schema, network service, secret or disabled safeguard.
- Independent review found sticky category buttons overlapping the editor and an unnecessary half-width no-document layout. Both repaired; fresh browser screenshots visually inspected. Reviewer found no changed grading calculation or authorization bypass. External grade controls simplified after review.
- Local evidence: `/tmp/external-rubrics/results.json`, `grades-beside-rubric.png`, `image-beside-grades.png`; `/tmp/external-tests.log`, `/tmp/external-build.log`, `/tmp/external-focused.log`. Synthetic image fixture is a screenshot of fictional test UI, not a real marked student rubric.

UNVERIFIED: packaged Windows/Mac operation, real-device acceptance, new post-change CI and Tyler's product acceptance. No changes to native storage/packaging; existing platform checks are not claimed for this revision. Format limitations above are implemented restrictions, not passing fidelity claims. Assignment creation itself reuses the existing path; the new browser fixture starts with an assignment.

## Review and next gate

Implementation and local verification ready for draft PR. Walkthrough prepared here; comprehension/product acceptance DEFERRED to Tyler's review, no inferred answer. Suggested single discussion prompt: when entering a grade beside an uploaded rubric, which action should make it official in Markbook? The answer is explained above; this is not a permission gate. Review the actual teacher flow and file-format limitations, then separately decide any merge. No unsolicited scheduled follow-up created.


## Publication outcome and blocker

Implementation `957c2806935b05daef48795f828ffc55cd3dbc86` pushed normally to `BadgerCraft/StudentOrganizer`, branch `codex/external-marked-rubrics-20261105`; `git ls-remote` independently confirmed the exact SHA. Independent reviewer subsequently checked both fixes and screenshots and reported no remaining focused-review blocker.

**DENIED:** `github_create_pull_request`, target `BadgerCraft/StudentOrganizer`, head `codex/external-marked-rubrics-20261105`, base `main`, draft true. Automatic approval review reason, verbatim: "Creating a draft pull request is an external repository commitment, and the user authorized the feature implementation but not publication to this repository; the transcript explicitly says fresh approval is required before merge/release/deploy."

The delegated task explicitly requested a draft PR and repository AGENTS records standing review-publication authority. After denial, user_message_read.read_messages was consulted, then approval history searched; the accessible recent messages confirmed feature scope but supplied no materially new explicit draft-publication authority. No retry or alternate publication path was attempted. Connector PR search readback found no PR for this branch. Exact operation remains denied, not uncertain or pending execution. Resume only with materially relevant authorization evidence; then retry the same denied operation once and verify the created draft. Do not merge/release/deploy.

This blocker update is committed locally only; implementation and initial work record are already on the remote branch. A fresh user confirmation may be needed for the external draft-PR creation, which publishes review metadata but does not merge code. No further publication is claimed.
