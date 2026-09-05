# Unattended controller contract

## Architecture

The graph selects the next job; a worker solves that bounded job; deterministic tools judge the
evidence. A worker can be the current agent. Extra agents require user/runtime authorization and
disjoint resources. No queue service, new database, agent framework or always-running daemon is
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
serializes writes/frozen proof, and protects the profile's migration cutoff and 2/3/4-hour closure
reserve. It includes at least 30 minutes of uncertainty/rollback buffer. The immutable output names
its input/source hashes, schedule, serial cost, estimated finish and reserved finish. A non-fitting
plan exits 4 and cannot admit baseline/migration nodes. A missing pilot/route is not a zero-cost job.

The list scheduler is conservative, not an optimal-scheduling solver. It gives an admission estimate,
not a guarantee. Reforecast remaining work at a safe checkpoint after slow migration, a repair or a
changed estimate. Keep the original deadline and append a new forecast; never replace old evidence.

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

Final proof consumes one frozen epoch after the last change. HTTP/DOM and pixel readers can reuse
the same capture artifacts. Additional widget actions stay in targeted journeys; global states
remain at most default, keyboard-focus and nav-open. Code changes invalidate final source proof;
diagnose with scoped checks, then issue one new final epoch. Never redo successful data migrations
merely to refresh documentation.

## Overnight terminal states

- **Verified awaiting acceptance:** complete checks, `graph-validate`, and `closure-verify` passed
  before the deadline. End execution and show the manifest/hash and next human decision.
- **Blocked/incomplete:** preserve the checkpoint, failed command/exit, exact cause, rollback status,
  coverage gap and smallest required decision. Do not spend the reserve on new migration scope.
- **Closed locally:** a human accepted the observed manifest and the guarded Contract A gate passed.
  Human acceptance may arrive in the morning; currentness checks still apply to the timely receipt.

No status authorizes deployment. Commit and push are distinct, explicitly authorized final actions.
Proof/report-only commits preserve source identity; implementation changes require current proof.
Use a product-provided scheduler only if the user separately requests monitoring or a later run;
do not improvise a background shell loop to keep this job alive.
