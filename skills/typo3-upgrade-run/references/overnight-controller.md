# Unattended controller contract

## Architecture

The graph selects the next job; a worker solves that bounded job; deterministic tools judge the
evidence. A worker can be the current agent. Extra agents require user/runtime authorization and
compatible resource claims. No queue service, new database, agent framework or always-running daemon is
needed: `state.json` is the control record, `journal.jsonl` the audit trail, and reports are derived.

Prepare a job packet with node id, one objective, exact input paths/hashes, authorized files/data,
rollback anchor, remaining attempt/time budget, canonical checks and expected result path. Load the
node's owner skill and only its required references. Return outcome, command exits, artifact paths,
changed inputs, unresolved findings and next required decision; do not return a conversation dump.

## Admission and prediction

Seal nine size metrics with `runtime-seal`, then write a single
`nodes/intake/runtime-plan.json`. This is a **format excerpt**, not a complete runnable plan:

```json
{
  "schema": "typo3-upgrade-run/runtime-plan@1",
  "run_id": "<state.run_id>",
  "graph_hash": "<state.graph.definition_hash>",
  "max_workers": 1,
  "final_passes": 2,
  "lighthouse_runs_per_url": 3,
  "buffer_minutes": 30,
  "nodes": {
    "deterministic-baseline": {"minutes": 30, "source": "nodes/intake/pilot.json"},
    "rung-14": {"minutes": 90, "source": "nodes/intake/migration-estimate.md"},
    "solr-search": {"minutes": 1, "source": "nodes/intake/features.json", "outcome": "not-applicable"}
  }
}
```

Provide a positive estimate and an existing source artifact for **each unfinished owner-skill node
on the selected success route through `closure-join`**. Include both proof passes and Lighthouse
repetitions in the relevant minutes; the tool does not double them again. Pure joins default to zero.
Already passed/skipped nodes are not billed again. Resolve branch outcomes from actual intake,
including preserved versus consolidated rights. Do not declare a feature absent to make it fit.

Use a small representative pilot for capture/HTTP/DOM/Lighthouse throughput and real backup/import
or migration history for stateful estimates. Record units, sample size, machine/browser versions and
uncertainty. Reuse pilot artifacts. For more than one worker, name the recorded `parallel_approval`;
an estimator setting alone is not authority to create agents or run overlapping commands.

```bash
t3u graph-forecast --evidence nodes/intake/runtime-plan.json --json
```

The command follows chosen outcome edges and prerequisites, schedules resource-compatible jobs,
excludes writes from frozen readers, isolates quiet measurements, and protects the profile's migration cutoff and 2/6/12-hour closure
reserve. It includes at least 30 minutes of uncertainty/rollback buffer. The immutable output names
its input/source hashes, schedule, serial cost, estimated finish and reserved finish. A non-fitting
plan exits 4 and cannot admit baseline/migration nodes. A missing pilot/route is not a zero-cost job.

The list scheduler is conservative, not an optimal-scheduling solver. It gives an admission estimate,
not a guarantee. Reforecast remaining work at a safe checkpoint after slow migration, a repair or a
changed estimate. Keep the original deadline and append a new forecast; never replace old evidence.
New runs are capped at 8/24/48 elapsed hours for small/large/huge sites. A multi-day run needs durable
checkpoints before interruption, not an always-running shell. Resumption counts elapsed downtime;
legacy seals retain their original deadlines. The longer window does not enlarge attempt budgets.
Use [parallel execution](parallel-execution.md) for the shared machine budget and calibrated worker
counts. Forecast owner slots are distinct from browser workers; estimates must include contention.

## Batch the owner decisions

Every question asked mid-run stops a node until somebody answers. Ask in two rounds and record each
answer as given ([approval matrix](../rules/40-approval-matrix.md)).

**Round 1, at intake, before the run goes unattended**, in one message:

