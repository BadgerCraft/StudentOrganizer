# Installed iPad personal pilot — F-006

Tyler approved the [free installed-iPad plan](plans/F-006-FREE-IPAD-PILOT-IMPLEMENTATION-PLAN-2026-10-04.md) on October 5, 2026 (“Sure approved”). This replaces the earlier Home Screen/PWA delivery. No hosting, paid Apple account, real student use, release, distribution, or main merge is authorized. Historical PWA evidence remains in Git history; it is not native iPad evidence.

## Development and identity

Use Node.js 24, `npm ci`, `npm run ios:prepare`, then `npm run test:ipad:assets`. Capacitor core/CLI/iOS are pinned to 8.5.2. The native project was generated with `npx cap add ios` (default Swift Package Manager template); do not regenerate it over the custom Swift sources. `ios:prepare` rebuilds and synchronizes bundled assets/configuration. Never run a live-server configuration for the pilot.

The app ID `ca.on.teacher.assessment`, iOS origin `capacitor://localhost`, and database name `OntarioTeacherAssessmentDB` must remain stable. Dexie and the existing database/recovery schema remain unchanged. A browser database is a different storage context; explicitly transfer a validated backup when necessary. Records and local report drafts remain on the device; reports are not sent centrally.

Run `npm test`, `npm run build`, and `npm run test:ipad:browser`. A local system Chromium can be selected with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`. For WebKit set `IPAD_TEST_BROWSER=webkit` and install a matching verified Playwright runtime. Browser checks measure shared UI and persistence in that browser; they do not prove WKWebView, native Files, signing, restart, or renewal.

## Data and network boundaries

The signed app contains Vite assets. No website, service worker, remote update loader, telemetry, or remote student-data API is needed. Production CSP denies connections/workers and external resources. Native startup adds a WebKit network content rule before loading; failure leaves the application unloaded. Navigation accepts only the stable bundled origin, new windows are refused, direct Capacitor HTTP bridge calls are rejected, and asset-path mutation APIs are rejected. Native bridge logging is disabled. These controls require native runtime testing before claiming zero iPad traffic.

Full-backup export invokes the native Files picker. Import selects JSON, runs the unchanged versioned validator, shows the existing replacement confirmation, then uses the existing atomic restore. Cancellation/read failure does not replace records. Protected temporary export files are cleaned after completion/cancellation. Save backups to **On My iPad** for device-local retention. A user-selected cloud Files provider can transfer a backup; this is a deliberate user action, not background application sync. Backups are unencrypted JSON containing records and must be protected. CSV/photo picker handoffs on WKWebView remain physical-device checks.

## Mac/Xcode simulator handoff — NOT RUN here

Requires macOS, Xcode 26 or later, iOS 15+ runtime, and a compatible simulator. The exact current Capacitor requirements were checked against the official docs repository at `77a828931a9a7d622f3efc3179ac6c64682c2f23`, notably `docs/main/updating/8-0.md`, `ios/custom-code.md`, and `ios/viewcontroller.md`. Website access was denied; official repository reads succeeded.

1. Check out the implementation commit, run `npm ci`, `npm run ios:prepare`, and `npm run test:ipad:assets`.
2. Open `npm run ios:open`. Resolve the generated exact-version Swift packages. Select App and an iPad simulator. Build without a development server. Alternatively use `xcodebuild -project ios/App/App.xcodeproj -scheme App -sdk iphonesimulator -configuration Debug -derivedDataPath /tmp/student-organizer-ios CODE_SIGNING_ALLOWED=NO build`.
3. Launch from bundled assets and select the fictional demo teacher/class. Verify portrait/landscape/split view, keyboard and modal guards, touch seat swaps, attendance, marks/notes/local photos, and report drafts. Record the exact source SHA, Xcode/runtime versions, executed test counts and failures.
4. Save and inspect a full backup via Files, then restore into a separate clean simulator installation. Compare every collection, IDs, photos, settings and audit history (the existing legacy label/name backfill is expected). Try picker cancellation, corrupt JSON, future schema version, read/write failures, and canceled replacement; compare unchanged original records.
5. Force-close/reopen, restart simulator, and rebuild/update without uninstalling. Compare records. Capture external application requests during cold launch, classroom/photo/export/restore; require zero. Explicitly attempt fetch/XHR/WebSocket, remote images/navigation/window.open, direct CapacitorHttp calls, and WebView path mutations; require denial without an external request. Separate OS/provider traffic from application traffic.

## Physical installation and seven-day renewal — NOT RUN here

1. Use a free Apple Account with Xcode Personal Team on a Mac; never put account credentials, certificates, identifiers, or profiles into Git/chat. Do not enroll in a paid program. Enable required device development trust/mode locally, select the physical iPad and install from Xcode. If Apple requires a materially different account/service decision, stop.
2. Record the exact source/build, iPadOS, Xcode and fictional acceptance results locally without publishing device identifiers. Repeat the simulator classroom/persistence/recovery cases on hardware; verify Files and local photo selection, airplane-mode cold launch, force-close/reopen, restart, low-storage/export/read failures, touch/keyboard guards, and zero application traffic. Do not interpret browser successes as these results.
3. Before each renewal, export a current backup to On My iPad, verify it by restoring into a separate fictional test installation and comparing records, and keep a protected additional deliberate copy if needed. Free Personal Team profiles expire after seven days. Rebuild/re-sign the same stable app ID/team and install over the existing app without deleting it or clearing data. Verify records after renewal. If signing forces removal or identity change, stop until the verified backup and recovery path are available; reinstall preservation is not yet established.
4. The pilot is complete only after the exact free-signed build passes physical offline/restart/Files/recovery/renewal checks. No simulator/device result or ongoing seven-day renewal is claimed by this Linux task.

## Platform evidence

See [execution evidence](work-orders/F-006-2026-10-05.md). Existing Mac packaging and security-repaired desktop configuration are preserved. Current Windows/Mac package checks require their actual supported runners; neither shared UI tests nor prior PR #13 checks validate this new commit's packages. PR #10/#11 reconciliation and main integration remain separate review work.
