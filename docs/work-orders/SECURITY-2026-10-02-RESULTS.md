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
- Typecheck/production build passed before adding the desktop smoke; final integrated checks are recorded below after rerun. Existing >500 KB bundle warning remains; no schema/dependency changes.
- Added a packaged Windows smoke to the existing workflow: disposable profile and loopback collector; loaded CSP; no renderer Node globals; remote-image rejection; independent CSP-free renderer probe of the Electron session policy; zero collector requests; authorized profile save. Existing packaged assessment/restart check remains. The added smoke is not PASS until its CI run succeeds.
- Local browser download returned truncated archives. Electron lacked a functioning display and first-window launch failed. Windows CI is the intended native check, not an inferred local pass. Physical Mac/iPad, Gatekeeper, spreadsheet execution and exhaustive security audit remain unverified.

## Component learning and scope

Consulted installed index v6/database v5 (October 1). DB-003 matches Dexie transaction/uniqueness behavior: preserve existing identities/audit/outbox boundaries and inject failure after writes. Its concrete effect is all-table audit-failure rollback checks including categories and assignments. SQLite-only DB-001/DB-002 were not treated as IndexedDB proof.

Proposed reusable lesson: local-only validation must cover restore and rendering as well as normal uploads. Verified scope is shared validation plus fake-indexeddb preservation checks; native policy evidence is separate. Keep this proposed entry here pending shared-source integration; no competing collection or unverified skill update was created.

These fixes cover three authorized findings. Other direct UI writes and broader read/export authorization remain separate review work; this is not an all-path authorization claim. No merge/release, live sync, cloud AI, external messages or real student records were introduced. No successful plugin scan is claimed.
