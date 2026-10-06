# Manual Windows update check — October 6, 2026

Approval: BATCH-2026-10-06, Tyler's “Awesome, put it at the bottom of settings” and “No, just when I click it”. This branch adds the available lookup milestone, not an installer/release pipeline.

The installed Windows app shows **Check for updates** at the bottom of Settings. There is no startup check, timer, background polling, download or installation. Clicking sends only a fixed HTTPS GET for the public stable release metadata at `https://api.github.com/repos/BadgerCraft/StudentOrganizer/releases/latest`. GitHub sees the connection IP and a static application user-agent. No local records, teacher identity, database, report draft, device identifier or application version is sent. Draft/QA/prerelease tags are rejected. Network failures and unavailable releases leave the working app untouched.

The renderer cannot supply a URL, request body or arbitrary IPC arguments. The main process verifies the owned window, its top frame and the exact bundled file origin; its fixed request rejects redirects, has a ten-second timeout and a 128 KiB response ceiling. Only HTTPS links to the exact BadgerCraft/StudentOrganizer repository and validated version tag are accepted as metadata. The renderer's existing network-denial policy remains unchanged. The sandboxed preload exposes only the platform and zero-argument check function.

## Installation remains blocked

GitHub release metadata is not a signed installer manifest. A repository URL or an artifact hash obtained from the same unsigned source is insufficient installation authorization. No trusted signed manifest/public verification key, expected Windows publisher identity, approved stable installer channel or actual old-to-new signed installer acceptance has been established. Accordingly no executable URL is exposed, downloaded, opened or run. The available-version message explicitly says installation is unavailable until source/signature verification is established.

The existing app identity (`ca.on.teacher.assessment`, `ontario-teacher-assessment`), `userData` location, database version/schema and restore behavior remain unchanged. This patch does not prove installation-over-existing-records preservation: that requires an approved authentic old/new pair on Windows, a fictional database and backup, and restart/record-count/recovery checks. Portable and installed paths must be tested separately. Do not publish an unsigned release to work around this blocker.

## Verification and limits

Fixture tests exercise stable version comparison, malformed/draft/prerelease metadata, exact destination boundaries, foreign-window/subframe denial, no request before a click, unsupported-platform/no-package denial, concurrent-click deduplication and sanitized error results. No actual release API request, download, release or distribution occurred. Native Windows UI/packaged execution is not available on the Linux cloud machine; add exact-head Windows acceptance to the approved QA checks.

Design references: Electron's current [IPC security checklist](https://www.electronjs.org/docs/latest/tutorial/security#17-validate-the-sender-of-all-ipc-messages) and [contextBridge API](https://www.electronjs.org/docs/latest/api/context-bridge). Direct documentation retrieval was unavailable in this environment; no online documentation fetch is claimed. No new dependency or Electron autoUpdater adoption is needed for a metadata-only check. Shared reuse-component-lessons collection was unavailable; this Settings addition follows existing local section styling without claiming lesson verification.

Observed on this branch: Node v24.19.0; all 197 tests across 24 files passed; production build passed with the existing large-chunk advisory. Headless Chromium Settings flow with an injected Windows bridge confirmed no check on mount, exactly one call after clicking, and the explicit installation-blocked message. That is a shared UI proxy, not native Windows acceptance.
