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
 *   2. Preflight over SSH (BatchMode), read-only: current release, what the export runs (release
 *      directory, typo3_bin, bin/php) and the shared fileadmin with its file list. A missing piece
 *      or an empty fileadmin refuses the pull (exit 5) before anything local changes: one run never
 *      deletes first and fails later.
 *   3. A case-insensitive local volume (the macOS default) keeps one of two remote names that
 *      differ only in case. Such names are listed and refused unless --accept-case-collisions
 *      names an evidence file, which live-dataset.json then records with its SHA-256.
 *   4. Database: `typo3 database:export` runs on the server and streams to a local .sql.gz;
 *      nothing is written on the server.
 *   5. fileadmin: delete the local <webroot>/fileadmin, then rsync from
 *      <deploy_path>/<fileadmin_path>/ and compare the file counts.
 *   6. Write live-dataset.json (source, release, times, counts, SHA-256) as node evidence.
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
 *        [--webroot <dir>] [--skip-db] [--skip-files] [--include-processed] [--dry-run]
 *   --webroot defaults to the project's web directory relative to --project: composer.json web-dir
 *   below the Composer root, else DDEV docroot (app/web with composer_root app/), else public.
 *        [--accept-case-collisions <evidence-file>]
 *
 * Import afterwards is a separate stateful step: snapshot first, then `ddev import-db`, then
 * `typo3 extension:setup`, because the excluded cache tables are not in the dump at all.
 */

import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createGzip } from 'node:zlib';
import { parse as parseYaml } from 'yaml';
import { isMain } from './lib/cli/is-main.mjs';
import { resolveProjectLayout } from './lib/run/project-layout.mjs';

export const SCHEMA = 'typo3-upgrade-run/live-dataset@1';
export const DB_EXCLUDES = Object.freeze(['cache_*', 'cf_*', 'be_sessions', 'fe_sessions', 'sys_lockedrecords', 'sys_log', 'sys_http_report']);
export const FILE_EXCLUDES = Object.freeze(['_processed_/', '_temp_/']);
// The fileadmin list arrives in one buffer; this holds a few million paths.
const PREFLIGHT_MAX_BUFFER = 256 * 1024 * 1024;
const FILE_LIST_MARKER = Buffer.from('t3u:files\n');
const UTF8 = new TextDecoder('utf-8', { fatal: true });

/** Refused before anything local changed. Exit 5, as the staging guard refuses. */
export class PullRefused extends Error {
  constructor(message) {
    super(message);
    this.name = 'PullRefused';
    this.exitCode = 5;
  }
}

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

/**
 * Read-only facts the pull depends on, one `t3u:` line each, then the NUL-separated fileadmin
 * list. The export is checked as it will run: `cd <current> && <bin/php> <typo3_bin>`. The list,
 * not `wc -l`, gives the remote count, because a file name with a newline counted twice there.
 */
export function preflightCommand(host, webroot = 'public', { includeProcessed = false, files = true } = {}) {
  const { current, fileadmin } = remotePaths(host, webroot);
  const fact = (name, test) => `if ${test}; then echo t3u:${name}=ok; else echo t3u:${name}=missing; fi`;
  const parts = [
    `echo "t3u:release=$(readlink ${current})"`,
    fact('current', `test -d ${current}`),
    fact('typo3_bin', `test -f ${current}/${host.typo3Bin}`),
    fact('php', `command -v ${host.php} >/dev/null 2>&1`),
  ];
  if (files) {
    const filter = includeProcessed ? '' : " -not -path '*/_processed_/*' -not -path '*/_temp_/*'";
    parts.push(`if test -d ${fileadmin}; then echo t3u:fileadmin=ok; echo t3u:files; cd ${fileadmin} && find . -type f${filter} -print0; `
      + 'else echo t3u:fileadmin=missing; fi');
  }
  return parts.join('; ');
}

