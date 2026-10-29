# Encrypted chunk storage — staged native contract

`electron/cipherChunkStore.cjs` uses the existing Node 24 SQLite engine to stage ciphertext as bounded BLOB rows. It implements no new cipher or transfer format: `shared/encryption/chunks.ts` remains the reviewed wire-format authority. The store is an inactive prerequisite; no production conversion or device provisioning is enabled.

## Main-owned construction and API

`createCipherChunkStore({directory,scope,verifyManifest})` receives a fixed absolute private directory and `{appId,vaultId,keyVersion}` from the main process. The required verifier is a trusted closure over the applicable master key, invoking the shared `verifyChunkStream` with a non-publishing sink, then returning `{totalBytes,plan}` from the authenticated final seal. Publication compares that exact verified plan, including the empty-file UUID; byte count alone is insufficient. It is never a renderer-provided callback or an `authorized` boolean. Runtime/parse injection exists for synthetic tests. No raw key or plaintext is stored by this adapter.

- `stage({context,plan},index,ciphertext)` commits one already encrypted chunk. The full authenticated context, file UUID and index are checked against the shared chunk-context derivation. Staging identical bytes twice is idempotent; different bytes at an existing position are rejected. Existing ciphertext is never overwritten.
- `publish({context,plan},finalSeal,expectedRevision)` checks the current logical artifact revision under an exclusive SQLite transaction, verifies the exact chunk count and every stored chunk, then invokes the trusted final-seal verifier. Only a complete successful verification atomically publishes the manifest. A draft manifest, missing chunk, substituted generation or stale revision cannot become the current artifact.
- `read(purpose,recordId)` returns the current manifest descriptor, or null if none has been committed. It does not by itself establish cryptographic authenticity. Authenticate the seal and consume `chunks(file)` through `verifyChunkStream` before exposing restored content or publishing a destination artifact.
- `chunks(file)` iterates encrypted chunks in exact index order. A full-file consumer must stage only encrypted output and wait for the shared verifier's successful completion; a partial sink callback is not a complete restored file.

An artifact starts at revision 1 with `expectedRevision=null`; subsequent publication requires the exact previous revision. Revisions apply to the logical `{purpose,recordId}` within the fixed app/vault scope, not to all files globally. Encrypted contexts and file IDs are opaque identifiers, never student names or filenames. A protected independent high-watermark is still required if whole-store rollback detection is promised.

## Durable publication and failure behavior

The fixed `chunks.sqlite` schema contains immutable staged file/context metadata, ciphertext/digests and current manifest references. WAL with `synchronous=FULL`, memory-only SQLite temporary storage and a bounded busy timeout provides the established transactional durability boundary. All staged chunks are committed before their manifest can be published. A later working-workspace checkpoint may reference only a successfully committed manifest.

Incomplete staging never changes the current manifest. The adapter does not remove staged chunks or older file generations automatically: coordinated reachability, dated-backup retention and recovery pins must be designed before garbage collection. Disk/quota preflight remains a consumer responsibility; encoded ciphertext has base64/header overhead beyond plaintext size.

Failures before commit roll back the pending operation. A failure after commit was attempted reports `ENCRYPTED_CHUNKS_COMMIT_UNCERTAIN`; reopen and inspect the current manifest rather than blindly repeating publication. Retrying identical chunk bytes is safe, but generating a fresh nonce and sending different bytes for an occupied slot is not a retry. No plaintext fallback, uncertain-write replay or manifest auto-advance is implemented.

The adapter restricts paths/permissions and rejects symlink entries; actual Windows ACL and packaged Electron `node:sqlite` availability still need native acceptance. It does not claim protection from same-user malware controlling an unlocked app, physical power-loss guarantees beyond the SQLite/VFS contract, or secure erasure of historical plaintext sources.

## Bounds and evidence

Chunks are 4 MiB plaintext with bounded encoded envelopes. Shared manifests plan through 128 GiB; tests plan a 100 GiB artifact without allocating it. Final seal size is bounded to 4 MiB and each fetched BLOB is bounded before decoding. Verification streams one chunk at a time; it does not assemble the whole media file in memory.

Synthetic tests exercise a real multi-chunk binary round trip, ciphertext-only file contents, incomplete and draft publication, immutable/idempotent staging, valid-generation substitution, tampering, first-write rollback, lost acknowledgments and competing publishers. Actual 100 GiB IO, quota exhaustion at that scale, packaged Windows behavior and physical-device recovery are unverified. No user data or OS credentials are used in these tests.
