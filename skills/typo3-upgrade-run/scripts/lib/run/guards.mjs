/**
 * Mechanical guards against specification gaming inside graph nodes.
 *
 * Coding agents optimise for the check in front of them: benchmarks such as ImpossibleBench
 * and SpecBench show tests being edited or special-cased while visible suites stay green.
 * The upgrade graph's equivalent is a site-fix node that "fixes" a visual difference by
 * changing what is measured. These guards make that impossible to miss:
 *
 *   - measurement inputs are fingerprinted when a node opens and compared when it closes;
 *   - a recovery node's project change is measured against its Git rollback anchor;
 *   - judgement outcomes carry an independent review bound to the exact evidence bytes.
 */

import { execFile } from 'node:child_process';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { PreconditionError } from '../cli/exit-codes.mjs';
import { sha256 } from './paths.mjs';

const exec = promisify(execFile);

/** Inputs that define "the same". Only measurement nodes may change the config and self-test. */
const SEALED_ALWAYS = Object.freeze([
  'manifests/url-manifest.json',
  'manifests/feature-contracts.json',
]);
const MEASUREMENT_ONLY = Object.freeze(['selftest.lock.json']);

export async function measurementInputs(paths) {
  const entries = {};
  const files = [...SEALED_ALWAYS, ...MEASUREMENT_ONLY, ...await listFiles(paths.root, 'config')];
  for (const dir of await readdir(paths.baselineDir).catch(() => [])) {
    files.push(`baseline/${dir}/LOCK.json`, `baseline/${dir}/MANIFEST.sha256`);
  }
  for (const rel of [...new Set(files)].sort()) {
    const bytes = await readFile(path.join(paths.root, rel)).catch(() => null);
    entries[rel] = bytes ? `sha256:${sha256(bytes)}` : 'absent';
  }
  return entries;
}

/**
 * Returns the measurement inputs a node changed that it may not change.
 * Measurement nodes may recalibrate config/ and the self-test, never sealed evidence.
 */
export function forbiddenMeasurementChanges(before, after, { measurementNode = false } = {}) {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const changed = [...keys].filter((key) => (before?.[key] ?? 'absent') !== (after?.[key] ?? 'absent'));
  return changed.filter((key) => {
    if (SEALED_ALWAYS.includes(key) || key.startsWith('baseline/')) return true;
    return !measurementNode;
  }).sort();
}

/** Project change since the node's Git rollback anchor, excluding the run directory. */
/**
 * Untracked, non-ignored files outside the run directory with a content hash, recorded at node-open.
 * A user's pre-existing draft folder must not count as the node's own change.
 */
export async function untrackedSnapshot(runRoot) {
  const run = async (cwd, args) => (await exec('git', ['-C', cwd, ...args], { maxBuffer: 64 * 1024 * 1024 })).stdout;
  let top, runReal;
  try {
    runReal = await realpath(runRoot);
    top = await realpath((await run(runReal, ['rev-parse', '--show-toplevel'])).trim());
  } catch {
    return null;
  }
  const runRel = path.relative(top, runReal) || '.';
  const files = (await run(top, ['ls-files', '--others', '--exclude-standard', '--', '.', `:(exclude)${runRel}`]))
    .split('\n').filter(Boolean);
  const snapshot = {};
  for (const rel of files) snapshot[rel] = await fileMark(path.join(top, rel));
  return snapshot;
}

async function fileMark(file) {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return null;
  if (info.size > 8 * 1024 * 1024) return `size:${info.size}:${Math.floor(info.mtimeMs / 1000)}`;
  return `sha256:${sha256(await readFile(file))}`;
}

export async function projectChangeSince(runRoot, ref, { untrackedBaseline = null } = {}) {
  const run = async (cwd, args) => (await exec('git', ['-C', cwd, ...args], { maxBuffer: 64 * 1024 * 1024 })).stdout;
  let top, runReal;
  try {
    // Resolve symlinks (macOS /var -> /private/var) so the run-directory exclusion is exact.
    runReal = await realpath(runRoot);
    top = await realpath((await run(runReal, ['rev-parse', '--show-toplevel'])).trim());
    await run(top, ['rev-parse', '--verify', `${ref}^{commit}`]);
  } catch {
    throw new PreconditionError(`Cannot measure the change since rollback anchor git:${ref}; open the node from a Git commit that exists.`);
  }
  const git = (...args) => run(top, args);
  const runRel = path.relative(top, runReal) || '.';
  const exclude = `:(exclude)${runRel}`;
  const numstat = await git('diff', '--numstat', ref, '--', '.', exclude);
  let files = 0, added = 0, deleted = 0;
  for (const line of numstat.split('\n').filter(Boolean)) {
    const [a, d] = line.split('\t');
    files += 1;
    added += Number.parseInt(a, 10) || 0;
    deleted += Number.parseInt(d, 10) || 0;
  }
  const untracked = (await git('ls-files', '--others', '--exclude-standard', '--', '.', exclude))
    .split('\n').filter(Boolean);
  for (const rel of untracked) {
    // Present and unchanged since node-open: not this node's change.
    if (untrackedBaseline && Object.hasOwn(untrackedBaseline, rel)
      && untrackedBaseline[rel] === await fileMark(path.join(top, rel))) continue;
    files += 1;
    const file = path.join(top, rel);
    const info = await stat(file).catch(() => null);
    if (info?.isFile() && info.size <= 1024 * 1024) {
      added += (await readFile(file, 'utf8')).split('\n').length;
    }
  }
  return { base: `git:${ref}`, files, added, deleted };
}

export function overBudget(change, budget) {
  if (!change || !budget) return false;
  return change.files > budget.files || change.added + change.deleted > budget.lines;
}

/**
 * An independent review is a separate artifact written by a verifier that saw only the node
 * brief and the evidence. It must agree and name the evidence bytes it reviewed.
 */
export function parseReview(text) {
  const verdict = text.match(/^\s*verdict:\s*(agree|disagree)\b/im)?.[1]?.toLowerCase() ?? null;
  const evidence = text.match(/^\s*evidence_sha256:\s*(sha256:[a-f0-9]{64})\s*$/im)?.[1] ?? null;
  return { verdict, evidenceSha256: evidence };
}

export function reviewRequired(definition, node, outcome) {
  if (definition.policy?.require_independent_review !== true || outcome === 'blocked') return false;
  return node.review === 'required' || outcome === 'not-applicable';
}

async function listFiles(root, dir) {
  const out = [];
  const walk = async (rel) => {
    for (const entry of await readdir(path.join(root, rel), { withFileTypes: true }).catch(() => [])) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) out.push(child);
    }
  };
  await walk(dir);
  return out;
}
