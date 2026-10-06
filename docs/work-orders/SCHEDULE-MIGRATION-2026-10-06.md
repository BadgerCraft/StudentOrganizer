# StudentOrganizer schedule migration handoff — October 6, 2026

Status: blocked on unavailable scheduler access; no schedules created, changed, disabled, resumed, or moved by this task.

## Authorized destination and desired timing

Destination: the current primary StudentOrganizer project conversation. No current conversation identifier was exposed to this worker; obtain its identifier from the scheduler's own binding/context when access becomes available.

| Schedule | Desired state | Local time | Timezone |
| --- | --- | --- | --- |
| Morning work batch | Enabled replacement in current conversation | Daily 08:15 | America/Toronto |
| Work results and learning | Enabled replacement in current conversation | Daily 16:00 | America/Toronto |
| Continuation | Keep paused; no activation | Daily 20:15 | America/Toronto |

Use the named timezone rather than a fixed UTC offset so Toronto daylight-saving changes are respected.

## Capability and source evidence

- This worker independently searched the complete callable tool inventory by schedule/automation/reminder names and descriptions: zero matches. A broader task/search/environment inspection exposed environment draft read/update controls, but no scheduler listing, read, creation, update, disabling, run-history, or launch tool. Environment configuration is not schedule configuration.
- Read local snapshots `/tmp/batch-workflow.md`, `/tmp/batch-agents.md`, and `/tmp/batch-learning.md` supplied by the coordinating task. These contain repository workflow rules, not live schedule objects or their exact saved prompts.
- No live old schedule identifiers, exact schedule prompts, conversation bindings, enabled/paused states, run logs, or replacement records could be read. Therefore exact prompt preservation and the old continuation's actual paused state cannot be verified here.
- Current manual Cloud coding has command/file capabilities. That observation does not establish that scheduled runs inherit this machine, checkout, or tools.
- Repository records describe earlier scheduled briefing/GitHub connector evidence and a manually launched October 5 Cloud task. They explicitly leave automatic Cloud dispatch unverified. These are recorded historical assertions, not a freshly inspected scheduled-run tool inventory.

## Preservation constraints from inspected repository records

The October 6–8 batch trial supersedes older daily-rhythm rules. Morning prepares useful decisions and approved execution items; aim for 3–5 substantive items when available, never invent work for a quota. Each consequential decision identifies outcome, recommendation, strongest drawback, evidence/limits, and exact approval consequence. The one-new-learning-brief limit does not cap approved execution throughput.

Afternoon reports actual reviewable outcomes, execution evidence, blockers, interventions, and next action, including a zero-progress report during the trial; then offers brief due learning/optional documentation. Preserve unanswered prompts and actual recall history; silence is not understanding or approval. At the October 8 results check recommend retain/revise/stop from evidence; do not silently reinstate superseded constraints afterward.

Carry approved milestones through implementation, useful verification, routine repairs, and review preparation without asking again for implementation approval. A blocked milestone does not stop independent approved work. Do not authorize new product scope, spending, accounts, real-student use, merges, or releases. Avoid duplicate writers. Read main plus open planning/workflow revisions and state their provenance; use the coherent current administrative records on `codex/batch-work-trial` while applicable. A schedule or saved work order is not execution evidence.

These are source-backed preservation checks, not replacement text reconstructed as though it were the existing exact schedule prompt. The user's instruction to keep 20:15 paused overrides older records describing evening continuation.

## Required migration order once scheduler access exists

1. List and read the three current StudentOrganizer schedule objects and their exact prompts, IDs, local recurrence/timezone, destination conversation, and enabled/paused states. Preserve these records securely for comparison. Read current planning records before changing prompts; preserve existing instructions and approval boundaries.
2. Create the two replacements in this conversation at 08:15 and 16:00 America/Toronto using the exact existing instructions and existing boundaries. Any destination-specific reference must be adjusted minimally and explicitly. Do not reconstruct unknown prompts from repository prose.
3. Read back both replacements. Confirm their IDs, this conversation binding, enabled status, recurrence/timezone, prompt preservation, and boundaries. A successful create request without readback is insufficient.
4. Only after BOTH replacements are confirmed, disable the old morning and afternoon schedules by their verified IDs. Read back their disabled state. Keep the 20:15 continuation paused; do not enable it or create an active continuation replacement.
5. Report the confirmed replacement IDs/destination/times and old disabled/continuation paused states. If confirmation fails, preserve the old schedules and explain the precise incomplete operation.

## Scheduled execution verification

Status: unverified; no scheduler/run-inspection/probe launch capability is present.

At the first actual scheduled run, inspect the callable tool inventory and actual source checkout. Record whether it has shell/file execution tools, `/workspace` source, git repository/branch/commit, runtime version, and usable test/build commands. Avoid printing credentials. Connected GitHub file access alone is not a checkout or executable build environment. Require an actual observed scheduled-run record before concluding environment inheritance or automatic Cloud dispatch works.

If that run lacks coding tools or a checkout, use prepared/launch-pending status and one complete Cloud launch handoff for the approved batch. Do not claim work is running from a schedule, approval, subagent, work order, or this current manual coding task.
