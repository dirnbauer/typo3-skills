#!/usr/bin/env php
<?php

declare(strict_types=1);

use Doctrine\DBAL\Connection;
use TYPO3\CMS\Backend\Module\ModuleRegistry;
use TYPO3\CMS\Core\Authentication\Mfa\MfaProviderRegistry;
use TYPO3\CMS\Core\Core\Bootstrap;
use TYPO3\CMS\Core\Core\SystemEnvironmentBuilder;
use TYPO3\CMS\Core\Database\ConnectionPool;
use TYPO3\CMS\Core\Site\SiteFinder;
use TYPO3\CMS\Core\Utility\GeneralUtility;

$options = getopt('', ['dry-run', 'plan:']);
if (!isset($options['plan']) || $options['plan'] === false || trim((string)$options['plan']) === '') {
    fwrite(STDERR, "Pass --plan=/absolute/container/path/to/permission-plan.json.\n");
    exit(64);
}

$planPath = (string)$options['plan'];
if (!is_file($planPath)) {
    fwrite(STDERR, sprintf("Plan file not found: %s\n", $planPath));
    exit(66);
}
try {
    $plan = json_decode((string)file_get_contents($planPath), true, 512, JSON_THROW_ON_ERROR);
} catch (JsonException $exception) {
    fwrite(STDERR, 'Invalid plan JSON: ' . $exception->getMessage() . "\n");
    exit(65);
}
if (!is_array($plan) || array_is_list($plan)) {
    fwrite(STDERR, "The permission plan must be a JSON object.\n");
    exit(65);
}

$projectRoot = getcwd();
while ($projectRoot !== DIRECTORY_SEPARATOR && !is_file($projectRoot . '/vendor/autoload.php')) {
    $projectRoot = dirname($projectRoot);
}
if (!is_file($projectRoot . '/vendor/autoload.php')) {
    fwrite(STDERR, "Run this script from a Composer TYPO3 project root.\n");
    exit(64);
}

$classLoader = require $projectRoot . '/vendor/autoload.php';
SystemEnvironmentBuilder::run(1, SystemEnvironmentBuilder::REQUESTTYPE_CLI);
$container = Bootstrap::init($classLoader);

/** @var ConnectionPool $connectionPool */
$connectionPool = $container->get(ConnectionPool::class);
$connection = $connectionPool->getConnectionForTable('be_groups');
$moduleRegistry = GeneralUtility::makeInstance(ModuleRegistry::class);
$mfaProviderRegistry = GeneralUtility::makeInstance(MfaProviderRegistry::class);
$siteFinder = GeneralUtility::makeInstance(SiteFinder::class);

