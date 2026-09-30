# Feature and decision queue

Updated: 2026-09-30. This is the shared queue for StudentOrganizer. Read `AGENTS.md`, `docs/CODING_WORKFLOW.md`, and `docs/DEVELOPMENT_LEARNING.md`. Priority order below is proposed unless explicitly approved.

## Queue discipline

- Keep a stable feature ID, teacher outcome, priority, status, plan, dependencies, completion checks, branch/PR/task links, and consequential decisions together.
- Statuses: proposed, planning, awaiting-decision, approved, running, blocked, ready-for-review, completed, deferred. An approved plan and its scope require actual Tyler approval evidence; a suggested priority or silence is not approval.
- Record implementation approval, merge approval, and release approval separately, with date and the actual instruction or its faithful summary.
- Do not use PR numbers alone as evidence that a feature is approved, running, or complete. Inspect current branches, checks, and execution status.
- Record each major decision under its feature: question, options, consequences, recommendation, sources, research assigned date, follow-up due date, Tyler's actual choice and reasoning, and what that authorizes.
- Present at most one new major research assignment per morning by default. Inspect the next two or three plausible queued features and raise decisions early enough to allow a day of consideration. Routine implementation details belong to the agent.
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

### F-002 / DEC-001 — Sequence a small pilot and publisher signing
- Status: research assigned; no option selected.
- Assigned: 2026-09-30. Follow-up due: 2026-10-01 morning briefing.
- Question: should a small fictional-data pilot happen before publisher signing, or should signing be addressed before that pilot?
- Option A: use the currently verified unsigned build for a tightly bounded pilot only on a suitable device where the owner/IT permits it. Learn what actual download and launch prompts appear. Do not ask anyone to disable protections or evade device policy.
- Option B: first investigate signing eligibility, recurring cost, and integration into Windows builds, then plan the pilot. Signing verifies publisher identity; it does not guarantee that a new download has no warnings.
- Agent recommendation: first establish the intended tester/device and permitted installation path. If an unsigned pilot is disallowed, Option A is unavailable. If allowed, decide whether early usability feedback is worth the additional download friction. No signing purchase or public release is authorized.
- What Tyler should research: how important a smooth colleague download is for this pilot, what device will be used, and whether that device's owner/IT permits this distribution route. The agent handles signing implementation details and current provider verification.
- Essential reading (5–10 minutes): [Microsoft's SmartScreen explanation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation), especially publisher reputation, new-download warnings, and enterprise policy.
- Optional deeper reading: [Microsoft's code-signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options). Read distribution paths and identity requirements; verify actual provider terms before any purchase.
- Evidence checked: current PR #10 body and the two Microsoft primary pages, 2026-09-30. No actual colleague-device policy has been established.
- Follow-up question: which sequence fits the pilot you want, and what device or installation constraints should determine it?
- Tyler's choice/reasoning: not recorded.
- Authorization resulting from choice: none yet.
- Documentation available for optional 16:00 discussion: yes. Last offered: not yet.

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

## Execution readiness

- Reusable cloud environment: user supplied a successful web-development verification report on 2026-09-30; published setup, 152 tests, build, and browser flow. This records the supplied report, not current task-launch access.
- Current chat tools: connected GitHub reads/writes and scheduled check-ins are verified. No callable Codex Cloud task-launch control was found in the current tools or the relevant plugin search.
- No unstarted application feature currently has an approved plan recorded here. Preparing this queue does not approve F-003 or F-004.
- Evening behaviour: select one approved, unblocked, worthwhile task only when one exists. Create a complete work order; start it only through actual available execution/launch capability, then record the task ID/link and observed status. Otherwise record launch-pending with the exact blocker.
- Last evening report: none.

## Decision history

- 2026-09-30: Tyler explicitly requested daily 08:15 approval/research briefing, 16:00 learning plus optional documentation, and conditional 20:15 overnight-work check-in, all America/Toronto. These times supersede the earlier suggested 4–6-hour progress-check cadence and 15:00 learning reminder.
- Research decisions about application features remain pending until Tyler responds.
