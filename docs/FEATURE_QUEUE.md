# Feature and decision queue

Updated: 2026-09-30. This is the shared queue for StudentOrganizer. Read `AGENTS.md`, `docs/CODING_WORKFLOW.md`, and `docs/DEVELOPMENT_LEARNING.md`. Priority order below is proposed unless explicitly approved.

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
- Status: agent technical investigation; no option selected.
- Correction, 2026-09-30: the prior research homework and 2026-10-01 homework follow-up were withdrawn after Tyler clarified his intent. Technical facts, eligibility, costs, build integration, and warnings are the agent's work.
- Current work: an independent subagent is investigating current Microsoft requirements and the actual PR #10 evidence. Root will integrate the findings here.
- Potential Tyler decision: intended tester/device context, acceptable installation friction, and whether a verified signing expense is worthwhile for the intended audience. Ask only after explaining the evidence and why that judgment is his.
- Existing evidence: PR #10 reports both packages NotSigned and publisher null; actual colleague download prompts/device policy are untested.
- Learning brief, if needed: explain code signing (publisher identity and tamper detection), publisher, and download reputation with a StudentOrganizer example. Signing does not by itself establish that a new file has sufficient download reputation.
- Agent responsibilities: determine viable technical paths, verify service eligibility and current cost, propose a practical route, and handle implementation research. Do not ask Tyler to research provider facts or treat reading as a prerequisite to routine work.
- Sources already checked: [Microsoft SmartScreen](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation) and [code-signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options), 2026-09-30. Further verification in progress.
- Tyler's actual choice/reasoning: none recorded.
- Next-day follow-up: schedule only after a genuine decision learning brief has been presented and assigned; otherwise this belongs in the ordinary progress briefing.
- Optional 16:00 documentation: offer explanation/source reading after the technical investigation has identified the relevant decision. Last offered: not yet.

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
- Execution probe: one-time scheduled job created, testing GitHub access, shell/runtime availability, source checkout, and durable reporting. Creation confirms scheduling, not completion.
- Probe report target: `docs/work-orders/SCHEDULED_EXECUTION_PROBE_2026-09-30.md`.
- Completion checks: a real task or scheduled run has observed execution evidence, uses a usable source workspace, can perform appropriate verification, persists a result, and returns to review without silently merging/releasing. Automatic dispatch must be proven separately from a manual launch.
- Next required action: determine from actual probe and official launch research; avoid repeating the already completed environment setup.

## Execution readiness

- Reusable cloud environment: user supplied a successful web-development verification report on 2026-09-30; published setup, 152 tests, build, and browser flow. This records the supplied report, not current task-launch access.
- Current chat tools: connected GitHub reads/writes and scheduled check-ins are verified. No callable Codex Cloud task-launch control was found in the current tools or the relevant plugin search.
- F-005 setup investigation is explicitly approved; F-003 and F-004 application plans remain unapproved. Preparing this queue does not approve them.
- Evening behaviour: select one approved, unblocked, worthwhile task only when one exists. Create a complete work order; start it only through actual available execution/launch capability, then record the task ID/link and observed status. Otherwise record launch-pending with the exact blocker.
- Last evening report: none.

## Decision history

- 2026-09-30: Tyler explicitly requested daily 08:15 approval/research briefing, 16:00 learning plus optional documentation, and conditional 20:15 overnight-work check-in, all America/Toronto. These times supersede the earlier suggested 4–6-hour progress-check cadence and 15:00 learning reminder.
- 2026-09-30: Tyler clarified that personal research packages should build his knowledge for consequential choices; technical fact-finding belongs to the agent. He requested terminology-focused learning checks and parallel subagents for overnight setup and Windows QA research.
- Research decisions about application features remain pending until Tyler actually chooses.
