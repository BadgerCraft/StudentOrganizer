# Windows encrypted-write durability — October 29, 2026

Status: researched proposal and isolated prototype work. Existing reviewed file adapters remain unchanged. Production activation remains off. The user authorized development for Windows and Mac; this is a technical provider choice within that scope, not a request for new product approval.

## Finding and selected route

Do not make `syncDirectory` return success on Windows. The file-replacement provider needs a documented persistence contract; a successful rename or process restart alone is insufficient evidence of power-loss durability.

Microsoft documents `MOVEFILE_WRITE_THROUGH` as waiting for the move, with an explicit flush guarantee for copy/delete moves. The page does not provide the exact parent-directory flush and old-or-new crash guarantee required by our current callback. Cross-volume copy/delete would also change the replacement protocol. This is an evidence gap, not proof that same-volume Windows renames are necessarily unsafe. [MoveFileExW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw).

`ReplaceFileW` is a documented document-replacement operation, but its WRITE_THROUGH flag is unsupported; several failure codes describe intermediate states. It cannot be substituted and labelled a flushed commit without recovery handling. [ReplaceFileW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew).

`FlushFileBuffers` requires a writable file handle. Microsoft also describes volume-level flushing, which can require administrative privileges. The supported directory-handle API list does not establish a directory-fsync equivalent. We will not request elevation, invoke volume flushing or claim that `CreateFile(BACKUP_SEMANTICS)` alone solves this. [FlushFileBuffers](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers), [directory handles](https://learn.microsoft.com/en-us/windows/win32/fileio/obtaining-a-handle-to-a-directory). Windows file metadata is cached; explicit file flushing/write-through matters, but that observation alone does not prove a directory replacement protocol. [File caching](https://learn.microsoft.com/en-us/windows/win32/fileio/file-caching).

Use an established transactional storage engine for the encrypted container instead: an isolated SQLite CAS provider. SQLite documents atomic commit across system interruption and distinguishes its filesystem/hardware assumptions. The synchronous pragma documentation identifies WAL plus FULL synchronization as durable, whereas NORMAL can lose acknowledged transactions after power loss. Read back the actual WAL/FULL settings; never silently accept another journal/sync mode. Physical hardware that lies about flush completion remains outside the software guarantee. [Atomic commit](https://www.sqlite.org/atomiccommit.html), [synchronous pragma](https://www.sqlite.org/pragma.html#pragma_synchronous).

The current development Node 24.19.0 provides `node:sqlite` and SQLite 3.53.3. The builtin avoids a new service, paid package or native dependency rebuild. It is still an experimental API in the Node 24 line, so support must be feature-probed and verified in the installed Electron 44.4.5 runtime, not inferred from standalone Node. The local Electron probe could not launch because its binary was missing; its automatic download failed. No further download recovery or real device provisioning was attempted. [Node SQLite API](https://nodejs.org/api/sqlite.html).

Transactional NTFS is not the preferred alternative: Microsoft recommends other mechanisms rather than introducing a dependency on TxF. ESE is another documented Windows transaction engine, but requires more platform-specific bridging than the available Node SQLite interface. [TxF alternatives](https://learn.microsoft.com/en-us/windows/win32/fileio/deprecation-of-txf).

## Provider contract

New files: `electron/sqliteEncryptedVaultStore.cjs` and `src/security/sqliteEncryptedVaultStore.test.ts`. They are separate prototype work and excluded from the first PR52 integration commit until independent review. No edits to the frozen shared crypto or file CAS adapter are necessary.

- Same application interface: `read() -> {revision,ciphertext}|null`, `commit(expectedRevision,next)`. The fixed directory and app/vault/key version come from trusted main-process construction.
- Only authenticated-envelope ciphertext and bounded public protocol metadata enter SQLite. No master key, recovery code, plaintext snapshot, filename chosen by the renderer or student index enters the provider.
- Use one fixed database with a single checkpoint row. `BEGIN IMMEDIATE`, recheck expected revision, validate the new context/revision, update once and resolve only after COMMIT. Concurrent writers cannot both acknowledge the same expected revision.
- Keep WAL/FULL synchronization and bounded busy timeout. Treat commit/response uncertainty as locked; reopen the actual saved revision. Never replay automatically. Reject unsupported builtin, settings, schema, unsafe paths, corrupt or oversized data.
- WAL and SHM are part of the encrypted container's storage surface. They may retain older ciphertext versions, which must be included in disk/privacy checks and backup cleanup policies. Temporary SQL work stays in memory. Diagnostics must not print SQL bound values or raw errors.
- Envelope metadata checks do not authenticate content; shared crypto performs AEAD verification before use. Replacing all database files with an older valid version is still a rollback boundary unless a separate protected high-water mark is implemented.

## Verification and activation gates

Current prototype: 11 tests passed on actual local Node 24 SQLite, including two competing OS processes. Independent review found that an interrupted first checkpoint left uninitialized schema; schema enrollment now has its own FULL-synchronized transaction, and an initial-write interruption/retry regression passes. Native Windows/Electron coverage remains pending.

Prototype tests use synthetic ciphertext and actual local Node SQLite: roundtrip/reopen, exact CAS, concurrent instances/processes, scope/type/size rejection, corrupted files, interrupted transaction rollback, commit acknowledgement loss, WAL/checkpoint behavior and absence of plaintext canaries from database/sidecars. These tests establish software behavior, not actual Windows flush compliance under sudden power loss.

Before enabling Windows conversion: run the same provider under packaged Electron 44.4.5 on Windows, prove builtin availability, expected pragmas, restart recovery and bounded failures; independently review the provider and native boundary; complete the existing offline-recovery and second-device enrollment checks. Real user activation, OS key provisioning and full application plaintext-surface closure remain separate gates. Existing data is preserved throughout development. If the builtin is absent, the provider must report unsupported rather than load a plaintext/file fallback.
