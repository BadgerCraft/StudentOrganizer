# Separate Android capture / private Drive pilot

This app packages the sibling browser capture UI with native file/camera intents, local document export and an account-bound durable direct Drive queue. It shares no main StudentOrganizer runtime or database. Drive setup is **disabled by default**. There are no embedded credentials or live accounts.

Build prerequisites: JDK17+ (verified JDK21), Android SDK35/build-tools35, Gradle8.11.1 wrapper. From `apps/phone-capture`, run `npm ci --ignore-scripts && npm run build`; then from this directory:

```sh
./gradlew --max-workers=2 :app:assembleDebug :app:testDebugUnitTest :transfer-core:test
```

Configure SDK location through `ANDROID_HOME` or an ignored `local.properties`. Use a writable `ANDROID_USER_HOME`/`GRADLE_USER_HOME` if the environment's home is read-only. No environment proxy or truststore is part of the application.

Do not enable `-PcaptureDriveSetupApproved=true` until the owner has approved/configured the Google Cloud project, Drive API, Android OAuth client for package `org.studentorganizer.capture` and the actual signing certificate SHA-1, consent/test-user settings, and a fictional device pilot. Do not create a backend/web client secret or use an assistant token. Native OAuth uses only `drive.file`; connect and subsequent automatic transfer are separate explicit actions. Installation is not performed by these build commands and remains a separate gate.

When configured, choose the intended Google account, authorize through Google's native consent, then explicitly enable automatic transfer. A deliberately queued completed package creates an assignment-named private folder in that account's My Drive root, using a persisted generated ID rather than name lookup. Wi-Fi/unmetered-only defaults on. Only completed assignments are explicitly queued from the Transfer completed ZIP button; intermediate saved groups never upload; native settings expose pause/retry/reconnect/revoke. Pausing cannot retract an in-flight request. After any app-process restart, explicitly enable transfer again: queued files survive, but the previous process's consent cannot authorize new requests. This conservative restart gate prevents a failed disk write from restoring an older enabled setting. Settings write failure stops transfer for the remainder of the process; free storage, restart, reconnect if needed, and explicitly enable again. Permissions are inspected, never changed; unknown/shared/moved destinations and mismatched checksums do not report verified completion. All local originals are retained. Google may run its own storage/security automation; this app makes no AI/model/OCR calls and has no relay or analytics.

[Current scope, exact setup and verification](../../../docs/work-orders/ANDROID-PRIVATE-DRIVE-2026-10-16.md). Use fictional fixtures only. Actual camera, permission prompts, physical-device lifecycle and live Drive exchange remain unverified. Desktop Assessments → Upload picture assignment validates the completed ZIP locally and saves explicitly matched multipage attachments with durable receipts, without a rubric or starting marking. Manual Drive download remains supported.
