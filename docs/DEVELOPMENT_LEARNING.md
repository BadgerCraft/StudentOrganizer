# Development learning record

This file is the shared software-development learning record for Tyler and coding agents working on StudentOrganizer. Read it alongside `AGENTS.md`. Keep it current in the working branch and commit updates with the related work; merge/release approval remains separate.

## Learning agreement — 2026-09-30

- Explain useful development concepts when introducing them, using this application's behaviour as the example.
- Record both concepts introduced by an agent and software-development questions Tyler asks. Capture the explanation and follow-up questions rather than only a vocabulary list.
- Tyler will ask when an explanation is unclear. When clarification questions stop, treat that as his signal to proceed. Do not require a quiz answer to continue authorized implementation.
- Provide short learning checks during consequential explanations and after every completed agreed step or milestone. Ask about application, consequences, or a decision in Tyler's own words; usually one or two questions at a time. Tyler clarified on 2026-09-30 that unfamiliar terms and their meaning should be the main focus; avoid repeatedly checking an already-understood stop rule.
- At the end of a completed step, also ask what Tyler wants next. Offer concrete options and explain the recommended next step. Keep this direction question separate from learning checks and merge/release approval.
- If Tyler is away, save the explanation and unanswered questions for his return and continue independent work already authorized.
- This repository is public. Record project learning only: no student information, credentials, private personal reflections, or unrelated chat history.

## Spaced review

Use the following initial schedule; adapt it if Tyler changes his preference.

1. First review: one day after the concept is explained.
2. After each successful recall, schedule the next review in 3, 7, 14, then 30 days. Continue at 30 days unless a later response shows a gap.
3. If recall is partial or needs another explanation, explain with a project example and review the next day.
4. An unanswered or deferred prompt does not count as successful recall. Leave its stage unchanged.
5. At session start, read entries due on or before today. Ask one or two useful retrieval questions, prioritizing concepts relevant to current work and rotating overdue entries. Ask before revealing the answer, then give specific feedback.
6. Do not repeat a check already asked in the current conversation. Do not block authorized work while waiting.
7. Record actual answers after receiving them. The end of clarification questions authorizes proceeding; it is not evidence of a successful spaced-review answer.
8. A scheduled reminder can ask due questions. It must not invent responses or silently merge log changes. Record subsequent answers through the normal working-branch process.

Use dates in America/Toronto for this project's review calendar. Review intervals are working defaults, not a promise that a concept is permanently mastered.

## Scheduled review support

Tyler specified this routine on 2026-09-30, superseding the earlier 15:00 reminder and suggested 4–6-hour work check-ins:

- 08:15 America/Toronto: daily approval/research briefing; follow up yesterday's research and prepare an upcoming major decision when one is justified.
- 16:00 America/Toronto: due learning questions plus an optional deeper documentation session for active feature decisions.
- 20:15 America/Toronto: conditional check-in for an approved, unblocked task suitable for overnight work.

Schedule verification on 2026-09-30: "Morning development briefing", "Learning and documentation", and "Overnight work check-in" are enabled with exact daily schedules in America/Toronto. The old "Development learning review" at 15:00 is paused. Afternoon/evening checks begin today; the next morning briefing is 2026-10-01.

The learning review still uses the 1/3/7/14/30-day progression. Daily checking does not mean every concept is reviewed daily. Questions and actual answers are recorded here; consequential product/technical choices are recorded next to the feature in `docs/FEATURE_QUEUE.md`.

Scheduling and the detailed daily process are described in `docs/CODING_WORKFLOW.md`. Automatic dispatch of a Codex Cloud coding task has not been verified; a check-in can prepare an order without claiming it has launched.

## Entry format

For each entry, keep:
- Stable ID and concept; date and whether it arose from Tyler's question or an agent introduction.
- The question or context, a plain-language explanation, and a StudentOrganizer example.
- Clarification status and any outstanding question.
- Recall stage, last actual review response, next due date, and a practical retrieval question.

