# Product roadmap, implementation plans, and decision lookahead

## Current scope clarification — October 6, 2026, 13:37–13:38 America/Toronto

Tyler clarified that classroom marking and feedback stay on Teacher X's device by default, while deliberate sharing is a desired future capability. He then directed: “only work on transferring a bug report” and “Update that as a future step ... create PRs”.

- **F-007 active next scope:** deliberate private bug-report transfer, with registered reporter/device attribution, exact payload preview, explicit Send, secure transport and private receipt. Existing local draft/copy/download remains usable offline. No student work, marks, classroom notes, database exports, screenshots or automatic attachments enter this transport.
- Attribution is a target requiring a receiver/enrollment design; the local acting-teacher selector is not authenticated identity. A display name alone is not verified attribution.
- **F-009 deferred:** optional teacher-selected essay plus its feedback shared into an owner assessment/exemplar repository. Preserve this request; revisit after bug-report receipt is verified. Define permissions, consent/authorization, removal of student identifiers, access, retention and deletion before implementation. No essay upload or marking integration is authorized now.
- Release/update approvals and implementation-feedback expansion remain future control-panel scope, outside the bug-transfer first slice.
- This clarification authorizes recording scope and preparing concrete PR/implementation work; it does not adopt a receiver/provider, authorize accounts/hosting/spending, transmit real data, merge or release.
- [Bug-transfer implementation preparation](plans/F-007-BUG-TRANSFER-SCOPE-2026-10-06.md) defines PR slices, acceptance evidence and the remaining receiver/access judgment.

This section supersedes older absolute descriptions of “closed loop”: classroom data and processing remain on-device by default; explicitly selected future sharing requires its own defined boundary. It does not loosen current network restrictions or authorize automatic uploads.


## Superseding privacy and platform decision — October 1, 13:59 America/Toronto

Tyler explicitly confirmed that the iPad version must be an installed app that keeps all student data and processing on the device and needs no website to operate. His stated reason: “Student privacy is the most important condition that we need to abide by. Creating a hypothetical version doesn't make sense when we will have to change to it a closed loop at some point.”

This supersedes the earlier Safari/Home Screen delivery choice and the GitHub Pages fictional-data hosting proposal. Do not publish that site, provision hosting, or treat the PWA as the intended iPad product. Target an installed iPad app with bundled operational assets, local processing/storage, offline classroom operation, and deliberate user-controlled backup/transfer. Do not add automatic student-data uploads, telemetry, cloud sync, or remote AI processing. Development browser checks remain useful evidence for shared UI only.

F-006 next work: inspect a viable installed iPad packaging/storage/file-access path and produce a revised concrete plan, including signing/distribution/access requirements and physical-device checks. Do not infer approval for paid accounts, credentials, services, merges or releases. Existing Windows/Mac packages and reusable touch/report-draft work remain available for review; passing packaging/browser tests do not establish closed-loop operation. Audit actual external connections before making that claim.

F-007 central reporting requires its own explicit, optional boundary: no automatic record/page/screenshot attachments or background sending. Existing private-service proposals remain unadopted; reassess them against this requirement before asking for service approval.


Updated: 2026-09-30. Owner: Tyler. Planning branch: codex/approved-plan-workflow, PR #11. Current application baseline: main at a608e01913b7c8ec211fcbac18f9bf325d05402f.

This is Tyler's review file: requested feature order, plans, upcoming consequential choices, and a cross-reference of features already present. docs/FEATURE_QUEUE.md carries execution/approval state; this file carries the detailed product plans. Read both and docs/DEVELOPMENT_LEARNING.md before planning or briefing.

## Working agreement and approval

Tyler requested these priorities on September 30, 2026:

1. Mac and iPad support.
2. Easy bug reporting into a central file.
3. Integration of the earlier marking application.

Original September 30 request approved planning and technical investigation. On October 1 at 09:18 America/Toronto, Tyler replied “Approved” to the recommended daily items 1–3: F-005 bounded daytime execution trial, F-006 Mac desktop + iPad Home Screen support with manual full-backup transfer initially, and F-007 bounded reporting UI/drafts plus private account-free intake investigation. Merge/release remain separate; new service/access/spending choices require review. F-008 remains source discovery/planning, not integration approval. Unapproved plans remain proposed until Tyler explicitly approves their outcome, scope, and completion checks. Capture the actual approval beside the plan; do not infer it from priority, reading, silence, or an unrelated approval. Implementation approval authorizes its milestones and routine verification/repairs; merge and release remain separate decisions.

