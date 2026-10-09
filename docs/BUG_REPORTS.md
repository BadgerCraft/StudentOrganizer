# Confirmed bug-report ledger

Updated 2026-10-07. Owner: Tyler. No colleague reports have been received through the new reporting UI. Central intake is not configured; see [intake decision](BUG_REPORTING_INTAKE.md).

This file contains sanitized reports confirmed by Tyler or the integrating agent, not local drafts, invented examples, or an automatically public issue inbox. Before adding an entry, remove names, student records, contact details, screenshots, credentials and identifying URLs. Preserve the report's opaque ID so duplicates and fixes can be traced.

| ID | Received date | Safe summary | Platform / build | Reproduction / expected / actual | Status | Duplicate of | Fix / verification evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |

Status vocabulary: Received, Needs reproduction, Confirmed, Planned, Fixed pending verification, Verified, Duplicate, Closed. A copied/downloaded report is not Received until someone actually provides it to the central intake or Tyler. A passing test is not evidence of an unseen colleague report. No automatic submission or ingestion is implemented.

Current execution/approval state is owned by [FEATURE_QUEUE.md](FEATURE_QUEUE.md). Reports are retained here; this ledger does not set a competing work order.

## Tyler's Windows QA findings — 2026-10-05
Received directly in conversation; fictional data only. Expected build from the supplied download: QA 1.0.0-qa.85.1 / b300aee33de18ef760deea47868d28a4e6e4a1f4; actual displayed build ID not independently observed. These are user-reported findings, not reproduced diagnoses. Screenshot attachment was unavailable, so no visual evidence is claimed.

| ID | Type | Report and expected outcome | Status |
| --- | --- | --- | --- |
| QA-20261005-01 | Workflow request | Teacher profile is requested at every launch. Investigate intended session-scoped attribution before proposing remembering a teacher; preserve explicit actor selection and shared-device boundaries. | Needs reproduction |
| QA-20261005-02 | Usability defect | After roster import class view is empty; Populate requires scrolling. Randomize at top appears to do nothing on empty seats. Make the import-to-seating path obvious, with valid enabled states and explanation. | Verified; merged PR18 aa64da1. Roster/seating source64c6a3a; browser flow and combined platform checks. Release/install separate. |
| QA-20261005-03 | Functional defect | After clicking Randomize, Confirm randomize cannot be clicked. Inspect modal validation, selection state and hit targets. | Verified; merged PR18 aa64da1 under the approved roster/seating repair. |
| QA-20261005-04 | Settings defect | No participation buttons configured; only Neutral shows the New button tooltip. Inspect new-class defaults, empty-state guidance and consistent positive/neutral/follow-up behavior. | Needs reproduction |
| QA-20261005-05 | Settings defect | Ontario Achievement-Level Teacher Conversion Preset (Active Version 1) appears as an empty title/section. Inspect missing content versus collapsed/loading state. | Needs reproduction |
| QA-20261005-06 | Workflow request | No easy way to remove students from roster. Plan class unenrollment/archive with confirmation and preservation of assessment/history/audit; do not infer destructive record deletion. | Needs reproduction |
| QA-20261005-07 | Feature request | Photo upload needs quick crop, resize, preview and confirmation. Retain local-only photo processing/validation and cancel preservation. | Planned for scoped review |
| QA-20261005-08 | Workflow request | Unit create/name/rename/edit controls are not discoverable; units seem stored only as metadata. Inspect existing controls before adding duplicates. | Needs reproduction |
| QA-20261005-09 | Feature request | Assessment list should collapse category details to show only overall grade, for formative and summative assessments. Define display aggregation without changing grade calculations. | Planned for scoped review |
| QA-20261005-10 | Display defect/request | Tyler explicitly requests category order K, T, C, A whenever a new assessment is attached. Inspect all affected list/header paths; keep category identity and weights independent of display order. Screenshot not viewed. | Needs reproduction |

The imported-roster → populated-seating → randomize-confirmation repair is complete and merged through PR18. Its exact-source combined checks included browser and actual packaged Windows/Mac persistence/recovery. This is not a blanket pass for every QA finding or the installed colleague copy. The other eight requests remain visible in FEATURE_QUEUE.md for diagnosis/scoped review; no unrelated implementation approval is inferred.
