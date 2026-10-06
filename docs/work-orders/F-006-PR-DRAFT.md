# F-006: prepare the free installed-iPad pilot

Target branch: `codex/mac-ipad-support`
Implementation branch: `codex/f006-installed-ipad-pilot`
Create as **draft**. No main merge or release authorization.

The approved iPad product must run as an installed app using bundled assets and local records. This change replaces the retired PWA delivery with a generated Capacitor 8.5.2 iOS project, connects full backup/restore to the native Files picker, and adds web/native connection and navigation restrictions. Existing Dexie schema, recovery transactions, Mac/touch work, local report drafts and PR #14 security repairs remain intact.

Native Files selections still pass the existing versioned validator and explicit replacement confirmation. Cancellation and read failures leave the database untouched. The app keeps a stable identifier/origin and blocks both web requests and direct native HTTP calls; web asset-path mutation is denied. Installation, physical acceptance and free Personal Team seven-day renewal steps are documented.

Validation:

- Node 24.19.0; frozen npm install, 191 tests / 23 files, production build, native asset sync and static bundle/config/target audit passed.
- Chromium shared-UI proxy passed touch/classroom/photo/marks/audit, full 35-collection backup round trip and fresh-profile restore, cancellation/invalid/future-version protection, browser restart and local report drafts. Zero external requests observed in that browser flow.
- Independent local report quota/clipboard/reload/download smoke passed.
- WebKit download blocked by network policy; NOT RUN.
- Windows package check blocked by missing Wine; Mac package check blocked by missing macOS sips. Existing supported-platform workflows retained; this commit's platform checks remain pending.
- Native Swift compile, WKWebView/Files execution, iOS simulator, physical iPad, airplane mode, low storage and seven-day renewal NOT RUN: Linux has no Xcode or device. Browser/static evidence does not establish those outcomes or completion of the installed pilot.

Approval: Tyler's October 5 “Sure approved”; [work order and evidence](docs/work-orders/F-006-2026-10-05.md). No spending, hosting, real student data, main merge, release or distribution performed. PR #10/#11 reconciliation remains separate before future main integration.
