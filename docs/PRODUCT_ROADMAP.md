# Product roadmap

Updated October 7, 2026, America/Toronto.
**Execution, approvals and next actions are owned by [FEATURE_QUEUE.md](FEATURE_QUEUE.md).**
This file describes product scope. Current planning source is PR19 / `codex/bug-report-scope-20261006`; preserve this revision until reconciled/merged.

## Current application

| Area | Implemented capability | Delivery limit |
| --- | --- | --- |
| Organizer classroom | Classes/dashboard, student profiles/local photos, seating/attendance/date navigation, configurable participation/Levels1–4 and history, assessments, markbook/category policy, CSV roster/import/export, full validated backup/restore | Base and retained platform/seating fixes merged PR18. Remaining Tyler UI findings are itemized in queue, not assumed delivered. |
| Markinator essay workflow | Versioned manual/pasted rubric and confirmed KTAC mapping; paste/TXT/DOCX batch import/matching; retained originals; passage annotations/comments; queue/drafts/revisions; guarded explicit finalization into Organizer; local summary/quotation reports and full backup | Built on PR20, unmerged. Independent review/repaired browser acceptance passed; latest packaged marking batch has a Windows acceptance failure and pending Mac evidence. No native pilot-readiness claim. |
| Windows/Mac | Packaging and generic actual app restart/recovery checks | Combined marking runtime, signing/device policy, release and installed-copy update remain separate. |
| Installed iPad | Bundled native project/assets and unsigned SDK compilation | Actual device/simulator interaction and free-signing renewal remain unverified; no operational website/PWA is the intended product. |
| Bug reporting | Editable local draft, preview, copy/download and error preservation | Central receipt/control panel not configured or verified. |
| Updates | Manual Windows release-metadata lookup at bottom of Settings | Download/install/reopen is unfinished. |

## Requested next product scope

- Finish current essay integration acceptance and combined-app pilot preparation.
- Resolve Tyler's remaining October5 UI requests: actor prompt, participation empty state/tooltips, preset display, roster removal, photo editing preview, unit management, overall-grade collapse, K/T/C/A ordering. Exact IDs/status/authority are in the queue.
- Deliver deliberate bug-only transfer to a private receiver/control panel after concrete provider/access choices. No automatic student/database/page/screenshot attachments.
- Finish native iPad device acceptance with available access; retain manual full-backup transfer initially.

## Markinator follow-up — requested October 7

**Future scope; current essay integration first. Implementation plan approval pending.**

1. Pre-marking mode selection: essay markup + rubric; oral presentation checklist + rubric; rubric only.
2. Photographed handwritten work: capture/import image, comment/annotate, rubric assessment, feedback and existing KTAC finalization. Keep original image/annotations local and correctly linked.
3. Resolve direct image annotation versus optional on-device recognition during planning. OCR is not a prerequisite or newly approved feature.

## Deliberately deferred

- F-009: selected exemplary essay + feedback repository in the owner control panel. Tyler shelved this October6 to prioritize bug transfer; revisit after transfer works.
- Full annotated-essay export, rubric-file import, PDF/OCR inputs, legacy Markinator JSON and standalone scratch marking remain extensions.
- Live sync/cloud backup, voice/AI, general redo and retained-file purge controls are not delivered or authorized by this roadmap.
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
