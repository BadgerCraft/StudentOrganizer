# Daily development workflow

## Authoritative current queue — October 7 cleanup

Tyler approved reconciliation with “Clean it up” after reviewing the single-queue proposal. Start and resume project work from `docs/FEATURE_QUEUE.md`. While PR19 is open, read its latest planning revision on `codex/bug-report-scope-20261006` alongside current main and active feature PRs; do not assume main's older queue is current.
- The queue owns current priorities, status, approval evidence, blockers and next actions. Roadmap, bug ledger and checkpoints provide details; historical archives cannot reset active state.
- “Go next” means choose the first eligible already approved action, check its actual evidence and active writer, and continue through repairs/verification/review preparation. Do not ask again for existing approval or duplicate an active coding session.
- Carry every substantive user request into the queue with stable ID and explicit disposition. Preserve requested versus approved; complete means measured acceptance, with merge/release/install stated separately.
- Before ending a batch, reconcile changed statuses and next actions in the queue. If a device/CI/merge gate blocks one item, perform independent authorized work.
- Fresh PR/commit/CI evidence supersedes dated snapshots; update the queue when it changes. Pending planning instructions are not merged main policy.
- This correction does not establish automatic dispatch, schedule changes, cross-chat execution, or global memory/skill changes. Workflow validation remains pending until a fresh resume and useful approved batch are observed.

## Batch execution trial — October 6–8, 2026 (supersedes older daily-rhythm rules)

Tyler approved this trial on October 5 with “Yeah let's get things moving” in response to the batch-work proposal. This authorizes workflow/schedule updates, queue reconciliation and carrying existing approved work through implementation, verification, routine repairs and review preparation. It does not authorize new product scope, spending, accounts, real-student use, merges or releases.

- 08:15 America/Toronto: prepare a batch of useful decisions and approved execution items. Aim for 3–5 substantive items when available; never invent work to fill a quota. Each decision includes outcome, recommendation, strongest drawback, evidence/limits and exact approval consequence. The one-new-learning-brief limit does not limit decision or execution throughput.
- One coordinating coding task works through the whole approved batch, completing verification and review preparation before moving on. A blocked item does not stop independent approved items. Save learning questions for Tyler's return; do not ask for a new direction after each approved milestone.
- Use bounded independent workers where available, separate file/branch ownership and root integration. Inspect current writers before starting. No worker creates an unattended execution mechanism.
- Launch through a usable checkout/execution capability when available. Otherwise provide one concrete Cloud launch instruction for the complete batch and record launch-pending. A schedule, approval or prepared order is not evidence of running work; automatic Cloud dispatch remains unverified.
- 16:00: report actual reviewable outcomes, current execution evidence, blockers, user interventions and the next action; then offer brief due learning/optional documentation. Report during the trial even if progress is zero, explaining why.
- 20:15: continue/select the existing approved batch where execution is available; prepare tomorrow's decisions using technical research. Do not limit eligible independent work to one feature or duplicate an active writer. Keep unchanged launch blockers quiet.
- Maintain a compact current-status snapshot before historical logs. Record approvals, work item dependencies, source heads, task/PR links and evidence. Read fresh contents/SHA before writes; preserve history without making older statements authoritative.
- Trial measures: items made reviewable, avoidable user interventions, approved items left idle and reasons, and verified launch-to-handoff paths. Do not use elapsed time, messages, work orders or PR count as substitutes for completed outcomes.
- On October 8 at the results check, recommend retain/revise/stop using observed evidence. Continue existing schedules after the trial without silently reinstating superseded constraints; ask only for a consequential change.

Active work order: docs/work-orders/BATCH-2026-10-06.md. Proposed administrative source: codex/batch-work-trial; scheduled runs read it while its documentation PR is open.


## Actual execution path — October 5, 2026

The workflow is partially automated. Scheduled briefings and bounded GitHub connector edits/checks/reporting have observed evidence. Automatic dispatch from this conversation or a scheduled briefing into the published Codex Cloud environment has not been verified.

For application work requiring a source workspace, the working path is: record the approved plan and work order → Tyler starts a new task using Work in > Cloud and the published StudentOrganizer environment → the coding task verifies the source, implements and tests available milestones, then persists its branch/results → review and explicitly approve merge/release separately. Do not ask for implementation approval again during this handoff.

This manual launch is currently required when the active chat lacks a usable checkout or execution capability. A saved work order, scheduled wake-up, approval, or subagent does not start or sustain a Cloud coding task. Use prepared/launch-pending until actual execution is observed; use running only with current execution evidence. No unattended feature-completion promise is established by these instructions.

