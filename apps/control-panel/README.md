# Student Organizer Control Panel — Stage 1

Separate owner-facing Electron executable for Tyler. Teacher settings remain teacher-controlled. This is a **local preparation prototype**, with a permanently labelled **fictional-data dashboard**. Nothing is collected from an installation. No student records, individual marks, essays, photos or authentication controls are included.

From the repository root (Node24, `npm ci`):

```sh
npm run control-panel:build
npm run control-panel:start
# Browser-only layout preview; native approval actions are unavailable:
npm run control-panel:dev
# Local installers, never publication:
npm run control-panel:package:win
npm run control-panel:package:mac
node scripts/audit-control-panel-package.cjs
npm run test:control-panel:browser
```

Separate app ID: `ca.badgercraft.studentorganizer.controlpanel`. Default profile: `appData/StudentOrganizer-ControlPanel`; outputs: `release/control-panel`. It never opens Student Organizer's teacher profile, IndexedDB or settings. Only one instance may own its profile. Standard `--user-data-dir` supports disposable test profiles; do not point it at an existing teacher profile. Windows NSIS identity and Mac bundle identity differ from Student Organizer. Mac builds are unsigned (`identity: null`), not notarized, and may be blocked by macOS. No publisher credentials or keys are configured. Package configuration checks do not prove actual native launch.

## Local approval workflow

1. Prepare a descriptor for an already built **Student Organizer Windows NSIS installer**, with its exact stable version, architecture (`x64` or `arm64`) and source commit. The helper reads bytes, computes SHA-512 and exclusively creates a new JSON file; it never runs or uploads the executable:

   ```sh
   node scripts/prepare-update-candidate.cjs \
     /path/to/OntarioTeacherAssessment-1.0.2-x64-nsis.exe \
     1.0.2 x64 SOURCE_COMMIT_40_LOWERCASE_HEX /path/to/candidate.json
   ```

2. Launch the separate console. Import the descriptor, then select the installer. Filename, byte count and SHA-512 must match. Unexpected fields (including URLs) are rejected. Importing another candidate resets verification/approval. Cancelling or failed validation preserves the previous record.
3. Actually test those bytes on a disposable machine, including package identity, deliberate update/backup, reopen and recovery. Record specific evidence and attest it was performed. The console rechecks the file, then saves **tested** state. Source commit and notes are owner attestations, not cryptographic proof of build provenance or automated test execution.
4. Choose **Approve locally**. The exact bytes are rechecked and the owner profile stores **approved** state atomically. This records preparation only; it does not publish, download or execute anything. Signature/publisher remains **unverified**.
5. **Export local preview feed** saves a JSON snapshot marked `mode: local-preview-only` and `publicationReady: false`. It includes metadata and test evidence, no executable path, executable URL, credentials or installation data. Keep notes free of personal data. Export does not change the live update source.
6. **Revoke local approval** prevents subsequent local preview offers/exports. Old exported files are independent snapshots and must be discarded manually. This is not remote revocation. Reimport to retest after approval/revocation.

Approval states: candidate → tested → approved → revoked. Candidate/tested/revoked, wrong-architecture and non-newer versions are not offered by the **local adapter**. Approved records and artifact metadata are strictly validated on reload and transitions. Artifact contents are rechecked before test evidence, approval and export. Files missing or changed after restart cannot be approved/exported. This owner-local record is editable by the machine owner and is deliberately **not** a distribution trust root.

## Update integration and unavailable live setup

`electron/updateApproval.cjs` is the shared preparation contract. `previewOffer` translates an approved snapshot into the existing checker's GitHub release shape and the existing NSIS validator's single-file manifest shape. Only fixed repository release-page destinations and expected NSIS filenames are generated. It rejects live mode; there is no production feed toggle, localhost server or arbitrary executable URL setting. Unit integration uses local fixture metadata and updater doubles, including a failed backup that never invokes the installer launcher.

**Student Organizer's live updater is unchanged and does not read or enforce these local approvals.** Its manual check still uses the fixed `BadgerCraft/StudentOrganizer` latest stable release, while installation keeps the existing SHA-512, native signature inspection, backup/recheck and explicit user confirmation path. Existing unsigned handling is not weakened or changed. Approval in this console will **not** make a teacher's Check for updates discover anything. Tests of “unapproved not offered” apply to the local preview adapter only.

Observed October20: the latest stable GitHub endpoint returned404. There is no approved stable feed/publisher/signing setup in this batch. Before live updating can be claimed, a separately authorized design must bind owner approval to publication of tested, signed artifact bytes and update metadata, define trusted publisher/signature enforcement and rollback/revocation policy, and test discovery → backup → deliberate install → reopen/recovery on real Windows. Host/account/signing-key choices remain reserved. No server, new credentials, release or deployment is created here. Mac update installation is outside this increment; the existing checker is Windows-only.

## Fictional dashboard definitions

The fixed as-of date and every number are displayed as fictional. There is no data importer, analytics sender, server endpoint or collection SDK. The renderer's CSP blocks connections; Electron's isolated owner session blocks network requests independently. The only native inputs are owner-selected candidate metadata/installer and evidence notes.

- **Meaningful active teachers:** at least one completed marking workflow in the trailing28 calendar days, including as-of day. Merely opening the app is excluded.
- **Activation:** first completed marking workflow; all fictional starts by as-of date form the cumulative denominator. No claim about real installations/conversion.
- **Return/cohorts:** month of activation; completion on days7–13 and28–34 after activation. Only fully elapsed windows contribute to denominators, so recent teachers are not treated as churned. Counts represent teachers.
- **Repeat assignment adoption:** active teachers with at least two distinct course/title pairs used since starting. Title reuse adds workflow uses without adding another assignment identity. There is no stable assignment ID in this intentionally small fictional model; real title changes would need an agreed identifier design.
- **Assignment use:** completed marking-workflow counts by fictional teacher/course/title in the28-day window, not student counts.
- **Reliability:** initial save operations, failed initial operations, operations retried once and successful retries, by version, for the same fictional28-day period. Failure-rate denominator is initial attempts.
- **Marks:** workflow-weighted means of fictional assignment aggregates, plus latest class aggregate per teacher/course. They are not student-weighted comparisons, teacher rankings or proof of adoption. No student-level payload is present.

Real participation/consent/reporting and account/feature access are deliberately deferred until actual-account and privacy design are authorized.

## Verification limits

The browser smoke uses the production UI, first without a bridge (inert native actions), then with a fictional native-bridge double backed by the real pure state contract. It verifies labels, tables, metric denominators, approval transitions and zero external requests; it does not prove native dialogs or installed executable behavior.

The package audit resolves electron-builder configuration and optionally inspects actual packaged `app.asar` plus byte-exact shared contract resources. The PR-only Windows/Mac workflow builds without publishing and audits these files; a configured job is not a measured pass. Physical Windows installer/shortcuts, isolated profile/restart, second-launch lock, native dialogs, macOS launch/Gatekeeper and installer preservation remain native acceptance checks. See the work order for actual measured results and blockers.
