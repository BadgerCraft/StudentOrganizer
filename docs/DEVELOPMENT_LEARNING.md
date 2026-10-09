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
- Clarification status: Explanation prepared in PRODUCT_ROADMAP.md; no recall answer recorded and October1 morning approval initially selected Mac Electron/iPad Home Screen and manual full-backup transfer. Superseding 13:59 privacy decision requires installed iPad delivery with bundled assets, local processing/storage and no operational website; Home Screen/PWA is no longer the intended product. Live sync remains deferred. This product choice is not a recall answer.
- Recall stage: 0. Last review: none. Next due: 2026-10-01; if this explanation has not actually been read/presented, introduce it before asking retrieval.
- Retrieval question: If StudentOrganizer opens on both a Mac and an iPad, what extra capability would keep the same class records up to date on both?

### DEV-012 — Local bug draft and central receipt
- Date/source: 2026-09-30; Tyler prioritized easy reports into a central file; terminology introduced in the draft plan.
- Explanation: A locally saved draft remains on the reporter's device. Central receipt means a shared collection point actually accepted the report. A build identifier identifies the exact app version to reproduce a problem.
- Project example: F-007 must retain an offline report without claiming it has reached the proposed BUG_REPORTS ledger. A successful submission has a durable ID and a central record.
- Clarification status: Explanation prepared in PRODUCT_ROADMAP.md; no answer recorded. That was the September30 planning state. October1 bounded implementation is approved and verified: drafts remain local/unsent; central receipt is not connected.
- Recall stage: 0. Last review: none. Next due: 2026-10-01; introduce the explanation before retrieval if not yet presented/read.
- Retrieval question: What is the difference between a bug report saved on an offline iPad and one received in the central file?

## Review history

2026-09-30 — DEV-007: Tyler's actual answer correctly described waiting on the blocked feature and completing approved work. Successful for that concept; next review 2026-10-03. Terminology questions remain separate.

Append dated records with concept ID, the actual response (or a faithful short summary), feedback, outcome, and updated next due date. Never mark understanding or successful recall from silence.

## Current step and direction

- Current step: bounded approved Mac/iPad and local-report code/checks are ready for review in PR13 at ac44af3; workflow rules remain proposed for merge in PR11.
- Completed earlier: the reusable cloud environment passed the supplied web-development verification.
- Current queue and research: see `docs/FEATURE_QUEUE.md`. The earlier F-002 / DEC-001 homework assignment was withdrawn; technical signing research belongs to the agent. F-005 tracks the overnight execution setup and actual probe.
- Next application milestone: review the prepared HTTPS delivery/private-receiver choices and arrange physical device validation. F-006 and bounded F-007 implementation were approved October1; F-008 integration remains unapproved. Learning questions await Tyler's return; no new answers/recall inferred.
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

### DEV-014 — Unique indexes and an atomic swap
- Date/source: 2026-10-01; agent encountered the existing occupied-seat swap defect during approved platform verification.
- Explanation prepared for return: A unique index enforces one record per chosen key, such as one occupant at a layout/row/column coordinate. A transaction groups related changes so failure rolls them back together. Updating one occupant into another's occupied coordinate can still fail immediately inside a transaction. This fix removes the old coordinate rows and inserts both new positions in the same transaction, retaining their identities and recording both changes.
- Project evidence: source935ad143 local seatingSwap regression tests pass for successful swap, injected audit failure rollback and unauthorized rejection. Integrated162 tests/build passed. Chromium source830c4ce/run36892338859 completed the entire touch/classroom/backup/offline-reopen scenario. WebKit completed classroom/recovery before an independent offline-emulation failure. Current sourceac44af3/run36898900839 passes the full Chromium and WebKit classroom/recovery/cached-reopen flows. Physical iPad remains unverified.
- Clarification/recall status: explanation saved for return; no question asked during the noninteractive continuation, no user response or successful recall inferred. Review stage0; set the first due date after the explanation is actually presented.
- Prepared retrieval question: How do a unique index and a transaction each protect a two-student seat swap?
- Shared component reference: Reuse Component Lessons database/index v5, DB-003. Saved and remotely verified October 1.

