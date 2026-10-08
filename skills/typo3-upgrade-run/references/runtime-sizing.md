# Runtime sizing

The hard runtime is selected from evidence, not preference and not URL count alone. Start the clock
with `t3u init`, collect this evidence during the read-only intake node, then seal it once:

```bash
t3u runtime-seal --evidence .typo3-update/nodes/intake/runtime-size.json
```

## Profiles

| Profile | Hard deadline | Migration cutoff | Closure reserve |
|---|---:|---:|---:|
| small | T+8h | T+6h | 2h |
| large | T+24h | T+18h | 6h |
| huge | T+48h | T+36h | 12h |

The migration cutoff blocks starting a new P05–P10 cause. P11–P13 proof, repair, certificate and
handover may use the reserve. The hard deadline cannot produce a green Contract A result when proof
is missing. These are maximum elapsed wall-clock windows from initialization, not target durations
or new retry allowances. Small sites should fit overnight; larger sites may need one or two days.
Stop as soon as verified or blocked. Waiting, interruption, a new session and resumption do not
pause or reset the clock. No profile exceeds 48 hours. The standard structured-data and WebMCP
branches are part of this job and of its forecast. Other Contract B work is not automatically part
of it; schedule it only with separate authority and a stated budget. Never silently extend the
current job because A closed early.

New seals record `runtime.budget_policy: site-size-v2`. Previously sealed runs without a policy
marker (or with `overnight-v1`) retain their original 8/12/14-hour deadlines and 2/3/4-hour reserves.
Updating the skill does not reclassify, rewrite or extend them. If the old window cannot fit,
preserve its incomplete record and obtain authority for a separately scoped run; a fresh run is
not permission to repeat an unreconciled stateful action or manufacture a pre-upgrade baseline.

## Feasibility before mutation

The table is a hard stop policy, not a claim that every huge site can finish in two days.
During intake, write `nodes/intake/runtime-forecast.json` from a small representative pilot:
effective backup/import throughput, HTTP/DOM URLs per minute, captures per minute, installed
browser-start cost, expected migration units, editor journeys and three-run Lighthouse duration.
Reuse the pilot as evidence; do not run a second benchmark programme.

Forecast the critical path with the sealed graph's shared/exclusive claims and the measured
[machine capacity](parallel-execution.md). Include both final passes and the 2/6/12-hour closure
reserve. Read-only proof may overlap; shared-content writes and quiet Lighthouse may not.
Start only if required work fits with a buffer. If it does not fit, name the specific blocker
before mutation and split separately authorized prerequisite work from the admitted migration.
Do not lower proof thresholds, silently drop required coverage or promise an unmeasured 10× speedup.
Intermediate checks use affected routes plus a stable random sample; repeated full-site sweeps
and sibling-owned retry loops are forbidden. Final proof retains its declared coverage and ≤3
global interaction states, with extra widget actions inside targeted journeys rather than a
page × viewport × widget-state Cartesian product.

Enforce admission using `t3u graph-forecast --evidence nodes/intake/runtime-plan.json`.
The plan shape and checkpoint procedure are in [the unattended controller](overnight-controller.md).
Verification must finish within the window; a hash-bound `closure-verify` receipt separates this
work from later human acceptance without allowing late initial proof or silent scope expansion.

## Measured fleet durations

Planning anchors from fleet runs on one machine. Measured `graph-report` minutes of comparable
nodes win whenever they exist; cite either in `runtime-plan.json` as the node's source. Comparable
means the work, not the wall clock: leave out recovery attempts, rework and owner waits before
copying a node's minutes ([speed lessons](recent-run-lessons.md#why-a-small-site-took-so-long-2026-10-08)).