When a new question revisits an existing concept, append it to that entry. Create a new entry when the learning goal differs. Keep actual evidence separate from inference. Update changed explanations instead of preserving stale advice.

## Initial entries

### DEV-001 — Model, repository, and environment
- Date/source: 2026-09-30; Tyler asked what the environment means, why he was asked to create it, and when he would do it again.
- Explanation: The model reasons about the work. The GitHub repository stores the application's code and history. The development environment supplies a computer with the code and tools needed to edit, run, and check it.
- Project example: The verified StudentOrganizer environment ran Node, 152 tests, a build, and a browser session. That report establishes available tools and verification results, not Tyler's recall.
- Clarification status: Explanation provided; further questions welcome. No recall answer recorded.
- Recall stage: 0. Last review: none. Next due: 2026-10-01.
- Retrieval question: If I can explain a change but cannot run the app, which part of this setup needs attention, and why?

### DEV-002 — Reusing setup and publishing the app
- Date/source: 2026-09-30; Tyler asked when he would repeat the environment setup. The agent introduced the difference between publishing environment configuration and publishing the application.
- Explanation: A saved environment configuration can be reused for new development tasks. An existing task has its own working state. Publishing setup makes that configuration reusable; releasing the app makes an application version available to its users.
- Project example: The successful cloud verification required no new save or republish of the environment. It did not release a new version of StudentOrganizer.
- Clarification status: Explanation provided; further questions welcome. No recall answer recorded.
- Recall stage: 0. Last review: none. Next due: 2026-10-01.
- Retrieval question: When starting another feature task, what can you reuse, and what action would actually release a new application version?

### DEV-003 — Verification has a scope
- Date/source: 2026-09-30; agent introduction while interpreting the environment verification report.
- Explanation: Tests, a build, and a browser check provide different evidence. Tests check specified behaviours; a build checks that the application can be assembled; a browser flow checks the interactions exercised. Their results apply to what was actually checked.
- Project example: The supplied report covered fictional ENG4U classroom navigation, 14 seats, Markbook, and Assessments. Electron/Windows packaging was outside that check.
- Clarification status: No recall answer recorded.
- Recall stage: 0. Last review: none. Next due: 2026-10-01.
- Retrieval question: Why does a successful web build and browser check leave Windows packaging as a separate question?

### DEV-004 — Standing instructions and an approved task plan
- Date/source: 2026-09-30; Tyler requested more depth about the scope of agent-instruction changes, then asked for learning checks, a question record, spaced repetition, and next-step questions.
- Explanation: `AGENTS.md` sets reusable working rules for this repository. A task plan describes the particular outcome, milestones, and completion checks authorized for a piece of work. This learning record carries questions and review history between tasks.
- Project example: The rules tell agents to explain completed milestones and update this file. A future feature plan will tell them which StudentOrganizer behaviour to implement and how to verify it.
- Clarification status: The requested learning process has been recorded. No recall answer recorded.
- Recall stage: 0. Last review: none. Next due: 2026-10-01.
- Retrieval question: Where should a future agent find your learning history, and how does that differ from the plan for its current feature?

### DEV-005 — Implementation approval and merge/release approval
- Date/source: 2026-09-30; agent introduction during the discussion of standing working rules.
- Explanation: Approval of a plan authorizes its implementation, relevant checks, and bounded repairs. A branch holds those proposed changes. A pull request presents them for review. Merging incorporates them into the shared main branch; releasing publishes an application version. Tyler reserves approval for merging and releasing.
- Project example: PR #11 proposes working-rule and learning-record changes. Preparing and committing them does not authorize merging PR #11 or releasing the app.
- Clarification status: No recall answer recorded.
- Recall stage: 0. Last review: none. Next due: 2026-10-01.
- Retrieval question: If you approve a feature plan and leave for several hours, what should the agent complete, and which decisions remain yours?

