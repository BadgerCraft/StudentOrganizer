# Student Organizer encryption integration — staged implementation

Authority: Tyler approved encrypted working data, backups and personal-computer transfers, independent per-app keys, trusted-device automatic unlock and an offline recovery code. Development uses fictional data and synthetic keys. Actual user activation, credential provisioning, real-device enrollment acceptance and any new PR merge/release/deployment remain separate.

## Stage 1: implemented substrate

`src/security/encryptedWorkspace.ts` integrates the shared `shared/encryption` contract into a memory-only workspace session. It is not enabled in the existing App and does not relabel persistent Dexie storage as encrypted.

- `EncryptedWorkspaceStore` reads an encrypted checkpoint and atomically compare-and-swaps a new revision. Native implementation owns fixed paths, durable writes and access checks. Commit must resolve only after durable success.
- `EncryptedWorkspaceSession.open` authenticates and validates the encrypted workspace before exposing a defensive memory copy. It never accepts plaintext or falls back to existing storage.
- `transact` serializes edits, validates an isolated candidate, encrypts it and commits before publishing/acknowledging the new state. Caller references and key/scope mutations cannot alter committed state. Reads during pending writes retain the preceding committed state.
- A stale/failed/uncertain commit locks and clears the session. Queued edits do not replay. Reopening reads/authenticates the actual durable revision; an upload/write reply lost after commit does not cause an automatic repeat.
- Encrypted backup and transfer exports use separate authenticated purposes and caller-provided non-sensitive stable identities. No grade conversions or authority rules are introduced.
- `WorkspaceMigration` requires actual recovery-code unwrap/key comparison and a fresh distinct-device possession challenge response. Boolean acknowledgments cannot satisfy either check. An old challenge or wrong device identity is rejected. These proofs establish key possession, not that a second physical computer has passed native acceptance.
- Conversion rechecks the complete source digest while the consumer holds an all-writer read lock and writes a new target only. It never modifies/deletes the source. Existing encrypted targets cannot be overwritten. Failed/uncertain conversion closes the ceremony; resume by inspecting the durable target rather than replaying writes.

The source adapter contract must freeze **every** source writer for capture and conversion, including both databases and local comment banks. A normal Dexie transaction does not freeze localStorage or a separate recovery database. There is deliberately no default adapter claiming this protection.

## Acceptance evidence

Synthetic unit coverage exercises records, inline attachment strings, recovery snapshots and comments through encryption, restart and export; actual recovery/device possession gates; stale source/target/challenges; serial edits; pending commit visibility; retained-draft and scope mutation; copied keys before async reads; stale writers; failed/uncertain commits and queued replay suppression; tampered ciphertext/plaintext rejection; cross-app/purpose separation; close during pending edit.

Independent review reproduced retained-draft aliasing and caller-owned scope/key lifetime defects. The implementation now snapshots candidates immediately after edits, captures/freeze-copies scope, and copies key bytes before asynchronous factories; regression tests cover each. Focused test/type results are reported to the coordinator. This is memory/store contract evidence, not packaged-native or real-data activation evidence.

## Next stage: actual App integration (still owned, not silently omitted)

1. Introduce a dedicated native nonpersistent renderer partition for encrypted mode; before any Dexie singleton/App mount, unlock via the protected OS adapter or present a locked recovery state. Do not mount the plaintext App after an encrypted-mode failure.
2. Inventory and capture a typed complete SO bundle: all primary tables/inline attachments; recovery versions, options and sync ancestry; every authorized teacher comment bank; device/preferences needed for working continuity. Validate the existing schema and byte-bearing attachments. Preserve teacher/organization access checks before capture, conversion and restore.
3. Route all current service/direct writes through the encrypted commit boundary. The legacy App's many independent Dexie/localStorage writers cannot be made durable by periodically encrypting snapshots. Changes must be acknowledged only after the encrypted store accepts the full resulting revision, with interruption/race tests.
4. Keep the source backup/storage untouched during opt-in conversion. Verify recovered and second-device access to the new encrypted bytes, restart and relevant reports/grades before switching launch mode. Retention of original plaintext must be stated explicitly; deletion/sanitization is a later deliberate action, not an encryption guarantee.
5. Route recovery snapshots, sync base, backup/export and personal transfer through their authenticated encryption purposes. Preserve exact merge/domain behavior after decrypt+validation. Existing plaintext Drive adapter is not an encrypted transfer pathway.
6. Address temporary dictation files, generated reports, browser crash/cache/swap and external export copies honestly. Encrypting workspace persistence does not erase already created plaintext reports, historical backups, OS swap or source files. Until their policy/path is implemented and reviewed, do not enable whole-workspace conversion.
7. Add protected revision/high-watermark policy if rollback detection is promised. AEAD and CAS reject tampering/context swaps and concurrent stale writes; they do not independently detect replacing the entire ciphertext store with an older valid revision whose expected revision is also read from that store.
8. Run integration UI/restart/interruption/recovery/second-device tests, independent security/correctness review and CI before presenting user activation. Unsupported OS storage fails closed. No plaintext fallback.

## Completion boundary

Stage 1 is a reviewable substrate. The existing production App still uses its current plaintext databases and exports; full SO encryption is not complete or activated. No fake enabled control, live account setup or real device key provisioning is introduced by this stage. Source rollback is available because conversion never alters it; consumers must not silently switch back to that potentially stale plaintext source after selecting encrypted mode.
