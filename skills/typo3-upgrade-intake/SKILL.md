---
name: typo3-upgrade-intake
description: >-
  Perform the read-only preflight for an orchestrated CMS transition: prove the selected
  repository, local application runtime, database, fileadmin, site configuration and dated-dataset identity; inspect URL
  discovery, installed-extension compatibility, credential boundaries, backup readiness,
  risks and conditional routes. Use when preparing any mutation or when the selected dataset/runtime
  may be wrong. Produces evidence and routing decisions; never changes the
  site, resolves Composer constraints, captures Baseline A, or performs migration work.
metadata:
  skill_type: preference
---

# TYPO3 upgrade intake

One job: prove exactly what will be upgraded and define the graph before mutation.

## Nodes you own

Start every node from `t3u node-brief --node <id>`; it carries the contract, routes and budget.

| Node | Focus |
|---|---|
| `intake` | One project, one DDEV clone, one authorized dataset source; nothing mutated |
| `project-identity` | Checklist item 1; any mismatch is `findings` → `identity-recovery` |
| `dataset-freshness` | Checklist item 2; empty, stale or unapproved data is `findings` → `data-recovery` |
| `extension-inventory` | Checklist items 4–7; flagged **R**: a second verifier reviews the resolutions |
| `url-discovery` | Checklist item 3; a missing sitemap is `findings` → `sitemap-recovery` |
| `identity-recovery` | Correct the identity evidence; never "fix" the site to match an assumption |
| `data-recovery` | `scripts/pull-live-dataset.mjs` (read-only on the server): delete the local fileadmin first, then sync; snapshot before the import. A dataset usable only with named gaps (case-colliding or missing files, absent tables) closes `findings` |
| `dataset-acceptance-decision` | Name every gap and its effect on proof coverage, ask the owner, record the answer as an approval and cite it; `pass` (reviewed) re-runs `dataset-freshness` against the accepted gaps, `blocked` stops |
| `sitemap-recovery` | Diagnose only; `not-applicable` (reviewed) routes to `degraded-discovery` |
| `degraded-discovery` | Approved page-tree or crawl fallback with named coverage gaps |

The controller closes `intake-join` with your sealed `manifests/feature-contracts.json`.

## Worker protocol