### DEV-006 — Check-in cadence and actual execution
- Date/source: 2026-09-30; Tyler asked whether to check in hourly, after 6 or 12 hours, or daily, then explicitly chose morning, afternoon, and evening times.
- Explanation: Briefings organise review and decisions. Learning intervals determine when to revisit each concept. An actual execution mechanism runs approved coding work. A reminder itself does not establish that an overnight coding task has started.
- Project example: The daily 20:15 check-in must report a saved work order separately from a returned task link and observed running status.
- Clarification status: Tyler supplied his preferred schedule. This is direction, not a retrieval answer.
- Recall stage: 0. Last review: none. Next due: 2026-10-01.
- Retrieval question: If the evening check-in has prepared an approved work order but cannot start a coding task, what should it report?

### DEV-007 — Unresolved decisions and independent approved work
- Date/source: 2026-09-30; the agent asked what should happen overnight when a feature's major decision is unanswered.
- Explanation: The affected feature waits for the consequential choice; independent work already approved can continue. Follow up the blocked choice at the agreed review.
- Actual response: Tyler said, "I know that it will stop, wait for me to intervene in the morning and then complete any approved tasks."
- Feedback: Correct stop/continue meaning. This demonstrates the workflow rule, not terminology mastery or merge/release approval.
- Recall stage: 1. Last review: 2026-09-30, successful for this stop/continue concept. Next due: 2026-10-03.
- Retrieval question: When one feature awaits a major choice, which other work can continue?

### DEV-008 — A personal research package
- Date/source: 2026-09-30; Tyler asked whether the research package requires knowledge for his decision or technical facts the agent can figure out.
- Explanation: The agent researches technical facts and resolves routine implementation details. A personal research package teaches Tyler unfamiliar terms and concepts needed to judge a genuine consequential choice, explains the project-specific tradeoffs, and gives a recommendation.
- Project example: Signing eligibility, integration, and provider facts belong to the agent. A budget, public publisher-identity, or distribution-audience choice may require Tyler's judgment after an explanation.
- Clarification status: The earlier signing homework was withdrawn and reclassified as agent investigation. No recall answer recorded for this distinction.
- Recall stage: 0. Last review: none. Next due: 2026-10-01.
- Retrieval question: What would make a research package useful to your judgment rather than routine fact-finding assigned to you?

### DEV-009 — Subagent and coordination
- Date/source: 2026-09-30; Tyler asked why both investigations were not proceeding and whether subagents were available.
- Explanation: A subagent is an AI worker assigned a bounded part of the work. The coordinating agent combines its findings, tracks dependencies, and prevents conflicting edits.
- Project example: One agent investigated Windows signing/distribution while another checked overnight launch options. Root owned the shared planning files.
- Clarification status: Explained and used. No retrieval answer recorded.
- Recall stage: 0. Last review: none. Next due: 2026-10-01.
- Retrieval question: What is a subagent's role, and why does using one not by itself prove overnight execution?

### DEV-010 — Checkout and CI
- Date/source: 2026-09-30; the execution probe had GitHub access and commands but no source checkout, prompting a question about possible fixes.
- Explanation: A checkout is a working copy of the repository on the computer doing the work. CI means automated checks that run when proposed code changes are submitted; GitHub Actions supplies that separate test computer in this project.
- Project example: This probe could read/write files through the GitHub app but had no local checkout for npm test. The existing Windows workflow checks out source, installs dependencies, runs tests, and packages the app on GitHub's runner.
- Clarification status: Explanation provided in the execution-options discussion. No retrieval answer recorded.
- Recall stage: 0. Last review: none. Next due: 2026-10-01.
- Retrieval question: How does a checkout differ from reading a GitHub file, and where would CI run the checks?

