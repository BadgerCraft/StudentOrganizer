# F-006 — Installed iPad Ad Hoc pilot implementation plan

Prepared: 2026-10-03, America/Toronto  
Status: awaiting revised plan approval  
Feature: F-006 Mac and iPad support  
Decision applied: DEC-005 — Ad Hoc registered-device pilot  
Planning branch: `codex/approved-plan-workflow`  
Current feature source: PR #13, `ac44af3e6ba738937c535fa87f9aa2c35adc4586`

## Key points for review

- Wrap the existing React/Vite application with Capacitor v8 to make an installed iPadOS app whose operational assets are bundled.
- Keep the existing Dexie/IndexedDB database for the first pilot. Changing the app container and database together would increase recovery risk.
- Use explicit iPad Files export and restore for versioned full backups.
- Prove the app works from a cold launch in airplane mode and sends no application traffic during the tested classroom workflow.
- Install the exact signed IPA Ad Hoc on Tyler's registered iPad and use fictional data for the pilot.
- Preserve PR #13's Mac packaging, touch, seat-swap, backup/recovery and local bug-draft work. Remove dependence on its superseded Home Screen/PWA delivery.
- Drawback most likely to affect the decision: Ad Hoc and native iPad packaging require Apple Developer enrollment, a Mac with current Xcode, physical-iPad access and manual signing/install/update work. The technical build can begin without all signing access, but the pilot cannot finish without it.

## Teacher outcome

Tyler can open StudentOrganizer as an installed iPad app, use its classroom workflows without a website or network connection, keep student records and processing on the device, and deliberately move a validated full backup through Files.

The first pilot is intentionally restricted to Tyler's registered iPad. Commercial distribution is a later product phase. Pilot friction for other people is acceptable; Tyler's own classroom workflow should remain straightforward.

## Current evidence and limits

PR #13 already verifies reusable touch/layout changes, occupied-seat swap integrity, full-backup validation and recovery, Mac packages and browser-based stopped-origin reopening. Those checks do not establish an installed iPad app, native file access, iPad sandbox persistence, a signed IPA, physical-device airplane mode or zero network traffic.

PR #14 adds verified fixes for external restored-photo requests, affected teacher-authorized writes and spreadsheet-formula export risks. It targets PR #13 and should be integrated before PR #13's final review.

## Recommended technical route

1. Add Capacitor v8 core, CLI and iOS packages to the existing Vite/React project, using `dist` as the bundled web asset directory.
2. Create the iOS/Xcode project and a native-build configuration. Disable service-worker/PWA dependence in the native build.
3. Keep the current Dexie schema and services in the first pilot's WKWebView sandbox. Treat this as a measured pilot choice and retain the versioned backup format.
4. Connect the existing backup serializer and validator to native Files export plus a first-party iOS document-picker bridge for restore.
5. Restrict native navigation and connections. Bundle fonts, icons, scripts and styles; reject external windows/navigation; audit generated application files and plugins for remote URLs, analytics, crash reporting, remote APIs and update checks.
6. Produce an Ad Hoc archive and IPA for the named device only after the account, certificate, registered device and provisioning profile are available.

## Milestones and completion checks

### 1. Native skeleton

- Build and launch the iPad app from Xcode with all operational assets bundled.
- Prove it launches while the development server and any website are unavailable.
- Preserve existing grading, teacher-selection, Toronto-date, audit and classroom behaviours.

### 2. Local storage and lifecycle

Using fictional records, create a class, seating, attendance, marks, notes and a local photo. Verify exact values after:

- force-close and reopen;
- device restart;
- application update using the next signed pilot build.

Document that deleting the app can delete its sandbox and requires restore from a deliberate backup.

### 3. Native backup and restore

- Export a complete versioned backup through Files.
- Parse and validate the exported file independently.
- Restore into a clean installation and verify record IDs, photos, audits, marks and settings.
- Verify cancellation, corruption and wrong-version failures preserve the prior database exactly.
- Verify recovery after edits and the backup-before-update procedure.

### 4. Closed-loop verification

- Apply a native-build content policy and block external navigation.
- Audit compiled assets and native plugins for remote endpoints.
- Capture network traffic while exercising the full classroom, photo, export and restore workflow; require zero application-originated external requests.
- Repeat from a cold launch in physical-iPad airplane mode.

