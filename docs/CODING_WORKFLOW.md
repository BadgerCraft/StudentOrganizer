# Our coding workflow

Tyler specifies goals, teacher experience, priorities, constraints, and quality. The coding agent investigates the code and owns implementation details, testing, routine repairs, and a reviewable PR. Approval of a feature plan authorizes work within that plan. Merge and release decisions remain with Tyler.

## Feature queue

For each rough feature request, prepare a short plan with:

- What a teacher experiences before and after.
- Affected code and stored data, explained only as far as the decision needs.
- Existing workflows that must keep working.
- Any consequential tradeoff or unresolved product choice.
- Checks that establish completion and dependency order.

Discuss plans together. Once approved, work through focused branches without repeating routine permission questions. Stop for a materially different product behaviour, consequential scope expansion, missing access, or the reserved merge/release decision. Record unrelated defects without silently turning them into the task.

At handoff, explain behaviour, verification evidence, limits, and the decision needed. Introduce at most two useful concepts. Use the explain-back skill when available, or the equivalent explanation and understanding check at coherent review points, respecting deferred checks and previous demonstrated understanding. Passing tests establish engineering evidence; they do not grant product approval.

## Reusable cloud workspace setup

The GitHub plugin can read/write this repository and prepare PRs. It does not by itself create or publish a reusable Codex Cloud environment. Do not claim that a conversational reply continues executing after the turn ends.

Current official setup: https://learn.chatgpt.com/docs/environments/cloud-environments

In ChatGPT, use **Work in > Cloud > Select environment > Create environment**, or **Settings > Codex Cloud > Environments > Create environment**. Select `BadgerCraft/StudentOrganizer`. GitHub is already connected for repository work; do not ask for another login without an observed access problem.

Give environment setup this request:

> Prepare BadgerCraft/StudentOrganizer for approved coding tasks. Use Node 24 and npm ci, then verify npm test and npm run build. Read AGENTS.md before changes. Make npm run dev available for web development at port 3000. Keep the environment private and use fictional data. Allow the package/download hosts required by npm and Electron; no AI service credentials or real student data are needed. Windows installer and portable checks run in GitHub Actions, since this cloud workspace is Linux. Produce a setup report and publish the reusable environment only after its setup is verified.

Review the setup report and publish the environment. New tasks use the published setup; each task has its own work. Existing tasks keep their own state. Important work belongs in Git, not only in environment state.

Cloud tasks can continue while the computer sleeps. Start an actual cloud task from the published environment for hours-long work. Scheduled tasks are not a replacement for that implementation workspace.

This repository supplies the working agreement and verified commands. Environment activation must be confirmed in ChatGPT's UI; it has not been performed merely by adding this document.
