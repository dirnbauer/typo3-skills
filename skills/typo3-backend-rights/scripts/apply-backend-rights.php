#!/usr/bin/env php
<?php

declare(strict_types=1);

use Doctrine\DBAL\Connection;
use TYPO3\CMS\Core\Core\Bootstrap;
use TYPO3\CMS\Core\Core\SystemEnvironmentBuilder;
use TYPO3\CMS\Core\Database\ConnectionPool;

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

$title = requireString($plan, 'title');
if (mb_strlen($title) > 50) {
    fail('title exceeds the be_groups.title limit of 50 characters.');
}
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
$tsconfig = requireString($plan, 'tsconfig');
$workspacePermissions = isset($plan['workspace_perms']) ? (int)$plan['workspace_perms'] : 1;

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

foreach ($tablesSelect as $tableName) {
    if (!isset($GLOBALS['TCA'][$tableName])) {
        fail(sprintf('Table %s is not registered in runtime TCA.', $tableName));
    }
}

$validRootPages = array_map(
    static fn(array $row): int => (int)$row['uid'],
    $connection->fetchAllAssociative('SELECT uid FROM pages WHERE deleted = 0 AND pid = 0')
);
$invalidDbMountpoints = array_values(array_diff($dbMountpoints, $validRootPages));
if ($invalidDbMountpoints !== []) {
    fail('Database mounts are not active root pages: ' . implode(', ', $invalidDbMountpoints));
}

$activeFileMountpoints = array_map(
    static fn(array $row): int => (int)$row['uid'],
    $connection->fetchAllAssociative('SELECT uid FROM sys_filemounts WHERE deleted = 0 AND hidden = 0')
);
$missingActiveFileMountpoints = array_values(array_diff($activeFileMountpoints, $fileMountpoints));
if ($missingActiveFileMountpoints !== []) {
    fail('The plan omits active file mounts: ' . implode(', ', $missingActiveFileMountpoints));
}
$invalidFileMountpoints = array_values(array_diff($fileMountpoints, $activeFileMountpoints));
if ($invalidFileMountpoints !== []) {
    fail('The plan references missing or hidden file mounts: ' . implode(', ', $invalidFileMountpoints));
}

$enabledAdministratorCount = (int)$connection->fetchOne(
    'SELECT COUNT(*) FROM be_users WHERE deleted = 0 AND disable = 0 AND admin = 1'
);
if ($enabledAdministratorCount < 1) {
    fail('At least one enabled administrator must exist before creating an editor group.');
}

$nonExcludeFields = [];
foreach ($tablesModify as $tableName) {
    foreach (($GLOBALS['TCA'][$tableName]['columns'] ?? []) as $fieldName => $fieldConfiguration) {
        if ((bool)($fieldConfiguration['exclude'] ?? false)) {
            $nonExcludeFields[] = $tableName . ':' . $fieldName;
        }
    }
}
$nonExcludeFields = uniqueSorted($nonExcludeFields);
$explicitAllowDeny = array_map(
    static fn(string $contentType): string => 'tt_content:CType:' . $contentType,
    uniqueSorted($allowedContentTypes)
);

$groupRows = $connection->fetchAllAssociative(
    'SELECT uid FROM be_groups WHERE deleted = 0 AND title = ?',
    [$title]
);
if (count($groupRows) > 1) {
    fail(sprintf('More than one non-deleted backend group is titled "%s".', $title));
}

$now = time();
$fields = [
    'pid' => 0,
    'tstamp' => $now,
    'title' => $title,
    'description' => $description,
    'hidden' => 0,
    'subgroup' => '',
    'groupMods' => implode(',', uniqueSorted($modules)),
    'tables_select' => implode(',', uniqueSorted($tablesSelect)),
    'tables_modify' => implode(',', uniqueSorted($tablesModify)),
    'pagetypes_select' => implode(',', $pageTypes),
    'db_mountpoints' => implode(',', $dbMountpoints),
    'file_mountpoints' => implode(',', $fileMountpoints),
    'file_permissions' => implode(',', uniqueSorted($filePermissions)),
    'explicit_allowdeny' => implode(',', $explicitAllowDeny),
    'non_exclude_fields' => implode(',', $nonExcludeFields),
    'allowed_languages' => '',
    'category_perms' => '',
    'workspace_perms' => $workspacePermissions,
    'TSconfig' => $tsconfig,
    'tsconfig_includes' => '',
];

$dryRun = isset($options['dry-run']);
$groupUid = $groupRows === [] ? null : (int)$groupRows[0]['uid'];
if (!$dryRun) {
    $connection->transactional(function (Connection $connection) use ($fields, $groupRows, $now): void {
        if ($groupRows === []) {
            $connection->insert('be_groups', $fields + ['crdate' => $now]);
            return;
        }
        $connection->update('be_groups', $fields, ['uid' => (int)$groupRows[0]['uid']]);
    });
    $groupUid = (int)$connection->fetchOne(
        'SELECT uid FROM be_groups WHERE deleted = 0 AND title = ?',
        [$title]
    );
}

echo json_encode([
    'status' => $dryRun ? 'valid-dry-run' : ($groupRows === [] ? 'created' : 'updated'),
    'group_uid' => $groupUid,
    'title' => $title,
    'allowed_content_types' => uniqueSorted($allowedContentTypes),
    'content_type_exceptions' => $exceptions,
    'tables_modify' => uniqueSorted($tablesModify),
    'tables_select' => uniqueSorted($tablesSelect),
    'non_exclude_field_count' => count($nonExcludeFields),
    'db_mountpoints' => $dbMountpoints,
    'file_mountpoints' => $fileMountpoints,
    'enabled_administrator_count' => $enabledAdministratorCount,
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

function fail(string $message): never
{
    fwrite(STDERR, $message . "\n");
    exit(65);
}
