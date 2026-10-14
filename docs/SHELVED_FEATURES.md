# Shelved features and resume map

This is a navigation companion to [FEATURE_QUEUE.md](FEATURE_QUEUE.md), which owns current status, approvals and revisit conditions. Historical work orders retain their evidence; they do not reauthorize shelved work.

## F-006 installed iPad — shelved October 14, 2026

**Authority:** Tyler: “take the action right now to change all documentation relating to iPad work and where to find it later, and put it on the shelved features.” Installed Windows/Mac delivery and acceptance take priority. Preserve the implementation; no deletion of code, assets or scripts is requested. Native camera/touch/Files/background/renewal checks remain unverified and deliberately deferred, not blockers for desktop development. Existing CI checks may remain regression evidence without restarting device work.

**Revisit condition:** Tyler explicitly reactivates iPad support after reviewing desktop progress and the remaining device effort. At that time refresh source/CI/evidence and account requirements; prior approvals do not authorize spending, paid accounts, credentials, releases or real-student use.

| Resume location | Purpose |
| --- | --- |
| `ios/` | Existing native Xcode project and Swift boundary/Files code; preserve app identity and database origin. |
| `capacitor.config.ts` | Bundled runtime configuration and stable app identity; verify before rebuilding. |
| `package.json`: `ios:prepare`, `ios:open` | Build/sync bundled assets and open Xcode; development commands are retained, not current tasks. |
| `scripts/auditNativePilot.ts`, `scripts/nativePilotSmoke.ts` | Static native asset audit and shared browser proxy; neither proves native device behaviour. |
| [IPAD_SUPPORT.md](IPAD_SUPPORT.md) | Retained installation, privacy, free-signing renewal and Markinator native acceptance matrices. |
| [Installed iPad plan](plans/F-006-INSTALLED-IPAD-IMPLEMENTATION-PLAN-2026-10-03.md), [free pilot plan](plans/F-006-FREE-IPAD-PILOT-IMPLEMENTATION-PLAN-2026-10-04.md) | Original architecture and credential-free pilot plan. |
| [Distribution decision](decisions/F-006-DEC-005-IPAD-DISTRIBUTION-2026-10-02.md) | Prior delivery alternatives; later installed/local-only decisions supersede PWA proposals. |
| [F-006 execution](work-orders/F-006-2026-10-05.md), [batch review](work-orders/F-006-BATCH-REVIEW-2026-10-06.md) | Historical source, verification and platform blockers. |
| [Modes/photo work order](work-orders/MARKINATOR-MODES-PHOTO-P0-2026-10-13.md), [checkpoint](markinator/CHECKPOINT.md) | Later camera permission/static checks and marking workflows; physical device behaviour remains unproven. |

A future phone capture companion is a separate design question, not a back door to resume iPad delivery. Keep all student data local unless the teacher deliberately transfers it through an approved mechanism; names may suggest but never silently commit roster matches.
