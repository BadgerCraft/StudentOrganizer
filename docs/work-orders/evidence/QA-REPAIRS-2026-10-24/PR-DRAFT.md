An open Markbook editor could silently replace a newer grade, and older profile/classroom actions could commit records before authorization or score validation. This repair pins editor versions, moves those writes into authorized atomic services, and rejects contradictory backup links before replacing data.

- Preserve an existing/newer mark and unsaved draft on conflict; explicit reopen/review is required.
- Enforce read-only/actor/organization boundaries for class archive, layout creation/controls and individual assessments, with versioned audit/outbox writes.
- Make individual-assessment saves atomic and replay-safe; resolve real reporting periods, retain opening override versions, preserve archived units and protect pending edits.
- Validate canonical identifiers and class/assessment/period/attendance/seating/participation relationships before restore.
- Add three real Chromium regressions to shared CI. No schema migration, data cleanup, UI overhaul, phone-capacity or seating-geometry change.

Validation at implementation `88dc6b5134ab41c81f0991674849279cf172ddf1`: 880 tests passed, one native-only skipped; production and Control Panel builds; strict harness types; new integrity flows; all four authority scenarios; full portability, production archive and classroom browser workflows passed. Independent reviews found and verified repairs for archived-unit collision and pending-edit/error visibility; no remaining concrete blocker reported. Native exact-head CI is pending readback, not claimed passed.

[Full QA report and repair checkpoint](docs/work-orders/FULL-QA-2026-10-24.md) and [repair evidence](docs/work-orders/evidence/QA-REPAIRS-2026-10-24/) contain source references, failures, reproducible tests, remaining limits and the deferred walkthrough.

Rollback: revert source changes and rebuild; no data/schema downgrade. Preserve a complete backup; rollback re-exposes repaired defects. Previously malformed backups/partial records are not silently cleaned. Physical OS/device/power-loss behavior, genuine recognition and live OAuth/Drive remain unverified locally.

Draft for parent/user review. No merge, auto-merge, release, deployment, live-data access or security-setting change authorized/performed.
