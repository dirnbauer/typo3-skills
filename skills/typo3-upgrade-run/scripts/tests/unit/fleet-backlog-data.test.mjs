import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify as stringifyYaml } from 'yaml';
import {
  PullRefused, caseCollisions, caseInsensitiveAt, parsePreflight, preflightCommand, preflightIssues, pullLiveDataset, readHosts, selectHost,
} from '../../pull-live-dataset.mjs';
import { discoverUrls, discoverySeed, sitemapEntryPoints } from '../../lib/actions/discover.mjs';
import { siteRouting } from '../../lib/net/site-routing.mjs';
import { moduleIdentifiers, registeredModules, unknownModuleEntries } from '../../backend-permissions-audit.mjs';
import { RunPaths } from '../../lib/run/paths.mjs';
import { runCommand } from '../../lib/cli/command.mjs';
import { graphInit } from '../../lib/actions/graph.mjs';
import { nodeBrief } from '../../lib/actions/runner.mjs';
import { emptyState, StateStore } from '../../lib/run/state.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(HERE, '../../pull-live-dataset.mjs');
const DEFAULT_GRAPH = path.resolve(HERE, '../../../templates/run-directory/config/upgrade-graph.yml');
const quiet = { step() {}, info() {}, debug() {}, warn() {}, success() {}, error() {}, finding() {} };
const tmp = (prefix) => mkdtempSync(path.join(os.tmpdir(), prefix));

// ---- 1. pull-live-dataset: read-only preflight before the delete ------------------------------

const HOSTS = stringifyYaml({ hosts: { live: { hostname: 'live.example.test', remote_user: 'deploy', deploy_path: '/var/www/site',
  'bin/php': 'php8.3', labels: { stage: 'production' } } } });
const host = () => selectHost(readHosts(HOSTS), 'live');
const facts = (overrides = {}, files = ['user_upload/a.jpg', 'b.pdf']) => {
  const lines = { release: 'releases/7', current: 'ok', typo3_bin: 'ok', php: 'ok', fileadmin: 'ok', ...overrides };
  const head = Object.entries(lines).map(([key, value]) => `t3u:${key}=${value}\n`).join('');
  return lines.fileadmin === 'ok' ? `${head}t3u:files\n${files.map((file) => `./${file}\0`).join('')}` : head;
};

function project() {
  const dir = tmp('t3u-pull-');
  writeFileSync(path.join(dir, '.hosts.yaml'), HOSTS);
  mkdirSync(path.join(dir, 'public', 'fileadmin'), { recursive: true });
  writeFileSync(path.join(dir, 'public', 'fileadmin', 'local.pdf'), 'local');
  return dir;
}

/** ssh answers with the preflight output; rsync writes `files` into the target. */
function server(preflightOutput, files = ['user_upload/a.jpg', 'b.pdf']) {
  const calls = [];
  const run = (command, args) => {
    calls.push(command);
    if (command === 'ssh') {
      if (preflightOutput instanceof Error) throw preflightOutput;
      return preflightOutput;
    }
    for (const file of files) {
      mkdirSync(path.dirname(path.join(args.at(-1), file)), { recursive: true });
      writeFileSync(path.join(args.at(-1), file), file);
    }
    return '';
  };
  return { calls, run };
}

