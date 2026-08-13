#!/usr/bin/env node
/**
 * Verify that a Vite production manifest is complete and deployable.
 *
 * This deliberately checks the build artifact rather than vite.config.* source text. A config can
 * say `manifest: true` while the deployed directory is stale, incomplete or still contains
 * unhashed legacy entrypoints.
 *
 * Usage:
 *   node vite-production-check.mjs --manifest public/build/.vite/manifest.json \
 *     --public-root public/build [--report .typo3-update/report.vite.json]
 *
 * Exit: 0 pass · 1 findings · 2 bad input/harness error
 */

import { readFile, access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const HASHED_OUTPUT = /-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/;

export async function inspectViteManifest({ manifestPath, publicRoot }) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read Vite manifest ${manifestPath}: ${error.message}`);
  }
  if (!manifest || Array.isArray(manifest) || typeof manifest !== 'object') {
    throw new Error('Vite manifest must be a JSON object.');
  }

  const findings = [];
  const outputs = new Set();
  const entries = Object.entries(manifest);
  if (!entries.length) findings.push({ code: 'empty-manifest', target: manifestPath });
  if (!entries.some(([, chunk]) => chunk?.isEntry === true)) {
    findings.push({ code: 'no-entrypoints', target: manifestPath });
  }

  const noteOutput = async (owner, value, kind) => {
    if (typeof value !== 'string' || !value) {
      findings.push({ code: 'invalid-output-reference', target: owner, kind, value });
      return;
    }
    outputs.add(value);
    const resolved = path.resolve(publicRoot, value);
    const root = `${path.resolve(publicRoot)}${path.sep}`;
    if (!resolved.startsWith(root)) {
      findings.push({ code: 'output-escapes-public-root', target: owner, kind, value });
      return;
    }
    try { await access(resolved); }
    catch { findings.push({ code: 'missing-output', target: owner, kind, value }); }
    if (!HASHED_OUTPUT.test(path.basename(value))) {
      findings.push({ code: 'unhashed-output', target: owner, kind, value });
    }
  };

  for (const [key, chunk] of entries) {
    if (!chunk || typeof chunk !== 'object' || Array.isArray(chunk)) {
      findings.push({ code: 'invalid-chunk', target: key });
      continue;
    }
    await noteOutput(key, chunk.file, 'file');
    for (const file of [...(chunk.css ?? []), ...(chunk.assets ?? [])]) {
      await noteOutput(key, file, 'asset');
    }
    for (const dependency of [...(chunk.imports ?? []), ...(chunk.dynamicImports ?? [])]) {
      if (!Object.hasOwn(manifest, dependency)) {
        findings.push({ code: 'missing-manifest-dependency', target: key, dependency });
      }
    }
  }

  findings.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return {
    schema: 'typo3-upgrade-run/vite-production@1',
    manifest: path.resolve(manifestPath),
    publicRoot: path.resolve(publicRoot),
    counts: {
      chunks: entries.length,
      entrypoints: entries.filter(([, chunk]) => chunk?.isEntry === true).length,
      outputs: outputs.size,
      findings: findings.length,
    },
    findings,
    verdict: findings.length ? 'findings' : 'pass',
  };
}

async function main(argv) {
  const value = (name) => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? argv[index + 1] : null;
  };
  const manifestPath = value('manifest');
  const publicRoot = value('public-root');
  const report = value('report');
  if (!manifestPath || !publicRoot) {
    process.stderr.write('--manifest and --public-root are required\n');
    return 2;
  }
  try {
    const result = await inspectViteManifest({ manifestPath, publicRoot });
    if (report) await writeFile(report, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.findings.length ? 1 : 0;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
