# Focused Student Organizer and personal recovery — October 27, 2026

## Authorization, source and delivery

Tyler explicitly requested implementation and a pull request during the October27 call, then clarified “every single decision ... as well as ... the design doc ... include everything”. This supersedes the documents' historical design-only/deferred-mockup limits and the initial delegation's sync deferral. It authorizes implementation, fictional-data verification, isolated commits/push and draft PR publication. No merge, release, deployment, real-student transmission, new OAuth grant, credential/account configuration or outreach is authorized.

Verified initial main: `ca9523735325a1b8873ce824f8cf4066b9991da3`. Open draft PR48 dependency: `codex/qa-integrity-repairs-20261024`, `f86d661891b58d46e2c2381ea89f367bc9b34b90`. This implementation branch `codex/focused-organizer-20261027` starts at that exact dependency and targets its branch, keeping UI/sync changes separate. PR48 is not merged. Existing integrity repairs are needed to preserve grade editor concurrency, restore validation and classroom write authority.

Canonical sources inspected through supported Library full-text reads: Tyler's UI Preferences Word v1 `libfile_c365fd69899c81919d1f6a09434991e9` / `file_00000000925081f584db48e9ef5e301d`, project reference v6 `libfile_713188892d348191878213077edb90fc`, mobile reference v4 `libfile_ba9a1b75114c8191b5fa9fe871c909ca`. Preparation resolved bytes and versions, but current bundled Library transfer helper reported `download failed` for all three. No download URL guessing or bypass; full-text reads succeeded and parent independently supplied matching guide text. No claim of local document pixel inspection.

Repository AGENTS, feature queue, learning history, Library, reuse-component-lessons, verify-build and explain-back instructions read. No repository `.agents/skills` or UI/design SKILL.md exists in this checkout; `/workspace/.agents` is empty. Shared reuse-component index and workflow references returned `failed to read skill resource`; no current lesson IDs or durable shared updates are claimed. Existing audited services, ModalDialog, LevelPicker, import wizard and atomic portability validator are reused with targeted regression coverage.

One coordinator integrates separate file-owned marking, participation, sync/recovery and browser-test work. Inherited model/effort used; consequential grading/data-integrity work warrants high reasoning. Escalate on actual authority, relationship or concurrency conflicts, not routine layout choices. Completion means implementation against checklist, appropriate tests/build/types, rendered fictional workflows, independent review, draft PR and exact-head CI; user acceptance remains distinct.

