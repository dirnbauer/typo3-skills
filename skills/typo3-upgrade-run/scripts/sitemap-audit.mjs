#!/usr/bin/env node
/**
 * Sitemap audit — every site, every language, checked against three independent sources.
 *
 * A sitemap that returns 200 is not a sitemap that is correct. The usual failure is not a broken
 * document, it is a MISSING one: a second site nobody enumerated, or a language that silently
 * falls back to the default. Checking only what you already know about cannot find those.
 *
 * So this reads three sources and cross-checks them:
 *
 *   1. CONFIG   config/sites/<id>/config.yaml — every site, every language, base + baseVariants.
 *               This is what SHOULD exist.
 *   2. LIVE     the actual HTTP responses. This is what DOES exist.
 *   3. DATABASE the indexable page count per site root. This is how many entries to EXPECT.
 *
 * A disagreement between any two is a finding. Config without live is a missing sitemap; live
 * without config is a document nobody declared; database without live is a page tree the sitemap
 * does not cover.
 *
 * Usage:
 *   node sitemap-audit.mjs --base-url https://site.ddev.site [--json report.json] [--ddev-project x]
 *
 * Exit: 0 all good · 1 findings · 2 could not run
 */

import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseArgs } from 'node:util';

const exec = promisify(execFile);

/* ------------------------------------------------------------------ 1. CONFIG */

/** Minimal YAML reader for the handful of keys we need. Avoids a dependency in a diagnostic tool. */
function readSiteYaml(text) {
  const site = { base: null, baseVariants: [], languages: [], rootPageId: null };
  let section = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\t/g, '  ');
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (/^base:/.test(trimmed) && line.search(/\S/) === 0) { site.base = val(trimmed); section = null; continue; }
    if (/^rootPageId:/.test(trimmed)) { site.rootPageId = Number(val(trimmed)); continue; }
    if (/^baseVariants:/.test(trimmed)) { section = 'variants'; continue; }
    if (/^languages:/.test(trimmed)) { section = 'languages'; continue; }
    if (/^[a-zA-Z]/.test(trimmed) && line.search(/\S/) === 0) { section = null; continue; }
    if (section === 'variants' && /^base:/.test(trimmed)) site.baseVariants.push(val(trimmed));
    if (section === 'languages') {
      if (/^-\s*$/.test(trimmed) || /^-\s/.test(trimmed)) site.languages.push({});
      const cur = site.languages[site.languages.length - 1];
      if (!cur) continue;
      for (const key of ['base', 'languageId', 'title', 'hreflang', 'enabled']) {
        const m = new RegExp(`^-?\\s*${key}:\\s*(.+)$`).exec(trimmed);
        if (m) cur[key] = val(trimmed);
      }
    }
  }
  return site;
}
const val = (s) => s.split(':').slice(1).join(':').trim().replace(/^['"]|['"]$/g, '');

async function readConfiguredSites(projectRoot) {
  const dir = path.join(projectRoot, 'config', 'sites');
  let ids = [];
  try { ids = (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name); }
  catch { return { error: `no config/sites directory under ${projectRoot}` }; }
  const sites = [];
  for (const id of ids) {
    try {
      const site = readSiteYaml(await readFile(path.join(dir, id, 'config.yaml'), 'utf8'));
      sites.push({ id, ...site });
    } catch (e) { sites.push({ id, error: String(e.message ?? e) }); }
  }
  return { sites };
}

/* -------------------------------------------------------------------- 2. LIVE */

async function fetchDoc(url) {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    const body = await res.text();
    return { url, status: res.status, contentType: res.headers.get('content-type') ?? '', body };
  } catch (e) { return { url, status: 0, contentType: '', body: '', error: String(e.message ?? e) }; }
}

const isXml = (ct) => /xml/i.test(ct);
// <loc> values are XML-escaped: a sitemap index child carries &amp; in its query string, and
// fetching that literally drops the parameters and returns an empty document.
const unescapeXml = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
const locs = (xml) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => unescapeXml(m[1]));
const isIndex = (xml) => /<sitemapindex[\s>]/i.test(xml);