### DEV-015 — Cached reopening and an origin outage
- Date/source: October1; agent explanation during platform verification, with review saved for Tyler's return.
- Explanation provided briefly: a service worker is the browser component that serves cached application files. An origin outage means the server supplying those files is unavailable. Testing cached reopening with a stopped server differs from simulating an offline network or using physical iPad airplane mode.
- Project example: the latest browser test stops its origin and requires the reopened document to come from the service worker. Chromium also uses the network-offline flag. WebKit's offline-emulation failure matches an upstream report; sourceac44af3/run36898900839 now passes stopped-origin reopening in both engines, with service-worker provenance and retained records; Chromium additionally uses network-offline emulation. This does not establish physical-device airplane mode.
- Actual answers/recall: none; deferred, no successful understanding inferred. Stage0; first review due October2 after the brief explanation; do not repeat already asked questions.
- Prepared retrieval question: Why would cached reopening with a stopped server still leave a physical iPad airplane-mode check to do?
- Current direction: finish authorized exact-source checks; hosting/publication, private receipt and device access are concrete dependent milestones, not new implementation approval requests.

## Afternoon review offered — October 1, 16:00 America/Toronto
- Current source: open planning PR #11 / codex/approved-plan-workflow, including the superseding 13:59 installed-iPad privacy decision. PR13 exact ac44af3 Mac/browser/Windows checks freshly observed completed/success; browser evidence does not establish installed-iPad privacy.
- Due term prompts selected: DEV-010 checkout versus CI (working source copy versus automatic checks); DEV-003 scope of verification, applied to passing browser checks and installed-iPad/offline privacy. Prompts offered for Tyler's next reply, without answer reveal. No answer received; stages and due dates remain unchanged.
- DEV-007 not due until October3; DEV-013 applicability already discussed today, next due October2, not repeated. No implementation approvals repeated.
- DEV-013 additional actual clarification October1: Tyler requested benefit/risk analysis of automatic reuse versus measured applicability checking, then selected “No, I think that measured approach makes sense - apply it”. Policy choice recorded and applied to shared skill; not a retrieval answer. Partial recall remains stage0/dueOctober2.
- Useful new optional documentation: F-006/DEC-002 installed app, offline operation and student-data boundaries after today's superseding privacy requirement. Offer brief explanation, original-source reading, or defer; earlier unchanged Safari/Home Screen reading remains deferred. No documentation choice or product approval inferred.

### DEV-016 — Signing, provisioning and distribution
- Date/source: 2026-10-02; terms introduced for F-006/DEC-005 installed-iPad pilot decision.
- Explanation: signing verifies an identified developer and unchanged app; a provisioning profile connects app ID, certificate and permitted devices/distribution. Ad Hoc names registered devices; TestFlight distributes time-limited beta builds through Apple; Custom Apps use a school/organization's Apple School Manager and MDM.
- Relationship to privacy: distribution controls installation and updates. Closed-loop privacy is an application/data-flow property that must be tested separately; no distribution option alone proves local-only records.
- StudentOrganizer example: an Ad Hoc build can be installed on Tyler's registered iPad, then tested with fictional data, network denial, local storage, Files backup/restore and no telemetry/remote APIs.
- Actual response/recall: none. Decision brief presented October2; choosing an option is not automatically successful term recall.
- Recall stage: 0. First review due 2026-10-03, America/Toronto.
- Retrieval question: What does a provisioning profile control, and why does it not prove that student data stays on the iPad?

### October 2 — DEV-016 decision response

Tyler selected Ad Hoc for a stable, small pilot with uncertain future plans, rather than a scalable service. He described TestFlight as potentially more useful if it became a key product feature. Feedback: TestFlight's advantage concerns beta distribution and update convenience; Ad Hoc keeps the pilot limited to registered devices, with more manual installation/update work. Neither route establishes application stability or local-only data handling. This is an actual distribution judgment and reasoning, not an answer to the signing/provisioning retrieval question. DEV-016 remains stage 0, due October 3. Existing unanswered checkout/CI questions remain unanswered; no duplicate prompt added.

## October 2 afternoon — pilot clarification and optional documentation

Tyler clarified at 10:21 America/Toronto: easy updates can wait; selling the product is a future goal. His words: “Cumbersome to everyone except myself is a feature.” Interpret this as intentionally restricted pilot access and acceptable manual distribution/update friction for other testers, while Tyler's own classroom use should remain straightforward. Do not design deliberate classroom UX obstacles, treat Ad Hoc as a security/license system, or infer approval for commercialization, payment, distribution, merge or release. This refines the morning “not a scalable service” rationale: small controlled pilot now, future commercial product possible. DEC-005 remains resolved as Ad Hoc; no decision follow-up is needed tomorrow.

Optional F-006/DEC-005 depth offered October 2: how signing/provisioning controls installation on registered devices, how manual updates preserve local records, and why pilot distribution and eventual commercial distribution are separate plans. Choices remain brief explanation, original Apple sources, or defer; no answer/defer is inferred.

### Afternoon learning review — October 2, America/Toronto

