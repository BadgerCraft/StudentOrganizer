# Feature and decision queue

Updated: 2026-10-01. This is the shared queue for StudentOrganizer. Read `AGENTS.md`, `docs/CODING_WORKFLOW.md`, and `docs/DEVELOPMENT_LEARNING.md`. Tyler's product priority order is Mac/iPad support, central bug reporting, then marking-app integration. The original priority request approved planning; October 1's recorded daily approval authorizes the bounded implementation below. Detailed plans and current-feature cross-reference are in [PRODUCT_ROADMAP.md](PRODUCT_ROADMAP.md).

## Queue discipline

- Keep a stable feature ID, teacher outcome, priority, status, plan, dependencies, completion checks, branch/PR/task links, and consequential decisions together.
- Statuses: proposed, planning, awaiting-decision, approved, running, blocked, ready-for-review, completed, deferred. An approved plan and its scope require actual Tyler approval evidence; a suggested priority or silence is not approval.
- Record implementation approval, merge approval, and release approval separately, with date and the actual instruction or its faithful summary.
- Do not use PR numbers alone as evidence that a feature is approved, running, or complete. Inspect current branches, checks, and execution status.
- Record each major decision under its feature: question, options, consequences, recommendation, sources, research assigned date, follow-up due date, Tyler's actual choice and reasoning, and what that authorizes.
- Complete technical investigation yourself. A research package for Tyler is a short learning brief that supplies the knowledge needed for a genuinely consequential product, cost, data, or architecture decision. It is not outsourced fact-finding. Introduce at most one new learning brief per morning by default, only when Tyler's judgment is needed; inspect upcoming features to give him time to learn.
- Follow up the following morning after a research assignment. If Tyler needs more time, record that and adjust the date. An unanswered consequential choice remains unresolved; independent approved work can continue.
- Administrative queue, research-packet, work-order, and learning-record updates are authorized by Tyler's workflow request. Commit them on the active planning branch or related feature branch, prepare/update a documentation PR as needed, and keep merge/release approval separate. Re-read current file SHA before writing; never overwrite newer answers.
- Briefings must inspect current `main` and open planning/workflow PRs containing these records. Use the newest coherent planning revision when it contains updates not yet merged, identify its branch, and distinguish proposed choices from approved decisions. Initial planning PR: #11, branch `codex/approved-plan-workflow`.
- Track last briefing/research/documentation offered dates. Avoid repeatedly notifying about the same unchanged evening blocker or repeatedly offering the same optional reading.

