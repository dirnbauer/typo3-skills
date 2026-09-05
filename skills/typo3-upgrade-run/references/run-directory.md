# The run directory

Every update run writes into one project-local directory: `.typo3-update/`. It is the run's memory, its evidence chain, and the thing that lets a fresh agent session resume exactly where the last one stopped.

Nothing in this skill is "remembered". It is written down, and the gates read what was written.

## Layout

```
.typo3-update/
├── STATUS.md                       human dashboard, regenerated from state.json
├── state.json                      graph + evidence state and sealed size-dependent deadline — the ONLY precondition source
├── journal.jsonl                   append-only: commands, nodes, edges, locks, verdicts
├── .gitignore                      ignores artifacts and shots; keeps every .md and .json
├── config/
│   ├── run.yml                     domain, languages, golden paths, budgets, contract-B opt-ins
│   ├── upgrade-graph.yml           sealed nodes, outcome edges, resources, retry bounds
│   ├── sample.txt                  S_A — the frozen URL sample; never edited after sealing
│   └── thresholds.yml              visual thresholds, loop budgets, contract-B targets
├── manifests/
│   ├── url-manifest.json           seed, all URLs, tiers, clusters, viewports, coverage
│   ├── environment.json            versions + fonts + GFX config, hashed
│   ├── content-fingerprint.json    complete ordered row/schema hashes + fileadmin tree hash
│   ├── content-fingerprint-target.json  post-migration epoch; source remains immutable
│   ├── content-transition.json     snapshot, successful argv and fixed-point reconciliation
│   ├── extensions.json             every installed extension + classification + resolution
│   ├── tooling.json                pinned harness/browser/Lighthouse/axe versions
│   └── snapshots.json              every ddev snapshot, with its loop and reason
├── baseline/
│   ├── A-original/                 IMMUTABLE after sealing
│   │   ├── SEAL.md                 who, when, both fingerprints, sample hash
│   │   ├── MANIFEST.sha256         hash of every captured artifact
│   │   ├── LOCK.json               seal metadata + hash of MANIFEST.sha256
│   │   ├── shots/<viewport>/       screenshots
│   │   ├── dom/                    normalized DOM snapshots
│   │   └── http/                   status, headers, metadata per URL
│   ├── A-supplemental/             append-only; EXCLUDED from the invariance claim
│   └── B-00n-<track>/              one per approved elevation track
├── loops/
│   └── <NNN>-<track>-<slug>/
│       ├── 00-charter.md           frozen after writing
│       ├── 01-preconditions.md     frozen after writing
│       ├── 02-plan.md
│       ├── 03-iterations.md        append-only
│       ├── 04-findings.md          the register; rows updated in place
│       ├── 05-evidence.md          append-only
│       ├── 06-exit.md
│       ├── report.json             schema-validated machine mirror
│       └── artifacts/              shots, diffs, JSON reports, logs
├── nodes/
│   └── <node-id>/
│       └── result.json             last outcome; full attempt history remains in state/journal
├── approvals/
│   ├── APPROVALS.md                index
│   └── APR-nnn-<slug>.md           one record per approval
├── decisions/
│   └── ADR-nnn-<slug>.md
└── report/
    ├── contract-a-closure.md
    ├── contract-b-summary.md
    ├── kpi-report.md  kpi-report.docx
    └── handover-deployment.md
```

## Graph nodes and bounded evidence loops

The graph is the parent controller. `t3u graph-init` hashes `config/upgrade-graph.yml` and creates
`state.json.graph.nodes`, `.edges`, and `.locks`. `t3u node-open` acquires declared resources;
`t3u node-close` writes `nodes/<node-id>/result.json`, appends journal events, and activates only
the edges matching its observed outcome.

The `nodes/` result is a convenient last-result view, not the full history. Attempt history and
edge traversal counts live in `state.json`; the append-only `journal.jsonl` is the audit trail.

A scaffolded loop is optional bounded evidence within one proof/migration node. It still contains
seven fixed documents so old runs and existing report tooling remain readable.

Every scaffolded evidence-loop directory contains the same seven documents. Machine-managed
determinism 000 and Baseline A sealing use their own schema-validated reports, locks and manifests.

