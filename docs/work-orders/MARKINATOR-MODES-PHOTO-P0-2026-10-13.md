# P0 Codex execution order — Markinator modes and photo markup

Owner: Codex implementation environment. Authorized by user October 13, 2026. Branch: codex/markinator-modes-photo-20261013 (based on main). Queue: docs/FEATURE_QUEUE.md F-008-MODES and F-008-PHOTO.

## Model routing
Use GPT-6.1 Codex (Sol) if selectable; verify actual availability. High reasoning for photo/local data/permissions; Medium for bounded three-mode UI work, escalate High if grading authorization or migrations require it. If unavailable choose the strongest available Codex coding model and document selection. Extra High only for unresolved consequential architecture or final integration review.

## Execute without further routine permission
1. Read AGENTS.md, docs/FEATURE_QUEUE.md, docs/markinator/CHECKPOINT.md and live PRs. Reconcile latest main and avoid duplicated work. Preserve any concurrent branches. Inspect marking models, rubric/KTCA flows, local attachment storage, backup/restore and teacher authorization.
2. Implement three entry modes: (a) written essay/document/image markup + rubric, (b) oral presentation customizable checklist + notes + rubric, (c) rubric-only. All must save/reopen and correctly attach to teacher/class/student/assignment.
3. Implement local-only capture/import of photographed handwritten pages in written mode: multiple pages, crop/rotate/reorder, non-destructive visual annotations (pen/highlight/comments), autosave/draft recovery, original retention, reopen and backup/restore. File import fallback where camera unsupported. Do not add OCR, AI cloud processing or remote URLs.
4. Preserve grade history, KTCA weights, audit trail, manual overrides, teacher authorization, cancellation safety, privacy, and existing assessment compatibility. No automatic external student-data transfer.
5. Add tests using fictional data for all three modes, multi-page image markup, restart and backup recovery, wrong-teacher writes, duplicate grade prevention, image URL rejection, and existing marking regressions. Run relevant suites, production build, browser marking acceptance. Record unverified physical Windows/iPad camera/device interactions explicitly.
6. Commit/push verified work and prepare PR(s) with precise evidence, known gaps and next gate. Do not merge/release, adopt providers, spend money, or use real student data without separate authorization.
7. Update F-008-MODES, F-008-PHOTO and workflow validation rows in docs/FEATURE_QUEUE.md as actual work progresses. Do not mark implementation complete based on this order.

Parallelization: split modes and photo into separate branches/worktrees only if isolated ownership and integration plan are verified; otherwise sequence on this branch to avoid conflicts. Continue autonomous approved work until a genuine decision or technical blocker.
