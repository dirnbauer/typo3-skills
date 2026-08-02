#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SKIP_DIRS = new Set(['.Build', '.git', 'node_modules', 'vendor']);

function maskNonCode(source) {
  const chars = [...source];
  let state = 'code';
  for (let i = 0; i < chars.length; i += 1) {
    const char = chars[i];
    const next = chars[i + 1];
    if (state === 'code') {
      if (char === '/' && next === '/') { chars[i] = chars[i + 1] = ' '; i += 1; state = 'line'; }
      else if (char === '/' && next === '*') { chars[i] = chars[i + 1] = ' '; i += 1; state = 'block'; }
      else if (char === '#') { chars[i] = ' '; state = 'line'; }
      else if (char === "'") { chars[i] = ' '; state = 'single'; }
      else if (char === '"') { chars[i] = ' '; state = 'double'; }
      continue;
    }
    if (state === 'line') {
      if (char === '\n') state = 'code';
      else chars[i] = ' ';
    } else if (state === 'block') {
      if (char === '*' && next === '/') { chars[i] = chars[i + 1] = ' '; i += 1; state = 'code'; }
      else if (char !== '\n') chars[i] = ' ';
    } else {
      const quote = state === 'single' ? "'" : '"';
      if (char === '\\') {
        chars[i] = ' ';
        if (i + 1 < chars.length) { chars[i + 1] = ' '; i += 1; }
      } else if (char === quote) {
        chars[i] = ' ';
        state = 'code';
      } else if (char !== '\n') chars[i] = ' ';
    }
  }
  return chars.join('');
}

function argumentCount(masked, openIndex) {
  let parens = 1;
  let brackets = 0;
  let braces = 0;
  let commas = 0;
  let hasCode = false;
  for (let i = openIndex + 1; i < masked.length; i += 1) {
    const char = masked[i];
    if (char === '(') parens += 1;
    else if (char === ')') {
      parens -= 1;
      if (parens === 0) return hasCode ? commas + 1 : 0;
    } else if (char === '[') brackets += 1;
    else if (char === ']') brackets -= 1;
    else if (char === '{') braces += 1;
    else if (char === '}') braces -= 1;
    else if (char === ',' && parens === 1 && brackets === 0 && braces === 0) commas += 1;
    if (!/\s/.test(char) && !(char === ',' && parens === 1)) hasCode = true;
  }
  return null;
}

export function findLegacyAddTcaColumns(source) {
  const masked = maskNonCode(source);
  const findings = [];
  for (const match of masked.matchAll(/\bExtensionManagementUtility\s*::\s*addTCAcolumns\s*\(/g)) {
    const openIndex = match.index + match[0].lastIndexOf('(');
    const argumentsFound = argumentCount(masked, openIndex);
    if (argumentsFound !== null && argumentsFound > 2) {
      findings.push({
        line: source.slice(0, match.index).split('\n').length,
        argumentsFound,
      });
    }
  }
  return findings;
}

async function phpFiles(dir) {
  const files = [];
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return files; throw error; }
  for (const entry of entries) {
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) files.push(...await phpFiles(path.join(dir, entry.name)));
    else if (entry.isFile() && entry.name.endsWith('.php')) files.push(path.join(dir, entry.name));
  }
  return files;
}

async function packageDirectories(packagesRoot) {
  try {
    return (await readdir(packagesRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !SKIP_DIRS.has(entry.name))
      .map((entry) => ({ name: entry.name, dir: path.join(packagesRoot, entry.name) }));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function readJson(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { return { _error: error.message }; }
}

async function fileExists(file) {
  try { await readFile(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export async function auditLocalExtensions({
  root = process.cwd(), packagesDir = 'packages', publishable = [],
} = {}) {
  const packagesRoot = path.resolve(root, packagesDir);
  const publishableSet = new Set(publishable);
  const findings = [];
  const packages = await packageDirectories(packagesRoot);

  for (const pkg of packages) {
    const composerFile = path.join(pkg.dir, 'composer.json');
    const composer = await readJson(composerFile);
    if (composer._error) {
      findings.push({ id: 'composer-metadata-missing', package: pkg.name, file: composerFile, detail: composer._error });
    } else {
      if (composer.type !== 'typo3-cms-extension') {
        findings.push({ id: 'composer-extension-type-missing', package: pkg.name, file: composerFile });
      }
      if (!composer.extra?.['typo3/cms']?.['extension-key']) {
        findings.push({ id: 'composer-extension-key-missing', package: pkg.name, file: composerFile });
      }
    }

    const emconf = path.join(pkg.dir, 'ext_emconf.php');
    if (await fileExists(emconf) && !publishableSet.has(pkg.name)) {
      findings.push({
        id: 'local-ext-emconf-retained', package: pkg.name, file: emconf,
        detail: 'Remove ext_emconf.php from project-local Composer packages; allow-list only TER/Tailor or Classic-mode packages.',
      });
    }

    for (const file of await phpFiles(pkg.dir)) {
      const source = await readFile(file, 'utf8');
      for (const call of findLegacyAddTcaColumns(source)) {
        findings.push({ id: 'legacy-add-tca-columns-signature', package: pkg.name, file, ...call });
      }
    }
  }

  return {
    schema: 'typo3-upgrade-run/local-extension-audit@1',
    root: path.resolve(root), packagesRoot, packagesScanned: packages.length,
    publishable: [...publishableSet].sort(), findings,
    verdict: findings.length ? 'findings' : 'pass',
  };
}

function parseCli(argv) {
  const options = { root: process.cwd(), packagesDir: 'packages', publishable: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--root') options.root = argv[++i];
    else if (value === '--packages-dir') options.packagesDir = argv[++i];
    else if (value === '--publishable') options.publishable.push(...(argv[++i] ?? '').split(',').filter(Boolean));
    else if (value === '--help' || value === '-h') options.help = true;
    else throw new Error(`Unknown option: ${value}`);
  }
  if (!options.root || !options.packagesDir) throw new Error('Options require a value.');
  return options;
}

async function main(argv) {
  let options;
  try { options = parseCli(argv); }
  catch (error) { process.stderr.write(`${error.message}\n`); return 2; }
  if (options.help) {
    process.stdout.write('Usage: local-extension-audit.mjs [--root DIR] [--packages-dir DIR] [--publishable pkg,pkg]\n');
    return 0;
  }
  try {
    const result = await auditLocalExtensions(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.findings.length ? 1 : 0;
  } catch (error) {
    process.stderr.write(`Local extension audit failed: ${error.message}\n`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
