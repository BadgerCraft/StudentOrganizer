# Daytime implementation evidence — October 1

Approved scope: [work order](DAYTIME-2026-10-01.md). [Draft PR #13](https://github.com/BadgerCraft/StudentOrganizer/pull/13) currently uses source935ad143a0cfe2c83478a7824069c037f0d19d17, baseline main a608e019. Implementation and bounded repairs are published; merge/release remain reserved. No Cloud dispatch, new provider/account or physical device claim.

## Observed execution and repairs

- Initial source466e5d0: Windows run36869731841 succeeded; Mac/iPad run36869731888 failed. A seat center tap reached a nested profile button; move mode now hides those actions. Electron-builder v26 skipped PR signatures; Mac workflow now requires explicit ad-hoc identity and enables credential-free PR test signing, with certificate discovery disabled and no credential provision.
- Sourceee6545d: Windows run36871250607 succeeded. Mac/iPad run36871250635 failed. Both Mac architectures built and launched actual DMG-installed apps; fictional participation/photo/assessment/K mark+feedback/editor reopening progressed to backup export. Native save dialog blocked the browser download wait; the revised test observes Electron's real download and selects its fictional CI evidence destination. Native save-dialog interaction remains unverified.
- Both browser engines exposed an existing occupied-seat swap unique-index ConstraintError. The repair preserves both row IDs/enrollments, deletes/reinserts their coordinates inside the same transaction, and records both audit/outbox changes. Three regressions verify successful swap, exact rollback on injected audit failure and no unauthorized writes. Bug-report smoke had a serialized tsx helper ReferenceError; literal self-contained browser expressions repair its test injection, with no production hook.

## Current exact-source checks

- Source935ad143: local162 tests/21 files PASS; TypeScript/production build PASS; generated offline shell root and /teacher/ simulation PASS; git diff whitespace PASS. Existing >500KB bundle warning remains.
- [Windows run36888480033](https://github.com/BadgerCraft/StudentOrganizer/actions/runs/36888480033): observed in progress when this entry was written.
- [Mac/iPad run36888480015](https://github.com/BadgerCraft/StudentOrganizer/actions/runs/36888480015): observed in progress; arm64 packages built and actual package smoke running, Intel packaging running, Chromium/WebKit installing. No new-source platform PASS asserted yet.
- Actual browser binaries absent locally; ordinary downloads were truncated. CI successfully installed them on the previous run, so available runtime verification continues there.

## Shared learning and remaining milestones

Reuse Component Lessons index/database v3 now records DB-003 with this source and specifically verified local regression scope, while retaining the SQLite-only scope of DB-001/DB-002. Remote save succeeded; reconciliation verification is pending at this entry. Packaging/browser fixes are not promoted to full platform completion before actual jobs pass.

Next: collect exact935ad143 jobs/logs, repair remaining in-scope failures and persist passing or accurately failed checks. Completion still needs physical iPad Home Screen/Files/keyboard/offline checks, stable HTTPS delivery, downloaded-file Gatekeeper/managed-Mac acceptance and a private report receiver. Reporting currently saves/copies/downloads unsent local drafts. Receiver proposal and constraints are in feature-branch docs/BUG_REPORTING_INTAKE.md; no endpoint is configured. F-008 historical notes found, current code-only archive/repository still missing; integration unapproved.

Today's scheduled continuation actually resumed, published these bounded fixes and launched fresh GitHub Actions checks. This establishes this iteration's source-edit/check path; it does not establish generic Cloud dispatch or guarantee future runs have a local checkout. Existing work and approvals were reread, and no competing writer was found. No repeated documentation probe, merge or release.
