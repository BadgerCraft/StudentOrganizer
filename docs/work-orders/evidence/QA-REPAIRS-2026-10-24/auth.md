# QA-02 / QA-07 repair checkpoint

Branch `codex/qa-integrity-repairs-20261024`, base `ca9523735325a1b8873ce824f8cf4066b9991da3`. No commit/push, deployment, credential/live-data operation performed. Shared working-tree changes by other agents preserved.

## Implemented

- New `src/services/classroomStructureService.ts` routes archive-class, four layout metadata fields, and default-grid creation through a single read/write transaction containing authorization tables, device, entity, audit and outbox. It captures actor epoch, subscribes to identity invalidation, checks device ownership and class write authorization, uses expected versions for existing records, increments versions and timestamps, and records before/after audit plus single-entity outbox transaction. Failed permissions, stale writes, attribution failures or identity switches roll back together. Creation rejects an existing active/default-ID layout and preserves tombstones.
- `DashboardView.tsx` archive passes the displayed class version and explicit actor; errors are handled visibly rather than becoming unhandled promise rejections.
- `SeatingChartView.tsx` six direct writes (lock, card size, add/remove row/column) call the service and show denial/conflict errors using existing seating error UI.
- `App.tsx` only the initialization import/callback was changed: explicit identity and service call, visible error handling.
- `authHelper.ts` rejects missing/deleted direct or ancestor organizations before any role-based grant, including admins. Cycles remain denied; hierarchy depth exhaustion now denies instead of authorizing from a partial chain.

QA-06 remains explicitly unresolved/out of scope. Authorized shrink still changes layout dimensions only; no seat relocation, deletion, reseating or geometry repair was added. A dedicated test proves original seat records remain byte-for-byte unchanged through resize. No broader UI overhaul.

## Verification

PASS `npx vitest run src/services/classroomStructureService.test.ts src/services/securityBoundaries.test.ts src/services/domainServices.test.ts`: 66 tests across three files, including 24 new tests.

New coverage: each operation succeeds with exact audit/new record/outbox version linkage; repeat/stale request conflicts with no added mutations; all operations deny read-only/unassigned/guest/suspended/unselected/other-teacher/wrong-device cases without table changes; captured epoch fails after switch-away-and-back; switch during audit rolls back; audit/outbox failures roll back; editable field projection prevents reassignment; missing/deleted direct/parent org, cycle and depth overflow deny even admins and exclude class from read picker.

PASS `npx tsc --noEmit`.

PASS strict standalone harness check: `npx tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution Bundler --esModuleInterop --skipLibCheck scripts/qaClassroomAuthorizationSmoke.ts`.

PASS finalized `node --import tsx scripts/qaClassroomAuthorizationSmoke.ts`: real Dashboard and SeatingChart components plus real browser IndexedDB and fictional records. Read-only archive and all six layout controls preserve full-table snapshot and surface rejection; authorized layout mutation increments version; authorized archive persists with audit; no page errors/external requests. Confirmation/error synchronization uses dialog events, no timing sleep. Ephemeral localhost port/cache and fresh browser profile avoid collisions/private data. Logs: `auth-tests.log`, `auth-types.log`, `auth-harness-types.log`, `auth-browser.log` alongside this report.

PASS `git diff --check` at this checkpoint. Root owns full combined suite/build/independent review and package/CI script wiring.

## Limits / handoff

No new native platform behavior; focused browser harness mounts real components in a Vite fixture rather than a packaged full app. App grid initialization is statically routed through the same service and service allow/deny tested; full App initialization click path not separately driven by this harness. Organization repair makes corrupted/deleted ancestry fail closed; it does not repair/reassign retained records. Existing teacher selector is actor attribution, not OS authentication.

No blockers remain for this owned slice. Parent can independently review service transaction boundaries and validate combined changes. Broader direct writes outside the explicitly assigned paths, and QA-06 geometry, remain separate work.
