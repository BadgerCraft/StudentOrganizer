# Feature and decision queue

Updated: October 9, 2026, America/Toronto. Owner: Tyler; coordinating agent maintains this record.
**This is the authoritative current execution queue for StudentOrganizer and Markinator.**
Canonical planning is on main after merged PR19 at `a1d985ea2e7597cf86b119eec0d925370097f883`. PR17 closed unmerged as superseded; its source/history remain. Refresh actual PR20 head/check/merge state before acting.

## Installer implementation is current priority — October 9, 19:29 Toronto

Tyler: “Let's shelve that for now. I'd like to get the auto-installer running.” Proceed with implementation and verification on `codex/windows-installer-updates-20261009`: explicit check -> download/cancel -> local verified backup -> deliberate install/reopen for installed Windows NSIS. This supersedes the earlier investigation-only implementation hold. No startup checks, automatic download/ordinary-quit installation or automatic student upload. No spending/account adoption, main merge or installer release/distribution is implied.

Store privacy/packaging investigation is dormant. Revisit when Tyler chooses Store distribution or a free verified-publisher route is needed. Previously verified current-source privacy evidence remains valid for that source, while new installer networking has its own dedicated fixed-host/headers boundary. Current unsigned tests require an explicit unchecked acknowledgement; checksum integrity is not trusted publisher identity. Publisher signing and unsigned public distribution remain unresolved separate release judgments, not a ban on fictional-data development.

