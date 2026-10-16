# Product roadmap

Updated October 14, 2026, America/Toronto.
**Execution, approvals and next actions are owned by [FEATURE_QUEUE.md](FEATURE_QUEUE.md).**
This file describes product scope, not a second feature backlog. Status in older dated paragraphs is historical; consult the current queue and live PR metadata. Current status, completed merges and release gates are maintained only in FEATURE_QUEUE.md; dated evidence below may describe earlier states.

## Current application

| Area | Implemented capability | Delivery limit |
| --- | --- | --- |
| Organizer classroom | Classes/dashboard, student profiles/local photos, seating/attendance/date navigation, configurable participation/Levels1–4 and history, assessments, markbook/category policy, CSV roster/import/export, full validated backup/restore | Base and retained platform/seating fixes merged PR18. Remaining Tyler UI findings are itemized in queue, not assumed delivered. |
| Markinator essay workflow | Versioned manual/pasted rubric and confirmed KTAC mapping; paste/TXT/DOCX batch import/matching; retained originals; passage annotations/comments; queue/drafts/revisions; guarded explicit finalization into Organizer; local summary/quotation reports and full backup | PR20 core integration is merged; consult FEATURE_QUEUE.md for current platform/pilot gates. Exact-source Windows37780989087 and Mac/browser37780989028 both passed:289 tests, build, actual desktop marking/recovery/restart and browser acceptance. Physical iPad and actual old/new installer upgrades remain unverified; no release or installed-copy delivery inferred. |
| Windows/Mac | Packaging and generic actual app restart/recovery checks | Current-schema Windows installed-copy replacement is CI verified; signing/device policy and live release remain separate. |
| Installed iPad (shelved October 14) | Existing bundled native project/assets and prior unsigned SDK evidence preserved | No active iPad work or device gate; resume only on explicit reactivation. See [resume map](SHELVED_FEATURES.md). |
| Bug reporting | Editable local draft, preview, copy/download and error preservation | Central receipt/control panel not configured or verified. |
| Updates | Manual Windows installer check/download, verified backup, and deliberate install/reopen path implemented and tested in CI | Physical Windows/UAC/managed-device acceptance, trusted publisher and live release delivery remain unverified; consult FEATURE_QUEUE.md and live PR metadata. |

## Requested next product scope

- Prepare combined-app pilot and physical-device acceptance; core essay integration development is merged.
- Resolve Tyler's remaining October5 UI requests: actor prompt, participation empty state/tooltips, preset display, roster removal, photo editing preview, unit management, overall-grade collapse, K/T/C/A ordering. Exact IDs/status/authority are in the queue.
- Deliver deliberate bug-only transfer to a private receiver/control panel after concrete provider/access choices. No automatic student/database/page/screenshot attachments.
- Prioritize actual installed Windows/Mac acceptance. iPad camera/touch/Files/signing/renewal work is shelved; retain its code and resume instructions.

## Markinator follow-up — requested October 7

**Modes and local multi-page photo markup implemented on the feature branch; combined UI integration and new export/archive work approved October 14. Verification and delivery status live in FEATURE_QUEUE.md.**

1. Pre-marking mode selection: essay markup + rubric; oral presentation checklist + rubric; rubric only.
2. Photographed handwritten work: capture/import image, comment/annotate, rubric assessment, feedback and existing KTAC finalization. Keep original image/annotations local and correctly linked.
3. Resolve direct image annotation versus optional on-device recognition during planning. OCR is not a prerequisite or newly approved feature.


## Approved desktop follow-through — October 14

- Integrate the latest verified `codex/ui-cleanup-20261013` source with modes/photo work on an isolated branch; inspect actual branch heads rather than replaying the older PR26 implementation. Source review and combined tests belong to the agent, not Tyler.
- Add local annotated PDF export: rendered photographed pages, visual annotations/comments and deliberate rubric feedback. No remote conversion or student-data transfer.
- Add a separate Archive retaining four groups: student/class/assessment/date; final K/T/C/A judgments and marks; the rubric used and written feedback; relevant revision history. Default archival removes original imported student files/photos and image-dependent markup, including internal duplicate/history payloads, while preserving those structured records. **Keep student work** is an explicit, default-off option in export/publish choices to retain selected work sparingly. Existing exported backups cannot be retroactively changed. No new cloud publishing service is authorized.
- Phone capture is now a separately authorized isolated companion workstream (October16), distinct from shelved iPad work. The fictional browser slice chooses class/assignment, retains labeled ordered photos locally and deliberately exports a ZIP for manual desktop matching. Labels never assign students. No roster transfer, backend, automatic upload or desktop manifest importer. See F-008-CAPTURE in the feature queue and its work order; native packaging/device/transfer acceptance remains separate.

## Deliberately deferred

- F-009: selected exemplary essay + feedback repository in the owner control panel. Tyler shelved this October6 to prioritize bug transfer; revisit after transfer works.
- Rubric-file import, PDF/OCR inputs, legacy Markinator JSON and standalone scratch marking remain extensions. Annotated local PDF export is approved October 14 and no longer deferred.
- iPad-specific development/acceptance is shelved at Tyler's request; [resume map](SHELVED_FEATURES.md).
- Live sync/cloud backup, voice/AI and general redo remain deferred. A dedicated Archive with default student-work removal and opt-in retention is approved October 14; implementation/verification status belongs in the queue.
- Release/update-management expansion of the control panel is a future proposal, not current bug-transfer implementation.

## Product constraints and approval boundaries

Student records, source work, photos, rubric/feedback and marking processing remain on-device unless deliberately exported through an approved flow. No automatic uploads, telemetry or remote document/AI processing. Teacher selection remains explicit; participation does not automatically affect formal marks; existing grading rules and audit/history must survive changes. Support on another device does not mean live synchronization.
Implementation approval carries across routine milestones. Merge, release, spending, new provider/access and real-student use remain their actual separately recorded boundaries. Recording a request does not approve every implementation.

## Supporting records

- [FEATURE_QUEUE.md](FEATURE_QUEUE.md): current priorities, authority, status, next actions.
- [BUG_REPORTS.md](BUG_REPORTS.md): original QA findings and evidence.
- [Markinator checkpoint on its implementation branch](https://github.com/BadgerCraft/StudentOrganizer/blob/codex/markinator-integration-20261006/docs/markinator/CHECKPOINT.md): detailed technical handoff; refresh PR20 results where newer.
- [PR18](https://github.com/BadgerCraft/StudentOrganizer/pull/18), [PR19](https://github.com/BadgerCraft/StudentOrganizer/pull/19), [PR20](https://github.com/BadgerCraft/StudentOrganizer/pull/20): delivery/review evidence.
- [Historical roadmap](history/PRODUCT_ROADMAP-through-2026-10-07.md): preserved prior proposals/approval context. Discovery-only Markinator and PWA/paid-iPad proposals there are superseded, not current instructions.