$title = requireString($plan, 'title');
if (mb_strlen($title) > 50) {
    fail('title exceeds the be_groups.title limit of 50 characters.');
}
$leafTitles = [
    'base' => deriveLeafTitle($title, 'Base'),
    'content' => deriveLeafTitle($title, 'Content'),
    'site' => deriveLeafTitle($title, 'Site'),
    'extensions' => deriveLeafTitle($title, 'Extensions'),
];
$allGroups = $connection->fetchAllAssociative(
    'SELECT uid, title, hidden, subgroup, db_mountpoints, file_mountpoints '
    . 'FROM be_groups WHERE deleted = 0 ORDER BY uid'
);
$groupsByTitle = [];
$groupsByUid = [];
foreach ($allGroups as $groupRow) {
    $groupsByTitle[(string)$groupRow['title']][] = $groupRow;
    $groupsByUid[(int)$groupRow['uid']] = $groupRow;
}
foreach ([$title, ...array_values($leafTitles)] as $managedTitle) {
    if (count($groupsByTitle[$managedTitle] ?? []) > 1) {
        fail(sprintf('More than one non-deleted backend group is titled "%s".', $managedTitle));
    }
}
$mainGroupRow = ($groupsByTitle[$title] ?? [])[0] ?? null;
$leafGroupRows = [];
foreach ($leafTitles as $key => $leafTitle) {
    $leafGroupRows[$key] = ($groupsByTitle[$leafTitle] ?? [])[0] ?? null;
}
$managedExistingLeafUids = array_values(array_filter(array_map(
    static fn(?array $row): ?int => $row === null ? null : (int)$row['uid'],
    $leafGroupRows
)));
$preservedLeafUids = [];
if ($mainGroupRow !== null) {
    foreach (csvIntegers((string)($mainGroupRow['subgroup'] ?? '')) as $subgroupUid) {
        if (in_array($subgroupUid, $managedExistingLeafUids, true)) {
            continue;
        }
        if (!isset($groupsByUid[$subgroupUid])) {
            continue;
        }
        if ((int)$groupsByUid[$subgroupUid]['hidden'] !== 0) {
            fail(sprintf('Additional subgroup %d is hidden and cannot extend the editor role.', $subgroupUid));
        }
        if (csvIntegers((string)($groupsByUid[$subgroupUid]['subgroup'] ?? '')) !== []) {
            fail(sprintf('Additional subgroup %d is nested. Capability groups must remain leaves.', $subgroupUid));
        }
        $preservedLeafUids[] = $subgroupUid;
    }
}
$preservedLeafUids = uniqueSorted($preservedLeafUids);
$description = requireString($plan, 'description');
$allowedContentTypes = requireStringList($plan, 'allowed_content_types');
$exceptions = $plan['content_type_exceptions'] ?? null;
if (!is_array($exceptions) || array_is_list($exceptions)) {
    fail('content_type_exceptions must be an object mapping CType to reason.');
}
foreach ($exceptions as $contentType => $reason) {
    if (!is_string($contentType) || trim($contentType) === '' || !is_string($reason) || trim($reason) === '') {
        fail('Every content type exception requires a non-empty CType and reason.');
    }
}
$modules = requireStringList($plan, 'modules');
$tablesModify = requireStringList($plan, 'tables_modify');
$tablesSelect = requireStringList($plan, 'tables_select');
$pageTypes = requirePositiveIntegerList($plan, 'page_types');
$dbMountpoints = requirePositiveIntegerList($plan, 'db_mountpoints');
$fileMountpoints = requirePositiveIntegerList($plan, 'file_mountpoints');
$filePermissions = requireStringList($plan, 'file_permissions');
$mfaProviders = requireStringList($plan, 'mfa_providers');
$tsconfig = requireString($plan, 'tsconfig');
$workspacesInstalled = $moduleRegistry->hasModule('workspaces_publish');
$workspacePermissions = $workspacesInstalled ? 1 : 0;
if ($workspacesInstalled && !in_array('workspaces_publish', $modules, true)) {
    $modules[] = 'workspaces_publish';
    $modules = uniqueSorted($modules);
}

$requiredMfaProviders = ['recovery-codes', 'totp'];
if ($mfaProviders !== $requiredMfaProviders) {
    fail('mfa_providers must contain exactly totp and recovery-codes.');
}
$unregisteredMfaProviders = array_values(array_filter(
    $mfaProviders,
    static fn(string $identifier): bool => !$mfaProviderRegistry->hasProvider($identifier)
));
if ($unregisteredMfaProviders !== []) {
    fail('MFA providers missing from the runtime registry: ' . implode(', ', $unregisteredMfaProviders));
}

$unregisteredModules = array_values(array_filter(
    $modules,
    static fn(string $identifier): bool => !$moduleRegistry->hasModule($identifier)
));
if ($unregisteredModules !== []) {
    fail('Backend modules missing from the runtime registry: ' . implode(', ', $unregisteredModules));
}
$requiredModules = array_values(array_filter(
    [
        'web_layout',
        'records',
        'page_preview',
        'content_status',
        'web_info_overview',
        'web_info_translations',
        'recycler',
        'media_management',
        'user_setup',
        'web_edit',
        'web_FormFormbuilder',
        'form_manager',
        'form_editor',
        'redirects',
        'searchbackend',
        'searchbackend_info',
        'workspaces_publish',
    ],
    static fn(string $identifier): bool => $moduleRegistry->hasModule($identifier)
));
$missingRequiredModules = array_values(array_diff($requiredModules, $modules));
if ($missingRequiredModules !== []) {
    fail('The plan omits installed editor modules: ' . implode(', ', $missingRequiredModules));
}
$blockedModulePatterns = [
    '/^(?:web_powermail|powermail_)/',
    '/^searchbackend_(?:coreoptimization|indexqueue|indexadministration)$/',
];
$blockedModules = array_values(array_filter(
    $modules,
    static function (string $identifier) use ($blockedModulePatterns): bool {
        foreach ($blockedModulePatterns as $pattern) {
            if (preg_match($pattern, $identifier) === 1) {
                return true;
            }
        }
        return false;
    }
));
if ($blockedModules !== []) {
    fail('The plan grants admin/reporting modules that editors must not receive: ' . implode(', ', $blockedModules));
}

