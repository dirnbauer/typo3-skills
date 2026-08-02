#!/usr/bin/env php
<?php

declare(strict_types=1);

use Doctrine\DBAL\Connection;
use TYPO3\CMS\Core\Cache\Backend\Typo3DatabaseBackend;
use TYPO3\CMS\Core\Core\Bootstrap;
use TYPO3\CMS\Core\Core\Environment;
use TYPO3\CMS\Core\Core\SystemEnvironmentBuilder;
use TYPO3\CMS\Core\Database\ConnectionPool;
use TYPO3\CMS\Core\Information\Typo3Version;
use TYPO3\CMS\Core\Site\SiteFinder;
use TYPO3\CMS\Scheduler\Service\TaskService;
use TYPO3\CMS\Scheduler\Task\CachingFrameworkGarbageCollectionTask;
use TYPO3\CMS\Scheduler\Task\FileStorageExtractionTask;
use TYPO3\CMS\Scheduler\Task\FileStorageIndexingTask;
use TYPO3\CMS\Scheduler\Task\IpAnonymizationTask;
use TYPO3\CMS\Scheduler\Task\OptimizeDatabaseTableTask;
use TYPO3\CMS\Scheduler\Task\RecyclerGarbageCollectionTask;
use TYPO3\CMS\Scheduler\Task\TableGarbageCollectionTask;

$options = getopt('', ['pretty', 'strict']);
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

$typo3Version = (new Typo3Version())->getVersion();
$supported = version_compare($typo3Version, '14.3.0', '>=')
    && version_compare($typo3Version, '15.0.0', '<');
if (!$supported) {
    emit([
        'schema_version' => 1,
        'supported' => false,
        'typo3_version' => $typo3Version,
        'project_root' => $projectRoot,
        'findings' => [[
            'severity' => 'error',
            'code' => 'unsupported-typo3-version',
            'message' => 'This audit supports TYPO3 14.3.x only.',
        ]],
    ], isset($options['pretty']));
    exit(78);
}

/** @var ConnectionPool $connectionPool */
$connectionPool = $container->get(ConnectionPool::class);
$connection = $connectionPool->getConnectionForTable('tx_scheduler_task');
$schemaManager = $connection->createSchemaManager();
$tableNames = array_map('strtolower', $schemaManager->listTableNames());
$findings = [];

if (!in_array('tx_scheduler_task', $tableNames, true)) {
    addFinding($findings, 'error', 'scheduler-table-missing', 'The Scheduler task table is missing.');
    emit(baseReport($projectRoot, $typo3Version, $connection, $findings), isset($options['pretty']));
    exit(1);
}

/** @var TaskService $taskService */
$taskService = $container->get(TaskService::class);
$availableTaskTypes = $taskService->getAllTaskTypes();
$availableTaskList = [];
foreach ($availableTaskTypes as $taskType => $taskInformation) {
    $availableTaskList[] = [
        'task_type' => (string)$taskType,
        'class_name' => (string)($taskInformation['className'] ?? ''),
        'category' => (string)($taskInformation['category'] ?? ''),
        'title' => (string)($taskInformation['title'] ?? ''),
        'native' => (bool)($taskInformation['isNativeTask'] ?? false),
        'additional_fields' => array_values($taskInformation['additionalFields'] ?? []),
    ];
}
usort($availableTaskList, static fn(array $a, array $b): int => $a['task_type'] <=> $b['task_type']);

$taskColumns = columnNames($schemaManager->listTableColumns('tx_scheduler_task'));
$requiredV14Columns = ['tasktype', 'parameters', 'execution_details', 'priority'];
$missingV14Columns = array_values(array_diff($requiredV14Columns, $taskColumns));
if ($missingV14Columns !== []) {
    addFinding(
        $findings,
        'error',
        'v14-storage-columns-missing',
        'The TYPO3 v14 Scheduler storage schema is incomplete.',
        ['missing_columns' => $missingV14Columns]
    );
}

