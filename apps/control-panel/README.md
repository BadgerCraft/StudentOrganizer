# Student Organizer Control Panel

A separate owner-facing Electron executable for Tyler, with update approval/delivery preparation and a permanently labelled fictional dashboard. Teacher settings remain teacher-controlled. There is no telemetry collector, teacher database access, student record payload, account management or publishing client.

From the repository root (Node24, `npm ci`):

```sh
npm run control-panel:start
npm run control-panel:dev             # browser layout; native actions are inert
npm run control-panel:package:win     # never publishes
npm run control-panel:package:mac     # never publishes
npm run test:control-panel:browser
node scripts/audit-control-panel-package.cjs
# On an appropriate disposable Windows/Mac runner, after packaging:
node --import tsx scripts/controlPanelNativeSmoke.ts /path/to/packaged/executable /path/to/CI-unsigned-NSIS-fixture
```

Separate app ID: `ca.badgercraft.studentorganizer.controlpanel`. Default profile: `appData/StudentOrganizer-ControlPanel`; outputs: `release/control-panel`. Only one instance owns a profile. Standard `--user-data-dir` supports disposable test profiles; never point it at a teacher profile. The shell excludes inherited root dependencies and bundles only its UI, built-in-module helpers and shared update contracts. Mac packages remain unsigned/not notarized; automated launch is not Gatekeeper or distribution acceptance.

## Approve exact tested bytes

1. Build the Student Organizer Windows NSIS installer for the selected stable version (the real application version and filename must match, e.g. use the existing package command with `--config.extraMetadata.version=1.0.2 --publish never`), then create its descriptor:

   ```sh
   node scripts/prepare-update-candidate.cjs \
     /path/to/OntarioTeacherAssessment-1.0.2-x64-nsis.exe \
     1.0.2 x64 SOURCE_COMMIT_40_LOWERCASE_HEX /path/to/new-candidate.json
   ```

   The helper hashes the file and exclusively creates a new descriptor. It never runs or uploads anything. Stable versions and x64/arm64 identities are validated; arbitrary executable URLs are rejected.
2. Import the descriptor and select that installer in the separate console. Filename, size and SHA-512 must match. Failed/cancelled import preserves the previous record. New import resets verification/approval.
3. Actually test the exact bytes, including package identity, backup, deliberate install, reopen and recovery. Enter specific evidence and attest it was performed. Recording a note does not run these tests or establish reproducible build provenance. The file is rechecked before storing **tested** state.
4. Choose **Approve locally**. The exact file is rechecked and the **approved** record is saved atomically. State transitions are candidate → tested → approved → revoked. Reimport to retest after approval/revocation.
5. **Export local preview feed** is a separate diagnostic option. These snapshots say `local-preview-only` / `publicationReady: false`, cannot authorize live discovery, and contain no executable paths or URLs.

Hashes identify bytes; they do not establish publisher identity or prove the binary was built from the declared source. Source/test notes remain owner attestations. Keep them free of personal data.

## Prepare delivery, without publishing

On **Windows**, choose **Prepare publication folder** after local approval. The production main process:

- Rechecks the original file, performs real Windows Authenticode inspection and rejects invalid signatures. Signed installers record their exact verified publisher. Existing unsigned-install support is preserved: unsigned preparation requires a fresh explicit owner acknowledgement, and teachers must still explicitly acknowledge unsigned installation. Neither console nor updater calls unsigned files publisher-verified.
- Copies the exact installer into a new local folder, verifies the copy, and writes matching `latest.yml`, `student-organizer-approval-ARCH.json`, and publication instructions. Failure removes its own staging directory, preserves source/state and produces no ready folder.
- Includes the approved artifact identity, source commit, verification notes and approval time. It uses no token, release API, server, signing key or upload. On Mac it refuses preparation because Windows signature inspection is unavailable there; local approval/dashboard still work.

This produces a **publication preparation**, not a published release. After separate authorization, a publisher must create a stable release in **BadgerCraft/StudentOrganizer**, tag `vVERSION` at the exact approved source commit, and attach the exact installer, `latest.yml` and approval JSON from that folder. Do not rebuild or substitute the installer afterward. This bounded single-file Windows channel supports one architecture per release; publishing both architectures needs a separate channel design. This PR does not publish any release or add publishing credentials.

## Student Organizer discovery and installation connection

