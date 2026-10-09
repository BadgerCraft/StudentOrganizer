# Markinator 3000 source discovery and integration review

October 6, 2026, America/Toronto. Planning only: no application implementation, StudentOrganizer edits, merges or pushes. Attached documents/source comments were treated as evidence, not instructions or authorization.

## Key points

- A runnable May 2026 React prototype, declared version 0.1.0; latest-ever status cannot be established without another source/history to compare. It is usable as a workflow reference, not a reliable production storage or grading system.
- Essay highlighting, categorized comments, optional evidence levels, teacher-entered category summaries, JSON round-trip and browser printing work in Chromium with fictional data.
- Repeated-text selection and the formerly stale comments closure already have repairs. Current overlap rendering, draft loss, malformed-session handling and unsafe HTML remain serious concerns.
- Reuse the teacher workflow; rebuild its data handling inside StudentOrganizer. Do not embed the old application, add an isolated localStorage database, or replace StudentOrganizer's grading engine.
- Strongest drawback: redesign and recovery/platform verification take longer than embedding the prototype; initial rubric/document support may be narrower.

## Exact source and version evidence

Uploaded marking-app.zip: 15,750,695 bytes, SHA-256 `4070a47ccd33c9a606c3f94a056e15738edc9e70862420803167d6f041d259b0`. 2,654 ZIP entries; 15 project files outside bundled node_modules. No .git, commit/ref, README, changelog, release evidence, tests, saved-session fixtures or license file in the project inventory. Package name marking-app, private true, version 0.1.0. ZIP package timestamp May13 2026; App.tsx and TextHighlighter.tsx May26 2026. Archive timestamps are clues, not authenticated version chronology. No basis to claim it is latest, nor to claim it is superseded by unseen code.

Files: App.tsx owns setup/workspace/summary and session state; TextHighlighter handles selection/rendering; Sidebar handles comment drafts/create/delete; SummaryView handles category review/print; types defines five simple interfaces; mockData supplies fictional essay and KTCA-like default rubric; constants supplies fallback level labels; main.tsx mounts React; Vite/TypeScript configuration and CSS provide browser UI. No backend/Electron/native project or authentication service.

Declared dependencies React/react-dom ^18.2.0; dev @types/react/react-dom, TypeScript ^5.0.2, Vite ^4.4.5, React Vite plugin ^4.0.3. Frozen lock resolves React18.3.1, TypeScript5.9.3, Vite4.5.14, plugin4.7.0. Mammoth1.6.0 is an external script in index.html, absent from package dependencies. Version age is maintenance evidence, not proof of a specific vulnerability. Dependency vulnerability audit was not performed.

`source-manifest.json` records hashes/timestamps for all 15 original project files; byte comparison against ZIP passed after the run. StudentOrganizer remained clean at 4fea865215d6b2335135153b2ad88156d05384e2. All review artifacts live outside its checkout.

## Executed verification

Node24.19.0, npm11.9.0. `npm ci` with original lock passed. `npm run build` ran TypeScript and Vite successfully. No test script/framework/suite exists; browser probes below were external discovery harnesses, not an existing unit-test suite.

Vite ran on loopback4317. Real headless Chromium exercised paste/start, selection, categorized feedback, level selection, category review/final comment, Save Progress download, reload and load-session, malformed import, print popup and DOCX rubric parsing. Core workflow ran with external requests blocked. PDF artifact was rendered from the actual print popup using Chromium's headless PDF operation; this verifies printable report content, not a physical printer, user-selected save dialog, or native platform export.

