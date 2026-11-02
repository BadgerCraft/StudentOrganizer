# QA06 seating integrity repair — 2026-11-02

Base: 94851bf2d668d85a33672b688e24c6a9f275eaf5, isolated /workspace/StudentOrganizer-qa-followup, codex/qa-capacity-seating-20261102. No commit/push; root integrates. Only owned code: SeatingChartView.tsx, classroomStructureService.ts/.test.ts, scripts/qaSeatingResizeSmoke.ts.

## Reproduction and change
Before product edits two new real Dexie regressions failed: occupied final row and occupied final column shrink succeeded (24 existing tests passed). before.log preserves this. Old-service Vite transform browser also failed the expected rejection after dimensions changed to2; browser-before.log and before-shrink.png. The latter uses current warning UI with baseline service, so is behavioral service regression proof, not a screenshot of wholly unchanged main.

classroomStructureService.ts lines80–101: identity/authority/version checks remain; seatPositions now participates in the same read/write transaction as layouts. Any live seat beyond a proposed reduced axis blocks before layout/version/audit/outbox writes. No relocation/deletion and no tombstone cleanup. Concurrent service seat placement and shrinking serialize on the shared tables. Empty edges remain removable, expansions remain allowed for recovery. Metadata projection unchanged.
SeatingChartView.tsx lines240–251: persistent warning names stored assignments outside grid and their one-based coordinates, explains expansion recovery. Ordinary occupied-edge rejection is already rendered by the existing visible error flow. Accepted PR49 layout and controls preserved.

## Evidence
- Focused suite44/44 passed: classroomStructure33, seatingSwap3, rosterSeating8 (tests.log).
- Included both axes occupied denial with complete all-table snapshot preservation; tombstone-only empty edge successful shrink without deletion; both competing operation orders on both axes; read-only denial; existing identity/ancestry/rollback/version protection tests.
- Application tsc and strict standalone script tsc passed (types.log, harness-types.log).
- Real Chromium component workflow passed (browser.log): both occupied-axis failures retain all tables; real tap move followed by both shrinks preserves primary seat/enrollment identity; exactly two layout audits/outbox entries/version3; legacy hidden seat remains stored and named, expansion reveals it without changing seat records; read-only controls reject; zero browser errors or external traffic.
- Screenshots visually reviewed: occupied-edge-rejected.png and legacy-seat-recovery.png. moved-then-shrunk.png also saved.
- git diff --check passed.

## Applicability and limitations
DB-003/004 database lessons v6: same Dexie occupied-only table and immediate unique indexes; guard adds no delete/reinsert, ignores tombstones for occupancy but preserves them. Tested existing swap/populate regressions and full snapshot rejection. PKG-003 packaging lesson v3: bounded real visible Grid/name/alert waits supplement persisted version/coordinate assertions; no fixed sleeps or production delays.
No physical Windows/Mac run or teacher acceptance asserted. No live data, encryption, publishing, merging, releasing or deployment. Root owns full suite/build and independent review. Malformed negative-coordinate/inactive-enrollment rows now receive specific text that expansion cannot reveal them; real browser checks cover both warnings. Ordinary shrink-hidden active seats are covered and recoverable by expansion. Final screenshots copied to docs/work-orders/evidence/QA-FOLLOWUP-2026-11-02/seating/.