Source: open PR #11, codex/approved-plan-workflow. Main lacks the four planning/learning records; no missing state is invented. Fresh exact-head checks observed: PR11 855447d package success; PR10 b300aee package success/release skipped; PR13 ac44af3 four checks success; new draft PR14 b07651b four checks success. Checks establish exercised scope, not merge/release or installed-iPad approval. Subsequent administrative commits need their own fresh checks.

Rotate due terms DEV-001 (branch versus commit) and DEV-004 (standing repository instructions versus specific feature plan). Prompt for next reply: explain branch and commit with a StudentOrganizer example; explain how AGENTS.md differs from an individual feature implementation plan. No answers shown or received; stages/due dates remain unchanged. DEV-010/DEV-003 unanswered checkout/CI and browser-scope prompts are not repeated. DEV-013 unanswered applicability prompt is not repeated. DEV-007 and DEV-016 remain due October3. No successful recall inferred from Ad Hoc choice or its clarification.

## October 3 afternoon check-in

Current records: open PR #11 / codex/approved-plan-workflow; main still lacks the newer planning/learning files. Freshly observed PR11 b14f0ea package success and PR13 a7c6d941 four successful checks; PR14 confirmed merged into the feature branch only. No main merge or release approval inferred.

Actual latest reply: “I guess I'll have to find one sure” in response to Mac access. Record willingness to look for Mac access, not confirmed hardware or approval of the revised free testing build. The subsequent build-approval request remains unanswered. Paid Apple membership is rejected for this pilot; Personal Team free provisioning is the proposed replacement, with seven-day renewal and Mac/Xcode dependence. Do not restart paid Ad Hoc or PWA delivery.

Optional new F-006 documentation offered October3: free Personal Team provisioning, expiry/reinstallation versus updating application code, and preserving local records during renewal. Brief explanation, original Apple source reading or defer available. No choice/defer or product approval inferred. Prior unanswered optional reading remains unanswered.

DEV-016 is due today. Offer one fresh retrieval prompt before answers: explain what a provisioning profile controls and why renewing it is different from updating StudentOrganizer's features. This builds on today's actual explanation without repeating yesterday's branch/commit or AGENTS/plan prompts. No answer received; stage0 remains due October3 until an actual review outcome. DEV-007 is due but already demonstrated and not chosen as token participation. No successful recall from silence, Mac-access willingness or merge approval.

## October 4 afternoon learning check

Source: PR #11 / `codex/approved-plan-workflow`; main still lacks the current planning records. Fresh evidence observed before this administrative update: PR #11 head `7ebee5bd8d33ce7df95927c3d13d7c594206f51c` package check successful; PR #13 head `a7c6d941eb704b6f97a41543b6546cebfaccca07` all four checks successful. No merge/release approval inferred.

The October3 provisioning prompt and October2 branch/commit plus AGENTS/plan prompts remain unanswered, so none are repeated. Rotate to DEV-012, which is directly relevant to the next queued feature. Prompt: “A teacher writes a bug report while the iPad is offline. What evidence distinguishes a locally saved draft from a report received centrally?” Ask before revealing the answer. No answer received in this run; DEV-012 remains stage0 and overdue until Tyler responds. No successful recall inferred.

No optional reading is re-offered today: the free Personal Team material was already offered and the new free-pilot plan was presented this morning. F-007's private-receiver decision packet remains intentionally deferred until F-006 plan approval is resolved.


## October 5 — approved F-006 implementation

Source: current planning branch records read in full; Tyler's “Sure approved” authorizes the free installed pilot. Implementation continues independently; no merge/release approval inferred. Existing unanswered reviews remain unanswered and are not repeated.

### DEV-017 — Bundled assets and a native bridge

- Introduced October 5 during implementation: bundled assets are the application's scripts/styles included in the signed installation. A native bridge lets the React app request an operating-system operation, here the Files picker; it does not need a website or change Dexie storage.
- Project example: native JSON selection is validated before the teacher confirms atomic replacement; canceling the picker does not restore anything. WebKit restrictions and denial of native HTTP bridge calls protect different connection paths.
- Explanation provided in task commentary. Prepared review question: What does the native bridge do when StudentOrganizer opens Files, and why is that different from moving the database to a server?
- Stage 0; next review October 6. No answer/recall recorded.
- Milestone learning checks saved for return: (1) why does a browser test leave an iOS simulator check outstanding? (2) what must a verified backup demonstrate before seven-day renewal? These remain unanswered.
- Recommended next direction after available checks: run the exact build on a Mac/Xcode iPad simulator, then physical fictional-data acceptance and renewal. Remaining authorized local milestones continued without waiting for a direction response. No background run or reminder is claimed.

## October6 — batch implementation and deferred learning checks

