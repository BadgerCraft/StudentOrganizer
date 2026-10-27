# Windows exact-head CI — PR48

Run: https://github.com/BadgerCraft/StudentOrganizer/actions/runs/40101147349
Head: `889b82a7242928b97990cecb0f727be3fb4f2fc4`
Observed terminal run status `completed`, conclusion `success` through connected GitHub read API on 2026-10-24.

| Job | ID | Conclusion |
| --- | --- | --- |
| package | 120893376872 | success |
| legacy-bootstrap | 120893376998 | success |
| install-recovery | 120893377084 | success |
| release | 120895437385 | skipped |

Package steps passed: unit tests; pinned speech-runtime preparation; Windows installer/portable build; packaged speech-runtime check; actual PDF renderer/save cancellation; installed updater IPC; portable/installed app checks; assessment creation; resource policy/authorized profile save; stable A/B installer build; production download/backup/installer replacement/reopen; checksum/publisher recording and evidence upload.

Legacy-bootstrap passed pinned pre-updater installer → current destination and old-backup recovery. Install-recovery passed deliberate post-launch failure → repair → verified backup recovery. No failed steps observed; no rerun, mutation, release or deployment performed. Polls were >=50 seconds apart. Native CI establishes automated Windows runtime evidence, not physical-user/UAC/device acceptance.
