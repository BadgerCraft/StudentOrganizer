# Working rules for Ontario Teacher Assessment

## Actual execution path — October 5, 2026

The workflow is partially automated. Scheduled briefings and bounded GitHub connector edits/checks/reporting have observed evidence. Automatic dispatch from this conversation or a scheduled briefing into the published Codex Cloud environment has not been verified.

For application work requiring a source workspace, the working path is: record the approved plan and work order → Tyler starts a new task using Work in > Cloud and the published StudentOrganizer environment → the coding task verifies the source, implements and tests available milestones, then persists its branch/results → review and explicitly approve merge/release separately. Do not ask for implementation approval again during this handoff.

This manual launch is currently required when the active chat lacks a usable checkout or execution capability. A saved work order, scheduled wake-up, approval, or subagent does not start or sustain a Cloud coding task. Use prepared/launch-pending until actual execution is observed; use running only with current execution evidence. No unattended feature-completion promise is established by these instructions.

Observed October 5: Tyler manually launched the approved F-006 work in Cloud. It pushed codex/f006-installed-ipad-pilot at a77fe406105f4153f9cb70f5c8af458fb0bee1aa; its work record reports 191 tests/build and browser checks passed. Root independently verified the pushed source and opened draft PR #15 through the GitHub connector after Cloud PR creation failed. Native compilation, simulator/device acceptance and platform regressions for that new revision remain unverified. This proves the manual handoff, not automatic Cloud dispatch.

Automatic launch remains an explicit incomplete workflow improvement. Continue available approved work; report the precise missing capability and provide a concrete handoff when needed. Never imply that merging this documentation supplies that capability.


## Superseding privacy and platform decision — October 1, 13:59 America/Toronto

Tyler explicitly confirmed that the iPad version must be an installed app that keeps all student data and processing on the device and needs no website to operate. His stated reason: “Student privacy is the most important condition that we need to abide by. Creating a hypothetical version doesn't make sense when we will have to change to it a closed loop at some point.”

This supersedes the earlier Safari/Home Screen delivery choice and the GitHub Pages fictional-data hosting proposal. Do not publish that site, provision hosting, or treat the PWA as the intended iPad product. Target an installed iPad app with bundled operational assets, local processing/storage, offline classroom operation, and deliberate user-controlled backup/transfer. Do not add automatic student-data uploads, telemetry, cloud sync, or remote AI processing. Development browser checks remain useful evidence for shared UI only.

F-006 next work: inspect a viable installed iPad packaging/storage/file-access path and produce a revised concrete plan, including signing/distribution/access requirements and physical-device checks. Do not infer approval for paid accounts, credentials, services, merges or releases. Existing Windows/Mac packages and reusable touch/report-draft work remain available for review; passing packaging/browser tests do not establish closed-loop operation. Audit actual external connections before making that claim.

F-007 central reporting requires its own explicit, optional boundary: no automatic record/page/screenshot attachments or background sending. Existing private-service proposals remain unadopted; reassess them against this requirement before asking for service approval.


This repository is the working source for the Ontario Teacher Assessment app. Read `README.md` for setup. Use the current code and test results to establish implementation status; a walkthrough or older project note records claims and decisions, but may be stale.

## Product and people

- Build for a teacher using the app during an actual class: calm, legible screens and few clicks for frequent actions.
- Tyler sets the goal, classroom behaviour, constraints, priorities, and quality bar. The coding agent may choose implementation details, investigate dependencies, and make bounded fixes without asking Tyler to direct code he has not learned yet.
- Explain consequential choices and results in plain language. Define technical terms when they first matter, and show how a choice affects the teacher's workflow. Invite Tyler's judgment on behaviour and tradeoffs rather than presenting a wall of code.
- Keep a product request separate from an audit finding or a possible future feature. Do not silently expand the task to clear an entire technical backlog.
- If a related defect must be fixed for the agreed outcome, fix it within that scope and explain it. Record independent defects for a later decision.

- Direct communication preference (Tyler, clarified 2026-09-30): preserve useful explanations, evidence, caveats, and links; reorder them so the actual next-step question or actionable request, when needed, is the final sentence with nothing after it. This is an information-order preference, not a requirement to invent a question, repeat approval requests, or pause independent approved work. Do not append an open-ended offer after the specific query. Respect non-interactive runs: when questions are disallowed, finish with the concrete next action. Progress updates follow the host's commentary rules.

