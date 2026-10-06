# F-007 — Bug-report transfer first

Prepared October 6, 2026 after Tyler's explicit scope clarification. Planning/PR preparation is authorized. No receiver has been adopted or deployed.

## Outcome and review key points

Teachers A, B and C deliberately send a previewed bug report to Tyler's private inbox. Tyler can identify the enrolled reporter and registered installation, see the app/build/platform and follow report status. Classroom records and marking stay on-device. The app remains usable without enrollment or network access.

Strongest unresolved tradeoff: a private authenticated receiver requires owner access and an operational service; HTTPS alone does not provide identity, permissions or privacy-safe report contents. Existing account-free form proposals must be reassessed against verified attribution. Do not silently select or provision one.

## PR slices and authorization

1. **This documentation PR:** record F-007's first slice and F-009's deferred exemplar repository. No application behavior change.
2. **Sender/receiver contract and local preparation:** inspect merged main and existing report draft service/modal, define minimal versioned payload and receipt semantics, implement only the approved coherent preparation after the exact plan is accepted. Proposed fields: opaque report ID, enrolled reporter/device references, app version/build, coarse platform, summary/steps/expected/actual. All transmitted fields appear in the preview. Do not claim a typed alias is authenticated. Do not add a Send button claiming delivery before a receiver exists.
3. **Private receiver and installed-app transport:** requires a concrete receiver/access proposal and authorization. Implement enrollment, per-device revocation, teacher submit-only permissions, owner-only inbox, strict field/size validation, rate limits, secure credential storage and explicit foreground Send. Reuse existing draft preservation and failure handling. No broad network-policy relaxation.
4. **End-to-end acceptance:** verify fictional A/B/C reports at the actual private destination; prove attribution, access isolation, revocation, offline/timeout/unknown-delivery handling and no duplicate receipt on deliberate retry. Keep deployment, merge and release decisions explicit.

The immediate next engineering work is to inspect the existing implementation and compare receiver designs capable of the required attribution. Prepare one recommendation with owner setup/access, cost, retention, authentication and supported Windows/Mac/iPad transport limitations before asking Tyler to adopt it. Existing Formspree/Netlify proposals are candidates, not chosen services. No unverified price/free-plan claims.

## Required behavior

- Enrollment identifies a reporter and a particular installation independently of local classroom teacher selection. Reinstallation/revocation behavior is specified; support credentials do not enter classroom backups.
- Report preview shows destination, attribution and complete payload; explicit Send is required. No background uploads or automatic retries.
- Strict allowlist separates reporting data from classroom records. No database access to populate support attachments, screenshots, raw logs, stack traces or student/marking content.
- Free text can still contain private information. Prompt review and removal of identifiers; do not promise automatic sanitization is perfect.
- Receiver stores the minimum support data, restricts inbox access and defines retention/deletion. Provider connection metadata is disclosed.
- A confirmed receipt has a stable report ID. Timeout may mean delivery is unknown; preserve the draft and avoid claiming failure proves nonreceipt.
- Narrowly authorize the reporting connection on each installed platform while retaining existing classroom network denial. Updates remain a separate route.
- Do not open public GitHub issues containing teacher reports automatically.

## Evidence to require before calling transfer complete

- Exact sender contract is tested against missing/unknown/oversized fields and excludes classroom objects.
- Enrollment credentials authenticate attribution; spoofed/revoked credentials fail, and teacher credentials cannot read the owner inbox or other teachers' reports.
- Offline and interrupted requests preserve edits; explicit retry does not duplicate reports.
- A, B and C fictional reports are observed in the private inbox with correct device and build labels.
- Installed Windows/Mac/iPad transport is verified independently; browser evidence alone does not establish native behavior.
- Existing classroom, draft recovery and backup/restore checks remain green. Report only tested platform scope.

## F-009 — Shared assessment/exemplar repository (deferred)

Tyler wants an optional deliberate transfer of a strong essay plus its feedback to the control panel, creating a repository of assessments to work from. Revisit when F-007 private receipt works. This is a recorded future request, not approval to implement or transmit student work. Future planning must define permitted contributions, consent/authorization, de-identification limits, ownership/access, retention/deletion and any relationship to F-008 marking integration.

## Current integration context

PR #18 was observed merged to main at aa64da1b9cc3a98d7f77fd797c0dfe7bd0a6fb9b on October 6. PR #17 remains a separate open administrative change; preserve its newer records when reconciling documentation. This plan changes no application code and claims no sender/receiver deployment or new application checks.
