# P0 Codex execution order — Markinator modes and photo markup

Owner: Codex implementation environment. Authorized by user October 13, 2026. Branch: codex/markinator-modes-photo-20261013 (based on main). Queue: docs/FEATURE_QUEUE.md F-008-MODES and F-008-PHOTO.

## Model routing
Use GPT-6.1 Codex (Sol) if selectable; verify actual availability. High reasoning for photo/local data/permissions; Medium for bounded three-mode UI work, escalate High if grading authorization or migrations require it. If unavailable choose the strongest available Codex coding model and document selection. Extra High only for unresolved consequential architecture or final integration review.

## Execute without further routine permission
1. Read AGENTS.md, docs/FEATURE_QUEUE.md, docs/markinator/CHECKPOINT.md and live PRs. Reconcile latest main and avoid duplicated work. Preserve any concurrent branches. Inspect marking models, rubric/KTCA flows, local attachment storage, backup/restore and teacher authorization.
2. Implement three entry modes: (a) written essay/document/image markup + rubric, (b) oral presentation customizable checklist + notes + rubric, (c) rubric-only. All must save/reopen and correctly attach to teacher/class/student/assignment.
3. Implement local-only capture/import of photographed handwritten pages in written mode: multiple pages, crop/rotate/reorder, non-destructive visual annotations (pen/highlight/comments), autosave/draft recovery, original retention, reopen and backup/restore. File import fallback where camera unsupported. Do not add OCR, AI cloud processing or remote URLs.
4. Preserve grade history, KTCA weights, audit trail, manual overrides, teacher authorization, cancellation safety, privacy, and existing assessment compatibility. No automatic external student-data transfer.
5. Add tests using fictional data for all three modes, multi-page image markup, restart and backup recovery, wrong-teacher writes, duplicate grade prevention, image URL rejection, and existing marking regressions. Run relevant suites, production build, browser marking acceptance. Record unverified physical Windows/iPad camera/device interactions explicitly.
6. Commit/push verified work and prepare PR(s) with precise evidence, known gaps and next gate. Do not merge/release, adopt providers, spend money, or use real student data without separate authorization.
7. Update F-008-MODES, F-008-PHOTO and workflow validation rows in docs/FEATURE_QUEUE.md as actual work progresses. Do not mark implementation complete based on this order.

Parallelization: split modes and photo into separate branches/worktrees only if isolated ownership and integration plan are verified; otherwise sequence on this branch to avoid conflicts. Continue autonomous approved work until a genuine decision or technical blocker.


## Execution checkpoint — October 14, 2026

Status: **implementation and development verification complete; prepared for review, not merged or released**. Branch `codex/markinator-modes-photo-20261013`. Verified application/tests: **`0347d94535e67b19a3f54ee02170f7e3af1aee63`**; a separate documentation/CI follow-up records this evidence. Base work-order commit `4bd96c6`, main `5a769cb`. Both remote heads were refreshed before publication; no concurrent change was found on the requested branch. Prior UI cleanup work at `66a3477` remains on its isolated branch, with its earlier evidence preserved; it was not merged here.

### Delivered behavior

