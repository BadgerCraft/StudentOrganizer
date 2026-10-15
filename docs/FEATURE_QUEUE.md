# StudentOrganizer — authoritative feature and execution queue

Updated: October 15, 2026 (America/Toronto). Tyler directed P0 teacher-use readiness after independent PR31 review; this current phase supersedes earlier feature-expansion priorities. **Single source of truth for feature status, priority, approval and next action.** Application acceptance is scoped to the exact evidence below; packaged/native device acceptance remains separate.

## P0 – Teacher-use readiness

Goal: get the integrated desktop application into Tyler's hands for routine fictional-data / personal workflow validation as quickly as safely possible. Authority: Tyler's explicit independent-review/phase-change request in this task. Review and a demonstrated blocker repair are authorized; merge, release/distribution, real-student data, iPad reactivation, services and unrelated cleanup remain separately reserved. Earlier feature rows below retain provenance; this P0 sequence owns current priority.

> **Current product phase: integrated teacher-use validation. Prefer making the existing workflow usable and trustworthy over adding new capabilities. New work should answer one of three questions: does it block Tyler from using the app, risk student data, or materially disrupt the marking/classroom workflow? If not, queue it as a follow-up.**

> **Teacher-use readiness target:** Tyler can open the desktop app and complete a normal fictional classroom-to-marking-to-archive workflow without developer intervention, data loss, authorization ambiguity, or needing to understand implementation details.

| Order | Stable ID | Current disposition | Next action / gate |
| --- | --- | --- | --- |
| 1 | TUV-REVIEW | **Merged October 15:** Tyler explicitly said “Merge” after repaired-head review. PR31 merged reviewed head `0fe0e0c1e0e62aff4c3e994ad72af35b70512a84` as `495ba2af97663123ac332ba258a8c0e7f820ec13`; live PR readback confirms closed/merged. Windows run38668245592 and Mac/shared run38668245649 passed on the repaired head. Historical review: Independent review of PR31 at `4335c29` found PR31-B01; bounded Archive-ID repair verified by 53 focused tests. PDF/Electron, legacy comparison, backup and classroom paths reviewed; old CI remains green evidence for unaffected source. | Merge gate complete. Proceed to private Windows delivery preparation; source approval does not grant real-student use or public release. [Review and proof](work-orders/PR31-INDEPENDENT-REVIEW.md). |
| 2 | TUV-WIN-BUILD | One clean current Windows build is the next delivery preparation, after review/merge decision. No manual build or handoff performed by this review. | Use reviewed/merged source; record exact commit/build/checksum and choose one current installer. Build artifacts are not release/distribution approval. |
| 3 | TUV-WIN-DEVICE | Short physical acceptance on Tyler's actual Windows machine remains unverified. | Obtain explicit handoff/installation approval, use fictional data and recoverable/disposable test profile; preserve existing data. OS/device problems become small cards unless they threaten integrity/privacy/authorization/recovery or materially block routine use. |
| 4 | TUV-WORKFLOW | Complete normal teacher workflow is the acceptance target; CI is supporting evidence, not Tyler's walkthrough. | Class/student setup; participation/classroom tools; assessment creation; all three Markinator modes; photo import/markup; rubric/feedback; marked PDF; Archive; historical retrieval; backup/restore; restart/persistence. Record friction and exact build/device. No developer intervention or implementation knowledge should be needed. |
| 5 | TUV-FOLLOWUPS | TUV-UX-001/002 below are important follow-ups, non-blocking for fictional validation. | Record wording, interruptions and OS/device friction as bounded cards; prioritize observed teacher-workflow impact. Do not begin a redesign or feature stream. |
| 6 | TUV-REAL-DATA | Not authorized. Fictional use only. | Document actual-Windows fictional workflow and backup/restore/restart success, resolve data/privacy/authorization/recovery blockers, obtain school/board/IT privacy acceptance for actual device/account/storage/export/backup/retention handling, then obtain separate explicit Tyler approval before any real-student data. Teacher selection is attribution, not shared-device authentication. |
| 7 | TUV-SHELVED | iPad, phone capture, publisher/signing, new services and nonessential expansion remain shelved. | Revisit only for an observed direct teacher-use blocker, with explicit approval for reserved changes. No spending, service adoption, release or real-student use follows from review or fictional acceptance. |

### Bounded review and teacher-use cards

| ID | Classification / disposition | Evidence / acceptance |
| --- | --- | --- |
| PR31-B01 | Blocker at pinned head; repaired in this follow-up, validator unchanged | A valid 200-character text/image annotation ID gained an Archive prefix and made the resulting backup invalid. Two failures reproduced; deterministic bounded archive-local IDs plus boundary restore/collision regressions close it. Existing feedback IDs, pending edits, redaction, marks and matching session/commit snapshots remain preserved. |
| TUV-UX-001 | Important follow-up; non-blocking fictional use; no implementation started | Keep student work retains inline text/photo/pending feedback, but Archive cards do not directly render it. Finalized reports and local backups retain it. Show retained comments read-only without duplicating redacted feedback or changing source-removal behavior. `MarkingWorkspace.tsx:254`; details in the review work order. |
| TUV-UX-002 | Important follow-up; non-blocking fictional use; no implementation started | Dropped-enrollment nonarchived attempts remain stored but are hidden by the existing active-roster queue filter. Add authorized read-only historical discovery while preventing new marking writes. `markingService.ts:119–138`; validate practical interruption during Tyler's walkthrough. |
| PR31-L01 | Non-blocking documented native limitation | PDF cleanup is best effort on OS refusal; power-loss/process-termination cleanup is not established. Physical dialogs and device policy still need the short actual-Windows pass. |