Observed October 5: Tyler manually launched the approved F-006 work in Cloud. It pushed codex/f006-installed-ipad-pilot at a77fe406105f4153f9cb70f5c8af458fb0bee1aa; its work record reports 191 tests/build and browser checks passed. Root independently verified the pushed source and opened draft PR #15 through the GitHub connector after Cloud PR creation failed. Native compilation, simulator/device acceptance and platform regressions for that new revision remain unverified. This proves the manual handoff, not automatic Cloud dispatch.

Automatic launch remains an explicit incomplete workflow improvement. Continue available approved work; report the precise missing capability and provide a concrete handoff when needed. Never imply that merging this documentation supplies that capability.


Tyler sets goals, teacher experience, constraints, priorities, and quality. The agent owns investigation, implementation, meaningful verification, routine repairs, and reviewable changes. This agreement accompanies `AGENTS.md`; `docs/FEATURE_QUEUE.md` records feature status and decisions, and `docs/DEVELOPMENT_LEARNING.md` records learning.

## Daily rhythm — America/Toronto

| Time | Purpose | Expected output |
| --- | --- | --- |
| 08:15 | Approvals and upcoming decisions | What needs Tyler's approval, what completed, concrete blockers, follow-up on yesterday's research, and at most one decision learning brief when Tyler needs it. |
| 16:00 | Learning and optional documentation | One or two due recall questions, feedback when answered, and a concise invitation to explore available decision documentation if Tyler wants. |
| 20:15 | Conditional overnight work | A worthwhile approved task, a complete work order, and accurate launch/running status. Quiet when no eligible task or new actionable finding exists. |

The morning briefing is daily, including when nothing needs approval. Afternoon and evening notifications are conditional on useful material. These named times replace routine hourly progress polling; a task can still report a genuine blocker or required judgment when encountered. Use timezone-aware schedules so Toronto daylight-saving changes are respected.

## Product planning and cross-reference

Read `docs/PRODUCT_ROADMAP.md` alongside the queue. It holds Tyler's review plans and current source-backed features, in this product order: Mac/iPad support; centralized bug reporting; earlier marking-app integration. Produce/refine plans for review and record actual approval before implementation. Look ahead to the next two priorities, doing technical research yourself and preparing a short learning brief only for consequential judgment. Priority is not implementation approval; keep shared approval/status facts consistent with FEATURE_QUEUE.md. Preserve older proposed feature IDs without letting them override this order.

The bounded September 30 test proved unattended documentation editing → draft PR → passing GitHub checks → saved report. It did not dispatch the published Cloud environment or implement a real feature. Use [the report](work-orders/GITHUB_AUTOMATION_TEST_2026-09-30.md) as evidence and validate the next approved real change separately.

## Morning briefing

1. Read current repository/PR/check evidence and the feature queue, including open planning revisions not yet merged. State the source branch when using proposed administrative records.
2. List actual approval items separately: a feature plan, a consequential choice, a merge, or a release. Give each item's link, teacher impact, relevant evidence, remaining uncertainty, recommendation, and exact action that approval would authorize. Do not revive historical upload PRs as current features without evidence.
3. Follow up a genuine consequential choice due today, ordinarily the morning after a decision learning brief was presented. Refer to the original feature and decision ID. Ask for the actual choice and reasoning; record them when received.
4. Inspect the next two or three plausible features. Identify meaningful upcoming choices involving teacher behaviour, data architecture, privacy, durability, cost, or significant lock-in. Diagnose the actual need first. Do not manufacture a database issue or make Tyler choose routine libraries.
5. Complete technical fact-finding yourself first: diagnose the issue, compare viable paths, check current evidence/costs, and make routine implementation decisions. Prepare a personal research package only when Tyler needs new knowledge to judge a consequential choice. Explain the prerequisite terms, how the alternatives work, why the difference matters in StudentOrganizer, the consequences, and the agent's recommendation. Include one focused judgment question and one or two authoritative sources; target 5–10 minutes of learning and offer optional depth. Do not assign Tyler provider, library, or integration research the agent can perform.
6. Save a genuine learning brief beside the feature, including its learning goal, unfamiliar terms, agent findings, actual decision, why Tyler's judgment is needed, presented date, and following-day follow-up date, before reporting it as assigned. If it already exists, reuse it and update changed facts.
7. On Tyler's answer, record the choice and reasoning next to the feature and revise the plan. If the answer leaves implementation approval unclear, ask only the consequential unresolved question. Merge/release approval stays separate.

## Afternoon learning and documentation

- Ask one or two due questions from the learning record before showing answers. Prioritise terms Tyler has actually encountered: what the term means, how it relates to another term, and a simple StudentOrganizer example. Use the agreed spaced schedule and record actual responses/feedback. Consequence/tradeoff questions can support the terminology check; do not repeatedly quiz the already-understood stop/approval rules.
- When a current decision packet has additional documentation, offer an optional deeper explanation or reading session. Mention the feature/decision and what the material would clarify. Tyler may decline or postpone; record that preference without treating it as a decision on the feature.
- Do not flood the afternoon with new assignments, repeat an unanswered prompt in the same conversation, or mark recall successful from silence.
- If no reviews are due and no new optional material is ready, stay quiet. Keep in-session explanation/checks at completed milestones.