- Three visible entry choices: written document/image + rubric, oral presentation checklist/private notes + rubric, rubric only. Each attempt pins its mode, rubric version, teacher, class, assessment and explicit student match. Text/DOCX import and rubric-free Organizer workflows remain available.
- Per-criterion evidence uses the pinned rubric's actual labels and descriptors. Oral checklists allow adding/renaming/checking/removing items and private notes; removal of checked/noted items requires confirmation. Evidence selections never calculate official marks. Existing explicit category judgments, manual-baseline review, completion-status policy, idempotent finalization and immutable revisions remain authoritative.
- Local JPEG/PNG/WebP page import plus an HTML camera file-input fallback. Camera selections accumulate pages; cancellation preserves the preview; selecting a local batch replaces only the unsaved preview. Explicit student confirmation precedes import. Limits: 10 pages, 8 MiB/page, 32 MiB/batch, 20 megapixels/page; unsupported formats, animated images and URL sources are rejected.
- Original bytes/hash/name/dimensions stay immutable on the attempt. Page order, original-coordinate crop, right-angle rotation and pen/highlight/comment anchors are stored separately in drafts. Cropped-out marks remain recoverable. Comment text and pinned criterion/label can be edited; undo/delete affect annotations only. Empty image comments save as recoverable drafts but must be finished or deleted before finalization.
- Autosave, Save now, navigation flushing, restart/reopen and full local backup/restore preserve mode evidence and originals. Scope/version/identity-revocation guards and atomic audit/finalization/restore writes are retained. Old v4 written records may omit every added field; v3 migration tests remain passing. No schema version or dependency change was needed. New-mode backups are intended for this implementation or newer, not an older application downgrade.
- Saved student reports contain deliberate rubric feedback and textual page comments. Original photographs, visual strokes and oral checklist/private observations remain local recovery evidence and are excluded from the student report. Full annotated-image/PDF export is still F-008-EXT, outside this order. Original photographs can retain camera metadata, including location metadata; originals and backups remain private local files.
- iOS camera/photo-library purpose descriptions were added without microphone/library-write permissions or a new plugin. Asset synchronization/static checks pass; actual permission prompts and camera behavior require device acceptance.

### Reproduced integration defects and fixes

1. A legacy draft without `rubricFeedback` could acquire only the first edited criterion and fail complete-matrix validation. The editor now initializes all pinned criteria on first edit. The actual two-criterion legacy UI sequence saves/reloads one edited criterion without touching grades.
2. Chromium applies JPEG EXIF orientation despite `imageOrientation: 'none'`. A real camera-style orientation6/8 file was rejected on swapped dimensions; same-size rotations/mirrors threatened consistent anchors. Import and preview now decode a temporary metadata-neutral copy (JPEG APP1, PNG eXIf, WebP EXIF/XMP removed with correct RIFF metadata), preserving retained original bytes/hash. All eight JPEG orientations have unit coverage; real browser orientations6/3/8/2 preserve source quadrant colors and anchors through recovery.
3. A slow next-page decoder left the old canvas visible while new-page annotations could be accepted. The exact page/hash/crop/rotation preview now controls visibility and pointer acceptance. Active strokes terminate safely on view changes. Independently reproduced red→blue delay and full browser page/rotation/crop delays reject marks until the correct pixels are drawn.

### Exact verification evidence

| Check | Observed result |
| --- | --- |
| Runtime | Node24.19.0, npm11.9.0; documented frozen dependency installation reused, no new package or environment configuration |
| `npm test` | **392/392 tests, 37/37 files pass** after the orientation/readiness fixes |
| `npm run build` | TypeScript/Vite production build passes; mixed static/dynamic import and chunk-size warnings remain |
| New domain suite | 47 tests: all modes/reopen, pinned links, immutable pages/transforms, invalid evidence/imports, unmatched/wrong-teacher/stale identity, independent grading, overrides/idempotence/revisions, atomic failure and identity-revocation rollback |
| Import/geometry suites | 24 tests, including all eight JPEG EXIF orientations and PNG/WebP decode-copy metadata preservation |
| New backup suite | 4 tests, including all mode evidence/revisions/legacy optional fields and 18 malformed snapshot cases that leave every table unchanged |
| `npm run test:marking:modes-photo` | **PASS**, nine scenario groups, final run11:06UTC. Four real JPEG EXIF6/3/8/2 pages; actual pointer strokes/comments; original anchors survive crop/rotation; reorder/autosave/reload; edited comments; explicit finalization writes T once while retaining K; revision preserves history; oral/rubric-only recovery; legacy matrix; URI/unmatched/wrong-teacher/idempotence domain boundaries; actual full-backup download, clean-profile preview/confirmed restore and reopened UI. Zero external requests/browser errors |
| `npm run test:marking:browser` | **PASS on the final production build**: rubric/TXT/DOCX/repeated and overlapping passages/pending feedback/restart/official finalization/report/revision/markbook flow, zero external requests |
| Existing category-recovery browser | **PASS**, four scenarios: replacement IDs, removed-category retention, incompatible pinned rubric, incompatible score mapping, failed save/reconcile and restart; official marks unchanged |
| `npm run test:marking:acceptance` | **PASS** input, authority and portability suites: malformed/partial imports, identity/membership revocation, failed-save navigation/retry, baseline conflict and idempotent retry, safe report/PDF rendering and real backup UI restore |
| `npx cap sync ios`; `npm run test:ipad:assets` | **PASS**, current bundled assets and static boundaries; plist also parsed successfully with both local photo purpose strings |
| `git diff --check` | PASS |
| Independent review | Completed critical service/validation/storage/UI/report/geometry paths; reproduced the three defects above and independently verified their repairs; no remaining source blocker found |

