#!/usr/bin/env node
/**
 * Pull a dated dataset (database + fileadmin) from a Deployer host. Read-only on the server.
 *
 * Standing rule: before any fileadmin sync from live, delete the local fileadmin first. The
 * local copy is then an exact mirror of the server and never a mix of old and new files.
 *
 *   1. Resolve the host from the project's Deployer `.hosts.yaml` (alias or hostname).
 *   2. Preflight over SSH (BatchMode): current release, shared fileadmin, remote file count.
 *   3. Database: `typo3 database:export` runs on the server and streams to a local .sql.gz;
 *      nothing is written on the server.
 *   4. fileadmin: delete the local <webroot>/fileadmin, then rsync from
 *      <deploy_path>/shared/<webroot>/fileadmin/ and compare the file counts.
 *   5. Write live-dataset.json (source, release, times, counts, SHA-256) as node evidence.
 *
 * Usage:
 *   node pull-live-dataset.mjs --project <dir> --host <alias|hostname> --out <dir>
 *        [--webroot public] [--skip-db] [--skip-files] [--include-processed] [--dry-run]
 *
 * Import afterwards is a separate stateful step: snapshot first, then `ddev import-db`.
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

/** Deployer 7 hosts file: `hosts: { alias: { hostname, port, remote_user, deploy_path, bin/php, labels } }`. */
export function readHosts(text) {
  const data = parseYaml(text) ?? {};
  const hosts = data.hosts ?? {};
  return Object.entries(hosts).map(([alias, h]) => ({
    alias,
    hostname: String(h?.hostname ?? alias),
    port: Number(h?.port ?? 22),
    user: h?.remote_user ?? h?.user ?? null,
    deployPath: h?.deploy_path ?? null,
    php: h?.['bin/php'] ?? 'php',
    branch: h?.branch ?? null,
    stage: String(h?.labels?.stage ?? h?.stage ?? ''),
  }));
}

export function selectHost(hosts, wanted) {
  const matches = hosts.filter((h) => h.alias === wanted || h.hostname === wanted);
  if (matches.length !== 1) throw new Error(`Expected exactly one host named ${wanted} in .hosts.yaml, found ${matches.length}.`);
  const host = matches[0];
  if (!host.user || !host.deployPath) throw new Error(`Host ${wanted} needs remote_user and deploy_path.`);
  for (const [field, value] of [['hostname', host.hostname], ['user', host.user], ['deploy_path', host.deployPath], ['bin/php', host.php]]) {
    if (!/^[A-Za-z0-9@%+=:,./ _-]+$/.test(String(value)) || /[;&|`$()<>]/.test(String(value))) {
      throw new Error(`Refusing unsafe ${field} for ${wanted}.`);
    }
  }
  return host;
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

export function sshArgs(host, command) {
  return ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', '-o', 'LogLevel=ERROR', '-p', String(host.port), `${host.user}@${host.hostname}`, command];
}

export function remoteExportCommand(host) {
  const excludes = DB_EXCLUDES.map((t) => `-e '${t}'`).join(' ');
  return `cd ${host.deployPath}/current && ${host.php} vendor/bin/typo3 database:export ${excludes}`;
}

export function rsyncArgs(host, webroot, local, { includeProcessed = false } = {}) {
  const excludes = includeProcessed ? [] : FILE_EXCLUDES.flatMap((e) => ['--exclude', e]);
  return ['-a', '--stats', ...excludes, '-e', `ssh -o BatchMode=yes -o LogLevel=ERROR -p ${host.port}`,
    `${host.user}@${host.hostname}:${host.deployPath}/shared/${webroot}/fileadmin/`, `${local}/`];
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

export async function pullLiveDataset({ project, hostName, out, webroot = 'public', skipDb = false, skipFiles = false,
  includeProcessed = false, dryRun = false, run = execFileSync, log = console.log }) {
  const hosts = readHosts(readFileSync(path.join(project, '.hosts.yaml'), 'utf8'));
  const host = selectHost(hosts, hostName);
  const local = localFileadmin(project, webroot);
  const plan = [];
  const ssh = (command) => ['ssh', sshArgs(host, command)];
  const preflight = `readlink ${host.deployPath}/current; find ${host.deployPath}/shared/${webroot}/fileadmin -type f ${includeProcessed ? '' : "-not -path '*/_processed_/*' -not -path '*/_temp_/*'"} | wc -l`;
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
    stage: host.stage, release: releaseLine?.split('/').pop() ?? null, pulled_at: new Date().toISOString(),
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
  log(`Dataset written to ${out}. Next: snapshot, then ddev import-db --file=${path.join(out, 'db.sql.gz')}`);
  return manifest;
}

async function main(argv) {
  const { values } = parseArgs({ args: argv, options: {
    project: { type: 'string', default: '.' }, host: { type: 'string' }, out: { type: 'string' },
    webroot: { type: 'string', default: 'public' }, 'skip-db': { type: 'boolean', default: false },
    'skip-files': { type: 'boolean', default: false }, 'include-processed': { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
  } });
  if (!values.host || (!values.out && !values['dry-run'])) {
    process.stderr.write('Usage: pull-live-dataset.mjs --project <dir> --host <alias> --out <dir> [--dry-run]\n');
    return 2;
  }
  try {
    const result = await pullLiveDataset({ project: values.project, hostName: values.host, out: values.out,
      webroot: values.webroot, skipDb: values['skip-db'], skipFiles: values['skip-files'],
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
