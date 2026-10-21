# Local analytics pipeline (fictional data only)

This is a working summary-event pipeline, not live analytics. The separate owner executable from PR44 now queries ingested events. The teacher executable does not import the analytics modules, register listeners, read a teacher database, capture activity or send anything. `productionAnalytics.activate()` and `capture()` always return false. No environment flag, destination URL, network listener, account, credential or background sender exists.

## Run it

Use the existing repository dependencies (no new packages).

```sh
npm run analytics:demo -- /tmp/student-organizer-analytics-demo
npm run control-panel:build
npm run control-panel:dev
npm run test:analytics
npm run test:analytics:browser
```

Open the Control Panel's **Analytics pipeline** tab. It starts empty; consent to the fictional session and run the local pipeline, or select **Measured test** and import `events-measured-test.json` from the simulator output directory. Demo and measured-test events are separate namespaces; neither represents real installations. Source changes clear session consent and academic-preview permission. Invalid/mixed-source imports leave stored data unchanged. The local browser/owner profile retains only these fictional summaries. Withdrawing purges the selected source and blocks its teachers' replay; Reset explicitly clears the disposable test store and its tombstones. Corrupt storage cannot be overwritten until Reset.

The CLI simulator exercises instrumentation → granted fictional outbox → real filesystem collector ingestion/aggregation → persisted export → dashboard query. It writes `collector.json`, two validated event envelopes and two query snapshots. Running again is idempotent. The browser integration test uses a real CLI collector export, renders actual query totals, restarts the browser page, tests delayed-import withdrawal, and intercepts/asserts zero external requests. The tests use disposable directories. No real analytics service is contacted.

Known truth for each source at October21: six first-observed activated teacher tokens, seven installation tokens, six weekly/monthly active tokens, nine distinct assignments in the monthly window (1.5 per active token), six teachers reusing an assignment, weekly return5/6, monthly return3/6, three failure and two retry operations on1.0.0. Class K percentage77 and assignment K percentage75 snapshots exist for three teachers, suppressed unless explicitly previewed. Labels are approved fictional vocabulary.

## Events and privacy

Schema1 accepts only completed **assignment-level** marking workflows or allowlisted reliability summaries. The instrumentation seam accepts a summary object, never an assessment/session/student record. It is exercised by the simulator; no per-student finalize hook was installed. A future teacher integration must report deliberate assignment-workflow completion after the grading transaction, isolated from grading failures. It must never reinterpret each finalized student submission as an assignment or capture historical activity on enrollment.

Only fictional `sim_` teacher/install/course/assignment/event tokens are supported in this batch. Teacher tokens can span installations, but do not establish unique people or authenticate them. Real pseudonym generation/linkage is an approval gate; student identifiers must never be used or hashed. No names, student IDs, records, photos, documents, comments, individual scores, paths, raw errors, raw titles, or unknown fields are accepted. A malformed batch is rejected atomically. Typed interfaces do not replace runtime validation.

Raw titles are conservatively omitted, including a raw title someone attempts to approve. Only explicit approval of a fixed reporting label (`Practice set`, `Unit assessment`, `Project`, `Course summary`) adds a label. The UI says **Title omitted** otherwise. This deliberately trades arbitrary title detail for a defensible summary boundary. No student-title heuristic or hashing is presented as privacy protection.

Academic summaries require an explicit scale (`percentage-v1` or `level-1-4-v1`), category (`K/T/C/A/overall`), basis (`assignment/class`), bounded sample count and scale-valid average. Fewer than10 samples are rejected before storage. Academic display defaults off and additionally requires configurable minimum teacher and sample counts (UI5 and10). These are conservative fictional demonstration limits, **not proof of anonymity** or production policy. Different scales/categories/bases stay separate; latest snapshot per teacher/course/assignment/context is displayed with its date. Workflow counts repeat across context rows and must not be summed across those rows. No unlike-grade pooling, cross-teacher academic averaging or teacher ranking occurs. Adoption and academic context have separate display sections.

## Metric definitions and observation limits

