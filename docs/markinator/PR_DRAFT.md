# Add local Markinator modes and recoverable photographed-page markup

Previously assessment-linked marking required text documents. Teachers can now choose written document/image marking, an oral presentation checklist with private notes, or rubric-only evidence. Every mode pins a confirmed rubric and explicit student; evidence labels/checks stay separate from official category judgments and the existing deliberate finalization path.

Photographed JPEG/PNG/WebP pages stay local with immutable originals. Crop/rotation/order, pen/highlight/comment anchors and edits are stored separately and survive autosave, reopen and full backup restore. A metadata-neutral temporary decode copy prevents EXIF from changing coordinate axes; delayed previews cannot accept marks on the wrong page. Legacy written drafts remain usable, including first edits to new per-criterion feedback.

Existing teacher/epoch/version authorization, atomic audit/mark/finalization/restore, manual-mark review, immutable history, completion policy and grade overrides are retained. Student reports include rubric feedback and textual page comments; original images/strokes and oral private observations remain excluded. No OCR, remote URLs, cloud processing, new dependencies or schema version.

Normally pushed and independently read back. Verified implementation: **`0347d94535e67b19a3f54ee02170f7e3af1aee63`** on `codex/markinator-modes-photo-20261013`, based on `4bd96c6` / main `5a769cb`.

- **392 tests / 37 files pass**; production TypeScript/Vite build passes.
- **Nine modes/photo browser groups pass**: EXIF6/3/8/2 axes and original anchors, delayed decoders, four-page capture-file/import, pen/highlight/comment/crop/rotate/reorder, autosave/reload/edit/finalize/revision, oral/rubric-only recovery, legacy matrix, rejected domain boundaries and actual clean-profile full backup restore. Zero external requests/errors.
- Final production marking browser, existing input/authority/portability and four category-recovery browser scenarios pass. Atomic storage failure and wrong-teacher/stale identity regressions preserve records and grades.
- iOS asset sync/static audit and photo purpose descriptions pass; independent integration review reproduced and verified repairs to legacy feedback initialization, EXIF axes and stale canvas races.
- Existing browser CI now runs the new acceptance command and retains result/screenshots; workflow parses. New-head CI remains unobserved.

Remaining gates: physical Windows/Mac/iPad camera/file-picker/permission/touch/background/process-restart/recovery checks; simulator/Xcode unavailable here. Native large-photo storage/quota behavior is not established. Immutable originals plus audit snapshots grow local storage/backups. Full annotated-image export remains separately scoped. Mixed-import/chunk build warnings persist.

GitHub GraphQL and REST PR listing return Forbidden. Existing draft state cannot be checked; creation/update is pending API access. This file is the complete saved PR body. Main merge, release/distribution/signing/spending/provider adoption and real student data remain unauthorized. Preserve the independently verified UI cleanup branch; integration with it is a separate review gate.

Full evidence and next routing: [approved work order](https://github.com/BadgerCraft/StudentOrganizer/blob/codex/markinator-modes-photo-20261013/docs/work-orders/MARKINATOR-MODES-PHOTO-P0-2026-10-13.md) and [checkpoint](https://github.com/BadgerCraft/StudentOrganizer/blob/codex/markinator-modes-photo-20261013/docs/markinator/CHECKPOINT.md).
