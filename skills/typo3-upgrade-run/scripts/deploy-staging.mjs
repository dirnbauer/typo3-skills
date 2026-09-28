#!/usr/bin/env node
/**
 * Deploy an upgrade branch to a staging host, and only to a staging host.
 *
 * Standing rule: upgrade runs publish to staging, never to live. A host passes only when
 *   - its Deployer stage label is staging, stage, testing, test, development or dev, AND
 *   - its hostname starts with staging., stage., testing., test. or dev., AND
 *   - no production-labelled host shares its hostname or deploy_path.
 * Everything else is refused before Deployer starts (exit 5).
 *
 * Platform preflight: the staging database and CLI PHP must run the target TYPO3 major, taken from
 * typo3/cms-core in composer.lock. Both are read over SSH and read-only: the `-- Server version`
 * line of a header-only `database:export -e '*'` (no table data) and `php -r 'echo PHP_VERSION;'`.
 * TYPO3 13/14 on MariaDB 10.3 installs cleanly and then fails with SQL syntax errors, so a platform
 * below the target is refused (exit 6), and so is a check that cannot run. The web (FPM) PHP is not
 * reachable this way and is recorded as unmeasured. `--skip-platform-check "<reason>"` records why.
 *
 *   node deploy-staging.mjs --project <dir> --host <alias> [--branch <branch>] [--record <file>] [--dry-run]
 *        [--hosts-file <file>] [--composer-lock <file>] [--skip-platform-check "<reason>"]
 *
 * Runs `php vendor/bin/dep deploy <alias> [-o branch=<branch>]` from the project on this machine,
 * using its SSH keys. The record file captures host, branch, commit, platform, time and exit code.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { checkedHost, readHosts, remotePaths, sshArgs, sshTarget } from './pull-live-dataset.mjs';

const STAGING_LABELS = new Set(['staging', 'stage', 'testing', 'test', 'development', 'dev']);
const PRODUCTION_LABELS = /^(prod|production|live|www|master|main)$/i;
const STAGING_HOSTNAME = /^(staging|stage|testing|test|dev)\./i;

const range = (min, max) => Object.freeze({ min, max });
/** Declared support per TYPO3 major: get.typo3.org /api/v1/major/<n>, requirements. */
export const PLATFORM_REQUIREMENTS = Object.freeze({
  12: Object.freeze({ mariadb: range('10.3.0', '10.99.99'), mysql: range('8.0.17', '8.99.99'), php: range('8.1.0', '8.4.99') }),
  13: Object.freeze({ mariadb: range('10.4.3', '10.99.99'), mysql: range('8.0.17', '8.99.99'), php: range('8.2.0', '8.5.99') }),
  14: Object.freeze({ mariadb: range('10.4.3', '10.99.99'), mysql: range('8.0.17', '8.99.99'), php: range('8.2.0', '8.5.99') }),
});
export const WEB_PHP_UNMEASURED = 'not measured: SSH reaches the CLI binary only; read the vhost PHP (FPM) in the hosting panel';
const LABELS = Object.freeze({ mariadb: 'MariaDB', mysql: 'MySQL', php: 'PHP' });

export function stagingVerdict(host, allHosts) {
  const reasons = [];
  const label = String(host.stage ?? '').trim().toLowerCase();
  if (!STAGING_LABELS.has(label)) reasons.push(`stage label "${host.stage || 'none'}" is not a staging label`);
  if (!STAGING_HOSTNAME.test(host.hostname)) reasons.push(`hostname ${host.hostname} does not start with staging./stage./testing./test./dev.`);
  const production = allHosts.filter((h) => h !== host && (PRODUCTION_LABELS.test(String(h.stage ?? '')) || !STAGING_LABELS.has(String(h.stage ?? '').toLowerCase())));
  for (const other of production) {
    if (other.hostname === host.hostname) reasons.push(`shares hostname with non-staging host ${other.alias}`);
    if (other.deployPath && other.deployPath === host.deployPath) reasons.push(`shares deploy_path with non-staging host ${other.alias}`);
  }
  return { allowed: reasons.length === 0, reasons };
}

export function deployCommand(alias, branch) {
  if (!/^[A-Za-z0-9._-]+$/.test(alias)) throw new Error('Unsafe host alias.');
  const args = ['vendor/bin/dep', 'deploy', alias];
  if (branch) {
    if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.startsWith('-')) throw new Error('Unsafe branch name.');
    args.push('-o', `branch=${branch}`);
  }
  return ['php', args];
}