$safeNativeFields = [
    'cache_backends',
    'file_storage',
    'max_file_count',
    'all_tables',
    'number_of_days',
    'ip_mask',
    'selected_tables',
];
$taskSelect = array_values(array_intersect([
    'uid',
    'disable',
    'tasktype',
    'parameters',
    'execution_details',
    'priority',
    'nextexecution',
    'lastexecution_time',
    'lastexecution_failure',
    'lastexecution_context',
    'task_group',
    'deleted',
    ...$safeNativeFields,
], $taskColumns));
$taskRows = $connection->fetchAllAssociative(
    'SELECT ' . implode(', ', array_map($connection->quoteIdentifier(...), $taskSelect))
    . ' FROM tx_scheduler_task'
    . (in_array('deleted', $taskColumns, true) ? ' WHERE deleted = 0' : '')
    . ' ORDER BY uid'
);

$tasks = [];
$existingCounts = [];
$solrWorkerRoots = [];
$now = time();
foreach ($taskRows as $row) {
    $taskType = (string)($row['tasktype'] ?? '');
    $parameters = decodeJsonObject($row['parameters'] ?? null);
    $executionDetails = decodeJsonObject($row['execution_details'] ?? null);
    $safeParameters = selectKeys($parameters, [
        'rootPageId',
        'documentsToIndexLimit',
        'limit',
        ...$safeNativeFields,
    ]);
    foreach (safeNativeFieldsForTask($taskType) as $field) {
        if (array_key_exists($field, $row) && $row[$field] !== null && $row[$field] !== '') {
            $safeParameters[$field] = $row[$field];
        }
    }
    $redactedParameterKeys = array_values(array_diff(array_keys($parameters), array_keys($safeParameters)));
    sort($redactedParameterKeys);

    $disabled = (bool)($row['disable'] ?? false);
    $nextExecution = (int)($row['nextexecution'] ?? 0);
    $hasFailure = !empty($row['lastexecution_failure']);
    $registered = $taskType !== '' && isset($availableTaskTypes[$taskType]);
    $groupUid = (int)($row['task_group'] ?? 0);

    if ($taskType === '') {
        addFinding($findings, 'error', 'empty-tasktype', 'A task has no v14 task type.', ['uid' => (int)$row['uid']]);
    } elseif (!$registered) {
        addFinding($findings, 'error', 'unregistered-tasktype', 'An existing task type is not registered by the runtime.', [
            'uid' => (int)$row['uid'],
            'task_type' => $taskType,
        ]);
    }
    if (!$disabled && $hasFailure) {
        addFinding($findings, 'error', 'task-failure', 'An enabled task records a last-execution failure.', [
            'uid' => (int)$row['uid'],
            'task_type' => $taskType,
        ]);
    }
    if (!$disabled && $nextExecution > 0 && $nextExecution < $now) {
        addFinding($findings, 'warning', 'task-late', 'An enabled task is overdue.', [
            'uid' => (int)$row['uid'],
            'task_type' => $taskType,
            'overdue_seconds' => $now - $nextExecution,
        ]);
    }
    if (!$disabled && $groupUid === 0) {
        addFinding($findings, 'warning', 'task-ungrouped', 'An enabled task has no task group.', [
            'uid' => (int)$row['uid'],
            'task_type' => $taskType,
        ]);
    }

    $existingCounts[$taskType] = ($existingCounts[$taskType] ?? 0) + 1;
    if ($taskType === 'ApacheSolrForTypo3\\Solr\\Task\\IndexQueueWorkerTask' && isset($safeParameters['rootPageId'])) {
        $solrWorkerRoots[] = (int)$safeParameters['rootPageId'];
    }
    $tasks[] = [
        'uid' => (int)$row['uid'],
        'task_type' => $taskType,
        'registered' => $registered,
        'disabled' => $disabled,
        'group_uid' => $groupUid,
        'priority' => (int)($row['priority'] ?? 100),
        'schedule' => safeExecutionDetails($executionDetails),
        'next_execution' => timestampReport($nextExecution),
        'last_execution' => timestampReport((int)($row['lastexecution_time'] ?? 0)),
        'last_execution_context' => (string)($row['lastexecution_context'] ?? ''),
        'has_last_execution_failure' => $hasFailure,
        'safe_parameters' => $safeParameters,
        'redacted_parameter_keys' => $redactedParameterKeys,
    ];
}

