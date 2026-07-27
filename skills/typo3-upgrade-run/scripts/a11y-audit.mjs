#!/usr/bin/env node
/**
 * Accessibility audit with axe-core.
 *
 * Samples by template class rather than uniformly — see lighthouse-sample.mjs for why:
 * a sitemap that is mostly leaf pages measures the leaf template over and over and never
 * touches the listing template, and accessibility defects live in templates, not in pages.
 *
 * Findings are split by whether fixing them can change what the page looks like, because
 * during an invariance run that distinction decides who may fix what:
 *
 *   invariant  alt text, labels, lang, roles, discernible link text, list markup —
 *              attribute and structure changes that leave every pixel where it was.
 *   visual     colour contrast, target size, text spacing, reflow — these move or
 *              recolour something and need their own approval and baseline.
 *
 * Automated testing covers roughly a third to a half of WCAG. Never report an axe-clean
 * run as "accessible"; report it as "no automated violations", and keep the manual work
 * (keyboard order, focus visibility, screen-reader labels, meaningful alt text) separate.
 *
 * Usage:
 *   node a11y-audit.mjs --base-url https://site.ddev.site --ddev-dir /path \
 *     [--count 12] [--seed 1] [--tags wcag2a,wcag2aa,wcag21a,wcag21aa] [--report out.json]
 *
 * Exit: 0 no violations · 1 violations found · 3 invalid arguments
 */
import { chromium } from 'playwright';
import { writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  if (i < 0) return d;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};

const baseUrl = String(opt('base-url') || '').replace(/\/$/, '');
const ddevDir = opt('ddev-dir', process.cwd());
const count = Number(opt('count', 12));
const seed = Number(opt('seed', 1));
const tags = String(opt('tags', 'wcag2a,wcag2aa,wcag21a,wcag21aa')).split(',');
const reportPath = opt('report');

if (!baseUrl) { console.error('--base-url is required'); process.exit(3); }

const sql = (q) => execFileSync('ddev', ['mysql', '-N', '-e', q], {
  cwd: ddevDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
}).trim();

// Rules whose remedy necessarily changes pixels. Everything else can be fixed while a
// visual invariance gate stays green.
const VISUAL_RULES = new Set([
  'color-contrast', 'color-contrast-enhanced', 'target-size',
  'meta-viewport', 'meta-viewport-large', 'scrollable-region-focusable',
]);

const mulberry = (a) => () => {
  a |= 0; a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const shuffle = (arr, rnd) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const rows = sql(`
  SELECT p.uid, p.slug,
    (SELECT COUNT(*) FROM pages c WHERE c.pid = p.uid AND c.deleted = 0 AND c.hidden = 0) AS kids
  FROM pages p
  WHERE p.deleted = 0 AND p.hidden = 0 AND p.doktype = 1 AND p.slug <> ''
`).split('\n').filter(Boolean).map((l) => {
  const [uid, slug, kids] = l.split('\t');
  return { uid: Number(uid), slug, kids: Number(kids) };
});
if (!rows.length) { console.error('no candidate pages'); process.exit(3); }

const classify = (r) => (r.slug === '/' ? 'home' : (r.kids > 0 ? 'listing' : 'detail'));
const buckets = { home: [], listing: [], detail: [] };
for (const r of rows) buckets[classify(r)].push(r);
// the site root is often a shortcut and therefore missing from a doktype=1 query
if (!buckets.home.length) buckets.home.push({ uid: 0, slug: '/', kids: 0 });

const rnd = mulberry(seed);
const picked = [];
const seen = new Set();
const take = (r) => {
  if (!r || seen.has(r.uid) || picked.length >= count) return;
  seen.add(r.uid); picked.push({ ...r, klass: classify(r) });
};
for (const k of ['home', 'listing', 'detail']) take(shuffle(buckets[k], rnd)[0]);
for (const r of shuffle(rows, rnd)) take(r);

const axeSource = readFileSync(require_.resolve('axe-core/axe.min.js'), 'utf8');

console.log(`\naxe-core audit — ${picked.length} page(s), tags ${tags.join(',')}, seed ${seed}\n`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } });
const byRule = new Map();
const perPage = [];

for (const p of picked) {
  const page = await ctx.newPage();
  const url = `${baseUrl}${p.slug}`;
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
    await page.addScriptTag({ content: axeSource });
    const res = await page.evaluate(async (t) => {
      // eslint-disable-next-line no-undef
      const r = await axe.run(document, { runOnly: { type: 'tag', values: t } });
      return r.violations.map((v) => ({
        id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl,
        nodes: v.nodes.length,
        targets: v.nodes.slice(0, 4).map((n) => n.target.join(' ')),
        snippets: v.nodes.slice(0, 3).map((n) => n.html.slice(0, 180)),
      }));
    }, tags);
    perPage.push({ slug: p.slug, klass: p.klass, violations: res.length });
    for (const v of res) {
      const e = byRule.get(v.id) ?? {
        id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl,
        pages: 0, nodes: 0, targets: new Set(), snippets: new Set(),
        visualFix: VISUAL_RULES.has(v.id),
      };
      e.pages += 1; e.nodes += v.nodes;
      v.targets.forEach((t) => e.targets.add(t));
      v.snippets.forEach((s) => e.snippets.add(s));
      byRule.set(v.id, e);
    }
    console.log(`  ${res.length ? '✗' : '✓'} ${p.klass.padEnd(8)} ${p.slug.padEnd(44)} ${res.length} rule(s)`);
  } catch (err) {
    console.log(`  ! ${p.slug}: ${err.message.slice(0, 90)}`);
  }
  await page.close();
}
await browser.close();

const rules = [...byRule.values()]
  .map((r) => ({ ...r, targets: [...r.targets].slice(0, 6), snippets: [...r.snippets].slice(0, 3) }))
  .sort((a, b) => b.nodes - a.nodes);

const invariant = rules.filter((r) => !r.visualFix);
const visual = rules.filter((r) => r.visualFix);

const show = (list, title) => {
  if (!list.length) return;
  console.log(`\n${title}`);
  for (const r of list) {
    console.log(`  ${(r.impact ?? '?').padEnd(8)} ${r.id.padEnd(26)} ${String(r.nodes).padStart(4)} node(s) on ${r.pages} page(s)`);
    console.log(`           ${r.help}`);
    if (r.targets.length) console.log(`           e.g. ${r.targets[0]}`);
  }
};
show(invariant, 'Fixable without changing a single pixel:');
show(visual, 'Fixing these CHANGES the rendering — needs its own approval and baseline:');

console.log(`\n${rules.length} distinct rule(s) across ${perPage.length} page(s).`);
console.log('Automated rules cover roughly a third to a half of WCAG. A clean run means');
console.log('"no automated violations", never "accessible" — keyboard order, focus visibility');
console.log('and whether alt text is actually meaningful still need a human.');

const out = {
  schema: 'typo3-upgrade-run/a11y@1',
  baseUrl, tags, seed, sampled: perPage.length,
  sampling: 'stratified by template class (home/listing/detail), seeded shuffle',
  coverageCaveat: 'axe-core covers ~30-50% of WCAG success criteria. Manual review is not optional.',
  summary: {
    rules: rules.length,
    invariantRules: invariant.length,
    visualChangeRules: visual.length,
    totalNodes: rules.reduce((n, r) => n + r.nodes, 0),
  },
  rules, perPage,
};
if (reportPath) { writeFileSync(reportPath, JSON.stringify(out, null, 2)); console.log(`\nreport: ${reportPath}`); }
process.exit(rules.length ? 1 : 0);
