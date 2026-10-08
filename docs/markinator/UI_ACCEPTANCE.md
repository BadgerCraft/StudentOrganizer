# Expanded Markinator UI acceptance — October 7, 2026

Completed on branch `codex/markinator-integration-20261006`. Source/test commit: `03406616e152b748aadff946aec4b440c6dae538`. Newer roadmap documentation at `8da3bf9` was preserved. This is development-browser evidence; independent integration review and native runtime checks remain separate batches.

## Verified workflows

| Command | Actual UI sequence and checked result |
| --- | --- |
| `npm run test:marking:inputs` | Manually enter a two-criterion/four-label descriptor matrix; reject a duplicate label and malformed pasted replacement without losing descriptors; correct custom labels and save exact KTAC mappings. |
| Same suite | Group two TXT attachments for one student, comment independently on each, import an explicitly linked resubmission, return to the predecessor and reload. Original bytes, document-bound comments and both attempts remain intact. |
| Same suite | Select malformed DOCX, unsupported PDF, invalid UTF-8, a simulated unreadable file and a valid remainder. Named errors appear; preview makes no writes; only the explicitly matched valid remainder imports. |
| Same suite | Fail the second batch item's audit write after its attempt write. That transaction rolls back, the first item/audit remains once, the failed item's roster choice stays visible, retry creates each item/audit exactly once, and duplicate reimport is rejected. Official records remain unchanged. |
| `npm run test:marking:authority` | Edit feedback with autosave still pending, switch teacher through the UI, and return/reload. Pending feedback was saved before switching; a different authorized co-teacher cannot see the first teacher's private submission or comments. |
| Same suite | Inject a session storage failure; Back to Organizer, Switch teacher and Rubric editor stay blocked with unsaved feedback intact. Retry saves successfully, then navigation/switch/reopen recover the feedback. Existing official marks remain unchanged. |
| Same suite | Revoke the identity epoch, and separately suspend membership in another authorized fictional context. Protected marking content disappears, pending/stale writes reject, and saved session/official records remain unchanged. Revocation does not authorize a last write of unsaved data. |
| `npm run test:marking:portability` | Change an official mark in another authorized context; finalization rejects stale state. Explicit UI review/acceptance permits later confirmed finalization. A simulated read failure after commit is retried through the UI with the same commit, mark records and audit count. |
| Same suite | Download a full backup; preview it in a fresh profile with no marking records; confirm restore; reload/reopen. Preview does not write. Attempts, rubrics, finalized/revision sessions, pending annotation, original bytes/hashes and official results restore exactly. |
| Same suite | Download the saved report before/after the newer draft and restore; bytes remain identical. Hostile-looking fictional names/feedback remain literal text with no executable elements or remote requests. Print media and headless Chromium PDF generation pass; extracted PDF text and first-page rendering were inspected. |
| Same suite | Remove unassessed C in a second authorized context, then click the historical Report button. It now downloads byte-identical saved HTML; neither session nor official results change. This failed before the report repair with “A saved category is unavailable for this report.” |

All three suites finish with zero external requests and unhandled browser exceptions. `npm run test:marking:acceptance` runs those three commands sequentially. Their individual final runs passed; the aggregate is a convenience wrapper, not an additional claimed run.

## Final checks and reuse of evidence

- Full Vitest run: **281 tests passed across 31 files**. The three new service regressions cover immutable saved report categories for current/legacy sessions and private/stale-identity export rejection. The two category-snapshot cases failed before repair; all 35 focused marking-service/report tests passed afterward.
- Production TypeScript/Vite build passed with existing chunk/import warnings. The existing `npm run test:marking:browser` production flow was rerun after the final report fix and passed, including report download, with zero external requests.
- Input and authority acceptance finished before the report-only repair; their exercised code paths were unchanged, so those successful checks were reused. The complete portability flow was rerun after repair. Earlier category-recovery browser evidence was retained; all category-recovery unit regressions also passed in the new full suite.
- Fixtures use fresh fictional browser profiles. Vite module access is limited to setup/explicit authorized context changes and failure injection; teacher operations, import confirmation, reconciliation, downloads and restore confirmation use visible UI controls. Vite watching is disabled so parallel source edits cannot silently restart a test page.

## Limits and next batch

Cloud Chromium blocks `file://` navigation. The exact downloaded HTML was served alone over loopback without Vite HTML transforms or app scripts for printing checks. This verifies report contents/layout and Chromium PDF generation, not native file associations, system print dialogs, printers or Windows/macOS/iPad behavior. Reload/reopen is browser-app restart evidence, not device/background/resume acceptance.

The resubmission link is explicit during import and preserved in records; queue rows identify attempts by filename/status/time, without a separate relationship label. This is a display limitation for later review, not missing history or a new behavior introduced here. No modes, handwritten-photo/OCR feature, cloud processing or unrelated application repair was added.

Next: independent review of the complete integration diff and these verification limits. Then run supported platform/native acceptance and actual CI checks. GitHub PR listing remains blocked by Forbidden; saved PR text is in `PR_DRAFT.md`. No PR creation, merge, release, distribution, spending or real student data is claimed.

Temporary evidence is regenerable: `/tmp/markinator-expanded-tests.json`, `/tmp/markinator-expanded-build.log`, `/tmp/markinator-expanded-production-browser.log`, `/tmp/markinator-input-acceptance.log`, `/tmp/marking-authority-acceptance-final.log`, `/tmp/markinator-portability-final.log`, `/tmp/markinator-portability-results.json`, and `/tmp/markinator-portability-report.pdf`. Pre-fix report evidence is in `/tmp/markinator-report-before.log` and `/tmp/markinator-portability-historical-before.log`. These files are not needed for continuation.
