# Discovery and operations

## Discover from the selected runtime

Collect all of these before proposing tasks:

- exact TYPO3 14.3 patch release and database platform;
- registered Scheduler task types and schedulable commands;
- existing v14 tasks/groups, parameters, execution details, priorities, late/failure status;
- active Sites and root page IDs, plus `pages.is_siteroot` mismatches;
- active file storages and whether anything writes outside TYPO3;
- configured cache backend classes and which implement their own GC;
- Table GC and IP anonymization tables registered in runtime TCA;
- installed features that create queues, temporary files, reports, preview links, redirects, or
  retained personal data;
- external cron/systemd/Kubernetes/hosting job that calls `scheduler:run`.

Use the bundled audit for the TYPO3 runtime and `composer show --direct` for package intent. Search
installed source as the final authority:

```bash
rg -n -i 'scheduler|AsCommand|cleanup|retention|worker|queue' vendor packages
vendor/bin/typo3 list --raw
vendor/bin/typo3 <candidate-command> --help
```

TYPO3 14 exposes most console commands as Scheduler task types unless explicitly unschedulable.
Availability therefore does not imply that a command should recur.

## Build an installation plan

For every candidate record:

```text
key, task type/command, applicability evidence, group, safe parameters,
retention owner, cadence, maximum observed duration, destructive effect,
manual verification, rollback/recovery path, create/change/keep/remove verdict
```

Match an existing task by UID and task type. For per-Site/per-storage tasks, also match the Site root
or storage UID. Never deduplicate solely by human-readable title. Preserve user-managed tasks until
their replacement has executed successfully.

## Configure through TYPO3

Use **Administration > Scheduler** for generic installation work because the v14 form resolves the
installed task type, extension-specific fields, task groups, cron validation, and JSON storage.
Create groups on the root page (`pid = 0`) after the plan is complete, then add/edit tasks and assign
them.

For a project-owned repeatable setup, implement an installation-specific command or upgrade wizard
that boots the exact TYPO3 runtime and uses DataHandler/the v14 Scheduler domain model. Verify the
installed source first: `TaskService` and `SchedulerTaskRepository` are internal APIs. Do not ship a
cross-project SQL insert or a serialized task fixture.

## Control tasks

List tasks:

```bash
vendor/bin/typo3 scheduler:list
vendor/bin/typo3 scheduler:list --group=<groupUid>
```

Run a reviewed task immediately, regardless of due time:

```bash
vendor/bin/typo3 scheduler:execute --task=<taskUid>
```

Run due tasks as the external runner does:

```bash
vendor/bin/typo3 scheduler:run
```

Use the exact v14.3 `--help` output for any additional flags. Disable a task to preserve its
configuration while investigating. Disable a whole group only for an incident/maintenance window;
record who will re-enable it. Delete a task only after its responsibility is removed or a verified
replacement exists.

## Verify the selected execution mode

A correct task table is inert without an external runner. That is intentional in manual-only mode,
not a defect to repair without permission.

For **manual-only** operation:

1. Inventory crontabs, hosting schedules, systemd/Kubernetes jobs, and container supervisors.
2. Confirm none invokes this installation's `vendor/bin/typo3 scheduler:run`.
3. Do not install a DDEV cron add-on or another runner. Provide reviewed per-task
   `scheduler:execute --task=<uid>` commands instead.
4. If an existing runner conflicts with the user's manual-only instruction, verify its exact owner
   and target before disabling/removing it, then confirm it is absent.

For explicitly approved **automatic** operation, confirm all layers:

1. The hosting scheduler invokes the current release path under the correct PHP binary, user,
   environment, and working directory.
2. Runner cadence covers the shortest approved task cadence; task cadence still controls whether
   TYPO3 executes the task.
3. Prevent two infrastructure runners from calling the same installation concurrently.
4. Capture non-zero exits and logs externally; TYPO3 task status alone does not prove runner health.
5. Alert when an enabled task is late by more than two expected intervals or records a failure.

## Migrate into v14 safely

TYPO3 v14 changed Scheduler storage from PHP-serialized task objects to structured fields including
`tasktype`, JSON `parameters`, and JSON `execution_details`.

- Run the Core Upgrade Wizard `schedulerDatabaseStorageMigration` after updating.
- Treat rows with empty `tasktype` as incomplete migration.
- Confirm each extension's v14 task implements parameter migration support.
- Recreate an unmigratable task from a reviewed plan, not from the old serialized blob.
- Remove legacy rows only after the new task succeeds and a database backup exists.

## Completion gate

Fail the handoff if any of these remain unexplained:

- empty `tasktype`, unregistered task class/command, or failed v14 migration;
- enabled task with last-execution failure;
- required task absent or in a disabled group; in automatic mode also fail for a late task, while
  in manual-only mode report lateness as the expected consequence of the selected execution mode;
- duplicate worker for the same Site/storage/responsibility;
- destructive task without retention owner and recovery path;
- enabled task with no group;
- execution mode not stated, or automatic execution claimed without an independently verified
  runner;
- manual-only mode requested but an external runner still targets the installation.

Primary references: [task storage](https://docs.typo3.org/c/typo3/cms-scheduler/14.3/en-us/DevelopersGuide/TaskStorage/Index.html),
[console tools](https://docs.typo3.org/c/typo3/cms-scheduler/14.3/en-us/Administration/ConsoleTools/Index.html),
and [task groups](https://docs.typo3.org/c/typo3/cms-scheduler/14.3/en-us/Administration/GroupTask/Index.html).
