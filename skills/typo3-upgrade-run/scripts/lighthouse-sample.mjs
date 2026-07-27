#!/usr/bin/env node
/**
 * Lighthouse over a representative sitemap sample.
 *
 * A random sample of a site is not a representative sample of its *templates*. Picking
 * ten URLs uniformly from a sitemap that is 80% leaf pages measures the leaf template
 * ten times and never touches the listing template — which is usually the slow one,
 * because it renders many records and many images. So the sample is stratified:
 *
 *   home     the site root
 *   listing  a page that has children (section index, news list, archive)
 *   detail   a leaf page (news detail, article, single record)
 *
 * Every class is guaranteed at least one URL before the remainder is filled randomly
 * from a seeded shuffle, so the run is reproducible.
 *
 * Scores are LOCAL. A DDEV score is not a field score and must never be reported as
 * one: the network is loopback, the cache is warm and the CPU is a laptop. The number
 * that carries meaning is the BEFORE/AFTER delta on the same machine.
 *
 * Usage:
 *   node lighthouse-sample.mjs --base-url https://site.ddev.site --ddev-dir /path \
 *     [--count 10] [--runs 1] [--form-factor mobile|desktop] [--seed 1] [--report out.json]
 *
 * Exit: 0 ok · 1 a page failed to audit · 3 invalid arguments
 */
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  if (i < 0) return d;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};

const baseUrl = String(opt('base-url') || '').replace(/\/$/, '');
const ddevDir = opt('ddev-dir', process.cwd());
const count = Number(opt('count', 10));
const runs = Number(opt('runs', 1));
const formFactor = String(opt('form-factor', 'mobile'));
const seed = Number(opt('seed', 1));
const reportPath = opt('report');

if (!baseUrl) { console.error('--base-url is required'); process.exit(3); }

const sql = (q) => execFileSync('ddev', ['mysql', '-N', '-e', q], {
  cwd: ddevDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
}).trim();

// Deterministic shuffle so a rerun audits the same pages.
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

// --- build the stratified sample ------------------------------------------
// doktype 1 only: shortcuts redirect and links leave the site, and auditing either
// measures a page the visitor never actually waits for.
const rows = sql(`
  SELECT p.uid, p.slug,
    (SELECT COUNT(*) FROM pages c WHERE c.pid = p.uid AND c.deleted = 0 AND c.hidden = 0) AS kids
  FROM pages p
  WHERE p.deleted = 0 AND p.hidden = 0 AND p.doktype = 1 AND p.slug <> ''
`).split('\n').filter(Boolean).map((l) => {
  const [uid, slug, kids] = l.split('\t');
  return { uid: Number(uid), slug, kids: Number(kids) };
});

if (!rows.length) { console.error('no candidate pages found'); process.exit(3); }

const classify = (r) => {
  if (r.slug === '/') return 'home';
  return r.kids > 0 ? 'listing' : 'detail';
};
const buckets = { home: [], listing: [], detail: [] };
for (const r of rows) buckets[classify(r)].push(r);

// The site root is frequently `doktype 4` (a shortcut), which the doktype filter above
// excludes — and then the sample silently contains no home page at all, the one URL
// every visitor loads. Add `/` explicitly when nothing classified as home.
if (!buckets.home.length) {
  buckets.home.push({ uid: 0, slug: '/', kids: 0, viaRoot: true });
}

const rnd = mulberry(seed);
const picked = [];
const seen = new Set();
const take = (r) => {
  if (!r || seen.has(r.uid) || picked.length >= count) return;
  seen.add(r.uid); picked.push({ ...r, klass: classify(r) });
};
// guarantee one of each class first
for (const k of ['home', 'listing', 'detail']) take(shuffle(buckets[k], rnd)[0]);
// then fill randomly across everything
for (const r of shuffle(rows, rnd)) take(r);

console.log(`\nLighthouse sample — ${picked.length} page(s), form factor ${formFactor}, seed ${seed}`);
for (const p of picked) console.log(`  ${p.klass.padEnd(8)} ${p.slug}`);

// --- audit -----------------------------------------------------------------
const lighthouse = (await import('lighthouse')).default;
const chromeLauncher = await import('chrome-launcher');

const chrome = await chromeLauncher.launch({
  chromeFlags: ['--headless=new', '--no-sandbox', '--ignore-certificate-errors'],
});

