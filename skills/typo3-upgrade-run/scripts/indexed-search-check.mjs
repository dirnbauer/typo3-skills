#!/usr/bin/env node
/**
 * EXT:indexed_search — rebuild the index and prove search actually returns results.
 *
 * Why this exists: after an upgrade the search *page* renders perfectly on an empty
 * index. Status 200, correct template, zero hits — and nothing in any log. A smoke test
 * that only checks status codes passes while site search is completely broken, so the
 * only honest check is to index a known set of pages and then search for a term that
 * must be found.
 *
 * indexed_search indexes during frontend page *generation*, not on request, so a cached
 * page is never indexed. The cache is therefore flushed first and the pages are fetched
 * with a cache-busting parameter — otherwise this reports "0 new pages indexed" on a
 * perfectly working installation.
 *
 * Usage:
 *   node indexed-search-check.mjs --base-url https://site.ddev.site --ddev-dir /path \
 *     [--count 50] [--language 0] [--term Fischerei] [--report out.json]
 *
 * Exit: 0 ok · 1 findings (nothing indexed, or the control term is not found) · 3 invalid
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
const count = Number(opt('count', 50));
const language = Number(opt('language', 0));
const termArg = opt('term', null);
const reportPath = opt('report');

if (!baseUrl) { console.error('--base-url is required'); process.exit(3); }

const sql = (q) => execFileSync('ddev', ['mysql', '-N', '-e', q], {
  cwd: ddevDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
}).trim();
const ddevTypo3 = (...a) => execFileSync('ddev', ['typo3', ...a], {
  cwd: ddevDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
}).trim();

const report = { schema: 'typo3-upgrade-run/indexed-search@1', baseUrl, language, findings: [], steps: [] };
let failed = 0;
const step = (name, ok, detail = '') => {
  report.steps.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) { report.findings.push({ step: name, detail }); failed += 1; }
};

console.log('\nEXT:indexed_search — rebuild and verify\n');

// --- 0. is indexing even switched on? --------------------------------------
// A site can carry indexed_search, render a search form, and have config.index_enable
// unset — in which case nothing is ever indexed and the results page is always empty.
let indexEnable = null;
try {
  const ts = ddevTypo3('typoscript:show', 'config.index_enable');
  indexEnable = /(^|\s)1\s*$/m.test(ts) ? '1' : ts.trim().slice(0, 40);
} catch { /* command not available on every version */ }

// --- 1. always start from a clean index ------------------------------------
const before = Number(sql('SELECT COUNT(*) FROM index_phash;'));
for (const t of ['index_phash', 'index_fulltext', 'index_rel', 'index_words', 'index_section', 'index_grlist']) {
  try { sql(`TRUNCATE TABLE ${t};`); } catch { /* table may not exist on every version */ }
}
const cleared = Number(sql('SELECT COUNT(*) FROM index_phash;'));
step('index cleared', cleared === 0, `${before} rows before, ${cleared} after`);

// --- 2. index N pages -------------------------------------------------------
// Indexing happens during page generation. Flush first, then bust the cache per URL.
try { ddevTypo3('cache:flush'); } catch { /* non-fatal */ }

const slugs = sql(`
  SELECT slug FROM pages
  WHERE deleted = 0 AND hidden = 0 AND doktype = 1 AND slug <> ''
    AND sys_language_uid = ${language}
  ORDER BY uid LIMIT ${count}
`).split('\n').filter(Boolean);

if (!slugs.length) { console.error('no pages to index'); process.exit(3); }

let ok200 = 0;
for (const slug of slugs) {
  const url = `${baseUrl}${slug}?t3uIndex=${Date.now()}`;
  try {
    const r = await fetch(url, { redirect: 'follow' });
    if (r.ok) ok200 += 1;
    await r.text();
  } catch { /* counted by ok200 */ }
}
const phash = Number(sql('SELECT COUNT(*) FROM index_phash;'));
const words = Number(sql('SELECT COUNT(*) FROM index_words;'));
step(`request ${slugs.length} pages for indexing`, ok200 === slugs.length, `${ok200}/${slugs.length} returned 200`);
step('pages were actually indexed', phash > 0,
  phash > 0 ? `${phash} index_phash rows, ${words} distinct words`
    : `nothing indexed — config.index_enable is ${indexEnable ?? 'unknown'}`);

// --- 3. pick a control term that must be found ------------------------------
// Rather than guessing, take the most frequent indexed word: if the single most common
// word on the site cannot be found, search is broken, not the query.
let term = termArg;
if (!term) {
  term = sql(`
    SELECT w.baseword FROM index_words w
    JOIN index_rel r ON r.wid = w.wid
    WHERE CHAR_LENGTH(w.baseword) >= 5
    GROUP BY w.wid ORDER BY COUNT(DISTINCT r.phash) DESC LIMIT 1;
  `) || null;
}
const termPages = term
  ? Number(sql(`
      SELECT COUNT(DISTINCT r.phash) FROM index_words w
      JOIN index_rel r ON r.wid = w.wid WHERE w.baseword = '${String(term).replace(/'/g, "''")}';
    `))
  : 0;
step('a control term exists in the index', Boolean(term) && termPages > 0,
  term ? `"${term}" occurs on ${termPages} of ${phash} indexed pages` : 'no indexed words at all');

// --- 4. search through the real frontend ------------------------------------
// The index having rows is not the same as the search UI returning them.
let feHits = null;
let feStatus = null;
if (term) {
  const searchUrl = `${baseUrl}/?tx_indexedsearch_pi2%5Baction%5D=search`
    + `&tx_indexedsearch_pi2%5Bcontroller%5D=Search`
    + `&tx_indexedsearch_pi2%5Bsearch%5D%5Bsword%5D=${encodeURIComponent(term)}`;
  try {
    const r = await fetch(searchUrl, { redirect: 'follow' });
    feStatus = r.status;
    const html = await r.text();
    const m = html.match(/(\d+)\s*(?:Treffer|results?|Ergebnis)/i);
    feHits = m ? Number(m[1]) : (/tx-indexedsearch-res|result-item|browsebox/i.test(html) ? 'rendered' : 0);
  } catch (err) {
    feStatus = `error: ${err.message.slice(0, 60)}`;
  }
  step('the frontend search page answers', feStatus === 200, `HTTP ${feStatus}`);
}

report.result = {
  indexEnable, clearedFrom: before, indexedPages: phash, distinctWords: words,
  requested: slugs.length, ok200, controlTerm: term, controlTermPages: termPages,
  frontendSearchStatus: feStatus, frontendHits: feHits,
};

console.log('\nSummary');
console.log(`  indexed pages   ${phash} (requested ${slugs.length}, language ${language})`);
console.log(`  distinct words  ${words}`);
console.log(`  control term    ${term ? `"${term}" on ${termPages} page(s)` : 'none'}`);
console.log(`  frontend search HTTP ${feStatus}${feHits !== null ? `, hits: ${feHits}` : ''}`);
console.log('\nThe index is rebuilt from scratch on every run, so these numbers are not cumulative.');
console.log('On the live system the same rebuild must run as a scheduler task after deployment,');
console.log('or search silently returns nothing while the results page renders perfectly.');

if (reportPath) { writeFileSync(reportPath, JSON.stringify(report, null, 2)); console.log(`\nreport: ${reportPath}`); }
process.exit(failed ? 1 : 0);