/**
 * `10.3.39-MariaDB-cll-lve`, `10.11.8-MariaDB-log`, `8.0.36` or `5.7.44-log`. A MySQL client
 * reports an old MariaDB as `5.5.5-10.x.y-MariaDB`; the prefix is the protocol, not the server.
 */
export function parseServerVersion(text) {
  const raw = String(text ?? '').trim().replace(/^5\.5\.5-(?=\d+\.\d+\.\d+-\S*mariadb)/i, '');
  const match = raw.match(/^(\d+)\.(\d+)\.(\d+)(\S*)/);
  if (!match) return null;
  return { engine: /mariadb/i.test(match[4]) ? 'mariadb' : 'mysql', version: match.slice(1, 4).join('.') };
}

export function compareVersions(a, b) {
  const [x, y] = [a, b].map((v) => String(v).split('.').map((n) => Number.parseInt(n, 10) || 0));
  for (let i = 0; i < 3; i += 1) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0) ? -1 : 1;
  return 0;
}

/** Pure: does this database server and CLI PHP satisfy the declared support of the target major? */
export function platformVerdict({ coreMajor, dbServerVersion, phpVersion }) {
  const target = PLATFORM_REQUIREMENTS[coreMajor];
  if (!target) return { allowed: false, reasons: [`no platform requirements are known for TYPO3 ${coreMajor ?? 'unknown'}`] };
  const reasons = [];
  const check = (kind, version) => {
    const { min, max } = target[kind];
    if (compareVersions(version, min) < 0) reasons.push(`${LABELS[kind]} ${version} is below TYPO3 ${coreMajor}'s minimum ${min}`);
    else if (compareVersions(version, max) > 0) reasons.push(`${LABELS[kind]} ${version} is above TYPO3 ${coreMajor}'s supported maximum ${max}`);
  };
  const db = parseServerVersion(dbServerVersion);
  if (db) check(db.engine, db.version);
  else reasons.push(`database server version "${String(dbServerVersion ?? '')}" is not a MySQL or MariaDB version`);
  const php = String(phpVersion ?? '').trim().split(/\s+/).pop().match(/^\d+\.\d+\.\d+/)?.[0];
  if (php) check('php', php);
  else reasons.push(`CLI PHP version "${String(phpVersion ?? '')}" is unreadable`);
  return { allowed: reasons.length === 0, reasons };
}

/** typo3/cms-core as locked: the version the deploy installs. */
export function lockedCore(lockText) {
  const lock = JSON.parse(lockText);
  const core = [...(lock.packages ?? []), ...(lock['packages-dev'] ?? [])].find((p) => p?.name === 'typo3/cms-core');
  const version = String(core?.version ?? '').replace(/^v/, '');
  const major = Number.parseInt(version, 10);
  return Number.isInteger(major) ? { version, major } : null;
}

/** Read-only: the CLI PHP, and a dump header only (`-e '*'` excludes every table). */
export function platformCommands(host) {
  return {
    php: `${host.php} -r 'echo PHP_VERSION;'`,
    db: `cd ${remotePaths(host).current} && ${host.php} ${host.typo3Bin} database:export -e '*' | head -8`,
  };
}

/** Target from the lock, platform from the server. A check that cannot run refuses, never passes. */
export function platformCheck({ host, composerLock, run = execFileSync }) {
  const facts = { checked: true, target_core: null, db_server: null, db: null, cli_php: null, web_php: WEB_PHP_UNMEASURED,
    requirements: null, verdict: null, error: null };
  try {
    const core = lockedCore(readFileSync(composerLock, 'utf8'));
    if (!core) throw new Error(`no typo3/cms-core version in ${composerLock}`);
    facts.target_core = core.version;
    facts.requirements = PLATFORM_REQUIREMENTS[core.major] ?? null;
    const commands = platformCommands(checkedHost(host));
    const ssh = (command) => {
      try { return String(run('ssh', sshArgs(host, command), { encoding: 'utf8', timeout: 120000 })); }
      catch (failure) {
        const detail = String(failure.stderr ?? '').trim().split('\n').pop() || failure.message.split('\n')[0];
        throw new Error(`ssh ${sshTarget(host)} "${command}" failed: ${detail}`);
      }
    };
    facts.cli_php = ssh(commands.php).trim();
    facts.db_server = ssh(commands.db).match(/^--\s*Server version\s+(.+?)\s*$/m)?.[1] ?? null;
    if (!facts.db_server) throw new Error(`no "-- Server version" line in the dump header of ${remotePaths(host).current}`);
    facts.db = parseServerVersion(facts.db_server);
    facts.verdict = platformVerdict({ coreMajor: core.major, dbServerVersion: facts.db_server, phpVersion: facts.cli_php });
  } catch (error) {
    facts.error = error.message;
    facts.verdict = { allowed: false, reasons: [`the platform check failed: ${facts.error}`] };
  }
  return facts;
}

