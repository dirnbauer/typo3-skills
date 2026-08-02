---
name: typo3-scheduler-jobs
description: "Audits, plans, configures, groups, and verifies TYPO3 14.3 Scheduler tasks for a specific installation, including Core cache/table/privacy/FAL maintenance, LinkValidator, Reports, Form and Workspace cleanup, extension-provided commands, and EXT:solr Index Queue workers per Site root. Use for missing or overdue cron jobs, Scheduler backend setup, task groups, safe execution intervals, deciding which recurring jobs an installed TYPO3 project needs, or repairing tx_scheduler_task rows with an empty tasktype after a v14 update to JSON storage."
---

# TYPO3 Scheduler jobs

> Source: https://github.com/dirnbauer/typo3-skills

Configure the smallest complete task set justified by the selected installation. Derive tasks,
parameters, groups, and cadence from its TYPO3 14 runtime; never copy another site's rows.

## Version gate

Require TYPO3 **14.3.x**. Stop on v13, pre-14.3 development releases, or v15 and re-evaluate the
APIs. TYPO3 v14 stores task type, parameters, and execution details as structured fields; an empty
`tx_scheduler_task.tasktype` means the v14 migration failed or remains incomplete.

## Contract

1. Identify one installation and report its root, TYPO3 version, application context, and database
   platform before changing Scheduler data.
2. Prove the system cron invokes `vendor/bin/typo3 scheduler:run`. The runner must execute at least
   as often as the shortest task cadence. Do not confuse the runner cadence with each task cadence.
3. Inventory runtime-registered task types, active Sites, storages, cache backends, installed
   extensions, existing groups/tasks, failures, late tasks, and v14 storage migration defects.
4. Read [task-catalog.md](references/task-catalog.md) before selecting tasks. Include every fixed
   Core task in the decision table, but create conditional tasks only when their applicability is
   proven.
5. Build the complete task list first. Then create or reuse the five functional groups below and
   assign every enabled task; leave no unexplained task in the ungrouped section.
6. Use the conservative baseline cadence. Change it only from measured runtime, queue depth,
   publishing latency, retention policy, storage change source, or an explicit operational need.
7. Set parallel execution off. Stagger expensive work, preserve a maintenance window, and run
   destructive jobs against verified backups and an approved retention policy.
8. Create or edit tasks through the TYPO3 v14 Scheduler form/runtime model. Do not write v12 PHP
   serialized task objects, copy database rows, or install a generic command/SQL scheduler helper.
9. Run each new task manually once, inspect its failure state and effect, then let cron execute it.
10. Report configured, conditional, rejected, and project-specific tasks with the evidence and
    effective interval for each.

## Audit the selected installation

Run the bundled read-only audit from the Composer project root:

```bash
php /absolute/path/to/typo3-scheduler-jobs/scripts/audit-scheduler.php --pretty
```

For DDEV, stream it into the project container:

```bash
ddev exec php /dev/stdin -- --pretty \
  < /absolute/path/to/typo3-scheduler-jobs/scripts/audit-scheduler.php
```

Use `--strict` to return non-zero for broken v14 task storage, unregistered existing task types,
or recorded execution failures. The audit redacts arbitrary task parameters and exposes only
known-safe maintenance/Solr keys.

Also capture the Core view:

```bash
vendor/bin/typo3 scheduler:list
vendor/bin/typo3 scheduler:run --help
vendor/bin/typo3 scheduler:execute --help
```

Read [discovery-and-operations.md](references/discovery-and-operations.md) before creating,
changing, disabling, executing, or deleting a task.

## Group the final task set

Create groups only after classifying all tasks. Reuse an existing group when its meaning matches.

| Sort | Group | Put these jobs here |
|---:|---|---|
| 10 | `Core maintenance` | Cache GC, database optimization, status reports |
| 20 | `Privacy & retention` | IP anonymization, table GC, recycler, upload/redirect cleanup |
| 30 | `Files & metadata` | FAL storage indexing and metadata extraction |
| 40 | `Search & content quality` | Solr workers, LinkValidator |
| 50 | `Project workflows` | Workspace publishing and reviewed project/extension commands |

Use task descriptions to record the applicability evidence, retention owner, selected Site/storage,
and why the cadence differs from the baseline. Group disabling is an operational kill switch, not
a substitute for disabling or removing an invalid task.

## Apply the cadence policy

Classify frequency before choosing a cron expression:

- **Very frequent:** every minute or every 2 minutes. Reserve this for a measured, latency-sensitive
  queue. It magnifies failures and load.
- **Interactive-safe middle:** every 5 minutes for search/event/publishing queues; every 15–30
  minutes for file discovery or extraction.
- **Maintenance-safe middle:** daily for low-cost privacy/status work; weekly for broad deletion,
  crawling, and recycler work; monthly and off-peak for measured database reorganization.
- **Very infrequent:** monthly, quarterly, or manual. Use this for expensive recovery and rebuild
  operations, not for a queue whose users expect fresh results.

Never make a task more frequent than its worst observed duration plus headroom. Keep parallel
execution disabled and fix backlog/capacity before shortening the interval.

## Configure the baseline

Use the detailed parameters and exceptions in [task-catalog.md](references/task-catalog.md).

- Create daily cache GC only for selected backends that require explicit collection.
- Create daily IP anonymization for every runtime-registered IP table, with a documented retention
  value. Propose 30 days when no policy exists; require approval before applying it.
- Create weekly "all configured tables" GC so Core and installed extensions retain their own
  registered expiry periods.
- Create FAL extraction per applicable storage. Create FAL storage indexing only where files can
  change outside TYPO3.
- Keep database optimization conditional on MySQL/MariaDB, measured reclaimable space, and a
  maintenance window.
- Create conditional LinkValidator, Reports, Form, Redirects, Workspace, and extension jobs only
  when their installed feature and data path are in use.

## Configure EXT:solr 14

If `apache-solr-for-typo3/solr` is installed, read [solr-v14.md](references/solr-v14.md) before
writing tasks.

Create exactly one `IndexQueueWorkerTask` per configured TYPO3 Site that is indexed. Select the
Site whose root page is the actual start of that website's records; EXT:solr stores this root page
UID. Default to every 5 minutes and 50 documents per run, then tune from queue age and measured
duration. Add the Event Queue Worker only for delayed monitoring (`monitoringType = 1`).

Do not schedule recurring forced reindexing or Solr optimize as routine maintenance. Use them as
reviewed recovery/maintenance operations. EXT:solr 14 removed the forced-webroot task field; never
recreate it from older installations.

## Verify and hand off

1. Run `scheduler:list`; verify every enabled task has a group, future next execution, expected
   frequency, and no failure.
2. Execute each new task by UID with `scheduler:execute --task=<uid>` in a safe environment.
3. Run `scheduler:run`, then verify `lastexecution_time`, next execution, logs, affected rows/files,
   Solr queue age, and notification delivery as applicable.
4. Confirm the external cron independently. A green manual run does not prove cron calls TYPO3.
5. Re-audit after one full weekly cycle and after every TYPO3/extension major update.

Deliver a table with task/group, task type, parameters, cadence, applicability evidence, manual-run
result, and keep/change/remove verdict. Never claim completion while a required task is late,
failed, ungrouped, or dependent on an unverified runner.