Apple's installation/provisioning process may use network access. Classroom operation may not require it.

### 5. Physical iPad experience

Verify portrait, landscape and split view; touch/scroll edges; seat movement; keyboard and modal guards; photo selection; Files picker; low-storage failures; backup recovery; and cold reopening. Browser automation remains supporting evidence rather than physical-device proof.

### 6. Exact Ad Hoc artifact

On a trusted Mac with current Xcode:

- register the pilot iPad;
- archive the reviewed source;
- export the Ad Hoc IPA;
- record source SHA, app version/build, signing identity and supported architecture;
- install and verify that exact IPA through relaunch, restart and airplane mode.

Private keys, profiles and device identifiers stay out of the public repository and chat records.

### 7. Pilot handoff

Provide Tyler with install/update, backup-before-update and recovery instructions. Use fictional data until physical-device, closed-loop, privacy and any required board review are complete.

## Preservation constraints

- Preserve PR #13's useful Mac, touch, seat-transaction, recovery and local-report changes.
- Do not publish or depend on the PWA/Home Screen prototype.
- Preserve stable record IDs, audit history, actor attribution, Toronto dates, grade calculations and all-or-nothing restore semantics.
- Safari/Home Screen storage will not automatically appear in the installed native container. Transfer only through validated backup/restore.
- Do not add telemetry, cloud sync, automatic backup, remote AI, automatic student-data upload or a live bug-report receiver.
- No real student data during this technical pilot.

## Verification baseline

The normal baseline is all unit tests and production/typecheck build, followed by:

- exact iOS simulator/native launch checks;
- native lifecycle and backup/restore checks;
- network audit and capture;
- physical-iPad classroom and airplane-mode flows;
- exact Ad Hoc IPA installation and restart;
- Mac and Windows regression checks for shared code.

A passing simulator, browser or Mac check cannot substitute for the physical iPad checks.

## Access and decisions

Revised plan approval authorizes implementation and fictional-data verification through the simulator/native project within existing access. It does not authorize payment, enrollment, credentials, device registration, distribution, merge, release or real-student use.

To finish the physical pilot, Tyler will later need to choose/provide:

1. a Tyler-owned Apple Developer membership or an approved board-owned account;
2. a trusted Mac with current Xcode and signing access;
3. the physical pilot iPad and private device registration;
4. whether the first pilot is Tyler's iPad only, which is recommended, or includes named additional devices.

The next access request should be made only when technical work reaches the signing/device milestone. Do not place private credentials, certificates, keys or UDIDs in this public repository.

## Recommendation

Approve this revised scope as a Tyler-only, fictional-data, Ad Hoc pilot using Capacitor v8, the existing Dexie database initially, explicit Files backup/restore and zero-network proof. Defer commercial distribution, easy multi-user updates and broader device support until this installed pilot is stable.

## Official references checked

- [Capacitor documentation](https://capacitorjs.com/docs/)
- [Capacitor iOS documentation](https://capacitorjs.com/docs/ios)
- [Capacitor Filesystem documentation](https://capacitorjs.com/docs/apis/filesystem)
- [Apple: create an Ad Hoc provisioning profile](https://developer.apple.com/help/account/provisioning-profiles/create-an-ad-hoc-provisioning-profile/)
- [Apple: registered-device overview](https://developer.apple.com/help/account/devices/devices-overview)

## October 3, 12:49 America/Toronto — actual approval and no-fee constraint

Tyler: “Pr14 approved. I don't want to pay for the Apple app. Think of another way.” PR #14 was marked ready and merged into codex/mac-ipad-support at a7c6d941eb704b6f97a41543b6546cebfaccca07 after all four checks for b07651b passed. No main merge or release occurred.

The paid Ad Hoc membership route is rejected for the current pilot. Revised installed-iPad plan remains unapproved. Official no-fee alternative: Xcode Personal Team using a free Apple Account for personal-device testing. Apple documents provisioning expiry after seven days, requiring rebuild/reinstallation; up to three devices and three apps per device. A Mac with Xcode remains required. This retains bundled installed-app/local-processing requirements but is a temporary development pilot, not durable distribution. Ask whether Tyler has access to a Mac before recommending it as workable. Do not silently restore the rejected website/PWA delivery or infer authorization for spending. Source checked October3: https://developer.apple.com/help/account/basics/about-your-developer-account .
