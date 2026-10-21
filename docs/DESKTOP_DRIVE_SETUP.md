# Desktop private Drive retrieval

The installed Windows/Mac app can connect, list completed phone capture ZIPs, retrieve one, validate it locally, and enter the existing explicit student-matching workflow. Partial class submissions are supported. Local ZIP import remains available without Google setup or network access. No remote upload is deleted or changed. Drafts, finalized-history protections and backup formats are unchanged.

## Setup boundary (not performed by this change)

This feature defaults **unconfigured**. Android's existing OAuth authorization is not a desktop credential. An assistant's connected Google Drive is also not app authorization. Do not copy tokens from the phone, browser, assistant or developer account.

An owner must separately approve and configure a **Desktop app OAuth client in the same Google Cloud project as the capture app's Android client**, with the existing Drive API and consent/test-user configuration. If that client does not already exist, creating it requires approval; this implementation does not create it. Use only `https://www.googleapis.com/auth/drive.file`, never `drive` or `drive.readonly`. Google may still require an explicit desktop consent step. Do not expand scopes if old uploads are absent. Cross-client visibility in the actual project/account must be verified with a fictional phone upload; it is not established by mocked tests.

After approval, the operator places `desktop-drive-oauth.json` in Electron's `userData` directory for `ontario-teacher-assessment`:

- Windows: `%APPDATA%\ontario-teacher-assessment\desktop-drive-oauth.json`
- macOS: `~/Library/Application Support/ontario-teacher-assessment/desktop-drive-oauth.json`

Use these fields (placeholders below are deliberately not valid configuration):

```json
{
  "approved": true,
  "clientId": "<approved Desktop app client ID>",
  "clientSecret": "<Desktop app client secret from that client configuration>"
}
```

Google desktop clients are public clients; their client secret is not a confidential server credential. Nevertheless, keep this operator configuration out of Git, app backups and the renderer. Do not provision a web/server credential. Only a preconfigured approved desktop client is accepted. No environment flag, remote config, automatic credential creation or permission grant is included.

## Teacher flow

In written markup's phone-package matching screen, choose **Connect Google Drive**. The system browser opens Google's account selector; choose the same account used by the capture app. The app uses a temporary IPv4 loopback callback bound to `127.0.0.1` on a random port, validates state and PKCE, and exchanges the code directly with Google. Return to the app and select an available `capture-…-r….zip` upload. Since older uploads have no custom metadata tags, the list uses their established capture filename/MIME convention; the contents must still pass the complete version-2 archive validator. A filename is never evidence of student identity.

The app checks the file and assignment folder are owned solely by that account and private, confirms the folder is a direct My Drive child, bounds download bytes, verifies SHA-256, and rechecks metadata before delivering bytes to the existing local validator. Review page sets and explicitly confirm each student. Unsubmitted classmates remain untouched. Reopening the same package reconciles durable receipts instead of adding duplicate pages. Finalized attempts still reject late append; this feature does not enable finalized replacement.

**Tokens stay in main-process memory only.** No refresh token is retained and no token reaches renderer, localStorage, IndexedDB, logs, disk or backups. There was no existing desktop OAuth token vault to reuse, so this increment introduces no persistent token store. Leaving matching, switching teacher, renderer failure, window close or application exit disconnects. Expired/revoked access requires reconnect. Disconnect forgets local access; it does not revoke the shared app grant used by the phone. Use Google's account settings for deliberate grant revocation, recognizing its impact on the phone.

## Recovery and limits

- Cancel closes a pending sign-in listener or aborts the current request, and invalidates the whole local import. If a local validation step is already running, the app waits for it to settle and discards its result; the previous package, selection and saved receipts stay intact. Operations time out after five minutes. Downloads are serial and have no persistent partial file. Retry starts again and must verify the complete bytes.
- Offline, rate-limit, denied-access and stale-upload failures retain the previous local package and all confirmed matches. No automatic polling or retry loop runs.
- ZIP validation retains the existing 256 MiB archive/expanded cap, per-image/page/pixel limits, CRC/hash checks and unsafe-path/unsupported-layout rejection. A full 256 MiB download can temporarily consume multiple copies in memory through IPC; native device capacity needs acceptance testing.
- Drive cannot atomically lock external sharing changes. Before/after checks detect observed changes; they cannot guarantee no transient sharing change occurred between checks.
- Sign-in and actual phone→Drive→desktop visibility remain **UNVERIFIED** until owner-approved setup and a fictional live pilot. Windows/Mac packaged system-browser/loopback behavior also requires native acceptance. No real student content was used or transmitted during development.

References: [Google desktop OAuth and PKCE](https://developers.google.com/identity/protocols/oauth2/native-app), [Drive per-file scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [Drive file metadata](https://developers.google.com/workspace/drive/api/reference/rest/v3/files). Consulted October 21, 2026. The application retains the existing scope; documentation is not authorization to create credentials or grant access.
