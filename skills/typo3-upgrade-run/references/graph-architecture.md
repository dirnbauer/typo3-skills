# Upgrade graph architecture — September 2026

## Decision and limits

Keep the existing renderer and local JSON/YAML controller. Use a directed acyclic success graph
with bounded recovery edges, small specialist jobs, explicit locks and independently inspectable
verification. This is a local, human-authorized software-factory pattern, not an autonomous deployer.
The implementation can produce strong bounded evidence; neither a skill nor a graph guarantees
perfect software, zero unknown bugs or an unmeasured 10× end-to-end speedup.

## Sources actually consulted

| Source | Evidence obtained | Application here |
|---|---|---|
| [Lev Selector, September 4 update](https://www.youtube.com/watch?v=IowpBrMBB4E&t=1356s) | Video metadata, chapter list and author-published slide 26 | Small replaceable modules, one control record, parse/capture once, provenance and recoverable jobs |
| [Author's slide deck](https://github.com/lselector/seminar/blob/1b2ac8961f404f37c7f5bb035d3509dc3d241026/2026/2026-09-04-AI-Updates.pptx) | Architecture slide extracted from the pinned PPTX | Retain filesystem state instead of importing its RAG/Postgres stack |
| [Alex Sprogis, Loop & Graph Engineering](https://www.youtube.com/watch?v=bKt-GZicIlM) | Public description/chapter list: loop types, reward hacking, context limits, graphs, dark software factory | Graph owns routing; bounded feedback belongs inside a job; explicit checks prevent a self-declared green |
| [Anthropic, Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) | Primary workflow/agent pattern discussion | Start simple; use routing, worker contracts and testable evaluator feedback where they earn the cost |
| [LangGraph persistence](https://docs.langchain.com/oss/python/langgraph/persistence) | Primary checkpoint/persistence documentation | Durable state and resumption; no LangGraph dependency is needed for these principles |
| [StrongDM software factory](https://factory.strongdm.ai/) | Primary description of scenario-based validation | Preserve real visitor/editor scenarios; a generated green unit suite alone is not acceptance |
| [Matt Pocock, writing-for-agents](https://github.com/mattpocock/skills/blob/main/skills/productivity/writing-for-agents/SKILL.md) | Full current authoring reference and linked skill mechanics | Branch-specific pointers, explicit completion criteria, co-located rules and deletion of duplicate instructions |

YouTube caption endpoints returned empty responses. No full-transcript review or viewing is claimed.
The supplied first timestamp (22:36) falls in the alignment chapter; the architecture chapter starts
at 32:41. Its author-provided slide was available and used. Sprogis-derived claims above are limited
to the accessible description/chapters and corroborated with primary engineering documentation.

The RAG example's fixed file/function limits, Postgres, README-per-directory and blanket 30-day
dependency delay are not imported as universal rules. They do not fit this task and would conflict
with the explicit latest-compatible updates and urgent security fixes.

## Rechecked against current theory (27 September 2026)

The July 2026 "loop engineering versus graph engineering" debate converged on one shape: a stable
control graph, bounded loops inside selected nodes, and verification the agent cannot talk its way
past. The graph was checked against the primary sources below; every gap became a harness check.

| Source | Finding | Status here |
|---|---|---|
| [Hu Wei, Structured Graph Harness](https://arxiv.org/abs/2604.11378) (April 2026) | Immutable plan per version; separate planning, execution and recovery; strict escalation; node state machine with termination guarantees | Already present: sealed graph hash, intake/forecast → nodes → recovery nodes, bounded retries, stop routes |
| [Lulla et al., Loop Engineering](https://arxiv.org/abs/2608.21884) (August 2026) | Five building blocks: machine-checkable stop, persistent state files, verifier sub-agents, token budgets, human escalation; state files are rarely committed | Added independent review and measured node minutes; audit trail status now reported |
| [Feng et al., Graph Engineering](https://arxiv.org/abs/2608.21156) (August 2026) | Explicit, evolving graph structures for multi-agent systems | Deliberately static: a changed graph is a new, auditable run |
| [Anthropic, harness design for long-running apps](https://www.anthropic.com/engineering/harness-design-long-running-apps) (March 2026) | Testable "sprint contracts" before work; self-evaluation praises its own output, so evaluation needs a separate skeptical agent; context resets | Added node contracts (`objective`, `done`, `evidence`), `node-brief` for fresh workers, bound reviews |
| [Anthropic, effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) (November 2025) | Feature list with pass/fail, progress file, one feature at a time, browser end-to-end tests, never edit tests to pass | Feature plan and journeys existed; test/threshold protection is now mechanical |
| [Anthropic, effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) (September 2025) | Sub-agents with clean context windows beat one ever-growing context | Worker protocol: the brief is the whole input |
| [SpecBench](https://arxiv.org/abs/2605.21384) (2026) and [ImpossibleBench](https://www.lesswrong.com/posts/qJYMbrabcQqCZ7iqm/impossiblebench-measuring-reward-hacking-in-llm-coding-1) (ICLR 2026) | Agents saturate visible tests and still game the specification; the gap grows with code size | Measurement inputs frozen inside site-fix nodes; recovery change budget; unchanged final rerun acts as held-out proof |
| [Cemri et al., MAST](https://arxiv.org/abs/2503.13657) (NeurIPS 2025) | Most multi-agent failures are specification and coordination problems; verification gaps follow | Typed contracts per node; controller-only state writes; cause-specific routes |
| [Wu, silent failures in production agents](https://arxiv.org/abs/2606.14589) (2026) | Failures turn into fluent success narratives | Evidence must carry commands, exit codes and hashes; a narrative is not evidence |
| [LangGraph interrupts and persistence](https://docs.langchain.com/oss/python/langgraph/interrupts) | Checkpoint every step; human-in-the-loop as durable interrupts | Already present: transactional `state.json`, journal, approvals |

What the recheck added, all enforced by `t3u` and covered by unit tests:

1. **Node contracts** — `require_node_contracts`: every node states objective, done condition and
   evidence path; [the node reference](graph-nodes.md) is generated and drift-checked.
2. **Typed handoff** — `t3u node-brief` renders one node's complete work order for a fresh worker.
3. **Independent review** — `require_independent_review`: nodes flagged `review: required` and every
   `not-applicable` outcome close only with an agreeing review bound to the evidence SHA-256.
4. **Change scope** — `guard_change_scope`: measurement inputs are fingerprinted at `node-open` and
   compared at `node-close`; only `measurement: true` nodes may recalibrate config, and nobody may
   touch baseline seals, the URL manifest or the feature plan. `recovery_change_budget` caps a
   recovery attempt at 10 files or 400 lines unless an approval is recorded.
5. **Measured operation** — `t3u graph-report` turns the journal into per-node minutes and plan
   estimates, and reports whether the audit trail is in Git.
6. **Node snapshots** — `t3u snapshot-create --node` records the snapshot a stateful node needs
   without inventing a loop.

Not adopted: token budgets as a hard control. Agent runtimes do not expose reliable per-node token
counts to the harness; elapsed time, attempts and change size are measured instead.

## How this differs from nested loops

| Structural cost/failure | Implemented control |
|---|---|
| Parent retries multiplied by specialist retries | Shared node and graph attempt budgets; a specialist returns to its caller |
| Second repair visit gets stuck on an old passed node | Fresh edge arrivals reactivate the bounded recovery path |
| A visual harness problem restarts the baseline/migration | Route to closure harness recovery, preserving A |
| “Parallel” jobs wait on the same Composer/browser/database | Shared frozen readers, exclusive writers, a quiet Lighthouse lane and one conflict model for forecast/execution |
| Serial accessibility matrices and CPU-blocking PNG fallback | Bounded axe jobs, worker-thread fallback, stable coverage merge and cross-process resource budgets |
| Snapshot and unchanged rerun for every read | Code rollback anchors; snapshots for stateful operations; reruns only where proof needs them |
| Repeated full-site/page × widget-state matrices | Affected + seeded intermediate coverage; at most three global final states; targeted journeys |
| Old code/report labels treated as completed upgrades | Hashed artifacts, current-source epochs and actual acceptance |
| Waiting for a person consumes the night or fakes acceptance | Timely `closure-verify` receipt, followed by separately recorded human acceptance |
| One long agent context accumulates assumptions across phases | `node-brief` hands each node to a fresh worker; the controller keeps state, not memory |
| A fix "passes" by relaxing what is measured | Measurement fingerprint at open/close; recovery change budget |
| A skipped branch or a judgement call is self-approved | Independent review bound to the evidence hash |

## Remaining validation work

See [parallel execution](parallel-execution.md) for the implemented concurrency contract. Real local
browser fixtures verify serial/parallel findings and missing-job handling; they do not establish
whole-upgrade throughput. Strict pixel render order and independent final passes are preserved.

No client upgrade has yet run end to end on the graph: the Gütezeichen (July) and Saferinternet.at
(August) runs used the loop protocols that this graph replaced. Run this version on a representative
small, large and huge **authorized local clone**, preserving real per-node elapsed time and coverage
with `t3u graph-report --write`. Compare equivalent workloads and environments, not live
versus local Lighthouse scores. Feed those measurements into admission estimates. Also run isolated
model behavior trials against held-out scenarios; static Skill Doctor and lexical routing are not
substitutes. Human signatures remain human work.

Thank you to **Netresearch DTT GmbH**, **Matt Pocock**, **Lev Selector**, **Alex Sprogis**, and the
authors of the cited engineering material. The repository preserves upstream licences and source
revisions; these design adaptations are webconsulting's work, not claims made by those authors.
