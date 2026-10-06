# Integrate Markinator into StudentOrganizer

Implement an assessment-linked marking workflow in StudentOrganizer using the attached Markinator source and discovery review. Treat Markinator as a working workflow reference: reuse sound marking logic and useful UI, but redesign its storage, import, and export paths around StudentOrganizer. Do not embed the prototype wholesale or create a second markbook.

## Outcome

A teacher creates an assignment in StudentOrganizer, adds a rubric, confirms how its criteria map to KTAC, imports student work, matches submissions to the class roster, and works through each submission using the full verified Markinator marking process. When the teacher finalizes feedback and marks, StudentOrganizer automatically records the result against the correct student and assessment through its existing grading services. No manual transfer or duplicate entry should be necessary.

Proceed with implementation and verification on an isolated branch. Inspect the current repository, applicable AGENTS.md and skills, current PR/work-order state, and the supplied discovery package first. Coordinate around existing work, including PR 18 if still active; do not overwrite another branch's changes. Do not merge, release, spend money, or use real student data. Prepare reviewable commits and PR material; create a draft PR if access permits. Ask only for consequential product decisions that cannot be resolved from these instructions or the current code.

## Source context and defaults

The supplied discovery summary reports Markinator version 0.1.0 with May 2026 source timestamps; no Git history proves it is the latest snapshot. Dependency installation, TypeScript/build, and fictional Chromium marking workflows passed. No existing test suite was included. Verify these findings against the actual files before relying on them.

Reported working capabilities: text marking, anchored comments, achievement labels, category summaries, JSON save/load, and printable reports. Reported defects: overlapping highlights disappear visually; unfinished comments are discarded; malformed sessions crash; rubric parsing drops descriptors; imported HTML can execute code and request external resources. Repeated-text anchoring and a stale comments closure were reportedly repaired: confirm the attached snapshot contains the fixes. Sessions currently remain in memory until exported, and Mammoth loads from a CDN.

Use these reversible first-version defaults, while documenting them as assumptions rather than previously approved decisions:

- Assessment-linked sessions first. Standalone scratch marking is outside this batch.
- Arbitrary rubric criteria require teacher-confirmed KTAC mapping.
- First report includes category results, feedback summary, and supporting quotations. Preserve full annotations locally; a full annotated-essay report is a later enhancement.
- The teacher makes grading decisions. Do not add hosted AI, external document processing, or new automated grading.

These defaults define this implementation batch; they are not evidence of earlier product approval. Preserve the prototype's existing local report capability where safe and feasible. If the summary-first default would remove an important existing capability, identify that tradeoff before removing it. Legacy Markinator session JSON compatibility is deferred unless existing sessions are supplied and their preservation is explicitly required; safe Organizer backup/restore remains mandatory.

## Concrete workflow contract

- Markinator is optional for each assessment. Creating assignments without rubrics and existing direct mark entry must continue to work.
- Before implementation, reconstruct the prototype's actual marking sequence from source and available fictional demonstrations. Record every step and capability as retained, redesigned, or deferred, with a reason. The feature list alone is not the definition of the full process. Do not silently drop an existing core marking interaction.
- Rubric input must support manual creation and pasted text/table content. Pasting must lead to a structured preview that preserves descriptors and allows correction. A teacher confirms the rubric and KTAC mapping before marking. File-based rubric import is an extension unless the supplied workflow establishes it as essential; report that limitation explicitly.
- The minimum student-work input set is pasted text, UTF-8 plain-text files, and DOCX parsed with bundled local dependencies. Support multiple files in an import batch. PDF, scanned documents/OCR, and remote document links are deferred first-version assumptions, not supported features. If prototype discovery shows a core supported format would be lost, surface the tradeoff before dropping it.
- Retain original imported files locally alongside immutable normalized document versions; include retained files in backup/restore and authorized deletion. Pasted text has no original file. Preview normalization before committing the import. Annotations anchor to the precise normalized document version; replacing text creates a new version and must not silently relocate comments.
- For the first version, the teacher explicitly enters or confirms the official judgment for each assessed KTAC category using Organizer's supported grading representation. Criterion-level labels and comments are evidence for that judgment; they do not automatically become an average. Preserve Ontario level suffixes if supported. If Organizer cannot represent the required labels or needs a percentage conversion, stop that dependent step and present the exact rule needed. Do not invent a conversion. Categories not assessed remain unassessed, never zero.
- Finalize requires a confirmed rubric/mapping, resolved student association, valid required category judgments, and successful saving of pending feedback/comments. Show a concise preview of the student, assessment, category judgments, and feedback being committed. Teacher finalization performs the transfer automatically; there is no separate copy-to-markbook action.
- Saved category results and feedback must be visible in Organizer's student-assessment detail, with a link to reopen the matching marking session. Define which view owns editing so Organizer and Markinator cannot maintain conflicting feedback copies.
- Reopening creates a draft revision while the last finalized result remains official. Only successful re-finalization replaces the official result. Clearly display draft/revision versus official status. An unresolved conflict with a newer manual mark requires an explicit teacher choice.
- Keep resubmission attempts and their marking histories. Let the teacher select the active attempt; importing or selecting an attempt must not change official marks. A successful finalization changes the official result and records its originating attempt. Preserve multiple attachments within an attempt separately from a new attempt.
- Provide a marking queue showing unmatched, ready, draft, finalized, and revision-in-progress states, with student identity prominent and filtering/navigation suitable for completing a class set.
- If the acting teacher changes or becomes unavailable while a workspace is open, immediately hide protected content, invalidate the workspace's authority, and block queued/autosave/finalization writes using the stale context. Define safe handling of pending edits without exposing them to the newly selected teacher. Check authorization again inside each write transaction.