External GitHub issue creation was rejected by automatic approval review; these stable-ID queue cards are the recorded follow-up tickets. No external issue creation or alternate route was attempted. PR31 merge approval was given and executed October 15; release/public distribution and real-student use remain separate. See the current delivery decision below.

## October 15 — merge and private Drive delivery

Tyler requested installers plus setup instructions in personal Google Drive, accepted StudentOrganizer first, Mobile Scanning App second, and explicitly deferred Control Panel until other users make it useful. Google Drive connector search succeeded; upload capability is exposed. No installer, student data or scans have been uploaded. This authorizes private delivery preparation; do not infer public release, real-student use, phone roster transfer or new scanner implementation approval.

PR31 merged after Tyler's explicit “Merge” at 08:54 America/Toronto. Exact approved head: `0fe0e0c1e0e62aff4c3e994ad72af35b70512a84`; merge commit: `495ba2af97663123ac332ba258a8c0e7f820ec13`. Both repaired-head workflows passed, including Windows package/PDF/update/recovery/legacy jobs, Mac x64/arm64 packaging/runtime and shared browser checks; release job skipped. PR readback confirms merged. Follow-up review inspected the bounded identifier fix and regression patch and reused existing independent review/CI; no new local tests or physical-device pass is claimed.

Delivery preparation branch: `codex/windows-drive-delivery-20261015`, based on the merge commit. Next: select one normal Windows installer with exact source/version/checksum (exclude deliberately failing recovery fixtures), prepare installation/backup/recovery/fictional-walkthrough instructions and known limits, and verify private Drive delivery. Keep working databases and student content out of personal Drive. Actual-device fictional acceptance remains unverified; iPad/signing/publisher work remain shelved. Mobile scanner remains design-only and follows usable desktop delivery; Control Panel follows actual multi-user support need.

## Active feature register

| ID | Feature / requested outcome | Current disposition | Next step / source |
| --- | --- | --- | --- |
| TUV-P0 | Integrated teacher-use validation | Active P0 by Tyler's explicit request; independent review found and repaired PR31-B01; no real-student use | Follow TUV-REVIEW → one Windows build → actual-device fictional workflow → separate real-data gate. [Current work order](work-orders/PR31-INDEPENDENT-REVIEW.md). |
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
| F-007 | Private bug-only Control Panel intake | Deferred by Tyler October 15: Control Panel last, useful when other users need support; local report drafts retained | Revisit when other users create a support need; provider/access and implementation scope remain separate. |
| F-008 | Integrated essay marking, rubrics, imports, feedback and KTAC finalization | Merged PR20; core development acceptance verified | Platform/pilot acceptance separately |
| F-008-MODES | Essay + rubric, oral checklist + rubric, rubric only | Implemented and development verified on `codex/markinator-modes-photo-20261013` at `0347d94`; pushed/read back, review pending | 392 tests/build and actual three-mode save/reopen/backup/grade-preservation browser checks pass. [Evidence](work-orders/MARKINATOR-MODES-PHOTO-P0-2026-10-13.md). Draft PR30 published; exact-head CI and source review are next; no merge/release. |
| F-008-PHOTO | Photograph and annotate handwritten submissions | Implemented and development verified on `codex/markinator-modes-photo-20261013` at `0347d94`; pushed/read back, review pending | Actual four-page EXIF6/3/8/2 import, raw anchors, delayed-preview guard, markup/transforms/restart/full restore pass; original bytes remain exact. Camera file fallback tested; physical/native checks unverified, OCR shelved. [Evidence](work-orders/MARKINATOR-MODES-PHOTO-P0-2026-10-13.md). |
| F-006 | Installed iPad application | Shelved by Tyler October 14; preserve code and evidence | Resume only on explicit request; [resume map](SHELVED_FEATURES.md) and [iPad guide](IPAD_SUPPORT.md). Not a Windows/Mac release gate. |
| F-008-PDF | Export marked pages, written work and rubric as local PDF | October 14 overwrite repair pushed/read back at `3d54b5e`; 10 exporter tests, browser PDF and `e2ebff6` packaged Windows/Mac arm64 acceptance pass | Review latest branch CI and native physical-dialog limits in [recovery evidence](work-orders/PR31-RECOVERY-2026-10-14.md). Source repair complete; no merge/release authorized. |
| F-008-ARCHIVE | Separate read-only Archive retaining structured assessment records | Independent review at `4335c29` found PR31-B01 and repaired it with deterministic bounded IDs; 53 affected checks pass, validation unchanged | Review repaired candidate/checks and then validate Archive/history in TUV-WORKFLOW. [Independent review](work-orders/PR31-INDEPENDENT-REVIEW.md); earlier recovery/CI evidence retained. Merge/release remain reserved. |
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
