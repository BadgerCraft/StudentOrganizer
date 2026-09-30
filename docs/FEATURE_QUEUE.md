# Feature and decision queue

Updated: 2026-09-30. This is the shared queue for StudentOrganizer. Read `AGENTS.md`, `docs/CODING_WORKFLOW.md`, and `docs/DEVELOPMENT_LEARNING.md`. Tyler's product priority order is Mac/iPad support, central bug reporting, then marking-app integration. Priority approves planning, not feature implementation. Detailed plans and current-feature cross-reference are in [PRODUCT_ROADMAP.md](PRODUCT_ROADMAP.md).

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
- Dependency: reconcile shared AGENTS/workflow changes with PR #10 during the merge sequence; the agent owns routine conflict resolution.
- Next decision: review and approve merging the final workflow changes.

## F-002 — Windows colleague QA handoff
- Teacher outcome: colleagues can identify the exact fictional-data QA build, launch it, and retain an assessment after restart.
- Status: ready-for-review; based on PR #10's report, recheck current PR/checks at briefing time.
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
- Status: running investigation; automatic Cloud dispatch not yet proven.
- Approval evidence: Tyler, 2026-09-30: "Sure, let's figure out the overnight execution path." He then explicitly requested subagents so Windows research and this setup proceed together.
- Current authorised work: test scheduled execution, inspect supported launch mechanisms, prepare a bounded validation order, and document actual outcomes. No paid infrastructure, application feature, merge, or release is approved by this setup request.
- Parallel work: Windows signing/distribution research and overnight launch research run independently; root coordinates and owns shared planning records.
- Execution probe completed: GitHub reads/writes and shell commands passed (Node v24.19.0, npm 11.9.0, Git 2.51.1). No repository checkout existed in the scratch workspace; direct github.com access was outside permitted destinations, so cloning was not attempted. Application tests/build were NOT RUN. The published Cloud environment was not confirmed as this run's runtime.
- Probe report target: `docs/work-orders/SCHEDULED_EXECUTION_PROBE_2026-09-30.md`.
- Completion checks: a real task or scheduled run has observed execution evidence, uses a usable source workspace, can perform appropriate verification, persists a result, and returns to review without silently merging/releasing. Automatic dispatch must be proven separately from a manual launch.
- Supported immediate route: manually start a task with Work in > Cloud > the already published StudentOrganizer environment. The earlier supplied verification already established that environment; do not repeat setup merely because a general Work run lacks a checkout.
- Automatic route to test with current tools: scheduled agent makes scoped branch changes through the connected GitHub app, and GitHub Actions supplies the checkout/dependency/test/build computer. Both pieces have working evidence, but the combined unattended feature loop remains unproven. Existing main Windows workflow triggers on pull requests, checks out source, runs npm ci/npm test, and packages the app.
- Additional automatic route: project-scoped desktop scheduling against the real repository; requires Tyler's Windows computer online and ChatGPT running.
- Potential Cloud dispatch bridge: official GitHub integration documentation says a non-review request in a Codex bot PR comment starts a legacy cloud task. This composition with nightly scheduling is untested, and the new published environment cannot be assumed to configure the legacy integration. Any external bot-message dispatch needs explicit communication authorization before posting.
- Dots can coordinate Cloud tasks if available to the account; access and dispatch tools are not established in this chat. No plan upgrade is required to test the other paths.
- Primary references: [Cloud tasks](https://learn.chatgpt.com/docs/environments/cloud-environments), [scheduled tasks](https://learn.chatgpt.com/docs/automations), [GitHub integration](https://learn.chatgpt.com/docs/third-party/github), [dot tasks](https://learn.chatgpt.com/docs/dots/tasks-and-memory).
- Approved execution test completed, 2026-09-30: actual unattended marker commit 65df51d143398126027d1aa81fad73c23870674c → [draft PR #12](https://github.com/BadgerCraft/StudentOrganizer/pull/12) → [successful Windows CI run 36747961539](https://github.com/BadgerCraft/StudentOrganizer/actions/runs/36747961539) → [persisted report](work-orders/GITHUB_AUTOMATION_TEST_2026-09-30.md). 152 tests/19 files, production build/Windows packaging and unpacked desktop assessment/restart check passed. This proves the bounded documentation edit/check/report sequence; general unattended feature coding and Cloud dispatch remain unverified. No application feature, merge, or release was performed.

## Tyler's product priorities — requested 2026-09-30

Detailed review plans, decision lookahead and source-backed current-feature inventory: [PRODUCT_ROADMAP.md](PRODUCT_ROADMAP.md). Read this file before asking Tyler to rank earlier proposals again.

### F-006 — Mac and iPad support (priority 1)
- Status: planning; proposed staged implementation, awaiting platform/data judgment and plan approval.
- Teacher outcome: use the agreed classroom workflows on supported Mac/iPad devices with verified persistence and recovery.
- Planning authorization: Tyler explicitly requested this first, September 30. Implementation/merge/release approval: none.
- Plan: shared compatibility baseline, Mac packaging and actual launch checks, chosen iPad delivery path/touch/offline/file handling, real-device verification, review handoff.
- Decision DEC-002: delivery expectations and whether device-to-device synchronization belongs in first scope; current app has no live sync. Mac Electron and iPad Home Screen delivery are proposed candidates, not approved or verified.
- Brief prepared September 30; complete brief not yet presented/assigned, next-day follow-up not set.

### F-007 — Central bug reporting (priority 2)
- Status: planning; draft implementation plan awaits approval.
- Teacher outcome: easy report from app, accurate saved/submitted state, stable central record and fix linkage.
- Planning authorization: Tyler explicitly requested this second, September 30. Implementation/merge/release approval: none.
- Plan: report entry/preview, safe build/platform context, reliable intake/offline handling, canonical docs/BUG_REPORTS.md ledger, triage and end-to-end arrival verification. The ledger/reporting feature is proposed, not yet implemented.
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
- F-005 setup investigation is explicitly approved. F-006/F-007/F-008 have approved priority/planning, not implementation; F-003/F-004 remain proposed outside that order. Preparing this queue does not approve features.
- Evening behaviour: select one approved, unblocked, worthwhile task only when one exists. Create a complete work order; start it only through actual available execution/launch capability, then record the task ID/link and observed status. Otherwise record launch-pending with the exact blocker.
- Last evening report: none.

## Decision history

- 2026-09-30: Tyler explicitly requested daily 08:15 approval/research briefing, 16:00 learning plus optional documentation, and conditional 20:15 overnight-work check-in, all America/Toronto. These times supersede the earlier suggested 4–6-hour progress-check cadence and 15:00 learning reminder.
- 2026-09-30: Tyler clarified that personal research packages should build his knowledge for consequential choices; technical fact-finding belongs to the agent. He requested terminology-focused learning checks and parallel subagents for overnight setup and Windows QA research.
- Research decisions about application features remain pending until Tyler actually chooses.
