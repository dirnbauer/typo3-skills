#!/usr/bin/env php
<?php

declare(strict_types=1);

use TYPO3\CMS\Core\Authentication\CommandLineUserAuthentication;
use TYPO3\CMS\Core\Core\Bootstrap;
use TYPO3\CMS\Core\Core\SystemEnvironmentBuilder;
use TYPO3\CMS\Core\DataHandling\DataHandler;
use TYPO3\CMS\Core\Database\ConnectionPool;
use TYPO3\CMS\Core\Site\SiteFinder;
use TYPO3\CMS\Core\Utility\GeneralUtility;

$options = getopt('', [
    'apply-pages',
    'dry-run',
    'group-title:',
    'membership-mode::',
    'owner-username::',
    'replace-group-title::',
    'usernames::',
]);

$groupTitle = trim((string)($options['group-title'] ?? ''));
if ($groupTitle === '') {
    fail('Pass --group-title="Editorial Main".');
}
$membershipMode = (string)($options['membership-mode'] ?? 'none');
if (!in_array($membershipMode, ['none', 'append', 'replace'], true)) {
    fail('--membership-mode must be none, append, or replace.');
}
$usernames = csvStrings((string)($options['usernames'] ?? ''));
if ($membershipMode !== 'none' && $usernames === []) {
    fail('--usernames is required when membership-mode is append or replace.');
}
$replaceGroupTitle = trim((string)($options['replace-group-title'] ?? ''));
if ($membershipMode === 'replace' && $replaceGroupTitle === '') {
    fail('--replace-group-title is required when membership-mode is replace.');
}
$applyPages = isset($options['apply-pages']);
$dryRun = isset($options['dry-run']);
if ($membershipMode === 'none' && !$applyPages) {
    fail('Choose a membership mode or pass --apply-pages.');
}

$projectRoot = getcwd();
while ($projectRoot !== DIRECTORY_SEPARATOR && !is_file($projectRoot . '/vendor/autoload.php')) {
    $projectRoot = dirname($projectRoot);
}
if (!is_file($projectRoot . '/vendor/autoload.php')) {
    fail('Run this script from a Composer TYPO3 project root.');
}

$classLoader = require $projectRoot . '/vendor/autoload.php';
SystemEnvironmentBuilder::run(1, SystemEnvironmentBuilder::REQUESTTYPE_CLI);
$container = Bootstrap::init($classLoader);

/** @var ConnectionPool $connectionPool */
$connectionPool = $container->get(ConnectionPool::class);
$connection = $connectionPool->getConnectionForTable('pages');
/** @var SiteFinder $siteFinder */
$siteFinder = GeneralUtility::makeInstance(SiteFinder::class);

$groups = $connection->fetchAllAssociative(
    'SELECT uid, title FROM be_groups WHERE deleted = 0 AND hidden = 0 ORDER BY uid'
);
$mainGroupUid = uniqueGroupUid($groups, $groupTitle);
$replaceGroupUid = $membershipMode === 'replace'
    ? uniqueGroupUid($groups, $replaceGroupTitle)
    : null;
if ($replaceGroupUid === $mainGroupUid) {
    fail('The replacement group and main group must be different.');
}

$ownerUsername = trim((string)($options['owner-username'] ?? ''));
$ownerUserUid = null;
if ($applyPages) {
    if ($ownerUsername === '') {
        fail('--owner-username is required with --apply-pages; never guess the default page owner.');
    }
    $ownerRows = $connection->fetchAllAssociative(
        'SELECT uid, username, disable FROM be_users WHERE deleted = 0 AND username = ?',
        [$ownerUsername]
    );
    if (count($ownerRows) !== 1 || (int)$ownerRows[0]['disable'] !== 0) {
        fail(sprintf('Expected one enabled default owner user named "%s".', $ownerUsername));
    }
    $ownerUserUid = (int)$ownerRows[0]['uid'];
}

$enabledAdministrators = $connection->fetchFirstColumn(
    'SELECT uid FROM be_users WHERE deleted = 0 AND disable = 0 AND admin = 1 ORDER BY uid'
);
if ($enabledAdministrators === []) {
    fail('No enabled administrator remains; refusing the cutover.');
}