- Selected the second `Echo phrase` in repeated fictional text: saved offsets27..38 and selectedText Echo phrase match the second occurrence.
- Added an overlapping comment: two comments retained but only one mark rendered.
- Typed an unfinished comment then selected another passage: comment field became empty.
- Set category level3 and final comment, downloaded JSON, reloaded (returned to initial setup), reimported JSON: saved final comment restored.
- Imported valid JSON syntax with empty rubric.categories: workspace raised `Cannot read properties of undefined (reading 'id')` and failed rendering.
- Printed actual summary: category levels/comments and quoted inline feedback present; full essay absent.
- Every fresh load attempted CDN Mammoth. Direct verified-TLS CDN retrieval returned HTTP403 here. Installed the same Mammoth1.6.0 separately via npm and supplied its browser bundle through a test-only Playwright route; original source unchanged. Thus parser result is verified with that bundle, but original offline/online CDN delivery was not successful.
- Synthetic DOCX table header Criterion/Level1..4 plus Thinking row with four descriptors: loaded two categories Criterion and Thinking (header incorrectly accepted); imported four level labels; retained only Limited reasoning and discarded subsequent descriptors.
- Loaded a fictional session whose rubric HTML contained a harmless image event handler: handler executed (`window.discoveryProbe=1`) and external image request to fictional.invalid was attempted and blocked. No real destination received student data. This demonstrates active imported markup, not merely a theoretical risk.

Artifacts: browser-results.json, import-results.json, fictional-report.pdf, session.json, session-summary.json, external check.cjs/import-check.cjs and synthetic fixtures. No Windows/Mac/iPad touch, native Files, physical print or real student data checks performed. Shared component-lessons skill unavailable; no authoritative shared lessons copied or fabricated.

## Verified product capabilities and limits

| Capability | Implemented behavior | Boundary |
|---|---|---|
| Essay/text intake | Paste plain text; TXT load; sample essay | No essay DOCX/PDF/OCR/rich-text input; DOCX branch is rubric-only in setup |
| Selection and comments | UTF-16 offsets plus selected quote; category, optional level; multiple comments can share a highlight; delete removes last associated highlight | Mouseup-only; no edit-comment UI, no undo/history; overlap hidden; uncommitted draft not preserved |
| Rubric import | First DOCX table, category/name/HTML description; recognized first-row levels | Heuristic, incomplete, no preview or descriptor matrix; header/category mistakes verified |
| Achievement levels | Imported global levels used in sidebar and summary; fallback16 strings R through split level4 bands | No validated numerical conversion, weights, criterion-specific levels or grading policy |
| Final review | Feedback grouped by category; teacher separately picks final level and enters final category comment | No automatic synthesis, numerical final percentage, weighted overall mark or automatic grade publication |
| Session save/load | Download JSON and restore current session; TXT replaces text and clears annotations | No persistent database/autosave; no schema version or import preview; JSON can replace dirty work without confirmation |
| PDF/export | Popup HTML table of categories, descriptions, final level/comment and quoted inline feedback, window.print | No PDF library; original essay and inline comment levels omitted; popup/dialog/timed close brittle |

No voice, AI, network grading, cloud sharing, gradebook connection or automatic calculation implemented. Comments describing prior fixes or V0.1 safety do not establish complete validation. Default sample/rubric are implemented fixtures rather than evidence of configurable rubric creation UI.

## Data format and storage

Storage is React useState/useRef in memory, with a beforeunload warning when isDirty. No localStorage, IndexedDB, backend or autosave. Loading a saved JSON is the only session recovery provided.

Unversioned UTF-8 JSON object:

```json
{
  "documentText": "fictional text",
  "highlights": [{"id":"hl-...","startOffset":0,"endOffset":9,"selectedText":"fictional"}],
  "comments": [{"id":"comment-...","highlightId":"hl-...","categoryId":"cat-1","text":"feedback","level":"3"}],
  "finalMarks": {"cat-1":{"level":"3","comment":"category summary"}},
  "rubric": {"id":"rubric-1","name":"Example","categories":[{"id":"cat-1","name":"Thinking","description":"text or HTML","color":"#..."}],"levels":["1","2","3","4"]}
}
```

