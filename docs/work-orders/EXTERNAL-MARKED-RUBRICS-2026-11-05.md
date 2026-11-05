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


## Format fidelity investigation — follow-up requested November 5

Status: **bounded image/text workflow implemented; general marked Word/PDF support remains incomplete**. Safe local PDF rendering is architecturally practical, but is not present or verified in this patch. Faithful Word rendering is not achievable by merely changing the current Mammoth call.

Observed local experiment using installed Mammoth 1.13.0 and a synthetic DOCX containing a table, yellow highlight, red run text and red border:

- `extractRawText` returned only `Fictional marked grade: 3`.
- `convertToHtml` returned `<table><tr><td><p>Fictional marked grade: 3</p></td></tr></table>`: highlight, red text and border were absent. This is direct evidence against claiming that a simple HTML switch preserves marked appearance.
- [Mammoth official documentation](https://github.com/mwilliamson/mammoth.js/) also explains its semantic HTML emphasis, ignored table borders, and lack of HTML sanitization. Custom style mappings could recover selected formatting, but would not establish full Word page/mark fidelity. Do not replace stored extracted text or hashes: annotations and restore validation depend on them.

Current constraints: `MarkingDocument.original` validation permits only TXT/DOCX; `validateRetainedOriginal` reparses these formats and checks immutable hashes. Image pages only allow PNG/JPEG/WebP. No PDF renderer is installed. Electron uses sandbox/context isolation and protected-mode download/navigation guards. A generic embedded PDF plugin or external Office app would not by itself prove containment, side-by-side behavior or compatibility with protected storage. No external converter, plaintext temporary file or cloud upload was introduced.

Recommended concrete follow-on (same product objective, not yet implemented):

1. Bundle a pinned PDF.js renderer and matching worker/assets locally. Its [official API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html) accepts `Uint8Array` data; its [canvas examples](https://mozilla.github.io/pdf.js/examples/) support rendering individual pages with scale/rotation. Use in-memory bytes, never a remote document URL. Proposed design is inference from these APIs, not a completed runtime proof.
2. Add a versioned retained-PDF attachment contract with original filename, hash and bytes, separate from immutable annotated text. Extend validation/import/backup/restore/archive/sync-allowlist paths together. Do not disguise PDF bytes as images or insert placeholder text merely to satisfy current document validation.
3. Render one bounded page at a time with page selector and zoom beside the same grade sidebar. Bundle fonts/CMaps where required; prohibit network resource lookup, link navigation, document actions, downloads and scripting. Cancel render/worker activity on teacher change, lock and departure. Bound file/page/pixel counts, worker time and memory; errors must identify an unreadable page rather than silently omit marks.
4. Verify actual flattened highlight/ink/form appearance, rotation and multipage rubrics using fictional fixtures; explicitly flag unsupported interactive/XFA/dynamic content. Add malformed/encrypted/oversized inputs, network-denial checks, interruption/duplicates, backup round-trip, archive policy and protected Windows/Mac package checks.
5. For Word, recommend teacher-exported PDF with marks included once PDF intake is verified. A dedicated local Word renderer/converter could be evaluated separately against table/highlight/ink/font/page fixtures, but fidelity and packaging are not established by the current dependency. Preserve the working image-export route meanwhile.

This follow-on requires meaningful parser/storage/recovery and packaged verification work; it is not safe to label a UI-only viewer addition complete. No additional implementation authorization question is manufactured here: the requested investigation is complete, while PDF/Word implementation remains explicitly tracked work. Draft-PR publication is still denied as recorded above. This investigation update is local only pending that publication boundary.


## Publication resolved — draft PR60

New trusted user history supplied explicit standing authority to create/update PRs for approved implementation work, excluding merge/release/deployment. Readback again established that the denied operation had not executed. One retry of the same draft-PR creation succeeded: [PR60](https://github.com/BadgerCraft/StudentOrganizer/pull/60), open, draft, unmerged, initial implementation head `957c280`. The earlier denial and local-only statements above describe the historical checkpoint, not the current gate. This documentation and fidelity investigation are now being published to the same branch through an ordinary fast-forward push.

No implementation changed after the recorded checks; no duplicate test run is claimed. Current gate is review of the bounded image/text workflow and the concrete PDF/Word follow-on. Native packaged acceptance and exact-head CI remain unverified. Prepared educational walkthrough remains pending; no user acceptance or merge approval inferred.


## PDF implementation — approved continuation November 5

**Current status supersedes the earlier unsupported-PDF/follow-on checkpoint:** PDF batch import and read-only side-by-side page rendering are implemented. Word remains extracted text only. No merge/release/deploy is authorized.

Teacher flow: choose **Upload marked PDFs (class set)**, select up to 40 files / 32 MB total / 8 MB each, explicitly match enrolled students, review, and open grade entry. Each PDF supports 1–20 pages, with page navigation and zoom. PDFs reopen directly into final grading and direct category entry, including after restart. Original bytes, filename, SHA-256 and page count are retained in a version-1 attachment; no placeholder text or text extraction is required for scans. Same-name/content retries do not duplicate staging; identical files with distinct filenames stay available for separate student matches. Unsupported files can be retried/replaced or explicitly left out. Cancel PDF reading stops the active worker and preserves earlier staged work.

Architecture and limits:

- Pinned PDF.js 6.5.438; its parsing/rendering engine executes inside one disposable local worker at a time, with at most five waiting previews and a 15-second per-operation deadline. Cancellation terminates active work; queued cancellation is immediate. Production CSP permits only same-origin workers and retains `connect-src 'none'`/`object-src 'none'`. The worker also disables fetch. Fonts/CMaps are compiled into the worker; PDF.js and font/CMap licenses ship in `dist/pdfjs-licenses.txt`. No CDN, Office service, PDF link handler, script executor, attachment launcher or document HTML is used.
- The PDF.js standalone parser protocol is suppressed while importing its engine into the outer worker, then its internal loopback transport is used. Outer worker messages have an explicit result discriminator. This ensures timeouts can terminate both parser and raster work, rather than only abandoning a UI promise.
- Rendering produces inert PNG page pixels. Scans, saved highlight/ink appearance streams, rotation, coloured text and borders are covered by synthetic checks. Passwords, AcroForm/XFA and document/page scripts are rejected. Complex unsupported colour/transparency filters fail visibly. Inputs and page/image canvases are bounded to eight million pixels; higher-resolution scans may require optimization. These are input/time/pixel/concurrency limits, not an OS-enforced total-memory quota or universal PDF fidelity promise.
- Import inspects page metadata and eligibility but does not render every page. Unsupported content can still fail visibly when a page is opened; original bytes remain retained. Review the displayed pages before using their grades. No grade extraction or automatic Markbook update is introduced.
- Backup/protected native validation verifies attachment shape, limits, envelope and exact byte hashes before replacing records. It does not run the PDF renderer in the native host; full parser/render eligibility is checked in the disposable viewer, including after restore. This is an explicit integrity-versus-display distinction, not proof all restored PDFs render.
- PDF attachments are additive to existing attempt records (no index migration); old versions lacking PDF support reject PDF-only backups rather than silently accepting them. Use a PDF-capable version to restore these backups. Existing text hashes/annotation anchors remain untouched.
- Archive keep/remove applies to PDF live rows and audit/sync snapshots. Official marks and finalized feedback survive; complete backups retain originals according to the existing policy. Grade reports explicitly say original uploaded PDF pages are not embedded; no new original-file export bypasses protected export rules.

Verification at this increment:

- Full `npm test`: 131 files, 1,386 passed, 15 existing skips. Added seven real PDF service tests: duplicate-per-student versus equal bytes across students, invalid actor/enrollment/original rejection, failed-audit rollback/retry, backup+grade roundtrip and corrupt restore preservation, keep/remove archive and validation bounds.
- Focused PDF/storage/report/native-bundle validation: 34 tests pass; the retained PDF is accepted by the protected main-bundle validator and a corrupt PDF hash is rejected. Four additional worker-lifecycle tests cover deadline/termination, queued cancellation, active departure, ignored foreign/late protocol messages and bounded preview queue.
- `npm run build`: PASS including native validation compilation and local PDF/font/CMap license artifact. Existing large-chunk warnings remain. PDF engine/assets add approximately 4.34 MB uncompressed worker code; loaded on demand.
- `npm run test:marking:pdf-import`: production-build CSP PASS: real worker, bundled standard-font rendering, scanned pixels, saved highlight/ink appearances, rotation, malformed/script/form/oversized-page rejection, cancellation/retry and zero remote requests.
- `npm run test:marking:external-rubrics`: PASS including text/image regressions, two same-content PDFs, explicit malformed-file exclusion, immutable PDF original bytes, next-page display, yellow-highlight pixel assertion, manual grade transfer and actual browser backup/restore.
- `node --import tsx scripts/markingDesktopFocusedSmoke.ts`: PASS using the exact Windows/Mac packaged-acceptance helper against production renderer bytes. Added PDF import/view, byte preservation, backup/restore and visible reopen after browser reload. A harness assumption about selecting finalized work was repaired by explicitly reopening a draft; no finalization safeguard was weakened.
- `node --import tsx scripts/encryptedNativeAppSmoke.ts`: PASS with real native crypto/App/SQLite roundtrip, held publication, independent runtime restart and lost-acknowledgement handling; OS secret providers remain synthetic. This is adjacent protected-storage regression evidence, not actual OS-window PDF acceptance.
- Strict targeted harness TypeScript PASS after including the existing encryption bridge declaration; initial isolated typecheck omitted that shared declaration. Diff whitespace check passes.
- Independent read-only review: no remaining security/data-loss/grade blocker; confirmed visible Cancel and expanded scan/annotation tests. No absolute rendering-fidelity claim.

CI now runs PDF browser/runtime checks; existing Windows/Mac acceptance automatically exercises PDF pages in real packaged apps and after process restart. **Actual Windows/Mac PDF execution remains pending until those exact-head jobs pass.** Local evidence: `/tmp/pdf-tests.log`, `/tmp/pdf-final-unit.log`, `/tmp/pdf-lifecycle.log`, `/tmp/pdf-production-final.log`, `/tmp/pdf-final-browser.log`, `/tmp/pdf-desktop-renderer2.log`, `/tmp/pdf-protected-browser.log`, `/tmp/external-rubrics/pdf-beside-grades.png`. Fixtures are fictional, including marked vector/scan/annotation pages.

Walkthrough addition: a PDF is kept as the original file; the viewer paints a temporary page image so it can show marks without running PDF actions. Entering a grade still edits a draft; explicit Save transfers it to Markbook. Files that cannot be displayed safely show a repair/export instruction, not guessed marks. Prepared review remains DEFERRED; no comprehension answer or product acceptance inferred.

### Exact-head verification and Windows test allowance

The full local suite at PDF implementation head `cf2d3fe70df644215abe5c54e6b15d53db1270c0` passed all 132 files: 1,390 tests passed, 15 existing skips (`/tmp/pdf-exact-head-tests.log`). The exact-head protected browser CI job passed. Windows run 42084387916 stopped before package/PDF acceptance: the existing full-source structured SQLite roundtrip hit Vitest's default 5-second limit, then cleanup hit EBUSY while that operation was unfinished. No assertion mismatch was reported. A focused follow-up gives only that I/O test the same bounded 30-second allowance already used by adjacent encrypted SQLite fixtures, preserving every assertion. Local serial gate: 28 passed and 14 Windows-only skips (`/tmp/pdf-windows-gate-local.log`). Native Windows/Mac PDF acceptance remains pending; the PR tracks subsequent head/run evidence.
