# Rule 10 compatibility — bounded evidence loops

The normative parent controller is [`10-graph-protocol.md`](10-graph-protocol.md). This file keeps
existing `.typo3-update/loops/` runs valid and defines the smaller retry/evidence unit a graph node
may use.

A loop belongs to exactly one graph node. It owns one cause, rollback anchor, baseline, budget,
finding register, and verdict. It never chooses the next node and never invokes a nested loop.

1. Scaffold with `t3u loop-start`; do not hand-create the seven documents.
2. Evaluate preconditions from `state.json` and sealed manifests, not memory.
3. Bind Contract A to `A-original`; never rebaseline to hide a difference.
4. Open with a Git/file rollback reference, or a DDEV snapshot immediately before stateful work.
5. Measure affected pages + sentinels during diagnosis; use sealed exhaustive/tiered scope at proof.
6. Classify every finding; address one root cause per attempt (≤10 files or ≤400 changed lines).
7. Require strict progress. Two no-progress attempts, one reopened finding, drift, an unclassifiable
   finding, or a breached node/retry budget aborts the loop.
8. Stateful migrations prove a fixed point. Determinism and final closure require unchanged reruns.
9. Close `green`, `aborted`, `invalid`, or `superseded`; preserve evidence and append history.
10. Return the outcome to the graph. Only the graph activates recovery, another skill, or handover.

Loop 000 remains the machine-managed determinism proof: two unchanged captures, strict zero, fresh
browser processes, identical sealed inputs. A non-zero result is a harness/stabilization defect.
Never raise a threshold, shrink a sample, or exclude a page to make it pass.

Legacy loop ids remain: 000–009 harness, 100–199 migration evidence, 300–399 closure evidence,
500–899 approved Contract B. New runs should name loops after the owning graph node and record the
node id in their charter/evidence until a future schema version adds it as a required field.
