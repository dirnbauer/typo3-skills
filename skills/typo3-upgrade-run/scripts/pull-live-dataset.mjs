#!/usr/bin/env node
/**
 * Pull a dated dataset (database + fileadmin) from a Deployer host, or from any host described in
 * the same YAML shape. Read-only on the server.
 *
 * Standing rule: before any fileadmin sync from live, delete the local fileadmin first. The
 * local copy is then an exact mirror of the server and never a mix of old and new files.
 *
 *   1. Resolve the host from the project's Deployer `.hosts.yaml` (alias or hostname), or from a
 *      hand-written read-only hosts file (`--hosts-file`) for a project without one.
 *   2. Preflight over SSH (BatchMode): current release, shared fileadmin, remote file count.
 *   3. Database: `typo3 database:export` runs on the server and streams to a local .sql.gz;
 *      nothing is written on the server.
 *   4. fileadmin: delete the local <webroot>/fileadmin, then rsync from
 *      <deploy_path>/<fileadmin_path>/ and compare the file counts.
 *   5. Write live-dataset.json (source, release, times, counts, SHA-256) as node evidence.
 *
 * Optional host keys beyond Deployer's, all relative paths without "..":
 *   current_path    current release below deploy_path   default current (Surf: releases/current)
 *   fileadmin_path  shared fileadmin below deploy_path  default shared/<webroot>/fileadmin
 *   typo3_bin       CLI below the current release       default vendor/bin/typo3 (Surf app/: app/vendor/bin/typo3)
 * Without remote_user the target is the bare hostname, so an ~/.ssh/config alias supplies user,
 * port and key. -p is passed only for an explicit port, never over the alias's own.
 *
 * Usage:
 *   node pull-live-dataset.mjs --project <dir> --host <alias|hostname> --out <dir> [--hosts-file <file>]
 *        [--webroot public] [--skip-db] [--skip-files] [--include-processed] [--dry-run]
 *
 * Import afterwards is a separate stateful step: snapshot first, then `ddev import-db`, then
 * `typo3 extension:setup`, because the excluded cache tables are not in the dump at all.
 */

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createGzip } from 'node:zlib';
import { parse as parseYaml } from 'yaml';

export const SCHEMA = 'typo3-upgrade-run/live-dataset@1';
export const DB_EXCLUDES = Object.freeze(['cache_*', 'cf_*', 'be_sessions', 'fe_sessions', 'sys_lockedrecords', 'sys_log', 'sys_http_report']);
export const FILE_EXCLUDES = Object.freeze(['_processed_/', '_temp_/']);

/**
 * Deployer 7 hosts file: `hosts: { alias: { hostname, port, remote_user, deploy_path, bin/php, labels } }`,
 * plus the optional layout keys current_path, fileadmin_path and typo3_bin.
 */
export function readHosts(text) {
  const data = parseYaml(text) ?? {};
  const hosts = data.hosts ?? {};
  return Object.entries(hosts).map(([alias, h]) => ({
    alias,
    hostname: String(h?.hostname ?? alias),
    port: h?.port == null ? null : Number(h.port),
    user: h?.remote_user ?? h?.user ?? null,
    deployPath: h?.deploy_path ?? null,
    php: h?.['bin/php'] ?? 'php',
    currentPath: String(h?.current_path ?? 'current'),
    fileadminPath: h?.fileadmin_path == null ? null : String(h.fileadmin_path),
    typo3Bin: String(h?.typo3_bin ?? 'vendor/bin/typo3'),
    branch: h?.branch ?? null,
    stage: String(h?.labels?.stage ?? h?.stage ?? ''),
  }));
}

export function selectHost(hosts, wanted) {
  const matches = hosts.filter((h) => h.alias === wanted || h.hostname === wanted);
  if (matches.length !== 1) throw new Error(`Expected exactly one host named ${wanted} in the hosts file, found ${matches.length}.`);
  return checkedHost(matches[0], wanted);
}

