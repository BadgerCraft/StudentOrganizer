# Manual Windows update check — October 6, 2026

## Installer implementation and measured Windows upgrade — October 10, 2026

Tyler's October9 instruction shelves Store investigation and authorizes implementing the Windows auto-installer. [PR22](https://github.com/BadgerCraft/StudentOrganizer/pull/22), sourcec6eebf7fe2567d0183b42b0d61389eab349a2b40, implements explicit Settings check -> download/cancel -> complete verified local backup -> deliberate install/reopen. No startup check, automatic download, ordinary-quit installation or student upload. The earlier investigation-only hold below is superseded for fictional-data implementation/testing, while free-only and unsigned public distribution holds remain.

[Windows run38009698834](https://github.com/BadgerCraft/StudentOrganizer/actions/runs/38009698834), job114086591336, completed SUCCESS at October10 00:42UTC (October9 20:42Toronto):313 tests/33 files, production build, actual installed/portable/assessment/network acceptance and actual NSIS A1.0.1 -> B1.0.2 replacement. The new visible B was observed automatically reopened before instrumented relaunch; normal userData, all39 database tables/records, originals/rubrics/official and pending feedback, exact safety backup and identical report bytes survived replacement and another restart. Real corrupt-byte rejection/retry, cancellation/retry, pending-download ordinary quit, dirty Settings and unchecked unsigned acknowledgement passed. Artifact11652033786 retains upgrade-results.json and native process/installer evidence. The A/B pair uses this production source with distinct stable versions and the same current schema; it does not prove future-schema migration or live stable release delivery.

The production updater uses pinned electron-updater6.8.9 standard NSIS, fixed public GitHub stable full-installer metadata and mandatory SHA512. Downloaded bytes and Windows signature are rechecked after the complete backup. Invalid/error signature checks stop installation; NotSigned requires fresh explicit acknowledgement. Private local backup is atomically written/synced/read back before launch. Renderer networking remains denied; a separate fixed-host HTTPS updater partition strips cookies/auth/referrer/staging identifiers. Single-instance identity/profile remains stable. A writable per-user install and actual installer spawn are required before quitting; elevation/fallback helpers are blocked. A failed launch keeps the app open and retryable.

All Mac/browser regression jobs are now green: unchanged Intel retry job114211167253 passed exact DMG/ZIP backup/recovery/restart October10 12:23UTC, alongside Apple Silicon/browser passes in run38009698857. The earlier Intel ZIP seating-view failure is preserved; backups were intact and no root cause/fix is claimed. PR22 is READY FOR REVIEW. Queue and PR22 own the latest outcome; a recurrence requires actual stored/index-query/renderer diagnostics without weakening the assertion.

Deployment is still separate: current installers are NotSigned/publisher null, checksum integrity is not publisher identity, and no stable release/latest.yml was published. Existing copies need one manual bootstrap installation of the updater-enabled version. Public unsigned delivery, app-specific trusted signing, physical/managed Windows/UAC, post-launch interruption recovery and future-schema compatibility remain unverified/reserved. No spending, account/license/service adoption, main merge, public release or real-student use occurred. Store work below is dormant until Tyler chooses it or a free trusted-publisher route is needed.

The earlier native failures are traceable in the current queue: bundled file URL tilde representation, incompatible inherited PowerShell modules, and canonical native process observation were repaired without weakening sender/signature/actual-reopen assertions. Shared UPD-003/UPD-004/UPD-005 and PKG-004 lessons are saved in indexv10/desktop-updatesv4/packagingv3 at d74a6e6, including actual replacement/reopen and preserved-data evidence; source work record remains on PR22.

## Privacy verification — October 9, 2026

Current main `b9a8790` passed a scoped student-data egress review, 58 focused tests and a fresh production build/CSP inspection. Its exact-source Windows package already passed runtime renderer/session network-blocking and real manual-update IPC checks in run37973955991/job113967364555. The fixed GitHub metadata check sends no student content and neither downloads nor installs. No production cloud sync/AI/telemetry/bug receiver was found. This supports the current local-only app boundary, not a Store acceptance claim.

No MSIX/Store package exists. Before calling Store delivery verified: inspect the actual package identity/capabilities and shipped code/CSP; run the same installed-package boundary tests, plus observe actual process outbound destinations during fictional-data launch/marking/import/export/update; distinguish Store service traffic from app traffic; prove legacy profile migration and Store A-to-B preservation/restart/failed-update recovery; measure uninstall behavior and warn/protect data where needed. OS diagnostics/managed-device/cloud-backup configuration needs its own review. Optional Windows crash diagnostics may include user content, and app database/full backups are not app-encrypted. A user-selected synced export folder can upload a backup independently of our app. Do not promise zero Microsoft access from a source-only audit.

Full evidence and official policy references: [current privacy record](work-orders/SECURITY-2026-10-02-RESULTS.md#current-source-and-store-privacy-verification--october-9-2026). Existing free-only and release/account approval boundaries remain.

## Superseding free-only requirement — October 9, 18:05 Toronto

Tyler explicitly rejects all spending. Paid Azure Artifact Signing and commercial certificates are not approved options. Preserve the signing/distribution hold and upgrade acceptance matrix below; its paid-route recommendation is historical and superseded.

Free candidate: Microsoft Store MSIX. Official current onboarding describes no registration fee; Microsoft's signing guidance states the Store re-signs MSIX packages. Publishing an MSI/EXE to the Store does not provide this re-signing, so our existing NSIS artifact is not a free signing shortcut. Current repository inspection found no appx/MSIX configuration, Store-assigned package identity or legacy-to-Store upgrade test. Registration involves owner identity verification and publication remains a separate decision.

Before recommending adoption, assess: package identity/publisher/assets and Electron compatibility; Store-managed update behavior versus click-only updates; MSIX file-system redirection/legacy profile discovery; verified UI export/import as a recoverable migration option if same-profile reuse is not proven; uninstall/data retention; and restricted pilot availability/device policy. Existing local data must not be silently moved/deleted and no Store app is published as part of investigation. Microsoft Store signing covers the Store package, not the direct portable executable.

Alternative free signing: SignPath Foundation requires an OSI-approved license, no proprietary components, maintenance, already released artifacts, code-signing policy, roles/MFA and discretionary project acceptance/reputation. No LICENSE file is present in the inspected source. Public GitHub visibility is not evidence of an accepted open-source license. Do not adopt a license, apply/enroll, contact the foundation or promise eligibility without the required actual user decision/authorization.

Sources checked October9: [free Store onboarding](https://learn.microsoft.com/en-us/windows/apps/publish/partner-center/open-a-developer-account), [Store MSIX signing versus MSI/EXE](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options), [MSIX desktop runtime/data redirection](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-behind-the-scenes), [SignPath eligibility](https://signpath.org/terms). No new prototype, upgrade pass or guaranteed acceptance is claimed.


## Delivery hold and proposed completion plan — October 9

Status: investigation/planning, implementation and paid signing adoption not yet approved. Tyler instructed publisher signing and data-preserving replacement be figured out before an unsigned QA release. No QA tag/release/distribution, signing account, certificate purchase or installer launch is authorized by that instruction.

### Measured gaps

- Main b9a8790 uses electron-builder26.15.3/Electron44.4.5, NSIS plus portable builds. The main Windows37973955991 log records both executable files as NotSigned, publisher null, despite builder log lines mentioning signtool.
- package.json has no publisher/signing configuration. electron/main.cjs exposes only the zero-argument metadata check; package dependencies do not include electron-updater. There is no downloaded-installer verification/install/reopen path.
- windowsPackagesSmoke.ts tests one current portable copy and one current installed copy with restart. It never replaces an older installed build with a newer one. Fake-indexeddb v3-to-v4 fixtures do not prove real packaged profile discovery or installation preservation.

### Proposed order and teacher behavior

1. Choose a signing/distribution route. Recommend retaining direct signed NSIS delivery using Azure Artifact Signing. Microsoft documents Canadian individual eligibility, identity validation and an approximate $9.99/month cost. Confirm actual Canadian checkout/currency/tax and account terms before creation; account creation starts billing and is not authorized here. Microsoft Store MSIX is a documented free signing/distribution alternative, but changes package/distribution and requires a separate existing-data-path and migration investigation. Self-signed certificates are not a public-publisher solution. A signature does not guarantee immediate SmartScreen reputation or managed-school device approval.
2. Build and measure the exact signed artifacts in an authorized release workflow. Require a trusted Authenticode chain, expected verified publisher and timestamp on installer/application components, not merely a successful signing command. Keep signing credentials outside source and unavailable to untrusted PR jobs; fail release packaging if signatures are absent/incorrect. Publisher name must follow validated identity, not an invented label. Pinning/rotation policy must be explicit. Signing only involves built app artifacts; classroom records are not sent.
3. Prove deliberate replacement before promising an integrated updater. Keep `ca.on.teacher.assessment`, app.name `ontario-teacher-assessment`, expected installation scope and userData path stable. In disposable Windows profiles install actual version A, create fictional organizer and marking data through its real UI, export/parse backup, close all copies, install signed B over the same registered installation, launch B, verify unchanged IDs/records and appropriate additive schema migration, then restart again. Test the actual legacy unsigned-A-to-first-signed-B transition separately from signed-A-to-signed-B. A successful clean B install does not pass either case.
4. Add the user-controlled updater only after the complete plan is approved. Intended flow: Check for updates -> inspect version/release -> explicit download -> verify authenticated metadata/hash and trusted expected publisher -> save/close guard -> verified local backup -> deliberate install/reopen. No startup polling, automatic download, quit-time installation or forced restart. Windows networking stays in the authorized main-process route; the renderer cannot supply executable paths/URLs/arguments. Consider the standard NSIS electron-updater path rather than hand-written executable launch, but verify the exact supported version and signature/metadata behavior before adoption. Current v26 builder docs do not justify assuming v27 signed-manifest capabilities are present. Use a fixed reviewable channel and fail closed on missing/wrong signing evidence.
5. Treat portable copies separately. They currently share the same Windows profile data location with installed copies; they are not self-contained data folders. Initial portable replacement should be an explicit validated replacement with every running copy closed and a backup. Do not silently convert it to an installed application or claim NSIS updater acceptance covers portable replacement.

### Required acceptance matrix

| Scenario | Required evidence |
| --- | --- |
| Signed clean installation | Actual downloaded installer, measured publisher/chain/timestamp, expected app identity/path, launch and restart; downloaded-file policy is distinct from hosted CI. |
| Legacy unsigned A -> signed B | Same real Windows profile/registered installation; organizer, originals, marking drafts/final marks/rubric/history and photos preserved; no duplicate app/profile. |
| Signed A -> signed B | Real package replacement, same install scope/path and data profile, new visible version, all stored and settled UI results preserved, second restart. |
| Download rejection | Modified bytes, wrong signer, revoked/untrusted chain, wrong channel/version, oversized/stalled/interrupted transfer fail before executable launch; old app/data still usable. |
| Cancel/unsaved/backup failure | Retain active edits and pending feedback; cancellation leaves A running; backup must complete and be independently readable before installation. |
| Install failure/power interruption | Record actual NSIS behavior in disposable Windows tests; do not promise atomic replacement. Preserve app data and provide tested repair/reinstall and verified backup recovery when binary replacement cannot roll back. |
| Schema rollback | Never run old A blindly against B's upgraded database. Retain the pre-update backup and old binary; restore only through a tested compatible path in isolation, with clear treatment of any post-update work. |
| Portable replacement / profile collision | Explicit replacement, all copies closed, backup and restart; portable-to-installed migration is separate scope, not silently performed. |

Ordinary checks cover the unchanged classroom network denial, actor attribution, category policy, audits, importer/restore failures, metadata total deadline and retry. Only observed rows may be marked PASS; native user prompts/device policy require separate actual Windows evidence.

### Shared component lessons consulted

Index v8 (October6), packaging v2 and desktop-updates v2: PKG-001's measured-artifact lesson applies to verifying real Authenticode output; its Mac ad-hoc flags do not apply to Windows release signing. PKG-002 applies to capturing and independently parsing the UI's actual pre-update backup; its CI-selected save path does not test the native dialog. PKG-003 applies to requiring both stored and settled visible post-upgrade results; no production wait is introduced. UPD-001 requires a total transfer deadline/error cleanup, not only socket timeout. UPD-002 requires the real packaged preload/IPC and keeps fixture transport disposable; neither lesson establishes live service or upgrade acceptance. These consequences inform the proposed matrix; no new upgrade pass is claimed.

### Official sources checked October 9

- [Microsoft signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options): direct signing, individual eligibility, indicative cost, Store alternative and initial reputation warnings.
- [Artifact Signing pricing](https://azure.microsoft.com/en-us/pricing/details/artifact-signing/): billing starts at account creation; numeric localized price requires actual checkout, not a scraped placeholder.
- [Builder v26 Windows signing](https://www.electron.build/v26/docs/features/code-signing/code-signing-win/) and [Auto Update](https://www.electron.build/v26/docs/features/auto-update/): proposed native signed NSIS integration, subject to exact-version verification.
- [Builder v26 NSIS](https://www.electron.build/v26/docs/nsis/): installer identity/configuration; documentation/default behavior is not a preservation test.

## Historical implemented lookup and evidence


Approval: BATCH-2026-10-06, Tyler's “Awesome, put it at the bottom of settings” and “No, just when I click it”. This branch adds the available lookup milestone, not an installer/release pipeline.

The installed Windows app shows **Check for updates** at the bottom of Settings. There is no startup check, timer, background polling, download or installation. Clicking sends only a fixed HTTPS GET for the public stable release metadata at `https://api.github.com/repos/BadgerCraft/StudentOrganizer/releases/latest`. GitHub sees the connection IP and a static application user-agent. No local records, teacher identity, database, report draft, device identifier or application version is sent. Incoming draft/QA/prerelease release tags are rejected. Installed Windows QA identities in the exact `MAJOR.MINOR.PATCH-qa.RUN.ATTEMPT` format are compared by their base version; a stable release at the same version is newer than that QA build. Other prerelease identities fail closed. Network failures and unavailable releases leave the working app untouched.

The renderer cannot supply a URL, request body or arbitrary IPC arguments. The main process verifies the owned window, its top frame and the exact bundled file origin; its fixed request rejects redirects, has a ten-second timeout and a 128 KiB response ceiling. Only HTTPS links to the exact BadgerCraft/StudentOrganizer repository and validated version tag are accepted as metadata. The renderer's existing network-denial policy remains unchanged. The sandboxed preload exposes only the platform and zero-argument check function.

## Installation remains blocked

GitHub release metadata is not a signed installer manifest. A repository URL or an artifact hash obtained from the same unsigned source is insufficient installation authorization. No trusted signed manifest/public verification key, expected Windows publisher identity, approved stable installer channel or actual old-to-new signed installer acceptance has been established. Accordingly no executable URL is exposed, downloaded, opened or run. The available-version message explicitly says installation is unavailable until source/signature verification is established.

The existing app identity (`ca.on.teacher.assessment`, `ontario-teacher-assessment`), `userData` location, database version/schema and restore behavior remain unchanged. This patch does not prove installation-over-existing-records preservation: that requires an approved authentic old/new pair on Windows, a fictional database and backup, and restart/record-count/recovery checks. Portable and installed paths must be tested separately. Do not publish an unsigned release to work around this blocker.

## Verification and limits

Fixture tests exercise stable version comparison, malformed/draft/prerelease metadata, exact destination boundaries, foreign-window/subframe denial, no request before a click, unsupported-platform/no-package denial, concurrent-click deduplication and sanitized error results. No actual release API request, download, release or distribution occurred. Native Windows UI/packaged execution is not available on the Linux cloud machine; add exact-head Windows acceptance to the approved QA checks.

Design references: Electron's current [IPC security checklist](https://www.electronjs.org/docs/latest/tutorial/security#17-validate-the-sender-of-all-ipc-messages) and [contextBridge API](https://www.electronjs.org/docs/latest/api/context-bridge). Direct documentation retrieval was unavailable in this environment; no online documentation fetch is claimed. No new dependency or Electron autoUpdater adoption is needed for a metadata-only check. Shared reuse-component-lessons collection was unavailable; this Settings addition follows existing local section styling without claiming lesson verification.

Observed on this branch: Node v24.19.0; all 197 tests across 24 files passed; production build passed with the existing large-chunk advisory. Headless Chromium Settings flow with an injected Windows bridge confirmed no check on mount, exactly one call after clicking, and the explicit installation-blocked message. That is a shared UI proxy, not native Windows acceptance.