## F-001 — Standing workflow and learning process
- Teacher/development outcome: plan together, autonomous execution within approved scope, regular learning, and predictable review times.
- Status: ready-for-review. Proposed priority: first, because other work uses these rules.
- Implementation scope authorized: Tyler's requests for agent instructions, recorded learning, spaced repetition, and the daily briefing workflow, 2026-09-30.
- Branch/PR: `codex/approved-plan-workflow`, [PR #11](https://github.com/BadgerCraft/StudentOrganizer/pull/11).
- Completion checks: documentation references resolve; schedules confirmed enabled; GitHub access tested; actual overnight launch capability distinguished from a prepared order.
- Merge approval: pending. Release approval: none requested.
- Dependency: shared AGENTS/workflow files reconciled October 1 to identical content on PR #10 and #11. Recommended reserved merge sequence: #11 first to supply referenced planning records, then recheck #10's integration/checks before merging. Root owns any remaining routine conflicts.
- Next decision: review and approve merging the final workflow changes.

## F-002 — Windows colleague QA handoff
- Teacher outcome: colleagues can identify the exact fictional-data QA build, launch it, and retain an assessment after restart.
- Status: review prepared; refreshed exact-head checks pending after October 1 instruction reconciliation. Earlier application verification remains successful; do not call the new head merge-ready until its checks complete.
- Plan/evidence: [PR #10](https://github.com/BadgerCraft/StudentOrganizer/pull/10), branch `codex/windows-qa-handoff`. PR reports 152 passing tests, production build, actual portable and installed-app launches/restarts on Windows, and identifiable QA artifacts.
- Current measured package status: both files NotSigned, publisher null. A colleague's downloaded-file prompts and device policy have not been tested.
- Completion checks still distinct: colleague download/launch feedback; explicit approval before publishing any prerelease/tag.
- Merge approval: pending. Release approval: pending, separate from merge.
- Dependencies: review workflow overlaps with F-001. Real-student use and Mac packaging remain separate decisions.

### F-002 / DEC-001 — Pilot and publisher signing
- Status: technical investigation complete; user-facing learning brief available, no option selected.
- Correction, 2026-09-30: the prior research homework and 2026-10-01 homework follow-up were withdrawn after Tyler clarified his intent. Technical facts, eligibility, costs, build integration, and warnings are the agent's work.
- Agent findings, 2026-09-30: PR #10 remains open at d871359a220116a88aea3688f8ea3592db1f8eb0; Windows run 36723299899 is completed/successful. Both package signatures remain NotSigned. Current Microsoft onboarding supports Canadian individual developers, subject to paid Azure account and identity validation. Artifact Signing Basic is US$9.99/month with 5,000 signatures; currency conversion/tax not verified. Personal legal name and city/province/country appear in the certificate. Signing establishes publisher identity/integrity, while new-file download reputation and device policy remain separate.
- Potential Tyler decision: intended tester/device context, acceptable installation friction, and whether a verified signing expense is worthwhile for the intended audience. Ask only after explaining the evidence and why that judgment is his.
- Existing evidence: PR #10 reports both packages NotSigned and publisher null; actual colleague download prompts/device policy are untested.
- Learning brief, if needed: explain code signing (publisher identity and tamper detection), publisher, and download reputation with a StudentOrganizer example. Signing does not by itself establish that a new file has sufficient download reputation.
- Agent responsibilities: determine viable technical paths, verify service eligibility and current cost, propose a practical route, and handle implementation research. Do not ask Tyler to research provider facts or treat reading as a prerequisite to routine work.
- Primary sources checked by the delegated technical investigation, 2026-09-30: [Microsoft onboarding](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart), [current pricing](https://azure.microsoft.com/en-ca/products/artifact-signing/), [SmartScreen](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation), and [signing integration](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-signing-integrations). Follow electron-builder v26 configuration used by the project, not the newer v27 signing API.
- Tyler's actual choice/reasoning: none recorded.
- Next-day follow-up: schedule only after a genuine decision learning brief has been presented and assigned; otherwise this belongs in the ordinary progress briefing.
- Agent recommendation: a bounded fictional-data pilot on suitable personally controlled devices after the reserved review, with signing investigated in parallel. Do not ask testers to disable security or evade school policy. Before wider distribution, Tyler's real choices are acceptable cost, public publisher identity, intended audience, and device constraints; technical provider/integration research remains ours.
- Optional 16:00 documentation: the relevant code-signing/publisher/reputation explanations and primary sources are available. Last offered: not yet.

## F-003 — Focused browser fixture corrections
- Teacher/development outcome: browser checks represent the Toronto school day and the current mark-scale version accurately.
- Status: proposed; implementation approval not recorded in this queue.
- Source: current `AGENTS.md` identifies V6.6 UTC/Toronto date and mark-scale version-ID mismatches.
- Plan needed: reproduce the current failures, inspect the fixture, and scope the smallest correction.
- Completion checks: focused browser scenario passes with current date/scale handling; production behaviour is preserved.
- Priority: Tyler to choose. Not a blanket blocker for the fictional-data QA pilot.
- Major decision: none established. Diagnose before assigning research or changing stored data.

## F-004 — Assessment Hub and Markbook workflow
- Teacher outcome: prioritise concrete improvements in assessment creation, navigation, and markbook use.
- Status: proposed; detailed plan and implementation approval not recorded.
- Source: recorded follow-up in current `AGENTS.md`.
- Plan needed: inspect current screens and reproduce the specific teacher friction before proposing changes.
- Completion checks: define with the chosen teacher workflow.
- Major decision: none established. Do not invent a database problem or architectural choice from a hypothetical example.
- Priority: Tyler to choose.

## F-005 — Establish overnight execution
- Outcome: approved work can run while Tyler is away and return a factual result for morning review.
- Status: bounded daytime continuation edit/check/report iteration established October1; current platform verification continues. Existing documentation probe complete; automatic Cloud dispatch remains unverified.
- Approval evidence: Tyler, 2026-09-30: "Sure, let's figure out the overnight execution path." He then explicitly requested subagents so Windows research and this setup proceed together.
- Current authorised work: test scheduled execution, inspect supported launch mechanisms, prepare a bounded validation order, and document actual outcomes. No paid infrastructure, application feature, merge, or release is approved by this setup request.
- Parallel work: Windows signing/distribution research and overnight launch research run independently; root coordinates and owns shared planning records.
- Execution probe completed: GitHub reads/writes and shell commands passed (Node v24.19.0, npm 11.9.0, Git 2.51.1). No repository checkout existed in the scratch workspace; direct github.com access was outside permitted destinations, so cloning was not attempted. Application tests/build were NOT RUN. The published Cloud environment was not confirmed as this run's runtime.
- Probe report target: `docs/work-orders/SCHEDULED_EXECUTION_PROBE_2026-09-30.md`.
- Completion checks: a real task or scheduled run has observed execution evidence, uses a usable source workspace, can perform appropriate verification, persists a result, and returns to review without silently merging/releasing. Automatic dispatch must be proven separately from a manual launch.
- Supported immediate route: manually start a task with Work in > Cloud > the already published StudentOrganizer environment. The earlier supplied verification already established that environment; do not repeat setup merely because a general Work run lacks a checkout.
- Automatic route to test with current tools: scheduled agent makes scoped branch changes through the connected GitHub app, and GitHub Actions supplies the checkout/dependency/test/build computer. Both pieces have working evidence, and the October1 continuation now supplies observed scoped feature repairs, exact-source checks and persisted reporting. This establishes that iteration, not arbitrary future execution or Cloud dispatch. Existing main Windows workflow triggers on pull requests, checks out source, runs npm ci/npm test, and packages the app.
- Additional automatic route: project-scoped desktop scheduling against the real repository; requires Tyler's Windows computer online and ChatGPT running.
- Potential Cloud dispatch bridge: official GitHub integration documentation says a non-review request in a Codex bot PR comment starts a legacy cloud task. This composition with nightly scheduling is untested, and the new published environment cannot be assumed to configure the legacy integration. Any external bot-message dispatch needs explicit communication authorization before posting.
- Dots can coordinate Cloud tasks if available to the account; access and dispatch tools are not established in this chat. No plan upgrade is required to test the other paths.
- Primary references: [Cloud tasks](https://learn.chatgpt.com/docs/environments/cloud-environments), [scheduled tasks](https://learn.chatgpt.com/docs/automations), [GitHub integration](https://learn.chatgpt.com/docs/third-party/github), [dot tasks](https://learn.chatgpt.com/docs/dots/tasks-and-memory).
- Approved execution test completed, 2026-09-30: actual unattended marker commit 65df51d143398126027d1aa81fad73c23870674c → [draft PR #12](https://github.com/BadgerCraft/StudentOrganizer/pull/12) → [successful Windows CI run 36747961539](https://github.com/BadgerCraft/StudentOrganizer/actions/runs/36747961539) → [persisted report](work-orders/GITHUB_AUTOMATION_TEST_2026-09-30.md). 152 tests/19 files, production build/Windows packaging and unpacked desktop assessment/restart check passed. This proves the bounded documentation edit/check/report sequence; general unattended feature coding and Cloud dispatch remain unverified. No application feature, merge, or release was performed.

## Tyler's product priorities — requested 2026-09-30

Detailed review plans, decision lookahead and source-backed current-feature inventory: [PRODUCT_ROADMAP.md](PRODUCT_ROADMAP.md). Read this file before asking Tyler to rank earlier proposals again.

### F-006 — Mac and iPad support (priority 1)
- Status: approved implementation; Mac desktop plus iPad Home Screen app with independent local data and manual full-backup transfer initially. No automatic synchronization.
- Teacher outcome: use the agreed classroom workflows on supported Mac/iPad devices with verified persistence and recovery.
- Planning authorization: September 30. Implementation approval: Tyler replied “Approved” October 1, 09:18 America/Toronto to the recommended daily scope. Merge/release approval: none.
- Plan: shared compatibility baseline, Mac packaging and actual launch checks, chosen iPad delivery path/touch/offline/file handling, real-device verification, review handoff.
- Decision DEC-002: delivery expectations and whether device-to-device synchronization belongs in first scope; current app has no live sync. Tyler approved Mac Electron and iPad Home Screen implementation October 1 with manual full-backup transfer; platform completion remains subject to observed verification.
- Brief prepared September 30; complete brief not yet presented/assigned, next-day follow-up not set.
- Optional documentation offered, 2026-09-30 afternoon: desktop packaging, iPad Home Screen delivery, and device synchronization for DEC-002. Tyler replied "Defer" at 16:47 America/Toronto on September 30; optional reading deferred. No replacement date requested. Do not repeat this unchanged offer at the next check-in; revisit when Tyler requests it or meaningful new decision material warrants it. This defers documentation only; no platform choice, implementation approval, or successful recall is inferred.

### F-007 — Central bug reporting (priority 2)
- Status: bounded implementation approved: reporting draft/preview/error handling and safe metadata, plus private account-free intake investigation. Actual central submission requires an established route; new service/access/spending decisions remain separate.
- Teacher outcome: easy report from app, accurate saved/submitted state, stable central record and fix linkage.
- Planning authorization: September 30. Bounded implementation approval: Tyler’s October 1 “Approved” to the recommended daily scope. Merge/release approval: none.
- Plan: report entry/preview, safe build/platform context, reliable intake/offline handling, canonical docs/BUG_REPORTS.md ledger, triage and end-to-end arrival verification. Local draft/reporting code and an empty canonical ledger are implemented in draft PR #13; private central receipt is not connected.
- Decision DEC-003: reporter account requirements and public/private visibility. Agent owns service/transport research; no embedded privileged GitHub token or automatic student payload.
- Lookahead after platform plan; no homework or next-day decision assigned yet.

### F-008 — Earlier marking-app integration (priority 3)
- Status: planning/discovery; latest standalone source not inspected.
- Teacher outcome: reuse useful marking tools and deliberately link approved evidence to the right student/assessment.
- Planning authorization: Tyler explicitly requested this third, September 30. Implementation/merge/release approval: none.
- Plan: inspect latest source, verify reuse/features/storage formats, propose one linked marking workspace, preserve records/identity/calculations, explicit save-to-Markbook behaviour, fictional end-to-end/import/recovery verification.
- Decision DEC-004: retained student-text scope and draft versus formal-evidence transfer after actual source inspection. Voice/AI marking not assumed included.
- Access gap: latest accessible source/repository needed for a source-specific implementation plan. Do not publish private project locations.

## Execution readiness

- Reusable cloud environment: user supplied a successful web-development verification report on 2026-09-30; published setup, 152 tests, build, and browser flow. This records the supplied report, not current task-launch access.
- Current chat tools: connected GitHub reads/writes and scheduled check-ins are verified. No callable Codex Cloud task-launch control was found in the current tools or the relevant plugin search.
- F-005 setup investigation is explicitly approved. F-006 and bounded F-007 implementation are approved October 1; F-008 remains discovery/planning. F-003/F-004 remain proposed outside that order. Preparing this queue does not approve features.
- Evening behaviour: select one approved, unblocked, worthwhile task only when one exists. Create a complete work order; start it only through actual available execution/launch capability, then record the task ID/link and observed status. Otherwise record launch-pending with the exact blocker.
- Last evening eligibility check: 2026-09-30, America/Toronto. Source: open PR #11 / codex/approved-plan-workflow; main lacks the newer planning records. No eligible implementation task: F-001/F-002 await reserved review, bounded F-005 probe is complete, and F-003/F-004/F-006/F-007/F-008 have no recorded implementation approval. PR #10/#11/#12 checks were inspected; package checks succeeded (PR #10 release job skipped). No work order, new task, merge, release, or repeated probe launched. User notification suppressed because the evening eligibility condition was unmet. Recurring check remains enabled for future approved work.

## Decision history

- 2026-09-30: Tyler explicitly requested daily 08:15 approval/research briefing, 16:00 learning plus optional documentation, and conditional 20:15 overnight-work check-in, all America/Toronto. These times supersede the earlier suggested 4–6-hour progress-check cadence and 15:00 learning reminder.
- 2026-09-30: Tyler clarified that personal research packages should build his knowledge for consequential choices; technical fact-finding belongs to the agent. He requested terminology-focused learning checks and parallel subagents for overnight setup and Windows QA research.
- Research decisions about application features remain pending until Tyler actually chooses.


## Morning briefing — 2026-10-01, America/Toronto

- Planning source: open PR #11, `codex/approved-plan-workflow`; current main remains a608e01913b7c8ec211fcbac18f9bf325d05402f and lacks the newer queue/roadmap/learning records.
- Completed: bounded F-005 test remains successful at exact PR #12 source 65df51d143398126027d1aa81fad73c23870674c and run 36747961539. No eligible feature implementation was authorized overnight, and none was launched. No repeated probe, merge, or release.
- Reserved approvals: F-001/#11 workflow-document merge; F-002/#10 Windows QA merge after refreshed checks and #11 integration; WF-001 separate workflow-improvement implementation plan. No new approval inferred from priority, silence, or documentation deferral.
- Shared-file overlap handled: PR #10 AGENTS.md and docs/CODING_WORKFLOW.md now match #11. Documentation-only commits 1b677e446bc24d53e2ad719d30b4351882df8d5e and cabe98d8280503b5dd954b7f6a2621a1e488358a; no application/CI configuration edited. New-head automatic checks must be observed before claiming success. Earlier run 36723299899 verified 152 tests, build and actual portable/installed app restart; colleague-device prompts and publication remain unverified.
- Lookahead: F-006 remains first; initial Mac/iPad scope still needs delivery/data-transfer judgment before implementation approval. F-007 requires account/visibility judgment when its plan is reviewed. F-008 requires accessible latest marking-app source before source-specific integration planning. No invented database issue.
- Research assigned today: none. No genuine decision-learning brief has been assigned for next-day follow-up. Signing homework remains withdrawn. Optional DEC-002 reading remains deferred per Tyler's September 30 reply; no replacement date or feature decision inferred. Term recall belongs to the afternoon check-in.
- WF-001 (separate workflow backlog): Tyler requested an implementation plan for shared component lessons and future-agent reuse, for October 1 review. Tyler approved WF-001 on October 1 with “Yes, approved WF001”; implementation of the bounded pilot is authorized. Proposed bounded scope: minimal versioned lesson documents, evidence/status rules, relevant retrieval/update instructions, one fictional-data pilot, and review package. No service provisioning, spending, application database redesign, merge, or release. Planning completed; implementation approved October 1 and in progress. Review recommendation: approve this bounded scope if it matches Tyler's intent; preserve the separate product priority order.

## WF-001 completion — October 1
- Explicit approval: Tyler: “Yes, approved WF001”. Bounded implementation complete; [pilot report](work-orders/WF-001-2026-10-01.md).
- Reuse Component Lessons installed with authoritative shared references outside application repositories. Independent fictional SQLite pilot passed and coordinating agent reran checks; context mismatch, uncertain comment, supersession and two-proposal integration recorded with limits.
- Project agent pointer prepared on PR #11; merge pending, release not requested. Product F-006/F-007/F-008 implementation remains unapproved. No new automation or paid infrastructure.

### WF-001 reuse policy — Tyler's choice, October 1
- Actual instruction: “No, I think that measured approach makes sense - apply it”. Declined further example; selected proportional applicability checks.
- Policy: quick comparison for familiar matching technology/assumptions; deeper investigation when mismatches, stored records or recovery make errors consequential. Agent owns comparison and verification without routine permission questions. Existing skill already requires context comparison; this refines depth, not new feature scope. No merge/release approval inferred.


## Daily authorization — October 1, 09:18 America/Toronto
- Actual reply: Tyler: “Approved”, in response to recommended items 1–3 in DAILY_TASKS_2026-10-01.md.
- Authorized: F-005 one bounded daytime implementation trial using existing access; F-006 Mac desktop plus iPad Home Screen app with manual full-backup transfer initially, live sync deferred; F-007 private account-free reporting experience, local drafts/preview/error handling/safe metadata, and central transport research.
- New hosting/account/data-access/spending choices require a concrete review. Real platform support needs actual Mac/iPad evidence; physical iPad and HTTPS delivery are not established.
- F-008 source discovery remains authorized; integration not approved. Merge/release remain reserved. No need to repeat implementation approval.
- Active implementation branch: codex/mac-ipad-support, based on main a608e01913b7c8ec211fcbac18f9bf325d05402f. Coordinator owns shared planning writes; parallel iPad/bug-report workers have separate files. Actual session implementation started; background schedule/task evidence recorded after tool confirmation.
- Work order: docs/work-orders/DAYTIME-2026-10-01.md on this planning branch. Daily agenda saved separately as DAILY_TASKS_2026-10-01.md; repository queue is execution authorization source for scheduled runs.


## Daytime execution evidence — October 1
- Implementation approval recorded above; active PR [#13](https://github.com/BadgerCraft/StudentOrganizer/pull/13), branch codex/mac-ipad-support, initial source 466e5d0047861fe9cad9ec76e9694372575f5427.
- Current session: real isolated checkout matches current main a608e019; source changes published through connected GitHub. 159 local tests and production build pass; electron-builder v26 schema and exact built offline-shell checks at root/subfolder pass. Local browser binaries unavailable; ordinary downloads failed, so browser runtime checks run on GitHub.
- Actual run: Mac/iPad [36869731888](https://github.com/BadgerCraft/StudentOrganizer/actions/runs/36869731888); Windows regression [36869731841](https://github.com/BadgerCraft/StudentOrganizer/actions/runs/36869731841). Mac packaging started; initial Chromium touch test found a seat-move tap opening profile, routine fix underway. Do not call feature complete or initial run passed.
- Daytime continuation created successfully, enabled around noon and 15:00 Toronto today only; task 6abe5f041bd48191a319ac67b7dc9a08. This establishes future wake-up configuration; those runs have not yet been observed. Existing scheduled prompts updated with actual approval.
- F-007 local draft/preview/error handling implemented with seven focused tests. Central transport NOT CONNECTED; docs/BUG_REPORTING_INTAKE.md contains concrete private account-free receiving-service proposal. No new service/account/data-access/spending approved.
- F-008 discovery: historical Markinator 3000 summary/audit/walkthrough found; actual latest source unavailable in accessible repositories/files. Needs current code-only archive or repository before source-specific integration. Historical voice was explicitly unimplemented; do not claim shipped voice/presets/analytics. Private source locations stay out of public Git.

### October 1 revised implementation check

- Draft PR #13 now uses source ee6545df39e462fe1f2c6b4368640fec4379229c. Initial Windows run36869731841 succeeded; initial Mac/iPad run36869731888 failed, exposing seat-move tap interception and skipped PR code signing. Both scoped repairs are in the revised source, with full actual-package recovery/mark/photo checks added. New exact-source runs36871250635 (Mac/iPad) and36871250607 (Windows) are observed running; no passing new-head UI claim yet.
- Local revised source:159 tests, production/typecheck build and exact generated worker checks at root/subfolder passed. Current implementation is on codex/mac-ipad-support. HTTPS delivery, physical devices and private central report receiving remain explicit unmet milestones, not reasons to repeat implementation approval.

### Latest continuation handoff — October1

Exact feature head: [90a06c139b0a67604b15d0d288c45f3e7fd63ee8](https://github.com/BadgerCraft/StudentOrganizer/commit/90a06c139b0a67604b15d0d288c45f3e7fd63ee8). [Mac/iPad run36893625121](https://github.com/BadgerCraft/StudentOrganizer/actions/runs/36893625121) and [Windows run36893624890](https://github.com/BadgerCraft/StudentOrganizer/actions/runs/36893624890) observed running. Current-head platform PASS is pending.

Prior source830c4ce: Windows run36892338872 PASS; Intel Mac job110470775654 in run36892338859 PASS on actual DMG/ZIP recovery. Chromium completed touch portrait/landscape/split, swaps, attendance, notes, photo, K percentage/feedback, roster/CSV/full backup, invalid-restore preservation, confirmed restore and offline process reopen with retained records. Report-draft failure/reload/download checks PASS. WebKit completed classroom/recovery, then failed offline reopening at page.goto with an internal error. ARM Mac persisted the correct87 mark but an immediate UI read still saw '--'. These are observed failures, not current-source passes.

Latest bounded harness repairs wait for the visible mark after database commit and stop the origin server before process reopening. Both engines must receive the reopened document from their service worker; Chromium also uses network-offline emulation. WebKit uses an unavailable origin instead, matching the scoped diagnosis in [Playwright issue42775](https://github.com/microsoft/playwright/issues/42775), opened September18, checked October1. This is cached reopening during an origin outage, not physical-device airplane-mode evidence. TypeScript and whitespace checks PASS. No production grading/storage change was needed for these harness failures.

Immediate next action: inspect exact90a06c1 jobs/logs, fix only scoped failures and record the coherent-source outcome. Physical iPad Home Screen/Files/keyboard/airplane-mode checks, stable HTTPS delivery, downloaded-file Gatekeeper/managed-Mac acceptance and private report receipt remain separate unmet milestones. F-008 still needs current code-only source; integration unapproved. No merge/release/new provider/account/access/spending or external message.

Relevant shared applicability check: index/database v4 DB-003 matches Dexie occupied-seat uniqueness and rollback; packaging v1 PKG-001/PKG-002 matches the unchanged builder/signature and Electron recovery harness. Existing measured fixes were retained, not re-probed. SQLite-only DB-001/002 remain insufficient Dexie proof. New WebKit observation is not promoted to physical-device support.