Agent duties: inspect actual code, research technical facts, produce reviewable plans, and look ahead through the next two priorities. Resolve routine implementation choices. Teach Tyler only the unfamiliar concepts needed for a real product, budget, distribution, privacy, or data decision. Present at most one new short decision learning brief per morning, and record a next-day follow-up only after actually presenting it. Questions stay deferred while Tyler is away; no answer is invented. No paid account, new hosting, real student data transmission, or public release is authorized by this document.

## Priority and current state

| Order | Feature | State | What Tyler will review |
| --- | --- | --- | --- |
| 1 | F-006: Mac and iPad support | Approved staged implementation October 1; Mac + Home Screen iPad, manual transfer initially | Supported use, iPad delivery path, device-to-device data expectations, staged completion checks |
| 2 | F-007: Central bug reporting | Approved bounded reporting UI/drafts and private account-free intake investigation October 1 | Reporting experience, visibility/privacy, central record and submission route |
| 3 | F-008: Earlier marking-app integration | Discovery plan; latest source not inspected; implementation not approved | Reused marking features, student/assessment linkage, explicit save-to-Markbook behaviour |

Existing Windows handoff and workflow PRs remain separate review items. Earlier fixture and Assessment Hub/Markbook proposals keep their stable IDs but do not override Tyler's order. Independent approved setup work can complete without approving these product features.

## 1. F-006 — Mac and iPad support

### Teacher outcome and current gap

A colleague can open StudentOrganizer on a supported Mac or iPad and carry out the agreed classroom workflows. Existing Windows features and stored records remain intact.

The current app is React/TypeScript with Dexie/IndexedDB local storage and an Electron desktop shell. package.json defines Windows NSIS/portable packaging only; the only current build workflow targets Windows. electron/main.cjs already has Mac lifecycle handling, but that does not prove a Mac package works. Its minimum window width is 960 px. No PWA manifest/service worker or iOS project appears in the current source tree. Mac/iPad support is therefore not verified.

### Approved delivery and milestones — October 1

1. **Shared compatibility baseline:** define supported Mac/iPad OS versions from the project's actual Electron/browser requirements, inspect layout and file APIs, and document a fictional-data test matrix. Preserve grading, Toronto dates, actor attribution, undo/audit, and local records. Do not call browser viewport emulation physical-device testing.
2. **Mac desktop packaging:** reuse Electron and this project's electron-builder v26 settings; add explicit Mac build commands and a macOS verification job. Select arm64/x64 coverage against intended machines and available runners; package a clearly identifiable app with source/build information. Test actual package launch, assessment creation/restart, participation, mark entry, photo/file handling, and backup/restore. Build evidence must identify architecture. Investigate signing/notarization technical requirements and current cost/account obligations; do not create accounts, credentials, or distribution releases before the necessary decision.
3. **Approved initial iPad delivery:** the shared web app adapted for touch and installed from Safari's Home Screen. It would need an agreed HTTPS delivery location, app manifest/icons, offline app caching and safe updates, storage status, and working Files-based import/export/backup. A Home Screen icon alone does not prove offline use or durable data. Alternative: a native iPad wrapper, evaluated for actual required capabilities rather than assumed necessary; this introduces an iOS/Xcode build and distribution path.
4. **iPad classroom verification:** portrait/landscape and split view; touch/student selection; on-screen keyboard/modals; seating and markbook scrolling; observation notes; levels/category recording; assessment creation and persistence after app close/reopen; photo selection; roster import, CSV export and full backup round-trip. Verify on a real supported iPad. Test offline reopen after first setup and safe app updates if offline use is part of the approved plan. Keep backup/recovery explicit because browser-managed storage can be removed.
5. **Review handoff:** exact builds/links, tested devices/versions, passes and untested limits, installation/update/backup guide, and explicit merge/release decisions.

### Completion checks

- Supported Mac architecture(s) have actual package launch/persistence evidence.
- Agreed iPad classroom tasks work on a real iPad with no silent data loss; offline and backup claims have their own measured checks.
- Existing npm tests and production build pass; existing Windows verification remains green.
- Platform support is stated precisely: built, simulated, physically tested, or released. Signing and school device policy are separate measured facts.
- No implicit cloud student-data sync is introduced.

