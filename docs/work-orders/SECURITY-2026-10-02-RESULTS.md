# Local-data security fixes — October 2, 2026

Tyler authorized fixes for the three desktop review findings with “Go for it.” Implementation/checks are authorized; merge/release remain reserved. Base is PR13 head ac44af3e6ba738937c535fa87f9aa2c35adc4586, matching the requested review surface. Review the focused delta against `codex/mac-ipad-support`. Existing installed-iPad scope corrections still apply; no operational website is authorized.

## Behavior

- A shared JPEG/PNG/WebP base64 data-URL and 64 KB policy covers profile saves, full-backup validation and photo rendering. Remote/protocol-relative/local-file URLs, SVG and malformed/oversized data URLs are rejected. Rejected backups preserve every table; missing/null legacy photos remain accepted. Already-stored invalid photos are not rendered or silently deleted.
- Built files have a Content Security Policy restricting resources to the application and local data/blob images. Electron additionally blocks network resources and file resources outside `dist` and limits navigation to its entry document. The build-only policy preserves Vite development refresh. Renderer protections remain enabled; no external report endpoint is introduced.
- Profile writes require an active enrollment the actor can modify in the student's organization, within the same transaction as student/audit/outbox writes. Profiles remain shared across classes. Teacher selection remains attribution, not authentication.
- Assessment create/archive/duplicate and grading-policy saves call authorized domain services. Fresh records, permission checks and all related writes share one transaction with acting-teacher audit/outbox attribution and version checks for existing records. Create queries enrollments internally and validates class units/reporting periods. Duplicate retains existing no-new-student-assignment behavior and uses a unique generated code.
- Class picker and roster summaries follow membership/assignment access. Assigned read-only staff can see their class but cannot edit; unrelated classes are hidden. Form state resets when changing class/policy. This does not encrypt records or restrict operating-system access to a local database.
- CSV formatters prefix formula-leading text with an apostrophe before quoting, including leading whitespace/control characters. Actual numeric inputs remain numeric; numeric grade/participation exports no longer stringify them first. Stored text is unchanged. Spreadsheet re-save/import behavior remains application-specific and untested.

## Evidence

- Complete local Vitest run: 188 tests/22 files PASS (162 baseline plus 26 security regressions).
- Regression coverage: rejected photos preserve every table; supported photo/legacy restore; unassigned/read-only denials; authorized create/archive/duplicate/policy edits; attribution; stale-version rejection; injected audit failure rolls back all tables for create/duplicate/archive/policy/profile; CSV formula text and numeric/escaping preservation.
- Existing second-teacher profile test previously allowed an unassigned teacher edit. It now first asserts rejection/no writes, then adds a legitimate co-teacher assignment and verifies attribution. A photo-sync fixture's ellipsis placeholder was replaced by base64-shaped data; validation was not weakened to accept it.
- Final integrated typecheck/production build and all 188 tests passed locally. Existing >500 KB bundle warning remains; no schema/dependency changes.
- Added a packaged Windows smoke to the existing workflow: disposable profile and loopback collector; loaded CSP; no renderer Node globals; remote-image rejection; independent CSP-free renderer probe of the Electron session policy; zero collector requests; authorized profile save. Existing packaged assessment/restart check remains. The added smoke is not PASS until its CI run succeeds.
- Local browser download returned truncated archives. Electron lacked a functioning display and first-window launch failed. Windows CI is the intended native check, not an inferred local pass. Physical Mac/iPad, Gatekeeper, spreadsheet execution and exhaustive security audit remain unverified.

## Component learning and scope

Consulted installed index v6/database v5 (October 1). DB-003 matches Dexie transaction/uniqueness behavior: preserve existing identities/audit/outbox boundaries and inject failure after writes. Its concrete effect is all-table audit-failure rollback checks including categories and assignments. SQLite-only DB-001/DB-002 were not treated as IndexedDB proof.

Proposed reusable lesson: local-only validation must cover restore and rendering as well as normal uploads. Verified scope is shared validation plus fake-indexeddb preservation checks; native policy evidence is separate. Keep this proposed entry here pending shared-source integration; no competing collection or unverified skill update was created.

These fixes cover three authorized findings. Other direct UI writes and broader read/export authorization remain separate review work; this is not an all-path authorization claim. No merge/release, live sync, cloud AI, external messages or real student records were introduced. No successful plugin scan is claimed.


## Before/after reproduction

A disposable checkout of the original PR13 head ran three direct boundary assertions (remote-photo backup rejection, unassigned profile-write rejection, formula-text neutralization). All three failed on the original source; the identical assertions passed on the patched source. Temporary proof files were removed from the working branch; the retained regressions cover these boundaries plus rollback/authorized behavior. No external image request was made.

## CI evidence at c528414

The Chromium/WebKit classroom/touch/offline/backup flows and report-draft check passed in run 37026724566. Apple Silicon actual DMG/ZIP app/recovery/restart checks passed. Intel Mac and Windows checks were still running at this update. The native security smoke was strengthened to require Electron's ERR_BLOCKED_BY_CLIENT cancellation evidence, in addition to zero collector requests; its final run remains the acceptance check.