If available, read `/workspace/markinator-discovery/REVIEW.md`. Otherwise locate the review in the supplied package. Do not claim access to an unavailable path or treat missing verification as passed.

## Explicit integration connections

Before coding, record a concise connection map in the repository: existing source files/services, proposed additions, stable identifiers, ownership checks, data shapes, and read/write direction for each connection below. Use actual repository names, not guessed APIs.

| Connection | Required behaviour |
| --- | --- |
| Assessment creation/detail → rubric editor | Attach a structured, editable rubric to the existing assessment. Preserve criteria, level labels, descriptors, and any supported weights. Allow a rubric to be added after assignment creation. |
| Rubric → KTAC grading model | Map criteria explicitly to Knowledge/Understanding, Thinking, Application, and Communication. Retain mapping and rubric versions used for each marking session. Do not silently invent weighting, average achievement labels, convert levels into percentages, or assign absent categories zero. Reuse established grading rules; present any unresolved conversion rule as a concrete decision. |
| Assessment + class roster → submission import | Open an import queue from the assessment. Match each submission to an existing student using stable IDs and teacher confirmation. Filename/name guesses may suggest a match but cannot silently commit it. Handle unmatched files, duplicate names, duplicate imports, multiple files per student, and resubmissions without overwriting existing work. |
| Import parser → marking document | Parse the minimum formats defined above locally into a safe canonical document with version-bound comment anchors. Provide per-file errors and an import preview. Retain original imported files and distinguish them from normalized marking text. |
| Submission → Markinator workspace | Support the verified marking features, rubric access, anchored comments, achievement labels, category summaries, feedback editing, and previous/next submission navigation. Keep each student's draft isolated. Fix overlapping highlights and unfinished-comment loss. |
| Marking workspace → durable local storage | Persist drafts, comments, annotations, rubric/mapping snapshots, category decisions, and feedback through StudentOrganizer's persistence layer. Recover after reload/restart. Show save failures and pending/unsaved state; navigation must save successfully or protect pending edits. |
| Finalize → grade/feedback domain service → markbook | Finalization writes the correct student-assessment KTAC results and feedback through existing authorized domain services. Inspect and reuse any relevant override service, including `saveGradeOverride` if applicable; do not assume every mark should become an override. The markbook must update immediately and after restart. Draft autosaves must not change official marks. |
| Revision/reopen → grade history and audit | Permit correction without duplicate records. Make repeated finalization idempotent, detect conflicts with manual edits, and preserve audit/history. Apply existing undo/retraction rules where supported; document any limits. Never silently replace a newer mark. |
| Teacher/session context → every read and write | Respect explicit acting-teacher selection and existing ownership boundaries, including checks inside write transactions. Block unauthorized imports, edits, finalization, exports, and cross-teacher access. |
| Persistence → backup/restore and migrations | Include all marking records and necessary local files in the existing portability flow. Validate structure, versions, ownership, references, file sizes, and safe content on restore. Test older backups and existing data. Make necessary migrations additive and recovery-safe; do not introduce schema changes just for UI preferences. |
| Finalized result → local report/export | Generate reports locally from the saved result and rubric version. Escape content and prevent executable HTML or external requests. Reuse existing export conventions where appropriate. Defer legacy Markinator session JSON compatibility unless explicitly required; do not confuse it with mandatory Organizer backup/restore. |
| Feature → Windows/macOS/iPad packaging | Verify bundled parser dependencies, file selection, local attachment persistence, printing/export, keyboard/touch interactions, and restart recovery on platforms available to you. Distinguish browser checks from packaged/native checks. |

