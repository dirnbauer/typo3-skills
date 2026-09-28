#!/usr/bin/env node
/**
 * Deploy an upgrade branch to a staging host, and only to a staging host.
 *
 * Standing rule: upgrade runs publish to staging, never to live. A host passes only when
 *   - its Deployer stage label is staging, stage, testing, test, development or dev, AND
 *   - its hostname starts with staging., stage., testing., test. or dev., AND
 *   - no production-labelled host shares its hostname or deploy_path.
 * Everything else is refused before Deployer starts.
 *
 *   node deploy-staging.mjs --project <dir> --host <alias> [--branch <branch>] [--record <file>] [--dry-run]
 *
 * Runs `php vendor/bin/dep deploy <alias> [-o branch=<branch>]` from the project on this machine,
 * using its SSH keys. The record file captures host, branch, commit, time and exit code.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { readHosts } from './pull-live-dataset.mjs';

const STAGING_LABELS = new Set(['staging', 'stage', 'testing', 'test', 'development', 'dev']);
const PRODUCTION_LABELS = /^(prod|production|live|www|master|main)$/i;
const STAGING_HOSTNAME = /^(staging|stage|testing|test|dev)\./i;

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

async function main(argv) {
  const { values } = parseArgs({ args: argv, options: {
    project: { type: 'string', default: '.' }, host: { type: 'string' }, branch: { type: 'string' },
    record: { type: 'string' }, 'dry-run': { type: 'boolean', default: false },
  } });
  if (!values.host) {
    process.stderr.write('Usage: deploy-staging.mjs --project <dir> --host <alias> [--branch <branch>] [--record <file>] [--dry-run]\n');
    return 2;
  }
  const project = path.resolve(values.project);
  const hosts = readHosts(readFileSync(path.join(project, '.hosts.yaml'), 'utf8'));
  const host = hosts.find((h) => h.alias === values.host);
  if (!host) {
    process.stderr.write(`deploy-staging: no host alias ${values.host} in .hosts.yaml.\n`);
    return 1;
  }
  const verdict = stagingVerdict(host, hosts);
  if (!verdict.allowed) {
    process.stderr.write(`deploy-staging: REFUSED ${host.alias}: ${verdict.reasons.join('; ')}. Upgrade runs never publish to live.\n`);
    return 5;
  }
  const [command, args] = deployCommand(host.alias, values.branch);
  if (values['dry-run']) {
    process.stdout.write(`[dry-run] allowed staging host ${host.alias} (${host.stage}): ${command} ${args.join(' ')}\n`);
    return 0;
  }
  const commit = execFileSync('git', ['-C', project, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const started = new Date().toISOString();
  const result = spawnSync(command, args, { cwd: project, stdio: 'inherit' });
  const record = { schema: 'typo3-upgrade-run/staging-deploy@1', host: host.alias, hostname: host.hostname, stage: host.stage,
    branch: values.branch ?? host.branch, local_head: commit, started_at: started, finished_at: new Date().toISOString(),
    exit_code: result.status };
  if (values.record) writeFileSync(values.record, `${JSON.stringify(record, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
  return result.status === 0 ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await main(process.argv.slice(2));
}
