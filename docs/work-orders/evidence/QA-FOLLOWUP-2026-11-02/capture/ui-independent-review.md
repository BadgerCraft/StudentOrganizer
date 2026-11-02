# Independent capture-reference UI/export review — 2026-11-02

Scope: /workspace/StudentOrganizer-qa-followup working tree over HEAD 94851bf2d668d85a33672b688e24c6a9f275eaf5. Reviewed ImageMarkup, ReadOnlyMarkingHistory, MarkingWorkspace, annotatedReport, capturePageQueue, types/importImages plus relevant service/validation paths. Product changes belong to capture owner. Only reviewer repository edit: authorized standalone scripts/qaCaptureReferenceLifecycleSmoke.ts. No commit, publish, deploy, or real student data.

## Verdict
No concrete blocker established in reviewed UI/export paths. Preview cancellation and missing-reference recovery passed real Chromium checks using actual components and public service binding. Coordinate transforms remain unchanged; references resolve original metadata and bytes before drawing. Export checks every page against saved metadata, obtains pages through same-attempt authorized resolver, and checks authorization before delivery. Draft validation requires exact feedback/page coverage; report context checks commit/session/attempt/rubric links.

The review identified a queue-scope weakness in history: URL creation originally released the queue before actual image decoding. Capture owner added awaited Image.decode plus post-decode identity check (ReadOnlyMarkingHistory.tsx:64-77), and explicit identity validation before ImageMarkup draws (ImageMarkup.tsx:148-150). Final lifecycle runs passed after those edits.

## Independently executed
- `npx vitest run src/marking/report.test.ts src/marking/imageGeometry.test.ts src/marking/modesPhotoService.test.ts src/marking/readValidation.test.ts`: 68/68 pass, 4 files.
- `npx tsx scripts/qaCaptureReferenceLifecycleSmoke.ts`: PASS, repeated after final owner changes. Delayed authorized read followed by page switch drops obsolete result; missing reference shows retry then recovers after exact fictional original restored; delayed read plus teacher switch leaves no visible stale canvas and no onChange writes; delayed actual createImageBitmap followed by page switch ignores obsolete pixels and limits in-flight decoder count to one; readonly history hides old image after missing new reference and Retry recovers. Zero browser errors/external requests.
- `npx tsc --noEmit --strict --skipLibCheck --module esnext --moduleResolution bundler --target es2022 scripts/qaCaptureReferenceLifecycleSmoke.ts`: PASS.
- Logs: /tmp/capture-lifecycle-final.log and /tmp/capture-lifecycle-types.log. Original independent probe: /tmp/capture-lifecycle.mjs.

## Evidence and limits
- ImageMarkup.tsx:137-194 uses cancellation and serialized reference decode; retained coordinates and original dimensions remain separate from bounded preview canvas.
- ReadOnlyMarkingHistory.tsx:58-79 selects one retained original per history consumer, awaits decode, checks actor again, revokes URL on cleanup, and exposes retry.
- annotatedReport.ts:70-101 validates report, resolves each page sequentially, compares identity/hash/size/dimensions, renders copies only and checks authorization before export.
- markingService.ts:289-305 authorizes retained page reads; 588-599 links report context to finalized revision. Backup/provenance completeness is separately reviewed by persistence reviewer.
- The lifecycle fixture deliberately binds a small real capture then substitutes valid references, avoiding a second 35 MiB workflow. Large real-pixel backup/export/PDF smoke is capture owner's separate evidence; I did not independently rerun it.
- One-page bound is per consumer's decoded-page work, not total process memory: IndexedDB still returns an attachment containing all encoded originals; output HTML accumulates rendered JPEG pages; multiple retained history consumers may display selected pages simultaneously. No claim of a globally fixed memory cap or performance benchmark.
- Electron/native PDF, Safari fallback image decoding, physical low-memory devices, and OS termination were not executed by this review. Chromium lifecycle and existing geometry/report tests do not replace those platform checks.