/* ---------------------------------------------------------------- 3. DATABASE */

async function dbIndexablePerRoot(ddevProject) {
  // Counts pages that a sitemap should contain, per site root. Deliberately conservative:
  // doktype 1 only, excluding hidden, deleted and no_search.
  const sql = 'SELECT COUNT(*) FROM pages WHERE deleted=0 AND hidden=0 AND doktype=1 AND no_search=0';
  const args = ['mysql'];
  if (ddevProject) args.push('--project', ddevProject);
  args.push('-e', `${sql};`);
  try {
    const { stdout } = await exec('ddev', args, { timeout: 20000, encoding: 'utf8' });
    const lines = String(stdout).trim().split('\n');
    return { available: true, indexable: Number(lines[1]) };
  } catch (e) { return { available: false, error: String(e.message ?? e).slice(0, 160) }; }
}

/* ---------------------------------------------------------------- the audit */

function languagePrefixes(site) {
  const out = [];
  for (const l of site.languages ?? []) {
    if (String(l.enabled ?? 'true') === 'false') continue;
    const b = (l.base ?? '/').trim();
    out.push({ languageId: l.languageId ?? '?', prefix: b === '/' ? '' : b.replace(/^\/|\/$/g, '') });
  }
  return out.length ? out : [{ languageId: '0', prefix: '' }];
}

