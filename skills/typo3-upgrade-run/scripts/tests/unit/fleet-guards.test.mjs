import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import {
  PLATFORM_REQUIREMENTS, deployCommand, deployStaging, lockedCore, parseServerVersion, platformCommands, platformVerdict, stagingVerdict,
} from '../../deploy-staging.mjs';
import { localFileadmin, pullLiveDataset, readHosts, remoteExportCommand, rsyncArgs, selectHost, sshArgs } from '../../pull-live-dataset.mjs';

const HOSTS = `
config:
  repository: git@gitlab.example.com:sites/demo.git
hosts:
  staging.demo.at:
    bin/php: /opt/plesk/php/8.4/bin/php
    hostname: staging.demo.at
    port: 22
    branch: develop
    remote_user: demo
    deploy_path: /var/www/vhosts/demo.at/staging.demo.at/public
    labels:
      stage: development
  www.demo.at:
    bin/php: /opt/plesk/php/8.4/bin/php
    hostname: www.demo.at
    port: 22
    branch: main
    remote_user: demo
    deploy_path: /var/www/vhosts/demo.at/httpdocs/public
    labels:
      stage: production
`;
// What the read-only preflight prints on a healthy server: facts, then the NUL-separated file list.
const PREFLIGHT = (release, files) => ['release=' + release, 'current=ok', 'typo3_bin=ok', 'php=ok', 'fileadmin=ok', 'files']
  .map((line) => `t3u:${line}\n`).join('') + files.map((file) => `./${file}\0`).join('');

test('Deployer hosts are parsed with stage labels, users and paths', () => {
  const hosts = readHosts(HOSTS);
  assert.deepEqual(hosts.map((h) => [h.alias, h.stage, h.branch]), [['staging.demo.at', 'development', 'develop'], ['www.demo.at', 'production', 'main']]);
  assert.equal(selectHost(hosts, 'www.demo.at').deployPath, '/var/www/vhosts/demo.at/httpdocs/public');
  assert.throws(() => selectHost(hosts, 'nope.demo.at'), /exactly one host/);
  assert.throws(() => selectHost(readHosts(HOSTS.replace('remote_user: demo\n    deploy_path: /var/www/vhosts/demo.at/httpdocs/public', 'remote_user: demo\n    deploy_path: /tmp; rm -rf /')), 'www.demo.at'), /unsafe/);
});

test('only a staging host passes the deploy guard; live hosts and lookalikes are refused', () => {
  const hosts = readHosts(HOSTS);
  assert.deepEqual(stagingVerdict(hosts[0], hosts), { allowed: true, reasons: [] });
  const live = stagingVerdict(hosts[1], hosts);
  assert.equal(live.allowed, false);
  assert.ok(live.reasons.some((r) => r.includes('not a staging label')));
  const lookalike = { ...hosts[0], alias: 'x', hostname: 'www.demo.at' };
  assert.equal(stagingVerdict(lookalike, [...hosts, lookalike]).allowed, false);
  const sharedPath = { ...hosts[0], alias: 'staging2.demo.at', hostname: 'staging.demo.at', deployPath: hosts[1].deployPath };
  assert.ok(stagingVerdict(sharedPath, [...hosts, sharedPath]).reasons.some((r) => r.includes('deploy_path')));
  assert.deepEqual(deployCommand('staging.demo.at', 'feature/typo3-14.3'), ['php', ['vendor/bin/dep', 'deploy', 'staging.demo.at', '-o', 'branch=feature/typo3-14.3']]);
  assert.throws(() => deployCommand('staging.demo.at', '--force'), /Unsafe branch/);
});

