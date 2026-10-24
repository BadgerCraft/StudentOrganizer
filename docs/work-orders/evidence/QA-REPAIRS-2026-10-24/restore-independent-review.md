# Independent review — restore graph / classroom structure repair

Reviewed current working-tree diff from `ca9523735325a1b8873ce824f8cf4066b9991da3`; read-only review, no production edits.

**No concrete blocking defect found in the reviewed repair scope.**

- Graph validation runs in validateBackupJSON before restoreFromJSON clears any database table. It indexes the imported graph, not live records. Existing referential existence checks precede graph dereferences, so malformed/missing required targets reject first. The later restore remains one atomic replacement transaction.
- Canonical ID checks now compare the exact IDs that will be stored and reject surrounding whitespace, avoiding prior validate-trim/store-raw mismatch. Normal UUID/deterministic-ID producers do not require padded identifiers.
- StudentAssessment enrollment class and optional redundant class are checked against its assessment. CategoryResult category matches the assignment assessment. Assessment unit, reporting period, grade policy/override/snapshot period, attendance session, seat layout and participation class/session relations are checked.
- Nullable legacy assessment unit/period, missing/null/empty assignment class, and missing/null/empty historical participation session/event-type references remain accepted by the same optional-link rules. Historical audits/outbox entity references are intentionally not treated as live foreign keys. No new tombstone filtering removes historical records.
- Legacy normalization precedes indexing. Existing restore backfills missing assignment class only after the graph establishes that enrollment and assessment agree. Valid schema2/3/4/5 roundtrip and repeated current backup restore are covered.
- ClassroomStructureService uses the current actor/device/epoch guard, in-transaction class authorization, expected versions, atomic audit/outbox and projection of only permitted layout controls. The UI delegates prior direct writes. Auth hierarchy now rejects missing/deleted parents and excessive depth before role grants; ordinary bounded ancestor traversal is preserved.
- Deliberate out-of-scope behavior remains: shrinking a layout does not relocate seats (QA-06), and the restore changes are targeted relationship validation, not a claim of complete validation of every conceivable schema relationship. Existing corrupt installations/backups are rejected without automatic repair; current records remain untouched on rejection.

Independent runtime check:
`npx vitest run src/services/restoreGraphIntegrity.test.ts src/services/portabilityService.test.ts src/marking/legacyBackup.test.ts src/services/classroomStructureService.test.ts`
**PASS 58/58** across4 files. Includes22 graph/legacy cases,24 structure authorization/rollback cases,8 legacy marking backup cases,4 portability cases.

Limits: no native physical backup/power-loss tests or additional live data; UI/browser acceptance owned by structure reviewer/coordinator. No review edits to shared source files.
