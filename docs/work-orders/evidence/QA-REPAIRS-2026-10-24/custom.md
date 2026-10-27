# QA-03 profile assessment repair

Status: implemented, focused verification PASS; awaiting root integration/final independent review. No commits or pushes by this worker. Existing data (including prior partial records and tombstones) preserved.

Owned files:
- src/services/profileAssessmentService.ts (new)
- src/services/profileAssessmentService.test.ts (new)
- src/components/StudentProfileModal.tsx
- scripts/qaCustomAssessmentSmoke.ts (new; parent owns npm/CI wiring)

Behavior:
- One Dexie write transaction guards actor, opening identity epoch, device, active enrollment, organization/class write authorization, policy and actual open class-term period. Unit/assessment/category/studentAssignment, optional existing markbook score operation, audit and pending sync mutations commit or roll back together.
- Percentage-only input labeled explicitly (88 or 88%); misleading level example removed. Empty score creates assigned/not_assessed work, not a fabricated assessed mark.
- Stable per-form operation ID and atomic audited receipt make same-request retries idempotent. Mismatched payload under an existing ID rejects. Replay does not replace later grading changes.
- Period selection uses live same-term open options but copies suggestion only when opening a form. A scoped valid policy period is preferred; otherwise only a sole period is suggested; ambiguity requires deliberate selection. A period closed during editing rejects rather than silently retargeting. No demo ID fallback.
- Fallback unit code scans retained and live normalized codes (U1/U2/etc), preserving tombstones and choosing an unused code.
- Override wrapper validates identical scope/identity/period and compares the opening override ID/version or explicit absence. Live props cannot silently authorize overwriting a newer override. Existing selection prefills values, conflict is visible inside the active override and preserves edits.
- Pending operations lock inputs/cancel/navigation/settings, guard modal dismissal and disable underlying student transfer; preventing late unsaved edits from being cleared by the older save. Errors remain retryable in place.

Fresh verification:
- `npx vitest run src/services/profileAssessmentService.test.ts`: PASS 7/7. Fresh initializeDatabase + teacher/class/roster (no demo rp-midterm); direct mark and override; full backup restore; invalid-score and injected late-outbox failure exact rollback; same-ID concurrent/repeated retry; read-only blank save denied; stale epoch and mid-write actor switch abort; ambiguous/closed/foreign periods rejected; explicit selection works; legacy policy period accepted; soft-deleted U1 retained with fresh U2; opening override conflict; backed-up receipt replay; replay preserves newer grade; audit/outbox contiguous group evidence.
- `npx tsc --noEmit`: PASS.
- `node --import tsx scripts/qaCustomAssessmentSmoke.ts`: PASS real Chromium profile workflow with production initializer/services/component, fictional records in fresh browser context. Invalid4+ leaves zero records; corrected duplicate form submits create one mark88; delayed service locks inputs and prevents dismissal; override91→external95 rejects stale92 visibly; closed old period cannot retarget to new sole period until chosen; read-only blank score denied; full backup roundtrip; zero page errors/external requests.
- Strict harness TypeScript check: command and result reported to parent separately.
- `git diff --check`: PASS for shared current working tree at check time.

Independent review follow-ups addressed: persistence review found retained-U1 uniqueness collision (fixed/tested), desktop review reproduced pending-input loss and hidden override conflict (fixed with browser regression). No product UI overhaul, calendar migration, cleanup of historical partial records, phone work, release/deployment or live data access.

Root owns broad suite/build/native/platform evidence and final review/PR decisions. Physical Windows/Mac dialog behavior is not established by Chromium tests.