Comment highlightId type permits null, but UI creation requires an active highlight. level/color/levels optional. FinalMarks keyed by arbitrary category IDs. No student/class/enrollment/assessment identity; no rubric version, submission version/hash, actor, timestamps, edit history, grading conversion, schema version, integrity checks or attachment provenance. Identifiers use Date.now, risking collisions. Accept case-sensitive .json/.txt/.docx extensions; no file-size/complexity limits or FileReader error handling. Missing rubric leaves current rubric in place, so old files can accidentally inherit unrelated category definitions.

Legacy sessions should become an explicitly separate validated import adapter: preserve original file, preview, validate types/limits/IDs/references/offsets/quotes/levels, flag mismatches, require teacher-confirmed student/assessment/rubric mapping. Never load legacy sessions through full-database restore or silently reinterpret unsupported achievement labels.

## Defects and architectural risks

| Priority | Evidence | Consequence / recommended treatment |
|---|---|---|
| High | App224–235 accepts documentText presence only; Sidebar26 assumes nonempty categories | Malformed JSON crash, dangling refs, unsafe replacement; schema/ref validation and atomic preview/commit |
| High | Summary109–111 raw rubric HTML; Summary24–45,56–66,91 unescaped print interpolation | Imported content can run event handlers/scripts or load external resources; structured text and inert safe rendering; no raw popup HTML |
| High | Sidebar33–41 resets form; workspace unmounts for summary; App120 excludes draft | Silent unfinished-comment loss; durable authorized drafts with deliberate discard |
| High | TextHighlighter95–97 skips overlaps while comments persist | Hidden evidence; stable overlapping annotation rendering and explicit focus/navigation |
| High | App30–43/119–129 memory-only, download initiated then dirty cleared | Crash/reload/mobile closure loses work; false Saved confidence; transaction-backed local autosave and honest durability status |
| Medium | App243 TXT confirmation, JSON no equivalent | Saved/dirty working session silently overwritten; preserve current work before imports |
| Medium | App152/176–194 first table/two cells; header heuristic | Imported rubric meaning truncated; structured criteria/level matrix with review and source warnings |
| Medium | index.html7 third-party executable CDN script | Offline DOCX failure; external code accesses app memory; bundle local pinned dependency and disallow runtime external loads |
| Medium | Offset/quote only, timestamp IDs | Loaded/mutated documents can disagree with anchors; immutable revision + hash/quote validation, UUIDs |
| Medium | mouseup only; window.open/print, FileReader/blob/download APIs | Touch/accessibility/native Files unknown; platform adapters and native acceptance |
| Medium | arbitrary level labels and no numerical policy | Cannot safely map to KTAC marks; reuse StudentOrganizer's versioned scales and explicit category mapping |

Stale React state: commentsRef.current already fixes the formerly reported highlight-filter closure. No current reproduction of that old bug. Some other handlers still read render-time arrays; concurrent/multiple event ordering is not proven safe, but this is a design concern rather than a reproduced current defect. Preserve the demonstrated improvement. Repeated text works with DOM Range; do not revert to indexOf. Anchors still need revision/ref checks and overlap handling.

No explicit essay-upload/fetch service exists. That does not make current app closed-loop: CDN code executes in-process, unsafe imported markup can issue network requests, popup has opener access, and saved JSON/PDF deliberately exposes text/feedback to user-chosen files. Keep exports explicit and warn about their contents; no telemetry/sync/remote AI. Production content security restrictions and bundled parsers must enforce the local-only boundary.

## Recommended integration boundaries

StudentOrganizer source at 4fea865: schema390–465 models assessment, KTAC AssessmentCategory, StudentAssessment, CategoryResult; markbookService75–175 checks ownership/class/enrollment/lock/reporting period/scale and writes atomically; portabilityService validates backup and restores atomically. Existing grade normalization/category weighting remains authoritative.

