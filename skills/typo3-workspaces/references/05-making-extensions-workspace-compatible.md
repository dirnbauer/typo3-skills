# 5. Making Extensions Workspace-Compatible

Continues `typo3-workspaces` from [full guide](full-guide.md).

## Contents

- [Step 1: Enable versioningWS in TCA](#step-1-enable-versioningws-in-tca)
- [Step 2: Disable Versioning for Specific Tables](#step-2-disable-versioning-for-specific-tables)
- [Step 3: Allow Live Editing in Workspaces](#step-3-allow-live-editing-in-workspaces)
- [Step 4: Backend Overlay (REQUIRED for Backend Modules)](#step-4-backend-overlay-required-for-backend-modules)
- [Step 5: Frontend Overlay (REQUIRED for Frontend Plugins)](#step-5-frontend-overlay-required-for-frontend-plugins)
- [Step 6: Backend Module Workspace Restriction](#step-6-backend-module-workspace-restriction)

## 5. Making Extensions Workspace-Compatible

### Step 1: Enable versioningWS in TCA

```php
<?php
// EXT:my_extension/Configuration/TCA/tx_myextension_domain_model_item.php

return [
    'ctrl' => [
        'title' => 'LLL:EXT:my_extension/Resources/Private/Language/locallang_db.xlf:tx_myextension_domain_model_item',
        'label' => 'title',
        'tstamp' => 'tstamp',
        'crdate' => 'crdate',
        'delete' => 'deleted',
        'sortby' => 'sorting',
        // Enable workspace versioning
        'versioningWS' => true,
        // Language support
        'languageField' => 'sys_language_uid',
        'transOrigPointerField' => 'l10n_parent',
        'transOrigDiffSourceField' => 'l10n_diffsource',
        'translationSource' => 'l10n_source',
        'enablecolumns' => [
            'disabled' => 'hidden',
            'starttime' => 'starttime',
            'endtime' => 'endtime',
        ],
        'iconfile' => 'EXT:my_extension/Resources/Public/Icons/item.svg',
    ],
    // ... columns, types, palettes
];
```

The `t3ver_*` database columns are **auto-created** when `versioningWS = true` -- you do NOT need to add them to `ext_tables.sql`. Similarly, `enablecolumns` fields (`hidden`, `starttime`, `endtime`) and language fields (`sys_language_uid`, `l10n_parent`, `l10n_diffsource`) get **auto-created TCA column definitions** from `ctrl` on TYPO3 v14 -- you do NOT need to define them in `'columns'`.

After enabling, run:

```bash
bin/typo3 extension:setup
```

### Step 2: Disable Versioning for Specific Tables

If a table must NOT be versioned (e.g., logging, statistics):

```php
<?php
// EXT:my_extension/Configuration/TCA/Overrides/tx_myextension_log.php

$GLOBALS['TCA']['tx_myextension_log']['ctrl']['versioningWS'] = false;
```

### Step 3: Allow Live Editing in Workspaces

For tables without workspace support that editors still change while working in a workspace (e.g., user settings, configuration). The flag only works without `versioningWS`: since a 14.3 patch after 14.3.7 (Important #106077, present in 14.3.9) TCA migration removes it from workspace-aware tables with a deprecation entry, and their records are always versioned.

```php
<?php
// EXT:my_extension/Configuration/TCA/Overrides/tx_myextension_settings.php

// Records of this table are edited live even when a workspace is active
$GLOBALS['TCA']['tx_myextension_settings']['ctrl']['versioningWS_alwaysAllowLiveEdit'] = true;
```

### Step 4: Backend Overlay (REQUIRED for Backend Modules)

```php
<?php

declare(strict_types=1);

namespace MyVendor\MyExtension\Controller;

use TYPO3\CMS\Backend\Utility\BackendUtility;
use TYPO3\CMS\Core\Database\Connection;
use TYPO3\CMS\Core\Database\ConnectionPool;

final class BackendItemController
{
    public function __construct(
        private readonly ConnectionPool $connectionPool,
    ) {}

    /**
     * Fetch a single record with workspace overlay.
     */
    public function getItem(int $uid): ?array
    {
        // Option A: One-liner (recommended)
        $row = BackendUtility::getRecordWSOL('tx_myextension_domain_model_item', $uid);

        // Option B: Manual (equivalent to A)
        // $row = BackendUtility::getRecord('tx_myextension_domain_model_item', $uid);
        // BackendUtility::workspaceOL('tx_myextension_domain_model_item', $row);

        return is_array($row) ? $row : null;
    }

    /**
     * Fetch multiple records with workspace overlay.
     */
    public function getItemsByPage(int $pageId): array
    {
        $queryBuilder = $this->connectionPool
            ->getQueryBuilderForTable('tx_myextension_domain_model_item');

        $result = $queryBuilder
            ->select('*')
            ->from('tx_myextension_domain_model_item')
            ->where(
                $queryBuilder->expr()->eq(
                    'pid',
                    $queryBuilder->createNamedParameter($pageId, Connection::PARAM_INT)
                )
            )
            ->executeQuery();

        $items = [];
        while ($row = $result->fetchAssociative()) {
            // Apply the workspace overlay to each row; without it the live row is returned
            BackendUtility::workspaceOL('tx_myextension_domain_model_item', $row);
            if (is_array($row)) {
                $items[] = $row;
            }
        }

        return $items;
    }
}
```

### Step 5: Frontend Overlay (REQUIRED for Frontend Plugins)

```php
<?php

declare(strict_types=1);

namespace MyVendor\MyExtension\Service;

use TYPO3\CMS\Core\Database\Connection;
use TYPO3\CMS\Core\Database\ConnectionPool;
use TYPO3\CMS\Core\Domain\Repository\PageRepository;

final class ItemService
{
    public function __construct(
        private readonly ConnectionPool $connectionPool,
        private readonly PageRepository $pageRepository,
    ) {}

    /**
     * Fetch items with workspace + language overlay for frontend rendering.
     */
    public function findByPage(int $pageId): array
    {
        $queryBuilder = $this->connectionPool
            ->getQueryBuilderForTable('tx_myextension_domain_model_item');

        $result = $queryBuilder
            ->select('*')
            ->from('tx_myextension_domain_model_item')
            ->where(
                $queryBuilder->expr()->eq(
                    'pid',
                    $queryBuilder->createNamedParameter($pageId, Connection::PARAM_INT)
                )
            )
            ->executeQuery();

        $items = [];
        while ($row = $result->fetchAssociative()) {
            // Apply workspace overlay (MUST be called before language overlay)
            $this->pageRepository->versionOL('tx_myextension_domain_model_item', $row);
            if (!is_array($row)) {
                continue;
            }
            // Apply language overlay
            $row = $this->pageRepository->getLanguageOverlay(
                'tx_myextension_domain_model_item',
                $row
            );
            if (is_array($row)) {
                $items[] = $row;
            }
        }

        return $items;
    }
}
```

### Step 6: Backend Module Workspace Restriction

```php
<?php
// EXT:my_extension/Configuration/Backend/Modules.php

return [
    'my_module' => [
        // v14: primary web modules use parent `content`; compare with Core `Configuration/Backend/Modules.php`
        'parent' => 'content',
        'position' => ['after' => 'records'],
        'access' => 'user',
        // Control workspace availability:
        // '*'       = available in all workspaces (default)
        // 'live'    = only available in live workspace
        // 'offline' = only available in custom workspaces
        'workspaces' => '*',
        'iconIdentifier' => 'my-module-icon',
        'labels' => 'LLL:EXT:my_extension/Resources/Private/Language/locallang_mod.xlf',
        'routes' => [
            '_default' => [
                'target' => \MyVendor\MyExtension\Controller\MyModuleController::class . '::handleRequest',
            ],
        ],
    ],
];
```
