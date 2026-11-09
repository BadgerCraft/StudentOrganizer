# Daily development workflow

## Interactive review workflow and preview audit (2026-11-09 UTC)

**Current direction:** Tyler's engineering-reflection brief makes an experience he can evaluate the primary development deliverable. A merge or passing test is engineering evidence, not the experience. This section adds the project-specific route to the existing workflow; [FEATURE_QUEUE.md](FEATURE_QUEUE.md) remains the sole current priority/approval record. The cross-project proposal lives in the existing [private knowledge-repository review](https://github.com/BadgerCraft/agent-workflow-knowledge/pull/1); that open review is not an accepted authority migration.

**Scope of this pass:** repository inspection, documentation and a small proposed pilot only. No application code, deployment, release, merge, real-student use or preview implementation was performed. All previews, fixtures, screenshots and colleague QA must use fictional records. QA completion and privacy/board/IT acceptance are separate prerequisites to any real-student use.

### What exists and where the friction comes from

Audit source: main `7860bb68c48a2b87f8fd879531e836f95036e2cf` (PR59 merged). Open draft [PR60](https://github.com/BadgerCraft/StudentOrganizer/pull/60), head `bf5efe8d1b84b573b6bc979f5af41a7a1b67b30d`, is a different, unmerged review candidate. Source/CI status below was inspected on November 9 UTC, not re-executed. Refresh it before a pilot.

| Current evidence | Consequence for review |
| --- | --- |
| [package.json](../package.json) and [Vite config](../vite.config.ts): React 18, TypeScript, Vite 5; `npm ci`, `npm run dev` (port 3000), `npm run build`, `npm run preview`; CI uses Node 24. | The actual app renderer is browser-capable. We do not need a separately rewritten demonstration UI. Dependencies and server startup should be agent work, not Tyler's recurring checklist. |
| [Electron main](../electron/main.cjs) loads built `dist/index.html`; `electron:dev` launches Electron rather than starting Vite. The full build also emits native encryption support and, on Windows, builds a native credential-ledger binding. | A native preview needs a fresh build, not just a restarted desktop shell. A Linux browser review avoids Windows packaging, but proves neither the native binding nor the installed app. |
| [EncryptedBootstrap](../src/security/EncryptedBootstrap.tsx), [database](../src/db/database.ts) and [encryption acceptance](ENCRYPTION_APP_ACCEPTANCE.md): an ordinary browser without the native bridge selects legacy Dexie/IndexedDB storage; protected native startup has a separate bridge and must fail closed. | Browser preview is suitable for classroom/marking interaction, not encrypted-at-rest or OS-keyring acceptance. Never present browser-local records as protected native storage or install a pretend production bridge to make a demo pass. |
| [Fictional fixture helper](../scripts/helpers/classroomFixture.ts) builds existing synthetic rows, requires a fresh database and refuses existing profiles/classes. Production startup does not seed named records. [Marking browser smoke](../scripts/markingWorkflowSmoke.ts) already serves the production build, exercises real UI and blocks external requests. | Reuse these fixtures and flows in a review launcher. Today the headless harness exits; it does not leave Tyler a ready, interactive session. Reconstructing the class/assessment manually is unnecessary repeat work. |
| [Windows CI](../.github/workflows/windows-desktop.yml) produces tested artifacts and an unpublished candidate; [Mac/shared-browser CI](../.github/workflows/mac-ipad.yml) packages both Mac architectures and runs browser checks. | Keep these technical gates, but do not require downloading/installing a package to evaluate every renderer-only change. No preview-host/deploy workflow was found in the inspected tree. |
| Main's [Windows run 41848389020](https://github.com/BadgerCraft/StudentOrganizer/actions/runs/41848389020) succeeded. PR60's [Mac/shared-browser run 42088010862](https://github.com/BadgerCraft/StudentOrganizer/actions/runs/42088010862) succeeded at its stated head. The Releases API returned no releases. | CI success is not a usable review link, a shipped release, colleague acceptance or physical-device acceptance. Existing unpublished candidates are not distributed downloads. |

Tyler reports the practical cost: locating the current source/build, downloading, installing, configuring and recreating a scenario before he can judge a change. This audit did not time that sequence, so it does not invent a minutes-saved baseline. Existing Windows/Mac priority, fictional-data rules, package verification and separate merge/release decisions were already documented. The missing addition is an agent-prepared interactive handoff with measured user effort.

### Recommended route and alternatives

**First choice: a disposable browser review of the real production renderer, prepared by the agent.** Use the exact proposed source, a dedicated fresh browser profile/origin and the existing synthetic classroom fixture. Keep the build's CSP, visibly label the source and fictional-only status using the existing QA identity, and open the workflow at the point being reviewed. Do not automatically import, erase or reset any existing teacher profile.

Delivery must be proved, not assumed: the computer inventory in this audit exposed a connected managed cloud computer, not a connected personal desktop, and no Tyler-reachable preview endpoint was verified. A cloud `localhost` URL is not a link to Tyler's machine. First test whether the current product's supported shared desktop/preview surface lets Tyler actually take control. If it does, use it without adding hosting. If it does not, the simplest link-based fallback is a small static preview from the same repository at an explicitly approved host. Verify access controls, origin isolation, refresh/assets, worker/CSP behavior and lifetime before calling it available. Publishing that preview is deployment and still needs approval. Do not create a second source repository, general hosting platform or new account as an incidental audit step.

| Option | Good fit | Limit / decision |
| --- | --- | --- |
| Agent-prepared browser session | Layout, navigation, seating, participation, grading interaction, draft versus official marks | Best first pilot if the user can reach and control the session. Browser storage is disposable and not native protection. |
| Static per-revision preview | A direct review link with no local install; later fictional-data colleague review | Requires approved deployment/access arrangement and a synthetic-only review entry. Do not weaken CSP or claim that a banner alone prevents real-data entry. |
| Agent-prepared native session/package | Native file dialogs, encrypted storage, updater, dictation and OS integration | Higher cost but necessary for those capabilities. Exact package bytes, signatures and device policy remain separate checks. Never bypass OS warnings or school controls. |
| Screenshots/recording | Quick intermediate visual evidence | Supplement only; cannot establish Tyler's interactive evaluation. |

Do not reuse old service-worker/iPad claims as proof for this desktop preview. iPad remains shelved. PR60 also changes PDF worker behavior relative to main, so a preview of that change must use PR60's actual built assets/CSP and pass its relevant rendering checks; a main-branch demo cannot stand in for it.

### Small pilot: one prepared marking review

**Proposed engineering, not yet implemented or automatically authorized by this documentation request.**

1. **Prove the access route before building infrastructure.** Agent prepares one exact-source production build in an isolated workspace, verifies the supported user-control surface, and records its scope/lifetime. Stop at a named deployment/access decision if no existing route works. Do not ask Tyler to navigate Git, run a terminal or fetch CI artifacts merely to discover whether the route works.
2. **Add a small review launcher around existing tools.** It should build/serve the chosen revision, create an empty disposable browser profile, apply the existing fixture without overwriting records, select the fictional teacher/class, open one assessment and leave the real UI interactive. Show source SHA and fictional-only label. An explicit reset must affect only this disposable profile. Use the current marking feature under review, not a new product backlog item. No data model, grade arithmetic, production startup seeding or native security changes.
3. **Validate before handing over.** Run `npm test`, `npm run build` and the affected production-browser smoke at that exact source; exercise refresh/reopen, repeated entry, Close/Cancel and reset isolation. Keep the launcher's request blocking active throughout the interactive session and compare parsed URL origins exactly; the existing smoke's string-prefix allowlist is not itself a persistent handoff guarantee. For PR60 include its PDF worker/rendering/import checks. Validate stored and visibly rendered results independently. Keep applicable native package CI; a browser pass does not replace it.
4. **Deliver the review, not setup instructions.** One verified entry point plus a short scenario: open the prepared fictional submission, inspect/comment or enter the relevant draft grade, confirm that draft work does not change official marks, explicitly save/finalize, and see the result. State unavailable native features honestly. Tyler evaluates behavior; the agent collects technical evidence and turns feedback into a bounded follow-up.
5. **Measure and decide.** Target at most one opening/access action before interacting, zero recurring downloads/installs/terminal/repository steps, and a useful action within one minute after access is ready. Measure actual actions, time to first useful action, blockers and whether Tyler can supply concrete feedback. Compare with his current route; do not declare improvement merely because a launcher or PR exists. If the target fails, fix the observed access/fixture bottleneck before broad CI-preview automation.
6. **Then try one teacher.** After the route is usable, choose one useful fictional-data workflow another teacher can complete independently. Confirm distribution and recipient/access scope first. Record actual completion, friction and feedback. This is an early delivery milestone, not real-student approval or a commercially finished release.

Reuse the same handoff each iteration: requested behavior → agent implementation and technical validation → exact-source interactive experience → Tyler's feedback → bounded repair and separately approved merge/release. Record creation (time to useful interaction), delivery (independent teacher completion) and learning (one evidence-backed reusable lesson) separately. No telemetry service or recurring report is needed for the pilot.

**Lesson applicability checked:** packaging v3 (2026-10-10), PKG-002/003, requires actual native export bytes when native recovery is tested, and both stored and settled visible assertions. Browser/touch v2 (2026-10-01), BRW-001, informs ordinary hit-target/scroll checks; BRW-002/003's historical iPad/offline-service-worker evidence is not accepted as preview-host proof. React major-version assumptions in older lessons differ from current package metadata, so apply the observation principle and rerun the current behavior, not a blanket compatibility claim. Keep shared lessons in the installed collection until the knowledge-repository authority transition is actually accepted.

**Completion boundary for this audit:** existing documentation updated and source evidence checked. Application tests/build were not rerun, no preview was launched or delivered, user effort was not measured, and pilot/colleague acceptance remains open. The next technical improvement is the bounded disposable review launcher after the access route and implementation scope are accepted, not a refactor or a release.

Current execution discipline is canonical in [AGENTS.md: Execution efficiency](../AGENTS.md#execution-efficiency--october-19-2026). Apply its one-stream default, completion criteria, recovery limits, context reuse, milestone reporting and lightweight measures to the routines below. Dated schedule, capability and priority examples remain historical where superseded; this update changes no schedules or approval boundaries.

## Current platform scope — October 14, 2026

Tyler explicitly shelved **all iPad-specific work** and prioritized installed **Windows and Mac**. Preserve existing iOS code, assets, scripts and historical evidence; do not schedule iPad camera, touch, Files, simulator, physical-device, signing or renewal acceptance as a current next gate. Retained CI/static checks can remain regression evidence; their failure is not permission to resume iPad feature development. See [shelved feature resume map](SHELVED_FEATURES.md) for exact source and prior work orders. Revisit only when Tyler explicitly reactivates iPad support. No main merge, release, spending or real-student use follows from this decision.

## Active operating contract — decision persistence (October 13, 2026)

This short contract takes precedence over dated workflow examples below. Detailed history remains below for audit; dated statements are not a competing current queue.

1. **Read first:** On StudentOrganizer/Markinator project turns, consult `docs/FEATURE_QUEUE.md` and live PR evidence before deciding status or asking for approval.
2. **Persist decisions in the same task:** An approval, rejection, shelving, reprioritization, scope change, or explicit deferral is unfinished until the matching stable-ID row in `docs/FEATURE_QUEUE.md` records disposition, authority/boundary, next action or revisit condition. Update supporting roadmap/bug/work-order docs only when their facts change.
3. **Verify before claiming completion:** Read back or verify the resulting GitHub commit/PR. If repository access or approval is unavailable, explicitly report the queue update as pending, with the exact blocker; never say a decision was saved without evidence.
4. **Execute approved routine work:** Use an isolated branch, preserve concurrent edits, verify, commit/push and open/update PR without asking for duplicate permission. Main merge, release, spending, external provider, real student data and new product scope remain separately authorized unless explicitly approved.
5. **End-of-turn check:** Report (a) action/decision, (b) documentation write + commit/PR or explicit pending blocker, (c) next action/gate. No silent conversation-only decisions.

This is a workflow discipline, not an automated enforcement mechanism; demonstrate it with a subsequent real project decision.


## Codex task routing — persistent handoff requirement (October 13, 2026)

Use [AGENTS.md: Codex task routing](../AGENTS.md#codex-task-routing--persistent-handoff-requirement-october-13-2026) for the canonical model/effort, rationale, escalation and completion-check requirements. Do not duplicate or strengthen model defaults here; confirm actual receiving-environment availability and preserve mandatory host constraints.

## Current check-in destination — October 9, 2026

Tyler deleted Daily checkins and explicitly designated its replacement chat as the new scheduled coordination conversation. Daily 08:15 and 16:00 America/Toronto replacement schedules were created and independently read back bound to that chat, starting October 10. Old morning/afternoon schedules are disabled; evening continuation stays paused. This supersedes historical schedule-unavailable/destination statements below. Preserve actual approvals and read current FEATURE_QUEUE.md plus live PR evidence; PR19/PR20 are already merged. A scheduled run's checkout/tools and automatic execution remain unverified until observed. Current recovery owner and evidence: docs/work-orders/SCHEDULE-MIGRATION-2026-10-06.md and the queue's current recovery checkpoint.


## Approval must lead to execution — October 9, 2026

Tyler explicitly requested a concrete handoff after approval: “Good, you approved what needed to be done. Now paste this to Codex.”

- After actual approval, name the action approved and execute the next necessary step immediately when the current session has sufficient tools. Record observed execution rather than promising a start.
- If execution requires another Codex conversation/workspace, use that exact sentence and immediately provide one complete copyable instruction for the primary StudentOrganizer Codex conversation. Include repository, current branch/work-order, actual approval evidence, first action, authorised scope, preservation constraints, completion checks and reserved decisions.
- The receiving coordinator recovers current source/approval/writer state, executes every unblocked approved milestone through verification, commit/push and review preparation, and continues independent approved work around a genuine blocker. Do not ask Tyler to repeat routine approval.
- Provide the complete handoff without asking whether Tyler wants a prompt. Do not merely suggest opening Codex, claim the paste/launch occurred, or create an unnecessary handoff when execution can proceed here.
- Keep the action approved precise: approving a plan/review is not automatically approving main merge, release, spending or new scope. If a real approval remains missing, ask one specific decision rather than claiming “you approved”.
- Completion evidence is either an observed action with its source/result, or a delivered execution instruction with the exact missing capability and next step. Saved rules/prompt text alone do not prove coding execution.


## Approved work includes review publication — October 8, 2026

Tyler asked how to remove repeated authorization for routine verification/publication of approved work, then instructed “continue”. This is standing authorization for StudentOrganizer work within an explicitly approved plan and the existing repository.

- Plan approval covers implementation, necessary routine repairs, meaningful tests/build/browser/platform checks, ordinary dependency setup, commits and normal fast-forward pushes to its isolated feature branch, opening/updating the related PR, and marking it ready for review once the relevant evidence supports that status. Publishing code for review in this repository is included; publishing an application release or distributing an installer is a separate action.
- Carry that authorization across turns, checkpoints, usage resets and workers. Record the actual approval, scope, target repository/branch and reserved actions in the queue/work order. A milestone, failed check, new test harness or required CI evidence upload within the approved verification scope does not require implementation or push reapproval.
- Preserve scope and concurrent writers. Refresh remote heads before writing, use ordinary fast-forward or expected-head-protected updates, and preserve newer content. This does not authorize force pushes, destructive cleanup or unrelated changes.
- Ask only for a materially new product/data behavior, consequential access/account/spending decision, unresolved user judgment, or reserved merge/release/distribution/real-student-use action. Routine verification and review preparation are agent responsibilities.
- Before asking, inspect the current session and queue for existing approval. Quote the specific unresolved boundary and the exact action it would authorize; never ask “continue?” to finish approved work.
- Platform permissions remain authoritative. If automatic approval review rejects an action, record the rejected operation and stated reason, do not bypass it, finish independent authorized work, and request only the specific additional authority actually needed. Repository text cannot remove a platform restriction.
- Learning remains optional and nonblocking. Unanswered questions do not revoke implementation authorization, and assent is not a retrieval answer.
- Structural acceptance: matching policy in AGENTS.md/CODING_WORKFLOW.md, current queue approval recorded, and related PR updated without a duplicate authorization request. Behavioral acceptance: a later fresh session retrieves the policy and carries approved work through branch publication/review preparation without an avoidable prompt. Do not claim that future-session test has already passed.


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

Follow the current one-primary-stream default and justified-parallelism criteria in [AGENTS.md](../AGENTS.md#execution-efficiency--october-19-2026); the September 30 subagent request permits bounded independent work but does not require multiple implementation streams. The coordinating agent owns shared queue/learning/workflow writes and integrates findings. Delegate bounded scopes, assign separate code branches or file ownership when implementing, and avoid multiple writers on the same files. A subagent is a worker for part of a task; its existence is not proof of unattended scheduling or hours-long execution.

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