### Decision lookahead: F-006 / DEC-002 — What does support include?

**Terms:** a desktop package contains the app for that operating system; a Home Screen web app opens from an icon but uses browser technology; a native wrapper embeds the web interface in an iPad app. Platform support and data synchronization are separate features: running on both devices does not keep their records in step.

| Choice | Classroom consequence | Investigation owned by the agent |
| --- | --- | --- |
| Mac desktop plus iPad Home Screen web app | Reuse the shared interface, adapt touch/offline/file handling; each device keeps its own data unless a transfer/sync plan is added | Browser storage/recovery, caching/updates, hosting and Files compatibility |
| Mac desktop plus native iPad wrapper | iPad-specific packaging and distribution; useful if required platform APIs justify it | Xcode/device build access, native storage/file APIs, signing and distribution |
| Browser delivery on both devices | One web delivery path; desktop packaging optional for this scope | Offline, storage, security and browser compatibility on both platforms |

Tyler approved the Mac desktop and iPad Home Screen path October 1 with manual backup transfer initially. Implementation is in draft PR #13; approval is not a tested compatibility claim. If Tyler expects to use the same class continuously on Windows/Mac/iPad, the plan must explicitly include or defer data transfer/sync; do not quietly build that major architecture under the word “support.” A bounded first version could use existing manual full-backup transfer with clear replacement behaviour, if Tyler accepts that workflow.

- Choice: Mac desktop plus iPad Home Screen app, manual full-backup transfer initially; automatic sync deferred. Accepted by Tyler’s October 1 “Approved”; no additional reasoning supplied.
- Implementation approval: October 1 daily scope. Merge/release approval: none.
- Learning brief prepared: September 30. Presented as a complete decision brief: not yet. Follow-up due: not assigned.
- Agent next investigation: target device/OS compatibility, complete delivery/recovery test matrix, and signing/distribution facts. Routine tooling selection remains the agent's work.

