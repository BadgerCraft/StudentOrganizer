# iPad Home Screen app implementation and QA

F-006 implementation approved by Tyler October 1, 2026, 09:18 Toronto: Mac desktop plus iPad Home Screen app; device-local records and manual full-backup transfer first. Merge, release, hosting, paid services and live synchronization remain separate decisions.

## Current evidence

| Check | Evidence or remaining limit |
| --- | --- |
| Production build | `npm run build` passed October 1. Generates manifest, 180/192/512px PNG icons and versioned offline worker. Existing bundle-size warning remains. |
| Existing service tests | Integrated `npm test` passed 162 tests October 1 (152 baseline, seven bug-report tests and three occupied-seat swap regressions). |
| Actual generated offline worker | `node scripts/verifyOfflineShell.cjs` passed at root and `/teacher/` scopes: eight exact build assets, document and JS/CSS available without network; record downloads, POST requests, foreign origins and unrelated navigation excluded; another same-origin app path's old cache retained; no forced activation or page takeover. This is a Node worker simulation, not browser runtime evidence. |
| Touch/browser checks | Local launch blocked: default Chromium/WebKit absent; normal install retries failed with empty/truncated Chromium ZIPs. First GitHub browser run on `466e5d0` reached the seat-swap step but failed when a nested profile action intercepted a center tap. Fixed move mode to hide quick actions; touch layout now places ordinary quick actions on a separate row. Second run on ee6545d exposed an existing occupied-seat swap unique-index conflict in the shared service. Fixed it atomically with preserved row IDs and audit/outbox for both occupants; regression checks cover successful swap, rollback after audit failure and rejected unauthorized writes. Revised browser rerun must establish completion; neither failing run proves the whole classroom flow or offline reopen. |
| Physical iPad | Unverified. No iPad Home Screen installation, on-screen keyboard, actual Files handoff or hardware close/reopen has been tested. |
| Delivery | No HTTPS address provisioned or published. No release claim. `npm run preview` uses local development hosting only. |

## Classroom behaviour implemented

- Home Screen metadata, a local book icon and an app-shell offline cache. Only the app's bundled document, JS, CSS, manifest and icons enter that cache. Student records remain in the existing local IndexedDB; the worker never reads that database or uploads it.
- First online setup reports **Ready for offline use on this device** once the worker activates. The status panel explains device-local records, Safari/Home Screen separation, manual backup replacement and storage protection. Storage protection is an explicit request, not a durability guarantee.
- Updates install a complete new shell into a separate cache. They use the browser's normal waiting lifecycle: no `skipWaiting`, `clients.claim` or automatic reload. Save drafts and close all windows/tabs for this app before reopening to activate a waiting update. Only old `ontario-app-shell-*` caches belonging to that app path are removed on activation; another same-origin app path's shell survives and records are not cleared.
- Touch targets have a 44px minimum height. Text fields avoid focus zoom from very small fonts while pinch zoom stays available. Modal height and participation-dock height use the current viewport, with scrolling and safe-area spacing. Header responsiveness is integrated separately.
- **Move seats by tapping** is available on unlocked layouts: tap the source student, then a destination to move or swap. Tap the same source to cancel; **Done moving seats** returns to ordinary student selection. Existing service authorization and seat transaction handle the move. Busy/error states prevent repeated taps from silently issuing competing moves.
- CSV/JSON downloads use a temporary DOM link and retain their Blob URL for 60 seconds so Safari can complete its asynchronous handoff. Download feedback says to check Files rather than claiming the operating system saved it. Existing file-reader import/restore has explicit read-error feedback. Backups are ordinary unencrypted JSON.

## Installation and manual transfer guide

Use fictional data until the separate real-student/board approval is resolved.

1. After a delivery location is approved, open its stable HTTPS address in Safari. A local HTTP address on another computer does not satisfy iPad secure-context requirements.
2. Tap Share, then **Add to Home Screen**. Enable **Open as Web App** if that option appears. Launch from the Home Screen icon while online and wait for the offline-ready message. Safari's existing records are not automatically copied into the Home Screen app.
3. Use Import/Export to download a **Full Application Backup** from the source device. Check that the `.json` file is present and readable in Files/Downloads before leaving that device. Preserve a dated copy of the destination's records before restoring.
4. Move the backup using a user-approved method. In the destination app select the backup from Files, inspect its metadata, and confirm replacement. Restore replaces all destination records; it does not merge two devices' work. Use one current working copy and transfer deliberately to avoid divergent edits.
5. Reopen the destination and check the class, assessment, notes and photo. Download another backup after the day's changes. Deleting the Home Screen app, clearing website data or browser storage eviction can lose local records; an external backup is the recovery path.

Keep the delivery origin/path stable. Different origins or browser/Home Screen contexts can have separate databases and offline caches. Different paths on the same origin share the existing named IndexedDB; their offline-shell caches are separately scoped. Use a dedicated, stable app location and do not direct colleagues to solve updates by clearing website data.

## Repeatable checks

```sh
npm run build
node scripts/verifyOfflineShell.cjs
npx playwright install --with-deps chromium webkit
node --import tsx scripts/ipadBrowserTest.ts
IPAD_TEST_BROWSER=webkit node --import tsx scripts/ipadBrowserTest.ts
```

The browser script launches a disposable persistent profile and production preview; performs touch portrait/landscape/512px split-view checks, seat swap/occupant preservation, attendance, note participation, student/photo edit, assessment creation and an 88% K result with feedback, file roster import, CSV download, full JSON backup and explicit replacement, then closes/relaunches the browser offline and checks retained records including the mark. Screenshots cover each viewport, mark entry, restore preview, offline reopening and any failure in ignored `screenshots/ipad-{engine}/`. Read-only assertions use native IndexedDB; no production test hooks or test-only seeds are added. Failure exits nonzero. Its prepared checks must not be reported as passed until an actual run completes.

The physical device QA owner must record iPad model, iPadOS/Safari version and exact app commit/build, then repeat: first online Home Screen setup; airplane-mode reopen; touch/keyboard form editing; horizontal seating/markbook scrolling; mark entry and observational Levels 1–4; local photo selection; file roster import/CSV/full-backup save in Files; invalid-file rejection; destination backup before confirmed restore; close/reopen data retention; update waiting while a draft is open and activation after saving/closing all app windows. Neither a simulated browser nor a working icon proves all those behaviours. A tested supported OS range remains pending physical QA; use an up-to-date iPad for the initial trial.

## Component learning applicability

Consulted Reuse Component Lessons index v2 (October 1) and workflow backlog v1. Its only current DB-001/DB-002 lessons come from a Python SQLite pilot, with no StudentOrganizer finding. Their engine-specific transaction conclusions do not establish WebKit/Dexie/cache durability. No matching PWA lesson exists; retained the app's existing Dexie restore validation/transaction and used complete-build cache and offline/backup checks here. New reusable PWA observations can be proposed after real browser evidence; none is promoted to Verified from an unexecuted browser script.

## Primary sources checked October 1, 2026

- [Apple iPad: turn a website into an app](https://support.apple.com/en-ca/guide/ipad/ipad8f1f7a29/ipados): Home Screen installation guidance.
- [WebKit: Safari 17.2](https://webkit.org/blog/14787/webkit-features-in-safari-17-2/): Home Screen installation does not copy non-cookie local storage; contexts remain separate afterward.
- [WebKit: storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/): persistent-storage request and browser storage limits/eviction.
- [MDN: service workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers): secure contexts, precaching and normal install/activation waiting lifecycle.
- [MDN: updateViaCache](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/updateViaCache): direct worker script update checks without an HTTP-cache dependency.
