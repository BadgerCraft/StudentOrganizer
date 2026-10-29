# Protected App integration acceptance — October 29

Authorized scope: encrypted working data, dated backups and personal-computer transfers in Student Organizer, with separate app keys, local automatic unlock and offline recovery. Synthetic data/keys only. No real-device provisioning, live Drive grant, new service, merge, release or deployment is included. The original plaintext source is retained. This document tracks the stage after prerequisite draft PRs51–53; it does not enable activation.

| Decision/requirement | Implementation and required evidence |
| --- | --- |
| No silent plaintext fallback | Native launch mode precedes App/database imports; protected/pending launches use an attested nonpersistent partition; missing preload or uncertain saves lock instead of opening legacy storage. |
| Durable ordinary editing | All primary/recovery/private writers share the durable gate; changed-record persistence acknowledges only accepted native CAS, with delayed reply, lock/context interruption and no-replay tests. |
| Preserve grade authority and permissions | Canonical schemas, exact byte validation and existing class/teacher checks remain authoritative; native full-workspace policy applies to conversion/export/recovery. No grading formula or finalization change. |
| Independent app/device keys | App/vault/key-version scope, OS-protected keys and independent device identity; exact protected head and pending receipt; current host context checked around awaited proofs. |
| Recovery before conversion | Actual code unwrap and distinct-device possession challenge; new target only; unchanged source digest under the final all-writer lock; default activation capability denied. |
| Large attachments/history | Immutable authenticated chunks/records and small root CAS; unchanged bytes/history not re-encrypted on each edit; lazy history catalog. Full archive and pinned snapshot integration must preserve every retained body. |
| Automatic dated versions and restore | Existing retention settings; manual confirmation; complete selected-body integrity/authority checks; exact pre-restore safety root and monotonically newer restored head. Never reset OS head. |
| Encrypted personal Drive | Separate authenticated transfer purpose, fixed private owner/file identity and native context tickets; existing merge/conflict choices preserved. No live-provider acceptance claimed by mocks. |
| Explicit recovery/export surfaces | Encrypted backups must retain the encrypted master-key recovery wrapper. Actual streaming archive, receiver restart/import and file dialogs require verification. Readable PDF/CSV policy remains a pending user choice; affected protected paths remain blocked meanwhile. |
| Packaging/platform | Reviewed shared contract at PR53; actual Windows compilation and packaged SQLite/DPAPI/receipt probes, plus applicable full browser/build suites at final head. Physical two-computer and power-loss acceptance remain separate. |

Known limitations are not success criteria: encrypting working persistence does not erase original imports/plaintext source, preexisting reports, OS swap/crash dumps or unlocked-process memory. Workspace-only rollback is checked relative to independently retained OS metadata; rollback of the complete matching OS credential state is outside the guarantee. Activation must not claim full coverage while an import/export/recovery or large-file path is incomplete.

## Current source checkpoint

Stage3 integrates prerequisite PR53 head9321a51 (shared crypto and receipt protocol unchanged). Unit/domain/browser checks described in the PR are scoped evidence; the application activation capability remains false. Independent review found and verified repairs for late enrollment after lock, receiver cancellation races, orphaned protected markers, changed-only caching, full-history closure and native rename lost acknowledgment. The corrupt-then-intact same-target archive retry defect is repaired: shared final-seal/AEAD verification now precedes immutable staging, and independent reproduction accepts the intact retry. Full offline-code-only fresh recovery and authenticated aggregate startup preflight are active implementation, not deliberately omitted features. Later final-head evidence supersedes these in-progress statuses.
