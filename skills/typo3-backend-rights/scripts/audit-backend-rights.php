#!/usr/bin/env php
<?php

declare(strict_types=1);

use TYPO3\CMS\Backend\Module\ModuleRegistry;
use TYPO3\CMS\Core\Authentication\Mfa\MfaProviderRegistry;
use TYPO3\CMS\Core\Core\Bootstrap;
use TYPO3\CMS\Core\Core\SystemEnvironmentBuilder;
use TYPO3\CMS\Core\Database\ConnectionPool;
use TYPO3\CMS\Core\Site\SiteFinder;
use TYPO3\CMS\Core\Utility\GeneralUtility;

$options = getopt('', [
    'exceptions-json::',
    'exceptions-plan::',
    'group-title::',
    'owner-username::',
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
$mfaProviderRegistry = GeneralUtility::makeInstance(MfaProviderRegistry::class);
$siteFinder = GeneralUtility::makeInstance(SiteFinder::class);
$workspacesInstalled = $moduleRegistry->hasModule('workspaces_publish');

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
    . 'db_mountpoints, file_mountpoints, file_permissions, allowed_languages, mfa_providers, '
    . 'explicit_allowdeny, non_exclude_fields, category_perms, workspace_perms, TSconfig, tsconfig_includes '
    . 'FROM be_groups WHERE deleted = 0 ORDER BY uid'
);
$users = $connection->fetchAllAssociative(
    'SELECT uid, username, admin, disable, usergroup, options, lastlogin '
    . 'FROM be_users WHERE deleted = 0 ORDER BY uid'
);
$defaultOwnerUsername = isset($options['owner-username']) && $options['owner-username'] !== false
    ? trim((string)$options['owner-username'])
    : '';
$defaultOwnerUserUid = null;
if ($defaultOwnerUsername !== '') {
    $ownerUsers = array_values(array_filter(
        $users,
        static fn(array $user): bool => (string)$user['username'] === $defaultOwnerUsername
    ));
    if (count($ownerUsers) !== 1 || (int)$ownerUsers[0]['disable'] !== 0) {
        fwrite(STDERR, sprintf(
            "Expected one enabled default owner user named \"%s\".\n",
            $defaultOwnerUsername
        ));
        exit(64);
    }
    $defaultOwnerUserUid = (int)$ownerUsers[0]['uid'];
}
$fileMounts = $connection->fetchAllAssociative(
    'SELECT uid, title, hidden, read_only, identifier FROM sys_filemounts WHERE deleted = 0 ORDER BY uid'
);
$fileStorages = $connection->fetchAllAssociative(
    'SELECT uid, name, is_browsable, is_writable, is_online FROM sys_file_storage WHERE deleted = 0 ORDER BY uid'
);
$pages = $connection->fetchAllAssociative(
    'SELECT uid, pid, title, doktype, hidden, is_siteroot, perms_userid, perms_user, '
    . 'perms_groupid, perms_group, perms_everybody '
    . 'FROM pages WHERE deleted = 0 AND t3ver_wsid = 0 ORDER BY pid, sorting, uid'
);
$pageTypes = $connection->fetchAllAssociative(
    'SELECT doktype, COUNT(*) AS records FROM pages WHERE deleted = 0 AND t3ver_wsid = 0 '
    . 'GROUP BY doktype ORDER BY doktype'
);
$workspaceRecords = $workspacesInstalled ? $connection->fetchAllAssociative(
    'SELECT uid, title, adminusers, members, db_mountpoints, file_mountpoints, '
    . 'publish_access, previewlink_lifetime, live_edit '
    . 'FROM sys_workspace WHERE deleted = 0 ORDER BY uid'
) : [];

$editorExcludeFields = [];
$adminOnlyExcludeFields = [];
$systemManagedExcludeFields = [];
$adminOnlyTables = [];
foreach ($GLOBALS['TCA'] ?? [] as $tableName => $tableConfiguration) {
    if ((bool)($tableConfiguration['ctrl']['adminOnly'] ?? false)) {
        $adminOnlyTables[] = $tableName;
    }
    $editLockField = (string)($tableConfiguration['ctrl']['editlock'] ?? '');
    foreach (($tableConfiguration['columns'] ?? []) as $fieldName => $fieldConfiguration) {
        if (!(bool)($fieldConfiguration['exclude'] ?? false)) {
            continue;
        }
        $fieldConfig = is_array($fieldConfiguration['config'] ?? null) ? $fieldConfiguration['config'] : [];
        if (
            $fieldName === $editLockField
            || containsAdminOnlyDisplayCondition($fieldConfiguration['displayCond'] ?? null)
            || isRestrictedEditorField($tableName, $fieldName)
        ) {
            $adminOnlyExcludeFields[$tableName][] = $fieldName;
        } elseif (
            (bool)($fieldConfig['readOnly'] ?? false)
            || in_array((string)($fieldConfig['type'] ?? ''), ['none', 'passthrough'], true)
        ) {
            $systemManagedExcludeFields[$tableName][] = $fieldName;
        } else {
            $editorExcludeFields[$tableName][] = $fieldName;
        }
    }
}
$editorExcludeFields = sortFieldMap($editorExcludeFields);
$adminOnlyExcludeFields = sortFieldMap($adminOnlyExcludeFields);
$systemManagedExcludeFields = sortFieldMap($systemManagedExcludeFields);
sort($adminOnlyTables);

$activeFileMountUids = array_map(
    static fn(array $row): int => (int)$row['uid'],
    array_filter($fileMounts, static fn(array $row): bool => (int)$row['hidden'] === 0)
);
$configuredSites = array_map(
    static fn(object $site): array => [
        'identifier' => (string)$site->getIdentifier(),
        'root_page_id' => (int)$site->getRootPageId(),
        'language_ids' => array_map(
            static fn(object $language): int => (int)$language->getLanguageId(),
            $site->getAllLanguages()
        ),
    ],
    $siteFinder->getAllSites(false)
);
$configuredSiteRootUids = array_map(
    static fn(array $site): int => $site['root_page_id'],
    $configuredSites
);
$flaggedSiteRootUids = array_map(
    static fn(array $page): int => (int)$page['uid'],
    array_filter($pages, static fn(array $page): bool => (int)$page['is_siteroot'] === 1)
);
$requiredSiteRootUids = array_values(array_unique([...$configuredSiteRootUids, ...$flaggedSiteRootUids]));
sort($requiredSiteRootUids);
$pagesByParent = [];
$pagesByUid = [];
foreach ($pages as $page) {
    $pagesByUid[(int)$page['uid']] = $page;
    $pagesByParent[(int)$page['pid']][] = $page;
}
$mountedSitePages = collectPageTree($requiredSiteRootUids, $pagesByUid, $pagesByParent);
$exceptionContentTypes = array_keys($exceptions);
$usedPageTypeValues = array_map(static fn(array $row): int => (int)$row['doktype'], $pageTypes);

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
$blockedModulePatterns = [
    '/^(?:web_powermail|powermail_)/',
    '/^searchbackend_(?:coreoptimization|indexqueue|indexadministration)$/',
];
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
$requiredMfaProviders = ['recovery-codes', 'totp'];
$registeredMfaProviders = array_keys($mfaProviderRegistry->getProviders());
sort($registeredMfaProviders);
$forbiddenNonExcludeFieldValues = [];
foreach ([$adminOnlyExcludeFields, $systemManagedExcludeFields] as $fieldMap) {
    foreach ($fieldMap as $tableName => $fieldNames) {
        foreach ($fieldNames as $fieldName) {
            $forbiddenNonExcludeFieldValues[] = $tableName . ':' . $fieldName;
        }
    }
}
$forbiddenNonExcludeFieldValues = array_values(array_unique($forbiddenNonExcludeFieldValues));
sort($forbiddenNonExcludeFieldValues);

$groupsByUid = [];
$referencedSubgroupUids = [];
foreach ($groups as $groupRow) {
    $groupsByUid[(int)$groupRow['uid']] = $groupRow;
    array_push($referencedSubgroupUids, ...csvIntegers((string)($groupRow['subgroup'] ?? '')));
}
$referencedSubgroupUids = array_values(array_unique($referencedSubgroupUids));
sort($referencedSubgroupUids);

$findings = [];
$normalizedGroups = [];
foreach ($groups as $group) {
    $rawGroup = $group;
    $inheritanceError = null;
    try {
        $resolvedGroup = resolveEffectiveGroupPermissions((int)$rawGroup['uid'], $groupsByUid);
        $group = $resolvedGroup['permissions'];
        $effectiveGroupUids = $resolvedGroup['group_uids'];
    } catch (RuntimeException $exception) {
        $inheritanceError = $exception->getMessage();
        $effectiveGroupUids = [(int)$rawGroup['uid']];
    }
    $allowedContentTypes = [];
    foreach (explode(',', (string)($group['explicit_allowdeny'] ?? '')) as $permission) {
        $permission = trim($permission);
        if (str_starts_with($permission, 'tt_content:CType:')) {
            $allowedContentTypes[] = substr($permission, strlen('tt_content:CType:'));
        }
    }
    $allowedContentTypes = array_values(array_unique(array_filter($allowedContentTypes, 'strlen')));
    sort($allowedContentTypes);

    $isTopLevel = !in_array((int)$rawGroup['uid'], $referencedSubgroupUids, true);
    $isTarget = isset($options['group-title']) && $options['group-title'] !== false
        ? (string)$rawGroup['title'] === (string)$options['group-title']
        : $isTopLevel;
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
    $groupSubgroups = csvIntegers((string)($rawGroup['subgroup'] ?? ''));
    $groupMfaProviders = csvStrings((string)($group['mfa_providers'] ?? ''));
    $groupAllowedLanguages = csvIntegers((string)($group['allowed_languages'] ?? ''));
    $groupWorkspacePermissions = (int)($group['workspace_perms'] ?? 0);
    $enabledEditorUserUids = array_values(array_map(
        static fn(array $user): int => (int)$user['uid'],
        array_filter(
            $users,
            static fn(array $user): bool => (int)$user['admin'] === 0
                && (int)$user['disable'] === 0
                && in_array((int)$rawGroup['uid'], csvIntegers((string)$user['usergroup']), true)
        )
    ));

    $groupFindings = [];
    if ($isTarget && $inheritanceError !== null) {
        $groupFindings[] = finding(
            'error',
            'invalid-group-inheritance',
            $inheritanceError
        );
    }
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
    $requiredLeafTitles = [
        deriveLeafTitle((string)$rawGroup['title'], 'Base'),
        deriveLeafTitle((string)$rawGroup['title'], 'Content'),
        deriveLeafTitle((string)$rawGroup['title'], 'Site'),
        deriveLeafTitle((string)$rawGroup['title'], 'Extensions'),
    ];
    $directSubgroupTitles = [];
    $nestedLeafUids = [];
    foreach ($groupSubgroups as $subgroupUid) {
        if (!isset($groupsByUid[$subgroupUid])) {
            continue;
        }
        $directSubgroupTitles[] = (string)$groupsByUid[$subgroupUid]['title'];
        if (csvIntegers((string)($groupsByUid[$subgroupUid]['subgroup'] ?? '')) !== []) {
            $nestedLeafUids[] = $subgroupUid;
        }
    }
    $missingRequiredLeafTitles = array_values(array_diff($requiredLeafTitles, $directSubgroupTitles));
    $directPermissionFields = nonEmptyDirectPermissionFields($rawGroup);
    $directLeafAssignments = [];
    $usersMissingGroupMountInheritance = [];
    foreach ($users as $user) {
        $assignedLeaves = array_values(array_intersect(
            csvIntegers((string)($user['usergroup'] ?? '')),
            $groupSubgroups
        ));
        foreach ($assignedLeaves as $assignedLeafUid) {
            $directLeafAssignments[] = sprintf(
                '%s (uid %d) -> group %d',
                (string)$user['username'],
                (int)$user['uid'],
                $assignedLeafUid
            );
        }
        if (
            in_array((int)$rawGroup['uid'], csvIntegers((string)($user['usergroup'] ?? '')), true)
            && (int)$user['admin'] === 0
            && (((int)$user['options'] & 3) !== 3)
        ) {
            $usersMissingGroupMountInheritance[] = sprintf(
                '%s (uid %d, options %d)',
                (string)$user['username'],
                (int)$user['uid'],
                (int)$user['options']
            );
        }
    }
    if ($isTarget && $missingRequiredLeafTitles !== []) {
        $groupFindings[] = finding(
            'error',
            'required-leaf-groups-missing',
            'The main editor group must directly inherit Base, Content, Site, and Extensions leaves.',
            $missingRequiredLeafTitles
        );
    }
    if ($isTarget && $nestedLeafUids !== []) {
        $groupFindings[] = finding(
            'error',
            'nested-editor-leaf-groups',
            'Editor capability groups must remain direct leaves of the main group.',
            $nestedLeafUids
        );
    }
    if ($isTarget && $directPermissionFields !== []) {
        $groupFindings[] = finding(
            'error',
            'main-group-has-direct-permissions',
            'Keep the main editor group as a composition and page-owner group only.',
            $directPermissionFields
        );
    }
    if ($isTarget && $directLeafAssignments !== []) {
        $groupFindings[] = finding(
            'error',
            'leaf-groups-assigned-directly',
            'Assign backend users only to the main editor group, never directly to a leaf.',
            $directLeafAssignments
        );
    }
    if ($isTarget && $usersMissingGroupMountInheritance !== []) {
        $groupFindings[] = finding(
            'error',
            'users-do-not-inherit-group-mounts',
            'Non-admin members must inherit page and file mounts from associated groups (options bits 1 and 2).',
            $usersMissingGroupMountInheritance
        );
    }
    $workspaceMemberUids = [];
    $workspaceOwnerUids = [];
    $workspacePublishingTooBroad = [];
    foreach ($workspaceRecords as $workspaceRecord) {
        $groupToken = 'be_groups_' . (int)$rawGroup['uid'];
        $isMember = in_array($groupToken, csvStrings((string)$workspaceRecord['members']), true);
        $isOwner = in_array($groupToken, csvStrings((string)$workspaceRecord['adminusers']), true);
        if ($isMember) {
            $workspaceMemberUids[] = (int)$workspaceRecord['uid'];
        }
        if ($isOwner) {
            $workspaceOwnerUids[] = (int)$workspaceRecord['uid'];
        }
        if (($isMember || $isOwner) && (int)$workspaceRecord['publish_access'] !== 2) {
            $workspacePublishingTooBroad[] = (int)$workspaceRecord['uid'];
        }
    }
    if ($isTarget && $workspacesInstalled && ($groupWorkspacePermissions & 1) !== 1) {
        $groupFindings[] = finding(
            'error',
            'workspace-live-access-missing',
            'EXT:workspaces is installed, so the editor role needs workspace_perms Live access bit 1.'
        );
    }
    if ($isTarget && !$workspacesInstalled && $groupWorkspacePermissions !== 0) {
        $groupFindings[] = finding(
            'warning',
            'stale-workspace-permission',
            'workspace_perms is set although EXT:workspaces is not installed.',
            [$groupWorkspacePermissions]
        );
    }
    if ($isTarget && $workspacesInstalled && $workspaceRecords === []) {
        $groupFindings[] = finding(
            'warning',
            'no-custom-workspace-configured',
            'Workspace module and Live access are enabled, but no custom workspace exists.'
        );
    }
    if (
        $isTarget
        && $workspacesInstalled
        && $workspaceRecords !== []
        && $workspaceMemberUids === []
        && $workspaceOwnerUids === []
    ) {
        $groupFindings[] = finding(
            'error',
            'editor-group-not-in-custom-workspace',
            'Add the main editor group as a member of the intended custom workspace.',
            array_map(static fn(array $row): int => (int)$row['uid'], $workspaceRecords)
        );
    }
    if ($isTarget && $workspaceOwnerUids !== []) {
        $groupFindings[] = finding(
            'warning',
            'editor-group-is-workspace-owner',
            'Basic editors should be workspace members; owner/publisher access needs explicit approval.',
            $workspaceOwnerUids
        );
    }
    if ($isTarget && $workspacePublishingTooBroad !== []) {
        $groupFindings[] = finding(
            'error',
            'workspace-publishing-too-broad',
            'Use publish_access 2 so only approved workspace owners can publish.',
            $workspacePublishingTooBroad
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
    $missingRequiredModules = array_values(array_diff($requiredModules, $groupModules));
    if ($isTarget && $missingRequiredModules !== []) {
        $groupFindings[] = finding(
            'error',
            'installed-editor-modules-missing',
            'Installed minimum editor modules are missing from the group.',
            $missingRequiredModules
        );
    }
    $blockedModules = array_values(array_filter(
        $groupModules,
        static function (string $identifier) use ($blockedModulePatterns): bool {
            foreach ($blockedModulePatterns as $pattern) {
                if (preg_match($pattern, $identifier) === 1) {
                    return true;
                }
            }
            return false;
        }
    ));
    if ($isTarget && $blockedModules !== []) {
        $groupFindings[] = finding(
            'error',
            'blocked-backend-modules-allowed',
            'Powermail reporting/marketing or Solr index-mutation modules must remain unavailable.',
            $blockedModules
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
    $grantedAdminOnlyTables = array_values(array_intersect(
        array_unique([...$groupTablesSelect, ...$groupTablesModify]),
        $adminOnlyTables
    ));
    if ($isTarget && $grantedAdminOnlyTables !== []) {
        $groupFindings[] = finding(
            'error',
            'admin-only-tables-granted',
            'Tables marked TCA ctrl.adminOnly cannot be granted to non-admin editors.',
            $grantedAdminOnlyTables
        );
    }
    $missingWritableTables = array_values(array_diff($requiredEditorTables, $groupTablesModify));
    $missingSelectableTables = array_values(array_diff($requiredEditorTables, $groupTablesSelect));
    if ($isTarget && ($missingWritableTables !== [] || $missingSelectableTables !== [])) {
        $groupFindings[] = finding(
            'error',
            'installed-editor-tables-missing',
            'Installed content, file, News, Core Form, Redirects, and Powermail editor tables must be present in both lists.',
            array_values(array_unique([...$missingWritableTables, ...$missingSelectableTables]))
        );
    }
    $grantedPowermailSubmissionTables = array_values(array_intersect(
        ['tx_powermail_domain_model_mail', 'tx_powermail_domain_model_answer'],
        array_unique([...$groupTablesSelect, ...$groupTablesModify])
    ));
    if ($isTarget && $grantedPowermailSubmissionTables !== []) {
        $groupFindings[] = finding(
            'error',
            'powermail-submission-tables-granted',
            'Powermail mail/answer submission data is outside the form-author role.',
            $grantedPowermailSubmissionTables
        );
    }
    $requiredNonExcludeFields = [];
    foreach ($groupTablesModify as $tableName) {
        foreach ($editorExcludeFields[$tableName] ?? [] as $fieldName) {
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
    $grantedForbiddenFields = array_values(array_intersect(
        $forbiddenNonExcludeFieldValues,
        $groupNonExcludeFields
    ));
    sort($grantedForbiddenFields);
    if ($isTarget && $grantedForbiddenFields !== []) {
        $groupFindings[] = finding(
            'error',
            'admin-or-system-fields-granted',
            'Admin-only or system-managed fields must not be added to non_exclude_fields.',
            $grantedForbiddenFields
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
    $missingDbMountUids = array_values(array_diff($requiredSiteRootUids, $groupDbMountUids));
    if ($isTarget && $missingDbMountUids !== []) {
        $groupFindings[] = finding(
            'error',
            'site-root-mounts-missing',
            'Configured Site roots or pages marked is_siteroot are missing from database mounts.',
            $missingDbMountUids
        );
    }
    if ($isTarget && $groupAllowedLanguages !== []) {
        $groupFindings[] = finding(
            'error',
            'languages-restricted',
            'allowed_languages must be empty to cover all current and future Site languages.',
            $groupAllowedLanguages
        );
    }
    $missingMfaProviders = array_values(array_diff($requiredMfaProviders, $groupMfaProviders));
    $extraMfaProviders = array_values(array_diff($groupMfaProviders, $requiredMfaProviders));
    if ($isTarget && ($missingMfaProviders !== [] || $extraMfaProviders !== [])) {
        $groupFindings[] = finding(
            'error',
            'mfa-provider-set-incorrect',
            'mfa_providers must contain exactly totp and recovery-codes.',
            array_values(array_unique([...$missingMfaProviders, ...$extraMfaProviders]))
        );
    }
    if ($isTarget && in_array('powermail_pi1', $allowedContentTypes, true)) {
        $groupFindings[] = finding(
            'error',
            'powermail-frontend-plugin-allowed',
            'Powermail form authors must not place or reconfigure the frontend plugin.',
            ['powermail_pi1']
        );
    }

    $pagesWithWrongGroup = [];
    $pagesWithWrongOwnerUser = [];
    $pagesWithNonStandardOwnerRights = [];
    $pagesWithMissingEditorBits = [];
    $pagesWithNonStandardGroupRights = [];
    $pagesWithDeleteBit = [];
    $pagesWithNonStandardEverybodyRights = [];
    $pagesWithBroadEverybodyRights = [];
    foreach ($mountedSitePages as $page) {
        $pageUid = (int)$page['uid'];
        if ($defaultOwnerUserUid !== null && (int)$page['perms_userid'] !== $defaultOwnerUserUid) {
            $pagesWithWrongOwnerUser[] = $pageUid;
        }
        if ((int)$page['perms_user'] !== 31) {
            $pagesWithNonStandardOwnerRights[] = $pageUid;
        }
        if ((int)$page['perms_groupid'] !== (int)$rawGroup['uid']) {
            $pagesWithWrongGroup[] = $pageUid;
        }
        if (((int)$page['perms_group'] & 27) !== 27) {
            $pagesWithMissingEditorBits[] = $pageUid;
        }
        if (((int)$page['perms_group'] & 4) === 4) {
            $pagesWithDeleteBit[] = $pageUid;
        }
        if ((int)$page['perms_group'] !== 27) {
            $pagesWithNonStandardGroupRights[] = $pageUid;
        }
        if ((int)$page['perms_everybody'] !== 1) {
            $pagesWithNonStandardEverybodyRights[] = $pageUid;
        }
        if (((int)$page['perms_everybody'] & 30) !== 0) {
            $pagesWithBroadEverybodyRights[] = $pageUid;
        }
    }
    if ($isTarget && $defaultOwnerUserUid === null) {
        $groupFindings[] = finding(
            'warning',
            'default-page-owner-not-audited',
            'Pass --owner-username to verify one explicit default owner across every Site tree.'
        );
    }
    if ($isTarget && $pagesWithWrongOwnerUser !== []) {
        $groupFindings[] = finding(
            'error',
            'page-owner-user-mismatch',
            'Pages below required Site roots do not use the approved default owner user.',
            $pagesWithWrongOwnerUser
        );
    }
    if ($isTarget && $pagesWithNonStandardOwnerRights !== []) {
        $groupFindings[] = finding(
            'error',
            'page-owner-permissions-not-31',
            'Pages below required Site roots do not use owner-user permission bits 31.',
            $pagesWithNonStandardOwnerRights
        );
    }
    if ($isTarget && $pagesWithWrongGroup !== []) {
        $groupFindings[] = finding(
            'error',
            'page-group-owner-mismatch',
            'Pages below required Site roots are not assigned to the main editor group.',
            $pagesWithWrongGroup
        );
    }
    if ($isTarget && $enabledEditorUserUids === []) {
        $groupFindings[] = finding(
            'warning',
            'main-group-has-no-enabled-editor',
            'No enabled non-admin user belongs directly to the main group. Do not change page ownership before membership and login are verified.'
        );
    }
    if ($isTarget && $pagesWithMissingEditorBits !== []) {
        $groupFindings[] = finding(
            'error',
            'page-group-permissions-incomplete',
            'Pages below required Site roots do not provide group permission bits 27.',
            $pagesWithMissingEditorBits
        );
    }
    if ($isTarget && $pagesWithNonStandardGroupRights !== []) {
        $groupFindings[] = finding(
            'error',
            'page-group-permissions-not-27',
            'Pages below required Site roots do not use the standard owner-group permission bits 27.',
            $pagesWithNonStandardGroupRights
        );
    }
    if ($isTarget && $pagesWithDeleteBit !== []) {
        $groupFindings[] = finding(
            'warning',
            'page-delete-permission-enabled',
            'Page deletion is enabled and requires explicit approval.',
            $pagesWithDeleteBit
        );
    }
    if ($isTarget && $pagesWithBroadEverybodyRights !== []) {
        $groupFindings[] = finding(
            'error',
            'broad-everybody-page-rights',
            'Write/create/delete rights must not be granted through perms_everybody.',
            $pagesWithBroadEverybodyRights
        );
    }
    if ($isTarget && $pagesWithNonStandardEverybodyRights !== []) {
        $groupFindings[] = finding(
            'error',
            'page-everybody-permissions-not-1',
            'Pages below required Site roots must give everybody the view-only bit 1.',
            $pagesWithNonStandardEverybodyRights
        );
    }

    array_push($findings, ...$groupFindings);
    $normalizedGroups[] = [
        'uid' => (int)$rawGroup['uid'],
        'title' => (string)$rawGroup['title'],
        'hidden' => (bool)$rawGroup['hidden'],
        'evaluated_as_main' => $isTarget,
        'subgroup' => $groupSubgroups,
        'effective_group_uids' => $effectiveGroupUids,
        'required_leaf_titles' => $requiredLeafTitles,
        'missing_required_leaf_titles' => $missingRequiredLeafTitles,
        'nested_leaf_uids' => $nestedLeafUids,
        'direct_permission_fields' => $directPermissionFields,
        'direct_leaf_assignments' => $directLeafAssignments,
        'users_missing_group_mount_inheritance' => $usersMissingGroupMountInheritance,
        'enabled_editor_user_uids' => $enabledEditorUserUids,
        'allowed_content_types' => $allowedContentTypes,
        'missing_editorial_content_types' => $missingEditorialTypes,
        'allowed_exception_content_types' => $allowedExceptions,
        'unregistered_allowed_content_types' => $unregisteredAllowedTypes,
        'db_mountpoints' => $groupDbMountUids,
        'missing_site_root_mountpoints' => $missingDbMountUids,
        'file_mountpoints' => $groupFileMountUids,
        'missing_active_file_mountpoints' => $missingFileMountUids,
        'tables_select' => $groupTablesSelect,
        'tables_modify' => $groupTablesModify,
        'modify_tables_without_select' => $modifyTablesWithoutSelect,
        'modules' => $groupModules,
        'unregistered_modules' => $unregisteredModules,
        'missing_required_modules' => $missingRequiredModules,
        'blocked_modules' => $blockedModules,
        'page_types' => $groupPageTypes,
        'missing_used_page_types' => $missingUsedPageTypes,
        'file_permissions' => csvStrings((string)($group['file_permissions'] ?? '')),
        'non_exclude_fields' => $groupNonExcludeFields,
        'missing_runtime_non_exclude_fields' => $missingNonExcludeFields,
        'forbidden_non_exclude_fields' => $grantedForbiddenFields,
        'allowed_languages' => $groupAllowedLanguages === [] ? 'all' : $groupAllowedLanguages,
        'mfa_providers' => $groupMfaProviders,
        'missing_mfa_providers' => $missingMfaProviders,
        'workspace' => [
            'installed' => $workspacesInstalled,
            'workspace_perms' => $groupWorkspacePermissions,
            'member_workspace_uids' => $workspaceMemberUids,
            'owner_workspace_uids' => $workspaceOwnerUids,
            'publishing_too_broad_workspace_uids' => $workspacePublishingTooBroad,
        ],
        'page_permission_audit' => [
            'default_owner_username' => $defaultOwnerUsername === '' ? null : $defaultOwnerUsername,
            'default_owner_user_uid' => $defaultOwnerUserUid,
            'wrong_owner_user' => $pagesWithWrongOwnerUser,
            'owner_rights_not_31' => $pagesWithNonStandardOwnerRights,
            'wrong_group_owner' => $pagesWithWrongGroup,
            'missing_editor_bits_27' => $pagesWithMissingEditorBits,
            'group_rights_not_27' => $pagesWithNonStandardGroupRights,
            'page_delete_bit_enabled' => $pagesWithDeleteBit,
            'everybody_rights_not_1' => $pagesWithNonStandardEverybodyRights,
            'broad_everybody_write_bits' => $pagesWithBroadEverybodyRights,
        ],
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
$coveredStorageUids = [];
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
    $coveredStorageUids[] = $storageUid;
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
$activeStorageUids = array_map(
    static fn(array $storage): int => (int)$storage['uid'],
    array_filter(
        $fileStorages,
        static fn(array $storage): bool => (int)$storage['is_online'] === 1 && (int)$storage['is_browsable'] === 1
    )
);
$uncoveredStorageUids = array_values(array_diff($activeStorageUids, array_unique($coveredStorageUids)));
if ($uncoveredStorageUids !== []) {
    $findings[] = finding(
        'error',
        'online-file-storage-without-mount',
        'Every online browsable file storage needs an active file mount for editor access.',
        $uncoveredStorageUids
    );
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
            'options' => (int)$user['options'],
            'lastlogin' => (int)$user['lastlogin'],
        ],
        $users
    ),
    'enabled_administrators' => $enabledAdmins,
    'configured_sites' => $configuredSites,
    'flagged_site_root_uids' => $flaggedSiteRootUids,
    'required_site_root_uids' => $requiredSiteRootUids,
    'mounted_site_page_count' => count($mountedSitePages),
    'used_page_types' => $pageTypes,
    'file_mounts' => $fileMounts,
    'file_storages' => $fileStorages,
    'runtime_editor_exclude_fields' => $editorExcludeFields,
    'runtime_admin_only_exclude_fields' => $adminOnlyExcludeFields,
    'runtime_system_managed_exclude_fields' => $systemManagedExcludeFields,
    'runtime_admin_only_tables' => $adminOnlyTables,
    'required_editor_modules' => $requiredModules,
    'required_editor_tables' => $requiredEditorTables,
    'registered_mfa_providers' => $registeredMfaProviders,
    'workspaces' => [
        'installed' => $workspacesInstalled,
        'module' => $workspacesInstalled ? 'workspaces_publish' : null,
        'records' => $workspaceRecords,
    ],
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

function groupCsvPermissionFields(): array
{
    return [
        'groupMods',
        'tables_select',
        'tables_modify',
        'pagetypes_select',
        'db_mountpoints',
        'file_mountpoints',
        'file_permissions',
        'allowed_languages',
        'mfa_providers',
        'explicit_allowdeny',
        'non_exclude_fields',
        'category_perms',
        'tsconfig_includes',
    ];
}

function resolveEffectiveGroupPermissions(int $groupUid, array $groupsByUid, array $path = []): array
{
    if (in_array($groupUid, $path, true)) {
        throw new RuntimeException('Backend group inheritance contains a cycle at group ' . $groupUid . '.');
    }
    if (!isset($groupsByUid[$groupUid])) {
        throw new RuntimeException('Backend group inheritance references missing group ' . $groupUid . '.');
    }
    $permissions = $groupsByUid[$groupUid];
    $groupUids = [$groupUid];
    $path[] = $groupUid;
    foreach (csvIntegers((string)($permissions['subgroup'] ?? '')) as $subgroupUid) {
        if (!isset($groupsByUid[$subgroupUid])) {
            throw new RuntimeException('Backend group inheritance references missing group ' . $subgroupUid . '.');
        }
        if ((int)($groupsByUid[$subgroupUid]['hidden'] ?? 0) !== 0) {
            throw new RuntimeException('Backend group inheritance references hidden group ' . $subgroupUid . '.');
        }
        $child = resolveEffectiveGroupPermissions($subgroupUid, $groupsByUid, $path);
        foreach (groupCsvPermissionFields() as $fieldName) {
            $permissions[$fieldName] = implode(',', array_values(array_unique([
                ...csvStrings((string)($permissions[$fieldName] ?? '')),
                ...csvStrings((string)($child['permissions'][$fieldName] ?? '')),
            ])));
        }
        foreach (['TSconfig'] as $fieldName) {
            $parts = array_filter([
                trim((string)($permissions[$fieldName] ?? '')),
                trim((string)($child['permissions'][$fieldName] ?? '')),
            ], 'strlen');
            $permissions[$fieldName] = implode("\n", array_values(array_unique($parts)));
        }
        $permissions['workspace_perms'] = (int)($permissions['workspace_perms'] ?? 0)
            | (int)($child['permissions']['workspace_perms'] ?? 0);
        array_push($groupUids, ...$child['group_uids']);
    }
    $groupUids = array_values(array_unique($groupUids));
    sort($groupUids);
    return [
        'permissions' => $permissions,
        'group_uids' => $groupUids,
    ];
}

function nonEmptyDirectPermissionFields(array $group): array
{
    $fields = [];
    foreach (groupCsvPermissionFields() as $fieldName) {
        if (csvStrings((string)($group[$fieldName] ?? '')) !== []) {
            $fields[] = $fieldName;
        }
    }
    if (trim((string)($group['TSconfig'] ?? '')) !== '') {
        $fields[] = 'TSconfig';
    }
    if ((int)($group['workspace_perms'] ?? 0) !== 0) {
        $fields[] = 'workspace_perms';
    }
    sort($fields);
    return $fields;
}

function deriveLeafTitle(string $mainTitle, string $leafName): string
{
    $suffix = ' · ' . $leafName;
    return mb_substr($mainTitle, 0, 50 - mb_strlen($suffix)) . $suffix;
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

function sortFieldMap(array $fieldMap): array
{
    foreach ($fieldMap as &$fieldNames) {
        sort($fieldNames);
    }
    unset($fieldNames);
    ksort($fieldMap);
    return $fieldMap;
}

function collectPageTree(array $rootUids, array $pagesByUid, array $pagesByParent): array
{
    $result = [];
    $queue = $rootUids;
    $seen = [];
    while ($queue !== []) {
        $pageUid = (int)array_shift($queue);
        if ($pageUid < 1 || isset($seen[$pageUid])) {
            continue;
        }
        $seen[$pageUid] = true;
        if (!isset($pagesByUid[$pageUid])) {
            continue;
        }
        $result[] = $pagesByUid[$pageUid];
        foreach ($pagesByParent[$pageUid] ?? [] as $childPage) {
            $queue[] = (int)$childPage['uid'];
        }
    }
    return $result;
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