Existing category/input/authority/portability browser results were retained after the final photo-only decode/readiness repair because those paths were unchanged. The new modes/photo suite and production marking browser were run on the final implementation. Successful UI mutations use visible teacher actions; explicitly labeled domain-boundary calls and fixtures in the Vite acceptance script are not claimed as UI authorization flows. Local artifacts `/tmp/markinator-modes-photo-results.json`, screenshots and a fictional1.8MB backup are regenerable with the committed script; they are not the only recovery/handoff evidence.

The existing browser CI job now invokes `test:marking:modes-photo` and retains its result JSON/screenshots. Workflow YAML parses and those commands were run locally. **No new-head GitHub CI result is claimed.**

### Review publication and remaining gates

Git read access works. GraphQL PR listing and a bounded REST PR-list fallback both returned **Forbidden**. Existing draft PR state and latest CI metadata cannot be established; PR creation/update is therefore pending, without repeated identical attempts. The complete review text is saved in `docs/markinator/PR_DRAFT.md`; implementation `0347d94` was normally pushed and `git ls-remote` independently read back the exact full hash `0347d94535e67b19a3f54ee02170f7e3af1aee63`. This documentation/CI follow-up is published separately. API access is the only review-publication blocker. Main merge, release/distribution/signing/Store/spending/provider adoption and real-student use remain reserved.

Physical Windows/Mac/iPad camera, native file-picker cancellation, permissions, pen/touch, background termination, large-photo quota, installed-process restart and recovery are **unverified**. No iOS simulator/Xcode or physical device was available in this Linux environment. Node validates JPEG/WebP structure and PNG compressed pixels; full JPEG/WebP decoding is verified in Chromium and remains a native-codec gate. The strongest operational drawback is storage/backup growth from immutable original photographs and audit snapshots; bounded input and atomic failure are verified, not a maximum-capacity device benchmark or storage-purge policy. Browser reload is web-app restart evidence only.

### Routing and shared lessons

The dispatch tool accepted explicit `gpt-6.1-sol` selection: medium for bounded mode controls; high for image/data integrity, domain/backup tests and browser acceptance; xhigh for independent final integration review. Handoffs specified ownership, rationale, escalation triggers and observable completion. Consequential grading/authorization/geometry conflicts escalated to the coordinator; routine repairs continued within the approved order. This records actual agent dispatch, not a claim that this chat changed its own model or that future scheduled runs have tools.

The required `reuse-component-lessons` skill was searched in the cloud/executor catalogs and was unavailable. No current external lesson IDs/version or update is claimed; no authoritative collection was duplicated. Direct repository contracts and actual regression evidence guided the implementation.

Next concrete batch: create/update the review PR once repository API access is available, inspect its exact-head CI, then perform the ordered native camera/Files/touch/background/restart/backup acceptance on disposable Windows/iPad devices (Mac/Xcode for iPad). Select GPT-6.1 Codex Sol if available, high reasoning for native permissions/storage; confirm selectable model in the receiving environment, escalate unresolved data/grade loss to independent review, and finish only with actual device/CI evidence or a named blocker. Review/integration with the separately verified UI cleanup branch is a distinct gate; no main merge or release is authorized by this checkpoint.
