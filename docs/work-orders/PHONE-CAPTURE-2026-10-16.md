# F-008-CAPTURE — isolated phone companion

## Authority, source and isolation

October16 delegated objective: start the separate phone capture workflow, local implementation, focused tests and review preparation. Tyler explicitly confirmed “the remote” means the phone companion. Earlier design-only/shelved capture entries are superseded by this specific approval. Preserve desktop grading/runtime/student data and all shelved iPad work. No remote repository creation, merge/release/distribution, cloud/provider adoption, real data or phone access is authorized here. This batch prepares local review artifacts; no push or PR creation attempted.

Read live GitHub PR32 metadata: open, **draft**, unmerged, head `5cf5711b51ddd5cb20108d9abcb9b884c0a93d11`; remote main `495ba2af97663123ac332ba258a8c0e7f820ec13`. Parent reports Windows/Mac/shared CI passed at that source; this task does not recertify those CI results or retry the pending ready/merge operation. `git ls-remote --heads`, capture branch search, capture PR search and tracked source inventory found no separate capture implementation. Existing desktop `src/marking/importImages.ts` / `types.ts` already support manual image import and explicit matching; reuse that workflow through files, without runtime coupling.

Worktree `/workspace/StudentOrganizer-capture`, local branch `codex/phone-capture-20261016`, based exactly on PR32 head. Original `/workspace/StudentOrganizer` branch/worktree preserved. All application additions live under `apps/phone-capture`; only queue/roadmap/shelving/learning/work-order documentation changes elsewhere. Root package, lock, source, workflows, Electron and iOS files are unchanged.

## Architecture/scope plan and delivered slice

Use a small TypeScript/Vite browser package, with package-local dependencies/configuration. Reuse familiar Dexie for a separately named IndexedDB database and fflate for a local ZIP, avoiding any native-framework or service decision. Preview server is loopback-only development tooling, not an application backend or deployed service. No service worker, installability/offline cold-start claim or phone provisioning.

Hard-coded fictional class/assignment catalog; JPEG/PNG import and browser camera-input hint; original bytes and labels; local retention/reorder/reload; deliberate export. Class/assignment lock after pages exist. Local mutation uses a committed transaction and optimistic revision check; stale tabs reject instead of overwriting. Read/decode all selected files before a single commit. One active batch with a distinct capture UUID per reset; no roster or student identifier fields in local UI. Labels are explicitly unmatched hints, including duplicates. Reset requires confirmation; export retains originals and reports only a download request.

ZIP v1: numbered generated paths, manifest with order/labels/context hints/byte sizes/SHA-256, every `studentId: null`, every status `unmatched`, explicit matching-required flag, readme with manual desktop steps. Exact original bytes are retained, including metadata. Limits mirror pinned desktop source: 8 MiB/photo, 10 photos, 32 MiB/batch, 20×1024×1024 decoded pixels. The desktop does **not** read this manifest yet; extract and manually group/import the ordered photos, then explicitly choose each student. No desktop database/schema change.

## Component guidance and routing

Read root AGENTS.md, current FEATURE_QUEUE, DEVELOPMENT_LEARNING, relevant capture/roadmap/shelving records; no additional `.agents/skills` exists in this checkout. Read installed `verify-build` and `reuse-component-lessons`. Both referenced shared collection INDEX/workflow backlog reads failed (`failed to read skill resource`); no authoritative current lesson IDs/version or durable lesson updates claimed. Independent verification proceeds around that access gap. The dated queue snapshot says DB001/002 are SQLite-specific: do not treat them as IndexedDB evidence. Instead test actual Dexie rollback/retry, competing connections and real browser persistence for this implementation.

Checked official [Dexie transaction documentation](https://dexie.org/docs/Dexie/Dexie.transaction()) for commit/abort semantics; decoding/hashing remain outside transactions. [HTML capture reference](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/capture) supports treating the camera control as a device-dependent hint, not proof of native camera access.

Repository-authorized bounded reviewer selected `gpt-6.1-sol`, high reasoning: file persistence/export integrity warrants high effort. Reviewer owns only service tests; coordinator owns app/browser/docs. Escalate a reproduced data-loss or matching defect to independent integration review; completion is meaningful tests plus concrete findings, not model selection alone. Subsequent handoff recommendation: same available model/high for import/identity boundaries, medium for documentation; confirm availability in the receiving environment.

## Verification checkpoint

- PASS — `npm run build` in `apps/phone-capture`: TypeScript + production Vite build, 10 modules, main bundle 112.34 kB (39.88 kB gzip).
- PASS — `npm test`: 14/14 focused tests in `tests/store.check.ts`, including failed transaction rollback/retry, two connection race, stale reset/save, exact 8 MiB boundary, batch/page limits, reload, nonmutating ordering, safe ZIP paths, exact bytes/hashes and unmatched duplicate labels. Independent reviewer also passed strict direct test-file TypeScript checking. A test initially used an expensive deep comparison of an 8 MiB array; replaced with byte length plus linear byte comparison, then reran successfully.
- PASS — `npm run test:browser`: actual production app, Linux system Chromium, 390×844 viewport; choose context, two generated fictional photos, label gate/save, reorder/reload, atomic invalid/malformed imports, active label edit + one-click export, actual downloaded ZIP exact bytes/hash/unmatched manifest, retained local originals, competing-tab rejection, cancel/reset/reload. Zero external requests and zero runtime errors observed. Screenshot: package-local ignored `test-results/fictional-phone.png`; inspected for mobile overflow/readability.
- PASS — isolation and source inspection: `git diff --quiet 5cf5711 -- src electron ios package.json package-lock.json .github`; main runtime/config/grades/data untouched. Companion tests use `.check.ts` and explicit local discovery to avoid entering the desktop's default test suite. Root desktop suite not rerun because no desktop code/dependencies/config changed; prior CI is supporting source evidence only.
- PASS — `git diff --check`; inspected new source for credentials, network calls, hidden TODOs, real data and silent student assignment. Fictional status and saved/download-request wording are explicit. Export resets no data automatically.
- UNVERIFIED — native camera/permission dialogs, phone installation, Android lifecycle/quota/capacity, offline cold launch and actual transfer; no access to Tyler’s phone. Browser downloads do not prove a phone transfer or desktop manifest integration. No real-student use or production-readiness claim.

The label interaction was adjusted during review: explicit Save labels and Export commit visible edits before proceeding, so the final active label is included by one Export click. Unsaved navigation prompts remain browser-dependent. Screenshot/build artifacts stay ignored; reproducible tests and lockfile are committed. The companion's isolated prototype and local review preparation are complete; native/product integration gates are not claimed complete.

## Next actions and reserved decisions

Review the isolated package and evidence, then decide the phone delivery/installation surface before provisioning or distributing anything. A local browser prototype is enough to review the workflow but does not choose a native Android container, hosting arrangement or offline installation. Separately scope a real class/assignment handoff and a validated desktop batch importer if desired; neither is required to review this fictional manual-transfer foundation. Keep PR32 pending-step ownership with the parent. Merge/release, real data, deployment, services, iPad reactivation and remote repository creation remain reserved.

## Review preparation

Suggested review title: **Add isolated fictional phone capture companion**. Review only the delta from pinned PR32 head `5cf5711`; opening directly against current main would also show the pending PR32 changes until that source is independently integrated. No PR32 ready/merge action was performed. Local commit and patch are the review deliverables; remote queue publication is pending/not attempted under this delegated local workstream.
