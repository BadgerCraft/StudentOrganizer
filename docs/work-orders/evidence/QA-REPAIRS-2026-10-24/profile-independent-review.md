# Independent QA-02/03 profile review

Final frozen service/UI reread after owner readiness. No product edits by reviewer. Verdict: no remaining concrete blocker in reviewed slice.

Reviewed ProfileAssessmentService, StudentProfileModal integration, service tests. Service SHA256 ff2867f6637c844724197a200d932784a59cfe13ac01cb99f5416142a3164cf5; UI SHA256 8af18ff33b8420cbd161c715bb0c194a2f12b6fdab7f6ba978c54e578f4b4b8f.

Confirmed: class/enrollment/student organization, active identity epoch/device, permission and real open same-term period resolved inside transaction. New assessment/category/assignment plus score/audit/outbox nested service writes are one atomic transaction. Blank score is unassessed. Explicit percentage wording matches parser; invalid 4+ safely rolls back. Stable operation receipt rejects reused IDs for different requests and returns same existing work without overwriting later grade changes. Override opening snapshot protects ID/version/absence, and same-term period resolves before write.

UI stores chosen period instead of silently changing target when live periods change; captures override snapshot on form opening. Save-in-flight fieldsets prevent edits/cancel, parent close/settings/student transfer guarded, tab/removal disabled. Errors preserve inputs and override errors render inside the modal. Existing note flow is outside this repair slice.

Found during review: archived U1 occupied unique class/code index while fallback tried U1. Owner repaired to allocate unused code preserving tombstones. Independent repro before fix produced ConstraintError. After fix, seeded archived U1/U2/U3 creates U4 and preserves originals.

Independent runtime: profileAssessmentService.test.ts 7/7 pass (profile-independent-tests.log). Additional disposable probes verified invalid-score rollback against exact all-table snapshots, U4 tombstone-safe fallback, identical retry leaves every table unchanged. Owner's real Chromium pending-save/override-conflict/closed-period/retry verification is separate evidence, not independently rerun by this reviewer. No live or physical-platform tests claimed.

No remaining blocker; root integration/build/browser gates remain separate.