## Evening selection and overnight work order

Select a single task with explicit plan approval, resolved blocking product choices, adequate access, meaningful progress available, and no conflicting active writer. Prefer completing an existing approved task over starting another. Inspect actual run evidence before claiming work is still running. Avoid duplicate launches.

Save a work order under `docs/work-orders/<FEATURE-ID>-<date>.md` only when an eligible task exists. Include:

- Feature ID and teacher outcome.
- Approval evidence and exact authorized scope.
- Source branch and commit; target branch; existing PR/task links.
- Milestones and completion checks; workflows/data that must remain intact.
- Resolved decision IDs, constraints, and excluded work.
- Relevant tests, build, browser flows, and platform-specific checks.
- Stop conditions limited to a genuine blocker or consequential judgment; independent approved work continues.
- Expected review window and morning handoff: work completed, evidence, remaining risks, and approval needed.
- Execution status: prepared, launch-pending, running, blocked, or ready-for-review; task ID/link when actually returned.

Start work through a launch or execution capability actually available in that run. Approval of the plan already authorizes execution; do not ask again just because it is evening. Do not promise hours of execution merely because a reminder is scheduled. If launching is unavailable, save the complete order, identify the missing capability, and report launch-pending. Notify again about an unchanged blocker only when there is a new action or changed evidence.

No current Cloud-launch control is exposed to this chat. Relevant plugin discovery did not establish one. The evening schedule is therefore a conditional selection/briefing with a launch-ready work order; automatic Cloud-task dispatch has not been verified.

## Parallel agents

Tyler explicitly requested parallel subagents on 2026-09-30. Use them for independent approved work so technical Windows investigation and overnight setup can proceed together. The coordinating agent owns shared queue/learning/workflow writes and integrates findings. Delegate bounded scopes, assign separate code branches or file ownership when implementing, and avoid multiple writers on the same files. A subagent is a worker for part of a task; its existence is not proof of unattended scheduling or hours-long execution.

## Durable records and concurrent work

- Commit administrative records on the active planning branch or related feature branch. Keep a documentation PR current as needed; do not silently merge it.
- Read latest file contents/SHA before writes and preserve newer answers. Queue updates should not interfere with a running feature branch. Reconcile the planning record at handoff.
- Scheduled runs read `main` plus current open planning/workflow PRs that change these files. Use the newest coherent record, not a stale main-only copy; identify its provenance.
- Maintain approval evidence, follow-up dates, task links, and the last documentation/evening notification in the queue. A prompt sent is not a response received.
- Use fictional student data. Do not record private personal reflections or real student records in this public repository.
- Keep all three schedules in this project chat where available, so reply context is retained. The repository remains the durable cross-task record.

## Environment status and scheduled-task limits

Tyler created and published the reusable StudentOrganizer Cloud environment and supplied successful web-development verification: Node 24, 152 tests, build, and classroom/Markbook/Assessment browser flows. Windows packaging needs its own evidence.

A new actual coding task uses the published environment; it is distinct from publishing an application release. GitHub stores durable code, plans, and results. Never say a reply keeps working after its turn ends without an actual task/execution mechanism.

Official documentation: [Scheduled tasks](https://learn.chatgpt.com/docs/automations) and [Cloud environments](https://learn.chatgpt.com/docs/environments/cloud-environments). Scheduled web runs can use connected tools and durable prompts but do not retain a local worktree between runs. Confirm the available execution tools and source checkout for each coding run.

## Primary coordination — October 6, 2026

Tyler designated the current StudentOrganizer Cloud conversation as the primary project conversation and launched the whole approved batch here. A real checkout and command execution are present; workers used separate isolated checkouts. This is observed manual launch-to-execution evidence, not automatic dispatch. The host exposes no durable task URL or schedule migration control; none is fabricated. Keep review results and decisions in this conversation and durable branch records; existing scheduled threads may still need a separate product-supported migration.

### Schedule migration access boundary

October 6 user instruction: daily 08:15 morning batch and16:00 results/learning belong in this primary conversation;20:15 continuation must remain paused. Exact live prompts/IDs/states and conversation binding are unavailable to this coding toolset. No replacements/disable operations or scheduled execution probes occurred. Do not substitute this Cloud task’s checkout/tools for evidence about a scheduled run. Preserve old schedules until confirmed replacements exist; use the explicit migration and readback order in SCHEDULE-MIGRATION-2026-10-06.md.