$users = [];
if ($usernames !== []) {
    $placeholders = implode(',', array_fill(0, count($usernames), '?'));
    $users = $connection->fetchAllAssociative(
        'SELECT uid, username, admin, disable, usergroup, options FROM be_users '
        . 'WHERE deleted = 0 AND username IN (' . $placeholders . ') ORDER BY uid',
        $usernames
    );
    $foundUsernames = array_map(static fn(array $row): string => (string)$row['username'], $users);
    $missingUsernames = array_values(array_diff($usernames, $foundUsernames));
    if ($missingUsernames !== []) {
        fail('Backend users not found: ' . implode(', ', $missingUsernames));
    }
    foreach ($users as $user) {
        if ((int)$user['admin'] !== 0 || (int)$user['disable'] !== 0) {
            fail(sprintf(
                'Target %s (uid %d) must be an enabled non-admin user.',
                (string)$user['username'],
                (int)$user['uid']
            ));
        }
    }
}

$userChanges = [];
$userDataMap = [];
foreach ($users as $user) {
    $beforeGroups = csvIntegers((string)$user['usergroup']);
    $afterGroups = $beforeGroups;
    if ($membershipMode === 'replace') {
        $afterGroups = array_values(array_filter(
            $afterGroups,
            static fn(int $uid): bool => $uid !== $replaceGroupUid
        ));
    }
    if ($membershipMode !== 'none' && !in_array($mainGroupUid, $afterGroups, true)) {
        $afterGroups[] = $mainGroupUid;
    }
    $afterGroups = array_values(array_unique($afterGroups));
    $afterOptions = (int)$user['options'] | 3;
    $userChanges[] = [
        'uid' => (int)$user['uid'],
        'username' => (string)$user['username'],
        'groups_before' => $beforeGroups,
        'groups_after' => $afterGroups,
        'options_before' => (int)$user['options'],
        'options_after' => $afterOptions,
    ];
    if ($beforeGroups !== $afterGroups || (int)$user['options'] !== $afterOptions) {
        $userDataMap[(int)$user['uid']] = [
            'usergroup' => implode(',', $afterGroups),
            'options' => $afterOptions,
        ];
    }
}

if ($applyPages) {
    $proposedGroupsByUserUid = [];
    foreach ($userChanges as $userChange) {
        $proposedGroupsByUserUid[(int)$userChange['uid']] = $userChange['groups_after'];
    }
    $enabledEditors = $connection->fetchAllAssociative(
        'SELECT uid, username, usergroup FROM be_users '
        . 'WHERE deleted = 0 AND disable = 0 AND admin = 0 ORDER BY uid'
    );
    $enabledMainGroupEditors = array_values(array_filter(
        $enabledEditors,
        static function (array $editor) use ($proposedGroupsByUserUid, $mainGroupUid): bool {
            $groups = $proposedGroupsByUserUid[(int)$editor['uid']]
                ?? csvIntegers((string)$editor['usergroup']);
            return in_array($mainGroupUid, $groups, true);
        }
    ));
    if ($enabledMainGroupEditors === []) {
        fail('No enabled non-admin user would belong to the main group; refusing page ownership changes.');
    }
}

$pageChanges = [];
$pageDataMap = [];
$siteRootUids = [];
if ($applyPages) {
    foreach ($siteFinder->getAllSites(false) as $site) {
        $siteRootUids[] = (int)$site->getRootPageId();
    }
    $flaggedRoots = $connection->fetchFirstColumn(
        'SELECT uid FROM pages WHERE deleted = 0 AND t3ver_wsid = 0 AND is_siteroot = 1 ORDER BY uid'
    );
    array_push($siteRootUids, ...array_map('intval', $flaggedRoots));
    $siteRootUids = array_values(array_unique(array_filter($siteRootUids, static fn(int $uid): bool => $uid > 0)));
    sort($siteRootUids);
    if ($siteRootUids === []) {
        fail('No configured or flagged Site root was found.');
    }

    $pages = $connection->fetchAllAssociative(
        'SELECT uid, pid, perms_userid, perms_groupid, perms_user, perms_group, perms_everybody '
        . 'FROM pages WHERE deleted = 0 AND t3ver_wsid = 0 ORDER BY pid, sorting, uid'
    );
    $pagesByUid = [];
    $childrenByParent = [];
    foreach ($pages as $page) {
        $pagesByUid[(int)$page['uid']] = $page;
        $childrenByParent[(int)$page['pid']][] = (int)$page['uid'];
    }
    $sitePages = collectPageTree($siteRootUids, $pagesByUid, $childrenByParent);
    if ($sitePages === []) {
        fail('The configured Site roots contain no live pages.');
    }
    foreach ($sitePages as $page) {
        $uid = (int)$page['uid'];
        $after = [
            'perms_userid' => $ownerUserUid,
            'perms_user' => 31,
            'perms_groupid' => $mainGroupUid,
            'perms_group' => 27,
            'perms_everybody' => 1,
        ];
        $before = [
            'perms_userid' => (int)$page['perms_userid'],
            'perms_user' => (int)$page['perms_user'],
            'perms_groupid' => (int)$page['perms_groupid'],
            'perms_group' => (int)$page['perms_group'],
            'perms_everybody' => (int)$page['perms_everybody'],
        ];
        $pageChanges[] = [
            'uid' => $uid,
            'before' => $before,
            'after' => $after,
        ];
        if (
            $before['perms_userid'] !== $ownerUserUid
            || $before['perms_user'] !== 31
            || $before['perms_groupid'] !== $mainGroupUid
            || $before['perms_group'] !== 27
            || $before['perms_everybody'] !== 1
        ) {
            $pageDataMap[$uid] = $after;
        }
    }
}

