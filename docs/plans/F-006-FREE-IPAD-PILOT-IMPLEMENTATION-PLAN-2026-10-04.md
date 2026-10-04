# F-006 — Free installed-iPad pilot implementation plan

Prepared: 2026-10-04, America/Toronto
Status: awaiting Tyler's approval
Current feature source: PR #13 at `a7c6d941eb704b6f97a41543b6546cebfaccca07`

## Key points

- Build an installed iPad app around the existing React/Vite application using Capacitor.
- Use Xcode's free Personal Team signing with a free Apple Account.
- Keep the existing Dexie database for the pilot and use explicit Files backup/restore.
- Bundle all operational assets and verify zero application network traffic.
- Prepare and test the native project before Mac access is available; finish physical installation when Tyler obtains temporary Mac/Xcode access.
- Use fictional data throughout this pilot.
- Main drawback: Apple's free provisioning expires after seven days. The app must be rebuilt and reinstalled through Xcode weekly. The renewal procedure must prove that saved records remain intact or recover correctly from backup.

## Teacher outcome

Tyler gets a real installed iPad app for personal testing without paying Apple. It opens without a website, keeps records and processing on the device, and uses deliberate backup/restore through Files.

This route is a temporary personal pilot. It cannot provide stable distribution to colleagues or customers. Commercial distribution remains a later decision.

## Current evidence

PR #13 supplies tested Mac packaging, touch/layout improvements, seat-swap integrity, backup/recovery and local bug-report drafts. PR #14's security repairs are now integrated into PR #13. Current PR #13 head has successful Windows, browser, Apple Silicon and Intel checks.

The Home Screen/PWA implementation remains prototype evidence and is not the intended iPad delivery. Browser and Mac checks do not prove native iPad persistence, weekly renewal, physical-device offline operation or zero network traffic.

## Implementation scope

### 1. Native project

- Add current same-major Capacitor core, CLI and iOS packages.
- Bundle the Vite production output inside the iPad app.
- Create a native-build configuration that does not register or depend on the PWA service worker.
- Preserve the existing application UI and domain services.
- Verify launch in an iOS simulator with no application website or development server.

### 2. Local data lifecycle

Using fictional records, verify classes, seating, attendance, marks, notes, photos and audit history after force-close/reopen, simulator or device restart, native rebuild, and the free Personal Team renewal procedure.

Keep Dexie/IndexedDB for the first pilot. Changing the application container and database technology together would increase recovery risk.

### 3. Files backup and restore

- Connect the existing versioned full-backup serializer and validator to native Files export and document selection.
- Restore into a clean installation and verify record IDs, photos, marks, settings and audit history.
- Confirm that cancellation, corruption and wrong-version files preserve the existing database.
- Require a verified backup before weekly renewal until preservation through reinstallation is proven.

### 4. Closed-loop verification

- Bundle scripts, styles, icons and fonts.
- Block external navigation and connections in the native build.
- Audit compiled assets and plugins for remote URLs, analytics, crash reporting, update checks and remote APIs.
- Capture network traffic during the classroom, photo, export and restore workflow; require zero application-originated external requests.
- Repeat the full workflow from a cold start in physical-iPad airplane mode.

### 5. Physical iPad checks

When a Mac is available, use Xcode with a free Apple Account to install on Tyler's iPad. Verify portrait, landscape and split view; touch and scrolling; keyboard/modal guards; photo selection; Files picker; low-storage failures; backup/recovery; restart; airplane mode; and seven-day renewal.

Do not place Apple credentials, certificates or device identifiers in GitHub or chat.

### 6. PR #13 reconciliation

Preserve its Mac, touch, recovery, reporting and security work. Remove the retired PWA delivery from the proposed product scope, reconcile overlap with PR #10, rebase on the reviewed main branch and rerun all platform/security checks before requesting a main merge.

## Approval consequence

Approval authorizes Capacitor/native-project implementation, iOS simulator work, fictional-data persistence/backup/network testing available without Tyler's hardware, and preparation of the physical-device installation and renewal checklist.

Approval does not authorize spending, paid Apple enrollment, real student data, merging PR #13 into main, releasing an application, or distributing it to other people.

Mac access remains a later execution dependency. Tyler has said he will try to find access, but access is not yet confirmed.

## Completion standard

Technical preparation is ready for physical testing when the native app launches from bundled assets, automated checks pass, backup and restore preserve records, and the network audit finds no external application traffic.

The pilot is complete only after the exact free-signed build passes physical-iPad installation, offline classroom use, restart, backup/recovery and seven-day renewal tests.

## Recommendation

Approve preparation now. Finding a Mac can proceed separately, so hardware access does not block the native project, simulator checks or privacy controls.

## Official Apple source

[Apple developer account overview](https://developer.apple.com/help/account/basics/about-your-developer-account) documents free Personal Team device testing, limits of three devices and three apps per device, and seven-day expiration of App IDs, devices and provisioning profiles.
