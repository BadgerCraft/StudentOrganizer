# QA-01 — Markbook editor concurrency repair

Branch: `codex/qa-integrity-repairs-20261024`, base `ca9523735325a1b8873ce824f8cf4066b9991da3`. No commit/push performed.

## Change

- `src/components/MarkbookView.tsx`: capture assignment/result IDs and versions when opening the editor, or explicit null when absent. Submit that preserved baseline instead of reading refreshed live-query versions at Save.
- `src/services/markbookService.ts`: optional `SaveMarkbookCellParams.expectedCellState` adds strict opening-state checks inside the existing transaction. Null requires continued absence; existing baselines require the same ID/version and live record. Parent mismatch rejects before writes. Result mismatch throws within the transaction, rolling back any preceding parent update. Omitting the new parameter retains existing callers' behavior; other markbook methods unchanged.
- Conflict message preserves visible unsaved entries and directs explicit cancel/reopen/review. No UI redesign or score-conversion changes.

## Verification

- `npx vitest run src/services/markbookConcurrency.test.ts src/components/MarkbookView.test.tsx`: PASS 10/10. Five new service tests cover stale existing scores/feedback, competing first creation, competing result without parent-version update, deletion/replacement with equal version, successful reviewed/absent states and omitted-baseline compatibility. Failure assertions compare every table, including audits/outbox, before/after.
- `node --import tsx scripts/qaMarkbookConcurrencySmoke.ts`: PASS both real Chromium cases. Existing mark and originally absent mark editors remain open while authorized service writes trigger actual App live-query refresh. Save rejects, newer score/feedback/audit/outbox remain byte-for-byte equal, and local unsaved feedback remains visible. Cancel/reopen shows current90%; explicit edit to85% saves against the new baseline. Script retained in repository; root owns package script/CI integration.
- `npx tsc --noEmit`: PASS.
- Strict standalone harness TypeScript check: PASS with ESNext/ES2022/Bundler, esModuleInterop, skipLibCheck, react-jsx.
- `git diff --check`: PASS at completion check.

Browser log: `/tmp/studentorganizer-repairs/markbook-browser.log`. Full suite/build and integrated repair verification belong to coordinator. No native/physical-platform acceptance claimed. No remaining QA-01 blocker.
