import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { discoverFromPages, PAGE_PARENTS_SQL, PAGE_TREE_SQL, parsePageParents, parsePageTreeRows } from '../../lib/actions/discover.mjs';
import { pagePath, pageTypeSuffix, siteRouting } from '../../lib/net/site-routing.mjs';

const BASE = new URL('https://acme.ddev.site/');
const SITE = (extra = {}) => ({ identifier: 'main', config: { rootPageId: 1, base: 'https://www.acme.at/',
  baseVariants: [{ base: 'https://acme.ddev.site/', condition: 'applicationContext == "Development"' }],
  languages: [
    { languageId: 0, base: '/', locale: 'de_AT.UTF-8', hreflang: 'de-AT' },
    { languageId: 1, base: '/en/', 'iso-639-1': 'en', hreflang: 'en-GB' },
  ], ...extra } });
// uid, doktype, slug, sys_language_uid, l10n_parent: two roots, a news page, an article, English root and news.
const ROWS = ['1\t4\t/\t0\t0', '2\t1\t/news\t0\t0', '5\t1\t/news/article-a\t0\t0', '10\t4\t/\t1\t1', '11\t1\t/news\t1\t2'].join('\n');
const PARENTS = new Map([[1, 0], [2, 1], [5, 2]]);
const parse = (rows, sites, languages = []) => parsePageTreeRows(rows, BASE, { sites: siteRouting(sites, BASE), parents: PARENTS, languages });
const PAGE_TYPE = (suffix) => ({ PageTypeSuffix: { type: 'PageType', default: suffix, map: { [suffix]: 0, 'sitemap.xml': 1533906435 } } });

test('translated pages keep their language base: / for the default language, /en/ for English', () => {
  const parsed = parse(ROWS, [SITE()]);
  assert.deepEqual(parsed.urls, ['https://acme.ddev.site/', 'https://acme.ddev.site/en/', 'https://acme.ddev.site/en/news',
    'https://acme.ddev.site/news', 'https://acme.ddev.site/news/article-a']);
  assert.deepEqual(parsed.records.map((r) => [r.uid, r.language]), [[1, 0], [2, 0], [5, 0], [10, 1], [11, 1]]);
  assert.deepEqual([parsed.skipped, parsed.warnings], [0, []]);
  // Without the site configuration the English root collapses into / and /en/news into /news.
  assert.deepEqual(parsePageTreeRows(ROWS, BASE).urls, ['https://acme.ddev.site/', 'https://acme.ddev.site/news', 'https://acme.ddev.site/news/article-a']);
});

test('--languages selects by id, ISO code, hreflang or locale, and the default language is always in', () => {
  const three = SITE({ languages: [...SITE().config.languages, { languageId: 2, base: '/fr/', locale: 'fr_FR.UTF-8' }] });
  const rows = `${ROWS}\n12\t1\t/actualites\t2\t2`;
  for (const selection of [['1'], ['en'], ['EN'], ['en-gb'], ['de', 'en']]) {
    const parsed = parse(rows, [three], selection);
    assert.deepEqual(parsed.urls.filter((u) => u.includes('/en/')), ['https://acme.ddev.site/en/', 'https://acme.ddev.site/en/news'], selection.join());
    assert.ok(!parsed.urls.some((u) => u.includes('/fr/')), selection.join());
    assert.ok(parsed.urls.includes('https://acme.ddev.site/news/article-a'), 'the default language is always in');
    assert.equal(parsed.skipped, 1);
  }
  assert.ok(parse(rows, [three], ['fr']).urls.includes('https://acme.ddev.site/fr/actualites'));
  assert.equal(parse(rows, [three]).urls.length, 6, 'no selection: every configured language');
  const disabled = SITE({ languages: [SITE().config.languages[0], { ...SITE().config.languages[1], enabled: false }] });
  assert.ok(!parse(ROWS, [disabled]).urls.some((u) => u.includes('/en/')));
});

