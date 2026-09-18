#!/usr/bin/env node
/** Offline destination preflight, not a push wrapper or transport/authorization proof. */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export function parsePushDestination(value) {
  const invalid = { issue: 'Unsupported or ambiguous URL; require credential-free HTTPS or canonical git SSH.' };
  if (typeof value !== 'string' || /[\s\\%?#]/u.test(value)) return invalid;
  let host, path, transport;
  const https = /^https:\/\/([a-z0-9.-]+)(?::443)?\/(.+)$/i.exec(value);
  const ssh = /^ssh:\/\/git@([a-z0-9.-]+)(?::22)?\/(.+)$/i.exec(value);
  const scp = /^git@([a-z0-9.-]+):(.+)$/i.exec(value);
  if (https) {
    [, host, path] = https;
    transport = 'https';
  } else if (ssh || scp) {
    [, host, path] = ssh || scp;
    transport = 'ssh';
  } else return invalid;

  host = host.toLowerCase();
  const parts = path.replace(/\.git$/, '').split('/');
  if (parts.length < 2 || parts.some(part => !/^[a-z0-9_][a-z0-9_.-]*$/i.test(part))) return invalid;
  const permitted = host === 'gitlab.webconsulting.at'
    || (host === 'github.com' && parts.length === 2 && parts[0].toLowerCase() === 'dirnbauer');
  if (!permitted) return { issue: 'Destination is outside github.com/dirnbauer and gitlab.webconsulting.at.' };
  return { target: { host, repository: parts.join('/'), transport } };
}

export function checkPushTarget({ repo, remote, env = process.env }) {
  const result = {
    check: 'git-push-destinations', status: 'refused', targets: [], issues: [],
    authorizesPush: false, transportVerified: false,
  };
  if (typeof repo !== 'string' || !repo || typeof remote !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/i.test(remote)) {
    result.issues.push('An explicit repository and simple named remote are required.');
    return result;
  }
  let output;
  try {
    // Git expands pushurl, insteadOf and pushInsteadOf. No remote helper is invoked.
    output = execFileSync('git', ['-C', repo, 'remote', 'get-url', '--push', '--all', remote], {
      env, encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    // Raw stderr/config may contain credentials. Never echo it.
    result.issues.push('Could not resolve all push URLs from the selected repository and remote.');
    return result;
  }
  const urls = output.replace(/\n$/, '').split('\n');
  for (const [index, url] of urls.entries()) {
    const parsed = parsePushDestination(url);
    if (parsed.issue) result.issues.push(`Target ${index + 1}: ${parsed.issue}`);
    else result.targets.push(parsed.target);
  }
  if (result.issues.length === 0 && result.targets.length > 0) result.status = 'pass';
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: { repo: { type: 'string' }, remote: { type: 'string' } }, allowPositionals: false });
    if (!values.repo || !values.remote) throw new Error('arguments');
    const result = checkPushTarget(values);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exitCode = result.status === 'pass' ? 0 : 5;
  } catch {
    process.stderr.write('Usage: node check-push-target.mjs --repo /absolute/project --remote origin\n');
    process.exitCode = 4;
  }
}
