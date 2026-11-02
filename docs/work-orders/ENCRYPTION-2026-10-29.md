# Approved encrypted workspace implementation — October 29

Tyler approved encryption for both apps covering working data, backups and personal-computer transfers, with independent app keys, automatic unlocking on trusted own computers and an offline recovery code. Development uses synthetic keys/data only. Activation, real OS credential provisioning, live data, new services/repositories/accounts/paid dependencies, releases/deployments and new PR merges are excluded. Phone capture UI is separately owned.

Base: PR49 merged by explicit “Merge both” authorization at a789e33c62220d2deaac0b6124b1d7e4debf2e97, unchanged reviewed f369624. Four reviewed-head workflows passed; main Windows push workflow40811764419 completed successfully on the merge commit, including package, install-recovery and legacy-bootstrap. Feature branch codex/encrypted-workspace-20261029 preserves merged main.

## Architecture and measurable stages

1. Reviewed reusable authenticated/versioned envelopes: platform AES-256-GCM and HKDF, independent random per-app/vault master keys, authenticated purpose/record/revision/key-version, bounded strict parsing and offline recovery wrapping. Large media needs authenticated chunk/manifest handling; buffered limits must never cause plaintext fallback.
2. OS-protected key adapter: fixed main-owned paths, Windows/macOS secure storage only, no unavailable/basic-text fallback, context validation, restrictive atomic persistence and corruption/interruption tests. Adapter development uses injected mocks; actual keychain acceptance remains unverified.
3. SO vault/migration substrate: encrypted authoritative container, serialized mutations committed before acknowledgement, explicit compare-and-swap revisions and uncertain-outcome locking. Memory working state; existing persistent plaintext Dexie is never described as encrypted. Migration bundles primary records/inline attachments, recovery versions/base and comment bank, verifies recovery and independent second-device enrollment, leaves source untouched and supports rollback.
4. Application integration: ephemeral renderer storage, startup/lock lifecycle, all save paths/attachments, encrypted recovery/transfer, temp/export policies and crash/restart acceptance. No activation control until this entire path passes. Existing plaintext sources/exports are disclosed; retaining source for non-destructive rollback is not secure erasure.
5. Independent security/correctness review, targeted and full tests/build, realistic synthetic interrupted/repeated UI workflows, staged draft PRs and final-head CI. No claims that passing mocks establishes physical two-device or OS keychain acceptance.

Scope inventory is in ENCRYPTION-STORAGE-2026-10-29.md; reusable contract in docs/ENCRYPTION_CONTRACT.md. Shared consumer code remains within this existing repository; a consuming app can vendor the reviewed contract/version with independent keys rather than share secrets or require a new service/framework. No private consumer source is copied into this public repository.

## Official references checked October 29

- Electron safeStorage: https://www.electronjs.org/docs/latest/api/safe-storage — platform protection boundaries and asynchronous APIs; Windows same-user compromise is outside DPAPI protection.
- AES-GCM parameters: https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams — unique nonce and authenticated additional data.
- HKDF parameters: https://developer.mozilla.org/en-US/docs/Web/API/HkdfParams — domain-separated derivation using salt/info.

Repository AGENTS and the existing verification/reuse/explain-back instructions apply. No checkout .agents skill directory exists. Bounded separate file ownership is used for crypto, OS adapter, storage audit and SO integration; an independent read-only reviewer tests the resulting contract. Inherited model/effort is proportionate to consequential storage/security work; escalate actual security/product tradeoffs and failed integrity evidence. Routine technical choices do not reopen settled product approval.

## First-stage verification checkpoint

Full suite: 95 files, 1016 passed and one native-only skipped. Production build passed. Synthetic Chromium exercised authenticated backup roundtrip, cross-app rejection and offline recovery without provisioning or activation. Independent security/correctness review reproduced and fixed retained draft/scope/key aliases and strengthened chunk publication with an authenticated ordered-content seal. Native tests cover exclusive key persistence, corrupt/unsafe files, CAS conflicts, interrupted writes and uncertain durability. Device/Windows durability remains explicitly unverified/fail-closed. No app UI is represented as encrypted. First-stage draft publication and final-head CI follow; actual App integration remains the next owned stage.