$selectMissingModify = array_values(array_diff($tablesModify, $tablesSelect));
if ($selectMissingModify !== []) {
    fail('tables_select must include every tables_modify value: ' . implode(', ', $selectMissingModify));
}

$usedContentTypes = array_map(
    static fn(array $row): string => (string)$row['CType'],
    $connection->fetchAllAssociative(
        'SELECT DISTINCT CType FROM tt_content WHERE deleted = 0 ORDER BY CType'
    )
);
$registeredContentTypes = [];
foreach (($GLOBALS['TCA']['tt_content']['columns']['CType']['config']['items'] ?? []) as $item) {
    $value = $item['value'] ?? ($item[1] ?? null);
    if (is_string($value) && $value !== '') {
        $registeredContentTypes[] = $value;
    }
}
$registeredContentTypes = array_values(array_unique($registeredContentTypes));
$exceptionContentTypes = array_keys($exceptions);

$unclassifiedUsedTypes = array_values(array_diff(
    $usedContentTypes,
    $allowedContentTypes,
    $exceptionContentTypes
));
if ($unclassifiedUsedTypes !== []) {
    fail('Every used CType must be allowed or documented as an exception: ' . implode(', ', $unclassifiedUsedTypes));
}
$allowedExceptions = array_values(array_intersect($allowedContentTypes, $exceptionContentTypes));
if ($allowedExceptions !== []) {
    fail('Exception CTypes must not be allowed: ' . implode(', ', $allowedExceptions));
}
$unregisteredAllowedTypes = array_values(array_diff($allowedContentTypes, $registeredContentTypes));
if ($unregisteredAllowedTypes !== []) {
    fail('Allowed CTypes missing from runtime TCA: ' . implode(', ', $unregisteredAllowedTypes));
}
if (in_array('powermail_pi1', $allowedContentTypes, true)) {
    fail('powermail_pi1 is an infrastructure plugin and must remain unavailable to editors.');
}

foreach ($tablesSelect as $tableName) {
    if (!isset($GLOBALS['TCA'][$tableName])) {
        fail(sprintf('Table %s is not registered in runtime TCA.', $tableName));
    }
    if ((bool)($GLOBALS['TCA'][$tableName]['ctrl']['adminOnly'] ?? false)) {
        fail(sprintf('Table %s is marked ctrl.adminOnly and cannot be granted to editors.', $tableName));
    }
}

$requiredEditorTables = [];
foreach ([
    'pages',
    'tt_content',
    'sys_category',
    'sys_file',
    'sys_file_collection',
    'sys_file_metadata',
    'sys_file_reference',
    'tx_news_domain_model_news',
    'tx_news_domain_model_link',
    'tx_news_domain_model_tag',
    'form_definition',
    'sys_redirect',
    'tx_powermail_domain_model_form',
    'tx_powermail_domain_model_page',
    'tx_powermail_domain_model_field',
] as $editorTable) {
    if (isset($GLOBALS['TCA'][$editorTable])) {
        $requiredEditorTables[] = $editorTable;
    }
}
$missingWritableTables = array_values(array_diff($requiredEditorTables, $tablesModify));
if ($missingWritableTables !== []) {
    fail('The plan omits installed editor tables from tables_modify: ' . implode(', ', $missingWritableTables));
}
$missingSelectableTables = array_values(array_diff($requiredEditorTables, $tablesSelect));
if ($missingSelectableTables !== []) {
    fail('The plan omits installed editor tables from tables_select: ' . implode(', ', $missingSelectableTables));
}
$blockedPowermailTables = array_values(array_intersect(
    [
        'tx_powermail_domain_model_mail',
        'tx_powermail_domain_model_answer',
    ],
    array_values(array_unique(array_merge($tablesSelect, $tablesModify)))
));
if ($blockedPowermailTables !== []) {
    fail('Powermail submission tables must remain unavailable to editors: ' . implode(', ', $blockedPowermailTables));
}