const results = [];
let failures = 0;

for (const p of picked) {
  const url = `${baseUrl}${p.slug}`;
  const scores = [];
  const metrics = [];
  for (let i = 0; i < runs; i += 1) {
    try {
      const r = await lighthouse(url, {
        port: chrome.port,
        output: 'json',
        logLevel: 'error',
        formFactor,
        screenEmulation: formFactor === 'desktop'
          ? { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false }
          : undefined,
        onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
      });
      const c = r.lhr.categories;
      scores.push({
        performance: Math.round((c.performance?.score ?? 0) * 100),
        accessibility: Math.round((c.accessibility?.score ?? 0) * 100),
        bestPractices: Math.round((c['best-practices']?.score ?? 0) * 100),
        seo: Math.round((c.seo?.score ?? 0) * 100),
      });
      const a = r.lhr.audits;
      metrics.push({
        lcp: a['largest-contentful-paint']?.numericValue ?? null,
        cls: a['cumulative-layout-shift']?.numericValue ?? null,
        tbt: a['total-blocking-time']?.numericValue ?? null,
        fcp: a['first-contentful-paint']?.numericValue ?? null,
      });
    } catch (err) {
      console.error(`  ✗ ${p.slug}: ${err.message.slice(0, 120)}`);
      failures += 1;
    }
  }
  if (!scores.length) continue;
  const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const row = {
    slug: p.slug, klass: p.klass, runs: scores.length,
    performance: median(scores.map((s) => s.performance)),
    accessibility: median(scores.map((s) => s.accessibility)),
    bestPractices: median(scores.map((s) => s.bestPractices)),
    seo: median(scores.map((s) => s.seo)),
    lcpMs: Math.round(median(metrics.map((m) => m.lcp ?? 0))),
    clsValue: Number(median(metrics.map((m) => m.cls ?? 0)).toFixed(3)),
    tbtMs: Math.round(median(metrics.map((m) => m.tbt ?? 0))),
  };
  results.push(row);
  console.log(`  ✓ ${row.klass.padEnd(8)} ${row.slug.padEnd(42)} `
    + `perf ${String(row.performance).padStart(3)} a11y ${String(row.accessibility).padStart(3)} `
    + `bp ${String(row.bestPractices).padStart(3)} seo ${String(row.seo).padStart(3)} `
    + `| LCP ${row.lcpMs}ms CLS ${row.clsValue} TBT ${row.tbtMs}ms`);
}

await chrome.kill();

const agg = (key) => {
  const xs = results.map((r) => r[key]).sort((a, b) => a - b);
  return xs.length
    ? { median: xs[Math.floor(xs.length / 2)], min: xs[0], max: xs[xs.length - 1] }
    : null;
};
const summary = {
  performance: agg('performance'), accessibility: agg('accessibility'),
  bestPractices: agg('bestPractices'), seo: agg('seo'),
  lcpMs: agg('lcpMs'), tbtMs: agg('tbtMs'),
};

console.log('\nMedian (min–max) across the sample:');
for (const [k, v] of Object.entries(summary)) {
  if (v) console.log(`  ${k.padEnd(14)} ${String(v.median).padStart(5)}  (${v.min}–${v.max})`);
}
console.log('\nThese are LOCAL DDEV measurements: loopback network, warm caches, laptop CPU.');
console.log('They are indicative only — report the before/after delta, never the absolute score.');
console.log('TBT is a lab PROXY for INP. Never write "INP passing" from lab data.');

const out = {
  schema: 'typo3-upgrade-run/lighthouse@1',
  baseUrl, formFactor, seed, runsPerPage: runs,
  sampling: {
    strategy: 'stratified by template class (home/listing/detail), seeded shuffle',
    requested: count, audited: results.length,
    population: { total: rows.length, home: buckets.home.length, listing: buckets.listing.length, detail: buckets.detail.length },
  },
  caveat: 'Local DDEV measurement. Absolute scores are not field data; only the delta is evidence. TBT is an INP proxy.',
  summary, results, failures,
};
if (reportPath) { writeFileSync(reportPath, JSON.stringify(out, null, 2)); console.log(`\nreport: ${reportPath}`); }
process.exit(failures ? 1 : 0);