Implementation owns a complete39-table validated backup saved/read back before replacement, stable app identity/profile, single-instance guard, SHA512/signature recheck, bounded cancellation/retry, and portable exclusion. Root integrates Settings/controller and current lessons; bounded backend/harness workers have nonoverlapping files. Independent review found launch-error state/early quit and cancellation during signature checks; both require repairs before final acceptance. Final local310 tests/33 files and production build passed, including repairs for both review findings. [Updater PR22](https://github.com/BadgerCraft/StudentOrganizer/pull/22) is published at b6225ab2094e94c206795c19cab9f4dcb9f1bcd4; Windows run38005758285 passed its normal installed/portable, assessment and network-boundary checks but replacement acceptance stopped before download at an installed IPC authorization rejection. Mac/iPad/browser run38005758251 passed all three jobs. Test-only owned-frame/URL diagnostics were added at 0bcbad45f0d00d1384049f2f41d48febbe2b54cc; Windows run38006392763 is now running to identify the failure without weakening production authorization. Actual A1.0.1 -> B1.0.2 installed package replacement/reopen/all-table marking recovery and failed/cancelled download checks are pending native CI, not yet PASS. Installer elevation is deliberately blocked; directory writability and OS installer spawn are confirmed before quitting. Existing copies need one manual bootstrap, and actual stable publishing/latest.yml remains a reserved release gate. See implementation record in WINDOWS_MANUAL_UPDATES.md on its branch. Merge/release and physical/managed-device claims stay separate.

## Current privacy verification — October 9, 2026

Tyler asked to verify the student-privacy consequences of Microsoft Store updates now. Current main `b9a8790f4841fa9fd5057e7cfef097f619cbac4a` has no active student-content network sender: local IndexedDB/storage and marking/import/export; no production cloud-sync worker, remote AI, telemetry or bug-report receiver. The only app-controlled outbound exception is the explicitly clicked Windows release metadata GET to fixed GitHub, with no student payload. Production CSP and Electron session guards block renderer network access. Fresh focused tests: 58/4 PASS; production typecheck/build PASS and built CSP inspected. Exact-source Windows run37973955991/job113967364555 already passed its packaged network-boundary smoke with zero collector requests; this is existing CI evidence, not a fresh local Windows launch.

Store/MSIX is **UNVERIFIED**: no package/configuration/identity exists yet. Current findings do not establish Store-package privacy, old-to-new preservation, uninstall retention, Windows diagnostics or device cloud-backup settings. App data/full JSON backups are not app-encrypted; a deliberately exported backup in a synced folder can be uploaded outside the app. Microsoft states optional Windows crash diagnostics may contain user content; do not repeat an absolute “Microsoft cannot see student data” guarantee. Details and acceptance gates: [privacy verification record](work-orders/SECURITY-2026-10-02-RESULTS.md#current-source-and-store-privacy-verification--october-9-2026). No app code, account, release, spending or real-student use was introduced.

## Free-only delivery constraint — October 9, 18:05 Toronto

Tyler: “Yeah I'm not paying for anything.” No paid signing, subscriptions, certificates, account fees or paid services. The earlier paid-Azure recommendation is rejected and must not be presented again as the default. Keep unsigned release/distribution on hold and the real old-to-new preservation requirements intact.

Current free-route investigation: Microsoft documents free Store developer onboarding and Store signing for MSIX packages; this is the leading candidate, not adopted/published. Existing code has NSIS/portable only, no Store package identity/configuration and no migration acceptance. MSIX can redirect app-data access and uses Store-managed delivery/update behavior; evaluate both against legacy `%APPDATA%` records and Tyler's deliberate-click update requirement before an implementation proposal. Do not assume Store packaging automatically preserves existing records or an unsigned EXE becomes trusted outside the Store.

Alternative: SignPath Foundation free signing requires an OSI-approved open-source license, existing release/reputation, approval and signing policy. No LICENSE file was found in the current checkout. A public repository alone does not meet this requirement; changing licensing/rights is Tyler's consequential judgment and is not authorized to obtain free signing. Acceptance is discretionary. No application, license change, account or subscription was created.

Next authorized work is a free Store compatibility/migration/update-control plan; retain SignPath as an alternative with explicit eligibility/licensing limits. Once concrete, ask only for the actual distribution/account/licensing choice needed. No paid fallback without Tyler changing this constraint. Source and remaining acceptance: WINDOWS_MANUAL_UPDATES.md.

## Current delivery priority — October 9, 17:53 Toronto

Tyler declined moving straight to an unsigned pilot: “I think the unsigned feature needs to be figured out first. Further, it doesn't sound like the replacement when updating/installing is figured out.” **Hold QA release/distribution until publisher signing and actual old-to-new replacement are resolved.** This is authorization for investigation and a concrete delivery plan, not spending, account/service creation, or an approved automatic-installer implementation.

Coordinator inspected main source: no code-signing configuration/publisher, no updater download/install bridge or electron-updater dependency. The Windows packaged harness installs one current build into a disposable directory and reopens it; it does not install version A, populate records, then replace it with B. Database fixture migration and same-version restart are not upgrade evidence.

Next judgment: select direct signed Windows delivery (recommended Azure Artifact Signing, Microsoft quotes approximately $9.99/month; Canadian checkout/tax and identity eligibility require confirmation) versus a free Microsoft Store MSIX route with additional packaging/data-path/distribution investigation. Do not provision either without actual approval. Signing identifies the publisher; it does not guarantee no SmartScreen or school-policy warning.

Next engineering proposal: preserve app identity and user-data path; establish signed first install and A-to-B replacement before adding user-clicked update installation. Verify backup, originals, rubric/feedback/marks/history and pending drafts, failed/cancelled updates and recovery. Installed NSIS is the proposed integrated-update path; portable replacement is a separate deliberate flow. No silent switch between them. See [Windows delivery plan](WINDOWS_MANUAL_UPDATES.md). No code, release or purchase is performed by this plan. Bug-receiver adoption remains separate and does not interrupt this priority.

## Current recovery checkpoint — October 9, 17:10 Toronto

Tyler deleted the Daily checkins conversation and instructed: “Make this the new one with scheduled checkins. Pick up where it left off.” The replacement coordination chat has two scheduler-confirmed, enabled daily check-ins, starting October 10: 08:15 morning batch and 16:00 results/learning, America/Toronto. Both were read back with the same current conversation binding before old schedule state was checked. Old morning/afternoon schedules are disabled; 20:15 continuation remains paused. Other usage-review schedules were unchanged. See [schedule migration record](work-orders/SCHEDULE-MIGRATION-2026-10-06.md). Scheduled execution/tool inheritance still needs an actual scheduled run.

**PR19/PR20 merge sequence is completed, not underway.** Live PR20 metadata confirms merge at 14:32:05 Toronto to `b9a8790f4841fa9fd5057e7cfef097f619cbac4a`; final tree matches tested source `4c00a046b965eddcfe25c13730d16b243c6689a6`. Fresh merged-main [Windows run 37973955991](https://github.com/BadgerCraft/StudentOrganizer/actions/runs/37973955991) completed SUCCESS. Its `OntarioTeacherAssessment-Windows-1.0.0-qa.185.1` artifact is available, not expired, and expires January 7, 2027. This is build availability, not a release or distribution. PR20 records 289 tests/build plus desktop/browser acceptance and the explicit native-device/upgrade limitations. Do not repeat either approved merge.

Recovery owner: the coordinator in the replacement check-in chat. A fresh clean checkout of main was obtained here; GitHub reads and shell execution work. No new production change or ongoing worker from the deleted chat is proven. A bounded read-only delivery/prerequisite investigation runs separately; the coordinator alone owns these records. The interrupted chat's unsaved work is not recoverable from repository evidence and is not assumed completed.

Next actions: prepare combined-app Windows delivery from the verified build and the exact release boundary; inspect bug-only receiver prerequisites against the existing F-007 recommendation and actual authorization/access. Installer download/install/reopen remains unfinished and its trusted channel/publisher and authentic old/new acceptance remain unresolved. F-007 provider adoption and private receipt are not established. Continue concrete preparation; do not invent service/release approvals. Physical iPad remains access-blocked. Eight remaining UI requests and marking modes/photo work remain requested scope.

The historical pre-merge snapshots below retain their original evidence. This recovery checkpoint and current PR metadata supersede their “underway” and schedule-unavailable claims.

## Historical approved merge sequence — October 9

Tyler replied **“Yes, continue.”** at14:14 America/Toronto after the explicit proposal to merge PR19, reconcile PR20 against updated main, rerun its checks and merge PR20 if clean. Actual merge approval covers that sequence; it is not a recall answer or release approval.

PR19 merged at14:14:34; exact-head Windows37948151985 and Mac/browser37948151977 passed. PR17 closed at14:17:36 without merging/deleting its source. Coordinator owns PR20 reconciliation: canonical planning plus both learning histories; application/test/workflow/dependency bytes stay source30a13dd. Fresh exact-source checks gate the approved main merge; old-main passes are historical. Status is underway until actual PR20 metadata/body records completion. [Merge work order](work-orders/PR20-MERGE-2026-10-09.md) records scope/checks. Do not repeat this approval. A source merge leaves installed copies unchanged; release/distribution/services/access/spending/real-student use/new scope remain reserved.


## How to use “go next”

1. Read this queue and refresh the evidence for the first eligible approved item. Check for an active writer before taking ownership.
2. Continue existing approval through implementation, repairs, verification, commits, normal isolated-branch pushes, related PR creation/updates and review preparation. Approval does not expire at a turn or milestone. Application release/distribution and main merge remain separate.
3. A pending CI job, unavailable device or reserved merge decision does not block independent authorized work. Move to the next eligible item; do not duplicate a running writer.
4. Requested items remain visible, but are not blanket implementation approval. Finish investigation/plan preparation needed to present a concrete scope; ask only for an unresolved consequential judgment.
5. Before ending a batch, update status, exact source/evidence, blocker, next action and owner here. Mark a feature complete only when its stated acceptance passes; distinguish merged, released and installed.
6. Roadmap describes product scope; bug ledger preserves reports; work orders and checkpoints hold detailed evidence. They reference this queue and cannot independently reset priorities or approvals. If a newer source contradicts this snapshot, reconcile it before acting; history is evidence, not today's queue.

Status vocabulary: requested, approved, underway, blocked, ready-for-review, completed, deliberately-deferred.
Workflow-only WF items remain in the separate workflow plan; this queue links them for coordination without importing that backlog.

## Standing authorization recorded — October 8

Tyler asked “How can we change the repeated authorization for routine verification or publication of already approved work?” and instructed “continue”. The plan-approval boundary now explicitly includes routine branch publication and PR preparation, as defined in AGENTS.md/CODING_WORKFLOW.md. Scope changes, force/destructive operations, access/spending, main merge, releases/distribution and real-student use remain reserved. A platform rejection must be reported faithfully and cannot be bypassed. This is project authorization, not proof of automatic Cloud dispatch or guaranteed skill invocation.

Current concrete application: the October8 database-upgrade verification is carried through tests/build, commit, normal feature-branch push and PR20 update without another approval question. Update new CI evidence before a merge verdict. Preserve Tyler's actual learning reply; no general test count guarantees classroom satisfaction.

## October 8 afternoon results / trial decision

The three-day trial assessment is saved in [BATCH-2026-10-06.md](work-orders/BATCH-2026-10-06.md). Recommendation: revise while retaining batch execution, the single current queue and approved authorization-through-review-publication. Three bounded teacher-facing code outcomes are reviewable: roster/seating and manual update lookup merged via PR18; core local Markinator ready in PR20. PR creation, repairs/tests and administrative records are not additional features.

Freshly fetched current PR20 source30a13dd/test merged41f1fc: Windows37780989087 and Mac/browser37780989028 completed SUCCESS; logs confirm289 tests/32 files. Build, actual supported desktop packages/restart and browser acceptance PASS; release skipped and physical iPad/OS dialogs/old-new installer upgrade remain unverified. No live coding worker is observed in this coordinator's tree; no Cloud task ID/link or published-environment usage is established. This results check retrieved the active source and completed administrative verification using a usable shell checkout plus GitHub connector; no new production implementation or duplicate launch.

Trial friction: at least one documented avoidable reauthorization, plus a distinct later automatic approval-review interruption; no total intervention count across conversations is invented. Keep routine publication authorized, preserve platform enforcement and reserve actual main merge/release decisions. Remaining eight UI requests are not approved implementation, and device/access gates are explicit. No schedule, service or release change is performed.

Optional DEV018 term review is offered for a later response, with answer withheld; no recall supplied or stage advanced. DEV020 first review remains October9. Next action: review reserved PR19/PR20 main merges, keeping release/distribution separate.

## Historical October 9 morning decisions and execution order

Fresh evidence: main `aa64da1b`; PR19 head `fd5ef399`, open/non-draft/mergeable, 17 ahead/0 behind, exact-head Windows [37837242064](https://github.com/BadgerCraft/StudentOrganizer/actions/runs/37837242064) and Mac/browser [37837242066](https://github.com/BadgerCraft/StudentOrganizer/actions/runs/37837242066) SUCCESS; PR20 head `30a13ddd`, open/non-draft/mergeable, 14 ahead/0 behind, exact-source Windows [37780989087](https://github.com/BadgerCraft/StudentOrganizer/actions/runs/37780989087) and Mac/browser [37780989028](https://github.com/BadgerCraft/StudentOrganizer/actions/runs/37780989028) SUCCESS. Neither PR has submitted reviews or inline review threads. No live coding worker/task ID is observed by this coordinator.

Decision order:

1. **PR19 documentation/workflow merge.** Recommendation: approve. It makes this single queue and authorization-through-review-publication policy canonical on main and supersedes divergent/nonmergeable PR17. Strongest drawback: a large documentation rewrite with dated operating history in AGENTS.md. Approval consequence: merge documentation only; then close PR17 as superseded without merging after confirming PR19 landed. No application/release/service behavior changes.
2. **PR20 Markinator merge after PR19.** Recommendation: approve as a verified development checkpoint, not a release. It is a large, high-impact 49-file change (+5,116/-28) affecting persistent marking/grade data, so human review remains required. Current protection is strong for changed paths but partial for rollout:289 tests/32 files, desktop packages/restart, browser marking/recovery and additive v3-to-v4 preservation pass; actual old/new installer upgrade, physical iPad and native-dialog checks remain unverified. Approval consequence: after PR19 merges, reconcile PR20's overlapping DEVELOPMENT_LEARNING/PRODUCT_ROADMAP records against new main, rerun exact-source checks, and merge PR20 only if that protected result remains clean. The installed app and release remain unchanged.
3. **F-007 bug receiver architecture.** A decision learning brief is assigned today with follow-up due October10. Recommendation remains Supabase Free with separate support accounts and a Tyler-only inbox. Strongest drawback: a hosted provider/account dependency, manual enrollment and possible free-project sleep. Alternatives are per-device invite tokens (more custom security/maintenance) or manual copy/export (no integrated receipt/status). Approval would authorize bug-only implementation/verification with fictional data; it would not authorize spending, real teacher invitations, student content, deployment, merge or release.

Execution ownership: current coordinator owns administrative reconciliation. No production work starts before the reserved decisions. If PR19/PR20 merges are approved together, execute them in the protected order above without a second routine-authorization prompt; stop only for a changed head, failed check or new consequential conflict. F-006 physical acceptance remains blocked by Mac/Xcode/device access and does not block these decisions.

## October 9 approval-to-execution correction

Tyler asked for the explicit post-approval instruction “Good, you approved what needed to be done. Now paste this to Codex.” This request authorizes the workflow update. AGENTS.md/CODING_WORKFLOW.md now require immediate execution with sufficient tools, or a complete primary-Codex work instruction when another workspace is required; no extra prompt-request round trip. The reusable drive-approved-work skill was validated and successfully saved to its remote master at30045b3, preserving newer remote skill content and unrelated local edits. Project instructions were read back exactly; future invocation/execution is not inferred. No main merge, release, receiver adoption or task launch is inferred from this workflow approval.

## Next approved batch

| Order / ID | Status and existing authority | Evidence / owner | Next action and dependency |
| --- | --- | --- | --- |
| 0 / Queue reconciliation and authorization continuity | Completed source merge; October9 “Yes, continue.” | PR19 merged a1d985e; PR17 closed superseded; coordinator | Canonical policy/queue on main. Replacement check-in schedules are confirmed October 9; actual scheduled execution/automatic launch/cross-agent continuation remains unverified. |
| 2 / F-008 Markinator acceptance | Completed development merge; PR20 merged October 9 at 14:32:05 | main b9a8790; PR20 exact-source acceptance and merged-main Windows37973955991 SUCCESS | Prepare combined-app pilot delivery. Physical iPad/dialog/old-new installer upgrade remain unverified; release/distribution separate. Do not repeat merge. |
| 3 / F-006 installed iPad | Blocked native interaction; preparation approved October 5 | PR18 merged aa64da1; native project, asset checks and unsigned SDK compile exist | Finish available matrix/documentation while device work is blocked. Actual simulator/physical Files, touch selection, background/resume, offline/storage, export and free-signing renewal require Mac/Xcode/device access. Browser or compilation results do not prove these. |
| 4 / F-007 central bug receipt | Requested receiver adoption; local draft implementation completed | PR19 receiver decision packet; no deployed receiver or verified receipt | Reconcile actual dashboard/access and Tyler replies before repeating a decision. Prepare concrete bug-only receiver setup; adoption/support-sign-in/access remains unresolved in the records. Do not transmit classroom records or invent provider approval. |
| 5 / UI QA remaining items | Requested / scoped review; only QA02/03 implementation was approved and merged | Ten-item table below; coordinator owns diagnosis/planning | Prepare a coherent next repair proposal from actual reproduction and teacher workflow risk. Keep all eight remaining requests visible; do not treat the seating approval as approval for unrelated features. |

No production-code change in reconciliation. Coordinator owns this approved PR20 merge sequence; check actual source/writers before competing publication.

## Tyler’s October 5 UI findings

Source: direct conversation, fictional Windows QA; screenshot unavailable. Details remain in [BUG_REPORTS.md](BUG_REPORTS.md).

| Stable ID | Requested outcome | Status / approval | Next action / evidence |
| --- | --- | --- | --- |
| QA-20261005-01 | Teacher-profile prompt every launch | Requested; shared-device/session attribution must remain explicit | Reproduce intended prompt; propose session behavior without assuming persistent identity approval. |
| QA-20261005-02 | Imported class not empty; Populate discoverable; correct empty-seat controls | Completed; roster/seating repair approved | Merged PR18 aa64da1; source64c6a3a; actual browser flow and combined desktop checks. Release/install remain separate. |
| QA-20261005-03 | Randomize confirmation works | Completed under same seating approval | Same PR18 evidence; preservation/rollback/actor checks. |
| QA-20261005-04 | Participation defaults/buttons and consistent tooltips | Requested | Reproduce new-class empty state and all classifications; prepare bounded repair. |
| QA-20261005-05 | Ontario conversion preset shows useful content | Requested | Inspect active preset rendering/loading and propose fix. |
| QA-20261005-06 | Easy removal from class roster | Requested | Plan confirmed unenrollment/archive preserving marks/history/audit. No destructive student deletion authorized. |
| QA-20261005-07 | Local photo crop/resize/preview/confirmation | Requested; planned for scoped review | Define cancel-safe on-device flow; automatic existing resizing is not a crop/preview implementation. |
| QA-20261005-08 | Discoverable unit create/name/rename/edit | Requested | Inspect existing metadata and controls; define unit lifecycle without duplicate UI. |
| QA-20261005-09 | Collapse formative/summative details to overall grade | Requested; planned for scoped review | Define display and aggregation without changing grading policy. |
| QA-20261005-10 | K, T, C, A order consistently | Requested | Inspect affected headers/lists; preserve IDs, weights and independent category evidence. |

## Other retained work and future features

| ID / item | Status / authority | Next action / revisit condition |
| --- | --- | --- |
| F-002 Windows/Mac preparation | Completed within PR18 preparation scope, merged; actual generic package/restart checks passed | Colleague download, managed-device/publisher/Gatekeeper checks, release and real-student use are separate. Markinator-specific package acceptance stays F-008. |
| Windows update lookup | Completed, tested and merged PR18; Tyler approved bottom-of-Settings, click-only check | No launch polling. Installed copy changes only after deliberate package delivery. |
| Windows update installation | Blocked / unfinished; not delivered by lookup | Establish concrete trusted installer/publisher/channel and old/new record-preservation acceptance before download/install/reopen. Do not assume spending, unsigned release or executable installation approval. |
| F-004 Assessment Hub/Markbook | Requested | Incorporate QA06/08/09/10 into a concrete workflow plan; general assessment/category editing remains a gap. |
| F-003 date/scale browser fixtures | Historical proposed follow-up; current reproduction unverified | Check actual current failures before scheduling; do not perpetuate a historical blocker after repaired fixtures. |
| F-008-MODES | Requested October 7; future scope | After current integration: essay + rubric, oral checklist + rubric, rubric only, all linked to existing KTAC finalization. Prepare plan before implementation. |
| F-008-PHOTO | Requested October 7; future scope | After current integration: local capture/import and annotations on handwritten work; original image retained. OCR optional, not required or newly approved. |
| F-009 exemplar repository | Deliberately deferred by Tyler October 6 | Revisit after bug-report transfer works; deliberate selected essay/feedback sharing only. |
| Marking extensions | Deliberately deferred by current work order | Full annotated-essay reports, file-based rubric input, PDF/OCR, legacy Markinator JSON, scratch marking. Revisit on concrete demand after core acceptance. |
| Live sync/cloud backup, voice/AI, general redo, purge policy | Not implemented; no current implementation authorization | Keep as possibilities only; propose separate concrete scope if requested. |
| WF-002 workflow reliability / automatic launch / schedule migration | Incomplete; separate workflow priority #1 remains in its workflow plan | October 9 replacement schedules and fresh-checkout recovery are observed. Actual scheduled execution/automatic Cloud launch remain unverified; verify the first replacement run. This recovery makes no global-memory/skill change. |

## Completion handoff for this cleanup

Authority: Tyler approved the proposal with “Clean it up” on October 7 at23:38 Toronto.
Changes: one current queue; ten QA dispositions; update lookup versus installation; current Markinator acceptance; future marking modes/photo work; shared routing and historical separation.
Verification required: all ten QA IDs occur once in the current table; every open item has next action/dependency; links resolve; preserved historical bytes; reviewed source/PR evidence. Documentation-only: no application build/test required.
October8 reconciliation: Tyler explicitly approved publication of the prepared five-file correction with “Go for it”. Both PR20 runs succeeded for source30a13dd, tested as synthetic merge d41f1fc into main aa64da1; release remained skipped. This planning branch preserves PR17's newer batch/PR18-merge evidence, October6 learning entry, PR18 review and afternoon results. Historical archives remain unchanged. Fresh-session queue retrieval and approved review preparation were observed; automatic dispatch and cross-agent behavior remain unverified.

Current approved merge sequence: PR19 landed, PR17 closed superseded, PR20 proceeds through fresh checks and authorized merge. Release/distribution remains separate. PR10/13/15 are overlapping source proposals retained via merged PR18, not additional merges to perform blindly. Physical iPad, native dialogs/printing/Gatekeeper and actual old/new installer upgrade remain unverified. Eight UI requests and future marking modes/photo workflow remain requested; central bug receipt remains unresolved.
Reserved beyond this sequence: other main merges, releases, spending, service adoption, real student use and external distribution.

## Historical records

Prior queue snapshots are preserved verbatim in [history/FEATURE_QUEUE-through-2026-10-07.md](history/FEATURE_QUEUE-through-2026-10-07.md). They are historical approval/evidence records and do not determine current priorities, status or next actions. New factual corrections belong above; do not append a competing active queue to history.