const unsafe = (value) => !/^[A-Za-z0-9@%+=:,./ _-]+$/.test(String(value)) || /[;&|`$()<>]/.test(String(value));

/** Every host value reaches an ssh/rsync argument or a remote shell command. */
export function checkedHost(host, wanted = host.alias) {
  if (!host.deployPath) throw new Error(`Host ${wanted} needs deploy_path.`);
  const fields = [['hostname', host.hostname], ['deploy_path', host.deployPath], ['bin/php', host.php]];
  if (host.user !== null) fields.push(['user', host.user]);
  for (const [field, value] of fields) {
    // A leading dash would turn the ssh target into an option.
    if (unsafe(value) || (['hostname', 'user'].includes(field) && String(value).startsWith('-'))) {
      throw new Error(`Refusing unsafe ${field} for ${wanted}.`);
    }
  }
  if (host.port !== null && !(Number.isInteger(host.port) && host.port > 0 && host.port < 65536)) {
    throw new Error(`Refusing unsafe port for ${wanted}.`);
  }
  for (const [field, value] of [['current_path', host.currentPath], ['fileadmin_path', host.fileadminPath], ['typo3_bin', host.typo3Bin]]) {
    if (value !== null) relativePath(field, value, wanted);
  }
  return host;
}

function relativePath(field, value, wanted) {
  if (unsafe(value) || /\s/.test(value) || value.startsWith('/') || value.startsWith('-') || value.split('/').includes('..')) {
    throw new Error(`Refusing unsafe ${field} for ${wanted}: it must be a relative path without "..".`);
  }
  return value;
}

/** The current release and the shared fileadmin on the server. */
export function remotePaths(host, webroot = 'public') {
  const fileadmin = relativePath('fileadmin_path', host.fileadminPath ?? `shared/${webroot}/fileadmin`, host.alias);
  return { current: `${host.deployPath}/${host.currentPath}`, fileadmin: `${host.deployPath}/${fileadmin}` };
}

/** The local fileadmin that will be deleted: must be <project>/<webroot>/fileadmin, never elsewhere. */
export function localFileadmin(project, webroot) {
  const root = path.resolve(project);
  const target = path.resolve(root, webroot, 'fileadmin');
  if (!target.startsWith(root + path.sep) || path.basename(target) !== 'fileadmin') {
    throw new Error(`Refusing to delete ${target}: not <project>/<webroot>/fileadmin.`);
  }
  if (existsSync(target) && lstatSync(target).isSymbolicLink()) {
    throw new Error(`${target} is a symlink. Resolve it explicitly before a sync; the delete-first rule never follows links.`);
  }
  return target;
}

/** `user@hostname`, or the bare hostname so an ~/.ssh/config alias supplies user, port and key. */
export function sshTarget(host) {
  return host.user ? `${host.user}@${host.hostname}` : host.hostname;
}

export function sshArgs(host, command) {
  const port = host.port ? ['-p', String(host.port)] : [];
  return ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', '-o', 'LogLevel=ERROR', ...port, sshTarget(host), command];
}

export function remoteExportCommand(host) {
  const excludes = DB_EXCLUDES.map((t) => `-e '${t}'`).join(' ');
  return `cd ${remotePaths(host).current} && ${host.php} ${host.typo3Bin} database:export ${excludes}`;
}

export function rsyncArgs(host, webroot, local, { includeProcessed = false } = {}) {
  const excludes = includeProcessed ? [] : FILE_EXCLUDES.flatMap((e) => ['--exclude', e]);
  return ['-a', '--stats', ...excludes, '-e', `ssh -o BatchMode=yes -o LogLevel=ERROR${host.port ? ` -p ${host.port}` : ''}`,
    `${sshTarget(host)}:${remotePaths(host, webroot).fileadmin}/`, `${local}/`];
}

export function countFiles(dir, { includeProcessed = false } = {}) {
  let files = 0, bytes = 0;
  const walk = (current, rel) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (!includeProcessed && entry.isDirectory() && FILE_EXCLUDES.includes(`${childRel}/`)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full, childRel);
      else if (entry.isFile()) { files += 1; bytes += statSync(full).size; }
    }
  };
  if (existsSync(dir)) walk(dir, '');
  return { files, bytes };
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file).on('data', (c) => hash.update(c)).on('end', () => resolve(hash.digest('hex'))).on('error', reject);
  });
}

function streamToGzip(command, args, outFile) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = createWriteStream(outFile);
    let stderr = '';
    let exitCode = null, flushed = false;
    const settle = () => {
      if (exitCode === null || !flushed) return;
      if (exitCode === 0) resolve();
      else reject(new Error(`Remote export failed (exit ${exitCode}): ${stderr.trim().slice(0, 400)}`));
    };
    child.stderr.on('data', (d) => { stderr = (stderr + d.toString()).slice(-2000); });
    child.stdout.pipe(createGzip()).pipe(out);
    child.on('error', reject);
    child.on('close', (code) => { exitCode = code ?? 1; settle(); });
    out.on('finish', () => { flushed = true; settle(); });
    out.on('error', reject);
  });
}

export async function pullLiveDataset({ project, hostName, out, hostsFile = path.join(project, '.hosts.yaml'), webroot = 'public',
  skipDb = false, skipFiles = false, includeProcessed = false, dryRun = false, run = execFileSync, log = console.log }) {
  const hosts = readHosts(readFileSync(hostsFile, 'utf8'));
  const host = selectHost(hosts, hostName);
  const local = localFileadmin(project, webroot);
  const remote = remotePaths(host, webroot);
  const plan = [];
  const ssh = (command) => ['ssh', sshArgs(host, command)];
  const preflight = `readlink ${remote.current}; find ${remote.fileadmin} -type f ${includeProcessed ? '' : "-not -path '*/_processed_/*' -not -path '*/_temp_/*'"} | wc -l`;
  plan.push({ step: 'preflight (read-only)', cmd: ssh(preflight) });
  if (!skipDb) plan.push({ step: 'database export (read-only, streamed)', cmd: ssh(remoteExportCommand(host)) });
  if (!skipFiles) {
    plan.push({ step: 'delete local fileadmin first', cmd: ['rm', ['-rf', local]] });
    plan.push({ step: 'rsync fileadmin from server (read-only)', cmd: ['rsync', rsyncArgs(host, webroot, local, { includeProcessed })] });
  }
  if (dryRun) {
    for (const p of plan) log(`[dry-run] ${p.step}: ${p.cmd[0]} ${p.cmd[1].join(' ')}`);
    return { dryRun: true, host: host.alias, plan: plan.map((p) => p.step) };
  }

  mkdirSync(out, { recursive: true });
  const [releaseLine, countLine] = run('ssh', sshArgs(host, preflight), { encoding: 'utf8', timeout: 120000 }).trim().split('\n');
  const manifest = {
    schema: SCHEMA, project: path.basename(path.resolve(project)), host: host.alias, hostname: host.hostname,
    stage: host.stage, hosts_file: path.relative(path.resolve(project), path.resolve(hostsFile)),
    release: releaseLine?.split('/').pop() ?? null, remote, pulled_at: new Date().toISOString(),
    read_only_on_server: true, db: null, files: null,
  };
  if (!skipDb) {
    const dbFile = path.join(out, 'db.sql.gz');
    log(`Exporting database from ${host.hostname} (read-only) …`);
    await streamToGzip('ssh', sshArgs(host, remoteExportCommand(host)), dbFile);
    manifest.db = { file: path.basename(dbFile), bytes: statSync(dbFile).size, sha256: `sha256:${await sha256File(dbFile)}`, excluded_tables: DB_EXCLUDES };
  }
  if (!skipFiles) {
    log(`Deleting local ${local} before the sync …`);
    rmSync(local, { recursive: true, force: true });
    mkdirSync(local, { recursive: true });
    log(`Syncing fileadmin from ${host.hostname} (read-only) …`);
    run('rsync', rsyncArgs(host, webroot, local, { includeProcessed }), { stdio: 'inherit', timeout: 6 * 3600 * 1000 });
    const counted = countFiles(local, { includeProcessed });
    const remote = Number.parseInt(countLine ?? '', 10);
    manifest.files = { deleted_local_first: true, remote_count: remote, local_count: counted.files, bytes: counted.bytes,
      excluded: includeProcessed ? [] : FILE_EXCLUDES };
    if (!Number.isFinite(remote) || remote !== counted.files) {
      writeFileSync(path.join(out, 'live-dataset.json'), `${JSON.stringify(manifest, null, 2)}\n`);
      throw new Error(`fileadmin count mismatch: server ${countLine}, local ${counted.files}. The dataset is not usable.`);
    }
  }
  writeFileSync(path.join(out, 'live-dataset.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  log(`Dataset written to ${out}. Next: snapshot, ddev import-db --file=${path.join(out, 'db.sql.gz')}, `
    + 'then ddev exec vendor/bin/typo3 extension:setup (recreates the excluded cache tables) and cache:flush.');
  return manifest;
}

async function main(argv) {
  const { values } = parseArgs({ args: argv, options: {
    project: { type: 'string', default: '.' }, host: { type: 'string' }, out: { type: 'string' },
    'hosts-file': { type: 'string' }, webroot: { type: 'string', default: 'public' }, 'skip-db': { type: 'boolean', default: false },
    'skip-files': { type: 'boolean', default: false }, 'include-processed': { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
  } });
  if (!values.host || (!values.out && !values['dry-run'])) {
    process.stderr.write('Usage: pull-live-dataset.mjs --project <dir> --host <alias> --out <dir> [--hosts-file <file>] [--dry-run]\n');
    return 2;
  }
  try {
    const result = await pullLiveDataset({ project: values.project, hostName: values.host, out: values.out,
      hostsFile: values['hosts-file'], webroot: values.webroot, skipDb: values['skip-db'], skipFiles: values['skip-files'],
      includeProcessed: values['include-processed'], dryRun: values['dry-run'] });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`pull-live-dataset: ${error.message}\n`);
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await main(process.argv.slice(2));
}