No unanswered prior question was marked passed. Trial instruction saves learning checks for return and continues independent approved work. Reproduced seating randomization violated a unique enrollment index; transactional replacement now retains IDs and attributes audit writes. This extends DEV014's existing indexed swap example without claiming physical/device verification. Prepared check: how do the unique index and transaction each protect a classroom shuffle? No answer received.

DEV018 introduced: an update lookup compares release versions; it cannot establish installer publisher/authenticity or preservation of existing records. Project example: the Windows button sends only a fixed release lookup when clicked, handles installed QA versions, and cannot download/install anything until trust/channel/old-new acceptance prerequisites exist. Explanation in current task results; stage0, review dueOctober7. Prepared check: why can finding a newer version leave safe installation unverified? No recall response inferred.

Separate schedule task: no task-management or scheduled-run inspection tools exist here. The current manually launched checkout is evidence for this task only; scheduled-run inheritance remains unverified. Primary coordination and no replacement-before-readback rule are persisted. No schedule/notification/continued-background activity claimed.

## October 6 afternoon results and optional terminology review

Inspected mainaa64da1b, coherent open PR17 merge/results records and PR19 latest bug-only scope. PR18 merged by explicit13:29 “Yes”; no release or recall answer inferred. Post-merge Windows run37504031116 package passed/release skipped. Markinator checkpointb27954a reports256 tests/build/Chromium; acceptance incomplete. DraftPR20 created and existing CI started; neither PR creation nor CI proves continued Cloud coding.

Rotate to DEV017, explained October5 and dueOctober6. Fresh prompt for Tyler's optional next response: “In your own words, describe what the native bridge does when StudentOrganizer opens Files, and how that relates to where its classroom records are stored.” Answer withheld for recall. No answer received; stage0/dueOctober6 unchanged. Do not repeat older unanswered branch/commit, checkout/CI, applicability, provisioning or central-receipt prompts. DEV018 remains dueOctober7. Optional deeper F007 support identity/acting teacher and receipt documentation remains available; no reading choice/defer or service approval invented. Results/continuation: docs/work-orders/RESULTS-2026-10-06.md. Learning does not block authorized work.

## October 8 — database changes and verification scope

Actual Tyler reply: “Okay cool, so making changes to the shipped database is always a careful decision and ensuring that the tests do enough to ensure user satisfaction is important.” He then asked how to remove repeated authorization for routine verification/publication and instructed “continue”.

Feedback: this correctly recognizes existing-record preservation and useful tests as review concerns. Automated tests establish the behavior they actually exercise; teacher satisfaction also requires usable classroom flows and user feedback. An additive schema change can be bounded and justified, with tested preservation rather than automatic avoidance of all changes.

Introduced distinction: opening an existing v3 database with v4 code is a schema-upgrade check; restoring an older backup and installing an updated executable are different checks. New focused tests compare all 35 legacy collections/indexes, then reopen and use Markinator; these are Dexie/fake-indexeddb checks, not a real installer upgrade or physical-device result.

DEV-020, stage0, first review due October9 America/Toronto after this explanation. Actual high-level statement recorded; no specific upgrade-versus-restore recall response was supplied. Prepared question for later, not asked now: how does opening an existing database with new code differ from restoring a backup? Prior unanswered questions remain unpassed. Learning does not delay the authorized branch push/PR update.


## October 8 afternoon — trial results and optional term recall

Current source: open PR19/codex/bug-report-scope-20261006; current PR20 source30a13dd. Both desktop/browser Actions runs completed SUCCESS; trial recommendation and remaining verification limits are in the existing batch work order. Current queue supersedes the historical “Current step and direction” snapshot above.

Rotate to DEV018 (update lookup versus installation), stage0, dueOctober7; its prompt was previously prepared but no actual offer/answer is recorded in the available conversation. Optional activity offered with the answer withheld: “Explain what an update lookup does and what installing an update does, using the button at the bottom of StudentOrganizer Settings as your example.” This is terminology recall for a later user response, not an implementation approval or mandatory assignment. No response received; stage0 and overdue date unchanged. Provide specific feedback and schedule3 days after actual successful first recall; clarify gaps and revisit the next day. No previous unanswered native-bridge, applicability, provisioning or central-receipt question is repeated.

DEV020 (schema upgrade versus backup restore versus installer update) was introduced today; first review remainsOctober9. Do not bring it forward or mark Tyler's high-level test-preservation explanation as specific recall. DEV007's previously successful stop rule is not repeated.

No new deeper-reading packet is assigned. The existing optional upgrade/recovery explanation can be requested in an interactive reply; no defer, reading choice, feature approval or major decision is inferred from silence. Learning does not block independent authorized work.
