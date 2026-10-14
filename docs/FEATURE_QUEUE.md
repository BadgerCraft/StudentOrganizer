# StudentOrganizer — authoritative feature and execution queue

Updated: October 13, 2026 (America/Toronto). **Single source of truth for feature status, priority, approval and next action.** This is a documentation reconciliation; it does not establish fresh application/device acceptance.

## Immediate execution priorities

| Priority | ID | Status | Next action / gate |
| --- | --- | --- | --- |
| 1 | WIN-PHYSICAL | Blocked: requires disposable Windows device | Run physical installer/UAC/managed-device and interrupted-install checks; keep public unsigned release and signing on hold. PR22–24 CI evidence is not physical acceptance. |
| 2 | QA-20261005-01,04–10 | Requested; diagnosis/scoping, **not** implementation approval | Reproduce and propose bounded UI fixes; protect identity, official marks, audit and local-only photos. |
| 3 | F-007 | Local bug-report draft implemented; central delivery not connected | Decide/authorize private receiver and access; test receipt on packaged Windows/Mac without automatic student-data transfer. |
| 4 | F-006 | Native iPad project/compile exists; device runtime unverified | Test Files, touch, offline, backup/restore and signing renewal when Mac/Xcode/device is available. |
| 5 | F-008-MODES / F-008-PHOTO | Requested future scope; plan approval pending | Scope three marking modes and handwritten image capture after core integration; handwriting OCR shelved, not in the active work batch. |

## Active feature register

| ID | Feature / requested outcome | Current disposition | Next step / source |
| --- | --- | --- | --- |
| QA-20261005-01 | Explicit teacher prompt each launch | Requested | Reproduce session behavior; preserve explicit acting-teacher authorization |
| QA-20261005-02 | Imported roster appears on seating; populate discoverable | Merged PR18; development verified | No repeat work; device pilot separate |
| QA-20261005-03 | Seating randomization confirmation | Merged PR18; development verified | No repeat work |
| QA-20261005-04 | Participation defaults, buttons and tooltips | Requested | Reproduce empty state/classification controls |
| QA-20261005-05 | Ontario conversion preset display | Requested | Diagnose missing/collapsed content |
| QA-20261005-06 | Remove student from class roster | Requested | Plan safe unenrollment/archive, retain grades/history |
| QA-20261005-07 | Local photo crop/resize/preview | Requested | Scope cancel-safe, on-device editing |
| QA-20261005-08 | Create/edit/rename units | Requested | Audit existing unit metadata and UI |
| QA-20261005-09 | Collapse assessment details to overall grade | Requested | Design display-only aggregation, no grading change |
| QA-20261005-10 | K/T/C/A ordering in assessments | Requested | Audit affected views, preserve IDs and weights |
| F-004 | Assessment Hub and category-management UX | Requested | Scope with QA06/08/09/10; avoid duplicate controls |
| F-007 | Private bug-only Control Panel intake | Partly implemented (local draft); receiver not adopted | Private provider/access decision and actual receipt test |
| F-008 | Integrated essay marking, rubrics, imports, feedback and KTAC finalization | Merged PR20; core development acceptance verified | Platform/pilot acceptance separately |
| F-008-MODES | Essay + rubric, oral checklist + rubric, rubric only | Requested, not approved for implementation | Design/acceptance plan after core integration |
| F-008-PHOTO | Photograph and annotate handwritten submissions | Requested, not approved for implementation | Scope local image/annotation only after core marking/UI stability; OCR explicitly shelved |
| F-006 | Installed iPad application | Preparation implemented; native interaction blocked | Mac/Xcode/device acceptance |
| WIN-UPDATER | Manual Windows update check, verified backup, deliberate installer/reopen | Development merged PR22; CI replacement verified | Live distribution, publisher and physical testing separate |
| WIN-BOOTSTRAP | Older installed version to new updater-enabled version | PR23 verification merged per queue; CI acceptance recorded | Physical/manual delivery separate |
| WIN-RECOVERY | Controlled failed install, reinstall and restore | PR24 approval/verification recorded; check live merge metadata | Physical interruption/UAC separate |
| WIN-PHYSICAL | Actual Windows installer, UAC, managed policy, interruptions | Not verified | Disposable physical device and reviewed evidence |
| MAC-PHYSICAL | Gatekeeper, native dialogs, printing, file exports | Not verified | Actual Mac/device acceptance |
| QA-20261010-RESTART | Intermittent Intel ZIP seating visibility after restart | Observed once, retry passed; unresolved reproducibility | Capture tables/renderer if recurrence |
| WF-002 | Reliable autonomous queue handoff and schedules | Partially verified | Confirm new-session/automatic dispatch behavior before claiming general success |

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