## Data and safety boundaries

- Use fictional students in development, automated tests, demonstrations, and colleague QA. Do not add real student names, numbers, photos, marks, notes, exports, backups, or credentials to Git or AI prompts. Real-student use needs a separate privacy and board/IT approval decision.
- The current app is local-first. Do not add a live sync sender, analytics, cloud backup, or AI processing of student data without an explicit product decision and privacy review.
- Preserve existing records through migrations and restore paths. Do not silently delete seeded records from an existing database; review the actual data and a recoverable backup before a targeted cleanup.
- Keep actor attribution explicit for writes. The local teacher selector identifies the actor but is not authentication for a shared device or service.

## Behaviour to preserve

- Ontario grading uses independent K, T, C, A evidence. Aggregate evidence within each category, then apply the class category weights. A direct percentage remains direct; the versioned level conversion is a teacher preset.
- Participation tallies and observational Levels 1–4 do not automatically alter formal grades. History and audit records survive undo and later button edits.
- Dates for class sessions use the Toronto school calendar day. Historical browsing does not create records merely by viewing another date.
- Roster import previews and validates before an atomic commit. Restore validates the whole backup before replacing live data. Failed writes must leave the existing data intact.
- Preserve the existing class, seating, attendance, profile, assessment, markbook, export, and recovery paths while changing adjacent code.

## Change and review loop

1. Start from current `main`; check for uncommitted changes and identify the exact behaviour to change. Use a focused branch for a meaningful change.
2. Reuse an approved feature plan. Approval authorizes implementation, verification, and routine repairs within that scope without repeated permission questions. Continue through all approved milestones until their completion checks pass or a genuine blocker requires Tyler's judgment; do not stop after the first partial success. Interrupt for materially different product behaviours, a consequential scope change, unavailable access, or a merge/release decision Tyler reserved. Inspect the affected code and callers. Make the smallest coherent change, with tests that exercise a real risk rather than duplicate the implementation.
3. Run the checks relevant to the change. The usual baseline is `npm test` and `npm run build`. Use a real browser flow for UI behaviour, a backup round trip for recovery work, and packaged-app checks when Electron packaging or storage changes. Say when a check could not run.
4. After each completed agreed step or milestone, explain the changed teacher experience, verification evidence, remaining risk, and useful concepts. Include a short learning check and a concrete question about Tyler's next priority, following the learning loop below. Defer unanswered checks if Tyler is away and continue independent authorized work. Never claim background execution this environment cannot provide. Present the important decisions in language Tyler can judge. Show the branch and changes before merge. Tyler reviews meaningful changes one by one; do not treat a passing test as product approval.
5. Merge and publish releases only after explicit approval for those actions. A passing build or an understanding check is not approval. Keep rollback straightforward and update the project reference when a verified change makes it stale.

## Learning and next-direction loop

- At the start of a task or resumed session, read `docs/DEVELOPMENT_LEARNING.md` alongside these rules. Use its question history and due reviews to tailor explanations. Record project learning there so future agents can continue it.
- Explain software-development concepts as they become relevant, using a StudentOrganizer example and defining unfamiliar terms. During consequential explanations and after each completed agreed step or milestone, ask one or two short learning questions focused on unfamiliar terms: their meaning, their relationship to other terms, and a simple StudentOrganizer example. Consequence or tradeoff questions can support that understanding; do not repeatedly quiz stop/approval rules Tyler has already demonstrated. More completed steps mean more checks; do not save all learning for the final merge review.
- Tyler asks clarification questions when he does not understand. When those questions stop, take that as his signal to proceed. Learning checks support learning, not permission to execute an approved plan. Do not fabricate successful recall from silence or require a teach-back before continuing authorized work.
- Record concepts the agent introduces and questions Tyler asks, with the explanation, follow-up questions, actual review responses, feedback, and next review date. Separate an explanation provided, a signal to proceed, and demonstrated recall. Commit log changes with the related work in the working branch; do not silently merge them.
- Use the spaced-review schedule in the learning record: initially one day after explanation, then 3, 7, 14, and 30 days after successful recall. Re-explain gaps and review the next day; leave unanswered reviews unpassed. Ask due questions before revealing answers and give feedback after Tyler responds. Keep reviews brief and avoid repeating prompts in the current conversation.
- When Tyler is away, save learning checks and direction questions for his return and continue all independent authorized milestones. Only claim scheduled reminders or background work when a tool has actually established them.
- After a completed step, ask what Tyler wants next, offering concrete options and a recommendation. Treat the answer as direction for the next plan, not implicit merge/release approval or permission to expand the existing scope. If already-approved milestones remain, finish them without waiting for a new direction answer.

