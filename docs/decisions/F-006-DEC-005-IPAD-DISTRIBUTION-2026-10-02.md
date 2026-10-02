# F-006 / DEC-005 — Installed iPad pilot distribution

Assigned: 2026-10-02, America/Toronto  
Follow-up due: 2026-10-03 morning briefing  
Status: awaiting Tyler's choice and reasoning  
Feature: F-006 Mac and iPad support

## Why this decision is now required

Tyler's October 1 privacy direction requires an installed iPad app whose operational files, student records and processing remain on the device, without a website. The earlier Home Screen/PWA route is superseded. The agent can determine packaging technology, signing steps and tests. Tyler needs to choose how the first installed pilot should reach the iPad because the options trade convenience, duration, distribution exposure and school-IT involvement.

Distribution determines how Apple signs, installs and updates the app. It does **not** by itself decide whether student records stay local. The implementation must separately prohibit telemetry/remote APIs and pass offline, network-denial, local-storage, export and restore checks.

## Terms

- **App signing:** Apple's verification that an installable app came from an identified developer and was not altered after signing.
- **Provisioning profile:** an Apple-issued rule set that connects the app ID, signing certificate and permitted installation route/devices.
- **UDID:** the identifier used to register a specific iPad for Ad Hoc installation.
- **MDM:** mobile device management used by a school or organization to install and control apps on managed devices.
- **Closed-loop:** StudentOrganizer's operational code, student records and processing remain on the device; deliberate export/backup is user-controlled.

## Viable paths

| Path | Teacher/pilot effect | Benefits | Costs and limits |
| --- | --- | --- | --- |
| **A. Ad Hoc registered-device pilot — recommended** | Install on Tyler's one or few named iPads without TestFlight. | Smallest distribution footprint; app runs without Xcode after installation; directly tests the installed build intended for closed-loop use. | Apple Developer Program required (US$99/year or local equivalent); each iPad UDID must be registered; manual provisioning/install/update; Apple allows up to 100 iPads per membership year. |
| **B. TestFlight pilot** | Testers install Apple's TestFlight app and receive invitations/updates. | Easier distribution and updates; scales to external testers. | Developer Program and App Store Connect upload required; first external build may require beta review; each build expires after 90 days; Apple hosts the beta build and manages tester/feedback information. This does not make student data remote if the app is built correctly, but it increases distribution-system involvement. |
| **C. Private Custom App through Apple School Manager/MDM** | PDSB IT privately distributes and manages the app. | Strong long-term school deployment path; only assigned organizations access it; managed installation and updates. | Requires school/board participation, organization identifiers and MDM/Apple School Manager coordination; each version is reviewed by Apple. Excessive for a one-device personal pilot and outside current access. |

## Recommendation

Choose **A, Ad Hoc**, for the first fictional-data, one/few-device pilot. It best matches Tyler's closed-loop priority while allowing the actual installed app to be tested. If PDSB later authorizes broader use, prepare a separate decision for **C, Custom App/MDM**. Use TestFlight only if easy invitations and updates matter more than its 90-day beta cycle and additional Apple distribution handling.

This recommendation does not authorize enrollment fees, account creation, credentials, distribution, real-student data, merge or release. After Tyler chooses, the agent will revise the implementation plan and identify the exact access/spending approval needed.

## Tyler's decision

Choose the pilot posture and explain the reason:

- **A — Ad Hoc** for smallest/manual distribution (recommended).
- **B — TestFlight** for easier temporary testing and updates.
- **Defer** until school-managed distribution requirements are known.

Actual choice/reasoning: pending.

## Official sources checked October 2, 2026

- [Apple: Ad Hoc provisioning profile](https://developer.apple.com/help/account/provisioning-profiles/create-an-ad-hoc-provisioning-profile/)
- [Apple: registered-device limits](https://developer.apple.com/help/account/devices/devices-overview)
- [Apple Developer Program price](https://developer.apple.com/programs/whats-included/)
- [Apple: TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/)
- [Apple: Custom Apps through Apple School Manager](https://support.apple.com/guide/deployment/distribute-custom-apps-dep0113f6e18/web)