export function deployStaging({ project, hostName, hostsFile = path.join(project, '.hosts.yaml'),
  composerLock = path.join(project, 'composer.lock'), branch, record, dryRun = false, skipPlatformCheck = null,
  run = execFileSync, spawn = spawnSync, log = (line) => process.stdout.write(`${line}\n`), error = (line) => process.stderr.write(`${line}\n`) }) {
  const hosts = readHosts(readFileSync(hostsFile, 'utf8'));
  const host = hosts.find((h) => h.alias === hostName);
  if (!host) {
    error(`deploy-staging: no host alias ${hostName} in ${hostsFile}.`);
    return 1;
  }
  const verdict = stagingVerdict(host, hosts);
  if (!verdict.allowed) {
    error(`deploy-staging: REFUSED ${host.alias}: ${verdict.reasons.join('; ')}. Upgrade runs never publish to live.`);
    return 5;
  }
  const [command, args] = deployCommand(host.alias, branch);
  const platform = skipPlatformCheck
    ? { checked: false, skipped_reason: skipPlatformCheck, web_php: WEB_PHP_UNMEASURED }
    : { composer_lock: path.relative(project, path.resolve(composerLock)), ...platformCheck({ host, composerLock, run }) };
  let head = null;
  try { head = String(run('git', ['-C', project, 'rev-parse', 'HEAD'], { encoding: 'utf8' })).trim(); } catch { /* evidence only */ }
  const facts = { schema: 'typo3-upgrade-run/staging-deploy@1', host: host.alias, hostname: host.hostname, stage: host.stage,
    branch: branch ?? host.branch, local_head: head, dry_run: dryRun, platform };
  const save = (result) => {
    if (record) writeFileSync(record, `${JSON.stringify(result, null, 2)}\n`);
    return result;
  };
  if (platform.checked && !platform.verdict.allowed) {
    save({ ...facts, deployed: false, exit_code: null });
    const why = platform.error ? 'the check could not run; fix it or pass --skip-platform-check "<reason>"'
      : `staging cannot run TYPO3 ${platform.target_core}; upgrade the hosting first, a deploy would install and then fail`;
    error(`deploy-staging: REFUSED ${host.alias}: ${platform.verdict.reasons.join('; ')}. Platform: ${why}.`);
    return 6;
  }
  log(platform.checked
    ? `Platform for TYPO3 ${platform.target_core}: database ${platform.db_server}, CLI PHP ${platform.cli_php}; allowed. Web PHP ${WEB_PHP_UNMEASURED}.`
    : `Platform check skipped: ${skipPlatformCheck}. Web PHP ${WEB_PHP_UNMEASURED}.`);
  if (dryRun) {
    save({ ...facts, deployed: false, exit_code: null });
    log(`[dry-run] allowed staging host ${host.alias} (${host.stage}): ${command} ${args.join(' ')}`);
    return 0;
  }
  const started = new Date().toISOString();
  const result = spawn(command, args, { cwd: project, stdio: 'inherit' });
  const done = save({ ...facts, deployed: result.status === 0, started_at: started, finished_at: new Date().toISOString(),
    exit_code: result.status });
  log(JSON.stringify(done, null, 2));
  return result.status === 0 ? 0 : 1;
}

async function main(argv) {
  const { values } = parseArgs({ args: argv, options: {
    project: { type: 'string', default: '.' }, host: { type: 'string' }, branch: { type: 'string' },
    record: { type: 'string' }, 'dry-run': { type: 'boolean', default: false }, 'hosts-file': { type: 'string' },
    'composer-lock': { type: 'string' }, 'skip-platform-check': { type: 'string' },
  } });
  if (!values.host || values['skip-platform-check']?.trim() === '') {
    process.stderr.write('Usage: deploy-staging.mjs --project <dir> --host <alias> [--branch <branch>] [--record <file>] [--dry-run]\n'
      + '         [--hosts-file <file>] [--composer-lock <file>] [--skip-platform-check "<reason>"]\n');
    return 2;
  }
  return deployStaging({ project: path.resolve(values.project), hostName: values.host, hostsFile: values['hosts-file'],
    composerLock: values['composer-lock'], branch: values.branch, record: values.record, dryRun: values['dry-run'],
    skipPlatformCheck: values['skip-platform-check']?.trim() || null });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await main(process.argv.slice(2));
}