test('an absolute language base keeps its path on the run origin; a language served elsewhere is left out', () => {
  const sameHost = SITE({ languages: [{ languageId: 0, base: '/' }, { languageId: 1, base: 'https://www.acme.at/en/' }] });
  assert.deepEqual(parse(ROWS, [sameHost]).urls.filter((u) => u.includes('/en/')), ['https://acme.ddev.site/en/', 'https://acme.ddev.site/en/news']);
  const local = SITE({ languages: [{ languageId: 0, base: '/' }, { languageId: 1, base: 'https://acme.ddev.site/english/' }] });
  assert.ok(parse(ROWS, [local]).urls.includes('https://acme.ddev.site/english/news'));
  // A variant on the run's own origin wins without evaluating its condition.
  const variant = SITE({ languages: [{ languageId: 0, base: '/' },
    { languageId: 1, base: 'https://www.acme.com/', baseVariants: [{ base: 'https://acme.ddev.site/en-gb/', condition: 'x' }] }] });
  assert.ok(parse(ROWS, [variant]).urls.includes('https://acme.ddev.site/en-gb/news'));
  const elsewhere = SITE({ languages: [{ languageId: 0, base: '/' },
    { languageId: 1, base: 'https://www.acme.com/', baseVariants: [{ base: 'https://acme-com.ddev.site/', condition: 'x' }] }] });
  const parsed = parse(ROWS, [elsewhere]);
  assert.ok(!parsed.urls.some((u) => u.includes('/en')));
  assert.deepEqual([parsed.skipped, parsed.warnings], [2, ['2 page row(s): site main language 1 is served from https://www.acme.com; left out']]);
  const placeholder = parse(ROWS, [SITE({ languages: [{ languageId: 0, base: '/' }, { languageId: 1, base: '%env(BASE_EN)%' }] })]);
  assert.match(placeholder.warnings[0], /unresolved placeholder %env\(BASE_EN\)%; left out/);
  // A placeholder host still leaves a usable path, for the site as for the language.
  const envHost = SITE({ base: 'https://%env(TYPO3_HOST)%/', baseVariants: [],
    languages: [{ languageId: 0, base: '/' }, { languageId: 1, base: 'https://%env(TYPO3_HOST)%/en/' }] });
  assert.deepEqual(parse(ROWS, [envHost]).urls.filter((u) => u.includes('/en/')), ['https://acme.ddev.site/en/', 'https://acme.ddev.site/en/news']);
});

test('a row in a language its site does not configure is left out with a warning', () => {
  const parsed = parse(`${ROWS}\n13\t1\t/nouvelles\t3\t2`, [SITE()]);
  assert.ok(!parsed.urls.some((u) => u.includes('nouvelles')));
  assert.deepEqual([parsed.skipped, parsed.warnings], [1, ['1 page row(s): site main has no language 3; left out']]);
});

test('pages map to the nearest site root; a page no single root claims keeps base + slug with a warning', () => {
  const shop = { identifier: 'shop', config: { rootPageId: 100, base: 'https://acme.ddev.site/shop/',
    languages: [{ languageId: 0, base: '/' }, { languageId: 1, base: '/en/' }] } };
  const parents = new Map([[1, 0], [2, 1], [100, 2], [101, 100], [200, 0], [201, 200]]);
  const rows = ['101\t1\t/cart\t0\t0', '102\t1\t/cart\t1\t101', '201\t1\t/orphan\t0\t0'].join('\n');
  const parsed = parsePageTreeRows(rows, BASE, { sites: siteRouting([SITE(), shop], BASE), parents });
  assert.deepEqual(parsed.urls, ['https://acme.ddev.site/orphan', 'https://acme.ddev.site/shop/cart', 'https://acme.ddev.site/shop/en/cart']);
  assert.deepEqual(parsed.warnings, ['1 page row(s): no single site root in the rootline; kept base + slug']);
  const twice = parsePageTreeRows('2\t1\t/news\t0\t0', BASE, { sites: siteRouting([SITE(), { ...SITE(), identifier: 'copy' }], BASE), parents });
  assert.deepEqual([twice.urls, twice.warnings.length], [['https://acme.ddev.site/news'], 1]);
});

