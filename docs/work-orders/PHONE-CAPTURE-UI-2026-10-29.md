# Phone capture UI fundamentals — October 29, 2026

## Scope and completion checks

Tyler requested applying UI fundamentals to the remote app and clarified “Yes remote app is phone capture app”. Parent delegated implementation, synthetic verification, independent review and draft PR; no merge/release/deploy, signing, live permissions/Drive grants or student data. Encryption/storage integration belongs to a separate stream; this change owns phone UI, its browser checks and this record only.

Base: verified PR49 merged, main `a789e33c62220d2deaac0b6124b1d7e4debf2e97`. Branch `codex/phone-capture-ui-20261029`. No merge performed here.

Read AGENTS, current queue, learning record, existing capture work orders, crop/component implementation and accepted FOCUSED-ORGANIZER design record. Canonical Tyler’s UI Preferences v3 (`libfile_c365fd69899c81919d1f6a09434991e9`) read in full through Library: focused work, retained summaries, visible secondary controls, dark default/optional light, concrete recovery. Desktop-only navigation/keyboard/grade choices do not apply to this companion. `/workspace/.agents` is empty; repository `.agents/skills` absent. Shared reuse-component-lessons package read failed (“skill package is not available”); no current shared lesson IDs/version or update claimed. Existing durable batch, native receipt and crop components are reused; no persistence schema/crypto/identity matching changes.

## Screen checklist

| Screen | Intended change and preservation | Verification |
| --- | --- | --- |
| Home | Saved assignment cards; New assignment; retained drafts | Resume and reload synthetic draft |
| Assignment setup | One name field/action, class may remain in existing assignment label; no invented class/roster model | Empty name, failed save, Home persistence |
| Capture | Native continuous camera or browser photo input; import alternative; compact pending-photo previews; preview action | Cancel/recovery, repeated taps, counts/bytes retained |
| Preview and label | Existing rotate/reorder/remove/crop; required label; Save & Finish; Back to capture; confirmed discard | Touch/keyboard crop, missing label, failed writes and retry |
| Between students | Compact saved sets, repeat capture and All done | Repeated student labels remain distinct; no implicit identity matching |
| Completed assignment | ZIP and deliberate private Drive transfer; delivery state distinct from local completion; late work | Failed upload, retry, no duplicate queue; immutable originals and explicit desktop matching |
| Secondary package controls | Collapsed assignment switch/history/delete; privacy/storage help | Cancel delete/complete; linked packages preserved |
| Across views | Dark/light, readable spacing, visible focus, mobile/touch targets; errors scroll into view | Rendered narrow/wide screenshots; keyboard and overflow checks |

Completion requires phone unit/build/browser and mocked native flows, appropriate desktop baseline, rendered screenshot inspection, independent review/corrections, draft PR and final CI. Native camera hardware, OS permissions, physical-device Back/lifecycle, actual Drive delivery and assistive technology remain device acceptance limits. No passing browser check implies those are complete.

Routing: inherited coordinator model/effort; bounded UI work with high-risk preservation checks. Independent reviewer uses inherited model, read-only ownership; escalate concrete data-loss/receipt/recovery regressions to reproduction and correction. Observable completion is verified original bytes/pending records plus focused rendered flows and exact-head CI, not a screenshot alone.

## Verification and review

- Phone: 23/23 unit tests, TypeScript and production build pass.
- Desktop baseline: 90 test files, 971 passed and one native-only skipped; production build passes. Desktop code, shared capture contracts, phone storage/native bridge and Android sources are byte-identical to base.
- Existing phone browser and mocked-native browser suites pass: rotate/reorder/crop, exact exported original bytes, repeated labels, failed write text retention/retry, restart, pending native recovery/acknowledgement, no intermediate send, linked late work, delivery states and failed transfer retry. Synthetic records/images only; no external requests.
- New UI browser test passes focused view visibility, dark/light persistence, 320/390/768px overflow and ≥44px visible controls, missing label, Back preserving label/photos, cancel discard/complete/delete, synchronous double-save rejection, keyboard stage focus. Added to capture CI.
- Rendered dark capture, 320px preview, light preview and completed transfer screenshots inspected and retained under `evidence/PHONE-UI-2026-10-29/`. Optional crop tools collapse to avoid a duplicate full-photo canvas during ordinary preview. Photo length remains scrollable by design.
- Independent reviewer reproduced focus dropping to BODY and scroll remaining below the next capture task at 320×640 after Save & Finish. Repaired with task transition heading focus/scroll after unlocking; same-screen controls retain focus where possible. Reviewer independently rechecked the correction, ran both existing browser suites and found no additional concrete blocker in reviewed paths. Physical assistive technology is unverified.
- Initial npm setup failed because default cache `/home/agent/.npm` was unavailable; one workspace-cache retry succeeded. No dependency versions changed.