| File | Holds | Written at protocol step | Mutability |
|---|---|---|---|
| `00-charter.md` | Objective, contract, track, in/out of scope, `depends_on`, budgets, authorising approval, the baseline it measures against | 2 | frozen after writing |
| `01-preconditions.md` | The `checks[]` table evaluated against `state.json`, both fingerprints, and the Git/file or stateful snapshot anchor; gate verdict | 3–5 | frozen after writing |
| `02-plan.md` | Ranked hypotheses, the ordered cause list, the measurement command, the loop-000 result it relies on | 6–7 | extended between iterations |
| `03-iterations.md` | One section per iteration: cause, change set, files/lines, measurement ref, `open_before`/`open_after`, `progress` | 9–10 | **append-only** |
| `04-findings.md` | The findings register: id, target, class, severity, status, cause, fix ref, evidence ref, `reopened_count` | 8 onward | rows updated in place |
| `05-evidence.md` | Tool versions, exact commands, artifacts with SHA-256, sample ref, viewport matrix | 7 onward | **append-only** |
| `06-exit.md` | `exit_criteria[]`, conditional idempotence evidence, verdict, residual findings; on abort the condition and escalation | 12 | written once |

Plus `report.json` — the machine mirror, validated against `assets/schemas/loop-report.schema.json` — and `artifacts/`.

Why exactly seven, and why these mutability rules:

- **One document per protocol stage** means a gate reads one file rather than scanning a wall of text for a sentence that may not be there.
- **Append-only** `03` and `05` mean a rewritten history shows up as a diff in git. Evidence you can quietly edit is not evidence.
- **Frozen** `00` and `01` mean "the loop relaxed its own preconditions when it got stuck" is detectable rather than invisible — which is exactly the failure mode a loop under pressure drifts toward.

## Front matter

Every loop document carries YAML front matter validated against `assets/schemas/loop-doc-frontmatter.schema.json`:

```yaml
---
schema: typo3-upgrade-run/loop-doc@1
run_id: 2026-07-25-acme
loop_id: "300"
loop_slug: invariance-closure
track: invariance
contract: A
phase: P11
doc: exit
baseline_ref: A-original
sample_ref: config/sample.txt@sha256:1f0c…
env_fingerprint: sha256:9ab3…
content_fingerprint: sha256:4d71…
snapshot: loop-300-pre
rollback_ref: git:6d78e9a
status: green
frozen: false
created_at: 2026-07-25T09:02:11+02:00
updated_at: 2026-07-25T13:47:05+02:00
---
```

The schema enforces two rules mechanically rather than by convention: a Contract A invariance document **must** name `A-original` as its baseline, and a Contract B document **must** carry a non-null `approval_ref`.

## Naming

`loops/<NNN>-<track>-<slug>/` — zero-padded compatibility id, track, kebab-case slug. The owning
graph node belongs in the charter and evidence. The bands remain:

| Band | Purpose |
|---|---|
| `000–009` | harness (determinism self-test, baseline sealing) |
| `010–099` | reserved; blocker remediation normally stays in loop 100 |
| `100–199` | bounded migration-node evidence |
| `200–299` | conditional feature-node evidence |
| `300–399` | closure |
| `500–899` | elevation (Contract B) |
| `900–999` | legacy reporting ids; current reporting has no fix loop |

Ids are never reused. A superseded loop keeps its directory with `verdict: superseded` — deleting it would remove the record of an attempt that was made.

## What goes in git

`.typo3-update/.gitignore` ignores `**/artifacts/` and `baseline/**/shots/`, and keeps every `.md` and `.json`.

The reasoning: the documents, reports, manifests and checksums are the audit trail and are small; the PNGs are large, numerous, and reproducible from a sealed baseline plus a recorded command. `MANIFEST.sha256` still proves what the images were, so the evidence chain survives even where the images themselves are not committed.

Whether the run directory is committed at all is the user's call — ask once, at phase P00, and record the answer.

## Resuming

A new session resumes by reading `state.json`, validating the graph hash/locks, and running
`t3u graph-next`. Then read evidence only for ready/running nodes and the last relevant bounded loop.

It must not resume by reading the conversation. A transcript records what was intended; `state.json` records what actually happened, and only the second one is safe to act on.