test('the one PageType enhancer suffix goes on every non-root page URL, combined with the language base', () => {
  assert.deepEqual([pageTypeSuffix(PAGE_TYPE('/')), pageTypeSuffix(PAGE_TYPE('.html')), pageTypeSuffix(undefined)], ['/', '.html', '']);
  assert.equal(pageTypeSuffix({ News: { type: 'Extbase', extension: 'News' } }), '');
  assert.equal(pageTypeSuffix({ a: { type: 'PageType', default: '/' }, b: { type: 'PageType', default: '.html' } }), '');
  assert.deepEqual([pagePath('/', '/', '/'), pagePath('/en/', '/', '.html'), pagePath('/en/', '/news', '/'), pagePath('/', '/impressum', '.html'),
    pagePath('/', '/news/', '/'), pagePath('/', '/news', '')], ['/', '/en/', '/en/news/', '/impressum.html', '/news/', '/news']);
  assert.deepEqual(parse(ROWS, [SITE({ routeEnhancers: PAGE_TYPE('/') })]).urls, ['https://acme.ddev.site/', 'https://acme.ddev.site/en/',
    'https://acme.ddev.site/en/news/', 'https://acme.ddev.site/news/', 'https://acme.ddev.site/news/article-a/']);
  assert.deepEqual(parse(ROWS, [SITE({ routeEnhancers: PAGE_TYPE('.html') })]).urls, ['https://acme.ddev.site/', 'https://acme.ddev.site/en/',
    'https://acme.ddev.site/en/news.html', 'https://acme.ddev.site/news.html', 'https://acme.ddev.site/news/article-a.html']);
  const twoEnhancers = siteRouting([SITE({ routeEnhancers: { ...PAGE_TYPE('/'), Other: { type: 'PageType', default: '.html' } } })], BASE)[0];
  assert.deepEqual([twoEnhancers.suffix, twoEnhancers.warnings], ['', ['site main has 2 PageType enhancers; no suffix is applied']]);
});

test('database discovery reads config/sites and the rootline, and warns instead of guessing', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 't3u-sites-'));
  try {
    await mkdir(path.join(cwd, 'config', 'sites', 'main'), { recursive: true });
    await writeFile(path.join(cwd, 'config', 'sites', 'main', 'config.yaml'), stringifyYaml(SITE({ routeEnhancers: PAGE_TYPE('/') }).config));
    await mkdir(path.join(cwd, 'config', 'sites', 'broken'));
    const queries = [], warned = [], guarded = [];
    const run = async (command, args) => {
      queries.push(args.at(-1));
      return { stdout: args.at(-1) === PAGE_PARENTS_SQL ? '1\t0\n2\t1\n5\t2\nNULL\tx\n' : `${ROWS}\n` };
    };
    const result = await discoverFromPages({ base: BASE, cwd, run, languages: ['de', 'en'],
      log: { step() {}, warn: (message) => warned.push(message) },
      guard: { async assertUrl(url) { guarded.push(url); return { url: new URL(url) }; } } });
    assert.deepEqual(queries, [PAGE_TREE_SQL, PAGE_PARENTS_SQL]);
    assert.match(PAGE_TREE_SQL, /SELECT uid, doktype, slug, sys_language_uid, l10n_parent/);
    assert.deepEqual(result.urls, ['https://acme.ddev.site/', 'https://acme.ddev.site/en/', 'https://acme.ddev.site/en/news/',
      'https://acme.ddev.site/news/', 'https://acme.ddev.site/news/article-a/']);
    assert.deepEqual(guarded, result.urls);
    assert.deepEqual(warned.length, 1);
    assert.match(warned[0], /site broken: config\.yaml unreadable/);
    assert.deepEqual(parsePageParents('1\t0\n2\t1\nNULL\tx\n'), new Map([[1, 0], [2, 1]]));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
