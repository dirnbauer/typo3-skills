import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeLayout, readDdevConfig, resolveProjectLayout, runLayout } from '../../lib/run/project-layout.mjs';
import { readSiteConfigs, siteRouting } from '../../lib/net/site-routing.mjs';
import { discoverFromPages, PAGE_PARENTS_SQL, sitemapEntryPoints } from '../../lib/actions/discover.mjs';
import { ddevAppArgs } from '../../lib/fingerprint/environment.mjs';
import { main as dbHealthMain } from '../../db-health.mjs';
import { discoverProject } from '../../typo3-14-readiness.mjs';
import { defaultWebroot } from '../../pull-live-dataset.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// DDEV composer_root: app, docroot app/web, Composer bin-dir "." (CLI at app/typo3), sites in app/config/sites.
const FIXTURE = path.resolve(HERE, '../fixtures/composer-root-app');
const BASE = new URL('https://example.ddev.site/');

async function tempDir(prefix) {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

test('a DDEV composer_root with bin-dir "." puts sites, system, var, fileadmin and the CLI below app/', () => {
  const layout = resolveProjectLayout(FIXTURE);
  assert.equal(layout.root, FIXTURE);
  assert.deepEqual([layout.composerRootRel, layout.composerRootSource], ['app', '.ddev/config.yaml composer_root']);
  assert.deepEqual([layout.webDirRel, layout.webDirSource], ['app/web', 'composer.json web-dir']);
  assert.equal(layout.sitesDir, path.join(FIXTURE, 'app', 'config', 'sites'));
  assert.equal(layout.systemDir, path.join(FIXTURE, 'app', 'config', 'system'));
  assert.equal(layout.varDir, path.join(FIXTURE, 'app', 'var'));
  assert.equal(layout.fileadminRel, 'app/web/fileadmin');
  assert.deepEqual([layout.typo3CliRel, layout.typo3CliExists, layout.ddevTypo3], ['app/typo3', true, 'app/typo3']);
  assert.equal(layout.binDir, path.join(FIXTURE, 'app'));
  assert.equal(layout.containerComposerRoot, '/var/www/html/app');
  assert.equal(layout.requiresTypo3, true);
  assert.equal(layout.standard, false);
  assert.match(describeLayout(layout), /Composer root app \(\.ddev\/config\.yaml composer_root\).*sites app\/config\/sites, CLI app\/typo3$/);
});

test('a standard layout keeps the defaults: project root, public/, vendor/bin/typo3, config/sites', async () => {
  const root = await tempDir('t3u-layout-standard-');
  try {
    await writeFile(path.join(root, 'composer.json'), JSON.stringify({ require: { 'typo3/cms-core': '^13.4' } }));
    const layout = resolveProjectLayout(root);
    assert.deepEqual([layout.composerRootRel, layout.composerRootSource], ['.', 'composer.json']);
    assert.deepEqual([layout.webDirRel, layout.webDirSource], ['public', 'default']);
    assert.deepEqual([layout.typo3CliRel, layout.typo3CliExists, layout.ddevTypo3], ['vendor/bin/typo3', false, 'vendor/bin/typo3']);
    assert.equal(layout.sitesDirRel, 'config/sites');
    assert.equal(layout.fileadminRel, 'public/fileadmin');
    assert.equal(layout.standard, true);
    // bin-dir "." at the project root: a bare name would be looked up on PATH inside the container.
    await writeFile(path.join(root, 'composer.json'), JSON.stringify({ require: { 'typo3/cms-core': '^13.4' }, config: { 'bin-dir': '.' } }));
    await writeFile(path.join(root, 'typo3'), '');
    assert.deepEqual([resolveProjectLayout(root).typo3CliRel, resolveProjectLayout(root).ddevTypo3], ['typo3', './typo3']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('without .ddev the one subdirectory whose composer.json requires TYPO3 is the Composer root', async () => {
  const root = await tempDir('t3u-layout-detect-');
  try {
    await cp(path.join(FIXTURE, 'app'), path.join(root, 'app'), { recursive: true });
    await mkdir(path.join(root, 'tools'));
    await writeFile(path.join(root, 'tools', 'composer.json'), JSON.stringify({ require: { 'phpstan/phpstan': '^2' } }));
    const layout = resolveProjectLayout(root);
    assert.deepEqual([layout.composerRootRel, layout.composerRootSource], ['app', 'app/composer.json']);
    assert.equal(layout.typo3CliRel, 'app/typo3');
    // Without composer's web-dir, DDEV's docroot names the web directory.
    await writeFile(path.join(root, 'app', 'composer.json'), JSON.stringify({ require: { 'typo3/cms-core': '^13.4' }, config: { 'bin-dir': '.' } }));
    await mkdir(path.join(root, '.ddev'));
    await writeFile(path.join(root, '.ddev', 'config.yaml'), 'name: x\ndocroot: "app/web"\ncomposer_root: "app/"\n');
    assert.deepEqual([resolveProjectLayout(root).webDirRel, resolveProjectLayout(root).webDirSource], ['app/web', '.ddev/config.yaml docroot']);
    assert.deepEqual(readDdevConfig(root), { composerRoot: 'app', docroot: 'app/web' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an explicit composer root wins over detection and must stay inside the project', () => {
  const layout = resolveProjectLayout(FIXTURE, { composerRoot: '.' });
  assert.deepEqual([layout.composerRootRel, layout.composerRootSource, layout.sitesDirRel], ['.', 'option', 'config/sites']);
  assert.throws(() => resolveProjectLayout(FIXTURE, { composerRoot: '../elsewhere' }), (error) => error.exitCode === 4);
  assert.throws(() => resolveProjectLayout(FIXTURE, { composerRoot: '/etc' }), (error) => error.exitCode === 4);
  // --composer-root, then the value init recorded, then run.yml, then detection.
  const runConfig = { project: { composer_root: '.' } };
  assert.equal(runLayout({ cwd: FIXTURE }).composerRootRel, 'app');
  assert.equal(runLayout({ cwd: FIXTURE, runConfig }).composerRootSource, 'option');
  assert.equal(runLayout({ cwd: FIXTURE, state: { project: { composer_root: 'app' } }, runConfig }).composerRootRel, 'app');
  assert.equal(runLayout({ cwd: FIXTURE, values: { 'composer-root': '.' }, state: { project: { composer_root: 'app' } } }).composerRootRel, '.');
  assert.equal(runLayout({ cwd: FIXTURE, runConfig: { project: { composer_root: '' } } }).composerRootRel, 'app');
});

test('discovery reads app/config/sites: real sitemap entry points instead of a guessed /<lang>/sitemap.xml', async () => {
  const siteConfigs = await readSiteConfigs(FIXTURE);
  assert.deepEqual([siteConfigs.configs.map((c) => c.identifier), siteConfigs.warnings, siteConfigs.dirRel], [['main'], [], 'app/config/sites']);
  const { entryPoints, warnings } = sitemapEntryPoints(siteRouting(siteConfigs.configs, BASE), BASE,
    { languages: ['de', 'en'], sitesDir: siteConfigs.dirRel });
  assert.deepEqual(entryPoints, ['https://example.ddev.site/sitemap.xml', 'https://example.ddev.site/en/sitemap.xml']);
  assert.deepEqual(warnings, []);
  // The defect: the project root has no config/sites, so the entry points were guessed (/de/ is a 404).
  const rootOnly = await readSiteConfigs(FIXTURE, { composerRoot: '.' });
  const guessed = sitemapEntryPoints(siteRouting(rootOnly.configs, BASE), BASE, { languages: ['de', 'en'], sitesDir: rootOnly.dirRel });
  assert.ok(guessed.entryPoints.includes('https://example.ddev.site/de/sitemap.xml'));
  assert.match(guessed.warnings[0], /^no config\/sites\/\*\/config\.yaml; sitemap entry points are guessed/);
});

test('page-tree discovery applies the language base and PageType suffix from app/config/sites', async () => {
  const rows = ['1\t1\t/\t0\t0', '2\t1\t/news\t0\t0', '3\t1\t/news\t1\t2'].join('\n');
  const run = async (command, args, options) => {
    assert.equal(options.cwd, FIXTURE);
    return { stdout: args.at(-1) === PAGE_PARENTS_SQL ? '1\t0\n2\t1\n' : `${rows}\n` };
  };
  const warned = [];
  const result = await discoverFromPages({ base: BASE, cwd: FIXTURE, run, languages: [],
    log: { step() {}, warn: (message) => warned.push(message) },
    guard: { async assertUrl(url) { return { url: new URL(url) }; } } });
  assert.deepEqual(result.urls, ['https://example.ddev.site/', 'https://example.ddev.site/en/news/', 'https://example.ddev.site/news/']);
  assert.deepEqual(warned, []);
});

test('the TYPO3 CLI runs by its project path in DDEV, not as `ddev typo3`', () => {
  const cli = resolveProjectLayout(FIXTURE).ddevTypo3;
  assert.deepEqual(ddevAppArgs('typo3', ['configuration:show', 'GFX'], cli), ['exec', '--', 'app/typo3', 'configuration:show', 'GFX']);
  assert.deepEqual(ddevAppArgs('typo3', ['cache:flush']), ['exec', '--', 'vendor/bin/typo3', 'cache:flush']);
  assert.deepEqual(ddevAppArgs('composer', ['show']), ['composer', 'show']);
  assert.deepEqual(ddevAppArgs('php', ['-v']), ['exec', '--', 'php', '-v']);
});

test('db-health check calls dbdoctor through app/typo3 when --typo3-bin is not given', async () => {
  const out = await tempDir('t3u-layout-dbhealth-');
  const calls = [];
  const clean = await readFile(path.join(HERE, '../fixtures/db-health/check-clean-2.2.0.stdout.txt'), 'utf8');
  const run = async (cmd, args) => { calls.push([cmd, ...args]); return { code: 0, stdout: clean, stderr: '' }; };
  try {
    await dbHealthMain(['check', '--project', FIXTURE, '--out', out, '--version', '2.2.0'], { run, stderr() {} });
    assert.match(calls[0].at(-1), /timeout \d+ app\/typo3 dbdoctor:health --mode=check/);
    calls.length = 0;
    await dbHealthMain(['check', '--project', FIXTURE, '--out', out, '--version', '2.2.0', '--typo3-bin', 'vendor/bin/typo3'], { run, stderr() {} });
    assert.match(calls[0].at(-1), / vendor\/bin\/typo3 dbdoctor:health/);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('readiness reads composer.json and config/ below app/ and keeps the project root for the PHP helpers', async () => {
  const project = await discoverProject(FIXTURE);
  assert.equal(project.root, FIXTURE);
  assert.equal(project.composerRoot, path.join(FIXTURE, 'app'));
  assert.equal(project.webDir, path.join(FIXTURE, 'app', 'web'));
  assert.equal(project.vendorDir, path.join(FIXTURE, 'app', 'vendor'));
  assert.equal(project.composer?.name, 'example/site');
});

test('the live-dataset pull targets app/web/fileadmin locally unless --webroot says otherwise', async () => {
  assert.equal(defaultWebroot(FIXTURE), 'app/web');
  const root = await tempDir('t3u-layout-webroot-');
  try {
    assert.equal(defaultWebroot(root), 'public');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
