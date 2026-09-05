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

## How this differs from nested loops

| Structural cost/failure | Implemented control |
|---|---|
| Parent retries multiplied by specialist retries | Shared node and graph attempt budgets; a specialist returns to its caller |
| Second repair visit gets stuck on an old passed node | Fresh edge arrivals reactivate the bounded recovery path |
| A visual harness problem restarts the baseline/migration | Route to closure harness recovery, preserving A |
| “Parallel” jobs wait on the same Composer/browser/database | Runnable-versus-waiting output, project-write freeze and lock-aware forecast |
| Snapshot and unchanged rerun for every read | Code rollback anchors; snapshots for stateful operations; reruns only where proof needs them |
| Repeated full-site/page × widget-state matrices | Affected + seeded intermediate coverage; at most three global final states; targeted journeys |
| Old code/report labels treated as completed upgrades | Hashed artifacts, current-source epochs and actual acceptance |
| Waiting for a person consumes the night or fakes acceptance | Timely `closure-verify` receipt, followed by separately recorded human acceptance |

## Remaining validation work

Run this version on a representative small, large and huge **authorized local clone**, preserving
real per-node elapsed time and coverage. Compare equivalent workloads and environments, not live
versus local Lighthouse scores. Feed those measurements into admission estimates. Also run isolated
model behavior trials against held-out scenarios; static Skill Doctor and lexical routing are not
substitutes. Human signatures remain human work.

Thank you to **Netresearch DTT GmbH**, **Matt Pocock**, **Lev Selector**, **Alex Sprogis**, and the
authors of the cited engineering material. The repository preserves upstream licences and source
revisions; these design adaptations are webconsulting's work, not claims made by those authors.