$validPages = array_map(
    static fn(array $row): int => (int)$row['uid'],
    $connection->fetchAllAssociative('SELECT uid FROM pages WHERE deleted = 0')
);
$invalidDbMountpoints = array_values(array_diff($dbMountpoints, $validPages));
if ($invalidDbMountpoints !== []) {
    fail('Database mounts are not active pages: ' . implode(', ', $invalidDbMountpoints));
}
$configuredSiteRoots = array_map(
    static fn(object $site): int => (int)$site->getRootPageId(),
    $siteFinder->getAllSites(false)
);
$flaggedSiteRoots = array_map(
    static fn(array $row): int => (int)$row['uid'],
    $connection->fetchAllAssociative('SELECT uid FROM pages WHERE deleted = 0 AND is_siteroot = 1')
);
$requiredSiteRoots = uniqueSorted(array_merge($configuredSiteRoots, $flaggedSiteRoots));
$preservedDbMountpoints = [];
$preservedFileMountpoints = [];
foreach ($preservedLeafUids as $preservedLeafUid) {
    array_push(
        $preservedDbMountpoints,
        ...csvIntegers((string)($groupsByUid[$preservedLeafUid]['db_mountpoints'] ?? ''))
    );
    array_push(
        $preservedFileMountpoints,
        ...csvIntegers((string)($groupsByUid[$preservedLeafUid]['file_mountpoints'] ?? ''))
    );
}
$effectiveDbMountpoints = uniqueSorted([...$dbMountpoints, ...$preservedDbMountpoints]);
$effectiveFileMountpoints = uniqueSorted([...$fileMountpoints, ...$preservedFileMountpoints]);
$invalidPreservedDbMountpoints = array_values(array_diff($preservedDbMountpoints, $validPages));
if ($invalidPreservedDbMountpoints !== []) {
    fail('Preserved Site leaves reference missing pages: ' . implode(', ', $invalidPreservedDbMountpoints));
}
$missingSiteRoots = array_values(array_diff($requiredSiteRoots, $effectiveDbMountpoints));
if ($missingSiteRoots !== []) {
    fail('The plan and preserved Site leaves omit configured or flagged site roots: ' . implode(', ', $missingSiteRoots));
}

$activeFileMountRows = $connection->fetchAllAssociative(
    'SELECT uid, identifier FROM sys_filemounts WHERE deleted = 0 AND hidden = 0'
);
$activeFileMountpoints = array_map(
    static fn(array $row): int => (int)$row['uid'],
    $activeFileMountRows
);
$missingActiveFileMountpoints = array_values(array_diff($activeFileMountpoints, $effectiveFileMountpoints));
if ($missingActiveFileMountpoints !== []) {
    fail('The plan and preserved Site leaves omit active file mounts: ' . implode(', ', $missingActiveFileMountpoints));
}
$invalidFileMountpoints = array_values(array_diff($fileMountpoints, $activeFileMountpoints));
if ($invalidFileMountpoints !== []) {
    fail('The plan references missing or hidden file mounts: ' . implode(', ', $invalidFileMountpoints));
}
$invalidPreservedFileMountpoints = array_values(array_diff($preservedFileMountpoints, $activeFileMountpoints));
if ($invalidPreservedFileMountpoints !== []) {
    fail('Preserved Site leaves reference missing or hidden file mounts: ' . implode(', ', $invalidPreservedFileMountpoints));
}
$coveredStorageUids = [];
foreach ($activeFileMountRows as $fileMountRow) {
    if (!preg_match('/^(\d+):\//', (string)$fileMountRow['identifier'], $matches)) {
        fail(sprintf('File mount %d has an invalid storage identifier.', (int)$fileMountRow['uid']));
    }
    $coveredStorageUids[] = (int)$matches[1];
}
$activeStorageUids = array_map(
    static fn(array $row): int => (int)$row['uid'],
    $connection->fetchAllAssociative(
        'SELECT uid FROM sys_file_storage WHERE deleted = 0 AND is_online = 1 AND is_browsable = 1'
    )
);
$uncoveredStorageUids = array_values(array_diff($activeStorageUids, $coveredStorageUids));
if ($uncoveredStorageUids !== []) {
    fail('Online browsable file storages need active file mounts: ' . implode(', ', $uncoveredStorageUids));
}

$enabledAdministratorCount = (int)$connection->fetchOne(
    'SELECT COUNT(*) FROM be_users WHERE deleted = 0 AND disable = 0 AND admin = 1'
);
if ($enabledAdministratorCount < 1) {
    fail('At least one enabled administrator must exist before creating an editor group.');
}

