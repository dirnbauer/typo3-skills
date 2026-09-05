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
| large | T+12h | T+9h | 3h |
| huge | T+14h | T+10h | 4h |

The migration cutoff blocks starting a new P05–P10 cause. P11–P13 proof, repair, certificate and
handover may use the reserve. The hard deadline cannot produce a green Contract A result when proof
is missing. Every profile fits one overnight window; site size changes the admitted work and sample,
not the 14-hour ceiling. Optional Contract B work is not automatically part of the overnight job;
schedule it only with separate authority and a stated budget. Never silently extend the current
overnight job because A closed early.

## Feasibility before mutation

The table is a hard stop policy, not a claim that every huge site can finish in fourteen hours.
During intake, write `nodes/intake/runtime-forecast.json` from a small representative pilot:
effective backup/import throughput, HTTP/DOM URLs per minute, captures per minute, installed
browser-start cost, expected migration units, editor journeys and three-run Lighthouse duration.
Reuse the pilot as evidence; do not run a second benchmark programme.

Forecast the critical path with the graph's capacity-one locks. Include both final passes and
the 2/3/4-hour closure reserve; tests sharing a browser or database cannot be counted as parallel.
Start only if required work fits with a buffer. If it does not fit, name the specific blocker
before mutation and split separately authorized prerequisite work from the overnight migration.
Do not lower proof thresholds, silently drop required coverage or promise an unmeasured 10× speedup.
Intermediate checks use affected routes plus a stable random sample; repeated full-site sweeps
and sibling-owned retry loops are forbidden. Final proof retains its declared coverage and ≤3
global interaction states, with extra widget actions inside targeted journeys rather than a
page × viewport × widget-state Cartesian product.

Enforce admission using `t3u graph-forecast --evidence nodes/intake/runtime-plan.json`.
The plan shape and checkpoint procedure are in [the unattended controller](overnight-controller.md).
Verification must finish within the window; a hash-bound `closure-verify` receipt separates this
work from later human acceptance without allowing late initial proof or silent scope expansion.

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
| unresolved compatibility blockers/forks | 0 | 2 | above a large limit |

A project with 100 routes and three unresolved compatibility forks is huge. A project with 1,900
routes but otherwise moderate values is large. Do not average dimensions or trade one high-risk
dimension against several small ones.

Count a stateful migration unit per independently reversible data/schema operation such as a rung,
Mask/Content Blocks data move, list_type→CType move, schema quarantine, Solr rebuild, or rights
rewrite. Count blockers that still need a supported release, replacement, local port, compatibility
fork, or approved removal.

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
    "stateful_migrations": 2,
    "compatibility_blockers": 1
  },
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
