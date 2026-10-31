#!/usr/bin/env node
/**
 * Does the harness node_modules match its package-lock.json?
 *
 * A stale install fails the harness suite with an assertion deep inside a dependency (an old
 * fast-uri once lowercased hosts differently and broke a UrlGuard test), which reads like a code
 * regression. This check names the real cause first. It only reads; it never installs.
 *
 * Exit 0: every locked package is installed at its locked version.
 * Exit 1: drift; prints the first mismatches and the command that fixes them.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const harness = path.join(root, 'skills/typo3-upgrade-run/scripts');
const lock = JSON.parse(readFileSync(path.join(harness, 'package-lock.json'), 'utf8'));

const drift = [];
for (const [key, entry] of Object.entries(lock.packages ?? {})) {
  // Root entry, links and optional platform binaries for other systems are not installed here.
  if (!key || entry.link || entry.optional) continue;
  const manifest = path.join(harness, key, 'package.json');
  const installed = existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')).version : null;
  if (installed !== entry.version) drift.push(`${key.replace(/^node_modules\//, '')}: locked ${entry.version}, installed ${installed ?? 'missing'}`);
}

if (drift.length === 0) process.exit(0);
console.log(`harness node_modules differs from package-lock.json in ${drift.length} package(s):`);
for (const line of drift.slice(0, 8)) console.log(`  ${line}`);
console.log(`fix: cd ${path.relative(process.cwd(), harness) || '.'} && npm ci`);
process.exit(1);