$nonExcludeFields = [];
$adminOnlyFields = [];
$systemManagedFields = [];
foreach ($tablesModify as $tableName) {
    $editLockField = (string)($GLOBALS['TCA'][$tableName]['ctrl']['editlock'] ?? '');
    foreach (($GLOBALS['TCA'][$tableName]['columns'] ?? []) as $fieldName => $fieldConfiguration) {
        if (!(bool)($fieldConfiguration['exclude'] ?? false)) {
            continue;
        }
        $qualifiedField = $tableName . ':' . $fieldName;
        $fieldConfig = is_array($fieldConfiguration['config'] ?? null) ? $fieldConfiguration['config'] : [];
        if (
            $fieldName === $editLockField
            || containsAdminOnlyDisplayCondition($fieldConfiguration['displayCond'] ?? null)
            || isRestrictedEditorField($tableName, $fieldName)
        ) {
            $adminOnlyFields[] = $qualifiedField;
            continue;
        }
        if (
            (bool)($fieldConfig['readOnly'] ?? false)
            || in_array((string)($fieldConfig['type'] ?? ''), ['none', 'passthrough'], true)
        ) {
            $systemManagedFields[] = $qualifiedField;
            continue;
        }
        $nonExcludeFields[] = $qualifiedField;
    }
}
$nonExcludeFields = uniqueSorted($nonExcludeFields);
$explicitAllowDeny = array_map(
    static fn(string $contentType): string => 'tt_content:CType:' . $contentType,
    uniqueSorted($allowedContentTypes)
);

$now = time();
$coreContentTables = [
    'pages',
    'tt_content',
    'sys_category',
    'sys_file',
    'sys_file_collection',
    'sys_file_metadata',
    'sys_file_reference',
];
$contentTablesSelect = array_values(array_intersect($tablesSelect, $coreContentTables));
$contentTablesModify = array_values(array_intersect($tablesModify, $coreContentTables));
$extensionTablesSelect = array_values(array_diff($tablesSelect, $coreContentTables));
$extensionTablesModify = array_values(array_diff($tablesModify, $coreContentTables));
$contentNonExcludeFields = array_values(array_filter(
    $nonExcludeFields,
    static fn(string $field): bool => in_array(strtok($field, ':'), $coreContentTables, true)
));
$extensionNonExcludeFields = array_values(array_diff($nonExcludeFields, $contentNonExcludeFields));
$coreModuleIdentifiers = [
    'web_layout',
    'records',
    'page_preview',
    'content_status',
    'web_info_overview',
    'web_info_translations',
    'recycler',
    'media_management',
    'user_setup',
    'redirects',
];
$baseModules = array_values(array_intersect($modules, $coreModuleIdentifiers));
$extensionModules = array_values(array_diff($modules, $baseModules));

$leafFields = [
    'base' => array_replace(emptyGroupFields($leafTitles['base'], $now), [
        'description' => sprintf('Core editor baseline for %s. Assign users to the main group only.', $title),
        'groupMods' => implode(',', uniqueSorted($baseModules)),
        'pagetypes_select' => implode(',', $pageTypes),
        'file_permissions' => implode(',', uniqueSorted($filePermissions)),
        'mfa_providers' => implode(',', $mfaProviders),
        'TSconfig' => $tsconfig,
    ]),
    'content' => array_replace(emptyGroupFields($leafTitles['content'], $now), [
        'description' => sprintf('Core content types, tables, and fields for %s.', $title),
        'tables_select' => implode(',', uniqueSorted($contentTablesSelect)),
        'tables_modify' => implode(',', uniqueSorted($contentTablesModify)),
        'explicit_allowdeny' => implode(',', $explicitAllowDeny),
        'non_exclude_fields' => implode(',', uniqueSorted($contentNonExcludeFields)),
    ]),
    'site' => array_replace(emptyGroupFields($leafTitles['site'], $now), [
        'description' => sprintf('Primary Site and file mounts for %s.', $title),
        'db_mountpoints' => implode(',', $dbMountpoints),
        'file_mountpoints' => implode(',', $fileMountpoints),
    ]),
    'extensions' => array_replace(emptyGroupFields($leafTitles['extensions'], $now), [
        'description' => sprintf('Installed extension modules, tables, and fields for %s.', $title),
        'groupMods' => implode(',', uniqueSorted($extensionModules)),
        'tables_select' => implode(',', uniqueSorted($extensionTablesSelect)),
        'tables_modify' => implode(',', uniqueSorted($extensionTablesModify)),
        'non_exclude_fields' => implode(',', uniqueSorted($extensionNonExcludeFields)),
        'workspace_perms' => $workspacePermissions,
    ]),
];
$mainFields = array_replace(emptyGroupFields($title, $now), [
    'description' => $description,
]);