Define stable links for teacher, class, assessment, student, submission, rubric version, marking session/revision, and committed grade. Keep StudentOrganizer's existing IDs and markbook authoritative. Explicitly handle assessment/rubric edits and student/class/assessment deletion so linked records do not become unsafe or orphaned. Freeze or version rubrics once used; changes must not retroactively reinterpret completed marks.

For each lifecycle operation, document whether linked records are retained, archived, or deleted under existing Organizer conventions. Deleting original files must not leave broken annotations or unverifiable results. Changing a rubric must create a new version for subsequent sessions; existing drafts remain linked to their original version unless the teacher explicitly migrates them after reviewing the effect.

## Privacy and reliability constraints

Student work, identifying data, annotations, feedback, rubrics, and marks stay on the teacher's device unless the teacher explicitly exports them. Bundle dependencies; remove CDN loading. No telemetry, external images/fonts/scripts, remote parsing, or automatic uploads containing student data. Imported and restored content must not execute code or fetch external resources. Validate all session/backup input and fail gracefully on malformed or unsupported records. Apply bounded file/batch sizes and safe handling of complex document formats.

Keep repository/review fixtures fictional. Do not commit student work or sensitive data. Sharing exemplary essays/feedback with a control panel is a deferred idea, outside this integration. Do not expand bug-report transfer here; if existing reporting is affected, ensure it excludes student content by default.

Finalization must be atomic or use a recoverable, idempotent commit protocol across storage boundaries. A failure must not leave a finalized session with missing grades or partial category writes. Repeated clicks, restart recovery, or retries must not create duplicate marks. Keep existing grade calculations, assessment weighting, overrides, participation behaviour, teacher isolation, and audit guarantees intact.

## Delivery and acceptance

Deliver in dependency order: connection map and data contracts; persistence/migrations; rubric and import; marking workspace; finalization/markbook; backup/report/platform checks. Prefer small coherent commits. Continue through the usable end-to-end workflow rather than stopping after a plan or UI mockup. If a genuine blocker prevents completion, finish independent work and identify the exact missing capability or decision.

Use appropriate existing verification and add meaningful tests for the new integrity boundaries. At minimum demonstrate:

1. A fictional assessment, complete rubric, confirmed KTAC mapping, and batch import with explicit roster matching.
2. Marking two students without draft leakage; repeated-text anchors, overlapping comments, pending comments, and descriptors survive navigation and restart.
3. Drafts leave official marks unchanged. Finalization updates exactly the intended student-assessment category results and feedback, survives restart, and is safe to retry.
4. Reopening/correcting a result and encountering a newer manual grade preserve history and prevent silent overwrites.
5. No acting teacher, a wrong teacher, malformed sessions, malicious HTML, restore payloads, and failed writes are handled safely. Use network-observation checks to confirm imported content makes no external requests.
6. Backup/restore recovers marking data and attachments; existing data and older backups remain usable. Local reports reflect saved results and correct student identity.
7. Relevant existing tests and production build pass. Run available packaged/native checks and list Windows/macOS/iPad gaps explicitly without claiming browser testing proves them.

Also verify rubric paste/manual entry and descriptor preservation; optional rubric-free assessments; DOCX/text/paste input; correct feedback visibility and reopening from Organizer; resubmission selection without grade changes; teacher switching while a save is pending; and safe behaviour when an original document or rubric is revised.

Separate acceptance into three gates:

- Implementation acceptance: the complete fictional end-to-end workflow and integrity checks pass in the available development environment. This alone does not establish native readiness.
- Windows pilot readiness: packaged Windows file import, durable original-file storage, marking, finalization, restart recovery, backup/restore, and local report/export pass using fictional data. Do not call the pilot ready without these checks.
- macOS/iPad readiness: run equivalent platform-specific packaged/native checks, including iPad touch selection/annotation, file picker, background/resume recovery, and export/share behaviour. Each platform remains unverified until its checks pass. Missing platform access may leave these gates blocked while implementation proceeds.

Finish with brief review points: what works end to end, the actual connection map, what was reused versus redesigned, verification evidence, remaining platform gaps, and the single most consequential drawback or decision if one remains. Explain the architecture in plain language so I can judge whether the transplant preserves privacy and data integrity. Include branch, commit, and draft PR details. Do not call the integration complete until the workflow and integrity checks pass, or clearly label the delivered subset and blockers.