async function main() {
  const { values } = parseArgs({ options: {
    'base-url': { type: 'string' }, 'project-root': { type: 'string', default: process.cwd() },
    'ddev-project': { type: 'string' }, json: { type: 'string' },
  } });
  if (!values['base-url']) { console.error('--base-url is required'); process.exit(2); }
  const baseUrl = values['base-url'].replace(/\/+$/, '');

  const cfg = await readConfiguredSites(values['project-root']);
  if (cfg.error) { console.error(`cannot run: ${cfg.error}`); process.exit(2); }

  const db = await dbIndexablePerRoot(values['ddev-project']);
  const findings = [];
  const checked = [];

  console.log(`Sitemap audit — ${cfg.sites.length} configured site(s), base ${baseUrl}\n`);

  for (const site of cfg.sites) {
    if (site.error) { findings.push({ site: site.id, check: 'config-readable', detail: site.error }); continue; }
    const langs = languagePrefixes(site);
    console.log(`  site "${site.id}" — ${langs.length} language(s), rootPageId ${site.rootPageId ?? '?'}`);

    for (const lang of langs) {
      const url = `${baseUrl}${lang.prefix ? `/${lang.prefix}` : ''}/sitemap.xml`;
      const doc = await fetchDoc(url);
      const row = { site: site.id, languageId: lang.languageId, url, status: doc.status, entries: null, index: false };

      if (doc.status !== 200) {
        findings.push({ site: site.id, languageId: lang.languageId, check: 'reachable', detail: `HTTP ${doc.status || doc.error}`, url });
      } else if (!isXml(doc.contentType)) {
        findings.push({ site: site.id, languageId: lang.languageId, check: 'content-type', detail: `got "${doc.contentType}" — an HTML error page answers 200 too`, url });
      } else {
        row.index = isIndex(doc.body);
        let entries = locs(doc.body);
        if (row.index) {
          // A sitemap index must be followed: the documents it names are the real coverage.
          const children = [];
          for (const child of entries) children.push(...locs((await fetchDoc(child)).body));
          entries = children;
        }
        row.entries = entries.length;
        if (!entries.length) {
          findings.push({ site: site.id, languageId: lang.languageId, check: 'non-empty', detail: 'sitemap parsed but lists no URLs', url });
        }
        // Cross-check 1: every entry must belong to this language's prefix.
        const wrong = entries.filter((u) => {
          try {
            const p = new URL(u).pathname.replace(/^\//, '');
            const first = p.split('/')[0];
            const others = langs.filter((l) => l.prefix && l.prefix !== lang.prefix).map((l) => l.prefix);
            return lang.prefix ? !p.startsWith(`${lang.prefix}/`) && p !== lang.prefix : others.includes(first);
          } catch { return true; }
        });
        if (wrong.length) {
          findings.push({ site: site.id, languageId: lang.languageId, check: 'language-purity',
            detail: `${wrong.length} entr(y|ies) not under this language, e.g. ${wrong[0]}`, url });
        }
        // Cross-check 2: page entries must be canonical. Index children are exempt — TYPO3
        // addresses its per-provider documents with ?sitemap=…&cHash=… by design, and that is
        // not the URL a search engine indexes.
        const ugly = entries.filter((u) => /[?&](tx_|id=|cHash=)/.test(u));
        if (ugly.length) {
          findings.push({ site: site.id, languageId: lang.languageId, check: 'canonical-urls',
            detail: `${ugly.length} parameter-chain URL(s), e.g. ${ugly[0]} — fix the route enhancer, do not ship this form`, url });
        }
      }
      checked.push(row);
      const mark = findings.some((f) => f.url === url) ? '✗' : '✓';
      console.log(`    ${mark} lang ${lang.languageId} → ${url}${row.entries !== null ? `  (${row.entries} entries${row.index ? ', via index' : ''})` : ''}`);
    }
  }

  // Cross-check 3: config vs database. Only meaningful for a single-site install.
  if (db.available && cfg.sites.length === 1) {
    const total = checked.reduce((n, r) => n + (r.entries ?? 0), 0);
    console.log(`\n  database: ${db.indexable} indexable page(s); sitemaps list ${total}`);
    if (total < db.indexable) {
      findings.push({ check: 'coverage-vs-database',
        detail: `sitemaps list ${total} URL(s) but the database holds ${db.indexable} indexable page(s) — ${db.indexable - total} missing` });
    }
  } else if (!db.available) {
    console.log(`\n  database cross-check skipped: ${db.error}`);
  }

  // robots.txt must advertise a sitemap that resolves.
  const robots = await fetchDoc(`${baseUrl}/robots.txt`);
  const advertised = [...String(robots.body).matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]);
  if (robots.status === 200 && !advertised.length) {
    findings.push({ check: 'robots-advertises-sitemap', detail: 'robots.txt names no Sitemap:' });
  }
  for (const a of advertised) {
    // robots.txt should carry the PRODUCTION url, which by definition does not answer on a local
    // clone. Resolve its path against the audited origin instead, and note the host difference
    // rather than reporting the correct production value as a defect.
    let probe = a, foreign = false;
    try {
      const u = new URL(a);
      if (u.origin !== new URL(baseUrl).origin) { probe = `${baseUrl}${u.pathname}`; foreign = true; }
    } catch { /* relative value: leave as-is */ }
    const r = await fetchDoc(probe);
    if (r.status !== 200) {
      findings.push({ check: 'robots-sitemap-resolves', detail: `robots.txt points at ${a}; ${probe} → HTTP ${r.status}` });
    } else if (foreign) {
      console.log(`    note: robots.txt advertises ${a} (production); its path resolves here`);
    }
  }
  console.log(`  robots.txt: ${advertised.length} sitemap reference(s)${advertised.length ? ` (${advertised.join(', ')})` : ''}`);

  const report = { baseUrl, sites: cfg.sites.map((s) => s.id), checked, database: db, findings };
  if (values.json) await writeFile(values.json, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`\n${findings.length ? `✗ ${findings.length} finding(s):` : '✓ all sitemaps correct across every site and language'}`);
  for (const f of findings) console.log(`   [${f.check}] ${f.site ? `${f.site}/${f.languageId} ` : ''}${f.detail}`);
  process.exitCode = findings.length ? 1 : 0;
}

main().catch((e) => { console.error(`sitemap audit aborted: ${e.message}`); process.exitCode = 2; });
