# Phone capture companion — fictional-data pilot

Separate package, entry point, build and IndexedDB database. No imports from the desktop app, no desktop runtime/data/schema changes, no network sender or backend. This browser prototype is a reversible foundation for the Android phone workflow; it is not an installed/native app or an offline-installable PWA.

## Local development

From this directory (Node 22+):

```sh
npm ci --ignore-scripts
npm run build
npm test
npm run preview
# In another terminal, with Chromium installed:
CHROMIUM_PATH=/usr/bin/chromium npm run test:browser
```

The preview binds to `127.0.0.1:4173` only. It is a local development harness, not a deployment/transfer server. `npm run dev` uses `127.0.0.1:5174`. Use the same origin to revisit the same browser storage. No phone access, hosting, installation, APK or service adoption is supplied by these commands. Dependencies and test discovery are package-local; run the checks here separately from the desktop checks.

## Working slice

1. Choose a **fictional** class and assignment. The catalog is hard-coded demonstration data; no roster is read or transferred.
2. Use Take a photo (a browser camera hint) or Import photos. Supported: JPEG/PNG, 8 MiB per photo, 10 pages and 32 MiB per batch; decoded image limit 20 × 1024 × 1024 pixels, aligned with the pinned desktop source. No cropping, compression or OCR.
3. Label each page. Choose Save labels to commit edits, or Export to save and export them together. Reordering also commits current labels; leaving with unsaved edits requests a browser warning. Blank labels block export. Duplicate labels remain allowed and unmatched; use them for multiple pages of one fictional submission or ambiguous names.
4. Reorder pages. Context, original bytes, labels and order persist locally after committed saves and reload. Class/assignment are locked once pages exist.
5. Deliberately export a local ZIP. Check the downloaded file before resetting. Export never deletes pages or confirms that download/transfer succeeded.
6. On a desktop, extract locally, review `manifest.json`, and import numbered photos through the existing Markinator image flow. **The desktop does not yet ingest this manifest.** Choose class/assignment and explicitly match each student in desktop UI. No automatic identity assignment is implemented. Group ordered photos per intended submission manually.

Browser storage is not a backup: eviction, site-data clearing and private browsing can lose it. Keep original photos and the checked export. Original metadata, including possible EXIF location, is retained. Use fictional fixtures only. Multiple tabs use revision checks and reject stale writes; reload the stale tab before editing. Reset asks before removing the current local batch. Failed writes preserve the previously committed batch and leave unsaved labels visible for retry or copying; those edits are not durable until a save succeeds. A stale tab must copy any unsaved labels before reloading. Export also rejects a stale tab even when no labels were edited, and exports the committed snapshot checked at the start of the operation. No claim of crash/power-loss durability.

## Export contract v1

ZIP contains `manifest.json`, `README.txt` and ordered `pages/001.png` (or `.jpg`) paths. Paths are generated independently of labels and original filenames. Manifest includes `format: studentorganizer-capture`, `version: 1`, `fictional: true`, unique capture `batchId`, revision, class/assignment **hints**, and `requiresExplicitDesktopMatching: true`. Each page records immutable page ID, order, path, label hint, original filename, MIME, byte count and SHA-256. Every page has `studentId: null` and `matchStatus: unmatched`. Same names cannot become matches. Export hashes and ZIP generation occur outside the storage transaction. A new batch gets a new capture ID while retaining the database slot and monotonic revision.

This draft interchange contract has no trusted importer. Future ingestion must validate paths/limits/hashes/version, preview, and require explicit context/student matching before atomic writes. Do not import it into a live database as a backup.

## Verification limits / next gates

Unit tests cover rollback/retry, concurrent writers, persistence and export integrity; the browser test covers actual IndexedDB, decoding, mobile layout, downloaded ZIP contents and recovery. Headless Linux Chromium with a mobile viewport is not Android/native camera verification. Native camera, permissions, installability, offline cold launch, Android lifecycle/quota/capacity and actual phone-to-desktop transfer are **UNVERIFIED**. Desktop manifest ingestion, real catalog handoff and native packaging remain future decisions. No iPad reactivation, cloud sync, remote OCR/AI, automatic upload, paid services, public deployment or real student data.
