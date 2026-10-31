---
name: "typo3-datahandler"
description: "Creates, updates, moves, localizes and deletes TYPO3 records programmatically from PHP - import scripts, CLI commands, data migrations - using DataHandler datamaps and cmdmaps. Use when writing hundreds of pages or records from JSON, CSV or another system and the parent references must stay intact, when the reference index goes stale after moving records, when imported records show up owned by nobody because the backend user context is wrong, when localizing an existing element into another language from code, or when extending record operations with hooks and PSR-14 events. Workspace-aware."
compatibility: "TYPO3 14.x"
metadata:
  skill_type: preference
  version: "2.2.0"
  origin: "webconsulting"
license: "MIT / CC-BY-SA-4.0"
---
# TYPO3 DataHandler Operations

> Source: https://github.com/dirnbauer/webconsulting-skills

## 1. Rules

- **Write TCA-configured tables only through DataHandler**, never with raw `INSERT`, `UPDATE` or
  `DELETE` on `pages`, `tt_content` or any other TCA table. Raw SQL skips everything DataHandler
  maintains: the reference index (`sys_refindex`), cache clearing, history (`sys_history`), workspace
  versions, Core hooks and events (see the hooks reference below), FlexForm handling and MM relations.
- **Create one instance per operation** with `GeneralUtility::makeInstance(DataHandler::class)`.
  DataHandler is stateful, so do not inject it through a constructor; avoid `new DataHandler()` so
  Core wiring stays intact.
- **Run it with a real backend user.** In CLI and Scheduler context call
  `Bootstrap::initializeBackendAuthentication()` (the `_cli_` user) or pass a
  `BackendUserAuthentication` as the third `start()` argument. Never fake admin rights by mutating
  `$GLOBALS['BE_USER']->user`; records then end up owned by the wrong user or by nobody.
- **Check the result every time**: read `errorLog`, and map new records through `substNEWwithIDs`.
- **Verify DataHandler APIs against the installed 14.3 source**; several properties were removed in
  v14 (see [v14-only changes](references/v14-only-changes.md)).

Raw SQL stays acceptable for custom tables without TCA, read-only reporting queries, and migration
scripts that rebuild the reference index explicitly afterwards.

## 2. Structure of Arrays

### The DataMap ($data)

Used for **creating** or **updating** records.

**Syntax:** `$data[tableName][uid][fieldName] = value`

**Creating a New Record:**

Use a unique string starting with `NEW` as the UID:

```php
<?php
declare(strict_types=1);

$data = [
    'tt_content' => [
        'NEW_1' => [
            'pid' => 1,
            'CType' => 'text',
            'header' => 'My New Content Element',
            'bodytext' => '<p>Content goes here</p>',
            'sys_language_uid' => 0,
        ],
    ],
];
```

**Updating an Existing Record:**

Use the numeric UID:

```php
<?php
declare(strict_types=1);

$data = [
    'tt_content' => [
        123 => [
            'header' => 'Updated Header',
            'hidden' => 0,
        ],
    ],
];
```

**Referencing NEW Records:**

```php
<?php
declare(strict_types=1);

$data = [
    'pages' => [
        'NEW_page' => [
            'pid' => 1,
            'title' => 'New Page',
        ],
    ],
    'tt_content' => [
        'NEW_content' => [
            'pid' => 'NEW_page', // References the new page
            'CType' => 'text',
            'header' => 'Content on new page',
        ],
    ],
];
```

### The CmdMap ($cmd)

Used for **moving**, **copying**, **deleting**, or **undeleting** records.

**Syntax:** `$cmd[tableName][uid][command] = value`

**Delete a Record:**

```php
<?php
declare(strict_types=1);

$cmd = [
    'tt_content' => [
        123 => ['delete' => 1],
    ],
];
```

**Move a Record:**

```php
<?php
declare(strict_types=1);

$cmd = [
    'tt_content' => [
        123 => ['move' => 456], // Target page UID; use negative UID to place after record
    ],
];
```

**Copy a Record:**

```php
<?php
declare(strict_types=1);

$cmd = [
    'tt_content' => [
        123 => ['copy' => 1], // Target page UID
    ],
];
```

**Localize a Record:**

```php
<?php
declare(strict_types=1);

$cmd = [
    'tt_content' => [
        123 => [
            'localize' => 1, // Target language UID
        ],
    ],
];
```

## 3. Execution Pattern

The DataHandler API in TYPO3 14.3 (checked against 14.3.9):

1. Obtain a `DataHandler` with `GeneralUtility::makeInstance(DataHandler::class)` per use.
2. Call `start($dataMap, $commandMap, $backendUser = null)` before any `process_*` call. `start()`
   also accepts a `ReferenceIndexUpdater` and a `CorrelationId` as fourth and fifth arguments; Core
   passes them to DataHandler sub-instances, so extension code uses only the first three.
3. Call `process_datamap()` and / or `process_cmdmap()`.
4. Inspect `$dataHandler->errorLog`, verify the expected keys in `$dataHandler->substNEWwithIDs` for
   new records, and in workspaces review `$dataHandler->autoVersionIdMap` when you expect version
   rows. `substNEWwithIDs` is public API; `errorLog` and `autoVersionIdMap` are annotated `@internal`
   in 14.3.9 but have no public replacement, so read them and never write them.

