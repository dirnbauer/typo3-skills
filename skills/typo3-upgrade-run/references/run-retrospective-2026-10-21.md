# Twelve-project review — 2026-10-21

## Contents

- [Scope and evidence limits](#scope-and-evidence-limits)
- [New or sharpened controls](#new-or-sharpened-controls)
- [Owner-requested backend conventions](#owner-requested-backend-conventions)
- [What not to turn into policy](#what-not-to-turn-into-policy)
- [Timing evidence and efficient routing](#timing-evidence-and-efficient-routing)
- [Implemented follow-up and remaining evidence](#implemented-follow-up-and-remaining-evidence)

## Scope and evidence limits

Window: **2026-09-09 through 2026-10-21**, Europe/Vienna. Read-only inspection of all twelve
requested repositories, relevant local refs, selected actual diffs/tests, current lockfiles,
run-state files and three recent repair-task histories. Resolve aliases before inspection: two
short project names led to a non-Git directory and an obsolete namesake, not the active projects.
The named mapping stays in the local audit; this reference uses the previous Site A–G aliases and
adds H–L. No customer repository, database, provider, account or deployment was changed.
**Site L deployment was explicitly excluded and supplies no recipe here.**

Evidence levels are distinct: an inspected test proves that test code exists; a historical tool
exit proves that recorded invocation; neither proves a fresh pass on today's checkout. Original
upgrade requests, all clarification rounds and end-to-end wall times were not available for every
project. They remain unknown, not zero questions or an overnight performance result.

| Site | Current locked Core | Last root run state observed | What worked / what still needs proof |
|---|---|---|---|
| A | 14.3.9 | P05 open, August | Scoped method guards and lazy form assets; current code is ahead of closure records |
| B | 14.3.5 | P11 blocked, July | Real same-file replacement/cache test; no current closure demonstrated |
| C | 14.3.5 | P11 open, July | Context-aware tracking, actual CSP and opt-out tests; old run state remains open |
| D | 14.3.7 | P10 open/blocked, August | Correct file permalinks and field-specific RTE; inherited broad CSP disablement is not a model |
| E | 14.3.7 | No root state found | Notification templates and effective RTE configuration repaired; original closure evidence missing here |
| F | 14.3.6 | No root state found | Real map journey separated from visual stabilization; newer patch exists on another ref, not this lockfile |
| G | 14.3.7 | No root state found | DI factory/lazy-service compatibility repaired; original closure evidence missing here |
| H | 14.3.9 | P13 closed, October 4 | Typed link migration and real Fluid tests added later; check certificate currentness against later changes |
| I | 14.3.7 | P13 closed, October 8 | Bootstrap compatibility and source-like image processing; closure not re-verified in this audit |
| J | 14.3.9 | P13 closed, October 3 | Source-runtime and case-sensitive media handling; later code/branches need their own current proof |
| K | 14.3.9 | P13 closed, September 29 | Image colour/lazy-load fixes; stale browser assets require proof beyond regeneration |
| L | 14.3.8 | P13 closed, October 12 | Preview/CType/link repairs plus later delegated-user and login work; no deployment reviewed |

Totals: four open/blocked, three without a root state found, five historically closed. A missing
root state is not proof that no archived run exists. A closed historical state is not a current
certificate: use [closure-currentness](closure-currentness.md), never rewrite history from Git.
Observed PHP constraints also varied; they do not replace the collection's 8.4 default/8.5 attempt.

## New or sharpened controls

Commit IDs below are locators in the inspected local repositories, not claims of a public release.
Use the installed API and the site's data, not a transplanted patch.

| Problem / cause | Inspected successful approach | Durable control and owner |
|---|---|---|
| E: non-contact event mails broke after template naming changed | `bcf6540`: reminder/cancel/change configuration uses the loader's `.fluid.html` names | Inventory and locally render every used notification variant; migration → `interactions` in [fleet contracts](fleet-regression-contracts.md) |
| D: search suggestions linked to metadata instead of the real file | `9ab32dab`: scoped suggest event, actual file UID, Site Router; HTTP smoke test | Check actual destination, query/language and unaffected lists, not merely suggestion text; `typo3-playwright` |
| E/D/G: stored rich text and toolbar settings differed by field/preset | E `e7ce695`, D `7f688c8d`, G `638b49a9`: effective field configuration | Existing [RTE round-trip](../../typo3-content-blocks/references/rich-text-roundtrip.md), reuse rather than add another programme |
| A: directly requested action URLs could enter a write handler | `330ad4f9`: scoped method guard, 405/Allow/no-store, negative tests | Prefer native handler restrictions; GET/HEAD cause no side effects, permitted POST and legitimate confirmation links survive; `interactions` |
| A: rarely used dialog CSS blocked every page; first-open behavior matters | `5adeb1ac`: await CSS and JS together | Fresh first-open and reopen, focus/validation plus emitted asset checks; [dynamic proof](../../typo3-playwright/references/dynamic-component-proof.md) |
| B: replacing an image left dependent cached HTML stale | `de0d3ed`: Core automatic tagging; actual FAL replace with same UID/name under an editor, real page/static caches | Native invalidation first; new bytes/markup and surviving unrelated cache entries, no global-flush substitute; `runtime` / `interactions` |
| G: subclass/factory worked directly but failed through native lazy proxy | `59cab6fb` (after constructor repair `118fcbaf`): scoped service correction | Build and exercise actual DI/factory path after patch updates; no global lazy-service disablement; migration/backend |
| H/L: string fixtures hid a typed Link object's rendering failure | H `3f0dcfd`, L `5505ea2f`: real `TypolinkParameter` in frontend and preview | [.url checks and complete link rendering](../../typo3-content-blocks/references/typed-link-migration.md); synthetic records for otherwise unused affected definitions |
| H: legacy links mix URLs, page/file/record identifiers and multi-part syntax | `83ac1a0`: native Link fields, Core codec, input-bound migration plan and DataHandler readback | Format inventory, ambiguous-map approval, fixed point, identity/translation preservation; Content Blocks/migration |
| L: hidden CType option silently changed an untouched record to `header` on save | `95d45b35`: type-scoped selector repair | A real no-change editor save must preserve CType and relations; do not enable every infrastructure CType globally |
| F: static map pixels were mistaken for functional map proof | `55e4c65`, `28251fc`: separate real MapLibre canvas/marker/tile assertions | Visual fixture sealed before baseline plus live local component journey; no best-frame selection after failures |
| J: target PHP cannot boot the unchanged source; host filesystem loses case-distinct media | `4c07cef` and inspected local Compose mount: source-compatible runtime, Linux volume | [DDEV overlay](../../typo3-ddev/references/webconsulting-additions.md#source-runtime-and-case-sensitive-media): inspect actual mounts, hash/count inside them, case-preserving media backup distinct from DB snapshot |
| I/K: different processors produced dark/stale derivatives; lazy images were checked too early | I `e58566e`, K `792dbf3`, `3b60ab5`: source-like processing and scroll/decode checks | Existing GFX intake control plus browser-visible cache and positive image dimensions; regeneration alone does not evict browser caches |
| D: old page worked but newly created/moved pages did not | `49ecfa54`: explicit move permission policy | Test create/inheritance/move for the approved role; do not copy `31/31/1` or grant delete rights fleet-wide |
| C: context predicate and CSP transport differed from real rendering | `4a9d3a0a`: actual local TYPO3 render, Apache policy, intercepted tracking, narrow idempotent TS migration | Reuse existing tracking/context/CSP contracts; preserve unrelated configuration and non-production opt-out |

The examples do not authorize new custom middleware, image listeners or migration tools by default.
Inspect Core, installed extensions and supported commands first. The fixes are evidence of gaps to
test, not mandatory dependencies or hard-coded versions.

## Owner-requested backend conventions

The October 21 request adds two defaults for **new** whole-site runs:

1. **Benutzerverwaltung for non-admin managers.** Site L's imported package and local selector/guard
   tests demonstrate the intended capability, not a verified public v14 release. Record compatible
   package/fork provenance; obtain managed-group/action scope. Preserve working admins and enforce
   deny-by-default against privilege escalation, protected/foreign accounts and self-lockout.
   See [delegated management](../../typo3-backend-rights/references/delegated-user-management.md).
2. **Three environment palettes with each site's own motifs.** Inspected login assets and context
   config use green Live (`#0e714b`), orange Staging (`#a14d00`) and blue DDEV (`#0a5f96`). Preserve
   these meanings and German labels, but derive motifs/logos from the target site. Locally prove
   mapping, contrast, light/dark, crop, login/reset/MFA. See [branding](../../typo3-backend-rights/references/backend-branding.md).

Decisions belong to intake, dependencies to resolution, provisioning to the selected P10 rights
branch, and proof to frozen `backend-operations`. Two journeys in the existing sealed feature plan
reuse `backend-editor`; no graph node, global browser state or independent retry programme is added.
Do not retrofit a sealed customer run, demote an administrator or publish a compatibility fork
without the corresponding explicit authority. No Site L deployment code is reused.

## What not to turn into policy

- Backend CSP disablement, ignoring reduced motion, broad rights or global cache purges.
- A dated image query suffix or a hard-coded `_assets/<hash>` alias: diagnose the processor/cache
  or manifest problem and prove fresh rendered references instead.
- Selecting the best screenshot or replacing immutable Baseline A with a refreshed live capture.
  A current live comparison is useful diagnostics, not original upgrade parity.
- Treating a private path package's `10.0.2` label as an upstream v14 release, or a changed Composer
  constraint as compatibility proof. Preserve provenance, licences and tested limitations.
- Calling inspected test source a fresh green run, or historical P13 status a current certificate.

## Timing evidence and efficient routing

Three recent repair tasks were read in addition to Git:

| Task evidence | Observed history | Limit of the observation |
|---|---|---|
| D, suggestion permalink repair | About 10.6 minutes for initial repair; historical smoke checks first failed, later exited 0 | User limited it to one suggestion context, then separately authorized publication; not a whole upgrade |
| A, form-action method guard | About 5.3 minutes for the local method-guard repair; 88 URL checks reported green | No proof of real recipient delivery or valid external signup; publication was separate |
| A, on-demand dialog stylesheet | About 30.7 minutes initially: build ~4.5 seconds, focused tests ~26 seconds, full visual run ~19.4 minutes (failed) | Later stale-asset/mobile repairs and diagnostic recapture do not retroactively make the first run pass |

These are recorded task/command timings, not clean benchmarks or active effort estimates. They
support running affected journeys during diagnosis and doing the full final proof only at its graph
barrier. Count a reused report once, avoid builds/cache mutations during frozen browser proof, and
retain failed attempts. Do not infer a tenfold speed-up or guaranteed 14-hour closure from them.
Keep the existing size-dependent **8/24/48-hour admission caps**, measured forecast, three global
states, thirteen closure checks, mandatory Lighthouse/axe and unchanged final rerun.

## Implemented follow-up and remaining evidence

- Updated the orchestrator, intake/migration/closure routing, backend rights, Content Blocks,
  Playwright, the DDEV overlay and conditional fleet contracts. Upstream skill bytes stay untouched;
  Netresearch attribution remains in the overlay.
- Added proposed behavior cases for typed links, unchanged saves, file-cache replacement, source
  runtime/case sensitivity, dynamic components, alias/currentness review and backend conventions.
  Proposed cases are not human-reviewed coverage or evidence of live agent behavior.
- Existing controls already covered RTE processing, Bootstrap 5 compatibility, GFX source parity,
  tracking/consent, Mask previews, redirects, rollback and closure epochs. Strengthened their
  detection/assertions where needed instead of creating duplicate skills.
- Customer closure reconciliation and an actual small/large/huge trial remain separate work.
  Obtain missing run artifacts, verify currentness and execute missing proofs in authorized clones;
  never reconstruct an original pass when its baseline is unavailable.
