# Feature and decision queue

Updated: October 8, 2026, America/Toronto. Owner: Tyler; coordinating agent maintains this record.
**This is the authoritative current execution queue for StudentOrganizer and Markinator.**
Current planning revision: `codex/bug-report-scope-20261006`, [PR19](https://github.com/BadgerCraft/StudentOrganizer/pull/19), pending merge. Read this revision while the cleanup PR is open; main's older queue is stale. Refresh the branch/PR before relying on a recorded head.

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

## Next approved batch

| Order / ID | Status and existing authority | Evidence / owner | Next action and dependency |
| --- | --- | --- | --- |
| 0 / Queue reconciliation and authorization continuity | Implemented in open PR19; Tyler “Clean it up”, then October8 “continue” after asking to remove routine reauthorization | PR19; current coordinator | One current queue and explicit approval-through-branch-publication policy in AGENTS/workflow. Existing approval covers ordinary tests, scoped CI harness/evidence changes, commits, fast-forward feature pushes and PR updates. Main documentation merge remains reserved. October8 fresh-session retrieval and bounded review work were observed; cross-agent/scheduled continuation remains unverified. |
| 2 / F-008 Markinator acceptance | Ready-for-review; October6 integration order, October7 review/runtime approvals; October8 routine verification/publication continuation | PR20 head30a13dd; Windows37780989087 and Mac/browser37780989028 both SUCCESS, refreshed October8. Runtime race and upgrade regressions included | v3-to-v4 tests preserve all 35 legacy collections/indexes, reopen and rubric use: 9 focused tests/build PASS locally. Published source30a13dd; [Windows37780989087](https://github.com/BadgerCraft/StudentOrganizer/actions/runs/37780989087) and [Mac/browser37780989028](https://github.com/BadgerCraft/StudentOrganizer/actions/runs/37780989028) observed COMPLETED/SUCCESS. 289 tests/32 files, actual Windows portable/installed checks, ARM/Intel Mac packages/restart, Chromium/WebKit classroom/recovery/Markinator and unsigned iOS compile PASS. Production unchanged. Then present the reserved main-merge decision; physical iPad/dialog/old-new installer upgrade stays unverified. |
| 3 / F-006 installed iPad | Blocked native interaction; preparation approved October 5 | PR18 merged aa64da1; native project, asset checks and unsigned SDK compile exist | Finish available matrix/documentation while device work is blocked. Actual simulator/physical Files, touch selection, background/resume, offline/storage, export and free-signing renewal require Mac/Xcode/device access. Browser or compilation results do not prove these. |
| 4 / F-007 central bug receipt | Requested receiver adoption; local draft implementation completed | PR19 receiver decision packet; no deployed receiver or verified receipt | Reconcile actual dashboard/access and Tyler replies before repeating a decision. Prepare concrete bug-only receiver setup; adoption/support-sign-in/access remains unresolved in the records. Do not transmit classroom records or invent provider approval. |
| 5 / UI QA remaining items | Requested / scoped review; only QA02/03 implementation was approved and merged | Ten-item table below; coordinator owns diagnosis/planning | Prepare a coherent next repair proposal from actual reproduction and teacher workflow risk. Keep all eight remaining requests visible; do not treat the seating approval as approval for unrelated features. |

No production-code work is started by this documentation batch. Refresh PR20 before any handoff because another coding conversation owns its runtime work.

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
| WF-002 workflow reliability / automatic launch / schedule migration | Incomplete; separate workflow priority #1 remains in its workflow plan | This cleanup fixes queue routing only. No scheduler change, automatic Cloud launch, global memory or skill modification claimed. Observe fresh-session resume and completed batch before calling workflow reliability verified. |

## Completion handoff for this cleanup

Authority: Tyler approved the proposal with “Clean it up” on October 7 at23:38 Toronto.
Changes: one current queue; ten QA dispositions; update lookup versus installation; current Markinator acceptance; future marking modes/photo work; shared routing and historical separation.
Verification required: all ten QA IDs occur once in the current table; every open item has next action/dependency; links resolve; preserved historical bytes; reviewed source/PR evidence. Documentation-only: no application build/test required.
October8 reconciliation: Tyler explicitly approved publication of the prepared five-file correction with “Go for it”. Both PR20 runs succeeded for source30a13dd, tested as synthetic merge d41f1fc into main aa64da1; release remained skipped. This planning branch preserves PR17's newer batch/PR18-merge evidence, October6 learning entry, PR18 review and afternoon results. Historical archives remain unchanged. Fresh-session queue retrieval and approved review preparation were observed; automatic dispatch and cross-agent behavior remain unverified.

Next reserved decisions: review main merges for PR19 documentation and PR20 Markinator; release/distribution remains separate. PR10/13/15 are overlapping source proposals retained via merged PR18, not additional merges to perform blindly. PR17 remains open pending the consolidated documentation merge and a supersession decision. Physical iPad, native dialogs/printing/Gatekeeper and actual old/new installer upgrade remain unverified. Eight UI requests and future marking modes/photo workflow remain requested; central bug receipt remains unresolved.
Reserved: documentation/application merges, releases, spending, service adoption, real student use and external distribution.

## Historical records

Prior queue snapshots are preserved verbatim in [history/FEATURE_QUEUE-through-2026-10-07.md](history/FEATURE_QUEUE-through-2026-10-07.md). They are historical approval/evidence records and do not determine current priorities, status or next actions. New factual corrections belong above; do not append a competing active queue to history.
