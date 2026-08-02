# TYPO3 14.3 task catalog

Use this catalog after the runtime audit. “Baseline” means a conservative proposal, not permission
to overwrite an existing retention or operations policy.

## Core Scheduler tasks

| Task type | Group | Baseline | Required decision and parameters |
|---|---|---|---|
| `TYPO3\\CMS\\Scheduler\\Task\\CachingFrameworkGarbageCollectionTask` | Core maintenance | `17 2 * * *` | Create when one or more selected cache backends need explicit GC. Select backend classes, not cache names. Database backends normally qualify; Redis/Valkey/filesystem behavior must be verified from the configured backend. |
| `TYPO3\\CMS\\Scheduler\\Task\\FileStorageExtractionTask` | Files & metadata | `*/15 * * * *` | Create per online storage when metadata extractors are registered or extraction backlog exists. Start with `max_file_count = 100`; increase only when duration remains below the interval. |
| `TYPO3\\CMS\\Scheduler\\Task\\FileStorageIndexingTask` | Files & metadata | `8,38 * * * *` | Create per storage only when files can change outside TYPO3, such as SFTP, a remote storage, a shared volume, or another application. Backend-only uploads do not justify it. |
| `TYPO3\\CMS\\Scheduler\\Task\\IpAnonymizationTask` | Privacy & retention | `7 3 * * *` | Create per registered IP table. Core registers `sys_log` (`tstamp`, `IP`). Use mask level 2. Apply the approved age; propose 30 days if no owner/policy exists and wait for approval. |
| `TYPO3\\CMS\\Scheduler\\Task\\OptimizeDatabaseTableTask` | Core maintenance | `27 4 1 * *` | Keep absent or disabled unless the runtime uses MySQL/MariaDB and fragmentation/reclaimable space is measured. Select only proven tables. Run monthly off-peak with backups and capacity for a rebuild; never select every table by habit. |
| `TYPO3\\CMS\\Scheduler\\Task\\RecyclerGarbageCollectionTask` | Privacy & retention | `7 4 * * 0` | Create when FAL recycler folders are used and recovery relies on backups. Start with 30 days. The task recursively deletes old recycler contents and empty subfolders from top-level recycler folders. |
| `TYPO3\\CMS\\Scheduler\\Task\\TableGarbageCollectionTask` | Privacy & retention | `37 3 * * 0` | Create one task with `all_tables = true`. Core v14.3 defaults are `sys_log` 180 days, `sys_history` 30, and `sys_http_report` 30; installed extensions can add tables. Preserve runtime registrations rather than copying a fixed table list. |

The fixed task list is fully represented above. “Conditional” does not mean omitted from the
audit; it means the task is listed with a recorded create/skip decision.

## Useful installed-feature tasks

| Runtime task | Baseline | Install when | Do not install when |
|---|---|---|---|
| `TYPO3\\CMS\\Reports\\Task\\SystemStatusUpdateTask` | daily `12 6 * * *` | Reports is active, a monitored recipient exists, and TYPO3 status findings are operationally owned. Send only on issues unless a heartbeat mail is explicitly required. | External monitoring already owns the same checks and nobody will act on mail. |
| `TYPO3\\CMS\\Linkvalidator\\Task\\ValidatorTask` | weekly `17 5 * * 1` | LinkValidator is active and the start page/depth cover the real editorial site. Use daily only for high publishing volume. | The crawl would hit authenticated/rate-limited targets without an agreed configuration. |
| `form:cleanup:uploads` | daily `42 4 * * *` | Core Form uploads create `form_<hash>` folders. Discover every configured combined folder identifier. Start with the v14 default retention of 336 hours and run a CLI `--dry-run` before creating the non-interactive Scheduler task. | Forms do not upload files, or another approved process moves/retains those folders. |
| `cleanup:previewlinks` | daily `52 4 * * *` | Workspaces shared previews are used. | Workspaces/shared previews are absent. |
| `workspace:autopublish` | every 5 minutes | Workspaces use `publish_time` and publication latency of up to 5 minutes is acceptable. | Scheduled workspace publication is not used. |
| `redirects:checkintegrity` | daily `2 6 * * *` | Redirects is active, records exist, and integrity/status reporting is operationally owned. The command is a non-destructive consistency check and is preferable to cleanup when retention is unresolved. | Redirects is unused, the command is not registered, or nobody reviews the result. |
| `redirects:cleanup` | monthly/manual | Redirects has an approved policy for age, hits, domains, status, and creation type. Test the exact demand on a restored copy first because the command has no generic dry-run. | The constraints are unknown or redirects must remain indefinitely. |

## Jobs to reject by default

- **Extension list updater:** Composer is the source of installed code in TYPO3 14. Update package
  metadata in the controlled dependency workflow, not as a production Scheduler task.
- **`language:update`:** update language packs in deployment/maintenance with a recorded result;
  do not create an unattended weekday job by default.
- **Arbitrary SQL or shell command task:** use a reviewed extension command, deployment job, or
  dedicated worker. Do not install a generic scheduler extension merely to execute opaque SQL.
- **Soft-deleted record cleaner:** permanent deletion requires a table/data-owner retention
  decision and a verified backup. Table GC and FAL recycler GC do not grant that decision.
- **Reference-index update, cache flush, full reindex, or other repair command:** run on evidence as
  a bounded maintenance action, not a recurring task.

## Extension-specific discovery

For each active extension:

1. Filter the audit's `available_task_types` by its extension/category or command prefix.
2. Inspect the installed class and `vendor/bin/typo3 <command> --help`; online docs alone can differ
   from the installed release.
3. Search the extension's current documentation for “Scheduler”, “cron”, “queue”, “cleanup”,
   “retention”, “worker”, and “index”.
4. Prove the feature/data exists in this installation. A registered command is a capability, not a
   requirement.
5. Prefer cleanup/queue workers with explicit limits and retention. Reject export mails, SQL fixes,
   and customer workflow commands as generic defaults; classify them under `Project workflows`.

## Primary sources

- [TYPO3 Scheduler 14.3 basic tasks](https://docs.typo3.org/c/typo3/cms-scheduler/14.3/en-us/BasicTasks/Index.html)
- [TYPO3 Scheduler 14.3 IP anonymization](https://docs.typo3.org/c/typo3/cms-scheduler/14.3/en-us/BasicTasks/IpAnonymization.html)
- [TYPO3 Core v14.3 task implementations](https://github.com/TYPO3/typo3/tree/14.3/typo3/sysext/scheduler/Classes/Task)
- [TYPO3 Reports Scheduler task](https://docs.typo3.org/c/typo3/cms-reports/14.3/en-us/Scheduler/Index.html)
- [MySQL 8.4 online DDL and `OPTIMIZE TABLE`](https://dev.mysql.com/doc/refman/8.4/en/innodb-online-ddl-operations.html)