The existing explicit **Check for updates** now checks the fixed GitHub repository for an approval-bearing stable release. Missing approval means no offer; malformed or mismatched approval fails closed. The lookup validates repository/asset origins, stable tag, source metadata and asset size, resolves the actual lightweight/annotated Git tag to the approved commit, and rejects candidate/tested/revoked/preview records. Approval transport is fixed-origin, GET-only, credential-free, byte-limited and time-bounded; asset redirects are limited to GitHub's HTTPS release CDNs. No local records or device identifiers are sent.

Before downloading an installer, the existing updater independently obtains approval for the exact version reported by electron-updater and compares version, architecture, filename, size and SHA-512. A manual-check/download race therefore cannot substitute a different artifact. After download and again immediately before execution, the native signature must match the approved unsigned/signed policy and, if signed, the approved publisher. Existing hash checks, backup validation/readback, deliberate unsigned acknowledgement, explicit installation, cancellation and failed-launch preservation remain active. No renderer-selected executable URL or silent installation is added. The Download button is offered only for an available approved version.

The connection is implemented and testable without publishing: local integration prepares actual files, serves an isolated fixture release, exercises approval/tag/manifest lookup, checks real downloaded bytes, writes a real recovery backup and invokes a controlled launcher double. Fixture executables are never run. Native owner smoke uses the actual package, preload and IPC, with automated file-dialog result selection. The Windows replacement harness retains real downloader/hash/signature/backup/installer behavior while its test-side transport supplies matching approval/tag fixtures.

**Activation still pending:** no real stable release has been published here; the latest endpoint was404 at the initial checkpoint. The new checker will not offer legacy releases lacking approval metadata. An already installed old binary cannot acquire the new gate until updated. Real source/test approval, distribution choice, signed publisher setup if desired, final release publication and physical OS acceptance remain separate. No new credentials/permissions/services are created. There is no live end-to-end distribution claim.

Local revocation stops further preparation/offers from that local state. Old exported/prepared folders are independent snapshots; discard them after revocation. For a published release, removal/withdrawal of approval assets is an explicit separate publication operation, not a remote action performed by this console. Already downloaded bytes do not acquire automatic remote revocation. No automatic rollback or downgrade is introduced.

## Fictional dashboard

Every teacher, use count, mark and operation is invented, with a fixed displayed as-of date. No importer, SDK, ingestion endpoint or collection path exists. Renderer CSP blocks connections; the separate Electron session also blocks network access.

- Meaningful active teachers: at least one completed marking workflow in trailing28 calendar days, including as-of day. App opens are excluded.
- Activation: first completed marking workflow; denominator is all fictional starts by as-of date.
- Return cohorts: activation month; another completion on days7–13 or28–34. Only fully elapsed windows enter denominators. Counts are teachers, not sessions.
- Repeat adoption: active teachers with at least two distinct course/title pairs since starting. Title reuse increases workflow use, not distinct assignment identity. Real title changes would need an agreed stable identifier.
- Assignment usage: completed workflows by fictional teacher/course/title in the28-day window, not student counts.
- Reliability: initial save attempts, failed initial operations, once-retried operations and successful retries by version for the same fictional period.
- Marks: workflow-weighted assignment aggregate means and latest class aggregate per teacher/course. These are context, not student-weighted comparisons, teacher rankings or investor evidence.

Real participation/consent/reporting and account/feature controls remain deferred.

## Evidence and remaining limits

See [the work order](../../docs/work-orders/CONTROL-PANEL-2026-10-20.md) for exact measured heads and CI links. Windows x64 and Mac arm64 baseline packages actually launched with production sandbox and real bridge; restart, second instance, artifact rejection, corrupt-store retention and teacher-profile isolation passed. The expanded delivery implementation passed Windows x64/Mac arm64 native owner smoke at `fb30cefe`; real Windows NSIS replacement/recovery/legacy-bootstrap checks also passed with the approval gate. Exact run links and source heads are in the work order. Automated dialog selections are not physical picker acceptance; unsigned cloud launch does not prove Gatekeeper, UAC, installer shortcuts, managed policy, real publisher setup or live distribution. PR remains draft and unmerged.


## Query-backed fictional analytics (stacked analytics PR)

The **Analytics pipeline** tab now starts empty and queries stored summary events. Grant fictional-session consent and run the local simulator, or import validated CLI collector event exports into the matching Demo/Measured-test source. Academic snapshots stay withheld until explicit fictional preview and configured suppression checks. Withdrawal purges the local selected source and blocks teacher replay; independent exports need separate removal. This does not activate real analytics, a sender, accounts or secured hosting. See [pipeline guide](../../docs/analytics/README.md) for exact definitions, simulator commands, boundaries and recovery limits. The original hand-authored dashboard module remains a historical fixture/test reference and is no longer the rendered data source. Update preparation behavior is unchanged.
