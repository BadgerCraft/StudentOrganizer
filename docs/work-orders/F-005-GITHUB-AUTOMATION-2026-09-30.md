# F-005 — Harmless scheduled GitHub execution test

Date: 2026-09-30 (America/Toronto).

## Approval and scope

Tyler approved the proposed harmless GitHub automation test by saying "Go for it." This authorizes a scheduled worker to create an isolated documentation marker and draft pull request, observe existing GitHub checks, and save a factual report. It does not authorize application changes, infrastructure, workflow changes, external bot messages, merging, or releasing.

## Source and ownership

- Baseline main observed: a608e01913b7c8ec211fcbac18f9bf325d05402f; worker must record actual current main.
- Dedicated branch: codex/scheduled-github-probe-2026-09-30.
- Worker-owned marker: docs/work-orders/GITHUB_AUTOMATION_TEST_MARKER_2026-09-30.md.
- Worker-owned result: docs/work-orders/GITHUB_AUTOMATION_TEST_2026-09-30.md on the open planning branch; preserve existing contents and SHA.
- Coordinator owns other planning records; worker must not rewrite them.

## Milestones and evidence

1. Actual unattended wake-up and successful GitHub reads.
2. One isolated marker commit and one draft PR, with idempotency checks to avoid duplicates.
3. Existing Windows desktop workflow starts for the exact test PR/source SHA.
4. Observe checkout, dependency installation, npm tests, Windows packaging/build, and packaged assessment smoke-check status. Use actual run/job evidence, not a prior green run.
5. Persist and deliver the factual report with links and PASS/BLOCKED/NOT RUN/PENDING classifications.

Observation is bounded to 20 minutes, with waits no longer than 45 seconds. Pending checks remain pending; genuine access or CI failures are reported without expanding scope. No local application checkout is claimed. GitHub Actions supplies the test computer; published Codex Cloud use and general unattended feature coding remain unverified.

## Current state

One-time automation creation succeeded; title "Test GitHub coding path". Its saved prompt carries this complete scope and requests result delivery in this conversation. Creation confirms scheduling, not execution. No task URL was returned. Source edits and CI results are not yet observed.

## Next action

The scheduled worker performs the test and saves its report. Review observed results before describing this path as verified or extending it to application development.