$groups = [];
if (in_array('tx_scheduler_task_group', $tableNames, true)) {
    $groupColumnMap = columnMap($schemaManager->listTableColumns('tx_scheduler_task_group'));
    $groupColumns = array_keys($groupColumnMap);
    $groupSelect = array_values(array_intersect(
        ['uid', 'description', 'color', 'sorting', 'hidden', 'deleted'],
        $groupColumns
    ));
    $groupNameColumn = $groupColumnMap['groupname'] ?? null;
    $groupSelectSql = array_map(
        static fn(string $column): string => $connection->quoteIdentifier($groupColumnMap[$column]),
        $groupSelect
    );
    if ($groupNameColumn !== null) {
        $groupSelectSql[] = $connection->quoteIdentifier($groupNameColumn) . ' AS group_name';
    }
    $groupRows = $connection->fetchAllAssociative(
        'SELECT ' . implode(', ', $groupSelectSql)
        . ' FROM tx_scheduler_task_group'
        . (in_array('deleted', $groupColumns, true) ? ' WHERE deleted = 0' : '')
        . ' ORDER BY sorting, uid'
    );
    foreach ($groupRows as $groupRow) {
        $groups[] = [
            'uid' => (int)$groupRow['uid'],
            'name' => (string)($groupRow['group_name'] ?? ''),
            'color' => (string)($groupRow['color'] ?? ''),
            'sorting' => (int)($groupRow['sorting'] ?? 0),
            'disabled' => (bool)($groupRow['hidden'] ?? false),
        ];
    }
}

/** @var SiteFinder $siteFinder */
$siteFinder = $container->get(SiteFinder::class);
$sites = [];
foreach ($siteFinder->getAllSites(false) as $site) {
    $sites[] = [
        'identifier' => $site->getIdentifier(),
        'root_page_id' => $site->getRootPageId(),
        'language_ids' => array_map(
            static fn(object $language): int => $language->getLanguageId(),
            $site->getAllLanguages()
        ),
    ];
}

$flaggedRoots = [];
if (in_array('pages', $tableNames, true)) {
    $flaggedRoots = array_map(
        static fn(array $row): array => ['uid' => (int)$row['uid'], 'title' => (string)$row['title']],
        $connection->fetchAllAssociative(
            'SELECT uid, title FROM pages WHERE deleted = 0 AND is_siteroot = 1 ORDER BY uid'
        )
    );
}
$siteRootIds = array_column($sites, 'root_page_id');
$flaggedRootIds = array_column($flaggedRoots, 'uid');
$siteRootsWithoutFlag = array_values(array_diff($siteRootIds, $flaggedRootIds));
if ($siteRootsWithoutFlag !== []) {
    addFinding($findings, 'warning', 'site-root-flag-missing', 'Configured Sites lack pages.is_siteroot.', [
        'root_page_ids' => $siteRootsWithoutFlag,
    ]);
}

$storages = [];
if (in_array('sys_file_storage', $tableNames, true)) {
    $storageColumns = columnNames($schemaManager->listTableColumns('sys_file_storage'));
    $storageSelect = array_values(array_intersect(
        ['uid', 'name', 'driver', 'is_online', 'is_browsable', 'is_writable', 'is_public', 'deleted'],
        $storageColumns
    ));
    $storageRows = $connection->fetchAllAssociative(
        'SELECT ' . implode(', ', array_map($connection->quoteIdentifier(...), $storageSelect))
        . ' FROM sys_file_storage'
        . (in_array('deleted', $storageColumns, true) ? ' WHERE deleted = 0' : '')
        . ' ORDER BY uid'
    );
    foreach ($storageRows as $storageRow) {
        $storages[] = [
            'uid' => (int)$storageRow['uid'],
            'name' => (string)($storageRow['name'] ?? ''),
            'driver' => (string)($storageRow['driver'] ?? ''),
            'online' => (bool)($storageRow['is_online'] ?? true),
            'browsable' => (bool)($storageRow['is_browsable'] ?? true),
            'writable' => (bool)($storageRow['is_writable'] ?? true),
        ];
    }
}

$cacheBackends = [];
foreach (($GLOBALS['TYPO3_CONF_VARS']['SYS']['caching']['cacheConfigurations'] ?? []) as $configuration) {
    $cacheBackends[] = (string)($configuration['backend'] ?? Typo3DatabaseBackend::class);
}
$cacheBackends = array_values(array_unique($cacheBackends));
sort($cacheBackends);

$registeredTableGc = registeredTaskTables(TableGarbageCollectionTask::class);
$registeredIpTables = registeredTaskTables(IpAnonymizationTask::class);
$solrTaskType = 'ApacheSolrForTypo3\\Solr\\Task\\IndexQueueWorkerTask';
$solrAvailable = isset($availableTaskTypes[$solrTaskType]);

