# StudentOrganizer — authoritative feature and execution queue

Updated: October 13, 2026 (America/Toronto). **Single source of truth for feature status, priority, approval and next action.** This is a documentation reconciliation; it does not establish fresh application/device acceptance.

## Immediate execution priorities

| Priority | ID | Status | Next action / gate |
| --- | --- | --- | --- |
| 1 | WIN-PHYSICAL | Blocked: requires disposable Windows device | Run physical installer/UAC/managed-device and interrupted-install checks; keep public unsigned release and signing on hold. PR22–24 CI evidence is not physical acceptance. |
| 2 | QA-20261005-01,04–10 | Ready for review; approved UI cleanup implemented and development verified | Review codex/ui-cleanup-20261013 at 5225bd3; 378 tests/build and Chromium UI/marking/recovery passed. Existing PR26 source reused; API blocks PR/CI metadata and update. [Evidence](work-orders/UI-CLEANUP-20261013.md). Main merge/release reserved. |
| 3 | F-007 | Local bug-report draft implemented; central delivery not connected | Decide/authorize private receiver and access; test receipt on packaged Windows/Mac without automatic student-data transfer. |
| 4 | F-006 | Native iPad project/compile exists; device runtime unverified | Test Files, touch, offline, backup/restore and signing renewal when Mac/Xcode/device is available. |
| 5 | F-008-MODES / F-008-PHOTO | Requested future scope; plan approval pending | Scope three marking modes and handwritten image capture after core integration; handwriting OCR shelved, not in the active work batch. |

## Active feature register

| ID | Feature / requested outcome | Current disposition | Next step / source |
| --- | --- | --- | --- |
| QA-20261005-01 | Explicit teacher prompt each launch | Ready for review; approved October 13 + current UI Cleanup Batch | Fresh launch already required selection; remembered profile now offers explicit Continue only. Browser cold-launch/reload/new-session checks pass; native launch remains unverified. [5225bd3 evidence](work-orders/UI-CLEANUP-20261013.md). |
| QA-20261005-02 | Imported roster appears on seating; populate discoverable | Merged PR18; development verified | No repeat work; device pilot separate |
| QA-20261005-03 | Seating randomization confirmation | Merged PR18; development verified | No repeat work |
| QA-20261005-04 | Participation defaults, buttons and tooltips | Ready for review; approved October 13 + current UI Cleanup Batch | Group-specific creation defaults/tooltips, explicit four-button empty-state setup and configure link; existing settings/history retained. Actual UI and atomic setup/identity tests pass. [5225bd3 evidence](work-orders/UI-CLEANUP-20261013.md). |
| QA-20261005-05 | Ontario conversion preset display | Ready for review; approved October 13 + current UI Cleanup Batch | Actual class-version entries/loading/unavailable states; nonnumeric I no longer displayed as 0%. Clean baseline was already populated; selected-version regressions/browser pass. [5225bd3 evidence](work-orders/UI-CLEANUP-20261013.md). |
| QA-20261005-06 | Remove student from class roster | Ready for review; approved October 13 + current UI Cleanup Batch | Confirmed active unenrollment retains enrollment/student IDs, marks, observations and audit; removes active seats. Restore/re-enrollment/rollback and browser cancel/confirm pass. [5225bd3 evidence](work-orders/UI-CLEANUP-20261013.md). |
| QA-20261005-07 | Local photo crop/resize/preview | Ready for review; approved October 13 + current UI Cleanup Batch | Local JPEG/PNG/WebP square crop, zoom/position, 256px preview, Apply then Save; cancellation/late reads preserve previous photo. Input bounds and browser tests pass; OS picker/native unverified. [5225bd3 evidence](work-orders/UI-CLEANUP-20261013.md). |
| QA-20261005-08 | Create/edit/rename units | Ready for review; approved October 13 + current UI Cleanup Batch | Unit create/edit/rename with stable IDs, retained assessment links, dates/order/unique codes, actor/version checks. Unit tests and actual create/edit/cancel/reopen pass. [5225bd3 evidence](work-orders/UI-CLEANUP-20261013.md). |
| QA-20261005-09 | Collapse assessment details to overall grade | Ready for review; approved October 13 + current UI Cleanup Batch | Per-assessment collapse/expand to weighted overall grade using existing engine; formative course policy, marks and overrides retained. Unequal/partial-weight tests and browser edit/summary checks pass. [5225bd3 evidence](work-orders/UI-CLEANUP-20261013.md). |
| QA-20261005-10 | K/T/C/A ordering in assessments | Ready for review; approved October 13 + current UI Cleanup Batch | KTCA presentation in Hub/Markbook/marking/recovery/report; original IDs, weights and judgments unchanged. Pure/SSR/report regressions and actual UI pass. [5225bd3 evidence](work-orders/UI-CLEANUP-20261013.md). |
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

| WF-003 | Decision persistence and streamlined agent workflow | Approved October 13; documentation merged in PR28; behavioral validation pending | Top-of-file contract merged; verify next real project decision is persisted without prompting before marking behavior validated |
| WF-004 | Codex model/effort routing on every handoff | Documentation merged PR29; next-session validation pending | Verify next Codex handoff includes available model, reasoning effort, rationale, escalation trigger and completion evidence |

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
