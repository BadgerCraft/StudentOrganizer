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
| TUV-C04 | Local TXT/DOCX rubric files and pasted TSV, full table-row/descriptor parsing, concise editable criterion/category review | Multiple criteria per category retained; ambiguous mappings cannot be saved without review. Original uploaded rubric and referenced screenshot were not supplied; reproduction uses representative fictional fixtures. |
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


### Publication blocker — exact current state

Implementation `41adaef07064b3a96c59b3914b453c860e3d2945` and verification/documentation `e013ea8163d02b1f62573481c69a52d1e5d36998` are committed locally. Automatic approval review rejected both the original combined command and the isolated ordinary feature-branch push, even after rereading the latest uploaded request's explicit implementation/commit/push authorization. Second stated reason: visible trusted instructions do not authorize this exact push/payload, and tool/assistant claims cannot expand authorization. Neither push executed. No alternate publication route attempted. No remote feature branch or PR completion is claimed; new-head platform CI has not run. All local checks described above are observed passes; strict standalone harness typecheck also passes. A final documentation-only checkpoint records this blocker.

Required next action: explicit direct approval to push the current local `codex/classroom-use-20261015` commits to `BadgerCraft/StudentOrganizer` and open its draft PR against main. No merge/release/distribution is included. Refresh remote heads before normal push; preserve concurrent changes.

Prepared PR title: **Classroom-use fixes: guided marking, profiles and saved results**

Prepared PR body:

> Teachers can now set up and switch local profiles, import and explicitly match work through a guided flow, use the shared17-choice level scale, review rubric/comments, and save directly back to the correct Markbook. Student popups are tall and accessible; feedback-only work stays ungraded and historical grades retain their original meaning.
>
> Validated with581 unit tests, production build, strict typechecks and fictional Chromium workflows covering profiles, matching/retry, comments, all3 marking modes, failed saves, Archive, history, backup/restore and restart. Windows/Mac CI and physical-device acceptance remain pending. Comment banks export separately; student feedback stays in application backups. Participation selection judgment remains deferred.
>
> Review details and request mapping: docs/work-orders/CLASSROOM-USE-2026-10-15.md. Merge, release, distribution and real-student use remain reserved.


## Direct publication approval and PR32 review — October 16 continuation

