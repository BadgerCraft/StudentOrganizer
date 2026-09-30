# Working rules for Ontario Teacher Assessment

This repository is the working source for the Ontario Teacher Assessment app. Read `README.md` for setup. Use the current code and test results to establish implementation status; a walkthrough or older project note records claims and decisions, but may be stale.

## Product and people

- Build for a teacher using the app during an actual class: calm, legible screens and few clicks for frequent actions.
- Tyler sets the goal, classroom behaviour, constraints, priorities, and quality bar. The coding agent may choose implementation details, investigate dependencies, and make bounded fixes without asking Tyler to direct code he has not learned yet.
- Explain consequential choices and results in plain language. Define technical terms when they first matter, and show how a choice affects the teacher's workflow. Invite Tyler's judgment on behaviour and tradeoffs rather than presenting a wall of code.
- Keep a product request separate from an audit finding or a possible future feature. Do not silently expand the task to clear an entire technical backlog.
- If a related defect must be fixed for the agreed outcome, fix it within that scope and explain it. Record independent defects for a later decision.

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
2. Reuse an approved feature plan. Approval authorizes implementation, verification, and routine repairs within that scope without repeated permission questions. Interrupt for materially different product behaviours, a consequential scope change, unavailable access, or a merge/release decision Tyler reserved. Inspect the affected code and callers. Make the smallest coherent change, with tests that exercise a real risk rather than duplicate the implementation.
3. Run the checks relevant to the change. The usual baseline is `npm test` and `npm run build`. Use a real browser flow for UI behaviour, a backup round trip for recovery work, and packaged-app checks when Electron packaging or storage changes. Say when a check could not run.
4. After a coherent batch is verified, explain changes and check understanding at the review handoff: explain the changed teacher experience, evidence, remaining risk, and at most two useful concepts needed for the decision. Defer any understanding check if Tyler is away and continue independent authorized work. Never claim background execution this environment cannot provide. Present the important decisions in language Tyler can judge. Show the branch and changes before merge. Tyler reviews meaningful changes one by one; do not treat a passing test as product approval.
5. Merge and publish releases only after explicit approval for those actions. A passing build or an understanding check is not approval. Keep rollback straightforward and update the project reference when a verified change makes it stale.

## Known follow-ups, not blanket gates

- The V6.6 browser fixture has a UTC/Toronto date mismatch and a mark-scale version ID mismatch; fix them in a focused test follow-up.
- Existing V6.5 databases may still hold Chen/MCV4U test seeds. Decide whether any particular installation needs a backed-up cleanup.
- Remaining direct UI writes and the Assessment Hub/Markbook UX need prioritization by concrete workflow risk. They are not automatically blockers to fictional-data QA.
