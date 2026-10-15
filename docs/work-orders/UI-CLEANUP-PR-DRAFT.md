Clarify teacher confirmation and repair classroom settings, roster and assessment controls

Teachers can configure participation controls by group, inspect the actual class conversion preset, safely remove a student from an active roster, crop a local photo before saving, manage units, and collapse assessment categories into weighted summaries. KTCA order is consistent in assessment/marking/report views. Cold launch still requires explicit acting-teacher confirmation; a remembered profile only provides a Continue shortcut.

Roster removal archives active membership/seats while retaining student/enrollment identity, marks, observations and audit. Photo cropping remains on-device, with separate Apply/Save boundaries and cancel-safe asynchronous reads. Units keep stable assessment links. Summaries reuse existing calculations and preserve saved course policy/overrides. Transactions enforce current teacher/device/epoch and roll back when identity changes; role checks are retained.

Verified implementation: `5225bd38d9d1a6ae17bb37ec88e72de6baa74b2c`, based on latest main `f25493f70db2e1919573868bdfc18a5b3493491f`. Reuses the previous UI repair source from PR26 rather than duplicating its implementation. Detailed baseline evidence and per-ID results: docs/work-orders/UI-CLEANUP-20261013.md.

Validation: 378 tests/42 files and production build pass; fictional Chromium checks cover teacher confirmation, participation/preset settings, unit create/edit/cancel, weighted collapse/order, photo crop/cancel/late reads and roster/history preservation. Existing marking and four-case category-recovery browser acceptance also pass; zero external requests/page exceptions. WebKit is added to browser CI but locally unavailable. Current CI metadata, Windows/macOS/iPad runtime and OS dialogs remain unverified.

Review identity/cancellation and preserved enrollment/unit IDs first, then grading-display agreement. No grading algorithm, schema, cloud sender, OCR, new marking mode, signing, spending, main merge or release is introduced. Photo input bounds are 10 MB/16 MP with 256px JPEG output and the existing stored-size cap.

Publication note: PR26 is independently identified by Git refs at `f0806ff`; API metadata is Forbidden. Check and update/supersede it deliberately with this successor branch when access returns, avoiding duplicate PRs. This saved text is review preparation, not a claimed PR update.