### DEV-011 — Platform support and device synchronization
- Date/source: 2026-09-30; Tyler prioritized Mac/iPad support and the agent introduced the distinction while drafting the roadmap.
- Explanation: A desktop package runs on a chosen computer platform. A Home Screen web app uses browser technology behind an app icon. Device synchronization transfers and reconciles records between devices; installing the app on two devices does not synchronize their data.
- Project example: Current StudentOrganizer has local IndexedDB records and Windows packaging. F-006 proposes Mac packaging and an iPad delivery path; current sync infrastructure is a mock and does not keep class records synchronized.
- Clarification status: Explanation prepared in PRODUCT_ROADMAP.md; no recall answer recorded and no platform/sync option selected.
- Recall stage: 0. Last review: none. Next due: 2026-10-01; if this explanation has not actually been read/presented, introduce it before asking retrieval.
- Retrieval question: If StudentOrganizer opens on both a Mac and an iPad, what extra capability would keep the same class records up to date on both?

### DEV-012 — Local bug draft and central receipt
- Date/source: 2026-09-30; Tyler prioritized easy reports into a central file; terminology introduced in the draft plan.
- Explanation: A locally saved draft remains on the reporter's device. Central receipt means a shared collection point actually accepted the report. A build identifier identifies the exact app version to reproduce a problem.
- Project example: F-007 must retain an offline report without claiming it has reached the proposed BUG_REPORTS ledger. A successful submission has a durable ID and a central record.
- Clarification status: Explanation prepared in PRODUCT_ROADMAP.md; no answer recorded. This reporting feature is not yet implemented or approved.
- Recall stage: 0. Last review: none. Next due: 2026-10-01; introduce the explanation before retrieval if not yet presented/read.
- Retrieval question: What is the difference between a bug report saved on an offline iPad and one received in the central file?

## Review history

2026-09-30 — DEV-007: Tyler's actual answer correctly described waiting on the blocked feature and completing approved work. Successful for that concept; next review 2026-10-03. Terminology questions remain separate.

Append dated records with concept ID, the actual response (or a faithful short summary), feedback, outcome, and updated next due date. Never mark understanding or successful recall from silence.

## Current step and direction

- Current step: establish standing working rules and the learning process in PR #11.
- Completed earlier: the reusable cloud environment passed the supplied web-development verification.
- Current queue and research: see `docs/FEATURE_QUEUE.md`. The earlier F-002 / DEC-001 homework assignment was withdrawn; technical signing research belongs to the agent. F-005 tracks the overnight execution setup and actual probe.
- Next application plan: select a feature and define its outcome, milestones, and completion checks. Proposed features are not automatically approved.
- 2026-09-30 direction recorded: Tyler specified the three daily times and next-day decision follow-ups. A successful stop/continue response is now recorded under DEV-007; no other recall success is inferred.

### DEV-013 — Reusable lessons and applicability
- Date/source: 2026-10-01, agent introduction during approved WF-001.
- Explanation: A component is a part of a program, such as storage or imports. A verified lesson records a checked fix and its context. Applicability means checking whether that context fits the new task. A transaction groups related writes so an interrupted operation can roll back; duplicate-safe retry is a separate concern.
- Project example: future StudentOrganizer import work can consult shared lessons, but the SQLite pilot does not verify its IndexedDB/Dexie storage. An agent must compare the technologies before applying the fix.
- Actual response, October 1: Tyler asked, “Does applicability mean that it uses past data for current projects?”
- Feedback: partial recall; correctly identifies reuse of past knowledge. Applicability specifically checks whether the lesson's technology, assumptions and circumstances fit the current project. Explained with SQLite versus StudentOrganizer storage. No complete recall inferred; WF-001 approval remains separate.
- Recall stage: 0; next due: 2026-10-02, America/Toronto.
- Retrieval question: What does applicability mean when a future agent reuses a database lesson?
- Next direction available: review the ready workflow/QA PRs, then clarify the already-prioritized Mac/iPad plan; no additional feature implementation approval inferred.

2026-10-01 — DEV-013: partial recall of reuse; explained context-fit distinction. Stage remains 0; next review 2026-10-02 America/Toronto. Follow-up example question offered; awaiting actual answer.