| Decision | Where it is prepared |
|---|---|
| Dataset: the dated dataset, its named gaps, editorial freeze or accepted staleness | P00 steps 2–4, `dataset-acceptance-decision` |
| PHP target: 8.5 where it resolves, otherwise 8.4 | [constraints](typo3-14-constraints.md#php-84-standard-85-preferred-where-it-resolves) |
| Contract A Lighthouse floors: measured on Baseline A or fixed | [quality bars](quality-bars.md#contract-a-lighthouse-floors-decided-at-intake) |
| Bootstrap and jQuery: migrate in this run or record an exception, and the review slot | [migration intake](bootstrap-5-migration.md#intake-inventory-estimate-ask) |
| Extension removals and forks the inventory names | [extension strategy](extension-strategy.md) |
| Fix-pack approvals: split bundles, restored module rights, renamed asset files, the powermail `Basic.css` URL, the shared `.htaccess` on staging and live | [fix pack](typo3-14-fix-pack.md#where-each-item-applies) |
| Delegation: how many parallel workers (`parallel_approval`, `max_workers`) | [admission](#admission-and-prediction) |
| Commits per phase batch, and whether the run directory may be committed; pushes stay separate | [approval matrix](../rules/40-approval-matrix.md#401-the-matrix), rows 26–27 |

Ask a declared-change approval with the exact form of the change (the rule's before/after pattern
and one example) and let the owner name its scope. When the run reaches the step, record the
approval in this run, quoting question and answer, with the run's own before/after pair as its
evidence ([scope of an approval](../rules/40-approval-matrix.md#404-scope-of-an-approval)). A
difference wider than the form the owner saw is a new class and a new question.

**Round 2, before closure**, in one review: every declared-change class the run produced with its
before/after pairs, the residual findings, and after `closure-verify` the Contract A manifest.

A question that arises in between and blocks the critical path is asked at once, with the cost of
waiting stated; everything else waits for round 2 while nodes that do not depend on it keep running.
New scope is not such a question: forecast it against the deadline first and prefer a separately
authorized follow-up run ([lessons](recent-run-lessons.md#where-a-day-and-a-half-went)).

## Prepare test accounts once

Create the backend test accounts once, right after `rung-14` passes and the 14.3 backend opens, so
no later restore of an earlier snapshot removes them: the throwaway admin of
[P12](phases/p12-backend-operations-quality.md#a-disposable-backend-user) and one DDEV-only non-admin
editor per role the feature plan names, each in its real editor groups. Keep the generated passwords
in one mode-600 file outside Git and outside the run directory; every backend worker reads that file
and never prints it. `rte-visual-editor`, the Redirects rights branch, `component-sentinels` and
`backend-operations` reuse the accounts. Delete them with their `sys_log` and `sys_history` rows at
handover, before any database leaves the machine, and record the zero count
([proof scripts](measurement-recipes.md#proof-scripts-journeys-sweeps-and-row-diffs)).

## Work, recovery and safe resumption

1. Read `graph-next`. Pick a runnable node; lock-blocked jobs wait. State transitions remain serial.
2. Acquire the node and its resources. Snapshot immediately before stateful mutation only.
   Set operation timeouts from the remaining phase window, retaining rollback/checkpoint time.
   Do not launch a command whose measured worst case exceeds that window. A tool timeout is a
   failure to reconcile, not proof the external operation rolled back or stopped by itself.
3. Execute the job with scoped checks. Use affected routes plus critical/seeded sentinels in one
   default state for intermediate feedback. Batch findings by root cause, not by URL.
4. Record real output before closing the node. The engine hashes it; a pathname alone is not proof.
5. Route the observed cause. A second visit to a completed repair node is allowed only by a fresh
   edge arrival and the remaining budget. Do not reset attempts by renaming a cause or loop.
6. Before replaying an interrupted stateful action, reconcile its actual effects with the snapshot
   and database. Atomic graph writes do not promise exactly-once database commands. Keep locks until
   the interrupted action is reconciled; never delete a lock just because a worker disappeared.

The shipped bounds are three starts per node and twelve retry-edge traversals total, plus each
edge's smaller limit. Local tool iterations spend the same job budget: a leaf does one bounded
repair pass and returns; it cannot launch its own outer retry programme. Two no-progress attempts
or oscillation stop earlier. Existing `loop-start` scaffolding is generated once, not seven reports
rewritten by the agent at every step.
Before advertising or opening a repair, the engine checks whether a successful continuation can
still traverse its recovery edges. Exhausted routes wait/stop before spending another repair pass;
closure checks repeat this guard in case another worker spent the shared budget meanwhile.

Final proof consumes one frozen epoch after the last change. HTTP/DOM and pixel readers can reuse
the same capture artifacts. Additional widget actions stay in targeted journeys; global states
remain at most default, keyboard-focus and nav-open. Code changes invalidate final source proof;
diagnose with scoped checks, then issue one new final epoch. Never redo successful data migrations
merely to refresh documentation.

## Unattended terminal states

Graph integrity validation is not a completion verdict. An independent passed terminal cannot
hide blocked or unfinished activated work. `graph-status` derives the summary from node evidence;
`graph-next` can reconcile a stale derived label without altering graph definitions or proof.

- **Verified awaiting acceptance:** complete checks, `graph-validate`, and `closure-verify` passed
  before the deadline. End execution and show the manifest/hash and next human decision.
- **Blocked/incomplete:** preserve the checkpoint, failed command/exit, exact cause, rollback status,
  coverage gap and smallest required decision. Do not spend the reserve on new migration scope.
- **Closed locally:** a human accepted the observed manifest and the guarded Contract A gate passed.
  Human acceptance may arrive later; currentness checks still apply to the timely receipt.

No status authorizes deployment. Commit and push are distinct, explicitly authorized final actions.
Proof/report-only commits preserve source identity; implementation changes require current proof.
Use a product-provided scheduler only if the user separately requests monitoring or a later run;
do not improvise a background shell loop to keep this job alive.
