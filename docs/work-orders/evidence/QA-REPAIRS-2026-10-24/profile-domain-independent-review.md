# Independent QA-02/03 profile domain review

Reviewer: persistence_review. Final frozen service/UI reread after owner readiness; no product edits by reviewer. Verdict: no remaining concrete blocker in reviewed domain slice.

Reviewed ProfileAssessmentService, StudentProfileModal service integration, service tests. Reviewed service SHA256 ff2867f6637c844724197a200d932784a59cfe13ac01cb99f5416142a3164cf5; reviewed UI SHA256 8af18ff33b8420cbd161c715bb0c194a2f12b6fdab7f6ba978c54e578f4b4b8f. These hashes identify the reviewed snapshot, not a claim that later files are unchanged.

Confirmed domain/calendar boundaries:
- Class/enrollment/student organization, active identity epoch/device, permission and real open same-term reporting period are resolved inside the write transaction. Missing/deleted actual term fails; no fictional rp-midterm fallback.
- New assessment/category/assignment plus score/audit/outbox nested service writes share one atomic transaction. Blank score remains unassessed. Explicit percentage wording matches parser; invalid 4+ rolls back.
- Stable operation receipt rejects reused IDs for different requests and returns existing work without overwriting later grade changes. Backup restore preserves the receipt path under tested fixtures.
- Override opening snapshot protects ID/version/absence; current same-term period and authority are checked before write. Opening props are not refreshed into authority for stale overwrites.
- UI stores the chosen period rather than silently changing the target when live period options change, and captures override baseline on form opening. UI pending-save behavior has its separate reviewer report.

Found during review: retained soft-deleted U1 occupied the unique class/code index while fallback tried U1. Independent pre-fix repro produced ConstraintError. Owner repaired allocation to use an unused code while preserving tombstones. Independent post-fix seeded archived U1/U2/U3 scenario creates U4 and retains originals.

Independent runtime evidence:
- profileAssessmentService.test.ts: 7/7 pass; log profile-independent-tests.log.
- Disposable fake-indexeddb probes: invalid-score rollback compared exact snapshots of every table; archived-unit fallback selected U4; identical same-operation retry left every table unchanged. All pass.
- Owner's real Chromium pending-save/override-conflict/closed-period/retry verification is separate evidence, not independently rerun by this reviewer. No live-data or physical-platform tests claimed.

No remaining blocker in reviewed domain slice. Root integration/build/browser gates and desktop reviewer's profile UI report remain separate. This report preserves this reviewer's findings under a distinct filename after two reviewers initially used profile-independent-review.md.