| Work | Measured | Note |
|---|---:|---|
| Migration nodes `rung-13` → `mechanical-migration` → `manual-migration` → `rung-14`, ~150-URL site | ≈ 3 h | with the [fix pack](typo3-14-fix-pack.md) applied at the rung, not rediscovered per node |
| Self-test, two exhaustive captures | 21–27 min | [2026-09-30 retrospective](run-retrospective-2026-09-30.md) |
| One full capture | ≈ 7–12 min | at 4 visual workers; one capture at a time per machine |
| One worker node | 10–15 min target | [lean evidence](graph-runner.md#evidence-file); the worker stops at its [time box](graph-runner.md#trivial-nodes-run-in-the-controller) |
| One trivial node | minutes, in the controller | as a fresh worker, with its review where required, it took 14–23 min ([trivial nodes](graph-runner.md#trivial-nodes-run-in-the-controller)) |
| Final proof P11–P13 | ≈ 2–3 h | one capture, then the [offered sets](parallel-execution.md#dispatch-what-the-graph-offers) together |
| Bootstrap 3 → 5 with pixel parity | + ≈ 4–6 h | decided at intake ([migration intake](bootstrap-5-migration.md#intake-inventory-estimate-ask)) |

**Target:** a ~150-URL site with a Bootstrap 3 frontend and no scope change during the run takes
**6–8 h wall clock** from intake to the Contract A acceptance. The same site usually seals the small
profile (8 h cap, migration cutoff T+6 h), so a Bootstrap 3 → 5 migration on top of the upgrade
does not fit: decide at intake whether it becomes a separately authorized follow-up run. One fleet
run of this size took a day and a half for three hours of migration; the
[lessons](recent-run-lessons.md#where-a-day-and-a-half-went) name where the rest went.

A 60-URL shop site with 14 non-Core extensions and five compatibility blockers (huge profile,
counted before the [blocker rule](#compatibility-blockers)),
12.4 → 14.3 on the same machine, four workers approved (2026-10). Wall clock per node from the
journal, review included:

| Node | Measured | Note |
|---|---:|---|
| Intake, from `t3u init` to `intake-join` | ≈ 2 h | small inventories 14–23 min each as fresh workers (the trivial ones now [run in the controller](graph-runner.md#trivial-nodes-run-in-the-controller)), `extension-inventory` 42 min with its review; includes a 57-min dataset recovery |
| `deterministic-baseline` | 32 min | the self-test (two exhaustive captures of 360 shots) took 17 min of it |
| `rung-13` | 35 min | |
| `mechanical-migration` | 25 min | |
| `manual-migration` | 45 min | including Mask → Content Blocks |
| `rung-14` with one recovery | ≈ 2 h | 68 + 23 (`rung14-recovery`) + 96 min, less 64 min waiting for an owner answer that belonged in round 1 |
| `rung-13` → `rung-14` together | ≈ 3 h 45 min | the same four nodes, without that wait |
| One full capture, 60 URLs, 360 shots | 6.3–6.5 min | at 4 visual workers |

## Classification

Select the smallest profile whose limit contains **every** measured dimension:

| Metric | Small maximum | Large maximum | Huge |
|---|---:|---:|---|
| public routes | 250 | 2,500 | above a large limit |
| `pages` + rendered content records | 10,000 | 100,000 | above a large limit |
| fileadmin files | 25,000 | 250,000 | above a large limit |
| TYPO3 site roots | 1 | 3 | above a large limit |
| language variants | 2 | 6 | above a large limit |
| active non-Core extensions | 12 | 35 | above a large limit |
| project-local packages | 2 | 8 | above a large limit |
| stateful migration units | 1 | 4 | above a large limit |
| compatibility blockers that need real work ([below](#compatibility-blockers)) | 0 | 2 | above a large limit |

A project with 100 routes and three used extensions that each need a fork is huge. A project with 1,900
routes but otherwise moderate values is large. Do not average dimensions or trade one high-risk
dimension against several small ones.

Count a stateful migration unit per independently reversible data/schema operation such as a rung,
Mask/Content Blocks data move, list_type→CType move, schema quarantine, Solr rebuild, or rights
rewrite. Stateful units count independently of the blocker dimension: a Mask → Content Blocks move
is one stateful unit and, when Mask is used, one compatibility blocker.

### Compatibility blockers

Record every package that blocks `composer why-not typo3/cms-core ^14.3` once, whether it sits in
`require` or `require-dev`, in `compatibility_blocker_inventory`. Every such package is still
declared and resolved before the core jump ([extension strategy](extension-strategy.md)); the
inventory only decides which of them make the run longer. A blocker **counts** toward the profile
only when the project **uses** it (content rows, configuration or code reference it) **and** it
needs a fork, a local migration (templates, TypoScript, TCA, PHP) or a data migration. A used
package that is removed counts too, because its usages have to be migrated first. These are
**recorded but not counted**:

- dev-only packages (`require-dev`): a file-fill tool, the core-upgrader itself, a test helper;
- packages with zero usage that the owner removes;
- drop-in replacements with the same functionality (a wrapper package swapped for the plain
  package it wraps) and plain upgrades to a supported release.

Per entry: `package`, `dev_only`, `usage` (the number of content rows plus configuration and code
references, from the [usage scan](../scripts/extension-usage.mjs)), `resolution` (`fork`,
`local-migration`, `data-migration`, `removal`, `drop-in-replacement` or `supported-release`) and
`source`. When the matching release does not exist yet and nobody has decided, record `fork`.
`runtime-seal` derives `metrics.compatibility_blockers` from the inventory: omit the metric or state
the counted value; a contradicting value is refused, and so is a count above 0 without an inventory.
The seal's journal note lists the counted and the recorded-only packages.

Why: a 33-URL site with one real migration (Mask → Content Blocks, 40 rows) was sealed huge
(48-hour cap, 18-hour forecast) because dev-only packages, unused extensions and a wrapper swap
counted like forks. Under this rule the same inventory counts one blocker.

## Evidence format

Every metric needs a source pointing to inspectable command output or a manifest inside the run:

```json
{
  "schema": "typo3-upgrade-run/runtime-size@1",
  "metrics": {
    "public_routes": 1900,
    "content_records": 58000,
    "fileadmin_files": 80000,
    "sites": 2,
    "languages": 3,
    "active_non_core_extensions": 24,
    "local_packages": 5,
    "stateful_migrations": 2
  },
  "compatibility_blocker_inventory": [
    { "package": "vendor/content-elements", "dev_only": false, "usage": 40,
      "resolution": "data-migration", "source": "nodes/extension-inventory/usage.json" },
    { "package": "vendor/file-fill", "dev_only": true, "usage": 0,
      "resolution": "removal", "source": "nodes/extension-inventory/why-not-14.txt" },
    { "package": "vendor/wrapper", "dev_only": false, "usage": 6,
      "resolution": "drop-in-replacement", "source": "nodes/extension-inventory/usage.json" }
  ],
  "sources": {
    "public_routes": "nodes/url-discovery/manifest-summary.json",
    "content_records": "nodes/dataset-freshness/row-counts.json",
    "fileadmin_files": "nodes/dataset-freshness/fileadmin-inventory.json",
    "sites": "nodes/project-identity/site-list.txt",
    "languages": "nodes/project-identity/site-show.txt",
    "active_non_core_extensions": "nodes/extension-inventory/active.json",
    "local_packages": "nodes/extension-inventory/local-packages.json",
    "stateful_migrations": "nodes/intake/migration-units.json",
    "compatibility_blockers": "nodes/extension-inventory/why-not-14.txt"
  }
}
```

`runtime-seal` calculates the profile itself. It does not accept a requested profile or arbitrary
hours, so an under-declared site cannot buy a shorter deadline. The profile, evidence path, cutoff,
reserve and deadline become state. Reclassification or extension requires a new run rather than
rewriting the sealed clock.
