# Classroom-use fixes — October 15, 2026

Authority: Tyler's pasted ten-part classroom-use request explicitly authorizes implementation, testing, commits/push and review preparation. Merge/release/distribution and real student data remain reserved. No cloud services, mobile or Control Panel expansion. Full request is represented by TUV-C01–C10 in the current queue; participation selection judgment remains deferred.

## Recovery and routing

Fetched origin and verified PR31 merged through GitHub and Git. Fresh branch `codex/classroom-use-20261015` starts at main `495ba2af97663123ac332ba258a8c0e7f820ec13`; prior review head is not assumed current. Existing open PR26 is historical source already integrated through PR31; no changes made to it. Preserve concurrent Windows-delivery branch.

AGENTS calls for bounded parallel agents. Actual available GPT-6.1 Sol/high selected for profile authorization, exact scale/Markbook, guided import matching, rubric parsing/comments, and evidence/popup work. High reasoning is proportionate to cross-component data/identity/persistence and interaction risks. Separate file ownership; coordinator owns MarkingWorkspace, marking validation, shared docs and final integration. Escalate on demonstrated preservation/authorization risk or failed integration, not by default. Observable completion: focused meaningful tests, full relevant regressions, type/build and fictional browser acceptance, then source review and remote commit/PR readback. Physical desktop claims require separate measured native evidence.

Required shared `reuse-component-lessons` skill unavailable in current catalog/workspace; no lesson IDs or application claimed. Existing project components/tests are the implementation reference. Screenshot mentioned by Tyler was not supplied; inspect actual app, no image-review claim.

## Changes mapped to Tyler's request

| Queue ID | Delivered behavior | Preservation / boundary |
| --- | --- | --- |
| TUV-C01 | Fresh launch displays Enter Teacher here; create first/second teacher, explicitly choose, edit own profile, switch and reopen | Production no longer calls demo seeding. Existing profiles are never renamed/deleted. Actor epoch/device/membership checks and profile transaction abort prevent stale writes. Local profile selection is attribution, not authentication. |
| TUV-C02 | KTCA names/order, saved levels by default; eye control shows percentage details; live Markbook updates | Arbitrary old percentages display as direct marks, never invented levels. Feedback-only and unassessed remain distinct. |
| TUV-C03 | Tall student popup at approximately 50vw desktop and responsive narrow width; X/backdrop/Escape/focus trap | Existing dirty confirmation retained; overlay events cannot activate background students. Intentional group participation unchanged. |
| TUV-C04 | Local TXT/DOCX/CSV/TSV rubric input, full table-row/descriptor parsing, concise editable criterion/category review | Multiple criteria per category retained; ambiguous mappings cannot be saved without review. Original uploaded rubric and referenced screenshot were not supplied; reproduction uses representative fictional fixtures. |
| TUV-C05 | Source → add → students → explicit multi-student matching → review → start | TXT/DOCX, paste and local pictures; single student explicitly confirms without match screen; multiple pages per student; Back/Undo preserves content; retry receipts avoid duplicates. .doc/PDF/OCR unsupported with explanations. |
| TUV-C06 | Focused Write a comment; searchable/editable/import-reviewed comment bank; comments reappear beside criterion evidence | Bank is local and teacher-scoped. Student comments are not automatically copied into bank. Bank is separate from app backups and has CSV export/import, clearly stated in UI. Existing student comments remain in normal backups. |
| TUV-C07 | Shared 17 exact classroom levels everywhere evidence/category levels are selected | New additive classroom_level score format, no database version change. Existing scale_code and percentage records retain their original meaning and values. R=50 remains distinct from 1−=51 and from unassessed/feedback-only. |
| TUV-C08 | Criteria/descriptors/comments/evidence/selected levels together; direct Feedback only / Level choices; read-only KTCA summary | Evidence levels never automatically become category judgments. Legacy saved rubric labels and judgments remain visible/usable. |
| TUV-C09 | Clear selected/disabled controls, visible saved status, Save and next student / Save and return to Markbook | Final save uses guarded atomic service; only successful save/readback navigates. Failed saves retain work. Repeated finalization returns same receipt. |
| TUV-C10 | Regression tests and browser checks below; new classroom acceptance added to existing CI | Fictional data only; physical Windows/Mac checks and CI results remain separate evidence. |

Exact selected-level equivalents: R=50; 1−=51; 1=55; 1+=58; 2−=61; 2=65; 2+=68; 3−=71; 3=75; 3+=78; 4−(low)=81; 4−(High)=85; 4(low)=88; 4(high)=91; 4+(low)=95; 4+(med)=98; 4+(high)=100. These are not percentage bands. No reverse conversion or historical grade rewrite was introduced.

## Review findings repaired in this batch

- Original parser reproduced eight flattened paragraphs as eight Knowledge criteria; Category and Description table header was rejected. New structured parsing preserves table cells and explicit category headings, with null/unconfirmed ambiguous mappings.
- Feedback-only category comments previously stayed only in marking history; now current Markbook receives ungraded descriptive feedback rows. Clearing that feedback in a later revision was reproduced leaving stale text; repaired while retaining immutable prior commits. Backup validates explicit current feedback references and still accepts historical no-result feedback commits. Canonical legacy report comparator still normalizes only category-row order; the requested KTAC → KTCA caption change is an explicit separate expected-output adjustment.
- Slow import could overlap previous-student edits. Synchronous import lock blocks navigation/edits and flushes before opening; successful per-student receipts survive later failures.
- Final profile-save request could commit after actor revocation. Transaction-lifetime identity subscription now aborts it, with rollback/retry regression.
- Multiple mounted comment-bank pickers could overwrite one another's additions. Additive save rereads current bank; source edits invalidate stale review; delayed reads mark dirty immediately and ignore departed component/actor completions.
- Integration reused identical React keys for image and criterion panels and could accumulate duplicate panels. Distinct component key prefixes repaired it; photo acceptance rerun required.
- Primary button background classes could conflict with white backgrounds. Relevant primary controls now have unambiguous styles, with computed-color assertions.