## Current source and Store privacy verification — October 9, 2026

Tyler asked “Verify that now” about student privacy with Microsoft Store updates. Reviewed current main `b9a8790f4841fa9fd5057e7cfef097f619cbac4a`, using a bounded independent read-only source review plus coordinator checks. This is a scoped student-content egress/storage review, not a complete security/compliance verdict or real-classroom authorization. No application source/dependencies were changed.

**Current app boundary: PASS within the checks below. Actual Store package: UNVERIFIED, because none exists.** Current package.json supports Windows NSIS/portable; no MSIX configuration, Store identity or installed Store artifact was found.

### Concrete source evidence

- `electron/main.cjs` enables sandbox/context isolation, disables renderer Node, denies foreign navigation/new windows and cancels remote requests at the session layer. `vite.config.ts` adds production CSP including `connect-src 'none'`, no workers/objects/forms, and only local image sources. Fresh `dist/index.html` contains that policy.
- `electron/preload.cjs` exposes only a zero-argument manual update check. `electron/manualUpdater.cjs` makes an explicit-click Windows main-process GET to fixed `https://api.github.com/repos/BadgerCraft/StudentOrganizer/releases/latest`. Only static Accept/User-Agent headers; no classroom payload, query, teacher/device identifiers or request body. GitHub sees the connecting IP. It rejects redirects, limits response/time, and neither downloads nor installs updates. No startup request path was found.
- Student records and marking operate in local IndexedDB; bug reports are local editable drafts, clipboard or downloads, with no configured receiver. The sync-outbox worker uses mock/in-memory transmission and has no production instantiation. No active remote AI, telemetry or student-content sender was found. Unused dependency network capabilities were not counted as actual requests.
- Photo write/restore/display accepts bounded local JPEG/PNG/WebP data URIs; rejects remote/file/SVG sources. TXT/DOCX processing is local, rejects external relationships/DTDs/embedded executable content, and does not render imported HTML. Standalone reports escape content and block scripts/connections/images through CSP.
- Local data and full JSON backups are not app-encrypted. Full backups include all tables, audits and pending outbox records. Deliberate file export does not make an app network request, but a destination synced by OneDrive or another OS service can upload it independently. Teacher attribution is not authentication and local OS access is outside app authorization controls.

### Executed verification and limits

- Fresh `npm ci` completed; focused `npm test -- src/services/securityBoundaries.test.ts src/services/manualUpdater.test.ts src/services/backupValidation.test.ts src/services/bugReportService.test.ts`: **58 tests / 4 files PASS**. These cover photo restore preservation, permissions/rollback, backup validation, manual metadata boundaries and local bug drafts.
- Fresh `npm run build`: typecheck and production build PASS; built CSP inspected. Existing large-bundle/dynamic-import warnings remain unrelated to the egress verdict.
- Retrieved logs for exact-source merged-main [Windows run37973955991](https://github.com/BadgerCraft/StudentOrganizer/actions/runs/37973955991), job113967364555. Its earlier execution passed all289 tests/32 files and `securityDesktopSmoke.ts`: real packaged app/CSP and renderer protections, remote-image cancellation at page and independent CSP-free session layers, zero loopback collector requests, authorized profile save, and real preload/IPC absent/available/error metadata results using substituted ephemeral transport. This supersedes the historical native-smoke-pending statement above. It is prior exact-source Windows CI evidence, not a Windows test rerun in this Linux session; substituted transport does not establish process-wide silence or live GitHub service behavior.
- No native Windows/Store launch was executed in this Linux environment. No real student records, external report transmission, Store account/adoption, signing purchase, installer release or main merge occurred.

### Microsoft policy and remaining acceptance

[Microsoft's current privacy statement](https://www.microsoft.com/en-us/privacy/privacystatement), checked October9, lists Store installation/update/use interactions and account/device information. Its Windows Diagnostics section states optional enhanced crash reporting may include user content in memory. Therefore an absolute “Microsoft cannot receive student content” claim is not supported by this review. Actual Windows diagnostic/backup/managed-device settings were not inspected. Store delivery does not itself establish a student-record upload path in the current source.

[Microsoft's MSIX runtime documentation](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-behind-the-scenes) describes package-specific file-system behavior; it is not proof that our legacy Electron profile is preserved. Before Store acceptance, inspect actual package identity/capabilities and packaged bytes/CSP; run equivalent installed-package privacy checks plus actual outbound observation during fictional-data launch/marking/import/export/update; separate app requests from Store service traffic; verify legacy-to-Store profile discovery or recoverable UI backup/import; install real Store A, populate fictional data, replace with B and verify stored/visible results and restart; test failed/cancelled update recovery and uninstall retention. Review device diagnostics/cloud-backup policy separately. Until then, Store privacy and data-preserving replacement remain open gates, with free-only and release/account approval boundaries intact.