Your input is the node brief. Write its evidence file, return one allowed outcome, and never run
`node-open`/`node-close` or edit run state. Details: [graph runner](../typo3-upgrade-run/references/graph-runner.md).
Keep the evidence lean: about 120 lines of proof, earlier artifacts cited by path and hash, one probe
artifact; at the brief's forecast (15 minutes or less) or twice it, stop and return what is proven
plus the open question ([lean profile](../typo3-upgrade-run/references/graph-runner.md#evidence-file)).

## Preconditions

- `typo3-upgrade-run` initialized the local run and selected one project.
- Work is inside a local DDEV clone. No staging/live access or sync action is authorized.
- Read `../typo3-upgrade-run/references/recent-run-lessons.md`.

## Evidence checklist

1. Record repository root, canonical remote, branch, HEAD, dirty/untracked ownership, DDEV root/name,
   primary URL, database identity, and installed TYPO3 core. Refuse any mismatch. Record the
   live/staging database server version (`-- Server version` in the dump header) against the target
   floor, and re-check `git status` after typo3-console `cache:flush`/`extension:list`, which write
   `settings.php` defaults ([known problems](../typo3-upgrade-run/references/known-problems.md)).
2. Record database dump/source date, maximum `pages` and `tt_content` timestamps, table/row
   sentinels, fileadmin count/hash, and one known page/content/media sentinel. A reachable empty or
   wrong database is a finding, not a usable baseline.
3. Inspect sites/languages/bases, sitemaps, robots/canonical behavior, page-tree fallback, golden
   paths, dynamic routes, backend entry point, and local mail/search services. Name uncovered routes.
4. Inventory every installed/local/abandoned extension and feature usage. Preserve exact output of:

   ```bash
   ddev composer why-not typo3/cms-core "^14.3"
   ddev composer why-not php 8.5
   ddev composer audit --locked --format=json
   ```

5. Require one resolution strategy per v14 blocker; do not implement it here. Apply
   [native tools first](../typo3-upgrade-run/references/native-tools-first.md): inventory existing Core
   commands/wizards before proposing scripts or dependencies; new optional extensions need dated
   adoption, maintenance and compatibility evidence. Put the choice in existing node evidence.
6. Check `typo3/cms-redirects` and `spooner/deployer-information`. If absent, activate dependency resolution. Always activate
   the editor-rights verification branch for Redirects.
7. Identify Mask/Content Blocks, Vite/assets, Solr/search, RTE/Visual Editor, Powermail/forms,
   scheduler, custom backend modules/rights, local extensions, and schema/data migrations.
   Read [fleet regression contracts](../typo3-upgrade-run/references/fleet-regression-contracts.md).
   Inventory actual mail/DOI/CAPTCHA entry points, tracking context/consent, cache dependencies,
   historical routes and persisted business records. Record applicability once, with representative
   journeys and named assertions in the [feature plan](../typo3-upgrade-run/references/feature-evidence.md).
8. Record credential origins without reading/printing values. Reject committed/hard-coded secrets,
   ambiguous origins, production sessions, or cross-origin credential flows as security findings.
   Inventory the env loader, jQuery/plugin dependencies and the live-sync helper without executing
   it. Plan their scoped modernization; read the orchestrator's
   [project environment](../typo3-upgrade-run/references/project-environment.md) for the dotenv/config-handling distinction.
   Every Bootstrap site ends on the latest stable 5.x: inventory the Bootstrap version and its use,
   estimate a 3/4 → 5 migration, and ask the owner for the intent approval and a review slot, all
   per the [migration intake](../typo3-upgrade-run/references/bootstrap-5-migration.md#intake-inventory-estimate-ask).
9. Verify backup capability: artifact type, timestamp, checksum, target identity, restore command,
   and storage path. This is readiness evidence; take snapshots only immediately before stateful nodes.
10. Read `../typo3-upgrade-run/references/runtime-sizing.md`. Record all nine sizing metrics and
    their source artifacts in `nodes/intake/runtime-size.json`, with every TYPO3 14 blocker in its
    [blocker inventory](../typo3-upgrade-run/references/runtime-sizing.md#compatibility-blockers)
    (dev-only, unused and drop-in packages are recorded, not counted); select no profile yourself. Let
    `t3u runtime-seal` calculate and seal the smallest fitting small/large/huge profile.
11. Produce risk/cost order, graph applicability outcomes, and a smallest-decision list for the user.
    Run the read-only [TYPO3 14 fix-pack probe](../typo3-upgrade-run/references/typo3-14-fix-pack.md#the-probe-and-the-evidence)
    and record every item as present or not present. A dev-server render (item 9) is settled now,
    before the baseline. So are item 15's golden paths: a `strict` (or unset) translated language
    with Extbase list plugins needs its translated list and detail URLs in Baseline A.
12. Compare processed images live against local on one or two pages that show `csm_*` images
    (read-only GETs on live):

    ```bash
    node skills/typo3-upgrade-run/scripts/gfx-colour-parity.mjs \
      --live https://www.example.org/<page>/ --local https://<project>.ddev.site/<page>/
    ```

    Exit 1 means the local derivatives differ in colour from live, typically through another `GFX`
    processor or colourspace: Baseline A would prove a wrong local render, and before and after stay
    equally wrong. Exit 3 means no pair was measured; pick another page. Settle a difference now like
    the dev-server render, as a DDEV-only environment decision recorded in the intake evidence: the
    processor of live, ImageMagick only with `sRGB` ([image processing like production](../typo3-ddev/references/webconsulting-additions.md#image-processing-like-production)),
    then `ddev typo3 cleanup:localprocessedfiles --all --force` (12.4 lacks `--all`: Maintenance >
    Remove Temporary Assets), `ddev typo3 cache:flush` and the check again until it exits 0.
    Baseline A already sealed: never re-baseline. Fix DDEV in the next code node, regenerate the
    processed files, and declare the image difference to Baseline A as one owner-approved class with
    a before/after pair ([rule 30.8](../typo3-upgrade-run/rules/30-finding-classification.md#308-declared-changes-are-rules-not-edits)).
13. Ask every known decision in one [question round](../typo3-upgrade-run/references/overnight-controller.md#batch-the-owner-decisions)
    before unattended execution: dataset, PHP, Lighthouse floors, Bootstrap/jQuery, extension
    removals, the fix-pack approvals, delegation and commits, and the scope of the two standard
    Contract B branches: structured data (at least Organization/WebSite, WebPage, BreadcrumbList,
    plus the eligible types found) and WebMCP (read-only navigation/lookup tools, prepare-only form
    tools, the Permissions-Policy decision). Ask which types and tools, never whether: both run in
    every upgrade. Forecast work from measured capture/test
    throughput as well as site size ([fleet durations](../typo3-upgrade-run/references/runtime-sizing.md#measured-fleet-durations)).
    Read `../typo3-upgrade-run/references/overnight-controller.md`,
    write the selected-route runtime plan and run `t3u graph-forecast` before the baseline. A missing
    or non-fitting estimate blocks admission. The size-dependent 8/24/48h caps are not completion guarantees.

## Routes

- `pass`: identity, dated dataset decision, sites/URLs, blockers, credentials boundary, and graph
  applicability are evidenced.
- `findings`: route identity, dataset, sitemap/discovery, dependency, or credential issue to its
  specific recovery node.
- `blocked`: wrong/ambiguous project, secret exposure, no acceptable data, unsafe origin, or an
  unavailable decision prevents a safe run.

## Output

Write node evidence under `.typo3-update/nodes/` and manifests under `.typo3-update/manifests/`.
Include commands and exit codes, hashes, unresolved facts, approvals/ADRs needed, selected routes,
explicit non-applicable branches, and the runtime-sizing evidence. Do not say “ready” when any
identity, dataset, or sizing field is inferred.
For a new default graph, close `intake-join` with `manifests/feature-contracts.json` as its evidence.
This hash-sealed plan reuses inventory artifacts; it does not introduce extra browser passes.

## Boundaries

Use `typo3-upgrade-baseline` for deterministic capture, `typo3-upgrade-migration` for changes, and
`typo3-upgrade-retrospective` when reconstructing an old run. Use `typo3-ddev` for DDEV mechanics,
but keep this skill responsible for the upgrade-specific identity verdict.
