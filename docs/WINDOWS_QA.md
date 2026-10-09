# Windows fictional-data QA

This is a small colleague testing pilot. Use fictional students, marks, notes, and photos only. Real-student use and application release/distribution require separate decisions. Mac packaging has separate verified development evidence; physical device policy remains unverified.

## Current combined-app delivery candidate — October 9

Preparation only; release and distribution are not performed. The merged Organizer/Markinator source is `b9a8790f4841fa9fd5057e7cfef097f619cbac4a`. Its [Windows run 37973955991](https://github.com/BadgerCraft/StudentOrganizer/actions/runs/37973955991) completed successfully. GitHub lists the not-expired artifact `OntarioTeacherAssessment-Windows-1.0.0-qa.185.1`, expiring January 7, 2027. Inspect the bundle's build identity, smoke report, checksums and publisher report before actual delivery; this recovery confirmed availability and CI outcome, not a fresh independent execution of those binary bytes.

PR20's exact-source acceptance also records marking, backup/restore and restart checks. Physical Windows download warnings/managed-device policy and an authentic old/new installer upgrade remain separate acceptance. Back up fictional QA data before changing an existing copy.

A reviewed `qa-v` tag triggers a rebuild and lasting QA prerelease; its own identity and hashes must be checked after that run. Do not equate a rebuilt release with the existing artifact's executable bytes. Settings checks stable releases and rejects QA/prereleases, so a QA prerelease is deliberately installed/tested by the user and will not appear as an available Settings update. Automatic installer download/install/reopen remains unfinished.

### Combined marking route for fictional QA

1. Select a fictional teacher and create/open an assessment. Enter or paste a rubric and explicitly confirm its K/T/C/A mapping.
2. Import a fictional pasted, TXT or DOCX submission and confirm the student match; verify the retained original and preview.
3. Add a passage comment and save a marking draft. Confirm draft work alone leaves official marks unchanged.
4. Reopen the draft after an app restart, finalize explicit category judgments, and confirm the Organizer markbook agrees.
5. Export a full backup. On a separate fictional test profile, restore it and compare original work, passage comments, rubric, final category marks and history.
6. Record build ID, expected/actual behavior and reproduction steps in the local bug-report draft. Central receipt is not connected; copy/download alone is not a sent report.

## Choose and identify your copy

- The `Portable.exe` file runs without installing the app.
- The `nsis.exe` file installs the app and adds shortcuts.
- The filename contains its version and architecture. The amber strip in the app shows the QA version and source commit. Include that strip in a screenshot when reporting a problem.
- `qa-build.json` links to the exact build run. `package-smoke.json` records the checks performed on the actual portable and installed app. `SHA256SUMS.txt` and `windows-files.json` identify the executable bytes and their Windows signature status.

The portable app still saves working data on this Windows account, under `%APPDATA%\ontario-teacher-assessment`. Copying the executable alone does not copy a class or create a backup. The installer and portable copy use the same app data location on the same Windows account. Export a backup before replacing a QA copy; use Import/Export to move data to another computer.

## Windows publisher prompts

These QA builds have no configured signing certificate. Expect an unverified/unknown publisher; Windows may show a SmartScreen warning or a managed computer may block the app. Check `windows-files.json` for the measured signature status. Automated CI launch testing does not reproduce downloaded-file reputation, SmartScreen, antivirus, or school device policy. Report a block and the message shown; do not disable security settings or bypass school IT controls. Publisher verification requires a separate signing setup before wider distribution.

## Short testing route

1. Record the QA build ID, Windows version, and whether you chose portable or installer.
2. Select the fictional teacher and open a class by clicking its card.
3. Open Assessments, create an assessment with a recognisable fictional title, and confirm no Code entry is required.
4. Close the app completely. Reopen the same copy and confirm the assessment is still there.
5. Try seating, participation, and the markbook with fictional records. Record what you expected, what happened, and the steps needed to reproduce it.
6. Export a backup and confirm it is saved. Use a separate fictional test installation/account for a restore test, since restore replaces existing working data.

## Downloads and release approval

Regular GitHub Actions bundles expire after 90 days. For a lasting colleague download, use a reviewed QA prerelease at https://github.com/BadgerCraft/StudentOrganizer/releases. Release assets stay available until deleted; they do not use the Actions artifact expiry.

The workflow creates a prerelease only when an explicitly approved `qa-v` tag is pushed. A PR, merge to main, or manual build does not publish a release. Tag format: `qa-v1.0.0-qa.42.1`. The tag selects the app version; the pipeline rebuilds and tests that tagged source before publishing. Use the release page's version-specific URL when handing a copy to a colleague, so feedback can always refer to the same build.

## Maintainer verification

The Windows pipeline runs the unit suite and production build, launches the actual portable file twice, silently runs the actual installer, and launches the resulting installed app twice. Each app must show the matching build ID, create an assessment through the UI without Code, and retain it after closing and reopening. Screenshots and a report accompany passing bundles. Debugging is enabled only by the test launch argument, not by default in distributed app launches. Tests run only on an ephemeral Windows CI profile.

This proves those flows on the hosted Windows runner. It does not establish signing, classroom approval, all app behaviour, cross-version restore compatibility, or a colleague's device policy.
