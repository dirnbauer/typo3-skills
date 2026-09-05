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

## Preconditions

- `typo3-upgrade-run` initialized the local run and selected one project.
- Work is inside a local DDEV clone. No staging/live access or sync action is authorized.
- Read `../typo3-upgrade-run/references/recent-run-lessons.md`.

## Evidence checklist

1. Record repository root, canonical remote, branch, HEAD, dirty/untracked ownership, DDEV root/name,
   primary URL, database identity, and installed TYPO3 core. Refuse any mismatch.
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

5. Require one resolution strategy per v14 blocker; do not implement it here.
6. Check `typo3/cms-redirects` and `spooner/deployer-information`. If absent, activate dependency resolution. Always activate
   the editor-rights verification branch for Redirects.
7. Identify Mask/Content Blocks, Vite/assets, Solr/search, RTE/Visual Editor, Powermail/forms,
   scheduler, custom backend modules/rights, local extensions, and schema/data migrations.
8. Record credential origins without reading/printing values. Reject committed/hard-coded secrets,
   ambiguous origins, production sessions, or cross-origin credential flows as security findings.
   Inventory the env loader, Bootstrap version, jQuery/plugin dependencies and the live-sync helper
   without executing it. Plan their scoped modernization; read the orchestrator's
   [project environment](../typo3-upgrade-run/references/project-environment.md) for the dotenv/config-handling distinction.
9. Verify backup capability: artifact type, timestamp, checksum, target identity, restore command,
   and storage path. This is readiness evidence; take snapshots only immediately before stateful nodes.
10. Read `../typo3-upgrade-run/references/runtime-sizing.md`. Record all nine sizing metrics and
    their source artifacts in `nodes/intake/runtime-size.json`; select no profile yourself. Let
    `t3u runtime-seal` calculate and seal the smallest fitting small/large/huge profile.
11. Produce risk/cost order, graph applicability outcomes, and a smallest-decision list for the user.
12. Resolve known approvals before unattended execution. Forecast work from measured capture/test
    throughput as well as site size. Read `../typo3-upgrade-run/references/overnight-controller.md`,
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

## Boundaries

Use `typo3-upgrade-baseline` for deterministic capture, `typo3-upgrade-migration` for changes, and
`typo3-upgrade-retrospective` when reconstructing an old run. Use `typo3-ddev` for DDEV mechanics,
but keep this skill responsible for the upgrade-specific identity verdict.
