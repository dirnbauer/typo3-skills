# EXT:solr 14 Scheduler configuration

Apply this only when the installed `apache-solr-for-typo3/solr` release supports TYPO3 14. Verify
the installed source because v14 task APIs are still evolving.

## Select the correct website start

For every indexed TYPO3 Site:

1. Resolve the Site with `SiteFinder`; use its `rootPageId`.
2. Verify the same page exists and has `pages.is_siteroot = 1`.
3. Verify EXT:solr connection and indexing configuration resolve at that Site root.
4. Select that **Site** in the Index Queue Worker task. The stored `rootPageId` is the website's
   start for queue processing. Do not use a search-result page, plugin starting point, shared
   sysfolder, domain record, or an ancestor containing several Sites.
5. Create one worker per indexed Site root. Do not use one task to represent several Sites.

EXT:solr normally monitors records inside the Site tree. For a shared storage folder outside that
tree, add only its proven PIDs to:

```typoscript
plugin.tx_solr.index.queue.<queueName>.additionalPageIds = 45,48
```

Keep `useConfigurationTrackRecordsOutsideSiteroot` enabled only when this is needed; outside-root
tracking has a performance cost. Prefer unnested Site roots and keep each Site's indexing
configuration at its actual root.

## Task baseline

| Task | Group | Baseline | Parameters |
|---|---|---|---|
| `ApacheSolrForTypo3\\Solr\\Task\\IndexQueueWorkerTask` | Search & content quality | every 5 minutes | One per Site root; start with `documentsToIndexLimit = 50`, the v14 form default. Parallel execution off. |
| `ApacheSolrForTypo3\\Solr\\Task\\EventQueueWorkerTask` | Search & content quality | every 5 minutes | Create only for `monitoringType = 1` (delayed); start with `limit = 100`. One global worker is sufficient. |
| `ApacheSolrForTypo3\\Solr\\Task\\ReIndexTask` | Search & content quality | disabled/manual | Use for an approved recovery or bounded refresh of selected configurations. Never use as routine freshness. |
| `ApacheSolrForTypo3\\Solr\\Task\\OptimizeIndexTask` | Search & content quality | disabled/manual | Run only when the Solr operator has evidence that an optimize is needed and the expensive merge fits the maintenance window. |

Use the runtime-registered Table Garbage Collection configuration for `tx_solr_statistics`; EXT:solr
14 currently contributes its retention to that task. Do not duplicate it with direct SQL.

## Tune safely

- One or two minutes is very frequent. Use it only when search freshness has an agreed sub-five-
  minute objective and observed worker duration/queue load supports it.
- Fifteen minutes is the conservative opposite for ordinary editorial search, but leaves users
  waiting. Five minutes is the baseline middle.
- Keep 50 documents per run initially. Inspect queue age, items added per five minutes, failures,
  PHP memory, Solr response time, and worker duration. Increase the batch before shortening the
  interval when a stable worker simply needs more throughput.
- Require worker duration below the cadence with at least 50% headroom. Keep parallel execution
  disabled; overlapping page rendering/index writes cause harder failures than a controlled queue.
- Monitoring mode `0` updates the queue immediately and needs no Event Queue Worker. Mode `1`
  requires it. Mode `2` disables monitoring and requires a separately documented update strategy.

## TYPO3 14 differences

- EXT:solr 14's selected Site is persisted as `rootPageId` in the Scheduler task parameters.
- The v14 in-process indexing pipeline removed the old `forcedWebRoot` task option. Treat that field
  in migrated/copied advice as stale.
- Ensure the TYPO3 v14 Scheduler database migration completed; EXT:solr 14 tasks implement
  `getTaskParameters()` / `setTaskParameters()` for the JSON-based storage.
- Recreate an invalid task only after preserving its intended Site, limit, cadence, group, and
  enabled state in a reviewed plan.

## Verify

1. Initialize the Index Queue for the Site's enabled configurations.
2. Execute its worker once and confirm queue count falls without failures.
3. Change a record under the Site root and confirm it is queued for that root.
4. If using `additionalPageIds`, change one shared record and confirm every intended Site receives
   the item—no unintended Site may receive it.
5. Wait one scheduled interval and confirm `scheduler:run` advances the task and search shows the
   change.

## Primary sources

- [EXT:solr Scheduler tasks](https://docs.typo3.org/p/apache-solr-for-typo3/solr/main/en-us/Backend/Scheduler.html)
- [EXT:solr v14 release notes](https://docs.typo3.org/p/apache-solr-for-typo3/solr/main/en-us/Releases/solr-release-14-0.html)
- [Index Queue and records outside the Site root](https://docs.typo3.org/p/apache-solr-for-typo3/solr/main/en-us/Backend/IndexQueue.html)
- [EXT:solr v14 task source](https://github.com/TYPO3-Solr/ext-solr/tree/main/Classes/Task)
