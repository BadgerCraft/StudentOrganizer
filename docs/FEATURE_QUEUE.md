# StudentOrganizer — authoritative feature and execution queue

Updated: October 14, 2026 (UTC and America/Toronto). Approved Markinator modes/photo implementation is development verified and pushed for review; evidence below supersedes the pre-execution snapshot. **Single source of truth for feature status, priority, approval and next action.** Application acceptance is scoped to the exact evidence below; packaged/native device acceptance remains separate.

## Immediate execution priorities

| Priority | ID | Status | Next action / gate |
| --- | --- | --- | --- |
| 1 | F-008-MODES / F-008-PHOTO | Implemented and development verified; source `0347d94` pushed/read back; not merged/released | Review [work order](work-orders/MARKINATOR-MODES-PHOTO-P0-2026-10-13.md) and saved PR text. [Draft PR30](https://github.com/BadgerCraft/StudentOrganizer/pull/30) published October 14 through the GitHub connector. Exact `1c5c2e2` Windows run38566721627 and Mac/iPad run38566721606 observed queued; no CI pass claimed. Native camera/device acceptance remains separate. |
| 2 | QA-20261005-01,04–10 | Prior isolated UI cleanup ready for review; preserved, not merged into this branch | `codex/ui-cleanup-20261013` at `66a3477` retains its prior 378-test/build/browser evidence. [Branch work order](https://github.com/BadgerCraft/StudentOrganizer/blob/codex/ui-cleanup-20261013/docs/work-orders/UI-CLEANUP-20261013.md). PR26 metadata/update remains API-blocked; do not duplicate implementation or claim main merge. |
| 3 | F-007 | Local bug-report draft implemented; central delivery not connected | Decide/authorize private receiver and access; test receipt on packaged Windows/Mac without automatic student-data transfer. |
| 4 | F-006 | Native iPad project/compile exists; device runtime unverified | Test Files, touch, offline, backup/restore and signing renewal when Mac/Xcode/device is available. |
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
| F-006 | Installed iPad application | Preparation implemented; native interaction blocked | Mac/Xcode/device acceptance |
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
| F-008-EXT | Full annotated export, file-based rubric import, PDF/OCR, legacy JSON, scratch marking | OCR explicitly shelved October 13; revisit only after core Markinator workflow/UI stability and fresh approval. Other extensions need separate scope decisions. |
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