- Activation is the first **observed** completed assignment workflow in declared continuous observation coverage, not a launch, signup or one student's marking completion. Earlier known activation is reported separately and never becomes a new activation when a query window narrows. There is no signup/conversion denominator because no signup events or accounts exist.
- Weekly/monthly active means a teacher token with a completed workflow in trailing7/30 calendar days including the as-of day, in the event's IANA timezone. Installs are counted separately. A teacher changing timezone uses the event timezone for activity; cohort return days use activation timezone.
- Retention is a second workflow on activation days7–13 (weekly) or30–59 (monthly). Eligibility requires the **entire** return window to have elapsed (at least14/60 local calendar days). Immature cohorts are excluded; a zero or small eligible cohort yields no rate. Numerator and denominator remain visible for fictional inspection. This is bounded observed-cohort return, not lifetime retention. No claim is made about activity before observation, across deleted/withdrawn history, or outside the400-day retention horizon. A production system needs an approved observation/enrollment coverage ledger before it can claim actual first activation or continuous retention.
- Repeat use means at least two completed workflows for the same teacher/course/assignment token within observed coverage. Distinct assignments per monthly active means distinct teacher/course/assignment triples used in the30-day window divided by monthly active teacher tokens; suppressed below minimum cohort. Sharing a label does not collapse distinct assignments.
- Reliability counts allowlisted `save_failed`, `import_failed` and `retry` operations by app version within the declared observation range. There are no raw errors, paths or invented failure percentages; operations denominators are not collected in schema1.

## Storage, retry, withdrawal and recovery

Outbox: at most200 events,50 per explicit flush, three attempts per event, exponential eligible retry delays2s/4s, default5s attempt deadline (maximum configurable30s), and400-day event retention. Full queues reject new events; expiry and exhausted retries drop them. No interval or startup/background flush exists. Capture errors return false and never enter teaching code. Storage failure disables the instance. Consent changes abort cooperative in-flight delivery, purge the queue and increment an operation generation so late callbacks cannot restore it. An already received/exported event cannot be unsent by abort.

Fictional outbox consent is **session scoped**: restart downgrades granted consent and discards unsent events. A fresh grant also clears the queue, so it never replays pre-consent/historical activity. This intentionally favors privacy over analytical completeness. Persistent collector data survives process restart; fictional teacher queues are not a durable delivery promise. Failed withdrawal persistence returns false and is not a successful purge; retained disk bytes require recovery. Restart still fails closed and never resumes them.

Collector: filesystem-backed schema1 store, bounded20,000 events and20,000 permanent teacher/source withdrawal tombstones. Whole batches are validated before mutation. Canonical event IDs are source scoped; identical/reordered replays are no-ops, conflicting payloads reject the complete batch. One instance serializes transactions; cross-process exclusive lock rejects busy competitors for caller retry. Writes use a synced temporary file and atomic rename; this is tested for restart, not a power-loss durability guarantee on every OS. Corrupt/unknown-schema stores are preserved and reject reads/writes. No automatic destructive migration: schema1 is the initial version; later versions must explicitly migrate a recoverable copy. Stale locks after a process crash fail closed; verify no writer exists and preserve a copy before manual test-store recovery. There is no lock stealing.

Ingestion rejects events over400 days old or in the future. Queries exclude expired events; explicit `retain()` or next successful ingestion physically removes expired events. No background retention worker runs. Withdrawal explicitly erases the local collector's teacher/source events and persists a tombstone, including across restart. It does not delete independently exported files or another collector. A future production withdrawal protocol, authorization, destination deletion confirmation, backup retention and legal obligations remain unresolved gates. The local UI is owner-profile tooling, not authentication or production secured hosting.

## Activation gates and reserved work

Real collection remains unavailable until separate approval of destination/hosting/security, teacher consent/withdrawal wording, permitted metadata and titles, academic suppression/aggregation policy, observation coverage, identity scope, retention/export/deletion handling and an explicitly reviewed production integration. No real-user activity should begin simply because these files exist. No accounts/auth rollout, paid service, signing/release/updater changes, deployment or live collection belongs to this PR.

This PR stacks on PR44 stable head `2cab3d8b5fdcc2807beb8dcd88ca19ce867c9014`. Its narrow adapter changes dashboard rendering and browser dashboard assertions only; updater, release bridge, native-test and packaging code match that head. New renderer behavior is browser tested; the updated analytics renderer has not been accepted in a physical Windows/Mac package. PR44's native evidence does not imply new analytics native acceptance. Keep both PRs unmerged until their owners decide.
