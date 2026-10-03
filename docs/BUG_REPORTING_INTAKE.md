# Private colleague bug-report intake

Research checked 2026-10-01. F-007's local draft UI is implemented. Central delivery is **not connected**. No provider account, endpoint, hosting project, notification recipient, live report, or paid plan was created.

## Proposed route for Tyler's decision

Use a Tyler-owned **Formspree Free** form for the small fictional-data colleague QA pilot. Colleagues submit without creating accounts; Tyler alone owns the intake account and receives private notifications. This is an intake for manually described bugs, never a student-data destination. Formspree's official HTML setup uses a provider form ID as the public submission address and requires the owner to create a form. Reports arrive in its dashboard. The public address is not a secret or proof of reporter identity.

Source: [Formspree HTML setup](https://formspree.io/html/).

The checked Free plan is for testing/development: $0, 50 submissions/month, one team member, 30-day submission history and no file uploads. AJAX forms are available and support cross-origin submission. The monthly Personal price is **USD $15**, or USD $120/year; this proposal authorizes neither paid upgrade nor annual commitment. Free is appropriate for this QA recommendation; broader production use needs a fresh plan choice. Owner credentials and any API keys stay out of the app. Reading the central inbox programmatically requires a separate access plan; a public form ID only accepts submissions.

Source: [Formspree plans](https://formspree.io/plans/).

The Free account can link two notification emails. It warns as allowance use approaches the limit; retention beyond 30 days must be addressed before treating its dashboard as a durable central ledger.

Source: [Formspree account limits](https://help.formspree.io/articles/account-management/account-limits).

### Concrete decision needed

Approve Formspree as a new external recipient of edited fictional-data bug text, designate the account owner and notification address, and create/verify the form under that account. No existing authorized Formspree endpoint is established in this repository or session. Until that happens, the app truthfully offers local draft/preview/copy/download only. It has no submission button and makes no network request.

The agent can implement the remaining route after provider authorization and a real form ID:

1. Show the configured provider/destination next to an explicit consent action. Send exactly the previewed text plus its opaque report ID; no raw page, URL, stack trace, database, screenshot or teacher identity is collected automatically.
2. Use a fixed, reviewable provider URL in build configuration, not an arbitrary editable endpoint, and no privileged browser-side credential.
3. Bound input length and request duration; prevent duplicate concurrent submission; retain the draft on offline, quota, rejected response, CAPTCHA, timeout and unknown delivery outcome. Do not retry automatically or equate HTTP request initiation with receipt.
4. Exercise a synthetic report from deployed HTTPS, packaged Windows Electron (`file:` origin), and packaged Mac. The general cross-origin statement does not prove file-origin/CAPTCHA compatibility. If desktop in-app delivery fails, a hosted provider form opened in the system browser is a fallback with a separate user submission; never claim that opening a form sent a report.
5. Verify actual receipt privately in Tyler's dashboard/notification before labelling central delivery complete. Record the provider receipt and report ID. Copy sanitized, confirmed entries into `docs/BUG_REPORTS.md` through the review workflow; no automatic public issue creation.

AJAX validation/failure handling is documented, but no sender or dependency was added before the provider choice.

Source: [Formspree JavaScript submission](https://help.formspree.io/articles/building-your-form/submit-forms-with-javascript-ajax).

## Alternative worth considering if iPad hosting is approved

**Netlify Forms** can collect a static form deployed on a Netlify site and expose submissions to the site's team. Reusing an approved iPad hosting account may avoid another service. Form detection/setup and redeployment are required. React-rendered markup alone does not establish a detected form. This is not available merely because the project has a local web build.

Source: [Netlify form setup](https://docs.netlify.com/manage/forms/setup/).

Netlify documents private dashboard submission management and cautions against storing sensitive data. Its credit-based plans currently provide free form submissions, while legacy plans have different metered billing. Choose the actual account/plan and notification access before promising no cost. No Netlify site or account is established by this implementation.

Sources: [Netlify submissions](https://docs.netlify.com/manage/forms/submissions/), [Netlify forms usage/billing](https://docs.netlify.com/manage/forms/usage-and-billing/).

## Local implementation and limits

`BugReportModal` stores one editable draft in browser/Electron local storage separate from classroom IndexedDB. The draft is local to this installation/origin and is not included in classroom backups or transferred to another device. App version, a hexadecimal build SHA when configured, coarse platform and allowlisted screen are the only automatic environment details; the editable preview can remove them. An unset/invalid `VITE_BUILD_SHA` is shown as `unknown`; a development build does not pretend to identify a committed release. It includes an opaque report ID for future matching. It never imports database records. User-entered text is not automatically guaranteed free of personal data, so the visible reminder and review remain necessary.

Quota/security errors retain the in-memory text, show that saving failed, and warn on closing. Corrupt saved content is left intact until explicit clear/replacement. Clipboard/download failures have visible messages and manual preview copy remains available. A local draft is not a central received report.

Component lessons checked: authoritative index v2 (2026-10-01) contains only Python SQLite DB-001/DB-002. Those transactions do not apply directly to Web Storage; no SQLite guarantee is claimed. The local draft design instead tests quota/read/clear failures and preservation of the previous saved draft. This bounded feature does not modify classroom database migrations or recovery.

## Verification at implementation handoff

- PASS: `npm test -- src/services/bugReportService.test.ts`, seven tests covering restore, exact edited preview, quota preservation, unreadable data, unavailable storage, oversized input, unknown-field normalization and coarse metadata.
- PASS: integrated `npm run build` after navigation wiring.
- UNVERIFIED: `node --import tsx src/benchmarks/bugReportSmokeTest.ts` cannot launch because Playwright Chromium 1243 is absent. The platform agent's ordinary browser download attempts returned invalid/truncated archives. The runnable UI check covers real report navigation, reload recovery, edited text download, clipboard failure, quota warning/dismissal protection and no external report requests; it must run in an environment with an installed browser before claiming browser verification.
- NOT CONNECTED: central receipt, provider quota/network/CAPTCHA handling and packaged-origin delivery; no live endpoint is configured or authorized.