The original full-suite failure was a fixture assumption: current feedback-only saves now create a result, while the test intended to model a legacy commit with no result. The legacy fixture is reconstructed explicitly; a separate current feedback-result recovery test was added. No restore-reference checks were weakened.

## Measured verification

- Full unit regression: **581 tests /58 files PASS** (October15 Toronto; runner UTC October16). Includes exact17 persistence/finalization/restore cases, null feedback grades, unchanged old records, immutable history, transaction failures and invalid-backup rollback.
- Focused profile/auth/backup:66 tests PASS including final-request actor revocation. Classroom grading/service/recovery:80 PASS. Wizard/document/image imports:34 PASS. Rubric/import/bank tests and evidence/popup tests pass; latest focused repair runs are recorded in final completion notes.
- Actual production browser marking workflow PASS: TXT/DOCX matching, repeated/overlapping/pending comments, two-student isolation, reload, atomic finalization, report, draft revision, Markbook reopening; zero external requests/errors.
- Guided classroom browser PASS: single/multiple students, multiple pages, Back/Undo, unsupported.doc/read failure, partial transactional import retry and failed-open recovery, all17 visible choices, failed-final-save rollback/no navigation, save-next/save-return, exact Markbook result and restart; paste and picture originals preserved.
- Archive browser PASS: default-off retention, cancel safety, marked feedback/grade/history preservation, explicit keep, read-only listing, reload, actual backup redaction/retention.
- Authority browser PASS: pending teacher switch, failed-navigation retry, epoch revocation, membership revocation; official data unchanged.
- Category-recovery browser PASS: compatible replacements, removal/history retention, incompatible rubric/mapping, failed writes/reconciliation and restart.
- Portability browser PASS: stale manual-result conflict/review, atomic finalize, failed readback/idempotent retry, inert downloaded report, clean-profile full backup preview/restore, pending drafts and historical finalized report after category removal.
- Shared production Chromium classroom/nativePilotSmoke and uiRepairsSmoke PASS. Despite the historical script name, this is browser evidence, not a physical iPad/Windows/Mac pass. New profiles browser PASS; component popup/evidence Chromium PASS including size/margins/focus/dirty dismissal/no background activation and original image bytes.
- Typecheck/build passed at integration checkpoints. Final production build and bank lifecycle/full modes-photo browser checks PASS. New npm run test:classroom aggregate PASS (production profile setup, actual integrated workflow, focused popup/evidence). Strict standalone browser/native harness typecheck PASS, including the application Window bridge declaration. Existing bundle-size/dynamic-import warnings are recorded limitations, not new runtime failures.

Tests use explicit fictional fixture injection only into verified-empty profiles. Production remains blank until teacher setup. Existing Windows/Mac acceptance harnesses now support current guided controls and retain legacy-package branches; native execution is pending platform CI.

## Remaining boundaries and decisions

No merge, release, installer distribution, real student data, service adoption, signing/publisher work, iPad/phone or Control Panel expansion performed. Native OS dialogs, actual Windows/Mac device behavior and new-head platform CI are not established by these browser checks. Actual supplied rubric/screenshot unavailable; unstructured flattened text may need teacher correction; unsupported nested tables/.doc/PDF/OCR are explained rather than silently guessed.

Participation judgment remains deferred: discuss single-student default with explicit group participation mode. Existing intentional group behavior is unchanged. No other product decision blocks this authorized implementation; review and reserved merge/device handoff are next gates.

## Final publication and verification

Final production build PASS (existing bundle/dynamic-import warnings only), source TypeScript PASS, diff check PASS. Full modes/photo browser PASS with EXIF6/3/8/2 raw axes, delayed-decoder rejection, real pen/highlight/comments, crop/rotate/reorder/autosave, restart, three modes, legacy optional fields, teacher boundaries, immutable finalized revision, exact clean-profile backup/restore, zero external requests/errors. Extended input/browser PASS includes concurrent bank merges, edited-source review invalidation, delayed file-read discard with no phantom guard and computed primary-button contrast. New test:classroom aggregate passes on final source. Annotated report/PDF browser PASS; native Save As remains unverified. Initial optional PDF smoke failed only because bundled browser executable was unavailable; rerun with installed Chromium passed. No native device claim.

Implementation source commit `41adaef07064b3a96c59b3914b453c860e3d2945`; this checkpoint contains documentation and one Archive-smoke type annotation only. Strict standalone harness typecheck PASS. Automatic review initially rejected the combined commit/push command based on superseded review-only scope and an asserted history amendment. Latest user authorization was reread: implement, test, commit/push, and prepare review. No amend, force push or merge is requested. Remote commit and PR independent readback pending. Branch `codex/classroom-use-20261015`; no commit/PR completion claimed until independently read back. Main remains `495ba2af97663123ac332ba258a8c0e7f820ec13`.
