# Development learning record

This file is the shared software-development learning record for Tyler and coding agents working on StudentOrganizer. Read it alongside `AGENTS.md`. Keep it current in the working branch and commit updates with the related work; merge/release approval remains separate.

## Learning agreement — 2026-09-30

- Explain useful development concepts when introducing them, using this application's behaviour as the example.
- Record both concepts introduced by an agent and software-development questions Tyler asks. Capture the explanation and follow-up questions rather than only a vocabulary list.
- Tyler will ask when an explanation is unclear. When clarification questions stop, treat that as his signal to proceed. Do not require a quiz answer to continue authorized implementation.
- Provide short learning checks during consequential explanations and after every completed agreed step or milestone. Ask about application, consequences, or a decision in Tyler's own words; usually one or two questions at a time.
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

A ChatGPT automation titled "Development learning review" was enabled on 2026-09-30. It checks daily at 15:00 America/Toronto, starting 2026-10-01, and asks at most two questions only when entries are due. This time is an agent-selected default and can be changed.

It reads this record from `main`, or from PR #11's head while that initial proposal remains open and the record is absent on main. It does not merge changes or invent review answers. In-session learning checks continue independently of the reminder.

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

## Review history

No retrieval answers have been recorded yet. Append dated records with concept ID, the actual response (or a faithful short summary), feedback, outcome, and updated next due date. Never mark understanding or successful recall from silence.

## Current step and direction

- Current step: establish standing working rules and the learning process in PR #11.
- Completed earlier: the reusable cloud environment passed the supplied web-development verification.
- Next proposed setup step: save reusable task plans with milestones, completion checks, and progress.
- Awaiting Tyler's direction: which application goal should the first saved plan cover?
