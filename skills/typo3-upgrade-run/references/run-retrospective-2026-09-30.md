# Seven-site fleet run — 2026-09-30

## Scope and evidence

Seven TYPO3 12.4/13.4 sites were driven toward 14.3 in parallel on one machine from 2026-09-28, each in
its own sealed graph. Read for this review: node evidence, decision records and the fleet backlog; no
site was changed, and no site, host or record id is named. State on 2026-09-29: one Contract A closure
(third closure epoch) with a staging publication; one site stopped at the Lighthouse proof; one held at
`rung-14` by the change-scope guard; one at mechanical migration, due for a new run on the
partial-raster fix; one blocked at `rung-14` when its window ended, on a byte-identical og:image rename
the HTTP stage could not prove yet; two stopped at intake on access questions. Nine harness pull
requests were merged while the fleet ran (#4–#7, #9–#13).

## Lessons and where they live

| Lesson | Control |
|---|---|
| Intermediate samples never drew the only form page; powermail 13 had broken it three ways | [force-include upgraded packages](measurement-recipes.md#intermediate-loops-on-stateful-rungs), [powermail](known-problems.md#a-powermail-form-loses-its-styling-or-layout-after-the-134-rung) |
| A pixel flake looked like an intermediate-scope artifact; it was partial raster | [count before trusting the scope](measurement-recipes.md#intermediate-loops-on-stateful-rungs) |
| 14.3 broke pages behind HTTP 200 or a uniform 500 | [`.txt` includes](known-problems.md#typoscript-silently-stops-loading-after-the-v14-rung-or-every-page-answers-500), [escaped RTE](known-problems.md#rte-content-renders-as-escaped-tags-after-the-v14-rung), [empty list](known-problems.md#a-list-renders-empty-after-the-v14-rung-or-a-site-package-class-is-fatal), [relative URLs](known-problems.md#relative-asset-urls-load-a-404-page-under-a-trailing-slash) |
| Core-mandated output changes needed declarations, not restores | [sitemap parameter](known-problems.md#sitemap-index-child-urls-change-after-the-v14-rung), [processed images](known-problems.md#processed-images-change-name-or-lose-1-px-after-the-v14-rung), [`asset:` query](known-problems.md#every-pages-ogimage-reads-oops-an-error-occurred-after-fractor) |
| The Mask importer's output needed six template and schema fixes | [Mask to Content Blocks](mask-to-content-blocks.md#six-fixes-the-generated-blocks-needed) |
| A 14.3 save differed from a 12.4 save only by CKEditor 47 list-item ids | [RTE round trip](measurement-recipes.md#rte-round-trip-proof), [preset fix](known-problems.md#stored-rich-text-gains-data-list-item-id-on-every-list-item) |
| Redirects hidden from editors; a monitoring module denied to admins | [Redirects](known-problems.md#editors-with-redirects-rights-see-no-redirects-module), [module access](known-problems.md#a-backend-module-is-gone-for-admins-or-fails-on-a-protected-method) |
| Journey scripts met beacon POSTs, a silent spam redirect and a sweep refused after a write | [proof scripts](measurement-recipes.md#proof-scripts-journeys-sweeps-and-row-diffs), [silent spam redirect](known-problems.md#a-spam-test-submission-is-rejected-without-any-message) |
| A code commit and a stale self-test lock each cost a closure epoch | [epoch order](closure-currentness.md#epoch-order-what-makes-a-new-epoch-stale), [tracked files](known-problems.md#logging-in-as-admin-or-opening-the-install-tool-changes-tracked-files) |
| A self-test inside an open rung left it closable only as `blocked` | [guards](graph-runner.md#what-the-guards-refuse) |
| A generic Lighthouse floor met a slow LCP the old site already had | [floors at intake](quality-bars.md#contract-a-lighthouse-floors-decided-at-intake) |
| Parallel DDEV stacks drove the load to ~80 and failed a self-test | [load across projects](parallel-execution.md#load-across-projects) |
| Seven runs on six pins; judgement fixes needed owner-approved re-seals | [harness pins](fleet-profile.md#harness-pins-across-a-fleet) |

## What did not change

The graph, the thirteen closure checks, strict-zero pixels, the three global states and the 8/24/48-hour
caps stay as they were. Measured per run on one machine: a self-test took 21–27 minutes and a
full-scope recapture 8–15 minutes; forecast from `graph-report` data, not from these figures.