## Scheduled briefing and feature decisions

- Use `docs/CODING_WORKFLOW.md` for the daily routine, `docs/FEATURE_QUEUE.md` for execution/approval state, and `docs/PRODUCT_ROADMAP.md` for Tyler's ordered implementation-plan reviews, decision lookahead, and current-feature cross-reference. Tyler's product order is Mac/iPad support, central bug reporting, then integration with the earlier marking app (2026-09-30). These requests authorize planning; wait for explicit approval of each feature plan before implementation. Check the inventory before treating an existing feature as new work.
- All check-ins use America/Toronto: 08:15 approval/research briefing, 16:00 learning and optional documentation, and 20:15 conditional overnight-work check-in. Morning briefings are daily; afternoon/evening prompts require useful material. These times supersede routine hourly check-ins.
- Morning: report actual approval items with evidence and exact consequences, follow up due consequential choices, and inspect upcoming features. Perform technical fact-finding yourself. A research package for Tyler is a short learning brief supplying the terms, concepts, project examples, and tradeoffs needed for his genuine judgment; do not outsource provider/library/integration research. Prepare at most one new brief by default only when needed, explain why the choice belongs to Tyler, and set a following-day follow-up after presenting it.
- Record Tyler's actual choice and reasoning beside the feature when he responds. Do not invent a database problem from an example, treat silence as choosing an option, or ask Tyler to decide routine implementation details.
- At 16:00, offer optional deeper documentation for active decisions alongside short due learning checks. Declining reading does not approve or reject a feature.
- At 20:15, select only an approved, unblocked, worthwhile task. Prepare a complete work order and start it only through execution capability actually available. Record the returned task/run link and observed status. If launch is unavailable, save the order and report the exact blocker; a scheduled check-in alone is not an overnight coding task.
- Planning/learning record commits are authorized administrative work; use the active planning or feature branch and keep merge/release approval separate. Scheduled briefings inspect main and open planning revisions, preserve newer answers, and avoid duplicate launches and repeated unchanged evening-blocker notifications.

## Parallel agents

- Tyler explicitly requested subagents on 2026-09-30. Use bounded parallel agents for independent approved investigations or implementation so work does not become an artificial either/or choice. The coordinating agent integrates findings and owns shared planning records.
- Assign separate file ownership or focused branches for implementation, preserve approval evidence and scope, and avoid conflicting writers. A subagent's existence does not prove unattended scheduling or a usable overnight coding workspace.

## Known follow-ups, not blanket gates

- The V6.6 browser fixture has a UTC/Toronto date mismatch and a mark-scale version ID mismatch; fix them in a focused test follow-up.
- Existing V6.5 databases may still hold Chen/MCV4U test seeds. Decide whether any particular installation needs a backed-up cleanup.
- Remaining direct UI writes and the Assessment Hub/Markbook UX need prioritization by concrete workflow risk. They are not automatically blockers to fictional-data QA.

## Shared component lessons

For component planning, implementation and meaningful fixes, use the installed `reuse-component-lessons` skill. Locate it by name in the skill catalog/personal collection, read its component index and relevant lessons, and record IDs/version/applicability plus concrete design or verification effects in the work order. Record evidence-backed fixes and attributed comments through its update procedure. This shared collection lives outside StudentOrganizer; do not duplicate authoritative documents here. If unavailable, disclose the access gap and use only a clearly dated snapshot when provided. Lessons do not authorize extra product scope. WF-001 bounded pilot approved by Tyler October 1; see docs/work-orders/WF-001-2026-10-01.md for evidence. Merge/release remain separate.
