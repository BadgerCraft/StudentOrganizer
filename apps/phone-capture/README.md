# Phone capture companion — private fictional-data pilot

Separate phone entry point and IndexedDB database, with shared package validation and photo rendering code. The Android app bundles its web assets and uses native camera/local files plus setup-gated direct private Drive transfer. There is no app backend, AI/OCR processing, analytics or assistant relay. Live account, installation and physical-device acceptance remain separate gates.

## Development and verification

Install root dependencies first because shared code reuses the desktop image validator. From repository root:

```sh
npm ci
npm ci --prefix apps/phone-capture
npm test
npm run build
npm test --prefix apps/phone-capture
npm run build --prefix apps/phone-capture
npm run preview --prefix apps/phone-capture
```

With the preview running on loopback port4173:

```sh
CHROMIUM_PATH=/usr/bin/chromium npm run test:browser --prefix apps/phone-capture
CHROMIUM_PATH=/usr/bin/chromium npm run test:native-browser --prefix apps/phone-capture
CAPTURE_PHONE_ZIP=/tmp/capture-phone-e2e.zip npm run test:capture:desktop
npm run test:capture:late-work
```

The phone browser test writes a fictional completed ZIP to `/tmp/capture-phone-e2e.zip`; the desktop test consumes that exact package. For the larger generated workload, use the phone development server (`npm run dev`, port5174) and `CAPTURE_TEST_URL=http://127.0.0.1:5174 npm run test:capacity-browser`. It saves `/tmp/capture-class-capacity.zip`; `npm run test:capture:capacity` at repository root validates/imports that package through the desktop browser services and verifies full backup capacity. These are development harnesses, not deployment or transfer servers. Scanner-specific CI runs browser and mocked native checks; no credentials or real uploads are used.

## Capture and match

1. Name the assignment. Start continuous native camera capture for **one student**. Each successful photo starts the next camera capture; cancel the camera when ready to Preview. Browser users have a camera-file hint or local photo chooser instead.
2. Preview, crop, rotate, reorder or remove individual photos. Cropping and rotation are metadata; original bytes remain untouched. Enter the required student-name **label**, then Save student group. Repeat for the next student. Duplicate labels remain separate groups.
3. Select **All done**. The app validates export limits before freezing the assignment. Export a local ZIP, or explicitly request private Drive transfer after separately authorized setup/consent. Intermediate saved groups never upload. Retained assignments and originals are deleted only by explicit assignment deletion; exports never purge them.
4. On desktop, select the intended class/assignment in Assessments and choose **Upload picture assignment**. Choose the ZIP from local files (manual Drive download is supported). Select a page set on the left and the actual roster student on the right, then Confirm match.
5. Confirmation saves every page and an import receipt atomically before marking the set saved. Failures remain retryable. Reopening/reimporting recovers prior receipts without duplicate attachments. Matching does not require a rubric, start marking or change official grades. Saved attachments are available for authorized review. Select a confirmed rubric and explicitly start marking, or associate the exact existing photo submission; original page bytes and order must match for association.

6. For late work, reopen the completed phone assignment and select **Add late work**. Capture only the additional pages/new students, then All done and export the new package. Earlier packages remain unchanged. On desktop select the actual student and explicitly choose **Append to** the existing submission, or save a new student submission. Existing marking annotations, judgments and page IDs remain unchanged. Finalized/archived submissions cannot receive additions; support after finalization is deferred. Restart/reimport recovers the append receipt. Deleting one phone package does not delete related late-work packages.

Limits:40 student groups,10 pages each,8 MiB per JPEG/PNG,20 million pixels per photo,800 million aggregate pixels and256 MiB ZIP/expanded bytes. Retained removed originals count toward local storage limits. A combined draft submission remains limited to10 pages/32MiB for marking; additions exceeding that limit fail without changing prior work. Desktop confirms also preserve the256 MiB complete-backup ceiling across the entire database; a match that would exceed it rolls back. Count limits are upper bounds, not a guarantee every maximum-size combination fits. Real phone memory/storage/latency remains unverified.

Browser storage can be cleared/evicted; verify a local ZIP backup. Original EXIF metadata is retained. Legacy flat batches remain recoverable for grouping; the old v1 ZIP format is deliberately rejected by the v2 desktop importer. No claim of physical power-loss durability follows from browser tests.

## Completed ZIP v2

`manifest.json` records stable package/assignment/submission/page IDs, display-name hints, zero-based ordered pages, safe generated paths, MIME, byte length, SHA-256, crop/rotation and revision. Only completed packages are accepted. Labels never establish identity; no imported roster/student IDs are accepted. ZIP validation rejects unsafe paths, duplicate paths/IDs/order, unsupported/encrypted/symlink/nested entries, invalid framing/metadata/images/hashes and bounded expansion/pixel violations. Original bytes are validated sequentially; contents never execute.

## Android and Drive

See [existing work order and exact setup gates](../../docs/work-orders/ANDROID-PRIVATE-DRIVE-2026-10-16.md). `CAPTURE_DRIVE_SETUP_APPROVED` stays false by default. When separately configured, the user chooses their account and enables transfer, then deliberately queues a completed ZIP. The assignment-named private folder and file use persisted generated IDs, owner/permission checks and retry-safe checksums. No destination is selected by name alone. Process restart requires explicit re-enable; settings failures stop transfer. No automatic original purge. Less-friction desktop retrieval remains deferred in F-008-CAPTURE-SEAMLESS.

Native camera/permissions/lifecycle/storage pressure, live OAuth, real Drive delivery and physical desktop acceptance are not established by mocked transport or headless browser checks. Use fictional data only; no release, installation or real-student use is authorized by this source pilot.