Native-device limits remain: no camera hardware, OS Back/permissions/lifecycle, signing, physical-phone memory/latency or actual Drive delivery tested. Mock receipts are not delivery proof. No provider grants, live upload, release, deployment or merge performed. Shared component lesson access remains unavailable, as recorded above.

## Publication

Implementation `4461f279cc0acc6d7fe2ab2dbe5e2f0b38ef13cb` pushed and read back in [draft PR50](https://github.com/BadgerCraft/StudentOrganizer/pull/50). Final independent disclosure/native-button recheck found no new blocking concern. Exact-head CI is maintained in the PR description to avoid changing source solely to record its checks. No merge/release/deploy performed.

## October 30 — validated upload checklist refinement

Authority: Tyler requested “a simple checklist in the top left” lighting completed steps from grey with “Clear to Upload”, one Upload button and then “Uploaded!”. Parent delegated this scoped refinement to existing draft PR50, preserving earlier UI, photos/drafts, local export and explicit desktop matching; no merge/release/deploy, encryption or live grants. Resumed at verified remote/local `94bc31958c3cf6fef2cbd9a5ff6390e8e5b22261` with clean tree. Existing guidance and earlier accepted UI records remain applicable; shared skill availability limitation remains unchanged.

- Checklist derives assignment, actual captured photos, saved labelled student sets, validated completed package and native setup from current state. Checkmarks plus explicit Complete/Incomplete text supplement colour. Returning to an unfinished/reopened group clears readiness; clicking through screens cannot establish it.
- The saved exact revision is validated through the existing ZIP validator on completed-package open and explicit recheck; upload revalidates before native handoff. Validation failure retains originals, keeps Home/New/package navigation available and offers an enabled local recheck even without native support.
- One primary Upload appears with exactly “Clear to Upload” only for checked complete content, enabled supported native setup and fresh NOT_QUEUED/RETRY state. ZIP export remains a secondary local-only action. No automatic student matching is implied.
- Preparing/queued/uploading display indeterminate progress because the existing bridge does not provide trustworthy byte percentages. Busy/queue state blocks duplicate upload. Only exact capture ID/revision COMPLETE produces “Uploaded!”, with desktop matching still required.
- A renderer uncertainty marker is saved before native handoff. Lost replies survive reload; polling cannot clear an uncertain NOT_QUEUED result. Explicit recheck reads the existing native queue before making retry available; UNAVAILABLE remains blocked. Confirmed COMPLETE clears uncertainty. Existing native idempotent queue/reconciliation contracts are unchanged. No automatic resend added.

Verification: 23 phone unit tests and production build pass. Existing production capture browser, extended mocked-native browser and extended responsive UI browser suites pass with synthetic images/records only. Coverage includes missing names/photos/labels/setup, reopened groups/Back, failed saves, retained original bytes, pending native captures, lost replies/reopen, explicit unknown-status retry gates, synchronous duplicate taps and visible progress, queued/paused/auth/blocked/verified states, keyboard focus and 320/390/768px touch layouts. Tests inject SHA-256 failure specifically (not Dexie's unrelated SHA-512 initialization probe), restore it and verify successful local recheck. Existing full desktop baseline is retained; current exact-head platform/shared CI belongs in PR50.

Independent reviewer reproduced startup lockout on package-validation error; repaired and independently rechecked with saved groups retained and Home/New available. Reviewer also found browser-only recheck disabled; repaired, independently verified and added regression. Reviewer independently ran mocked-native and final UI checks; no remaining blocking finding. Rendered ready/unknown/uploaded synthetic screenshots inspected and committed under `evidence/PHONE-UI-2026-10-30/`.

Limits: native hardware, OS Back/lifecycle, assistive technology, actual provider uploads and phone latency remain unverified. Full ZIP verification can take time for large completed packages; no progress percentage is fabricated. Browser/pilot evidence does not establish live delivery. Final CI is recorded in the existing draft PR; no merge/release/deploy.
