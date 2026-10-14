# StudentOrganizer — authoritative feature and execution queue

Updated: October 14, 2026 (UTC and America/Toronto). Approved Markinator modes/photo implementation is development verified and pushed for review; evidence below supersedes the pre-execution snapshot. **Single source of truth for feature status, priority, approval and next action.** Application acceptance is scoped to the exact evidence below; packaged/native device acceptance remains separate.

## Immediate execution priorities

| Priority | ID | Status | Next action / gate |
| --- | --- | --- | --- |
| 1 | F-008-MODES / F-008-PHOTO | Implemented and development verified; source `0347d94` pushed/read back; not merged/released | Review [work order](work-orders/MARKINATOR-MODES-PHOTO-P0-2026-10-13.md) and saved PR text. [Draft PR30](https://github.com/BadgerCraft/StudentOrganizer/pull/30) published October 14 through the GitHub connector. Exact `1c5c2e2` Windows run38566721627 and Mac/iPad run38566721606 observed queued; no CI pass claimed. Native camera/device acceptance remains separate. |
| 2 | QA-20261005-01,04–10 | Combined with modes/photo on isolated desktop/export/archive branch; main unchanged | `codex/ui-cleanup-20261013` at `66a3477` retains its prior 378-test/build/browser evidence. [Branch work order](https://github.com/BadgerCraft/StudentOrganizer/blob/codex/ui-cleanup-20261013/docs/work-orders/UI-CLEANUP-20261013.md). PR26 is the older ui-repairs source; latest cleanup `66a3477` is reused in the combined branch. Check successor PR CI; no main merge. |
| 3 | F-007 | Local bug-report draft implemented; central delivery not connected | Decide/authorize private receiver and access; test receipt on packaged Windows/Mac without automatic student-data transfer. |
| 4 | F-008-PDF / F-008-ARCHIVE | Implemented locally October 14; 474 tests/build pass; remote/runtime review pending | Annotated local PDF export and structured Archive with default-off Keep student work; verify combined Windows/Mac source and recovery. |
| 5 | WIN-PHYSICAL | Blocked: requires disposable Windows device | Run physical installer/UAC/managed-device and interrupted-install checks; keep public unsigned release and signing on hold. PR22–24 CI evidence is not physical acceptance. |

## Active feature register

| ID | Feature / requested outcome | Current disposition | Next step / source |
| --- | --- | --- | --- |
| QA-20261005-01 | Explicit teacher prompt each launch | Prior isolated UI cleanup ready for review; see priority row / `66a3477` | Preserve verified implementation on `codex/ui-cleanup-20261013`; review/integration and native gates remain separate. |
| QA-20261005-02 | Imported roster appears on seating; populate discoverable | Merged PR18; development verified | No repeat work; device pilot separate |
| QA-20261005-03 | Seating randomization confirmation | Merged PR18; development verified | No repeat work |
| QA-20261005-04 | Participation defaults, buttons and tooltips | Prior isolated UI cleanup ready for review; see priority row / `66a3477` | Preserve verified implementation on `codex/ui-cleanup-20261013`; review/integration and native gates remain separate. |
| QA-20261005-05 | Ontario conversion preset display | Prior isolated UI cleanup ready for review; see priority row / `66a3477` | Preserve verified implementation on `codex/ui-cleanup-20261013`; review/integration and native gates remain separate. |
| QA-20261005-06 | Remove student from class roster | Prior isolated UI cleanup ready for review; see priority row / `66a3477` | Preserve verified implementation on `codex/ui-cleanup-20261013`; review/integration and native gates remain separate. |
| QA-20261005-07 | Local photo crop/resize/preview | Prior isolated UI cleanup ready for review; see priority row / `66a3477` | Preserve verified implementation on `codex/ui-cleanup-20261013`; review/integration and native gates remain separate. |
| QA-20261005-08 | Create/edit/rename units | Prior isolated UI cleanup ready for review; see priority row / `66a3477` | Preserve verified implementation on `codex/ui-cleanup-20261013`; review/integration and native gates remain separate. |
| QA-20261005-09 | Collapse assessment details to overall grade | Prior isolated UI cleanup ready for review; see priority row / `66a3477` | Preserve verified implementation on `codex/ui-cleanup-20261013`; review/integration and native gates remain separate. |
| QA-20261005-10 | K/T/C/A ordering in assessments | Prior isolated UI cleanup ready for review; see priority row / `66a3477` | Preserve verified implementation on `codex/ui-cleanup-20261013`; review/integration and native gates remain separate. |
| F-004 | Assessment Hub and category-management UX | Requested | Review the existing QA06/08/09/10 evidence before additional scope; avoid duplicate controls |
| F-007 | Private bug-only Control Panel intake | Partly implemented (local draft); receiver not adopted | Private provider/access decision and actual receipt test |
| F-008 | Integrated essay marking, rubrics, imports, feedback and KTAC finalization | Merged PR20; core development acceptance verified | Platform/pilot acceptance separately |
| F-008-MODES | Essay + rubric, oral checklist + rubric, rubric only | Implemented and development verified on `codex/markinator-modes-photo-20261013` at `0347d94`; pushed/read back, review pending | 392 tests/build and actual three-mode save/reopen/backup/grade-preservation browser checks pass. [Evidence](work-orders/MARKINATOR-MODES-PHOTO-P0-2026-10-13.md). Draft PR30 published; exact-head CI and source review are next; no merge/release. |
| F-008-PHOTO | Photograph and annotate handwritten submissions | Implemented and development verified on `codex/markinator-modes-photo-20261013` at `0347d94`; pushed/read back, review pending | Actual four-page EXIF6/3/8/2 import, raw anchors, delayed-preview guard, markup/transforms/restart/full restore pass; original bytes remain exact. Camera file fallback tested; physical/native checks unverified, OCR shelved. [Evidence](work-orders/MARKINATOR-MODES-PHOTO-P0-2026-10-13.md). |
| F-006 | Installed iPad application | Shelved by Tyler October 14; preserve code and evidence | Resume only on explicit request; [resume map](SHELVED_FEATURES.md) and [iPad guide](IPAD_SUPPORT.md). Not a Windows/Mac release gate. |
| F-008-PDF | Export marked pages, written work and rubric as local PDF | October 14 recovery approved: overwrite-loss repair verified in 10 exporter tests; publication/runtime checks pending | Safe same-filesystem staging/readback/rename preserves old bytes on failure; [recovery evidence](work-orders/PR31-RECOVERY-2026-10-14.md). Complete exact-head packaged CI and native dialog checks; no merge/release. |
| F-008-ARCHIVE | Separate read-only Archive retaining structured assessment records | October 14 recovery: historical backups preserve all 39 tables; 51 focused backup/archive/report tests pass | [Recovery evidence](work-orders/PR31-RECOVERY-2026-10-14.md). Windows failure traced to intentional report row order; comparison corrected without weakening restore validation. Rerun exact-head Windows bootstrap/shared-browser CI; keep PR31 draft until meaningful verification completes. |
| WIN-UPDATER | Manual Windows update check, verified backup, deliberate installer/reopen | Development merged PR22; CI replacement verified | Live distribution, publisher and physical testing separate |
| WIN-BOOTSTRAP | Older installed version to new updater-enabled version | PR23 verification merged per queue; CI acceptance recorded | Physical/manual delivery separate |
| WIN-RECOVERY | Controlled failed install, reinstall and restore | PR24 approval/verification recorded; check live merge metadata | Physical interruption/UAC separate |
| WIN-PHYSICAL | Actual Windows installer, UAC, managed policy, interruptions | Not verified | Disposable physical device and reviewed evidence |
| MAC-PHYSICAL | Gatekeeper, native dialogs, printing, file exports | Not verified | Actual Mac/device acceptance |
| QA-20261010-RESTART | Intermittent Intel ZIP seating visibility after restart | Observed once, retry passed; unresolved reproducibility | Capture tables/renderer if recurrence |
| WF-002 | Reliable autonomous queue handoff and schedules | Partially verified | Confirm new-session/automatic dispatch behavior before claiming general success |

| WF-003 | Decision persistence and streamlined agent workflow | Observed this batch: approved execution, stable-ID queue/work-order/PR-text persistence, verified source push/readback | F-008 evidence records `0347d94` and exact API/native blockers without duplicate approval. Documentation follows separately; future scheduled dispatch/general fresh-session behavior remains unverified. |
| WF-004 | Codex model/effort routing on every handoff | Observed bounded parallel dispatch: actual `gpt-6.1-sol` selection, medium/high/xhigh as routed | [Work-order routing evidence](work-orders/MARKINATOR-MODES-PHOTO-P0-2026-10-13.md) records rationale, ownership, escalation and observable checks. Future scheduled/new-chat model and tool availability still require confirmation. |

## Deferred proposals — no implementation authorization

| ID | Proposal | Revisit condition |
| --- | --- | --- |
| F-009 | Selected exemplary student work + feedback repository | Only after private bug-only transfer works and explicit opt-in design |
| F-008-EXT | File-based rubric import, PDF input/OCR, legacy JSON, scratch marking | Annotated PDF output moved to approved F-008-PDF October 14. OCR remains shelved; remaining input/extensions require separate scope approval. |
| F-006 | Installed iPad application | Explicitly shelved October 14; [resume map](SHELVED_FEATURES.md). Preserve ios/config/scripts; resume only on Tyler’s request. |
| F-008-CAPTURE | Phone companion: choose class/assignment, take named pages, transfer and match locally | Design inquiry October 14; no implementation or roster transfer approved. Revisit after desktop integration/PDF/Archive. Prefer local batch plus manifest and explicit matching; duplicate names unresolved manually. |
| FUTURE-CLOUD | Live sync/cloud backup, AI/voice, redo, retained-file purge | Separate user decision and privacy design |
| FUTURE-CONTROL | Control Panel release/update management | After bug intake; separate scope |
| FUTURE-STORE | Microsoft Store/signing/publisher distribution | Shelved until explicitly requested; no spending or service adoption |

## Rules and supporting evidence

- **Authority:** This table owns active status and next actions. [PRODUCT_ROADMAP.md](PRODUCT_ROADMAP.md) explains scope; [BUG_REPORTS.md](BUG_REPORTS.md) retains QA evidence; [BUG_REPORTING_INTAKE.md](BUG_REPORTING_INTAKE.md) describes receiver options; [markinator/CHECKPOINT.md](markinator/CHECKPOINT.md) and work orders retain technical evidence.
- **State discipline:** Requested ≠ approved ≠ implemented ≠ tested ≠ merged ≠ released. Check live PR metadata for merge completion; historical assertions below may be superseded.
- **Privacy:** No automatic student-data, photo, essay or feedback uploads; no real-student pilot, paid provider, account/service adoption or public unsigned release without separate authorization.
- **On each batch:** Update one stable-ID row with status, blocker, evidence, and next action. Append detailed execution evidence to a work order or dated history, not above this register.

## Historical execution and approval archive

Earlier queue checkpoints have been preserved verbatim in [history/FEATURE_QUEUE-2026-10-08-through-2026-10-13.md](history/FEATURE_QUEUE-2026-10-08-through-2026-10-13.md). Prior material through October 7 remains in [history/FEATURE_QUEUE-through-2026-10-07.md](history/FEATURE_QUEUE-through-2026-10-07.md). Archives are evidence, not an active work queue.

## October 14 — review publication recovery

Standing review-publication authorization in AGENTS.md applied. GitHub connector read/search/create succeeded despite the earlier environment's Forbidden responses. Draft PR #30 was created and independently read back at application/evidence head `1c5c2e21d958448d0c93adcfbe9c408f26d05ecb`; its Windows and Mac/iPad workflows were observed queued. This administrative queue update follows on the same isolated branch and needs its own exact-head CI. No new code verification, native-device acceptance, merge, release, spending or real-student use is claimed. Next: inspect final-head checks and review source, then native-device camera/permissions/touch/background/restart/recovery and large-photo capacity. Local checkout `/workspace/StudentOrganizer-modes` and physical devices are unavailable in this coordination environment. Model recommendation for substantive source/native review: confirm GPT-6.1 Codex Sol is selectable, high reasoning for file/grade integrity; escalate reproduced data loss to independent review. Complete with actual CI/device evidence or an exact capability blocker.

## October 14 — archive and desktop-first discussion

Tyler proposed a separate Archive section retaining specific data while removing photographs, asked why annotated PDF export is absent, and expressed willingness to shelve iPad if its burden is disproportionate. Record archive/export as design questions, not approved destructive implementation. iPad shelving is conditional, not yet an unconditional platform cancellation. Recommendation under discussion: prioritize Windows/Mac installed acceptance, allow local phone-photo file import, defer iPad-specific runtime work; keep existing iPad code intact. Clarify that UI cleanup was implemented separately and combined integration testing belongs to the development agent. At `c84d52c`, Windows run38566781577 succeeded; Mac/iPad run38566781569 was still in progress when checked. Administrative follow-ups require fresh-head checks.

## October 14 — approved desktop integration, export and Archive

Tyler clarified that photos and uploaded documents count as student work, approved a separate Archive retaining the four structured groups with default-off **Keep student work**, directed immediate shelving/documentation of all iPad work, approved annotated PDF output (“Okay make it so”) and approved combining verified UI fixes (“Sure yeah let’s integrate if it makes sense”). This authorizes isolated implementation, tests, routine repairs and review publication; no main merge/release/distribution/spending or real-student use is inferred. Phone capture is a design question only. Source integration uses modes/photo `63f9963` and latest verified cleanup `66a3477`, not stale PR26 head `f0806ff`.

Implementation branch: `codex/desktop-export-archive-20261014`; [combined draft PR31](https://github.com/BadgerCraft/StudentOrganizer/pull/31) is published and independently read back. Original PR30 and cleanup branches are preserved. iPad-specific CI compilation is disabled with its resume link; shared Chromium/WebKit regression checks remain desktop-useful. Native Windows/Mac acceptance remains unverified; iPad acceptance is deliberately shelved.

Shared lessons consulted: component index v10 (October10), database v6 (October6). DB003/004 apply only to the merged Dexie seat/roster preservation paths; retain their ID/unique-index and rollback regression suites. DB001/002 are SQLite-specific, not proof of IndexedDB archive atomicity; add real Dexie archive rollback/retry/backup tests. Model routing is inherited current coordinator plus bounded agents; no model switch claimed. For another environment, recommend GPT-6.1 Sol if selectable, high reasoning for archive/file/grade integrity; escalate reproduced data-loss to independent review and require measured recovery evidence.

### Measured combined verification

Local `npm test`: **474/474 tests, 49 files pass**; `npm run build`: PASS with existing mixed-import/chunk-size warnings; `git diff --check`: PASS. Initial combined baseline was 457 tests before archive/PDF additions. Independent source review found and verified fixes for pending-edit duplicate archive feedback and inactive-enrollment name display; its four focused suites passed 26 tests. Archive tests prove source absence across live/audit/outbox/backup, feedback and official-grade preservation, actual restore, failed-write/identity rollback and opt-in retention.

Local browser/runtime evidence is UNVERIFIED: Playwright download returned truncated ZIP files, no Chromium is installed, and package-repository fallback was unavailable. New archive/PDF browser and packaged Electron PDF checks are wired for remote CI; passing unit mocks do not establish native PDF visual output or OS-dialog acceptance. Historical soft-deleted pre-feature archive records are not automatically purged; prior exported backups also retain their original contents. These limits are explicit, not silently converted to success.

### Publication readback

Command-line Git push lacked credentials; the working GitHub connector published an exact-tree-matching merge commit `f6be09e8f580c1d334857349dce1f9ad66e54c0c` (tree `1a7f7ba90a580530d0e4b42b2096c4a659178522`). Both modes/photo and latest UI parent histories are preserved. Draft PR31 is conflict-free on readback; PR30 points to the combined successor and original branches remain intact. Source-head Windows run38570982553 was in progress and Mac/shared browser run38570982686 queued when observed. This queue-only follow-up has its own CI; no remote pass is claimed. Next: inspect final-head checks, repair any failures within scope, then Windows/Mac physical acceptance. No merge or release performed.
