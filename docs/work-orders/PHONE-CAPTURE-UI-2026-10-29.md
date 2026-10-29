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
