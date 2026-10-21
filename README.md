# Ontario Teacher Assessment

A local-first assessment and participation app for Ontario secondary teachers. The interface uses the Achievement Chart categories: Knowledge, Thinking, Communication, and Application. The current code uses React, TypeScript, Vite, Dexie (IndexedDB), and Electron for desktop packaging.

## Work on the app

Use Node.js 24 and npm. From the project folder:

```bash
npm ci
npm run dev
```

The Vite development server runs at `http://localhost:3000`. Other useful commands:

| Command | Purpose |
| --- | --- |
| `npm test` | Run the Vitest suite |
| `npm run build` | Type-check and build the web app into `dist/` |
| `npm run electron:dev` | Run the desktop shell locally |
| `npm run package:win` | Build Windows installer and portable packages |
| `npm run control-panel:start` | Build/run the separate owner-only local preparation console |
| `npm run benchmark:node` | Run the synthetic Node benchmark |
| `npm run benchmark:browser` | Run the browser benchmark |

The V6.6 import passed 151 Vitest tests and a production build on September 28, 2026. This records code verification, not approval to use real student data.

## Data and Git

The app stores its working data locally in IndexedDB. Keep real student names, numbers, photos, exports, backups, and credentials out of Git. `.gitignore` excludes common local data and build paths, but review `git status` before every commit because ignore rules cannot protect a file already tracked or every possible filename.

The V6.6 source is the current baseline. Earlier `main` uploads remain in Git history.

## Platform priority and shelved iPad support

Installed Windows and Mac are the current delivery and acceptance targets. Tyler shelved iPad-specific work on October 14, 2026; existing Capacitor/iOS code, assets and scripts are preserved. Do not treat iPad native acceptance as a desktop delivery gate. The [shelved feature resume map](docs/SHELVED_FEATURES.md) identifies source, commands, prior work orders and remaining device checks. Resume only on Tyler's explicit request.

## Windows QA handoff

See [the Windows QA guide](docs/WINDOWS_QA.md) for exact-package checks, build identification, publisher status, colleague feedback, and lasting downloads. Regular builds prepare QA bundles; only an explicitly reviewed QA tag publishes a prerelease.

See [our coding workflow](docs/CODING_WORKFLOW.md) for feature plans, review boundaries, and the reusable cloud workspace setup.

## Markinator integration checkpoint

The isolated implementation adds assessment-linked local marking. See [the checkpoint and next actions](docs/markinator/CHECKPOINT.md), [connection map](docs/markinator/CONNECTIONS.md), and [authorized work order](docs/markinator/APPROVED_WORK_ORDER.md). After `npm ci` and `npm run build`, `npm run test:marking:browser` runs a fictional Chromium workflow (set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` if Chromium is not `/usr/bin/chromium`). This development checkpoint is not platform pilot or release acceptance.

## Separate owner Control Panel

The Control Panel is a separate executable with tested update approval and exact-file delivery preparation and a clearly fictional aggregate dashboard. It has no analytics collection or live publishing connection. See [its guide](apps/control-panel/README.md) for commands, boundaries and native verification limits. Student Organizer offers only approval-bearing exact-match releases; publishing those prepared files remains a separate authorized action. No real release was published here.
