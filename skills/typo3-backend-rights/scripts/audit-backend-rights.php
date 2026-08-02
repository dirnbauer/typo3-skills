#!/usr/bin/env php
<?php

declare(strict_types=1);

use TYPO3\CMS\Core\Core\Bootstrap;
use TYPO3\CMS\Backend\Module\ModuleRegistry;
use TYPO3\CMS\Core\Core\SystemEnvironmentBuilder;
use TYPO3\CMS\Core\Database\ConnectionPool;
use TYPO3\CMS\Core\Utility\GeneralUtility;

$options = getopt('', [
    'exceptions-json::',
    'exceptions-plan::',
    'group-title::',
    'pretty',
    'strict',
]);

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

$exceptions = [];
if (isset($options['exceptions-json'], $options['exceptions-plan'])) {
    fwrite(STDERR, "Use either --exceptions-json or --exceptions-plan, not both.\n");
    exit(64);
}
if (isset($options['exceptions-plan']) && $options['exceptions-plan'] !== false) {
    $exceptionPlanPath = (string)$options['exceptions-plan'];
    if (!is_file($exceptionPlanPath)) {
        fwrite(STDERR, sprintf("Exception plan not found: %s\n", $exceptionPlanPath));
        exit(66);
    }
    try {
        $exceptionPlan = json_decode((string)file_get_contents($exceptionPlanPath), true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException $exception) {
        fwrite(STDERR, 'Invalid exception plan JSON: ' . $exception->getMessage() . "\n");
        exit(65);
    }
    $exceptions = $exceptionPlan['content_type_exceptions'] ?? null;
    if (!is_array($exceptions) || array_is_list($exceptions)) {
        fwrite(STDERR, "The plan needs a content_type_exceptions object.\n");
        exit(64);
    }
}
if (isset($options['exceptions-json']) && $options['exceptions-json'] !== false) {
    try {
        $exceptions = json_decode((string)$options['exceptions-json'], true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException $exception) {
        fwrite(STDERR, 'Invalid --exceptions-json: ' . $exception->getMessage() . "\n");
        exit(64);
    }
    if (!is_array($exceptions) || array_is_list($exceptions)) {
        fwrite(STDERR, "--exceptions-json must be a JSON object mapping CType to reason.\n");
        exit(64);
    }
}
foreach ($exceptions as $contentType => $reason) {
    if (!is_string($contentType) || $contentType === '' || !is_string($reason) || trim($reason) === '') {
        fwrite(STDERR, "Every CType exception needs a non-empty string reason.\n");
        exit(64);
    }
}

$usedContentTypeRows = $connection->fetchAllAssociative(
    'SELECT CType, COUNT(*) AS records, SUM(CASE WHEN hidden = 0 THEN 1 ELSE 0 END) AS visible_records '
    . 'FROM tt_content WHERE deleted = 0 GROUP BY CType ORDER BY CType'
);
$usedContentTypes = array_values(array_map(
    static fn(array $row): string => (string)$row['CType'],
    $usedContentTypeRows
));

$registeredContentTypes = [];
foreach (($GLOBALS['TCA']['tt_content']['columns']['CType']['config']['items'] ?? []) as $item) {
    $value = $item['value'] ?? ($item[1] ?? null);
    if (is_string($value) && $value !== '') {
        $registeredContentTypes[] = $value;
    }
}
$registeredContentTypes = array_values(array_unique($registeredContentTypes));
sort($registeredContentTypes);

$authMode = $GLOBALS['TCA']['tt_content']['columns']['CType']['config']['authMode'] ?? null;
$groups = $connection->fetchAllAssociative(
    'SELECT uid, title, hidden, subgroup, groupMods, tables_select, tables_modify, pagetypes_select, '
    . 'db_mountpoints, file_mountpoints, file_permissions, explicit_allowdeny, non_exclude_fields, TSconfig '
    . 'FROM be_groups WHERE deleted = 0 ORDER BY uid'
);
$users = $connection->fetchAllAssociative(
    'SELECT uid, username, admin, disable, usergroup, lastlogin FROM be_users WHERE deleted = 0 ORDER BY uid'
);
$fileMounts = $connection->fetchAllAssociative(
    'SELECT uid, title, hidden, read_only, identifier FROM sys_filemounts WHERE deleted = 0 ORDER BY uid'
);
$fileStorages = $connection->fetchAllAssociative(
    'SELECT uid, name, is_browsable, is_writable, is_online FROM sys_file_storage WHERE deleted = 0 ORDER BY uid'
);
$rootPages = $connection->fetchAllAssociative(
    'SELECT uid, title, doktype, hidden FROM pages WHERE deleted = 0 AND pid = 0 ORDER BY uid'
);
$pageTypes = $connection->fetchAllAssociative(
    'SELECT doktype, COUNT(*) AS records FROM pages WHERE deleted = 0 GROUP BY doktype ORDER BY doktype'
);

$excludeFields = [];
foreach ($GLOBALS['TCA'] ?? [] as $tableName => $tableConfiguration) {
    foreach (($tableConfiguration['columns'] ?? []) as $fieldName => $fieldConfiguration) {
        if ((bool)($fieldConfiguration['exclude'] ?? false)) {
            $excludeFields[$tableName][] = $fieldName;
        }
    }
    if (isset($excludeFields[$tableName])) {
        sort($excludeFields[$tableName]);
    }
}
ksort($excludeFields);

$activeFileMountUids = array_map(
    static fn(array $row): int => (int)$row['uid'],
    array_filter($fileMounts, static fn(array $row): bool => (int)$row['hidden'] === 0)
);
$rootPageUids = array_map(static fn(array $row): int => (int)$row['uid'], $rootPages);
$exceptionContentTypes = array_keys($exceptions);
$usedPageTypeValues = array_map(static fn(array $row): int => (int)$row['doktype'], $pageTypes);

$findings = [];
$normalizedGroups = [];
foreach ($groups as $group) {
    $allowedContentTypes = [];
    foreach (explode(',', (string)($group['explicit_allowdeny'] ?? '')) as $permission) {
        $permission = trim($permission);
        if (str_starts_with($permission, 'tt_content:CType:')) {
            $allowedContentTypes[] = substr($permission, strlen('tt_content:CType:'));
        }
    }
    $allowedContentTypes = array_values(array_unique(array_filter($allowedContentTypes, 'strlen')));
    sort($allowedContentTypes);

    $isTarget = !isset($options['group-title']) || $options['group-title'] === false
        || (string)$group['title'] === (string)$options['group-title'];
    $missingEditorialTypes = array_values(array_diff(
        $usedContentTypes,
        $exceptionContentTypes,
        $allowedContentTypes
    ));
    $allowedExceptions = array_values(array_intersect($allowedContentTypes, $exceptionContentTypes));
    $unregisteredAllowedTypes = array_values(array_diff($allowedContentTypes, $registeredContentTypes));
    $groupFileMountUids = csvIntegers((string)($group['file_mountpoints'] ?? ''));
    $groupDbMountUids = csvIntegers((string)($group['db_mountpoints'] ?? ''));
    $groupModules = csvStrings((string)($group['groupMods'] ?? ''));
    $groupTablesSelect = csvStrings((string)($group['tables_select'] ?? ''));
    $groupTablesModify = csvStrings((string)($group['tables_modify'] ?? ''));
    $groupNonExcludeFields = csvStrings((string)($group['non_exclude_fields'] ?? ''));
    $groupPageTypes = csvIntegers((string)($group['pagetypes_select'] ?? ''));
    $groupSubgroups = csvIntegers((string)($group['subgroup'] ?? ''));

    $groupFindings = [];
    if ($isTarget && $authMode === 'explicitAllow' && $allowedContentTypes === []) {
        $groupFindings[] = finding(
            'error',
            'empty-explicit-ctype-allow-list',
            'tt_content.CType uses explicitAllow but this group has no tt_content:CType:* permission.'
        );
    }
    if ($isTarget && $missingEditorialTypes !== []) {
        $groupFindings[] = finding(
            'error',
            'used-editorial-ctypes-not-allowed',
            'Used editorial CTypes are missing from explicit_allowdeny.',
            $missingEditorialTypes
        );
    }
    if ($isTarget && $allowedExceptions !== []) {
        $groupFindings[] = finding(
            'error',
            'infrastructure-ctypes-allowed',
            'Documented infrastructure exceptions are explicitly allowed.',
            $allowedExceptions
        );
    }
    if ($isTarget && $unregisteredAllowedTypes !== []) {
        $groupFindings[] = finding(
            'warning',
            'unregistered-ctypes-allowed',
            'The group allows CTypes that runtime TCA does not register.',
            $unregisteredAllowedTypes
        );
    }
    if ($isTarget && $groupSubgroups !== []) {
        $groupFindings[] = finding(
            'error',
            'subgroups-configured',
            'The main editor group must not inherit subgroups.',
            $groupSubgroups
        );
    }
    $unregisteredModules = array_values(array_filter(
        $groupModules,
        static fn(string $identifier): bool => !$moduleRegistry->hasModule($identifier)
    ));
    if ($isTarget && $unregisteredModules !== []) {
        $groupFindings[] = finding(
            'error',
            'unregistered-backend-modules',
            'The group contains backend module identifiers absent from the runtime registry.',
            $unregisteredModules
        );
    }
    $modifyTablesWithoutSelect = array_values(array_diff($groupTablesModify, $groupTablesSelect));
    if ($isTarget && $modifyTablesWithoutSelect !== []) {
        $groupFindings[] = finding(
            'error',
            'modify-tables-not-selectable',
            'tables_select must include every tables_modify value.',
            $modifyTablesWithoutSelect
        );
    }
    $unregisteredTables = array_values(array_filter(
        array_unique([...$groupTablesSelect, ...$groupTablesModify]),
        static fn(string $tableName): bool => !isset($GLOBALS['TCA'][$tableName])
    ));
    if ($isTarget && $unregisteredTables !== []) {
        $groupFindings[] = finding(
            'error',
            'unregistered-tables',
            'The group contains tables absent from runtime TCA.',
            $unregisteredTables
        );
    }
    $requiredNonExcludeFields = [];
    foreach ($groupTablesModify as $tableName) {
        foreach ($excludeFields[$tableName] ?? [] as $fieldName) {
            $requiredNonExcludeFields[] = $tableName . ':' . $fieldName;
        }
    }
    $missingNonExcludeFields = array_values(array_diff(
        array_unique($requiredNonExcludeFields),
        $groupNonExcludeFields
    ));
    sort($missingNonExcludeFields);
    if ($isTarget && $missingNonExcludeFields !== []) {
        $groupFindings[] = finding(
            'error',
            'runtime-exclude-fields-missing',
            'Runtime TCA exclude fields are missing for editable tables.',
            $missingNonExcludeFields
        );
    }
    $missingUsedPageTypes = array_values(array_diff($usedPageTypeValues, $groupPageTypes));
    if ($isTarget && $missingUsedPageTypes !== []) {
        $groupFindings[] = finding(
            'error',
            'used-page-types-missing',
            'Page types already used in the project are missing from the group.',
            $missingUsedPageTypes
        );
    }
    $missingFileMountUids = array_values(array_diff($activeFileMountUids, $groupFileMountUids));
    if ($isTarget && $missingFileMountUids !== []) {
        $groupFindings[] = finding(
            'error',
            'active-file-mounts-missing',
            'Active sys_filemounts records are missing from the group.',
            $missingFileMountUids
        );
    }
    $missingDbMountUids = array_values(array_diff($rootPageUids, $groupDbMountUids));
    if ($isTarget && $missingDbMountUids !== []) {
        $groupFindings[] = finding(
            'error',
            'root-page-mounts-missing',
            'Root pages are missing from the group database mounts.',
            $missingDbMountUids
        );
    }

    array_push($findings, ...$groupFindings);
    $normalizedGroups[] = [
        'uid' => (int)$group['uid'],
        'title' => (string)$group['title'],
        'hidden' => (bool)$group['hidden'],
        'subgroup' => $groupSubgroups,
        'allowed_content_types' => $allowedContentTypes,
        'missing_editorial_content_types' => $missingEditorialTypes,
        'allowed_exception_content_types' => $allowedExceptions,
        'unregistered_allowed_content_types' => $unregisteredAllowedTypes,
        'db_mountpoints' => $groupDbMountUids,
        'missing_root_page_mountpoints' => $missingDbMountUids,
        'file_mountpoints' => $groupFileMountUids,
        'missing_active_file_mountpoints' => $missingFileMountUids,
        'tables_select' => $groupTablesSelect,
        'tables_modify' => $groupTablesModify,
        'modify_tables_without_select' => $modifyTablesWithoutSelect,
        'modules' => $groupModules,
        'unregistered_modules' => $unregisteredModules,
        'page_types' => $groupPageTypes,
        'missing_used_page_types' => $missingUsedPageTypes,
        'file_permissions' => csvStrings((string)($group['file_permissions'] ?? '')),
        'non_exclude_fields' => $groupNonExcludeFields,
        'missing_runtime_non_exclude_fields' => $missingNonExcludeFields,
        'tsconfig' => (string)($group['TSconfig'] ?? ''),
        'findings' => $groupFindings,
    ];
}

if (isset($options['group-title']) && $options['group-title'] !== false) {
    $targetExists = array_filter(
        $groups,
        static fn(array $group): bool => (string)$group['title'] === (string)$options['group-title']
    ) !== [];
    if (!$targetExists) {
        $missingTarget = finding(
            'error',
            'target-group-not-found',
            sprintf('No backend group titled "%s" exists.', (string)$options['group-title'])
        );
        $findings[] = $missingTarget;
    }
}

$storageByUid = [];
foreach ($fileStorages as $storage) {
    $storageByUid[(int)$storage['uid']] = $storage;
}
foreach ($fileMounts as $fileMount) {
    if ((int)$fileMount['hidden'] !== 0) {
        continue;
    }
    $identifier = (string)($fileMount['identifier'] ?? '');
    if (!preg_match('/^(\d+):\//', $identifier, $matches)) {
        $findings[] = finding(
            'error',
            'invalid-file-mount-identifier',
            sprintf('File mount %d has an invalid identifier.', (int)$fileMount['uid']),
            [$identifier]
        );
        continue;
    }
    $storageUid = (int)$matches[1];
    if (!isset($storageByUid[$storageUid])) {
        $findings[] = finding(
            'error',
            'file-mount-storage-missing',
            sprintf('File mount %d references missing storage %d.', (int)$fileMount['uid'], $storageUid)
        );
        continue;
    }
    $storage = $storageByUid[$storageUid];
    if ((int)$storage['is_online'] !== 1 || (int)$storage['is_browsable'] !== 1) {
        $findings[] = finding(
            'error',
            'file-mount-storage-unavailable',
            sprintf('Storage %d for file mount %d is offline or not browsable.', $storageUid, (int)$fileMount['uid'])
        );
    }
    if ((int)$fileMount['read_only'] === 0 && (int)$storage['is_writable'] !== 1) {
        $findings[] = finding(
            'error',
            'writable-file-mount-on-read-only-storage',
            sprintf('Writable file mount %d uses non-writable storage %d.', (int)$fileMount['uid'], $storageUid)
        );
    }
}

$enabledAdmins = array_values(array_map(
    static fn(array $user): array => [
        'uid' => (int)$user['uid'],
        'username' => (string)$user['username'],
        'lastlogin' => (int)$user['lastlogin'],
    ],
    array_filter(
        $users,
        static fn(array $user): bool => (int)$user['admin'] === 1 && (int)$user['disable'] === 0
    )
));
if ($enabledAdmins === []) {
    $findings[] = finding('error', 'no-enabled-administrator', 'No enabled backend administrator remains.');
}

$report = [
    'project_root' => $projectRoot,
    'ctype_auth_mode' => $authMode,
    'used_content_types' => $usedContentTypeRows,
    'registered_content_types' => $registeredContentTypes,
    'documented_exceptions' => $exceptions,
    'groups' => $normalizedGroups,
    'users' => array_map(
        static fn(array $user): array => [
            'uid' => (int)$user['uid'],
            'username' => (string)$user['username'],
            'admin' => (bool)$user['admin'],
            'disabled' => (bool)$user['disable'],
            'groups' => csvIntegers((string)($user['usergroup'] ?? '')),
            'lastlogin' => (int)$user['lastlogin'],
        ],
        $users
    ),
    'enabled_administrators' => $enabledAdmins,
    'root_pages' => $rootPages,
    'used_page_types' => $pageTypes,
    'file_mounts' => $fileMounts,
    'file_storages' => $fileStorages,
    'runtime_exclude_fields' => $excludeFields,
    'findings' => $findings,
];

$flags = JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE;
if (isset($options['pretty'])) {
    $flags |= JSON_PRETTY_PRINT;
}
echo json_encode($report, $flags | JSON_THROW_ON_ERROR) . "\n";

if (isset($options['strict'])) {
    foreach ($findings as $finding) {
        if ($finding['severity'] === 'error') {
            exit(2);
        }
    }
}

function csvStrings(string $value): array
{
    $values = array_values(array_unique(array_filter(array_map('trim', explode(',', $value)), 'strlen')));
    sort($values);
    return $values;
}

function csvIntegers(string $value): array
{
    $values = array_map('intval', csvStrings($value));
    $values = array_values(array_unique(array_filter($values, static fn(int $value): bool => $value > 0)));
    sort($values);
    return $values;
}

function finding(string $severity, string $code, string $message, array $values = []): array
{
    return [
        'severity' => $severity,
        'code' => $code,
        'message' => $message,
        'values' => $values,
    ];
}