test('the preflight refuses with exit 5 and deletes nothing when what the pull reads is missing or empty', async () => {
  const cases = [
    [{ fileadmin: 'missing' }, /fileadmin \/var\/www\/site\/shared\/public\/fileadmin does not exist \(fileadmin_path\)/],
    [{}, /holds no files outside _processed_\/ and _temp_\//, []],
    [{ current: 'missing' }, /release \/var\/www\/site\/current the database export runs in does not exist/],
    [{ typo3_bin: 'missing' }, /\/var\/www\/site\/current\/vendor\/bin\/typo3 does not exist \(typo3_bin\)/],
    [{ php: 'missing' }, /php8\.3 is not executable over SSH \(bin\/php\)/],
  ];
  for (const [overrides, reason, files] of cases) {
    const dir = project();
    try {
      const { calls, run } = server(facts(overrides, files));
      const out = path.join(dir, 'dataset');
      await assert.rejects(pullLiveDataset({ project: dir, hostName: 'live', out, run, log: () => {}, caseInsensitive: () => false }),
        (error) => error instanceof PullRefused && error.exitCode === 5 && reason.test(error.message) && /Nothing was deleted/.test(error.message));
      assert.deepEqual(calls, ['ssh'], 'no export and no rsync after a refusal');
      assert.ok(existsSync(path.join(dir, 'public', 'fileadmin', 'local.pdf')), 'the local fileadmin is untouched');
      assert.equal(existsSync(out), false, 'not even the dataset directory is created');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('the preflight enforces only what the pull uses, and an ssh failure is a refusal too', async () => {
  const dir = project();
  try {
    // --skip-db: a broken export path does not block a files-only pull.
    const { calls, run } = server(facts({ current: 'missing', php: 'missing' }));
    const manifest = await pullLiveDataset({ project: dir, hostName: 'live', out: path.join(dir, 'd'), skipDb: true, run,
      log: () => {}, caseInsensitive: () => false });
    assert.deepEqual(calls, ['ssh', 'rsync']);
    assert.deepEqual([manifest.release, manifest.files.remote_count, manifest.files.local_count], ['7', 2, 2]);
    // --skip-files: an absent fileadmin does not block a database-only pull, and it is not even listed.
    assert.deepEqual(preflightIssues(parsePreflight(facts({ fileadmin: 'missing' })), host(), 'public', { skipFiles: true }), []);
    assert.doesNotMatch(preflightCommand(host(), 'public', { files: false }), /fileadmin|find/);

    writeFileSync(path.join(dir, 'public', 'fileadmin', 'local.pdf'), 'local');
    const failure = Object.assign(new Error('Command failed: ssh'), { stderr: 'ssh: connect to host live.example.test port 22: Connection refused\n' });
    await assert.rejects(pullLiveDataset({ project: dir, hostName: 'live', out: path.join(dir, 'e'), run: server(failure).run, log: () => {} }),
      (error) => error.exitCode === 5 && /Connection refused\. Nothing was deleted/.test(error.message));
    assert.ok(existsSync(path.join(dir, 'public', 'fileadmin', 'local.pdf')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the preflight command only reads on the server and checks the export as it will run', () => {
  const command = preflightCommand(host(), 'public');
  assert.doesNotMatch(command.replaceAll('>/dev/null 2>&1', ''), /\b(rm|mv|cp|touch|mkdir|chmod|tee|truncate|sed -i)\b|>/);
  assert.match(command, /test -d \/var\/www\/site\/current;/);
  assert.match(command, /test -f \/var\/www\/site\/current\/vendor\/bin\/typo3;/);
  assert.match(command, /command -v php8\.3 /);
  assert.match(command, /cd \/var\/www\/site\/shared\/public\/fileadmin && find \. -type f -not -path '\*\/_processed_\/\*' -not -path '\*\/_temp_\/\*' -print0/);
  assert.doesNotMatch(preflightCommand(host(), 'public', { includeProcessed: true }), /_processed_/);
});

test('the remote list is NUL-separated, so odd names count once and keep their bytes', () => {
  const latin1 = Buffer.from('./M\xfcller.pdf', 'latin1'); // one byte for the umlaut: not UTF-8
  const output = Buffer.concat([Buffer.from('banner from .bashrc\nt3u:release=releases/9\nt3u:fileadmin=ok\nt3u:files\n'),
    Buffer.from('./two\nlines.txt\0./Caf\xe9.jpg\0'), latin1, Buffer.from([0])]);
  const parsed = parsePreflight(output);
  assert.deepEqual([parsed.release, parsed.fileadmin], ['releases/9', 'ok']);
  assert.deepEqual(parsed.files, ['two\nlines.txt', 'Caf\xe9.jpg', 'M\xfcller.pdf']);
  assert.equal(parsePreflight('t3u:fileadmin=missing\n').files, null);
});

// ---- 2. case-insensitive local volumes --------------------------------------------------------

test('case collisions are grouped by folded name; directories that only merge lose nothing', () => {
  const nfd = 'Caf\xe9.jpg'.normalize('NFD'), nfc = 'caf\xe9.jpg';
  const groups = caseCollisions(['user_upload/Logo.png', 'user_upload/logo.png', 'Images/a.jpg', 'images/b.jpg',
    `menu/${nfd}`, `menu/${nfc}`, 'docs', 'Docs/x.pdf', 'plain.txt']);
  assert.deepEqual(groups.map((g) => [g.kind, g.names, g.lost]), [
    ['files', ['user_upload/Logo.png', 'user_upload/logo.png'], 1],
    ['files', [`menu/${nfd}`, `menu/${nfc}`].sort(), 1],
    ['file-and-directory', ['Docs/', 'docs'], null],
  ]);
  assert.deepEqual(caseCollisions(['a/B.jpg', 'A/b.jpg']).map((g) => g.names), [['A/b.jpg', 'a/B.jpg']]);
  assert.deepEqual(caseCollisions(['Images/a.jpg', 'images/b.jpg']), []);
});

test('on a case-insensitive volume colliding names are listed and refused before anything is deleted', async () => {
  const dir = project();
  try {
    const { calls, run } = server(facts({}, ['user_upload/Logo.png', 'user_upload/logo.png', 'b.pdf']));
    await assert.rejects(pullLiveDataset({ project: dir, hostName: 'live', out: path.join(dir, 'd'), run, log: () => {}, caseInsensitive: () => true }),
      (error) => error.exitCode === 5
        && error.message.includes('  user_upload/Logo.png  |  user_upload/logo.png\n')
        && /case-sensitive volume/.test(error.message) && /--accept-case-collisions <evidence-file>/.test(error.message)
        && !/count mismatch/.test(error.message));
    assert.deepEqual(calls, ['ssh']);
    assert.ok(existsSync(path.join(dir, 'public', 'fileadmin', 'local.pdf')));
    // The same names on a case-sensitive volume are no collision at all. (The fake rsync writes
    // two other names, since the disk under this test may itself ignore case.)
    const sensitive = server(facts({}, ['user_upload/Logo.png', 'user_upload/logo.png']), ['user_upload/Logo.png', 'user_upload/logo-2.png']);
    const manifest = await pullLiveDataset({ project: dir, hostName: 'live', out: path.join(dir, 'd'), skipDb: true, run: sensitive.run,
      log: () => {}, caseInsensitive: () => false });
    assert.deepEqual(manifest.files.case_check, { target_case_insensitive: false, collisions: [], files_lost: 0, acceptance: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an accepted collision is recorded with its evidence hash and the count expects the lost file', async () => {
  const dir = project();
  try {
    const evidence = path.join(dir, 'case-collisions.md');
    writeFileSync(evidence, 'Owner accepts that user_upload/Logo.png and user_upload/logo.png arrive as one file.\n');
    // A case-insensitive volume keeps one of the two: rsync leaves two files for three remote names.
    const { run } = server(facts({}, ['user_upload/Logo.png', 'user_upload/logo.png', 'b.pdf']), ['user_upload/logo.png', 'b.pdf']);
    const lines = [];
    const manifest = await pullLiveDataset({ project: dir, hostName: 'live', out: path.join(dir, 'd'), skipDb: true, run,
      log: (line) => lines.push(line), caseInsensitive: () => true, acceptCaseCollisions: evidence });
    assert.deepEqual([manifest.files.remote_count, manifest.files.local_count], [3, 2]);
    assert.equal(manifest.files.case_check.files_lost, 1);
    assert.deepEqual(manifest.files.case_check.collisions[0].names, ['user_upload/Logo.png', 'user_upload/logo.png']);
    assert.equal(manifest.files.case_check.acceptance.evidence, 'case-collisions.md');
    assert.match(manifest.files.case_check.acceptance.sha256, /^sha256:[0-9a-f]{64}$/);
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'd', 'live-dataset.json'), 'utf8')).files.case_check, manifest.files.case_check);
    assert.ok(lines.some((line) => line.includes('accepting 1 lost file(s) on case-collisions.md')), 'never silent');

    // A file meeting a directory cannot be written at all, so no evidence makes it acceptable.
    const blocked = server(facts({}, ['docs', 'Docs/x.pdf']));
    await assert.rejects(pullLiveDataset({ project: dir, hostName: 'live', out: path.join(dir, 'e'), run: blocked.run, log: () => {},
      caseInsensitive: () => true, acceptCaseCollisions: evidence }), (error) => error.exitCode === 5 && /cannot both exist/.test(error.message));
    assert.deepEqual(blocked.calls, ['ssh']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an acceptance needs a readable, non-empty evidence file, checked before any ssh', async () => {
  const dir = project();
  try {
    writeFileSync(path.join(dir, 'empty.md'), ' \n');
    for (const [file, reason] of [['missing.md', /unreadable \(ENOENT\)/], ['empty.md', /is empty/]]) {
      const { calls, run } = server(facts());
      await assert.rejects(pullLiveDataset({ project: dir, hostName: 'live', out: path.join(dir, 'd'), run, log: () => {},
        acceptCaseCollisions: path.join(dir, file) }), (error) => error.exitCode === 5 && reason.test(error.message));
      assert.deepEqual(calls, []);
    }
    // The CLI returns the refusal's exit code; this run stops before ssh, so nothing leaves the machine.
    const cli = spawnSync(process.execPath, [SCRIPT, '--project', dir, '--host', 'live', '--out', path.join(dir, 'd'),
      '--accept-case-collisions', path.join(dir, 'missing.md')], { encoding: 'utf8' });
    assert.equal(cli.status, 5, cli.stderr);
    assert.match(cli.stderr, /--accept-case-collisions .*missing\.md is unreadable/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the case probe answers for the target volume and leaves nothing behind', () => {
  const dir = tmp('t3u-case-');
  try {
    writeFileSync(path.join(dir, 'probe-lower'), '');
    const independent = existsSync(path.join(dir, 'PROBE-LOWER'));
    rmSync(path.join(dir, 'probe-lower'));
    assert.equal(caseInsensitiveAt(path.join(dir, 'public', 'not-yet')), independent, 'a missing target is probed at its nearest parent');
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- 3. + 4. discover-urls: default seed and sitemap entry points -----------------------------

test('a blank seed is no seed: the run-specific default applies', () => {
  const state = emptyState({ runId: '2026-10-01-example', now: '2026-10-01T00:00:00.000Z' });
  assert.equal(state.manifest.seed, '', 'state starts with an empty string');
  assert.equal(discoverySeed({}, state), '2026-10-01-example-visual');
  assert.equal(discoverySeed({ seed: '  ' }, state), '2026-10-01-example-visual');
  assert.equal(discoverySeed({ seed: 'chosen' }, state), 'chosen');
  state.manifest.seed = 'recorded';
  assert.equal(discoverySeed({}, state), 'recorded');
  assert.equal(discoverySeed({ seed: 'chosen' }, state), 'chosen');
});

const BASE = new URL('https://site.ddev.site/');
const SITE = (identifier, config) => ({ identifier, config: { rootPageId: 1, base: 'https://www.example.org/',
  baseVariants: [{ base: 'https://site.ddev.site/', condition: 'applicationContext == "Development"' }],
  languages: [{ languageId: 0, base: '/', locale: 'de_AT.UTF-8', hreflang: 'de-AT' },
    { languageId: 1, base: '/en/', locale: 'en_GB.UTF-8', hreflang: 'en-GB' }], ...config } });
const entries = (sites, languages) => sitemapEntryPoints(siteRouting(sites, BASE), BASE, { languages });

test('sitemap entry points follow the site language bases: the default language is /sitemap.xml, never /de/sitemap.xml', () => {
  const two = entries([SITE('main')], ['de', 'en']);
  assert.deepEqual(two, { entryPoints: ['https://site.ddev.site/sitemap.xml', 'https://site.ddev.site/en/sitemap.xml'], warnings: [] });
  // A default language based at /de/ is asked there, and / is not guessed.
  const prefixed = entries([SITE('main', { languages: [{ languageId: 0, base: '/de/', locale: 'de_AT.UTF-8' }, { languageId: 1, base: '/en/', hreflang: 'en' }] })], ['de']);
  assert.deepEqual(prefixed.entryPoints, ['https://site.ddev.site/de/sitemap.xml']);
  // Nothing selected: every served language, as for the page tree; a selection leaves the others out.
  const three = SITE('main', { languages: [...SITE('main').config.languages, { languageId: 2, base: '/fr/', locale: 'fr_FR.UTF-8' }] });
  assert.equal(entries([three], []).entryPoints.length, 3);
  assert.deepEqual(entries([three], ['en']).entryPoints, ['https://site.ddev.site/sitemap.xml', 'https://site.ddev.site/en/sitemap.xml']);
  // A second site in a subpath of this origin brings its own sitemap.
  const shop = { identifier: 'shop', config: { rootPageId: 100, base: 'https://site.ddev.site/shop/', languages: [{ languageId: 0, base: '/' }] } };
  assert.ok(entries([SITE('main'), shop], ['de']).entryPoints.includes('https://site.ddev.site/shop/sitemap.xml'));
});

test('a site served elsewhere, an unknown --languages value and a missing site configuration say so', () => {
  const other = { identifier: 'other', config: { rootPageId: 200, base: 'https://www.example.com/',
    baseVariants: [{ base: 'https://other.ddev.site/', condition: 'x' }], languages: [{ languageId: 0, base: '/' }, { languageId: 1, base: '/fr/' }] } };
  const mixed = entries([SITE('main'), other], ['de', 'en', 'it']);
  assert.deepEqual(mixed.entryPoints, ['https://site.ddev.site/sitemap.xml', 'https://site.ddev.site/en/sitemap.xml']);
  assert.deepEqual(mixed.warnings, ['site other language 0 is served from another host; its sitemap is not requested',
    '--languages it name no configured site language; no sitemap is requested for them']);
  const placeholder = entries([SITE('main', { languages: [{ languageId: 0, base: '/' }, { languageId: 1, base: '%env(BASE_EN)%', hreflang: 'en' }] })], ['en']);
  assert.match(placeholder.warnings[0], /language 1 is based on the unresolved placeholder %env\(BASE_EN\)%; its sitemap is not requested/);
  // Without config/sites the old guess stays, and is called a guess.
  const guessed = entries([], ['de', 'en']);
  assert.deepEqual(guessed.entryPoints, ['https://site.ddev.site/sitemap.xml', 'https://site.ddev.site/de/sitemap.xml', 'https://site.ddev.site/en/sitemap.xml']);
  assert.match(guessed.warnings[0], /^no config\/sites\/\*\/config\.yaml; sitemap entry points are guessed/);
  assert.match(entries([other], []).warnings.at(-1), /names no language served on https:\/\/site\.ddev\.site; sitemap entry points are guessed/);
});

test('discover-urls asks only the configured sitemaps and seals the run-specific seed', async () => {
  const requests = [];
  const sitemap = (origin, paths) => `<?xml version="1.0"?><urlset>${paths.map((p) => `<url><loc>${origin}${p}</loc></url>`).join('')}</urlset>`;
  const web = http.createServer((req, res) => {
    requests.push(req.url);
    const origin = `http://127.0.0.1:${web.address().port}`;
    const body = { '/sitemap.xml': sitemap(origin, ['/', '/kontakt']), '/en/sitemap.xml': sitemap(origin, ['/en/', '/en/contact']) }[req.url];
    res.writeHead(body ? 200 : 404, { 'content-type': body ? 'application/xml' : 'text/plain' });
    res.end(body ?? 'not found');
  });
  await new Promise((resolve) => web.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${web.address().port}`;
  const dir = tmp('t3u-discover-');
  try {
    mkdirSync(path.join(dir, 'config', 'sites', 'main'), { recursive: true });
    writeFileSync(path.join(dir, 'config', 'sites', 'main', 'config.yaml'), stringifyYaml({ rootPageId: 1, base: `${origin}/`,
      languages: [{ languageId: 0, base: '/', locale: 'de_AT.UTF-8' }, { languageId: 1, base: '/en/', locale: 'en_GB.UTF-8' }] }));
    const paths = new RunPaths('.typo3-update', dir);
    mkdirSync(paths.root, { recursive: true });
    await new StateStore(paths).write(emptyState({ runId: '2026-10-01-example', now: '2026-10-01T00:00:00.000Z' }));
    const warnings = [];
    const result = await discoverUrls({ values: { 'base-url': origin, languages: 'de,en' }, paths, cwd: dir,
      log: { ...quiet, warn: (message) => warnings.push(message) }, journal: { async append() {} } });
    assert.deepEqual(requests.sort(), ['/en/sitemap.xml', '/sitemap.xml'], 'no request for /de/sitemap.xml');
    assert.deepEqual([result.exitCode, result.failedSitemaps, warnings], [0, 0, []]);
    const manifest = JSON.parse(await readFile(paths.urlManifest, 'utf8'));
    assert.equal(manifest.seed, '2026-10-01-example-visual');
    assert.equal((await new StateStore(paths).read()).manifest.seed, '2026-10-01-example-visual');
    assert.deepEqual(manifest.allUrls.map((u) => new URL(u.url).pathname).sort(), ['/', '/en/', '/en/contact', '/kontakt']);
  } finally {
    await new Promise((resolve) => web.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- 5. backend-permissions-audit: modules of every installed package -------------------------

const CORE_MODULES = `<?php
/** Definitions for the main modules */
return [
    'content' => [
        'labels' => 'core.modules.content',
        'aliases' => ['web'],
    ],
    'records' => [
        'parent' => 'content',
        'aliases' => ['web_list'],
        'moduleData' => ['clipBoard' => true],
    ],
];
`;
const POWERMAIL_MODULES = `<?php
return [
    'web_powermail' => [
        'parent' => 'web',
        'controllerActions' => [
            \\Vendor\\Powermail\\ModuleController::class =>
                'list, exportXls',
        ],
    ],
    'powermail_list' => ['parent' => 'web_powermail', 'position' => ['after' => '*']],
];
`;
// Returned from inside an if, eight spaces deep, with an uppercase letter: the old regex saw nothing.
const NEWS_MODULES = `<?php
declare(strict_types=1);
$configuration = GeneralUtility::makeInstance(EmConfiguration::class);
if ($configuration->getShowAdministrationModule()) {
    $version = (new Typo3Version())->getMajorVersion();
    return [
        'web_newsAdministration' => [
            'parent' => 'web',
            'iconIdentifier' => $version >= 14 ? 'a' : 'b',
        ],
    ];
}
return [];
`;

test("module identifiers are the outermost keys wherever the array is returned, plus each module's aliases", () => {
  assert.deepEqual([...moduleIdentifiers(CORE_MODULES).ids], ['content', 'records']);
  assert.deepEqual([...moduleIdentifiers(CORE_MODULES).aliases], [['web', 'content'], ['web_list', 'records']]);
  assert.deepEqual([...moduleIdentifiers(POWERMAIL_MODULES).ids], ['web_powermail', 'powermail_list']);
  assert.deepEqual([...moduleIdentifiers(NEWS_MODULES).ids], ['web_newsAdministration']);
  const tricky = `<?php
// 'commented_out' => [],
/* 'also_commented' => [], */
# 'hash_commented' => [],
$modules = array(
    'old_style' => array('parent' => 'web'),
);
$modules['added_later'] = ['parent' => 'web'];
return $modules + ['labels_only' => "a 'quoted' => [] key"];`;
  const found = moduleIdentifiers(tricky).ids;
  assert.deepEqual([...found].filter((id) => !['parent'].includes(id)), ['old_style', 'labels_only']);
  assert.ok(!found.has('commented_out') && !found.has('also_commented') && !found.has('hash_commented'));
});

function composerProject({ installedJson = true, composerRoot = '' } = {}) {
  const dir = tmp('t3u-modules-');
  const root = path.join(dir, composerRoot);
  const write = (file, text) => { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), text); };
  write('vendor/typo3/cms-core/Configuration/Backend/Modules.php', CORE_MODULES);
  write('vendor/vendor-a/powermail/Configuration/Backend/Modules.php', POWERMAIL_MODULES);
  write('vendor/vendor-b/news/Configuration/Backend/Modules.php', NEWS_MODULES);
  write('packages/sitepackage/Configuration/Backend/Modules.php', "<?php return ['site_dashboard' => []];");
  // Left behind by an earlier install and no longer in installed.json.
  write('vendor/vendor-c/removed/Configuration/Backend/Modules.php', "<?php return ['removed_module' => []];");
  if (installedJson) {
    write('vendor/composer/installed.json', JSON.stringify({ packages: [
      { name: 'typo3/cms-core', type: 'typo3-cms-framework', 'install-path': '../typo3/cms-core' },
      { name: 'vendor-a/powermail', type: 'typo3-cms-extension', 'install-path': '../vendor-a/powermail' },
      { name: 'vendor-b/news', type: 'typo3-cms-extension', 'install-path': '../vendor-b/news' },
      { name: 'example/sitepackage', type: 'typo3-cms-extension', 'install-path': '../../packages/sitepackage' },
      { name: 'example/meta', type: 'metapackage', 'install-path': null },
    ] }));
  }
  if (composerRoot) {
    mkdirSync(path.join(dir, '.ddev'), { recursive: true });
    writeFileSync(path.join(dir, '.ddev', 'config.yaml'), `name: example\ncomposer_root: ${composerRoot}\n`);
  }
  return dir;
}

test('the module inventory covers every installed package, local path packages included', () => {
  const dir = composerProject();
  try {
    const modules = registeredModules(dir);
    assert.equal(modules.source, path.join('vendor', 'composer', 'installed.json'));
    assert.equal(modules.files, 4);
    assert.deepEqual([...modules.ids].sort(), ['content', 'powermail_list', 'records', 'site_dashboard', 'web_newsAdministration', 'web_powermail']);
    // What a be_group grants, judged against it: extension modules resolve, aliases name their successor.
    assert.deepEqual(unknownModuleEntries(['web_layout_gone', 'web_powermail', 'web_newsAdministration', 'web_list', 'removed_module'], modules), {
      gone: ['web_layout_gone', 'removed_module'], renamed: [{ alias: 'web_list', module: 'records' }],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('without installed.json the whole vendor tree is scanned, and DDEV composer_root is honoured', () => {
  const scanned = composerProject({ installedJson: false });
  const nested = composerProject({ composerRoot: 'app' });
  try {
    const modules = registeredModules(scanned);
    assert.match(modules.source, /^directory scan/);
    // No stop after Core: vendor extensions count, and so does the leftover directory a scan cannot tell apart.
    for (const id of ['content', 'web_powermail', 'web_newsAdministration', 'site_dashboard', 'removed_module']) assert.ok(modules.ids.has(id), id);
    const app = registeredModules(nested);
    assert.equal(app.source, path.join('app', 'vendor', 'composer', 'installed.json'));
    assert.ok(app.ids.has('web_powermail') && app.ids.has('site_dashboard'));
  } finally {
    rmSync(scanned, { recursive: true, force: true });
    rmSync(nested, { recursive: true, force: true });
  }
});

// ---- 6. absolute --run-dir -------------------------------------------------------------------

function runProject() {
  const dir = tmp('t3u-abs-');
  writeFileSync(path.join(dir, 'composer.json'), '{}\n');
  return dir;
}

test('an absolute run directory is judged by real paths and adopts the project that holds it', () => {
  const project = runProject();
  const elsewhere = tmp('t3u-elsewhere-');
  const link = path.join(elsewhere, 'link');
  try {
    symlinkSync(project, link);
    // The same directory through a symlink (macOS /tmp, /var) is inside the project, spelled from the cwd.
    const viaLink = new RunPaths(path.join(link, '.typo3-update'), project);
    assert.deepEqual([viaLink.root, viaLink.project], [path.join(project, '.typo3-update'), project]);
    // From another directory the run's own project becomes the working project.
    const fromElsewhere = new RunPaths(path.join(project, '.typo3-update'), elsewhere);
    assert.deepEqual([fromElsewhere.root, fromElsewhere.project], [path.join(realpathSync(project), '.typo3-update'), realpathSync(project)]);
    // A subdirectory of the project is not the project.
    mkdirSync(path.join(project, 'packages', 'ext'), { recursive: true });
    assert.equal(new RunPaths(path.join(project, '.typo3-update'), path.join(project, 'packages', 'ext')).project, realpathSync(project));
    // No project above it: refused, and the message says why.
    assert.throws(() => new RunPaths(path.join(elsewhere, 'run'), project), /is not inside a project: no \.ddev, composer\.json, \.git in it or above it/);
    // A relative path that climbs out stays refused.
    assert.throws(() => new RunPaths('../../etc', project), /resolves to .* outside /);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  }
});

test("node-brief with an absolute --run-dir from another directory works in the run's project", async () => {
  const project = runProject();
  const elsewhere = tmp('t3u-elsewhere-');
  const nowhere = tmp('t3u-nowhere-');
  const caller = process.cwd();
  try {
    const paths = new RunPaths('.typo3-update', project);
    mkdirSync(paths.configDir, { recursive: true });
    writeFileSync(paths.graphDefinition, readFileSync(DEFAULT_GRAPH, 'utf8'));
    const state = emptyState({ runId: '2026-10-01-example', now: '2026-10-01T00:00:00.000Z' });
    state.project.trusted_origin = 'https://site.ddev.site';
    await new StateStore(paths).write(state);
    await graphInit({ values: {}, paths, log: quiet, journal: { async append() {} } });

    process.chdir(elsewhere);
    let seen = null;
    const brief = async (ctx) => {
      const result = await nodeBrief({ ...ctx, values: { ...ctx.values, json: true } });
      seen = { cwd: process.cwd(), root: ctx.paths.root, status: result.brief.status };
      return result;
    };
    const exitCode = await runCommand({ command: 'node-brief', argv: ['node-brief'], positionals: [], actions: { 'node-brief': brief },
      values: { 'run-dir': path.join(project, '.typo3-update'), node: 'intake', quiet: true } });
    assert.equal(exitCode, 0);
    assert.deepEqual(seen, { cwd: realpathSync(project), root: path.join(realpathSync(project), '.typo3-update'), status: 'ready' });
    assert.equal(process.cwd(), realpathSync(elsewhere), "the caller's directory is restored");

    // A refused run directory (in no project, outside the cwd) is a clean harness error, not an uncaught exception.
    seen = null;
    const refused = await runCommand({ command: 'node-brief', argv: ['node-brief'], positionals: [], actions: { 'node-brief': brief },
      values: { 'run-dir': path.join(nowhere, 'run'), node: 'intake', quiet: true } });
    assert.deepEqual([refused, seen], [2, null]);
  } finally {
    process.chdir(caller);
    rmSync(project, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
    rmSync(nowhere, { recursive: true, force: true });
  }
});
