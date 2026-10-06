# F-007 — Receiver decision for attributed private bug reports

Prepared October 6, 2026. Recommendation, not adopted service. No account, deployment, report transmission or application change performed.

## Key points for Tyler

- Recommend a small Supabase Free backend for support identities, registered devices and private bug reports, with a minimal owner inbox.
- Teachers sign in to an owner-enrolled support account; support sign-in does not gate offline classroom use. This deliberately revises the earlier account-free reporter objective because verified reporter attribution is now requested. Tyler must accept that product tradeoff explicitly.
- App payload is previewed and deliberately sent. No student database, essay, marks, screenshots or general telemetry are connected. Owner alone reads/updates the inbox; teachers submit and receive their own minimal receipt/status.
- Free is listed at $0/month, two active projects, 500 MB database; free projects pause after a week of inactivity and have no automatic database backups. This supports a small disposable fictional-data pilot, not a reliable production availability promise.
- Strongest drawback: support becomes dependent on an online provider/account and teacher enrollment; a quiet free pilot can pause. Classroom operation remains independent.
- Proposed retention for pilot: report text removed after 90 days, retaining only minimal non-content audit/receipt identifiers as necessary; require a tested deletion procedure and owner export/recovery. This is proposed, not an active retention policy.
- Approval would authorize bug-only implementation and verification against this design with fictional data, no paid upgrade, student work, merge, release or teacher invitation sending. Actual owner account/access setup is a named prerequisite to live acceptance; provide a secure setup handoff once implementation is ready.

## Alternatives considered

| Route | Fit | Limitation |
| --- | --- | --- |
| Existing private email/manual report export | Can use existing access and identify a sender | No integrated receipt/device enrollment/owner panel; not the requested end-to-end transfer |
| Account-free form receiver from prior F-007 packet | Lower reporter friction | Submitted name/device label is not verified identity; authenticated enrollment would require additional design |
| Managed Auth/database receiver (recommended) | Uses managed sign-in and server-enforced access instead of inventing account authentication | New provider and support accounts; free availability, mail and native-session constraints |
| Custom per-device invitation/token receiver | Can avoid teacher accounts | Requires custom enrollment, credential lifecycle, abuse controls and storage; more security implementation to maintain |

This is an architectural fit comparison, not a verified cost comparison across all providers.

## Concrete preparation and implementation

1. Inspect exact current merged main, report drafts, network denial, Electron native bridge and iPad storage/access boundaries. Coordinate separate ownership with the ongoing Markinator integration; bug reporting must not write classroom tables.
2. Define support identity separately from local teacher selection. Server verifies the authenticated support identity and ownership/revocation of the registered device on every submission. Device IDs are registration labels, not hardware attestation.
3. Use server-side schema/size validation, stable report ID plus sender identity for duplicate-safe receipt, and reject changed-payload retries. Restrict allowed operations; never ship service-role/secret keys in app binaries or owner frontend.
4. Define signed-in transport and OS-secure session storage for each supported platform. Do not use default web localStorage for long-lived support credentials in an installed client; platform secure-storage capability is a feasibility checkpoint.
5. Build minimal owner inbox for enrolled reporters/devices, list/detail/status and access revocation. Initially it may be an installed owner view; separate web hosting is not assumed or authorized.
6. Preserve draft/receipt on offline, canceled and unknown-delivery outcomes. No background sender/retry or weakening of classroom network denial.
7. Test spoofed identity, revoked installation, teacher read denial, owner access, payload exclusions/oversize, retries, offline preservation and actual fictional receipt independently. Available browser checks do not establish physical iPad operation.

## Enrollment/mail constraint

Official Supabase docs say default Auth email only serves organization team addresses and is limited to two emails/hour. Do not add teachers as organization administrators to work around this. Automated email invitations/password recovery require separate SMTP setup or an alternative documented flow. For a small pilot, owner-assisted account enrollment/password setup and recovery can be evaluated without automated email, but identity verification and secure credential delivery must be explicit. Do not invent a working invite/deep-link flow, auto-confirm unknown email ownership, or send teacher invitations without authorization.

## Evidence and limits

Primary official sources checked October 6:
- https://supabase.com/pricing — Free $0; pause after week inactivity, project/database limits; no automatic backups.
- https://supabase.com/docs/guides/database/secure-data — secret/service-role keys bypass RLS and must never be exposed in frontend.
- https://supabase.com/docs/guides/api/securing-your-api — grants/RLS and request controls must restrict actual access.
- https://supabase.com/docs/guides/auth/auth-smtp — default email team-only/two per hour; configured SMTP required for general Auth mail.
- https://supabase.com/docs/reference/javascript/auth-admin-createuser — server-only admin creation; email confirmation assertion is not independent evidence of ownership.

Shared lessons consulted: component index v8 and database v6, October 6. DB-001/DB-002 SQLite results do not prove PostgreSQL/network idempotency; adapt their distinction between atomicity and stable identity by requiring separate report receipt/retry tests. DB-003/004 Dexie seat-index fixes do not apply to hosted authentication/access policy. No Supabase runtime result or verified security verdict is claimed.

## Decision

Approve Supabase Free as the bug-only pilot design, including teacher support sign-in and a minimal private owner inbox? Implementation can then proceed through available local checks and review preparation; account/access setup, real private receipt and platform acceptance remain named milestones rather than completion claims. No spending, student uploads, merge or release.
