# Shared native encryption host contract — version 1

This staged contract complements `ENCRYPTION_CONTRACT.md`. It supplies ciphertext publication, independent protected revision receipts and local OS key adapters for Node/Electron consumers. It does not activate encryption, migrate a profile, authenticate a teacher, grant cloud access or prove physical-device acceptance. Each application uses its own appId, vaultId, master key and independently scoped profile directory. Consumers must pin a reviewed immutable source revision rather than copy a moving branch.

## Components and required composition

| Source | Contract |
| --- | --- |
| `electron/sqliteEncryptedVaultStore.cjs` | Fixed-path ciphertext-only SQLite WAL/FULL checkpoint store; immutable stage/readStaged/publish/current and exact revision/hash CAS. |
| `electron/sqliteProtectedKeyStore.cjs` | Fixed-path OS-protected key registry; exclusive cross-process SQLite lease. The actual live `assertProfileLease` is mandatory. |
| `electron/platformKeyringStore.cjs` | Scoped independent app keys, local Windows nested CurrentUser/LocalMachine DPAPI or Mac login Keychain; no plaintext or roaming fallback. |
| `electron/protectedRevisionLedger.cjs` | Canonical version1 OS-protected `{head,pending}` metadata, scope bound, exact SHA256 ciphertext hash and legal monotonic transitions only. |
| `electron/pendingEncryptedCommit.cjs` | Durable candidate staging, protected pending receipt, publication, exact readback and protected-head advancement; deterministic restart reconciliation. |
| `electron/cipherChunkStore.cjs` | Immutable bounded ciphertext chunks in SQLite, authenticated final-seal publication via the shared chunk protocol. |
| `native/windowsCredentialLedger.cc` | Node-API local-persistence receipt adapter; no production deletion or arbitrary credential access. |

The shared authenticated envelope/chunk formats are unchanged from the reviewed crypto foundation. The root checkpoint is bounded (default180MiB encrypted wire maximum); large attachments belong in authenticated chunk objects, not a giant checkpoint. The store does not impose a new application grading, merge or backup-retention policy.

A host constructs the fixed profile registry, passes its `withExclusiveProfileLock` and `assertProfileLease` to the ledger/coordinator, and supplies the ciphertext store as candidates. All cooperating processes must use this same profile lease. Never substitute a renderer flag, boolean, noop lock, lock file without live ownership, or OS receipt derived from the workspace header.

`commit(expectedHead,{revision,ciphertext})` returns durable with the exact protected head only after all storage and receipt steps succeed. Rejected means a known invalid/stale request or missing enrollment authority was refused. Uncertain requires reconciliation before further writes and must never trigger blind replay. `reconcile()` returns durable only for an exact matching nonempty protected head, enrollment-required for a genuinely empty authorized enrollment path, or uncertain when consistency cannot be established. A staged operation UUID and exact ciphertext hash bind restart recovery; same revision with alternate ciphertext is not success.

The initial null-head commit requires a trusted synchronous `assertFreshEnrollment()` capability; default behavior denies it. The host must validate actual recovery and second-device proof plus its still-current activation/context epoch. Check before staging and before receipt publication. Existing data with missing protected metadata must remain locked. An import into a newly verified device is explicit enrollment, never implicit trust in copied files. Historical restore validates the archive and writes a fresh current revision; it cannot reset the protected head or reuse an old revision.

Domain validation, actor/class authorization, teacher-controlled grade authority, encrypted recovery-wrapper transport, dirty-record persistence, streaming archive import/export, renderer lifetime isolation and plaintext-source rollback are consumer responsibilities. This contract cannot be used to claim those paths are implemented merely because ciphertext storage passes tests.

## Platform and security limits

Windows uses Node's SQLite WAL with synchronous=FULL for publication; it does not ignore directory fsync errors or claim generic rename is durable. Keys use nested machine/user DPAPI. Receipts use Windows CRED_PERSIST_LOCAL_MACHINE (local credential persistence, not the DPAPI flag), not Enterprise roaming. Mac uses the login Keychain native provider. Unsupported/missing providers fail closed. Windows source compilation and the actual packaged-runtime synthetic probe are required CI acceptance; physical computers and abrupt power-loss testing are separate and are not claimed by source tests.

Workspace-only rollback is detected relative to the independent OS head. Restoring both the entire OS credential state and matching workspace to an older consistent point is outside this guarantee. Same-user malware and an unlocked compromised process are outside at-rest protection. No secure erase of retained original plaintext is claimed.

## Verification and activation boundary

`npm run test:encryption:native-storage` covers ciphertext CAS, concurrency, exact pending-receipt reconciliation, stale/alternate bytes, interrupted writes, fail-closed enrollment, key-provider bounds and immutable chunks. Windows CI compiles the addon, checks isolated synthetic local receipt metadata and exercises actual packaged SQLite, nested DPAPI and the native receipt adapter. Temporary synthetic keys/profiles and QA-only receipt metadata are removed; no user profile, recovery code, live Drive account or student work is used. Results must be read at the exact PR head. Production activation remains separate and disabled in this stage.