$dryRun = isset($options['dry-run']);
$groupUid = $mainGroupRow === null ? null : (int)$mainGroupRow['uid'];
$leafUids = array_map(
    static fn(?array $row): ?int => $row === null ? null : (int)$row['uid'],
    $leafGroupRows
);
if (!$dryRun) {
    $connection->transactional(function (Connection $connection) use (
        $leafFields,
        $leafGroupRows,
        $leafTitles,
        $mainFields,
        $mainGroupRow,
        $preservedLeafUids,
        $now,
        &$leafUids
    ): void {
        foreach ($leafFields as $key => $fields) {
            if ($leafGroupRows[$key] === null) {
                $connection->insert('be_groups', $fields + ['crdate' => $now]);
            } else {
                $connection->update('be_groups', $fields, ['uid' => (int)$leafGroupRows[$key]['uid']]);
            }
            $leafUids[$key] = (int)$connection->fetchOne(
                'SELECT uid FROM be_groups WHERE deleted = 0 AND title = ?',
                [$leafTitles[$key]]
            );
        }
        $mainFields['subgroup'] = implode(',', uniqueSorted([
            ...array_values($leafUids),
            ...$preservedLeafUids,
        ]));
        if ($mainGroupRow === null) {
            $connection->insert('be_groups', $mainFields + ['crdate' => $now]);
        } else {
            $connection->update('be_groups', $mainFields, ['uid' => (int)$mainGroupRow['uid']]);
        }
    });
    $groupUid = (int)$connection->fetchOne(
        'SELECT uid FROM be_groups WHERE deleted = 0 AND title = ?',
        [$title]
    );
}

