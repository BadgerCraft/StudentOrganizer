# Daily development workflow

Tyler sets goals, teacher experience, constraints, priorities, and quality. The agent owns investigation, implementation, meaningful verification, routine repairs, and reviewable changes. This agreement accompanies `AGENTS.md`; `docs/FEATURE_QUEUE.md` records feature status and decisions, and `docs/DEVELOPMENT_LEARNING.md` records learning.

## Daily rhythm — America/Toronto

| Time | Purpose | Expected output |
| --- | --- | --- |
| 08:15 | Approvals and upcoming decisions | What needs Tyler's approval, what completed, concrete blockers, follow-up on yesterday's research, and at most one new major research assignment. |
| 16:00 | Learning and optional documentation | One or two due recall questions, feedback when answered, and a concise invitation to explore available decision documentation if Tyler wants. |
| 20:15 | Conditional overnight work | A worthwhile approved task, a complete work order, and accurate launch/running status. Quiet when no eligible task or new actionable finding exists. |

The morning briefing is daily, including when nothing needs approval. Afternoon and evening notifications are conditional on useful material. These named times replace routine hourly progress polling; a task can still report a genuine blocker or required judgment when encountered. Use timezone-aware schedules so Toronto daylight-saving changes are respected.

## Morning briefing

1. Read current repository/PR/check evidence and the feature queue, including open planning revisions not yet merged. State the source branch when using proposed administrative records.
2. List actual approval items separately: a feature plan, a consequential choice, a merge, or a release. Give each item's link, teacher impact, relevant evidence, remaining uncertainty, recommendation, and exact action that approval would authorize. Do not revive historical upload PRs as current features without evidence.
3. Follow up any research decision due today, ordinarily the morning after its research assignment. Refer to the original feature and decision ID. Ask for the actual choice and reasoning; record them when received.
4. Inspect the next two or three plausible features. Identify meaningful upcoming choices involving teacher behaviour, data architecture, privacy, durability, cost, or significant lock-in. Diagnose the actual need first. Do not manufacture a database issue or make Tyler choose routine libraries.
5. Prepare at most one new decision packet by default: why the choice is approaching, two or three viable options, project-specific consequences, the agent's recommendation, one focused question for Tyler, and one or two authoritative sources. Target 5–10 minutes of essential reading; offer optional depth.
6. Save the packet beside the feature, with assigned date and following-day follow-up date, before reporting it as assigned. If it already exists, reuse it and update changed facts.
7. On Tyler's answer, record the choice and reasoning next to the feature and revise the plan. If the answer leaves implementation approval unclear, ask only the consequential unresolved question. Merge/release approval stays separate.

## Afternoon learning and documentation

- Ask one or two due questions from the learning record before showing answers. Use the agreed spaced schedule and record actual responses/feedback.
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
