# Direct private Drive transfer core

Pure Java 17 engine and direct HTTPS Drive v3 transport. The native Android application supplies a short-lived AuthorizationClient access token, stable Drive `about.user.permissionId` account binding, persistent queue and opt-in state. It requests `drive.file`; this library does not obtain grants, persist tokens, change permissions or use the assistant's Drive connection. No AI/model, relay, analytics or content inspection endpoint exists here.

## Persistence contract

Run one serialized attempt per queue item. `QueueStore.save` must atomically and durably save before returning. The app owns an immutable ZIP snapshot in private storage; never mutate/reuse that path for another revision. Populate size, MD5 and SHA-256 from that snapshot, then bind the queue to its account, dedicated app-created folder and actual My Drive root ID. Persist generated folder ID before folder creation, just as the engine persists generated file ID before upload creation. The native app explicitly explains that enabling transfer authorizes creation of the named dedicated private folder in the connected account. The first enabled background attempt provisions that folder, retaining its generated ID across retries. A worker must not provision a destination before that explicit opt-in.

A network timeout or process restart reuses the same pre-generated file ID. Existing IDs (including HTTP409) require full verification; the engine never overwrites a conflicting file. Persisted resumable sessions resume from Google's confirmed offset in 1 MiB chunks. Expired sessions restart with the same file ID. Every new HTTP request rechecks opt-in, obtains the current token, requires Google's direct HTTPS endpoint and refuses redirects. State and response details exclude tokens and server error text.

A completed state requires private owner-only folder and file permissions, one expected parent, correct ownership, ZIP MIME type, byte size and both server checksums. Unknown permissions/checksums fail closed. A moved/shared folder or conflicting upload blocks; missing remote evidence retries. HTTP401 requires reconnect; 429/5xx/rate limits retry; permission and storage-quota denials block. Local originals are never deleted.

Turning off transfer prevents subsequent requests; it cannot recall bytes already sent or cancel an HTTP request already in flight. Sharing changes can race an in-flight transfer; checks before and after transfer detect changes but cannot atomically lock Google permissions. Later user/provider sharing changes are outside this application's control. A verified status describes the completed check, not a perpetual privacy guarantee. Google-hosted storage may apply its own automated storage/security systems; the application makes no AI/model calls.

## Verification

Run `gradle :transfer-core:test` from the Android root. Tests use fictional byte fixtures and injected fake transport only, including interruption-after-commit, restart deduplication, failed durable-ID save, checksum/permission/parent/account mismatch, expired authorization/session, quota/rate limits, opt-out, hostile session URLs and paginated permissions. No live transfer is implied.

Official references consulted October 16, 2026:

- https://developers.google.com/workspace/drive/api/guides/manage-uploads — resumable uploads, stable generated IDs and HTTP409.
- https://developers.google.com/workspace/drive/api/reference/rest/v3/files — binary checksum and metadata fields.
- https://developers.google.com/workspace/drive/api/guides/manage-sharing — ownership and inherited permissions.

Shared-component guidance was read; its authoritative component index failed to load in this environment. No unavailable lesson IDs are claimed. Native authorization, device lifecycle, camera and real transfer remain separately unverified. Desktop receipt still uses private Drive for desktop/manual download and manual supported photo import, not automatic StudentOrganizer ingestion.
