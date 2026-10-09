# Markinator integration contracts — authorized October 6, 2026

Tyler explicitly authorized the attached work order in this conversation. Base: main aa64da1 (PR18 merged). Isolated branch codex/markinator-integration-20261006. Implementation, verification and review preparation authorized; merge/release remain separate. Shared component-lessons skill unavailable in current catalog; no invented lesson attribution.

## Prototype sequence and disposition

Setup paste/TXT → start → select exact passage → choose rubric category → optional achievement label → type/save feedback → revisit highlight/add another comment → delete feedback → review grouped evidence → enter independent category judgment/comment → return to marking → save/reload session → print summary. Retain these interactions; redesign imports, persistence, overlapping rendering, unfinished drafts and safe export. Add feedback editing. Replace ephemeral JSON session saving with Organizer autosave/backup. Legacy Markinator JSON import deferred by work order. DOCX rubric import deferred in favour of required manual/paste matrix preview; DOCX student-work input is a new required extension. Full essay PDF, voice, AI, standalone marking remain deferred.

## Connections and contracts (before implementation)

| Existing path | New connection and direction | Integrity boundary |
|---|---|---|
| AssessmentHubView / ClassSettingsService.createAssessment | Optional Marking workspace from assessment; no rubric required for existing creation | Existing IDs and direct marking preserved |
| New MarkingWorkspace rubric editor | MarkingService.saveRubric → markingRubrics | Confirmed explicit KTAC mapping; immutable new rubric version on edit |
| Assessment/classEnrollments/students | getContext → explicit import matching → markingAttempts | Stable enrollment IDs, confirmation; unmatched permitted; no filename auto-commit |
| Local parser | bytes → immutable MarkingDocument in attempt | Bounded safe UTF-8/DOCX extraction; raw originals retained locally with hash; text preview |
| MarkingWorkspace | MarkingService.saveDraft → markingSessions | Per-actor durable draft, revision/version checks; no grade writes |
| finalize preview | MarkingService.finalize → existing MarkbookDomainService.saveMarkbookCell/recordCategoryResult + StudentAssessment feedback | One Dexie transaction incl existing grade/audit tables; idempotent; no override service because these are assessment marks |
| MarkbookView/student assessment detail | authoritative StudentAssessment feedback + link back to marking | Draft revisions do not replace official result until finalization; compare baseline of results/assessment changes |
| identityService | epoch-tagged actor context invalidates on every switch/clear | Hide stale workspace immediately; every transaction rechecks teacher/access and epoch |
| PortabilityService | new version4 tables + schema/ref/content validation | Older v2/v3 backups supported; atomic restore includes raw original bytes |
| saved commit | safe local report | Export saved snapshot, escaped strings, no executable markup or remote resources; existing native Files adapter |

New stable UUIDs: markingRubrics, markingAttempts, markingSessions, markingCommits; retained existing teacher/device/class/assessment/enrollment/studentAssessment/result IDs. Annotation offsets bind to immutable document UUID/hash; same text elsewhere is distinct. Multiple documents in one attempt are separate attachments; reimport/replacement creates new attempt (previousAttemptId), retains prior history, never changes grades. Same session revision cannot silently overwrite newer versions. A rubric edit yields new rubric UUID; existing attempts stay pinned. Deleted/archived class/student/enrollment/assessment becomes inaccessible through parent checks; history retained per existing tombstone conventions. Authorized attempt archival retains originals and annotations for recovery; explicit purge must preserve history or reject finalized attempts. Existing grade overrides and participation remain untouched.

All content plain text. Rubric descriptors are a complete matrix, not stored HTML. Imported strings are rendered by React escaping and safe export encoding. All new writes are local; no marking student text added to a remote sender. Official category results use existing scale entries; unsupported labels cannot be silently converted. Category judgments explicitly mark unassessed; absent categories are not zero. Teacher picks/enters official judgments; criterion labels are evidence only.

Lifecycle: draft feedback edits replace draft version with audit; finalize creates immutable commit snapshot; reopen creates draft revision based on official baseline; conflict resolution is an explicit teacher choice to refresh baseline and overwrite only upon a subsequent confirmed finalization. Parent deletion/archive retains linked data inaccessible; original-file deletion is prohibited for retained finalized history. Draft attempt archival is authorized and leaves recoverable tombstone/history. Purge UI is not provided in first version.