test('the local fileadmin that gets deleted is always <project>/<webroot>/fileadmin and never a link', () => {
  const project = mkdtempSync(path.join(os.tmpdir(), 'fleet-fa-'));
  try {
    assert.equal(localFileadmin(project, 'public'), path.join(project, 'public', 'fileadmin'));
    assert.throws(() => localFileadmin(project, '../..'), /Refusing to delete/);
    mkdirSync(path.join(project, 'elsewhere'), { recursive: true });
    mkdirSync(path.join(project, 'web'), { recursive: true });
    symlinkSync(path.join(project, 'elsewhere'), path.join(project, 'web', 'fileadmin'));
    assert.throws(() => localFileadmin(project, 'web'), /symlink/);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('a live sync deletes the local fileadmin first, mirrors the server and compares counts', async () => {
  const project = mkdtempSync(path.join(os.tmpdir(), 'fleet-pull-'));
  try {
    writeFileSync(path.join(project, '.hosts.yaml'), HOSTS);
    mkdirSync(path.join(project, 'public', 'fileadmin', 'old'), { recursive: true });
    writeFileSync(path.join(project, 'public', 'fileadmin', 'old', 'stale.pdf'), 'stale');
    const calls = [];
    const run = (command, args) => {
      calls.push(command);
      if (command === 'ssh') return PREFLIGHT('releases/23', ['user_upload/a.jpg', 'b.pdf']);
      // Fake rsync: the server holds two files; stale.pdf must already be gone.
      assert.equal(existsSync(path.join(project, 'public', 'fileadmin', 'old', 'stale.pdf')), false, 'delete happens before rsync');
      const target = args[args.length - 1];
      mkdirSync(path.join(target, 'user_upload'), { recursive: true });
      writeFileSync(path.join(target, 'user_upload', 'a.jpg'), 'a');
      writeFileSync(path.join(target, 'b.pdf'), 'b');
      return '';
    };
    const out = path.join(project, 'dataset');
    const manifest = await pullLiveDataset({ project, hostName: 'www.demo.at', out, skipDb: true, run, log: () => {} });
    assert.deepEqual(calls, ['ssh', 'rsync']);
    assert.equal(manifest.files.deleted_local_first, true);
    assert.deepEqual([manifest.files.remote_count, manifest.files.local_count], [2, 2]);
    assert.equal(manifest.release, '23');
    assert.equal(JSON.parse(readFileSync(path.join(out, 'live-dataset.json'), 'utf8')).read_only_on_server, true);
    assert.ok(rsyncArgs(readHosts(HOSTS)[1], 'public', 'x').includes('_processed_/'));

    const mismatch = (command, args) => (command === 'ssh' ? PREFLIGHT('releases/23', ['a', 'b', 'c', 'd', 'e']) : run(command, args));
    await assert.rejects(pullLiveDataset({ project, hostName: 'www.demo.at', out, skipDb: true, run: mismatch, log: () => {} }), /count mismatch/);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

const SURF = (extra = {}) => stringifyYaml({ hosts: { 'surf-live': { hostname: 'surf-live', deploy_path: '/var/www/demo/surf',
  'bin/php': 'php8.3', current_path: 'releases/current', fileadmin_path: 'shared/Data/fileadmin', typo3_bin: 'app/vendor/bin/typo3',
  labels: { stage: 'production' }, ...extra } } });

test('a hand-written hosts file reaches a Surf layout through an ssh-config alias', async () => {
  const project = mkdtempSync(path.join(os.tmpdir(), 'fleet-surf-'));
  try {
    const hostsFile = path.join(project, 'surf-hosts.yaml');
    writeFileSync(hostsFile, SURF());
    const host = selectHost(readHosts(SURF()), 'surf-live');
    assert.deepEqual([host.user, host.port], [null, null]);
    assert.equal(remoteExportCommand(host).split(' database:export')[0], 'cd /var/www/demo/surf/releases/current && php8.3 app/vendor/bin/typo3');
    // No user and no port: the alias's own ~/.ssh/config entry decides both.
    assert.deepEqual(sshArgs(host, 'true'), ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', '-o', 'LogLevel=ERROR', 'surf-live', 'true']);
    const rsync = rsyncArgs(host, 'app/public', 'local');
    assert.equal(rsync[rsync.indexOf('-e') + 1], 'ssh -o BatchMode=yes -o LogLevel=ERROR');
    assert.equal(rsync.at(-2), 'surf-live:/var/www/demo/surf/shared/Data/fileadmin/');
    // An explicit port still wins, with or without a user.
    const ported = selectHost(readHosts(SURF({ port: 2222 })), 'surf-live');
    assert.deepEqual(sshArgs(ported, 'true').slice(-4), ['-p', '2222', 'surf-live', 'true']);
    assert.ok(rsyncArgs(ported, 'public', 'x').includes('ssh -o BatchMode=yes -o LogLevel=ERROR -p 2222'));
    assert.deepEqual(sshArgs(readHosts(HOSTS)[1], 'true').slice(-4), ['-p', '22', 'demo@www.demo.at', 'true']);

    const calls = [];
    const run = (command, args) => {
      calls.push([command, args]);
      if (command === 'ssh') return PREFLIGHT('./20260928093000', ['a.pdf']);
      mkdirSync(args.at(-1), { recursive: true });
      writeFileSync(path.join(args.at(-1), 'a.pdf'), 'a');
      return '';
    };
    const lines = [];
    await pullLiveDataset({ project, hostName: 'surf-live', hostsFile, out: path.join(project, 'd'), webroot: 'app/public', dryRun: true, log: (l) => lines.push(l) });
    assert.ok(lines.some((l) => l.includes('surf-live cd /var/www/demo/surf/releases/current && php8.3 app/vendor/bin/typo3 database:export')));
    const manifest = await pullLiveDataset({ project, hostName: 'surf-live', hostsFile, out: path.join(project, 'd'), webroot: 'app/public',
      skipDb: true, run, log: () => {} });
    assert.equal(calls[0][1].at(-1), [
      'echo "t3u:release=$(readlink /var/www/demo/surf/releases/current)"',
      'if test -d /var/www/demo/surf/releases/current; then echo t3u:current=ok; else echo t3u:current=missing; fi',
      'if test -f /var/www/demo/surf/releases/current/app/vendor/bin/typo3; then echo t3u:typo3_bin=ok; else echo t3u:typo3_bin=missing; fi',
      'if command -v php8.3 >/dev/null 2>&1; then echo t3u:php=ok; else echo t3u:php=missing; fi',
      'if test -d /var/www/demo/surf/shared/Data/fileadmin; then echo t3u:fileadmin=ok; echo t3u:files; cd /var/www/demo/surf/shared/Data/fileadmin '
        + "&& find . -type f -not -path '*/_processed_/*' -not -path '*/_temp_/*' -print0; else echo t3u:fileadmin=missing; fi",
    ].join('; '));
    assert.equal(calls[1][1].at(-2), 'surf-live:/var/www/demo/surf/shared/Data/fileadmin/');
    assert.equal(calls[1][1].at(-1), `${path.join(project, 'app', 'public', 'fileadmin')}/`);
    assert.deepEqual([manifest.release, manifest.hosts_file, manifest.files.local_count], ['20260928093000', 'surf-hosts.yaml', 1]);
    assert.deepEqual(manifest.remote, { current: '/var/www/demo/surf/releases/current', fileadmin: '/var/www/demo/surf/shared/Data/fileadmin' });
    // Without --hosts-file the project's own .hosts.yaml is required.
    await assert.rejects(pullLiveDataset({ project, hostName: 'surf-live', out: path.join(project, 'd'), skipDb: true, run, log: () => {} }), /\.hosts\.yaml/);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('layout keys must stay relative to the deploy path and hosts cannot smuggle ssh options', () => {
  for (const [key, value] of [['current_path', '../current'], ['current_path', '/srv/other/current'], ['fileadmin_path', 'shared/../../etc'],
    ['fileadmin_path', '/var/www/other/fileadmin'], ['typo3_bin', '../../bin/typo3'], ['typo3_bin', '/usr/local/bin/typo3'],
    ['typo3_bin', 'vendor/bin/typo3 cache:flush'], ['current_path', 'releases/current; rm -rf ~'], ['typo3_bin', '-dauto_prepend_file=x']]) {
    assert.throws(() => selectHost(readHosts(SURF({ [key]: value })), 'surf-live'), new RegExp(`unsafe ${key}.*relative path`), `${key}: ${value}`);
  }
  assert.throws(() => selectHost(readHosts(SURF({ hostname: '-oProxyCommand=touch x' })), 'surf-live'), /unsafe hostname/);
  assert.throws(() => selectHost(readHosts(SURF({ remote_user: '-oProxyCommand=x' })), 'surf-live'), /unsafe user/);
  assert.throws(() => selectHost(readHosts(SURF({ port: '22 -oProxyCommand=x' })), 'surf-live'), /unsafe port/);
  assert.throws(() => selectHost(readHosts(SURF({ deploy_path: null })), 'surf-live'), /needs deploy_path/);
  // The derived Deployer default is checked the same way.
  assert.throws(() => rsyncArgs(readHosts(HOSTS)[1], 'public/../..', 'x'), /unsafe fileadmin_path/);
});

test('a dry run lists the delete before the sync and touches nothing', async () => {
  const project = mkdtempSync(path.join(os.tmpdir(), 'fleet-dry-'));
  try {
    writeFileSync(path.join(project, '.hosts.yaml'), HOSTS);
    mkdirSync(path.join(project, 'public', 'fileadmin'), { recursive: true });
    writeFileSync(path.join(project, 'public', 'fileadmin', 'keep.txt'), 'x');
    const lines = [];
    const result = await pullLiveDataset({ project, hostName: 'www.demo.at', out: path.join(project, 'd'), dryRun: true, log: (l) => lines.push(l) });
    assert.deepEqual(result.plan, ['preflight (read-only)', 'database export (read-only, streamed)', 'delete local fileadmin first', 'rsync fileadmin from server (read-only)']);
    assert.ok(existsSync(path.join(project, 'public', 'fileadmin', 'keep.txt')));
    assert.ok(lines.some((l) => l.includes('database:export')));
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

const LOCK = (version) => JSON.stringify({ packages: [{ name: 'typo3/cms-core', version }], 'packages-dev': [] });
const DUMP_HEAD = (server) => ['-- MariaDB dump 10.19  Distrib 10.11.8-MariaDB, for debian-linux-gnu (x86_64)', '--',
  '-- Host: localhost    Database: demo', '-- ------------------------------------------------------', `-- Server version\t${server}`, ''].join('\n');

test('the platform verdict holds a staging server to the declared support of the target major', () => {
  const v14 = (db, php = '8.4.13') => platformVerdict({ coreMajor: 14, dbServerVersion: db, phpVersion: php });
  assert.deepEqual(v14('10.11.8-MariaDB-log'), { allowed: true, reasons: [] });
  assert.deepEqual(v14('8.0.36'), { allowed: true, reasons: [] });
  assert.deepEqual(v14('10.4.3-MariaDB', '8.2.0'), { allowed: true, reasons: [] }, 'floors are inclusive');
  assert.deepEqual(v14('10.3.39-MariaDB-cll-lve'), { allowed: false, reasons: ["MariaDB 10.3.39 is below TYPO3 14's minimum 10.4.3"] });
  assert.deepEqual(v14('5.5.5-10.3.39-MariaDB-cll-lve').reasons, ["MariaDB 10.3.39 is below TYPO3 14's minimum 10.4.3"]);
  assert.deepEqual(v14('5.7.44-log').reasons, ["MySQL 5.7.44 is below TYPO3 14's minimum 8.0.17"]);
  assert.equal(v14('8.0.16').allowed, false);
  assert.equal(v14('10.4.2-MariaDB').allowed, false);
  assert.deepEqual(v14('11.4.2-MariaDB').reasons, ["MariaDB 11.4.2 is above TYPO3 14's supported maximum 10.99.99"]);
  assert.deepEqual(v14('10.11.8-MariaDB', '8.1.2-1ubuntu2.14').reasons, ["PHP 8.1.2 is below TYPO3 14's minimum 8.2.0"]);
  assert.deepEqual(v14('10.11.8-MariaDB', '8.5.1'), { allowed: true, reasons: [] });
  assert.deepEqual(v14('10.11.8-MariaDB', '8.6.0').reasons, ["PHP 8.6.0 is above TYPO3 14's supported maximum 8.5.99"]);
  assert.equal(v14('10.3.39-MariaDB', '8.1.0').reasons.length, 2);
  assert.equal(platformVerdict({ coreMajor: 13, dbServerVersion: '10.3.39-MariaDB-cll-lve', phpVersion: '8.3.14' }).allowed, false);
  assert.deepEqual(platformVerdict({ coreMajor: 12, dbServerVersion: '10.3.39-MariaDB-cll-lve', phpVersion: '8.1.29' }), { allowed: true, reasons: [] });
  assert.deepEqual(platformVerdict({ coreMajor: 12, dbServerVersion: '8.0.36', phpVersion: '8.5.0' }).reasons,
    ["PHP 8.5.0 is above TYPO3 12's supported maximum 8.4.99"]);
  // What cannot be read, or is not in the table, never passes.
  assert.equal(platformVerdict({ coreMajor: 11, dbServerVersion: '10.11.8-MariaDB', phpVersion: '8.2.0' }).allowed, false);
  assert.match(v14('PostgreSQL 16.2').reasons[0], /not a MySQL or MariaDB version/);
  assert.match(v14('10.11.8-MariaDB', '').reasons[0], /unreadable/);
  assert.deepEqual(['10.3.39-MariaDB-cll-lve', '10.11.8-MariaDB-log', '8.0.36', '5.7.44-log'].map(parseServerVersion), [
    { engine: 'mariadb', version: '10.3.39' }, { engine: 'mariadb', version: '10.11.8' },
    { engine: 'mysql', version: '8.0.36' }, { engine: 'mysql', version: '5.7.44' }]);
  assert.ok(Object.isFrozen(PLATFORM_REQUIREMENTS) && Object.isFrozen(PLATFORM_REQUIREMENTS[14]) && Object.isFrozen(PLATFORM_REQUIREMENTS[14].mariadb));
  assert.deepEqual(lockedCore(LOCK('v14.3.5')), { version: '14.3.5', major: 14 });
  assert.equal(lockedCore(JSON.stringify({ packages: [] })), null);
});

test('the staging platform is read over ssh, read-only, and a platform below the target refuses with exit 6', () => {
  const project = mkdtempSync(path.join(os.tmpdir(), 'fleet-platform-'));
  try {
    writeFileSync(path.join(project, '.hosts.yaml'), HOSTS);
    writeFileSync(path.join(project, 'composer.lock'), LOCK('v14.3.5'));
    const record = path.join(project, 'staging-deploy.json');
    let server = '10.3.39-MariaDB-cll-lve';
    const ssh = [], deploys = [], lines = [], errors = [];
    const run = (command, args) => {
      if (command === 'git') return 'abc123\n';
      ssh.push(args);
      return args.at(-1).includes('PHP_VERSION') ? '8.4.13' : DUMP_HEAD(server);
    };
    const spawn = (command, args) => { deploys.push([command, args]); return { status: 0 }; };
    const deploy = (extra = {}) => deployStaging({ project, hostName: 'staging.demo.at', branch: 'feature/typo3-14.3', record,
      run, spawn, log: (l) => lines.push(l), error: (l) => errors.push(l), ...extra });

    assert.equal(deploy(), 6);
    assert.deepEqual(deploys, [], 'nothing is deployed onto a platform below the target');
    assert.deepEqual(ssh.map((args) => args.slice(-4)), [
      ['-p', '22', 'demo@staging.demo.at', "/opt/plesk/php/8.4/bin/php -r 'echo PHP_VERSION;'"],
      ['-p', '22', 'demo@staging.demo.at', "cd /var/www/vhosts/demo.at/staging.demo.at/public/current && /opt/plesk/php/8.4/bin/php vendor/bin/typo3 database:export -e '*' | head -8"],
    ]);
    const refused = JSON.parse(readFileSync(record, 'utf8'));
    assert.deepEqual([refused.deployed, refused.platform.target_core, refused.platform.db_server, refused.platform.cli_php],
      [false, '14.3.5', '10.3.39-MariaDB-cll-lve', '8.4.13']);
    assert.deepEqual(refused.platform.verdict, { allowed: false, reasons: ["MariaDB 10.3.39 is below TYPO3 14's minimum 10.4.3"] });
    assert.match(refused.platform.web_php, /^not measured/);
    assert.match(errors[0], /REFUSED staging\.demo\.at: MariaDB 10\.3\.39 is below .*cannot run TYPO3 14\.3\.5/);

    server = '10.11.8-MariaDB-log';
    assert.equal(deploy({ dryRun: true }), 0);
    assert.deepEqual(deploys, []);
    const dry = JSON.parse(readFileSync(record, 'utf8'));
    assert.deepEqual([dry.dry_run, dry.platform.verdict.allowed, dry.platform.db, dry.local_head, dry.platform.composer_lock],
      [true, true, { engine: 'mariadb', version: '10.11.8' }, 'abc123', 'composer.lock']);
    assert.ok(lines.some((l) => l.includes('CLI PHP 8.4.13; allowed. Web PHP not measured')));
    assert.ok(lines.some((l) => l.startsWith('[dry-run] allowed staging host staging.demo.at')));
    assert.equal(deploy(), 0);
    assert.deepEqual(deploys, [['php', ['vendor/bin/dep', 'deploy', 'staging.demo.at', '-o', 'branch=feature/typo3-14.3']]]);
    assert.deepEqual(JSON.parse(readFileSync(record, 'utf8')).exit_code, 0);

    // A check that cannot run refuses too, and says so.
    const noRelease = (command, args) => {
      if (command === 'git') return 'abc123\n';
      if (!args.at(-1).startsWith('cd ')) return '8.4.13';
      throw Object.assign(new Error('Command failed: ssh'), { stderr: 'bash: line 1: cd: /var/www/vhosts/demo.at/staging.demo.at/public/current: No such file or directory\n' });
    };
    assert.equal(deploy({ run: noRelease }), 6);
    assert.match(errors.at(-1), /the platform check failed: ssh demo@staging\.demo\.at .*No such file or directory.*--skip-platform-check/);
    writeFileSync(path.join(project, 'composer.lock'), JSON.stringify({ packages: [] }));
    assert.equal(deploy({ dryRun: true }), 6);
    assert.match(JSON.parse(readFileSync(record, 'utf8')).platform.error, /no typo3\/cms-core version/);
    assert.equal(deploys.length, 1);

    // An explicit skip records its reason and never touches the server; live is refused before any check.
    ssh.length = 0;
    assert.equal(deploy({ dryRun: true, skipPlatformCheck: 'first deploy: no current release yet' }), 0);
    assert.deepEqual(JSON.parse(readFileSync(record, 'utf8')).platform,
      { checked: false, skipped_reason: 'first deploy: no current release yet', web_php: refused.platform.web_php });
    assert.equal(deploy({ hostName: 'www.demo.at' }), 5);
    assert.deepEqual(ssh, []);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('the platform preflight follows the layout keys of a hand-written hosts file', () => {
  const project = mkdtempSync(path.join(os.tmpdir(), 'fleet-platform-surf-'));
  try {
    const hostsFile = path.join(project, 'staging-hosts.yaml');
    writeFileSync(hostsFile, stringifyYaml({ hosts: { 'staging.surf-demo': { hostname: 'staging.surf-demo', deploy_path: '/var/www/demo/surf',
      current_path: 'releases/current', typo3_bin: 'app/vendor/bin/typo3', labels: { stage: 'staging' } } } }));
    mkdirSync(path.join(project, 'app'));
    writeFileSync(path.join(project, 'app', 'composer.lock'), LOCK('14.3.7'));
    const host = selectHost(readHosts(readFileSync(hostsFile, 'utf8')), 'staging.surf-demo');
    assert.deepEqual(platformCommands(host), { php: "php -r 'echo PHP_VERSION;'",
      db: "cd /var/www/demo/surf/releases/current && php app/vendor/bin/typo3 database:export -e '*' | head -8" });
    const ssh = [];
    const run = (command, args) => {
      if (command === 'git') throw new Error('not a git repository');
      ssh.push(args);
      return args.at(-1).includes('PHP_VERSION') ? '8.4.13' : DUMP_HEAD('10.11.8-MariaDB');
    };
    const record = path.join(project, 'platform.json');
    assert.equal(deployStaging({ project, hostName: 'staging.surf-demo', hostsFile, composerLock: path.join(project, 'app', 'composer.lock'),
      record, dryRun: true, run, spawn: () => assert.fail('dry run'), log: () => {}, error: () => {} }), 0);
    assert.ok(ssh.every((args) => !args.includes('-p') && args.at(-2) === 'staging.surf-demo'), 'an alias keeps its own user and port');
    const facts = JSON.parse(readFileSync(record, 'utf8'));
    assert.deepEqual([facts.local_head, facts.platform.composer_lock, facts.platform.target_core], [null, 'app/composer.lock', '14.3.7']);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