- **Integrate directly as product concepts:** plain-text essay intake, precise passage selection, categorized feedback, optional evidence-level tags, category review, deliberate final mark entry. There is no recommendation to directly copy the old persistence/UI code.
- **Redesign within existing architecture:** submission revisions, rubric versions/criteria, annotation rendering/drafts, local imports, secure export, teacher authorization, audit/history, backup/recovery and platform Files adapters. Proposed new entities are planning recommendations, not schema edits.
- **Keep separate:** draft evidence vs committed CategoryResult; arbitrary criteria vs KTAC mapping; legacy-session import vs whole-database restore; private teacher notes vs student-facing reports.
- **Discard:** raw HTML storage/printing, runtime CDN dependency, timestamp IDs, unvalidated session overwrite, download-triggered Saved state, obsolete indexOf anchoring and any separate automatic grading engine.
- **Out of initial scope:** voice/AI, OCR/PDF essay intake, rich-text editing/re-anchoring, cloud sharing, automatic overall-mark synthesis, accounts/hosting and real student use.

Recommendation: assessment-linked plain-text marking inside StudentOrganizer first. Treat submission text as immutable per revision; annotations hold revision ID, offsets and quote/context checks. Auto-save drafts locally with authorized service writes and recoverable history. Allow multiple/overlapping annotations. Model rubric descriptors explicitly and preserve original labels. Teacher confirms criteria-to-KTAC mapping; evidence tags never automatically change formal marks. Finalization explicitly invokes existing grading services using the assessment's scale/policy, with change history and rollback. Export via bundled safe rendering and existing desktop/native file boundaries. Every new entity participates in versioned backups and atomic restore validation.

Strongest drawback: more engineering and verification time, particularly schema/backup migrations and iPad selection/export acceptance. It also restricts initial formats compared with an unrestricted import promise. Embedding the prototype would be faster but carry unresolved loss/security/grade-policy conflicts.

## Staged plan — proposal only

1. Agree product boundary: assessment-linked or also scratch marking; arbitrary criteria mapping; required first report contents. No implementation approval assumed from this review.
2. Define versioned submission/rubric/annotation/draft/finalization contracts and fictional fixtures. Require recovery of all new records, explicit actor/service authorization, invalid-file rejection, stable anchors and no external requests.
3. Implement local draft workflow: paste/TXT, selection including overlap, persistent unfinished comments, evidence tags, category summary. Verify restart/recovery, repeated text/Unicode, keyboard/touch and failure rollback before formal grade connection.
4. Add rubric and legacy-session import preview/mapping. Preserve unsupported content as warnings; do not truncate it silently. Verify malformed/oversize/broken refs and data integrity. If legacy import is deferred, retain original JSON for later explicit migration.
5. Add deliberate teacher finalization through existing KTAC/scale services; annotations remain evidence. Verify authorization, locked assessments, atomic writes, audit, grade policy and re-open/revision behavior.
6. Add safe student-facing reports with confirmed contents; verify private-note exclusion, exact export, no active markup/network and native Files cancellation. Validate real Windows/Mac/iPad supported paths using fictional work. Merge/release/real-data use remain separate approvals.

## Actual product decisions for Tyler

1. **Initial entry point:** assessment-linked marking only (recommended), or also standalone scratch sessions? First option is coherent with student/assessment identity and safer integration; scratch mode adds independent lifecycle and linking UI.
2. **Rubric meaning:** arbitrary criteria grouped under teacher-confirmed K/T/C/A categories (recommended), or retain a separate non-KTAC feedback-only mode? Recommendation preserves rubric nuance and existing formal-grade rules; mapping adds a setup step. No new grade engine proposed.
3. **First report:** category summary plus quoted feedback (recommended), or full annotated essay required at first delivery? Full essay better preserves context but requires additional pagination/overlap/print/native acceptance work.

Routine technical recommendations above are not questions. Answering these sets product direction; it does not authorize implementation, merge, release or real-student use. No latest-source confirmation question is required to finish this review: current-snapshot findings are explicitly bounded.