echo json_encode([
    'status' => $dryRun ? 'valid-dry-run' : ($mainGroupRow === null ? 'created' : 'updated'),
    'main_group' => [
        'uid' => $groupUid,
        'title' => $title,
        'direct_permissions' => false,
    ],
    'group_uid' => $groupUid,
    'required_leaf_groups' => array_map(
        static fn(string $leafTitle, string $key): array => [
            'key' => $key,
            'uid' => $leafUids[$key],
            'title' => $leafTitle,
        ],
        $leafTitles,
        array_keys($leafTitles)
    ),
    'preserved_additional_leaf_uids' => $preservedLeafUids,
    'permission_split' => [
        'base' => [
            'modules' => uniqueSorted($baseModules),
            'page_types' => $pageTypes,
            'tsconfig' => $tsconfig,
        ],
        'content' => [
            'tables_select' => uniqueSorted($contentTablesSelect),
            'tables_modify' => uniqueSorted($contentTablesModify),
            'content_types' => uniqueSorted($allowedContentTypes),
        ],
        'site' => [
            'db_mountpoints' => $dbMountpoints,
            'file_mountpoints' => $fileMountpoints,
        ],
        'extensions' => [
            'modules' => uniqueSorted($extensionModules),
            'tables_select' => uniqueSorted($extensionTablesSelect),
            'tables_modify' => uniqueSorted($extensionTablesModify),
        ],
    ],
    'title' => $title,
    'allowed_content_types' => uniqueSorted($allowedContentTypes),
    'content_type_exceptions' => $exceptions,
    'tables_modify' => uniqueSorted($tablesModify),
    'tables_select' => uniqueSorted($tablesSelect),
    'required_editor_tables' => uniqueSorted($requiredEditorTables),
    'required_modules' => uniqueSorted($requiredModules),
    'mfa_providers' => $mfaProviders,
    'allowed_languages' => 'all (empty be_groups.allowed_languages)',
    'non_exclude_field_count' => count($nonExcludeFields),
    'excluded_admin_only_fields' => uniqueSorted($adminOnlyFields),
    'excluded_system_managed_fields' => uniqueSorted($systemManagedFields),
    'db_mountpoints' => $dbMountpoints,
    'effective_db_mountpoints' => $effectiveDbMountpoints,
    'required_site_roots' => $requiredSiteRoots,
    'file_mountpoints' => $fileMountpoints,
    'effective_file_mountpoints' => $effectiveFileMountpoints,
    'enabled_administrator_count' => $enabledAdministratorCount,
    'required_user_options_bits' => 3,
    'workspaces' => [
        'installed' => $workspacesInstalled,
        'module' => $workspacesInstalled ? 'workspaces_publish' : null,
        'live_access' => $workspacesInstalled,
        'custom_workspace_membership_changed' => false,
    ],
    'users_changed' => false,
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) . "\n";

function requireString(array $plan, string $key): string
{
    if (!isset($plan[$key]) || !is_string($plan[$key]) || trim($plan[$key]) === '') {
        fail(sprintf('%s must be a non-empty string.', $key));
    }
    return trim($plan[$key]);
}

function requireStringList(array $plan, string $key): array
{
    if (!isset($plan[$key]) || !is_array($plan[$key]) || !array_is_list($plan[$key])) {
        fail(sprintf('%s must be a JSON array.', $key));
    }
    foreach ($plan[$key] as $value) {
        if (!is_string($value) || trim($value) === '') {
            fail(sprintf('%s must contain only non-empty strings.', $key));
        }
    }
    return uniqueSorted(array_map('trim', $plan[$key]));
}

function requirePositiveIntegerList(array $plan, string $key): array
{
    if (!isset($plan[$key]) || !is_array($plan[$key]) || !array_is_list($plan[$key])) {
        fail(sprintf('%s must be a JSON array.', $key));
    }
    $values = [];
    foreach ($plan[$key] as $value) {
        if (!is_int($value) || $value < 1) {
            fail(sprintf('%s must contain only positive integers.', $key));
        }
        $values[] = $value;
    }
    $values = array_values(array_unique($values));
    sort($values);
    return $values;
}

function uniqueSorted(array $values): array
{
    $values = array_values(array_unique($values));
    sort($values);
    return $values;
}

function csvIntegers(string $value): array
{
    $values = array_map('intval', array_filter(array_map('trim', explode(',', $value)), 'strlen'));
    return uniqueSorted(array_values(array_filter($values, static fn(int $item): bool => $item > 0)));
}

function deriveLeafTitle(string $mainTitle, string $leafName): string
{
    $suffix = ' · ' . $leafName;
    $prefixLength = 50 - mb_strlen($suffix);
    if ($prefixLength < 1) {
        fail(sprintf('Leaf name "%s" leaves no room for the main group title.', $leafName));
    }
    return mb_substr($mainTitle, 0, $prefixLength) . $suffix;
}

function emptyGroupFields(string $title, int $timestamp): array
{
    return [
        'pid' => 0,
        'tstamp' => $timestamp,
        'title' => $title,
        'description' => '',
        'hidden' => 0,
        'subgroup' => '',
        'groupMods' => '',
        'tables_select' => '',
        'tables_modify' => '',
        'pagetypes_select' => '',
        'db_mountpoints' => '',
        'file_mountpoints' => '',
        'file_permissions' => '',
        'explicit_allowdeny' => '',
        'non_exclude_fields' => '',
        'allowed_languages' => '',
        'mfa_providers' => '',
        'category_perms' => '',
        'workspace_perms' => 0,
        'TSconfig' => '',
        'tsconfig_includes' => '',
    ];
}

function containsAdminOnlyDisplayCondition(mixed $condition): bool
{
    if (is_string($condition)) {
        return str_contains($condition, 'HIDE_FOR_NON_ADMINS');
    }
    if (!is_array($condition)) {
        return false;
    }
    foreach ($condition as $nestedCondition) {
        if (containsAdminOnlyDisplayCondition($nestedCondition)) {
            return true;
        }
    }
    return false;
}

function isRestrictedEditorField(string $tableName, string $fieldName): bool
{
    if ($tableName !== 'pages') {
        return false;
    }
    return in_array($fieldName, [
        'TSconfig',
        'tsconfig_includes',
        'is_siteroot',
        'module',
        'perms_userid',
        'perms_groupid',
        'perms_user',
        'perms_group',
        'perms_everybody',
    ], true);
}

function fail(string $message): never
{
    fwrite(STDERR, $message . "\n");
    exit(65);
}