$candidates = buildCandidates($availableTaskTypes, $existingCounts, $cacheBackends, $storages);
if ($solrAvailable) {
    foreach ($sites as $site) {
        $rootPageId = (int)$site['root_page_id'];
        if (!in_array($rootPageId, $solrWorkerRoots, true)) {
            addFinding($findings, 'review', 'solr-site-worker-missing', 'Review whether this Site needs a Solr Index Queue Worker.', [
                'site' => $site['identifier'],
                'root_page_id' => $rootPageId,
            ]);
        }
    }
}

$report = baseReport($projectRoot, $typo3Version, $connection, $findings) + [
    'application_context' => (string)Environment::getContext(),
    'scheduler' => [
        'groups' => $groups,
        'tasks' => $tasks,
        'available_task_types' => $availableTaskList,
    ],
    'runtime' => [
        'sites' => $sites,
        'pages_marked_site_root' => $flaggedRoots,
        'file_storages' => $storages,
        'cache_backend_classes' => $cacheBackends,
        'registered_table_gc' => $registeredTableGc,
        'registered_ip_anonymization_tables' => $registeredIpTables,
        'solr' => [
            'scheduler_tasks_registered' => $solrAvailable,
            'monitoring_type' => isset($GLOBALS['TYPO3_CONF_VARS']['EXTENSIONS']['solr']['monitoringType'])
                ? (int)$GLOBALS['TYPO3_CONF_VARS']['EXTENSIONS']['solr']['monitoringType']
                : null,
            'worker_root_page_ids' => array_values(array_unique($solrWorkerRoots)),
        ],
    ],
    'candidates' => $candidates,
];

emit($report, isset($options['pretty']));
if (isset($options['strict']) && array_filter($findings, static fn(array $finding): bool => $finding['severity'] === 'error')) {
    exit(1);
}

function buildCandidates(array $available, array $existingCounts, array $cacheBackends, array $storages): array
{
    $definitions = [
        [CachingFrameworkGarbageCollectionTask::class, 'Core maintenance', 'daily 02:17', 'baseline when an explicit-GC backend is configured'],
        [FileStorageExtractionTask::class, 'Files & metadata', 'every 15 minutes', 'conditional per storage with extractors or backlog'],
        [FileStorageIndexingTask::class, 'Files & metadata', 'every 30 minutes', 'conditional per externally changed storage'],
        [IpAnonymizationTask::class, 'Privacy & retention', 'daily 03:07', 'baseline per registered IP table with approved retention'],
        [OptimizeDatabaseTableTask::class, 'Core maintenance', 'monthly 04:27', 'conditional on measured MySQL/MariaDB fragmentation'],
        [RecyclerGarbageCollectionTask::class, 'Privacy & retention', 'weekly Sunday 04:07', 'conditional on recycler use, retention, and backups'],
        [TableGarbageCollectionTask::class, 'Privacy & retention', 'weekly Sunday 03:37', 'baseline for all runtime-registered tables'],
        ['TYPO3\\CMS\\Reports\\Task\\SystemStatusUpdateTask', 'Core maintenance', 'daily 06:12', 'conditional on an owned notification channel'],
        ['TYPO3\\CMS\\Linkvalidator\\Task\\ValidatorTask', 'Search & content quality', 'weekly Monday 05:17', 'conditional on configured start page and targets'],
        ['form:cleanup:uploads', 'Privacy & retention', 'daily 04:42', 'conditional on Core Form file uploads'],
        ['cleanup:previewlinks', 'Project workflows', 'daily 04:52', 'conditional on shared workspace previews'],
        ['workspace:autopublish', 'Project workflows', 'every 5 minutes', 'conditional on scheduled workspace publishing'],
        ['redirects:checkintegrity', 'Search & content quality', 'daily 06:02', 'conditional non-destructive check when redirects contain records'],
        ['redirects:cleanup', 'Privacy & retention', 'monthly or manual', 'conditional on approved redirect constraints'],
        ['ApacheSolrForTypo3\\Solr\\Task\\IndexQueueWorkerTask', 'Search & content quality', 'every 5 minutes', 'conditional one-per-indexed-Site root'],
        ['ApacheSolrForTypo3\\Solr\\Task\\EventQueueWorkerTask', 'Search & content quality', 'every 5 minutes', 'required only when Solr monitoringType is 1'],
        ['ApacheSolrForTypo3\\Solr\\Task\\ReIndexTask', 'Search & content quality', 'disabled or manual', 'recovery only'],
        ['ApacheSolrForTypo3\\Solr\\Task\\OptimizeIndexTask', 'Search & content quality', 'disabled or manual', 'operator-evidenced maintenance only'],
    ];
    $result = [];
    foreach ($definitions as [$taskType, $group, $baseline, $applicability]) {
        $result[] = [
            'task_type' => $taskType,
            'registered' => isset($available[$taskType]),
            'existing_count' => (int)($existingCounts[$taskType] ?? 0),
            'group' => $group,
            'baseline' => $baseline,
            'applicability' => $applicability,
        ];
    }
    return $result;
}