$report = [
    'dry_run' => $dryRun,
    'group' => ['uid' => $mainGroupUid, 'title' => $groupTitle],
    'membership_mode' => $membershipMode,
    'replace_group' => $replaceGroupUid === null
        ? null
        : ['uid' => $replaceGroupUid, 'title' => $replaceGroupTitle],
    'user_changes' => $userChanges,
    'site_root_uids' => $siteRootUids,
    'site_page_count' => count($pageChanges),
    'site_pages_requiring_change' => array_keys($pageDataMap),
    'permission_baseline' => [
        'owner_user_uid' => $ownerUserUid,
        'owner_username' => $ownerUsername === '' ? null : $ownerUsername,
        'owner_user' => 31,
        'owner_group' => 27,
        'everybody' => 1,
    ],
];

if (!$dryRun) {
    $backendUser = Bootstrap::initializeBackendUser(CommandLineUserAuthentication::class);
    $backendUser->authenticate();
    $GLOBALS['BE_USER'] = $backendUser;

    $dataMap = [];
    if ($userDataMap !== []) {
        $dataMap['be_users'] = $userDataMap;
    }
    if ($pageDataMap !== []) {
        $dataMap['pages'] = $pageDataMap;
    }
    if ($dataMap !== []) {
        /** @var DataHandler $dataHandler */
        $dataHandler = GeneralUtility::makeInstance(DataHandler::class);
        $dataHandler->start($dataMap, [], $backendUser);
        $dataHandler->process_datamap();
        if ($dataHandler->errorLog !== []) {
            fail('DataHandler rejected the cutover: ' . implode(' | ', $dataHandler->errorLog));
        }
    }
    $report['applied'] = true;
    $report['changed_user_uids'] = array_keys($userDataMap);
    $report['changed_page_uids'] = array_keys($pageDataMap);
}

echo json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) . "\n";

function uniqueGroupUid(array $groups, string $title): int
{
    $matches = array_values(array_filter(
        $groups,
        static fn(array $group): bool => (string)$group['title'] === $title
    ));
    if (count($matches) !== 1) {
        fail(sprintf('Expected exactly one enabled backend group titled "%s"; found %d.', $title, count($matches)));
    }
    return (int)$matches[0]['uid'];
}

function csvStrings(string $value): array
{
    return array_values(array_unique(array_filter(array_map('trim', explode(',', $value)), 'strlen')));
}

function csvIntegers(string $value): array
{
    return array_values(array_unique(array_filter(
        array_map('intval', csvStrings($value)),
        static fn(int $uid): bool => $uid > 0
    )));
}

function collectPageTree(array $rootUids, array $pagesByUid, array $childrenByParent): array
{
    $result = [];
    $queue = $rootUids;
    $seen = [];
    while ($queue !== []) {
        $uid = (int)array_shift($queue);
        if ($uid < 1 || isset($seen[$uid])) {
            continue;
        }
        $seen[$uid] = true;
        if (!isset($pagesByUid[$uid])) {
            continue;
        }
        $result[] = $pagesByUid[$uid];
        foreach ($childrenByParent[$uid] ?? [] as $childUid) {
            $queue[] = (int)$childUid;
        }
    }
    return $result;
}

function fail(string $message): never
{
    fwrite(STDERR, $message . "\n");
    exit(64);
}