**Cache:** Prefer `CacheManager` / cache groups or PSR-14 cache events instead of legacy DataHandler cache helpers.

The official docs do **not** define a general transaction contract for DataHandler. In normal extension code, use the plain API first and only add your own transaction handling after carefully validating the database connections and side effects involved in your specific use case.

```php
<?php
declare(strict_types=1);

namespace Vendor\Extension\Service;

use TYPO3\CMS\Core\DataHandling\DataHandler;
use TYPO3\CMS\Core\Utility\GeneralUtility;

final class ContentService
{
    public function createOrUpdateContent(array $data, array $cmd = []): array
    {
        /** @var DataHandler $dataHandler */
        $dataHandler = GeneralUtility::makeInstance(DataHandler::class);
        $dataHandler->start($data, $cmd);

        if ($data !== []) {
            $dataHandler->process_datamap();
        }

        if ($cmd !== []) {
            $dataHandler->process_cmdmap();
        }

        if ($dataHandler->errorLog !== []) {
            throw new \RuntimeException(
                'DataHandler error: ' . implode(', ', $dataHandler->errorLog),
                1700000001
            );
        }

        return $dataHandler->substNEWwithIDs;
    }
}
```

## 4. Backend Context

DataHandler needs a valid backend user context. Provide a real backend user object instead of faking admin mode by mutating `$GLOBALS['BE_USER']->user`.

- In **CLI / scheduler** contexts, initialize backend authentication before using DataHandler
- TYPO3 commands use the `_cli_` backend user
- If you need another backend user, pass a proper `BackendUserAuthentication` object as the **third** argument to `start()`
- Use permission checks and a real backend user object instead of manually setting `$GLOBALS['BE_USER']->user['admin'] = 1`

### CLI Command Setup (TYPO3 v14)

```php
<?php
declare(strict_types=1);

namespace Vendor\Extension\Command;

use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;
use TYPO3\CMS\Core\Core\Bootstrap;

#[AsCommand(
    name: 'myext:import',
    description: 'Import data using DataHandler',
)]
final class ImportCommand extends Command
{
    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        Bootstrap::initializeBackendAuthentication();

        // Your DataHandler logic here...

        return Command::SUCCESS;
    }
}
```

### Using an Alternative Backend User

```php
<?php
declare(strict_types=1);

use TYPO3\CMS\Core\Authentication\BackendUserAuthentication;
use TYPO3\CMS\Core\DataHandling\DataHandler;
use TYPO3\CMS\Core\Utility\GeneralUtility;

final class ImportService
{
    public function runAsUser(
        array $data,
        array $cmd,
        BackendUserAuthentication $backendUser
    ): void {
        /** @var DataHandler $dataHandler */
        $dataHandler = GeneralUtility::makeInstance(DataHandler::class);
        $dataHandler->start($data, $cmd, $backendUser);
        $dataHandler->process_datamap();
        $dataHandler->process_cmdmap();

        if ($dataHandler->errorLog !== []) {
            throw new \RuntimeException(
                'DataHandler error: ' . implode(', ', $dataHandler->errorLog),
                1700000001
            );
        }
    }
}
```

## 5. Reference Index Handling

For **normal DataHandler writes**, TYPO3 keeps the Reference Index in sync automatically. You usually **do not** need to call `ReferenceIndex` manually after ordinary `process_datamap()` / `process_cmdmap()` usage.

Manual Reference Index updates are primarily relevant for:

- Deployments and TYPO3 upgrades
- Changes to TCA-defined relations
- Migrations or scripts that bypass DataHandler
- Repair / maintenance scenarios

### Rebuild the full Reference Index

```bash
vendor/bin/typo3 referenceindex:update
```

### Update a specific record manually (discouraged)

In v14 both `ReferenceIndex` and `updateRefIndexTable()` are `@internal` — extensions shouldn't fiddle with the reference index themselves. Prefer `vendor/bin/typo3 referenceindex:update` or let DataHandler maintain the index. If you still call the internal API, expect it to change without deprecation:

```php
<?php
declare(strict_types=1);

use TYPO3\CMS\Core\Database\ReferenceIndex;
use TYPO3\CMS\Core\Utility\GeneralUtility;

// @internal API — discouraged; prefer referenceindex:update or DataHandler
$referenceIndex = GeneralUtility::makeInstance(ReferenceIndex::class);
$referenceIndex->updateRefIndexTable('tt_content', 123);
```


## References

Load only the file the current task needs:

- [Common pitfalls](references/06-common-pitfalls.md): when a write silently does nothing, lands on
  the wrong page or language, or loses relations.
- [Retrieving new record UIDs](references/07-retrieving-new-record-uids.md): when later steps need
  the uids of records created with `NEW…` placeholders.
- [Workspace-aware operations](references/08-workspace-aware-operations.md): when writing, publishing
  or discarding records inside a workspace.
- [Extending DataHandler: hooks and real Core events](references/09-extending-datahandler-hooks-and-real-core-events.md):
  when reacting to record operations; Core has no generic before/after record operation event.
- [Version constraints for extensions](references/10-version-constraints-for-extensions.md): when
  declaring the TYPO3 and PHP range of an extension that uses DataHandler.
- [v14-only changes](references/v14-only-changes.md): when code written for v12 or v13 uses removed
  DataHandler properties or commands.
- [Credits and attribution](references/credits-and-attribution.md): when citing sources.