function registeredTaskTables(string $taskType): array
{
    $tcaTables = $GLOBALS['TCA']['tx_scheduler_task']['types'][$taskType]['taskOptions']['tables'] ?? [];
    $legacyTables = $GLOBALS['TYPO3_CONF_VARS']['SC_OPTIONS']['scheduler']['tasks'][$taskType]['options']['tables'] ?? [];
    $tables = array_replace_recursive(is_array($tcaTables) ? $tcaTables : [], is_array($legacyTables) ? $legacyTables : []);
    $safe = [];
    foreach ($tables as $table => $configuration) {
        $safe[$table] = selectKeys((array)$configuration, ['dateField', 'ipField', 'expireField', 'expirePeriod']);
    }
    ksort($safe);
    return $safe;
}

function safeExecutionDetails(array $details): array
{
    return selectKeys($details, ['start', 'end', 'interval', 'multiple', 'cronCmd', 'isNewSingleExecution']);
}

function safeNativeFieldsForTask(string $taskType): array
{
    return match ($taskType) {
        CachingFrameworkGarbageCollectionTask::class => ['cache_backends'],
        FileStorageExtractionTask::class => ['file_storage', 'max_file_count'],
        FileStorageIndexingTask::class => ['file_storage'],
        IpAnonymizationTask::class => ['number_of_days', 'ip_mask', 'selected_tables'],
        OptimizeDatabaseTableTask::class => ['selected_tables'],
        RecyclerGarbageCollectionTask::class => ['number_of_days'],
        TableGarbageCollectionTask::class => ['all_tables', 'number_of_days', 'selected_tables'],
        default => [],
    };
}

function decodeJsonObject(mixed $value): array
{
    if (is_array($value)) {
        return $value;
    }
    if (!is_string($value) || trim($value) === '') {
        return [];
    }
    $decoded = json_decode($value, true);
    return is_array($decoded) ? $decoded : [];
}

function selectKeys(array $source, array $allowedKeys): array
{
    return array_intersect_key($source, array_flip($allowedKeys));
}

function timestampReport(int $timestamp): array
{
    return [
        'timestamp' => $timestamp,
        'iso8601' => $timestamp > 0 ? date(DATE_ATOM, $timestamp) : null,
    ];
}

function columnNames(array $columns): array
{
    $names = [];
    foreach ($columns as $key => $column) {
        $names[] = strtolower(is_string($key) ? $key : $column->getName());
    }
    return $names;
}

function columnMap(array $columns): array
{
    $map = [];
    foreach ($columns as $key => $column) {
        $name = is_string($key) ? $key : $column->getName();
        $map[strtolower($name)] = $name;
    }
    return $map;
}

function baseReport(string $projectRoot, string $version, Connection $connection, array $findings): array
{
    return [
        'schema_version' => 1,
        'generated_at' => date(DATE_ATOM),
        'supported' => true,
        'project_root' => $projectRoot,
        'typo3_version' => $version,
        'database_platform' => get_debug_type($connection->getDatabasePlatform()),
        'findings' => $findings,
    ];
}

function addFinding(array &$findings, string $severity, string $code, string $message, array $context = []): void
{
    $findings[] = [
        'severity' => $severity,
        'code' => $code,
        'message' => $message,
        'context' => $context,
    ];
}

function emit(array $report, bool $pretty): void
{
    $flags = JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR;
    if ($pretty) {
        $flags |= JSON_PRETTY_PRINT;
    }
    fwrite(STDOUT, json_encode($report, $flags) . "\n");
}