Published [draft PR49](https://github.com/BadgerCraft/StudentOrganizer/pull/49), implementation commit `620a8ac8a27a48f04db433e04b627f52e0d10774`, remote head verified. Final-head CI status is maintained in the PR description to avoid a self-invalidating evidence commit. No merge or deployment.

## Decision-to-implementation checklist

| ID | Agreed outcome and preservation constraint | Implementation / evidence |
| --- | --- | --- |
| UI-01 | Narrow left navigation; top class switcher; preserve classes, grade grid, ledger, settings, profiles | Implemented: Header/App; Markbook opens assignment cards, adjacent List View retains grade grid. |
| UI-02 | Default dark, selectable light/dark, obvious controls, readable targets | Implemented: device-local Appearance setting and shared semantic CSS tokens; no record migration. |
| UI-03 | Sparse participation class default; existing attendance/seating tools accessible | Implemented: names-only default and explicit tools toggle. |
| UI-04 | Feedback choice saves/dismisses; reopen highlights today's exact observations; remove an error; Ctrl+Z excludes text editing | Implemented: existing configurable buttons and audited occurrence retraction; preserve repeated events/history. |
| UI-05 | Empty Create Assignment; populated assignment cards plus dotted create tile; retain grade grid | Implemented: AssessmentHub reused as Markbook, existing domain creation and category order. |
| UI-06 | Focused assignment setup, Rubric and Upload separately; no premature marking | Implemented: MarkingWorkspace. |
| UI-07 | Existing photo ZIP, DOCX batch/ZIP, single files, later work, retry/matching, oral/rubric-only | Implemented: existing import/matching services retained; focused browser navigation updated. |
| UI-08 | Rubric DOCX/TXT ≤2MB and pasted text/table only; review/KTCA/version/retained attempt rubric | Existing importer retained; full input, rubric/mode and authority regressions passed. |
| UI-09 | Essay/photo primary, right editor and ordered accumulated evidence cards; no live grade in annotation | Implemented: separate annotation stage and compact cards. |
| UI-10 | Separate final stage, left KTCA chips, chosen category's evidence/grade, revisable summary, exact teacher finalization/transfer | Implemented: existing grading services untouched. |
| UI-11 | Shift+1..4 only open editor outside editable controls; exact levels and minus/plain/plus | Implemented: scoped shortcut; standard Tab retained, timing-dependent binding not invented. |
| UI-12 | Back/cancel, retained context, unsaved-change and repeated-click protections | Implemented: existing guards plus assignment ModalDialog and pending-write locks. |
| DATA-01 | Both computers work offline; optional personal Drive; separate changes merge; explicit conflict choice, no silent overwrite | Implemented: three-way record reconciliation and native adapter against mocked transport; separate consent/setup gate. |
| DATA-02 | Automatic several dated backup versions; manual confirmed restore under Settings | Implemented: separate local snapshot store, whole-backup validation and transactional restore. |
| KEEP-01 | Exact Ontario levels/weighting, permissions, attribution, original files, existing grade and recovery data | Domain calculation unchanged; full unit, classroom17-level, authority and transfer regressions passed. |
| KEEP-02 | Existing approved capture, dictation, Control Panel and fictional analytics paths | Preserve code and applicable CI; no new provider, telemetry or data transfer. |

Historical reference aspirations (remote AI, broader shared school service, curriculum integration) are not described as settled implementation. iPad-specific work remains explicitly shelved under current AGENTS; existing code/static CI is preserved. Historical Google Doc links and spreadsheet UX ideas remain distinguishable from current accepted UI decisions; existing assignment creation already has no required arbitrary code. No claim that all historical ideas have shipped.

## Choices and unresolved proposals

- Grade-grid access: visible List View in the same narrow navigation plus Open grade grid from populated Markbook. This is a reversible navigation choice preserving existing behavior.
- Participation: retain configured positive/neutral/follow-up labels and repeated recordings. Show each of today's existing occurrences separately for exact correction, never bulk historical deletion.
- Standard Tab remains focus navigation. No timing-sensitive double-Tab, Alt-category, Ctrl+Enter or new automatic category advance. Native OS/assistive-technology acceptance is distinct from browser keyboard tests.
- Backup frequency/retention and encryption were not prescribed. Expose actual conservative defaults and limits in Settings; personal Drive is not itself a privacy guarantee. Live authorization/configuration remains a separately approved action; tests use fiction and mocks.

## Verification checkpoint

Before evidence: `evidence/UI-2026-10-27/before/class.png`, `before/assignments.png`, captured from the dependency implementation before UI edits using the existing fictional classroom fixture.

Current local checkpoint: production app, Control Panel and capture builds pass; full domain suite passed 923 tests (one native-only skip). Additional final sync regressions pass25/25, including proven shared ancestry for simultaneous offline branches, resulting-scope authorization and independent installation identity. Final production build, strict harness typecheck, all four focused browser workflows and desktop press regression pass. Full exact-head CI will rerun the unit suite after publication.

Browser PASS: classroom setup/import/retry/recovery/exact17-level grade/finalization/Markbook/restart; all4 authority scenarios; all4 category recovery scenarios; complete input suite including concurrent comment-bank composers; full portability/report/restore; production archive and native-acceptance-renderer helper; all13 written/photo/oral/rubric mode scenarios; real participation correction and both undo paths; default dark/light persistence and assignment dirty protection; roster/table/seating/submission sequence; mocked capture transport, actual fictional phone package export, late append recovery and >5MB photo matching. Installed native process acceptance remains CI, not inferred from the renderer helper.

Independent source review found and repaired incomplete assignment dirty guarding, dark photo/selected-level contrast, undo-target races, invalid sync ancestry/permission combinations and nonreactive automatic-backup failures. Bounded final review covered resumable transport/session URL checks, teacher-facing conflict choices, restored single-criterion controls and retained final evidence, with no remaining concrete blocker in reviewed source. Final bounded review also passed the optional transactional Undo identity guard and compact dock/navigation geometry. Reviewed source blobs: App `9bcba07fc85fc20380032e974f157e03c630544b`; participation service `5661e80683ee44732e83e9514b3b17a1db236da0`; dock `69b89c03d0f9f464536bc04efbf43074e623e961`; CSS `18730db6ea1a0bb0e1d8932d4c210f16e870055a`. Machine-readable browser results are retained under `evidence/UI-2026-10-27/results/`.

The participation-selection regression exposed expanded-dock occlusion. The chooser now uses a compact scrollable height and leaves the persistent navigation reachable while shielding classroom padding. The complete selection regression passes, including unsaved notes, historical batches, context switches and Undo after returning to Class View. Historical browserUx harness navigation/types were updated; the complete historical benchmark is not represented as passed.

After images live in `evidence/UI-2026-10-27/after/`: class, assignment cards, setup, annotation, category-review, final-grading and recovery. All data is fictional. Screenshot timings show actual draft autosave state rather than a fabricated saved badge.

Configured mocked sync UI, explicit conflict resolution and confirmed restore pass with fictional data. Remaining: exact-head native/shared CI, teacher/device acceptance and separate live OAuth/privacy approval. No real records or credentials were accessed.

## Native CI follow-up

Initial published head `c9d999a` passed Control Panel Windows/Mac packages, capture browser/Android and the focused shared-browser suite. Native checks identified harness assumptions about the former default marking queue, ambiguous repeated-participation labels and initially visible classroom tools. These are corrected through explicit focused navigation/action selectors while retaining legacy-app compatibility and the existing recovery/permission assertions. Production-renderer proofs pass for byte-identical reopened reports, exact pending feedback, two distinct repeated observations and authorized profile save; strict native-harness types and diff checks pass. Application source is unchanged by this follow-up; final exact-head results are recorded in PR49.

On `f672c16`, all Windows native jobs, both Mac architectures, capture and Control Panel passed. Expanded marking, classroom, WebKit compatibility and WebKit UI repairs also passed. The remaining bug-report harness expected the historical default `dashboard`; CI and a local before-check both demonstrated the correct new `Screen: seating` value. Its assertion now verifies the visible seating screen while retaining exact draft/download, clipboard/quota and unsaved-dismissal checks.

## Rollback

Before merge, close this draft without touching main or PR48. After a separately authorized integration, revert this branch's commits and rebuild. Preserve/export a verified full backup before changing installed versions; local dated recovery snapshots and sync envelopes must not be destructively purged. No release or deployed rollback performed by this task.
