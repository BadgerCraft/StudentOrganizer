# Daytime implementation evidence — October 1

Approved scope: [work order](DAYTIME-2026-10-01.md). [Draft PR #13](https://github.com/BadgerCraft/StudentOrganizer/pull/13) uses the exact source identified below, baseline main a608e019. Implementation and bounded repairs are published; merge/release remain reserved. No Cloud dispatch, new provider/account or physical device claim.

## Current checkpoint — October 1

Exact source: [ac44af3e6ba738937c535fa87f9aa2c35adc4586](https://github.com/BadgerCraft/StudentOrganizer/commit/ac44af3e6ba738937c535fa87f9aa2c35adc4586), unchanged main baseline a608e019. All current-source jobs completed successfully October1. CI checked synthetic PR merge818b5ca against that baseline; this is a test checkout, not an actual merge.

| Check | Observed result and evidence |
| --- | --- |
| Tests/build |162 tests in21 files PASS on both Mac runners and Windows; production/typecheck builds PASS. Local built-worker regression at root and /teacher/ PASS. |
| Apple Silicon Mac |[Job110492793943](https://github.com/BadgerCraft/StudentOrganizer/actions/runs/36898900839/job/110492793943) PASS: actual DMG-installed and ZIP-extracted apps, architecture/ad-hoc signature, fictional percentage/feedback/photo/notes, full backup, invalid-restore preservation, confirmed recovery and restart. |
| Intel Mac |[Job110492794139](https://github.com/BadgerCraft/StudentOrganizer/actions/runs/36898900839/job/110492794139) PASS: the same actual-package/recovery checks. |
| Chromium/WebKit |[Browser job110492793629](https://github.com/BadgerCraft/StudentOrganizer/actions/runs/36898900839/job/110492793629) PASS: portrait/landscape/split hit targets, swap, attendance, notes/photo, assessment/K mark, roster/CSV/full backup/replacement, cold process reopen with stopped origin and service-worker document plus retained records. Chromium also uses network-offline emulation. WebKit's result is origin-outage reopening, not device airplane mode. |
| Report drafts |Same browser job PASS: reload, exact edited download, clipboard error, quota preservation, dismissal guard and no external report requests. Local drafts remain unsent; private intake is not connected. |
| Windows regression |[Run36898900710/job110492792956](https://github.com/BadgerCraft/StudentOrganizer/actions/runs/36898900710/job/110492792956) PASS: build/packages and actual assessment/restart. |

[Successful Mac/iPad run36898900839](https://github.com/BadgerCraft/StudentOrganizer/actions/runs/36898900839) contains arm64/x64-12 package artifacts and iPad-browser-evidence-12, each associated with exact sourceac44af3. No release/tag/publication performed. Source-specific guides in PR13 retain their earlier handoff snapshots; this checkpoint/PR body is the latest check verdict.

The last scoped repair addressed a real static-cache miss. At source3347873, stopped-origin Chromium reopening received worker HTML but JS/CSS requests failed and the body remained empty. Preview responses measured Vary: Origin; incoming module/style headers differ from URL precaching. A focused worker regression reproduced the miss before repair and passed after matching only exact same-origin bundled assets by canonical precache URL. The unchanged cold-reopen/offline/classroom assertions now PASS. No grading/identity/record change, query/origin/asset allowlist widening, dynamic response or record caching.

Bounded implementation and verification are ready for review. Full platform completion remains dependent on approved stable HTTPS delivery and physical iPad Home Screen/Files/keyboard/airplane-mode checks; Mac downloaded-file Gatekeeper/native-dialog/managed-device acceptance is unverified. Report central receipt requires a separately approved private receiver and actual verified arrival. F-008 needs current code-only source; integration unapproved. Delivery/receiver proposals are prepared in PRODUCT_ROADMAP and feature docs/BUG_REPORTING_INTAKE.md.

Relevant shared lessons saved and remotely verified October1: index v6, database v5 DB-003, packaging v2 PKG-001/002/003, browser/touch v2 BRW-001/002/003. Matching Dexie/packaging evidence retained proportionally; SQLite-only evidence not treated as Dexie proof. BRW-002 now has bounded stopped-origin PASS; BRW-003 records the measured cache/header regression. No physical-device inference.

The bounded daytime edit/check/report trial succeeded. Its dedicated continuation was paused after the coherent passing result because further platform/intake work depends on service approval or device access. Standing daily briefings remain unchanged. No Cloud-dispatch or permanent-checkout claim. Next concrete action: review PR13 and the prepared HTTPS delivery/private-receiver choices, then validate the chosen deployment on physical devices. Merge/release remain reserved.

## Earlier execution and repairs

- Initial source466e5d0: Windows run36869731841 succeeded; Mac/iPad run36869731888 failed. A seat center tap reached a nested profile button; move mode now hides those actions. Electron-builder v26 skipped PR signatures; Mac workflow now requires explicit ad-hoc identity and enables credential-free PR test signing, with certificate discovery disabled and no credential provision.
- Sourceee6545d: Windows run36871250607 succeeded. Mac/iPad run36871250635 failed. Both Mac architectures built and launched actual DMG-installed apps; fictional participation/photo/assessment/K mark+feedback/editor reopening progressed to backup export. Native save dialog blocked the browser download wait; the revised test observes Electron's real download and selects its fictional CI evidence destination. Native save-dialog interaction remains unverified.
- Both browser engines exposed an existing occupied-seat swap unique-index ConstraintError. The repair preserves both row IDs/enrollments, deletes/reinserts their coordinates inside the same transaction, and records both audit/outbox changes. Three regressions verify successful swap, exact rollback on injected audit failure and no unauthorized writes. Bug-report smoke had a serialized tsx helper ReferenceError; literal self-contained browser expressions repair its test injection, with no production hook.

## Earlier exact-source checks — source935ad143

- Source935ad143: local162 tests/21 files PASS; TypeScript/production build PASS; generated offline shell root and /teacher/ simulation PASS; git diff whitespace PASS. Existing >500KB bundle warning remains.
- [Windows run36888480033](https://github.com/BadgerCraft/StudentOrganizer/actions/runs/36888480033): observed in progress when this entry was written.
- [Mac/iPad run36888480015](https://github.com/BadgerCraft/StudentOrganizer/actions/runs/36888480015): observed in progress; arm64 packages built and actual package smoke running, Intel packaging running, Chromium/WebKit installing. No new-source platform PASS asserted yet.
- Actual browser binaries absent locally; ordinary downloads were truncated. CI successfully installed them on the previous run, so available runtime verification continues there.

## Shared learning and remaining milestones

Reuse Component Lessons index/database v3 now records DB-003 with this source and specifically verified local regression scope, while retaining the SQLite-only scope of DB-001/DB-002. Remote save and reconciliation verification succeeded. Index/database is now v4; packaging v1 records the measured native Mac signature/recovery findings with their exact source and limits. Packaging/browser fixes are not promoted to full platform completion before actual jobs pass.

Next: collect exact935ad143 jobs/logs, repair remaining in-scope failures and persist passing or accurately failed checks. Completion still needs physical iPad Home Screen/Files/keyboard/offline checks, stable HTTPS delivery, downloaded-file Gatekeeper/managed-Mac acceptance and a private report receiver. Reporting currently saves/copies/downloads unsent local drafts. Receiver proposal and constraints are in feature-branch docs/BUG_REPORTING_INTAKE.md; no endpoint is configured. F-008 historical notes found, current code-only archive/repository still missing; integration unapproved.

Today's scheduled continuation actually resumed, published these bounded fixes and launched fresh GitHub Actions checks. This establishes this iteration's source-edit/check path; it does not establish generic Cloud dispatch or guarantee future runs have a local checkout. Existing work and approvals were reread, and no competing writer was found. No repeated documentation probe, merge or release.

## Historical checkpoint progression

- Source93a639c6a079264bdbb17a97218057706a001270, run36889421531: both native Mac jobs PASS on actual DMG-installed and ZIP-extracted bundles, including signature/architecture inspection, fictional marks/feedback/photo/notes, full backup, invalid restore preservation, confirmed recovery and restart. Bug-report Chromium draft/reload/exact-download/clipboard failure/quota protection/no-external-request scenario PASS. Windows run36889421552 PASS. Both touch engines passed the swap checkpoint, then failed attendance hit-target access.
- Sourcec73692c0bd413e80ff288bb5489f35dab0000e4e adjusts grid minimum width so oversized tracks start inside horizontal scrolling; browser scenario now checks the actual attendance hit target at portrait/landscape/split widths. Local production/typecheck build, root/subfolder shell simulation and whitespace PASS. Its run36890507743 exposed photo-save failures on both Mac architectures; browser installation was still running when superseded. Do not reuse the earlier Mac PASS as proof this source is verified.
- Current source7b771c4ab23d855c4753f29e9dd017d2409cff5d adds form-initialization assertions, waits for successful settings closure, and screenshots/dialog text for failures. No speculative production-photo change was made. TypeScript PASS. [Mac/iPad run36891506058](https://github.com/BadgerCraft/StudentOrganizer/actions/runs/36891506058) observed pending; [Windows run36891506078](https://github.com/BadgerCraft/StudentOrganizer/actions/runs/36891506078) running. Current platform verdict remains verification in progress.
- Shared skills saved and remotely verified: DB-003 local regressions and actual browser swap checkpoint; PKG-001 ad-hoc PR signing and actual artifact measurements; PKG-002 actual Electron download/recovery capture. References preserve older failures and limits. No physical-device or notarization claim.
- Tyler reaffirmed “Approved” October1 at12:16 without specifying additional scope. The original implementation boundaries continue; no provider/account/merge/release choice is inferred.

Next immediate action: inspect exact7b771c4 jobs/logs, resolve scoped photo/touch failures and collect a passing coherent-source result or a concrete reproducible blocker. Stable HTTPS delivery and private receipt remain dependent service decisions; source discovery still needs the current standalone code.

October1 shared reference update: index/database v5, packaging v2 and browser/touch v1 saved and remotely verified. DB-003 includes actual Chromium full-flow evidence; PKG-003 separates committed records from settled visible cells; BRW-001 covers actual touch-hit geometry; BRW-002 retains the WebKit observation and Proposed stopped-origin check while current browser installation is pending. No device or receiver evidence inferred.

## Browser execution retry — October1

Attempt1 browser job110475375440 at unchanged source90a06c1 timed out/cancelled during Ubuntu mirror package downloads, before browser installation or app UI checks. Logs show package retrieval continuing slowly through libflite1 at16:58, then cancellation at17:00:30 UTC; no test screenshots were generated. This is a runtime dependency timeout, not a passing or failed app browser scenario. Completed native Apple Silicon/Intel and Windows jobs remain PASS for this source.

GitHub successfully accepted a failed/incomplete-job retry of run36893625121 at17:01 UTC. No source edit or duplicate PR, no new automation; leave the continuation enabled while this transient execution failure is being retried. Next: inspect the retry's actual jobs/logs, retain prior successful native evidence and collect the exact browser outcome. If installation repeats the failure, fix only the supported CI runtime route rather than weakening the classroom/cache/recovery assertions.

## Version-matched browser runtime repair — October1

Source0097490 changes only browser CI execution: official mcr.microsoft.com/playwright:v1.63.0-noble includes browser/system dependencies, with a throwing package-version/executable-presence guard matching package-lock1.63.0. All four shell/Chromium/WebKit/report checks and the native matrix are retained. The first local config assertion used an incorrect total-step count; the corrected YAML/required-check validation and whitespace check PASS. No app assertions were weakened, no code/library version or production behaviour changed, no hosting/account/data access or spending added. Current runs36896820951 and36896820969 are observed running/pending. Official Docker/CI documentation checked October1: https://playwright.dev/docs/docker and https://playwright.dev/docs/ci . Next action: inspect these exact-head jobs/logs and fix only a supported scoped failure.