Tyler explicitly authorized pushing the three local commits ending at `7a52351d2b18700bea2ef89cea075c96faf7d550` on `codex/classroom-use-20261015` to BadgerCraft/StudentOrganizer and opening the prepared draft PR against main. Clean branch and exact HEAD were confirmed before ordinary push; `git ls-remote` and independent GitHub PR readback confirm the exact head. [Draft PR32](https://github.com/BadgerCraft/StudentOrganizer/pull/32) is open, unmerged, against main `495ba2af97663123ac332ba258a8c0e7f820ec13`. This supersedes the publication blocker above. No merge or release is authorized.

Independent review uses fresh non-author agents: GPT-6.1 Sol high for authorization/profile, grading/save/backup, and import/rubric/bank; extra-high for final integration and remaining complete-diff coverage, proportionate to data and authorization risk. Escalate demonstrated integrity failures to minimal repair and focused reproduction. Completion requires evidence-backed classifications, coverage and exact-head CI, not implementation-author assurances. A separate high-effort harness worker owns only native acceptance repairs; independent review remains separate.

Initial CI at `7a52351`: [Windows run38844248418](https://github.com/BadgerCraft/StudentOrganizer/actions/runs/38844248418) and [Mac/shared run38844248384](https://github.com/BadgerCraft/StudentOrganizer/actions/runs/38844248384). All platform unit runs passed581 tests; Windows/Mac packaging passed; packaged PDF checks passed. Shared Chromium/WebKit acceptance and Windows legacy bootstrap passed. Windows package smoke failed waiting for a seeded teacher, Mac arm64/x64 smoke waited for the old default raw-score field, and Windows recovery failed on an ambiguous Reopen selector. These harness assumptions are under bounded repair; downstream skipped checks are not passes. Pull-request jobs check GitHub’s synthetic merge of the stated head with the stated base; no merge to main occurred.

Application backups exclude comment banks. Export comment banks separately and retain those exports alongside application backups; saved student feedback remains in application backups. Participation selection remains deferred with existing group behavior preserved. Physical Windows/Mac checks remain outstanding: actual launch/OS prompts, local file import/export and native Save As cancellation/overwrite, complete fictional classroom-to-marking-to-Archive workflow, historical retrieval, backup plus separate bank export/restore, and restart persistence. No real-student use or installer distribution is authorized.

### Independent findings at original pushed head

- **TUV-C11 — blocker:** choosing a reusable bank comment replaced existing passage feedback outright. Focused fictional Chromium reproduction typed `Teacher feedback to preserve.`, selected `Bank addition.`, then saved; both editor and persisted annotation contained only `Bank addition.` with no confirmation. Root applied a minimal append-with-newline change consistent with image/rubric editors; focused regression verification is pending.
- **TUV-C12 — non-blocking:** collapsed Markbook labels category-feedback-only work Unassessed if overall feedback is blank; expanded category label is correct. No stored feedback/grade loss. Queued as a small wording follow-up.
- **TUV-C13 — important follow-up:** Save comment closes a passage composer and its unfinished bank review without a departure prompt. Focused browser reproduction confirmed unsaved edited bank review disappears; saved bank/student feedback records are unaffected.
- Grading/recovery independent review found no integrity blocker;91 focused tests in6 files passed, covering exactlevels, marking, category recovery, Markbook, reports and narrow legacy comparison.
- Coverage gap: oral/rubric browser cases checked drafts/restart but not final-save-return. A bounded test extension now checks official Markbook saves/restart for those modes; no full-suite rerun requested.

- **TUV-C11 focused repair verification PASS:** input browser suite confirms typed passage feedback plus chosen bank text remains exact in the persisted annotation, retaining existing grouped/resubmission/reload, malformed input, partial retry/no duplicates and unchanged official-record assertions; zero external requests/errors.
- **TUV-C14 — blocker:** independent Chromium reproduction prepared an unsaved rubric title, returned to an existing rubric-only marking session and clicked Save and return. No prompt appeared, one final commit was created, and the prepared rubric was lost. Root added a pre-finalization confirmation for pending rubric/import preparation on return to Markbook. Cancel must retain preparation and avoid official writes; targeted checks pending.

- **TUV-C15 — important follow-up:** import failure clearing uses filename alone. A failed `Assignment.txt` plus a successful distinct file of the same name leaves only the successful page; reselecting the successful file clears the failed-file warning without partial-import acknowledgment. Chromium reproduced this. Original files remain untouched and final work review remains explicit; no stored-loss/wrong-student assignment was demonstrated. Track retry identity instead of filename.
- **TUV-C16 — non-blocking:** Save and next student advances through attempts; another attempt for the same student can open next. Record as wording/navigation follow-up.
- Independent import review verified local-only imports, explicit matching, transactional partial retry/no duplicates, teacher-scoped banks excluded from database backups. Corrected the rubric documentation: file import supports TXT/DOCX, plus pasted TSV; CSV/TSV files are supported by comment-bank import, not the rubric picker.

- **TUV-C17 — important follow-up:** focused production-browser geometry shows Markbook Save/Cancel at y734–762 in a720-high viewport, with no usable parent scroll; at Electron’s default1280×850 they are visible at y799–827. Do not infer arbitrary display-scaling acceptance from default-window CI. Verify Tyler’s actual device/window and queue a bounded scroll fix if needed.

### Focused repair acceptance after review

Recovered result artifacts after the usage reset independently read back as PASS: classroom-use browser includes both unsaved rubric and import preparation cancellation, exact retained draft/database records and explicit-confirm finalization; modes/photo browser includes oral `3+`=78 and rubric `4+(med)`=98 final-save-return, feedback-only companion categories, exact student/result/receipt ownership, unchanged other students/history, restart and clean-profile backup/restore for all three modes. Both report zero browser errors/external requests. Input acceptance separately passed the passage-bank append/persist regression. No physical-device claim. Authorization review and final delta review were restarted after the reset where completion evidence was unavailable.

Independent authorization review completed against the immutable original diff: no blocking finding. Profile creation grants no existing class ownership; self-edit/membership/epoch checks and transaction abort preserve attribution, failed device activation establishes no actor, initialization preserves records. Focused profile/identity tests19/19 pass. **TUV-C18 — non-blocking existing gap:** DashboardView still reads/updates the first preference globally, allowing another teacher’s Class Card Display settings to change; no mark/class ownership effect.

Final integration review independently checked original remaining scripts, CI, package and native benchmarks plus current repair deltas. No additional source blocker or weakened legacy/content/authorization assertion found. Exact expected KTCA caption correction remains separate from category-order canonicalization; fresh fictional fixture injection never clears existing profiles/classes. Final repaired-head platform CI remains a gate.

### Bounded repair publication checkpoint

Both demonstrated source blockers are repaired and independently reviewed; focused browser tests pass. Authorization19/19 and grading/recovery91/91 tests pass, without a redundant full-suite rerun. The native harness repair was reproduced and checked in production Chromium: explicit fresh fixture/build ID, exact K level/feedback save/reopen, backup/preview/restore, genuine persistent-profile process restarts, full shared marking/receipt/inert-report/recovery acceptance, zero renderer errors/external attempts. Three-harness strict typecheck and diff check pass. Final guided `openDraft` wait now requires the queue action to complete before inspecting optional reopen; independently approved without weakening document/draft/save assertions.

Native Windows/Mac CI on the repair commit remains pending publication; PR32 will carry the exact head/run evidence. This checkpoint does not claim native CI or physical acceptance before observation. Important/non-blocking follow-ups remain TUV-C12/C13/C15–C18; participation selection is deferred. Application backups exclude comment banks, which require separate export. No merge/release/distribution is authorized.

### Native CI escalation at repair head a99dce4

Repair commit `a99dce46169d1ea1f507e3ae655bf139c16a96ab` was pushed/read back. Windows run38945777807 and Mac/shared run38945777809 started. Mac ARM job117124397981 failed at actual Save Result: Playwright repeatedly reports the visible/enabled button is outside the viewport and cannot scroll into view. **TUV-C17 is upgraded from important follow-up to blocker** based on this native evidence. Root added only a viewport-bounded maximum height and vertical scrolling to the Markbook editor panel; independent source review approves the bounded layout change, focused720px save/cancel regression is pending. Other jobs are still running; no all-green claim.

TUV-C17 focused production acceptance PASS at1280×720: panel y16–704; after normal scrolling Save/Cancel y651–679. Visible3+ selection saves classroom_level78 and feedback; reopen retains both; changing to2/edited feedback then Cancel preserves the entire saved row. Zero renderer errors. Permanent helper is called from classroom-use CI; production build/helper strict typecheck/diff pass. Added missing type annotation to the previous receipt regression callback. Independent review approves layout and regression.

At a99dce4 Windows actual portable/installed acceptance and assessment-creation checks passed; next security smoke failed only at its stale seeded-teacher assumption. Its temporary-profile setup now calls the same existing fresh-only fictional fixture helper; all CSP/session/IPC/authorization assertions remain unchanged and independently reviewed. Legacy bootstrap passed. Final native rerun is still required.
