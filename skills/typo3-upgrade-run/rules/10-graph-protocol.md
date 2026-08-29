# Rule 10 — The evidence graph

Normative. The update is controlled by a sealed directed graph, not a conversational loop.
`config/upgrade-graph.yml` says what may happen; `state.json.graph` says what did happen. The graph
definition hash is sealed by `t3u graph-init`. Definition drift makes the run invalid.

## 10.1 Node contract

Every node declares:

- one objective and one owner skill;
- phase, mutation class (`none`, `code`, or `stateful`), and exclusive resources;
- named prerequisites and allowed outcomes;
- required evidence; proof nodes additionally require a green bounded loop id;
- a rollback anchor: Git/file reference for code, DDEV snapshot for stateful work;
- an approval id where human authorization is required.

The legal lifecycle is `pending → ready → running → passed | failed | blocked | invalid | skipped`.
A retry edge may return a terminal node state to `ready`; it increments `attempts` and preserves
history. No other operation rewinds a node.

Open with `t3u node-open`; close with `t3u node-close --outcome … --evidence …`. Evidence is a path
or stable report reference, never “the agent checked it.” `not-applicable` needs evidence explaining
why the node does not apply.

## 10.2 Edge contract

An edge is `(from, outcome) → to`. Outcome names preserve causality:

- `findings`: the measurement worked and found a site defect;
- `invalid`: evidence inputs drifted or cannot support a verdict;
- `harness-error`: the measuring system failed;
- `blocked`: a guard, approval, identity, credential, or policy condition refused;
- `not-applicable`: a condition was inspected and absent;
- domain outcomes such as `css`, `content`, or `session`: a classifier selected that cause.

Do not collapse these into “red.” Each demands a different recovery node. A non-terminal allowed
outcome must have a route; an absent route is an invalid graph.

## 10.3 Joins and branches

Fan-out makes independent work ready. A node with `requires` becomes ready only when every named
prerequisite is `passed` or `skipped`. Conditional feature nodes run a cheap applicability check and
close `not-applicable` rather than vanishing from the audit trail.

A recovery branch re-runs only the proof it invalidated. Examples: CSS recovery returns to visual
proof; content-ledger repair returns to the target content epoch; backend-rights repair returns to
backend operations. It must not restart unrelated migration nodes.

## 10.4 Resource locks and parallelism

Resources are capacity-one locks. The shipped graph declares:

- `composer` — dependency resolution and lockfile mutation;
- `ddev-stateful` — database/file state and TYPO3 setup operations;
- `browser-proof` — authoritative rendering/capture environment;
- `solr-core` — destructive or state-changing Solr operations;
- `backend-session` — role-bound backend checks and writes.

`t3u graph-next` lists ready nodes and compatible parallel sets. Parallel execution is optional; it
requires user/runtime authorization and disjoint resources. Agents do not bypass locks, edit graph
state directly, or infer that two stateful actions are safe because they touch different tables.

## 10.5 Cycles are bounded recovery edges

The graph without `retry: true` edges must be acyclic. Every retry edge declares
`max_traversals: 1..5`. The edge count, node attempt history, and last traversal time are persisted.
When the bound is reached, stop and re-plan. Changing the bound changes the sealed graph and
invalidates the current run unless reconciled as a new graph/run.

Bounded loops inside a node may still enforce one cause per attempt, change budgets, progress,
oscillation, and fixed-point evidence. They do not choose the next node.

## 10.6 Graph-level aborts

Stop and route to `stopped` when any of these cannot be resolved safely:

| Condition | Required response |
|---|---|
| project/core/DDEV/database identity ambiguous | no mutation; re-identify or stop |
| backup missing, unverifiable, or wrong target | no destructive/stateful action |
| credentials exposed or origin guard refuses | security event; rotate/investigate |
| environment or unledgered content drift | mark evidence invalid |
| exact destructive scope or destination changed | invalidate approval; ask again |
| two no-progress recovery attempts or any oscillation | rollback affected node; re-plan |
| retry bound or sealed size-profile deadline exhausted | incomplete, never green |
| graph definition/hash/state/lock inconsistency | graph invalid; repair harness/state |

The intake evidence seals one non-extendable overnight profile: small 8h with migration cutoff T+6h,
large 12h/T+9h, or huge 14h/T+10h. The remaining 2h, 3h, or 4h are reserved for closure and
handover; after the applicable cutoff no new P05–P10 cause starts. See
[`references/runtime-sizing.md`](../references/runtime-sizing.md).

## 10.7 Completion

`handover` may pass only after all required joins and the Contract A gate pass. `graph-validate`
must prove:

- definition hash matches;
- every state node and edge exists in the definition and vice versa;
- retry counts are within bounds;
- every lock belongs to a running node that declared it;
- no unbounded cycle exists;
- every proof node carries the required green loop and evidence reference.

The append-only journal records `graph`, `node`, `edge`, and `lock` events. A transcript is not graph
state and cannot repair missing evidence.