Authoritative sources checked September 30: [Electron platform scope](https://github.com/electron/electron/blob/main/README.md), [electron-builder v26 Mac configuration](https://www.electron.build/v26/docs/mac/), [Apple Home Screen web apps](https://support.apple.com/en-ca/guide/ipad/ipad8f1f7a29/ipados), [WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/), [Capacitor iOS](https://capacitorjs.com/docs/ios). Use the installed major version's configuration, not v27 migration examples. No pricing or developer enrollment assumptions are approved.

## 2. F-007 — Easy bug reports with a central file

### Teacher outcome

While using the app, a teacher can describe a problem with few steps and receive an understandable saved/submitted state. Tyler and the agent can inspect one central record, triage duplicates, and connect a confirmed bug to a fix and verification.

### Bounded approved plan — October 1; intake access decision still required

1. Add a clearly named Report a problem entry available from ordinary app navigation. Gather a short summary, expected/actual behaviour, and optional reproduction steps. Automatically include only safe app build/version, platform, and screen identifiers. Do not attach the database, student names/marks, raw page content, credentials, or a screenshot without explicit review.
2. Let the reporter preview/edit the report and choose whether to submit. Handle failure/offline without losing their draft; distinguish saved locally from received centrally. A local file download alone is not central collection.
3. Define the submission route after investigation. Candidate A: a prefilled GitHub issue and a documentation ledger, low infrastructure but requires a GitHub account and public-redacted reports. Candidate B: an account-free form plus controlled intake, easier for colleagues but requires an agreed service, privacy/access settings, operating costs and actual write path. Do not embed any repository write token in the app. Choose one route for the bounded first version; do not implement both by default.
4. Maintain the canonical central file docs/BUG_REPORTS.md (empty ledger implemented in draft PR #13; no reports invented) with stable BUG IDs, date/build/platform, symptom/reproduction, severity, status, duplicate links, related feature/PR, and verification. The app's intake record needs a durable ID; the agent reconciles it into the ledger while preserving newer edits. A single collector owns ledger writes to avoid concurrent overwrite.
5. Triage states: new, needs reproduction, confirmed, planned, fixing, verified, duplicate, deferred. Receiving a report does not approve a feature or prove a defect. Diagnose first; fixes follow the existing approval/scope rules. Avoid turning the public ledger into a student-data channel.
6. Test desktop/Mac/iPad entry points according to delivered platforms; safe payload, offline save/retry, failed submission, duplicate delivery, and successful arrival in the central record. Provide a short fictional bug demonstration and acceptance evidence.

### Completion checks

- A fictional report from the app arrives centrally with a stable ID and accurate build/platform.
- Offline/error states retain the report and do not claim delivery.
- Every centrally received report has one canonical ledger entry or an explicit duplicate relationship.
- No student/database payload is transmitted automatically; report visibility is explicit.
- Public app code contains no privileged GitHub credential.

### Decision lookahead: F-007 / DEC-003 — Who reports and who can read?

Tyler's consequential choice: should colleagues be able to report without a GitHub account, and should report details be private or publicly visible? Those affect the collection service and report-preview experience. The agent owns transport/library/service research and recommends the smallest route that meets that need. Prepare a short brief when F-006 is nearing completion; no provider research homework is assigned to Tyler.

- Choice: private, account-free colleague reporting; agent investigates transport. Tyler approved bounded UI/draft/preview/error-handling and safe-metadata work October 1. New service/access/spending adoption remains a concrete separate decision. No additional reasoning supplied. Merge/release approval: none.
- Learning goal: local draft versus central receipt; public issue versus private intake; build identifier helps reproduce the exact problem.
- Presented date/follow-up: not assigned.

## 3. F-008 — Integrate the earlier marking application

### Teacher outcome and known context

Mark student work with the useful tools from the earlier marking app and deliberately save the resulting assessment evidence into StudentOrganizer, without losing either app's existing records.

The latest marking-app source has not been inspected in this session. Its actual reusable features, storage and import/export formats must be verified before integration scope is approved. StudentOrganizer currently has manual Markbook entry; an integrated text-marking workspace is not established by the current code. Voice-to-text or AI marking must not be assumed implemented or included.

### Discovery and implementation plan — awaiting source and approval

1. Obtain the latest standalone source or repository and a fictional saved marking example; inspect actual code, dependencies, licenses, storage/exports and current working features. Produce a verified reuse/missing-feature table before promising the integration scope. Preserve the original source/history in a separate branch; do not import node_modules, built outputs, student essays, credentials, or obsolete experimental copies.
2. Propose one marking-workspace route linked to a chosen StudentOrganizer class, student and assessment. Map the actual rubric/comment/achievement-level records to stable IDs; handle category scales and versioned conversions explicitly. Preserve original JSON/export compatibility or provide a validated import path.
3. Reuse useful components and typed data boundaries rather than copying an entire conflicting app shell. Keep StudentOrganizer identity, routing, local storage, Toronto date logic and grade calculation authoritative. Inspect historical external/CDN DOCX parsing and replace external loading with an approved local/bundled approach if required; do not send student documents to a service as a side effect.
4. Define deliberate commit behaviour: marking edits remain a draft until the teacher saves selected evidence to the linked assessment. Preview the destination and category/level/percentage meaning. Prevent duplicate transfers and accidental overwrites; preserve audit history and allow recovery. Decide how much student text is retained, with local-only handling unless explicitly changed.
5. Verify a fictional essay end to end: load, highlight, add rubric-linked comments/levels, save/reopen draft, link to the correct student/assessment, save evidence, inspect the correct Markbook result, reopen after restart, and export/restore. Cover failed writes and stale/mismatched IDs. Compare legacy saved work before/after import.
6. Review the integrated teacher workflow, checks, migration/recovery and any deferred features before merge or release.

### Completion checks

- Current standalone capabilities and gaps are verified against source, not memory.
- A fictional marking session produces the approved comment/rubric workflow and transfers evidence only to the intended assessment/student.
- Drafts and saved legacy work survive restart, import and backup/restore according to the agreed format.
- Existing StudentOrganizer marks are preserved; category calculations and missing-work semantics stay explicit.
- Voice, AI evaluation and external document-processing services remain separately scoped choices unless their current implementation and approval are established.

### Decision lookahead: F-008 / DEC-004 — What becomes formal evidence?

Agent research first: actual source/data format and compatible import/reuse path. Tyler's eventual choices: which earlier marking behaviours matter, whether full essay text should be retained or only feedback, and whether saving marking results should explicitly write grades to Markbook or keep them as review-only drafts. Prepare a project-specific explanation once the source reveals the real options.

- Latest accessible source needed; no private project location is recorded here.
- Choice/reasoning: none. Implementation approval: none. Merge/release approval: none.
- Presented date/follow-up: not assigned.


## October 1 delivery proposal — decision prepared, no hosting enabled

Recommend GitHub Pages for the first **fictional-data iPad QA** delivery if Tyler accepts a publicly accessible application address. It can use the existing public StudentOrganizer repository and GitHub account; no new provider account or paid plan is proposed. GitHub documents Pages availability for public repositories on GitHub Free, static HTML/CSS/JS hosting, and HTTPS. Proposed project address, not a live/verified deployment: `https://badgercraft.github.io/StudentOrganizer/`.

Why Tyler decides: publishing makes the application website publicly reachable; local classroom storage remains on the device under the current code, and reports still need their own private receiver. GitHub logs visitors' IP addresses for security. This proposal includes fictional QA only and does not authorize real-student use. A stable origin matters: another site's address has a separate local database, so changing hosts later needs deliberate full-backup transfer. Paths on one origin do not isolate this application's named IndexedDB.

After separate hosting/publication approval: confirm repository Pages settings through an authorized administrator; build the reviewed commit at the project path; publish only built application assets, never classroom files; verify HTTPS, manifest/icon paths, complete cache, update waiting and recovery at that actual address; then perform physical Home Screen/Files/keyboard/airplane-mode QA. The current connector has not established Pages administration/deployment capability. Do not claim this proposed address works or automatically deploy on every PR.

Alternative: an explicitly approved Netlify account/site could combine static hosting and its private Forms intake, but current account/plan/access and form detection must be established first. The separate researched Formspree proposal remains in PR13's BUG_REPORTING_INTAKE.md. No option is adopted by this brief.

Official sources checked October1: [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages), [HTTPS/public visibility](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https). This brief is saved for Tyler's return; no answer, assigned homework, recall or new approval is inferred.

## Current feature cross-reference

Evidence: source inspection at the pinned main commit above on September 30, 2026. “Present” means an implemented UI/service path was found; it does not mean every row received a fresh end-to-end run. The scheduled probe separately passed 152 tests, production build/Windows packaging and the unpacked Electron assessment/restart check. Proposed PR #10 improvements are not counted as main features.

| Area | Present in current main | Important limit | Source |
| --- | --- | --- | --- |
| Teacher selection | Select/switch the acting teacher; actor checked for writes | Local teacher selection is not sign-in authentication | [Code](https://github.com/BadgerCraft/StudentOrganizer/blob/a608e01913b7c8ec211fcbac18f9bf325d05402f/src/services/identityService.ts) |
| Classes/dashboard | Create, duplicate setup, archive; whole-card opening | Duplicate copies setup, not roster/marks; recent-activity text is static | [Code](https://github.com/BadgerCraft/StudentOrganizer/blob/a608e01913b7c8ec211fcbac18f9bf325d05402f/src/components/DashboardView.tsx) |
| Dashboard display settings | Course title/code/both; show/hide term, period, room and student count | Formatting options rather than arbitrary replacement text | [Code](https://github.com/BadgerCraft/StudentOrganizer/blob/a608e01913b7c8ec211fcbac18f9bf325d05402f/src/components/DashboardView.tsx) |
| Seating | Drag, alphabetize/randomize, lock, rows/columns, standard/compact cards, search highlighting | Desktop drag-and-drop present; iPad touch operation unverified | [Code](https://github.com/BadgerCraft/StudentOrganizer/blob/a608e01913b7c8ec211fcbac18f9bf325d05402f/src/components/SeatingChartView.tsx) |
| Date navigation/attendance | Previous/next, calendar/Today, historical badge; date-specific attendance | Current classroom control toggles present/absent; late/excused schema values are not the same as exposed controls | [Code](https://github.com/BadgerCraft/StudentOrganizer/blob/a608e01913b7c8ec211fcbac18f9bf325d05402f/src/components/SeatingChartView.tsx) |
| Student details/photos | Gear from seat/profile; names, preferred name, pronouns; upload/replace/remove photo | Local JPEG/PNG/WebP; resized to 256×256 maximum, metadata removed, stored size ≤64KB | [Code](https://github.com/BadgerCraft/StudentOrganizer/blob/a608e01913b7c8ec211fcbac18f9bf325d05402f/src/components/StudentSettingsModal.tsx) |
| Quick participation | One/many students; tallies; positive/neutral/follow-up; category override; note; latest-batch undo | Note ≤1,000 characters; no general redo UI | [Code](https://github.com/BadgerCraft/StudentOrganizer/blob/a608e01913b7c8ec211fcbac18f9bf325d05402f/src/components/ParticipationDock.tsx) |
| Custom participation buttons | Create/edit labels, tally or level mode, points, default K/T/C/A, order, archive/restore | Already implemented; historical snapshots preserved; classification is fixed in the edit form | [Code](https://github.com/BadgerCraft/StudentOrganizer/blob/a608e01913b7c8ec211fcbac18f9bf325d05402f/src/components/SettingsView.tsx) |
| Observational Levels 1–4 | Select level, optional category and note | Already implemented; observations do not automatically change formal grades | [Code](https://github.com/BadgerCraft/StudentOrganizer/blob/a608e01913b7c8ec211fcbac18f9bf325d05402f/src/components/ParticipationDock.tsx) |
| Participation history | Date/student/category/classification filters; summaries; edit note; retract with reason | Retraction preserves audit; basic summaries, not a general analytics dashboard | [Code](https://github.com/BadgerCraft/StudentOrganizer/blob/a608e01913b7c8ec211fcbac18f9bf325d05402f/src/components/ParticipationLedgerView.tsx) |
| Assessments | Summative/formative creation, unit/due date, categories/max scores, class assignment; duplicate/archive | No Code field required; no full rubric-descriptor editor, assessment-edit screen or unit-management UI found; duplicate excludes assignments | [Code](https://github.com/BadgerCraft/StudentOrganizer/blob/a608e01913b7c8ec211fcbac18f9bf325d05402f/src/components/AssessmentHubView.tsx) |
| Markbook | Search/filter/sort; category scores and feedback; complete/missing/excused/incomplete; late flag | Manual entry accepts level codes, percentages and raw scores; separate essay-marking app not integrated | [Code](https://github.com/BadgerCraft/StudentOrganizer/blob/a608e01913b7c8ec211fcbac18f9bf325d05402f/src/components/MarkbookView.tsx) |
| Grading policy | K/T/C/A weights, formative exclusion, missing-work policy; conversion preset display | Weights total 100%; conversion preset displayed rather than edited here | [Code](https://github.com/BadgerCraft/StudentOrganizer/blob/a608e01913b7c8ec211fcbac18f9bf325d05402f/src/components/SettingsView.tsx) |
| Student profile | Overall/category grades, assessments, participation, private notes, audit; individual assignment; override with rationale | Privacy labels are not authentication; individual-assignment form chooses one category | [Code](https://github.com/BadgerCraft/StudentOrganizer/blob/a608e01913b7c8ec211fcbac18f9bf325d05402f/src/components/StudentProfileModal.tsx) |
| Roster import | Paste/file CSV/TSV/TXT; combined/separate names; numbers; preview, validate, resolve conflicts before commit | Roster import, not bulk photos or marks import | [Code](https://github.com/BadgerCraft/StudentOrganizer/blob/a608e01913b7c8ec211fcbac18f9bf325d05402f/src/components/ImportExportModal.tsx) |
| Export/backup/restore | Markbook/participation CSV; full JSON backup; validated restore with replacement confirmation | Manual transfer; JSON backup is not established as encrypted | [Code](https://github.com/BadgerCraft/StudentOrganizer/blob/a608e01913b7c8ec211fcbac18f9bf325d05402f/src/services/portabilityService.ts) |
| Local database/Windows app | Local IndexedDB and Electron desktop shell; Windows installer/portable build | Current packaging targets Windows; Mac/iPad execution not verified | [Code](https://github.com/BadgerCraft/StudentOrganizer/blob/a608e01913b7c8ec211fcbac18f9bf325d05402f/package.json) |

### Requested or possible features not established as available

| Feature | Current state | Cross-reference |
| --- | --- | --- |
| Verified Mac/iPad support | Not delivered/verified; no iPad install/offline setup in source tree | F-006, priority 1 |
| In-app bug reporting into central file | No reporting/central-delivery path found | F-007, priority 2 |
| Earlier essay marking application | No integrated text/highlighting/rubric-comment workspace found | F-008, priority 3 |
| Live device sync / Google Drive / cloud backup | Not available; syncOutbox uses an in-memory mock server ledger | [Sync source](https://github.com/BadgerCraft/StudentOrganizer/blob/a608e01913b7c8ec211fcbac18f9bf325d05402f/src/services/syncOutbox.ts) |
| Voice marking / AI marking | Not found in current routed UI/dependencies; not approved by this roadmap | Separate future scope |
| Full rubric authoring | Screen title mentions rubrics; descriptor authoring UI not found | Assessment Hub limitation |
| General redo | Not found; participation latest-batch undo exists | Participation limitation |

## Evidence and learning follow-up

The [successful bounded automation report](work-orders/GITHUB_AUTOMATION_TEST_2026-09-30.md) and [draft probe PR #12](https://github.com/BadgerCraft/StudentOrganizer/pull/12) show an unattended documentation edit followed by successful GitHub-hosted checks and a persisted result. They do not prove arbitrary feature implementation or automatic dispatch of the published Cloud environment. No test-PR merge is required to preserve that evidence.

Useful learning questions saved for review, not used as approval gates: what distinguishes a platform package, a Home Screen app, and device synchronization; and how does a locally saved bug draft differ from a report received in the central file? No answer or successful recall is inferred.

## Maintenance and next step

- On new requests, add or amend plans here without changing Tyler's order silently.
- On an actual answer, record it beside the decision and copy execution/approval status into the matching feature entry in FEATURE_QUEUE.md.
- On completed work, update the inventory below from the tested source commit and state what was verified; do not count an open PR as shipped.
- Keep the 08:15 lookahead focused on the next two priorities, 16:00 learning optional and brief, and 20:15 execution limited to approved plans with an actual available path.
- Current next step: verify approved F-006 and bounded F-007 in draft PR #13, finish scoped repairs and record source-specific evidence. HTTPS delivery and a private receiver require concrete account/service choices; physical-device validation remains explicit. Historical marking documents were found, but current code is unavailable and a code-only archive/repository is needed for F-008 planning.

## F-006 / DEC-005 — Installed iPad pilot distribution
Assigned: 2026-10-02. Follow-up due: 2026-10-03. [Decision learning brief](decisions/F-006-DEC-005-IPAD-DISTRIBUTION-2026-10-02.md).

Tyler's closed-loop requirement supersedes the earlier Home Screen/PWA delivery plan. The real product judgment is the first installed pilot's distribution posture: Ad Hoc registered devices (recommended, smallest/manual footprint), TestFlight (easier temporary updates, 90-day builds and Apple-hosted beta distribution), or later school-managed Custom App/MDM. Distribution does not establish local-only data handling; separate network-denial, local-storage, export/recovery and physical-device tests remain required.

Tyler chose A — Ad Hoc on October 2, 2026, America/Toronto. His goal is a small, stable pilot rather than a scalable service; future plans are uncertain. He considers Ad Hoc sufficient for getting the installed app onto the intended devices. Decision follow-up resolved October 2. Ad Hoc is simpler in distribution footprint for the small pilot; updates remain manual and stability must be verified. Next: revise installed-app implementation scope, local-storage/recovery/network checks and actual signing/access prerequisites for review. No Apple Developer Program fee, account enrollment, credentials, app distribution, merge, release or real-student use is authorized by the packet.

## October 2 afternoon — pilot clarification and optional documentation

Tyler clarified at 10:21 America/Toronto: easy updates can wait; selling the product is a future goal. His words: “Cumbersome to everyone except myself is a feature.” Interpret this as intentionally restricted pilot access and acceptable manual distribution/update friction for other testers, while Tyler's own classroom use should remain straightforward. Do not design deliberate classroom UX obstacles, treat Ad Hoc as a security/license system, or infer approval for commercialization, payment, distribution, merge or release. This refines the morning “not a scalable service” rationale: small controlled pilot now, future commercial product possible. DEC-005 remains resolved as Ad Hoc; no decision follow-up is needed tomorrow.

Optional F-006/DEC-005 depth offered October 2: how signing/provisioning controls installation on registered devices, how manual updates preserve local records, and why pilot distribution and eventual commercial distribution are separate plans. Choices remain brief explanation, original Apple sources, or defer; no answer/defer is inferred.

## October 3 morning briefing

Planning source: PR #11, branch `codex/approved-plan-workflow`; main remains `a608e01913b7c8ec211fcbac18f9bf325d05402f` and lacks these newer records. DEC-005 was resolved October 2 as a restricted Ad Hoc pilot; do not re-ask Ad Hoc versus TestFlight.

A revised F-006 installed-iPad plan is prepared at [docs/plans/F-006-INSTALLED-IPAD-IMPLEMENTATION-PLAN-2026-10-03.md](plans/F-006-INSTALLED-IPAD-IMPLEMENTATION-PLAN-2026-10-03.md). Recommendation: Capacitor v8 installed app, existing Dexie database for the first pilot, explicit Files backup/restore, bundled assets, zero-network proof and an exact Ad Hoc IPA on Tyler's one registered iPad. Status: awaiting revised plan approval. Approval authorizes native-project/simulator implementation and fictional-data verification within existing access; it does not authorize Apple fees/enrollment, credentials, device registration/distribution, real-student use, merge or release. The most material drawback is dependence on Apple membership, Mac/Xcode and manual signing/update work before the physical pilot can finish.

Fresh PR evidence inspected October 3:

- PR #14 head `b07651b6966b072c57d6982c74da196791447ac5` targets PR #13's feature branch, is clean, and all four current-head checks passed. It fixes external restored-photo requests, affected authorization bypasses and CSV formula injection. Merge approval into the feature branch is pending; this would add the verified repairs to PR #13 and would not merge to main or release the app.
- PR #13 head `ac44af3e6ba738937c535fa87f9aa2c35adc4586` has four passing checks but remains draft and not merge-ready. Its PWA delivery is superseded; valid Mac, touch, recovery and local-report work must be narrowed and combined with PR #14.
- PR #10 head `b300aee33de18ef760deea47868d28a4e6e4a1f4` passed its package check and skipped release as intended. It waits for PR #11 first, then reconciliation/recheck because the instruction files overlap.
- PR #11's previous head `007a3aa5080c2904a60c24dcaa712add1a80d3f4` passed its package check and was clean. Today's authorized planning commits advanced its head, so its refreshed exact-head check must pass before it is presented as merge-ready. No PR #11 merge approval is requested in this briefing.

Recommended integration order remains: finish/check PR #11 → reconcile/recheck PR #10 → integrate PR #14 into PR #13 → narrow/rebase/reverify PR #13 → review PR #13 for main. No release approval is requested.

Lookahead: F-007's local bug draft/preview is verified but private central receipt remains absent. The next consequential choice is adoption of a Tyler-owned private account-free receiver; prepare that brief after the installed-iPad plan decision. F-008 remains discovery-only until current code is available, so no product judgment is requested from stale descriptions.

## October 4 morning briefing

Planning source: PR #11 / `codex/approved-plan-workflow`; main remains `a608e01913b7c8ec211fcbac18f9bf325d05402f` and lacks the newer records.

The stale paid Ad Hoc implementation plan is superseded. Current review plan: [F-006 free installed-iPad pilot](plans/F-006-FREE-IPAD-PILOT-IMPLEMENTATION-PLAN-2026-10-04.md). Recommendation: prepare the Capacitor native project, simulator, local persistence/backup and zero-network checks now; finish installation when Tyler obtains Mac/Xcode access. The free Personal Team build expires after seven days and needs rebuild/reinstallation. Status: awaiting plan approval. Approval authorizes fictional-data native preparation only; no spending, real-student use, distribution, main merge or release.

Fresh PR evidence:

- PR #14 is merged into PR #13's feature branch at `a7c6d941eb704b6f97a41543b6546cebfaccca07`; no main merge or release occurred.
- PR #13 current head `a7c6d941eb704b6f97a41543b6546cebfaccca07` is clean and has successful Windows, browser, Apple Silicon and Intel checks. It remains draft and not ready for main because the PWA scope must be removed/narrowed and the free installed-iPad work remains unapproved.
- PR #10 head `b300aee33de18ef760deea47868d28a4e6e4a1f4` remains clean with a successful package check and skipped release. It waits for PR #11 merge, reconciliation and a fresh check.
- PR #11 head `f05b19ad8eeaf67b67b05bb9d04a9cb2dc6ec440` was clean and passed its package check before today's authorized plan updates. These commits advance the head; inspect the refreshed check before requesting merge approval.

Order: review/merge PR #11 when the current head passes → reconcile/recheck PR #10 → approve and implement the free F-006 preparation → narrow/rebase/reverify PR #13 → review PR #13 for main. No release approval is requested.

Lookahead: hold the F-007 private receiver decision until the F-006 plan is resolved; local report drafting is already verified. F-008 still lacks current source, so no decision brief is assigned from stale summaries. No new learning packet is assigned today.
