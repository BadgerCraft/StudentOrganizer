# F-006 batch reconciliation review — October 6, 2026

## Exact sources and preservation

Reviewed PR #15 source `a77fe406105f4153f9cb70f5c8af458fb0bee1aa` against PR #13 target `a6dd17365d3b474e50393dad3da64f1df74708ee`. Merged the target into the source branch only, producing `6887e7f5d52f0823bac408359d80dc20de5f3a3d`; this retains the target addition to `docs/BUG_REPORTS.md`. No target/main merge, release, signing account, distribution, or real student data is authorized or performed.

## Verification

Node `v24.19.0`; frozen-lockfile `npm ci --cache /tmp/batch-native-npm-cache` succeeded. The initial default npm cache was outside writable roots; the owned temporary cache solved installation without disabling integrity checks.

- `npm test`: 23 files, 191 tests passed.
- `npm run ios:prepare`: TypeScript/production build and native asset synchronization passed; existing bundle-size warning remains.
- `npm run test:ipad:assets`: stable identity/origin, restrictive CSP, no service worker, exact synchronized asset bytes, registered Swift boundary sources passed. Static evidence only.
- System Chromium production smoke passed: portrait/landscape/split view, touch seat swapping, attendance, observation, local photo, assessment/K mark, roster/CSV/backup, confirmed replacement, complete collection comparison after clean-profile restore, process restart and local report draft persistence. Zero observed external application requests; no page errors. Initial browser invocation preceded completion of its production build; rerunning after build completion passed.

## Native Files and storage review

Application ID `ca.on.teacher.assessment`, origin `capacitor://localhost`, and Dexie database `OntarioTeacherAssessmentDB` remain unchanged. Native selection does not write the database. Picker cancellation returns no selection; provider/UTF-8 read errors reject before the existing JS validator and explicit transactional replacement. Export uses protected atomic temporary JSON and removes its temporary directory on completion/cancellation/error. Actual provider export completion, Files dialog interaction, WKWebView behavior, update retention and seven-day renewal still require supported native/device checks. Source inspection is not those checks.

The bridge replaces direct HTTP and mutable asset-path APIs, restricts navigation to the bundled stable origin, refuses new windows, and loads the page only after its WebKit HTTP/WebSocket content rule is installed. Actual native network denial requires runtime observation.

## Mac failure diagnosis and remaining gates

This Linux machine has neither `xcodebuild` nor Swift/macOS tooling. `npm run test:mac:packages` deliberately rejected execution with “Actual package smoke requires a Mac runner.” This is an unavailable-platform check, not evidence of a repaired package. Existing Mac CI performs credential-free ad-hoc DMG/ZIP package/restart checks. This revision adds an ARM-runner credential-free iOS simulator compilation gate using an already-installed Xcode 26+; it neither downloads Xcode nor signs/distributes an app. Exact compilation output is retained as `release/ios-build.log`. The new CI gate has not run in this Linux task; supported simulator launch/interaction checks remain separate. Prior reported ARM package compilation succeeded and actual package smoke failed; exact failing logs remain unavailable to this task. Do not infer a cause from the job status.

Static regression comparison found no change to `electron/main.cjs` or `macPackagesSmoke.ts`. CSP changes deny connections/workers, preserving scripts/styles/local photo/blob resources; native Files is selected only on native iOS and desktop backup/import keeps its prior browser paths. No evidence-backed Mac repair was identified. Fresh supported Mac package results and credential-free Xcode 26+ native compile/simulator results remain necessary before native acceptance. Physical free-signed iPad Files/offline/restart/update/renewal checks remain unrun.

## Shared component lessons

Current administrative AGENTS.md requires the external `reuse-component-lessons` collection. Its authoritative skill/lesson text was not available in the discovered catalogs. Coordinator records that access gap; no lesson-specific claim or speculative fix is inferred from lesson IDs alone. Existing repository preservation and validation rules were applied.

## Review recommendation

Reconciliation and Linux/shared UI checks are reviewable. Keep native/Mac acceptance open: obtain the actual failing Mac smoke log and run the exact reviewed head on supported macOS/Xcode/iPad before claiming installation readiness. Do not merge, release, distribute, or introduce real records on the strength of browser/static evidence.

## Native compile gate verification

The added workflow shell was checked with `bash -n`. Its installed-Xcode selection and `pipefail` preserve failure results and fail clearly if Xcode 26+ is absent. Compilation is prepared for the existing PR-triggered Actions workflow, not claimed executed.
