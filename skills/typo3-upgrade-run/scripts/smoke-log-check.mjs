#!/usr/bin/env node
/**
 * Smoke test with log capture — the final "did we break anything" pass.
 *
 * A page can answer 200 and still be broken: a swallowed exception, a deprecation, a failed
 * database query inside a try/catch. The status code says the response arrived, not that it was
 * produced correctly. So this requests pages AND reads what the application wrote while producing
 * them.
 *
 * The word that matters is NEW. Every real project's log already contains entries, and a run that
 * reports all of them says nothing. This marks the log position first, then requests, then reads
 * only what appeared in between — so a pre-existing error stays pre-existing and anything the
 * update introduced stands out alone.
 *
 * Log sources, all of them, because each catches something the others miss:
 *   var/log/typo3_*.log   application log: exceptions, deprecations, PHP warnings
 *   sys_log (database)    backend and DataHandler events, including failures with no HTTP trace
 *   the HTTP response     status codes and TYPO3's own rendered exception output
 *
 * Usage:
 *   node smoke-log-check.mjs --base-url https://site.ddev.site [--count 10] [--seed x] [--json r.json]
 *
 * Exit: 0 no new errors · 1 new errors found · 2 could not run
 */

import { readFile, readdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseArgs } from 'node:util';

const exec = promisify(execFile);

/* Deterministic sampling so the same pages are checked before and after a change. */
function rng(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i += 1) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}
function sample(items, n, seed) {
  const r = rng(seed); const a = [...items];
  for (let i = a.length - 1; i > 0; i -= 1) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, Math.min(n, a.length));
}

const unescapeXml = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
const locs = (xml) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => unescapeXml(m[1]));

async function fetchText(url) {
  try { const r = await fetch(url, { redirect: 'follow' }); return { status: r.status, body: await r.text(), url: r.url }; }
  catch (e) { return { status: 0, body: '', url, error: String(e.message ?? e) }; }
}

/** Collect page URLs from the sitemap, following an index if present. */
async function sitemapUrls(baseUrl) {
  const root = await fetchText(`${baseUrl}/sitemap.xml`);
  if (root.status !== 200) return { error: `sitemap.xml → HTTP ${root.status || root.error}` };
  let urls = locs(root.body);
  if (/<sitemapindex[\s>]/i.test(root.body)) {
    const out = [];
    for (const child of urls) out.push(...locs((await fetchText(child)).body));
    urls = out;
  }
  return { urls: [...new Set(urls)] };
}

async function findLogFile(projectRoot) {
  const dir = path.join(projectRoot, 'var', 'log');
  try {
    const files = (await readdir(dir)).filter((f) => f.startsWith('typo3_') && f.endsWith('.log'));
    if (!files.length) return null;
    const sized = await Promise.all(files.map(async (f) => ({ f, s: (await stat(path.join(dir, f))).size })));
    return path.join(dir, sized.sort((a, b) => b.s - a.s)[0].f);
  } catch { return null; }
}

async function sysLogCount(ddevProject) {
  const args = ['mysql']; if (ddevProject) args.push('--project', ddevProject);
  args.push('-e', 'SELECT COUNT(*) FROM sys_log WHERE error > 0;');
  try { const { stdout } = await exec('ddev', args, { timeout: 20000, encoding: 'utf8' });
    return Number(String(stdout).trim().split('\n')[1]); } catch { return null; }
}

const SEVERE = /\b(CRITICAL|ALERT|EMERGENCY|ERROR)\b/;

async function main() {
  const { values } = parseArgs({ options: {
    'base-url': { type: 'string' }, 'project-root': { type: 'string', default: process.cwd() },
    count: { type: 'string', default: '10' }, seed: { type: 'string', default: 'smoke' },
    'ddev-project': { type: 'string' }, json: { type: 'string' },
    'include-deprecations': { type: 'boolean', default: false },
  } });
  if (!values['base-url']) { console.error('--base-url is required'); process.exit(2); }
  const baseUrl = values['base-url'].replace(/\/+$/, '');
  const want = Number(values.count);

  const logFile = await findLogFile(values['project-root']);
  const markBytes = logFile ? (await stat(logFile)).size : 0;
  const markSysLog = await sysLogCount(values['ddev-project']);

  console.log(`Smoke test — ${want} random page(s) from the sitemap, base ${baseUrl}`);
  console.log(`  log     : ${logFile ?? '(no var/log/typo3_*.log found)'}${logFile ? ` — marked at ${markBytes} bytes` : ''}`);
  console.log(`  sys_log : ${markSysLog === null ? '(unavailable)' : `${markSysLog} error row(s) before`}\n`);

  const found = await sitemapUrls(baseUrl);
  if (found.error) { console.error(`cannot run: ${found.error}`); process.exit(2); }
  const urls = sample(found.urls, want, values.seed);

  const httpFindings = [];
  for (const u of urls) {
    const r = await fetchText(u);
    const broken = r.status >= 400 || r.status === 0;
    // TYPO3 renders its exception page with 500, but a swallowed one can still answer 200.
    const exceptionInBody = /Oops, an error occurred|Uncaught TYPO3 Exception|Whoops, looks like/i.test(r.body);
    if (broken || exceptionInBody) {
      httpFindings.push({ url: u, status: r.status, reason: broken ? `HTTP ${r.status || r.error}` : 'exception text in a 200 response' });
    }
    console.log(`  ${broken || exceptionInBody ? '✗' : '✓'} ${String(r.status).padStart(3)}  ${u}`);
  }

  // Only what was written while we were requesting.
  let newLines = [];
  if (logFile) {
    const buf = await readFile(logFile, 'utf8');
    newLines = buf.slice(markBytes).split('\n').filter(Boolean);
  }
  const severe = newLines.filter((l) => SEVERE.test(l));
  const deprecations = newLines.filter((l) => /deprecat/i.test(l));
  const afterSysLog = await sysLogCount(values['ddev-project']);
  const newSysLog = markSysLog !== null && afterSysLog !== null ? afterSysLog - markSysLog : null;

  console.log(`\n  new log lines      : ${newLines.length}`);
  console.log(`  new severe entries : ${severe.length}`);
  console.log(`  new deprecations   : ${deprecations.length}${values['include-deprecations'] ? ' (counted as findings)' : ' (reported, not failing)'}`);
  if (newSysLog !== null) console.log(`  new sys_log errors : ${newSysLog}`);

  for (const l of severe.slice(0, 5)) console.log(`    ! ${l.replace(/\s+/g, ' ').slice(0, 190)}`);

  const failing = httpFindings.length + severe.length
    + (values['include-deprecations'] ? deprecations.length : 0)
    + (newSysLog && newSysLog > 0 ? newSysLog : 0);

  const report = { baseUrl, seed: values.seed, requested: urls, logFile, markBytes,
    httpFindings, severe, deprecations, newSysLog };
  if (values.json) await writeFile(values.json, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(failing
    ? `\n✗ ${failing} new problem(s). The update introduced these — a page answering 200 is not the same as a page produced without error.`
    : `\n✓ ${urls.length} pages requested, no new errors in any log source.`);
  process.exitCode = failing ? 1 : 0;
}

main().catch((e) => { console.error(`smoke test aborted: ${e.message}`); process.exitCode = 2; });