/** The `t3u:` facts, and the remote files relative to fileadmin (null when none were listed). */
export function parsePreflight(output) {
  const bytes = Buffer.isBuffer(output) ? output : Buffer.from(String(output));
  const marker = bytes.indexOf(FILE_LIST_MARKER);
  const facts = { files: null };
  for (const line of bytes.subarray(0, marker < 0 ? bytes.length : marker).toString('utf8').split('\n')) {
    const match = /^t3u:([a-z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) facts[match[1]] = match[2].trim();
  }
  if (marker >= 0) {
    facts.files = [];
    let start = marker + FILE_LIST_MARKER.length;
    for (let end = bytes.indexOf(0, start); end >= 0; start = end + 1, end = bytes.indexOf(0, start)) {
      facts.files.push(fileName(bytes.subarray(start, end)).replace(/^\.\//, ''));
    }
  }
  return facts;
}

// A name that is not UTF-8 stays byte-exact (latin1 is one character per byte), so two such
// names can never fold into one by accident.
function fileName(bytes) {
  try { return UTF8.decode(bytes); } catch { return Buffer.from(bytes).toString('latin1'); }
}

/** Why the pull must not start. Empty when everything it will read on the server is there. */
export function preflightIssues(facts, host, webroot = 'public', { skipDb = false, skipFiles = false, includeProcessed = false } = {}) {
  const { current, fileadmin } = remotePaths(host, webroot);
  const issues = [];
  if (!skipDb) {
    if (facts.current !== 'ok') issues.push(`the release ${current} the database export runs in does not exist (current_path)`);
    else if (facts.typo3_bin !== 'ok') issues.push(`${current}/${host.typo3Bin} does not exist (typo3_bin)`);
    if (facts.php !== 'ok') issues.push(`${host.php} is not executable over SSH (bin/php)`);
  }
  if (!skipFiles) {
    if (facts.fileadmin !== 'ok') issues.push(`the fileadmin ${fileadmin} does not exist (fileadmin_path)`);
    else if (!facts.files?.length) {
      issues.push(`the fileadmin ${fileadmin} holds no files${includeProcessed ? '' : ' outside _processed_/ and _temp_/'}`);
    }
  }
  return issues;
}

/**
 * Remote files a case-insensitive volume cannot keep apart, grouped by their folded name. APFS
 * and HFS+ ignore Unicode normalisation as well as case. Directories that differ only in case
 * merge without losing a file; a file meeting another file loses one, and a file meeting a
 * directory cannot be written at all.
 */
export function caseCollisions(files) {
  const groups = new Map();
  const add = (name, kind) => {
    const key = name.normalize('NFC').toLowerCase();
    if (!groups.has(key)) groups.set(key, { files: new Set(), directories: new Set() });
    groups.get(key)[kind].add(name);
  };
  for (const file of files) {
    add(file, 'files');
    for (let slash = file.indexOf('/'); slash > 0; slash = file.indexOf('/', slash + 1)) add(file.slice(0, slash), 'directories');
  }
  return [...groups.values()]
    .filter((group) => group.files.size > 1 || (group.files.size && group.directories.size))
    .map((group) => (group.directories.size
      ? { kind: 'file-and-directory', names: [...group.files, ...[...group.directories].map((d) => `${d}/`)].sort(), lost: null }
      : { kind: 'files', names: [...group.files].sort(), lost: group.files.size - 1 }));
}

/** Whether the volume holding `dir` treats two names that differ only in case as one. */
export function caseInsensitiveAt(dir) {
  let existing = path.resolve(dir);
  while (!existsSync(existing)) existing = path.dirname(existing);
  const name = `.t3u-case-probe-${process.pid}-${randomBytes(4).toString('hex')}`;
  writeFileSync(path.join(existing, name), '', { flag: 'wx' });
  try {
    // Only the file name changes case: a parent on another volume must not decide the answer.
    return existsSync(path.join(existing, name.toUpperCase()));
  } finally {
    rmSync(path.join(existing, name), { force: true });
  }
}

/** --accept-case-collisions: an existing, non-empty evidence file, bound by its SHA-256. */
export function collisionAcceptance(project, file) {
  let bytes;
  try { bytes = readFileSync(file); } catch (error) {
    throw new PullRefused(`--accept-case-collisions ${file} is unreadable (${error.code ?? error.message}). Nothing was deleted.`);
  }
  if (!bytes.toString('utf8').trim()) {
    throw new PullRefused(`--accept-case-collisions ${file} is empty: record who accepted which lost files, and why. Nothing was deleted.`);
  }
  return { evidence: path.relative(path.resolve(project), path.resolve(file)), sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}` };
}

function caseCollisionRefusal(local, collisions, acceptable) {
  const names = collisions.map((c) => `  ${c.names.join('  |  ')}`).join('\n');
  const way = acceptable
    ? 'Each group keeps one file locally. Pull onto a case-sensitive volume (APFS Case-sensitive) to keep every file, '
      + 'or accept the loss with --accept-case-collisions <evidence-file>.'
    : 'A file and a directory with the same folded name cannot both exist here. Pull onto a case-sensitive volume (APFS Case-sensitive).';
  return `${local} is on a case-insensitive volume, and ${collisions.length} group(s) of remote names collide on it:\n${names}\n`
    + `${way} Nothing was deleted or downloaded.`;
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
    // Keep the stderr tail as bytes and decode once, so a multibyte character is never split.
    let stderrTail = Buffer.alloc(0);
    let exitCode = null, flushed = false;
    const settle = () => {
      if (exitCode === null || !flushed) return;
      if (exitCode === 0) resolve();
      else reject(new Error(`Remote export failed (exit ${exitCode}): ${stderrTail.toString('utf8').slice(-2000).trim().slice(0, 400)}`));
    };
    child.stderr.on('data', (d) => { stderrTail = Buffer.concat([stderrTail, Buffer.from(d)]).subarray(-8192); });
    child.stdout.pipe(createGzip()).pipe(out);
    child.on('error', reject);
    child.on('close', (code) => { exitCode = code ?? 1; settle(); });
    out.on('finish', () => { flushed = true; settle(); });
    out.on('error', reject);
  });
}

export async function pullLiveDataset({ project, hostName, out, hostsFile = path.join(project, '.hosts.yaml'), webroot = 'public',
  skipDb = false, skipFiles = false, includeProcessed = false, dryRun = false, acceptCaseCollisions = null,
  caseInsensitive = caseInsensitiveAt, run = execFileSync, log = console.log }) {
  const hosts = readHosts(readFileSync(hostsFile, 'utf8'));
  const host = selectHost(hosts, hostName);
  const local = localFileadmin(project, webroot);
  const remote = remotePaths(host, webroot);
  const acceptance = acceptCaseCollisions ? collisionAcceptance(project, acceptCaseCollisions) : null;
  const plan = [];
  const ssh = (command) => ['ssh', sshArgs(host, command)];
  const preflight = preflightCommand(host, webroot, { includeProcessed, files: !skipFiles });
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

  // Everything that can refuse runs before the first local change: the delete below must never
  // be followed by a failure the server could have predicted.
  let output;
  try {
    output = run('ssh', sshArgs(host, preflight), { timeout: 600000, maxBuffer: PREFLIGHT_MAX_BUFFER });
  } catch (failure) {
    const detail = String(failure.stderr ?? '').trim().split('\n').pop() || failure.message.split('\n')[0];
    throw new PullRefused(`preflight on ${host.alias} failed: ${detail}. Nothing was deleted or downloaded.`);
  }
  const facts = parsePreflight(output);
  const issues = preflightIssues(facts, host, webroot, { skipDb, skipFiles, includeProcessed });
  if (issues.length) {
    throw new PullRefused(`preflight on ${host.alias} refused the pull: ${issues.join('; ')}. Nothing was deleted or downloaded.`);
  }
  let caseCheck = null;
  if (!skipFiles) {
    const insensitive = caseInsensitive(path.dirname(local));
    const collisions = insensitive ? caseCollisions(facts.files) : [];
    const acceptable = collisions.every((c) => c.kind === 'files');
    if (collisions.length && (!acceptable || !acceptance)) throw new PullRefused(caseCollisionRefusal(local, collisions, acceptable));
    caseCheck = { target_case_insensitive: insensitive, collisions, files_lost: collisions.reduce((n, c) => n + c.lost, 0), acceptance };
    if (collisions.length) {
      log(`Case-insensitive ${local}: accepting ${caseCheck.files_lost} lost file(s) on ${acceptance.evidence} (${acceptance.sha256}):\n`
        + collisions.map((c) => `  ${c.names.join('  |  ')}`).join('\n'));
    }
  }

  mkdirSync(out, { recursive: true });
  const manifest = {
    schema: SCHEMA, project: path.basename(path.resolve(project)), host: host.alias, hostname: host.hostname,
    stage: host.stage, hosts_file: path.relative(path.resolve(project), path.resolve(hostsFile)),
    release: facts.release ? facts.release.split('/').pop() : null, remote, pulled_at: new Date().toISOString(),
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
    const expected = facts.files.length - caseCheck.files_lost;
    manifest.files = { deleted_local_first: true, remote_count: facts.files.length, local_count: counted.files, bytes: counted.bytes,
      excluded: includeProcessed ? [] : FILE_EXCLUDES, case_check: caseCheck };
    if (counted.files !== expected) {
      writeFileSync(path.join(out, 'live-dataset.json'), `${JSON.stringify(manifest, null, 2)}\n`);
      const accepted = caseCheck.files_lost ? ` (expected ${expected} after ${caseCheck.files_lost} accepted case collision(s))` : '';
      throw new Error(`fileadmin count mismatch: server ${facts.files.length}, local ${counted.files}${accepted}. The dataset is not usable.`);
    }
  }
  writeFileSync(path.join(out, 'live-dataset.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const cli = resolveProjectLayout(project).ddevTypo3;
  log(`Dataset written to ${out}. Next: snapshot, ddev import-db --file=${path.join(out, 'db.sql.gz')}, `
    + `then ddev exec ${cli} extension:setup (recreates the excluded cache tables) and cache:flush.`);
  return manifest;
}

/** The local web directory relative to the project; public unless composer.json or DDEV name another. */
export function defaultWebroot(project) {
  const layout = resolveProjectLayout(project);
  return layout.webDirSource === 'default' ? 'public' : layout.webDirRel;
}

async function main(argv) {
  const { values } = parseArgs({ args: argv, options: {
    project: { type: 'string', default: '.' }, host: { type: 'string' }, out: { type: 'string' },
    'hosts-file': { type: 'string' }, webroot: { type: 'string' }, 'skip-db': { type: 'boolean', default: false },
    'skip-files': { type: 'boolean', default: false }, 'include-processed': { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false }, 'accept-case-collisions': { type: 'string' },
  } });
  if (!values.host || (!values.out && !values['dry-run'])) {
    process.stderr.write('Usage: pull-live-dataset.mjs --project <dir> --host <alias> --out <dir> [--hosts-file <file>] [--dry-run]\n'
      + '         [--accept-case-collisions <evidence-file>]\n');
    return 2;
  }
  try {
    const result = await pullLiveDataset({ project: values.project, hostName: values.host, out: values.out,
      hostsFile: values['hosts-file'], webroot: values.webroot ?? defaultWebroot(values.project), skipDb: values['skip-db'], skipFiles: values['skip-files'],
      includeProcessed: values['include-processed'], dryRun: values['dry-run'], acceptCaseCollisions: values['accept-case-collisions'] });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`pull-live-dataset: ${error.message}\n`);
    return error.exitCode ?? 1;
  }
}

if (isMain(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
