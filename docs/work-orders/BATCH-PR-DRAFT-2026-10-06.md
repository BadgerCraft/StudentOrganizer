# Draft review preparation — October 6 batch

Create a **draft** PR from `codex/batch-integration-20261006` to `main` only when GitHub API/UI access permits. This is a review candidate, not merge approval. Existing PR10 and PR15 source updates are pushed; do not duplicate those PRs.

Title: Reconcile approved Windows QA and installed-iPad work; repair seating and add manual update checks

Teacher outcome: imported students can reach/populate empty desks without losing existing assignments, and randomization confirms/commits atomically with actor audit. Windows Settings offers an explicit update lookup with no background calls or installer execution. Retained Mac/touch/local draft/security/recovery work is combined on current main; installed iPad remains a bundled native pilot rather than PWA delivery.

Validation: combined204 tests/25 files, build/native synchronization/static asset audit, complete fictional Chromium classroom/recovery/clean-profile35-collection restore/restart, roster-to-populate/randomize, and clipboard/quota/report draft smoke pass. Updater tests include installed QA versions, exact release destinations and trusted IPC caller; UI proxy confirms explicit-click-only behavior.

Review gates: exact-head Windows/Mac package/restart checks not freshly observable (GitHub API Forbidden), Mac failure cause undiagnosed without logs, iOS compile gate prepared but completion unobserved, simulator/physical Files/signing/renewal not run, WebKit runtime download blocked. Update installation deliberately remains unavailable until trustworthy release/signing and old/new Windows data acceptance are established. Do not infer any of these from browser/test success.

Reviewer sequence and consequence:

1. Review reconciled Windows QA source PR10 at15f402a and its actual Windows Actions evidence. Any eventual merge approval would add QA identity/artifact/restart controls; it would not publish a release/tag.
2. Review PR15 source1871cfd and retained native/Mac/security scope, including actual Mac/iOS logs. Native/device blockers remain separately recorded.
3. Review the combined candidate diff against main and the focused roster/updater branches. Candidate merge would integrate approved code plus current planning records; no release/hosting/provider/student-data migration or paid account is implied. Do not merge both this candidate and the overlapping sources blindly; choose one reviewed integration sequence and reverify current heads.
4. F007 receiver packet and F008 missing-source discovery are decisions/discovery only. No central sender/service is added by this candidate. Schedule migration is separately blocked; repository instructions do not create task objects.

No unapproved teacher persistence, roster deletion, crop/voice/AI, control-panel, category aggregation, or independent QA-ledger repairs were included. No main merge, release, tag, spending or distribution performed.
