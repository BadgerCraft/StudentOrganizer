# Indexed ciphertext reads and canonical profile leases

This dependency adds bounded native reads and shared lease ownership. It does not activate an application, configure OS credentials, relocate a workspace, reset a receipt, or change an encryption format or algorithm. The existing sequential verifier and publication protocol remain required.

## Read one committed chunk

`createCipherChunkStore(...).readChunkAt({ context, plan }, position)` reads one immutable file generation. Both fields must come from `describeSealedChunkIndex(index)` after `openSealedChunkIndex(master, expected, finalSeal)` authenticates the existing final seal. A copied description is lookup metadata, not a proof.

The native reader validates the fixed scope, complete plan, position and stored descriptor. A read-only SQLite transaction contains schema/scope reattestation, ciphertext-length preflight and the selected BLOB fetch. Another connection cannot enlarge that selected row between its size check and fetch. The ciphertext is bounded by the existing envelope limit for a 4 MiB chunk. No other chunk is fetched.

The reader checks transport integrity and expected envelope context; it does **not** authenticate the chunk's AEAD tag or final-seal commitment. Pass its result to `openIndexedChunk(master, expected, index, position, ciphertext)`. That shared function checks the committed ciphertext hash before AEAD, verifies position and length, and returns at most 4 MiB of authenticated plaintext. A different valid encryption of the same plaintext is rejected if the final seal did not commit those exact bytes.

The opaque index retains scope, plan and commitments, never a master key. It must remain in memory and be closed with `closeSealedChunkIndex`. The consumer owns the main-process key, operator/context epoch and plaintext lifetime. Close the index and wipe the key when that context ends; check the context after opening the index and after every asynchronous read/decrypt before releasing plaintext. `binding.assertCurrent()` checks location lifetime, not teacher permissions or a protected head. Neither an index nor a selected chunk proves that all other chunks remain available. Do not substitute indexed reads for complete stream verification before publication or recovery acceptance.

## One canonical lease for all cooperating paths

`createCanonicalProfileLease({ canonicalProfileRoot, scope })` requires an existing, stable, application-owned OS profile root. The privileged host must choose that root independently of movable ciphertext directories, imported headers, renderer arguments and recovery metadata. The helper does not authenticate an arbitrary caller-provided root. Every cooperating process for the same app/OS-user/scope must use the same physical canonical root and this lease contract; choosing different roots defeats that prerequisite.

The helper hashes the normalized explicit scope into a fixed registry directory under `canonical-encryption-v1`. Its SQLite registry and lease remain outside movable workspaces and their exports/backups. Scope is never adopted from a copied workspace header.

`factory.forWorkspace(workspaceDirectory)` returns:

- `scope`: the immutable configured scope.
- `withExclusiveProfileLock(action)`: bounded waiting followed by the actual canonical SQLite lease.
- `assertProfileLease()`: a synchronous assertion of that binding's live action and underlying registry lease.
- `read(slot)` / `create(slot, protectedBytes)`: existing bounded protected-byte registry operations, only inside that binding's lease. Creation remains exclusive.
- `assertCurrent()`: synchronous physical-root/workspace lifetime checking, without granting a lease.
- `initialize()` / `close()`: explicit registry initialization and permanent revocation of that binding.

Pass the **same binding's** `scope`, `withExclusiveProfileLock`, and `assertProfileLease` to the existing protected-key, OS-ledger and pending-commit components. Do not nest leases or mix one scope's guard with another scope's ledger. The receipt read/expected comparison/write/readback must all remain inside the actual canonical lease.

Root and workspace canonical paths and filesystem device/inode identities are captured and checked across awaits. Leaf symbolic links/junctions and overlapping root/workspace locations are refused. Ancestor aliases resolving to the same physical root share serialization. Public assertions require the selected binding's active asynchronous context; a lease for workspace A does not authorize wrapper B, unrelated callers or escaped callbacks. The private registry pre-COMMIT hook checks physical identity and revocation after the action's ALS scope ends, without granting public access at that stage. Timed-out queued work never runs later. Closing or replacing a location invalidates the binding. The helper never silently follows a moved workspace; create a new binding only through an explicit host-selected location.

This is **shared serialization**, not persistent workspace-path ownership or a relocation protocol. Two same-scope copies can acquire the same canonical lease. Once one advances the independent protected head, the other copy's older checkpoint must fail reconciliation and remain unchanged. There is no receipt reset or automatic stale-copy replay. A deliberate relocation remains a separate consumer operation requiring stopped writers, verified state and explicit configuration; this helper performs none.

The canonical root is trusted host infrastructure. Cooperating applications must not delete, replace, restore or move that registry while writers run, or place it inside a movable workspace. Observed changes fail closed, but path checks are not an OS-atomic defense against a privileged same-user process replacing the underlying registry during native operations. POSIX private-directory/file ownership and mode checks are enforced. Windows ACLs, native key access and actual filesystem behavior remain platform acceptance checks; a test does not establish a physical power-loss or compromised-OS guarantee.

## Verification

Synthetic tests use real Node SQLite and shared crypto. They cover one-row SQL reads, selected-row growth during a snapshot, unrelated corruption, final-seal rejection of substituted generations, aliases/overlap, cross-binding and expired contexts, close/path replacement, queued timeout without late execution, and separate processes using copied workspaces. The copied-path test proves the second process actually acquired the shared lease after the first advanced the protected head; its stale checkpoint is refused rather than overwriting that head. The OS receipt backend in that test is injected and synthetic.

Run `npx vitest run shared/encryption src/security/cipherChunkStore.test.ts src/security/canonicalProfileLease.test.ts`, `npx tsc --noEmit`, and `node scripts/buildEncryptionNative.cjs`. Independent source review, packaged Windows/Mac checks and each consumer's key/index revocation and working-data integration remain distinct gates. No real device credentials or student work are used by these tests.
