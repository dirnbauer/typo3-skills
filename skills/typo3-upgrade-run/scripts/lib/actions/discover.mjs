/**
 * Guarded URL discovery -> the URL manifest.
 *
 * Two v1 defects are structurally impossible here: the base URL's scheme is preserved (the
 * old code stripped it and hard-coded https://, so an http:// project discovered nothing),
 * and a sitemap that fails to fetch is RECORDED rather than downgraded to a warning that
 * let discovery "succeed" with only golden paths.
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EXIT, HarnessError, PreconditionError } from '../cli/exit-codes.mjs';
import { UrlGuard, assertPlausibleBaseUrl } from '../net/url-guard.mjs';
import { walkSitemaps } from '../net/sitemap.mjs';
import { pagePath, readSiteConfigs, siteRouting } from '../net/site-routing.mjs';
import { StateStore } from '../run/state.mjs';
import { buildManifest } from '../run/manifest.mjs';
import { profileHash, validateStabilizationProfile } from '../browser/stabilize.mjs';
import { resolveImageMagick } from '../browser/media-adapters.mjs';
import { DEFAULT_STATES, MAX_AUTHORITATIVE_STATES, stateByName } from '../browser/states.mjs';
import { intOpt, listOpt } from '../cli/args.mjs';
import { readJson } from './core.mjs';

const execFileAsync = promisify(execFile);

export const PAGE_TREE_SQL = `SELECT uid, doktype, slug, sys_language_uid, l10n_parent
FROM pages
WHERE deleted=0 AND hidden=0 AND t3ver_wsid=0
  AND (starttime=0 OR starttime<=UNIX_TIMESTAMP())
  AND (endtime=0 OR endtime>UNIX_TIMESTAMP())
  AND doktype IN (1,4)
  AND slug IS NOT NULL AND slug<>''
ORDER BY uid`;

/** The rootline that maps a page to its site: every live default-language page and its parent. */
export const PAGE_PARENTS_SQL = `SELECT uid, pid FROM pages
WHERE deleted=0 AND t3ver_wsid=0 AND sys_language_uid=0
ORDER BY uid`;

export async function discoverUrls({ values, paths, log, journal, cwd = process.cwd() }) {
  const store = new StateStore(paths);
  const state = await store.read();

  const baseUrl = values['base-url'] ?? state.project?.trusted_origin;
  if (!baseUrl) throw new HarnessError('--base-url is required (or set project.trusted_origin via init)');

  const languages = listOpt(values, 'languages', state.project?.languages ?? []);
  const seed = discoverySeed(values, state);
  const extraOrigins = values['allow-origin'] ?? [];
  const stabilization = values['stabilization-config']
    ? await loadStabilization(values['stabilization-config'])
    : {};

  await assertPlausibleBaseUrl(baseUrl);
  const guard = await UrlGuard.create({ allowedOrigins: [baseUrl, ...extraOrigins] });
  const base = (await guard.assertUrl(baseUrl, { purpose: 'discovery' })).url;

  // Scheme and port are taken from the validated base URL, never reconstructed; the paths come
  // from the site languages, read once for the sitemaps and the page tree.
  const siteConfigs = await readSiteConfigs(cwd);
  const sitemaps = sitemapEntryPoints(siteRouting(siteConfigs.configs, base), base, { languages });
  for (const warning of siteConfigs.warnings) log.warn(`site configuration: ${warning}`);
  for (const warning of sitemaps.warnings) log.warn(`sitemap discovery: ${warning}`);
  const { entryPoints } = sitemaps;

  log.step(`Discovering from ${entryPoints.length} sitemap entry point(s) on ${base.origin}`);
  const { urls, documents, truncated } = await walkSitemaps(guard, entryPoints, {
    onDocument: (d) => log.debug(`${d.status} ${d.url} (${d.urlCount} urls)`),
  });

  const failed = documents.filter((d) => d.status === 'failed' || d.status === 'guard-blocked');
  for (const f of failed) log.warn(`sitemap ${f.status}: ${f.url} — ${f.error}`);
  if (failed.length && !values['allow-missing-sitemap']) {
    throw new PreconditionError(
      'Sitemap discovery failed. Record the degraded-sampling ADR, then rerun with '
      + '--allow-missing-sitemap and --from-pages before changing the sitemap.',
      { failedSitemaps: failed },
    );
  }

  const goldenPaths = await loadGolden(values['golden-file'], base, guard, log);
  const urlSources = new Map(urls.map((url) => [url, 'sitemap']));
  let pageTree = null;
  if (values['from-pages']) {
    pageTree = await discoverFromPages({ base, guard, cwd, log, languages, siteConfigs });
    for (const url of pageTree.urls) {
      if (!urlSources.has(url)) urlSources.set(url, 'page-tree');
    }
  }
  const pageUrls = pageTree?.urls ?? [];
  if (failed.length && urls.length === 0 && pageUrls.length === 0) {
    throw new PreconditionError(
      'All sitemap entry points failed and the database fallback produced no URLs. Baseline A cannot be sampled.',
      { failedSitemaps: failed.length },
    );
  }
  const all = [...new Set([...urls, ...pageUrls, ...goldenPaths])];

  const pageFallbackDegraded = failed.length > 0 && pageTree !== null;
  const discovery = {
    mode: pageTree ? (urls.length ? 'sitemap+pages' : 'pages-fallback') : 'sitemap',
    degraded: failed.length > 0,
    failedSitemaps: failed.length,
    missingSitemapAccepted: Boolean(values['allow-missing-sitemap']),
    pageTree: pageTree ? {
      rows: pageTree.rows,
      urls: pageTree.urls.length,
      doktypes: [1, 4],
      languages: [...new Set(pageTree.records.map((record) => record.language))].sort((a, b) => a - b),
      skippedRows: pageTree.skipped,
    } : null,
    knownLimitations: pageFallbackDegraded ? [{
      id: 'dynamic-routes-not-discoverable',
      detail: 'The pages table cannot enumerate route-enhancer or plugin detail URLs. Repair the sitemap and reconcile it against this manifest before closure.',
    }] : [],
  };

  if (!all.length) {
    throw new PreconditionError(
      'Discovery found zero URLs. Check the sitemaps and the base URL scheme before continuing — '
      + 'a run with no URLs proves nothing.',
      { entryPoints, documents },
    );
  }

  const manifest = buildManifest({
    baseUrl: base.href,
    allowedOrigins: [base.origin, ...extraOrigins],
    languages, seed,
    sourceSitemaps: documents,
    urls: all,
    goldenPaths,
    urlSources,
    discovery,
    visualBudget: intOpt(values, 'visual-budget', 360),
    lighthouseSample: intOpt(values, 'lighthouse-sample', 3),
    viewports: listOpt(values, 'viewports', ['desktop', 'tablet', 'mobile']),
    states: captureStates(values),
    stabilization,
    stabilizationProfileHash: profileHash(stabilization),
  });

  await mkdir(paths.manifestsDir, { recursive: true });
  await writeFile(paths.urlManifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await mkdir(paths.configDir, { recursive: true });
  await writeFile(paths.samplePath, `${manifest.visualRegressionUrls.join('\n')}\n`, 'utf8');

  await store.update((s) => {
    s.manifest = { path: 'manifests/url-manifest.json', hash: manifest.manifestHash, seed };
  });

  const cov = manifest.coverage;
  log.success(
    `${cov.discovered} URLs · HTTP+DOM 100% · pixels ${cov.visualCaptured} URLs `
    + `(${manifest.captures.length} captures) · Lighthouse ${cov.lighthouseSampled}`,
  );
  if (cov.degraded) {
    log.warn(`COVERAGE DEGRADED: ${cov.notCaptured.reduce((a, n) => a + n.count, 0)} URLs not pixel-compared.`);
    for (const n of cov.notCaptured) log.warn(`  ${n.reason}: ${n.count}`);
  }
  if (cov.discoveryDegraded) {
    log.warn('URL DISCOVERY DEGRADED: one or more sitemap documents failed.');
    for (const limitation of cov.discoveryKnownLimitations) {
      log.warn(`  ${limitation.id}: ${limitation.detail}`);
    }
  }

  await journal.append('note', {
    note: 'discovery complete', urls: cov.discovered,
    visual: cov.visualCaptured, degraded: cov.degraded,
    discoveryDegraded: cov.discoveryDegraded, discoveryMode: discovery.mode, truncated,
  });

  // Sitemap failures are findings: they are gaps in the evidence, not warnings.
  const exitCode = failed.length ? EXIT.FINDINGS : EXIT.PASS;
  return {
    exitCode,
    verdict: exitCode === EXIT.PASS ? 'pass' : 'findings',
    manifestHash: manifest.manifestHash,
    coverage: cov,
    failedSitemaps: failed.length,
    reports: [paths.urlManifest],
    message: failed.length
      ? `${failed.length} sitemap document(s) failed — discovery is incomplete`
      : `${cov.discovered} URLs discovered`,
  };
}

/**
 * The sample seed. A blank one is no seed: state starts with manifest.seed '', which `??` passed
 * through, so the run-specific default never applied and every run drew the same sample.
 */
export function discoverySeed(values, state) {
  for (const seed of [values.seed, state.manifest?.seed]) {
    if (typeof seed === 'string' && seed.trim()) return seed;
  }
  return `${state.run_id}-visual`;
}

/**
 * Sitemap entry points: the base of every language served on this origin, plus sitemap.xml. The
 * default language usually sits at /, so a guessed /<code>/sitemap.xml for it is a 404 that
 * reads as a finding. Languages are chosen as for the page tree. Without site configuration, or
 * when it names nothing served here, the old guess stays (/sitemap.xml and /<code>/sitemap.xml
 * per --languages value), with a warning that it is one.
 */
export function sitemapEntryPoints(sites, base, { languages = [] } = {}) {
  const wanted = wantedCodes(languages);
  const entryPoints = new Set(), named = new Set(), warnings = [];
  for (const site of sites) {
    for (const siteLanguage of site.languages) {
      for (const code of wanted) if (siteLanguage.codes.has(code)) named.add(code);
      if (!siteLanguage.enabled || !selected(siteLanguage, wanted)) continue;
      if (siteLanguage.servedHere) entryPoints.add(new URL(`${siteLanguage.prefix}sitemap.xml`, base).href);
      else {
        const why = siteLanguage.prefix === null ? siteLanguage.unreachable : 'served from another host';
        warnings.push(`site ${site.identifier} language ${siteLanguage.languageId} is ${why}; its sitemap is not requested`);
      }
    }
  }
  if (entryPoints.size) {
    const unknown = wanted.filter((code) => !named.has(code));
    if (unknown.length) warnings.push(`--languages ${unknown.join(', ')} name no configured site language; no sitemap is requested for them`);
    return { entryPoints: [...entryPoints], warnings };
  }
  const guessed = ['/', ...languages.map((code) => String(code).trim()).filter(Boolean).map((code) => `/${code}/`)];
  warnings.push(`${sites.length ? `config/sites names no language served on ${new URL(base).origin}` : 'no config/sites/*/config.yaml'}; `
    + `sitemap entry points are guessed: ${guessed.map((prefix) => `${prefix}sitemap.xml`).join(', ')}`);
  return { entryPoints: [...new Set(guessed.map((prefix) => new URL(`${prefix}sitemap.xml`, base).href))], warnings };
}

/**
 * Page rows -> URLs. With `routing` (siteRouting sites, the default-language parent map and the
 * run's --languages), each row takes its site's language prefix and PageType suffix: /en/news/,
 * not /news. The default language is always in, like /sitemap.xml; other languages only when
 * selected (all when none are). A row no single site root claims keeps base + slug; a row in a
 * language its site lacks, or cannot serve on this origin, is left out. Both are warnings.
 */
export function parsePageTreeRows(stdout, base, { sites = [], parents = new Map(), languages = [] } = {}) {
  const records = [];
  const urls = new Set();
  const notes = new Map();
  const note = (text) => notes.set(text, (notes.get(text) ?? 0) + 1);
  const wanted = wantedCodes(languages);
  let skipped = 0;
  for (const line of stdout.split('\n').map((value) => value.trim()).filter(Boolean)) {
    const [uidRaw, doktypeRaw, slugRaw, languageRaw = '0', parentRaw = '0'] = line.split('\t');
    const uid = Number(uidRaw);
    const doktype = Number(doktypeRaw);
    const slug = slugRaw?.trim();
    if (!Number.isInteger(uid) || ![1, 4].includes(doktype) || !slug) continue;
    const language = Number(languageRaw);
    const slugPath = slug.startsWith('/') ? slug : `/${slug}`;
    let url = new URL(slugPath, base).href;
    if (sites.length) {
      const routed = routeRow({ uid, language, parent: Number(parentRaw), slugPath }, { sites, parents, wanted });
      if (routed.note) note(routed.note);
      if (routed.skip) { skipped += 1; continue; }
      if (routed.path) url = new URL(routed.path, base).href;
    }
    records.push({ uid, doktype, slug, language, url });
    urls.add(url);
  }
  const warnings = [...notes].map(([text, count]) => `${count} page row(s): ${text}`);
  return { rows: records.length, records, urls: [...urls].sort(), skipped, warnings };
}

/** Default-language uid -> pid, from PAGE_PARENTS_SQL. */
export function parsePageParents(stdout) {
  const parents = new Map();
  for (const line of stdout.split('\n').map((value) => value.trim()).filter(Boolean)) {
    const [uid, pid] = line.split('\t').map(Number);
    if (Number.isInteger(uid) && Number.isInteger(pid)) parents.set(uid, pid);
  }
  return parents;
}

/** One row through its site: a path, a skip, or neither (no site: base + slug stays). */
function routeRow({ uid, language, parent, slugPath }, { sites, parents, wanted }) {
  const site = siteOf(language > 0 ? parent : uid, sites, parents);
  if (!site) return { note: 'no single site root in the rootline; kept base + slug' };
  const siteLanguage = site.languages.find((candidate) => candidate.languageId === language);
  if (!siteLanguage) return { skip: true, note: `site ${site.identifier} has no language ${language}; left out` };
  if (!siteLanguage.enabled || !selected(siteLanguage, wanted)) return { skip: true };
  if (siteLanguage.prefix === null) {
    return { skip: true, note: `site ${site.identifier} language ${language} is ${siteLanguage.unreachable}; left out` };
  }
  return { path: pagePath(siteLanguage.prefix, slugPath, site.suffix) };
}

function wantedCodes(languages) {
  return languages.map((value) => String(value).trim().toLowerCase()).filter(Boolean);
}

/** Language 0 always; another language when --languages names it, or when nothing is named. */
function selected(siteLanguage, wanted) {
  return siteLanguage.languageId === 0 || !wanted.length || wanted.some((code) => siteLanguage.codes.has(code));
}

/** The nearest site root in the rootline; none, or two sites on one root, maps to nothing. */
function siteOf(uid, sites, parents) {
  const seen = new Set();
  for (let current = uid; current > 0 && !seen.has(current); current = parents.get(current) ?? 0) {
    seen.add(current);
    const claimed = sites.filter((site) => site.rootPageId === current);
    if (claimed.length) return claimed.length === 1 ? claimed[0] : null;
  }
  return null;
}

export async function discoverFromPages({ base, guard, cwd, log, languages = [], run = execFileAsync, siteConfigs = null }) {
  const query = async (sql) => {
    try {
      return (await run('ddev', ['mysql', '-N', '-B', '-e', sql], { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })).stdout;
    } catch (error) {
      throw new PreconditionError(`Database URL discovery failed: ${error.message}`);
    }
  };
  const stdout = await query(PAGE_TREE_SQL);
  // A caller that already read config/sites has reported its warnings.
  const { configs, warnings } = siteConfigs ? { configs: siteConfigs.configs, warnings: [] } : await readSiteConfigs(cwd);
  if (!configs.length) warnings.push(`no config/sites/*/config.yaml under ${cwd}; page URLs keep base + slug`);
  const sites = siteRouting(configs, base);
  const parents = sites.length ? parsePageParents(await query(PAGE_PARENTS_SQL)) : new Map();
  const parsed = parsePageTreeRows(stdout, base, { sites, parents, languages });
  for (const warning of [...warnings, ...sites.flatMap((site) => site.warnings), ...parsed.warnings]) {
    log.warn(`page-tree discovery: ${warning}`);
  }
  const accepted = [];
  for (const url of parsed.urls) {
    accepted.push((await guard.assertUrl(url, { purpose: 'page-tree-discovery' })).url.href);
  }
  log.step(`Database discovery added ${accepted.length} URL(s) from ${parsed.rows} public page row(s)`
    + (parsed.skipped ? `; ${parsed.skipped} row(s) left out by language` : ''));
  return { ...parsed, urls: accepted };
}

async function loadGolden(file, base, guard, log) {
  if (!file) return [new URL('/', base).href];
  let raw;
  try { raw = await readFile(file, 'utf8'); }
  catch (err) { throw new HarnessError(`Cannot read --golden-file ${file}: ${err.message}`); }

  const out = [];
  for (const line of raw.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))) {
    // Relative by default. An absolute golden path must pass the same guard as anything else.
    const candidate = line.startsWith('http') ? line : new URL(line, base).href;
    try {
      out.push((await guard.assertUrl(candidate, { purpose: 'golden-path' })).url.href);
    } catch (err) {
      log.warn(`golden path rejected: ${line} — ${err.message}`);
    }
  }
  return out.length ? out : [new URL('/', base).href];
}

async function loadStabilization(file) {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    if (parsed.consent?.cookies && !parsed.consent.origin) {
      throw new HarnessError('stabilization consent cookies require consent.origin.');
    }
    validateStabilizationProfile(parsed);
    // Refuse to seal a profile the capture machine cannot execute.
    const gif = parsed.media?.gifFirstFrame;
    if (gif && !resolveImageMagick(gif.command ?? null)) {
      throw new PreconditionError('stabilization media.gifFirstFrame needs ImageMagick ("magick" or "convert") on PATH.');
    }
    return parsed;
  } catch (error) {
    if (error instanceof HarnessError) throw error;
    throw new HarnessError(`Cannot read --stabilization-config ${file}: ${error.message}`);
  }
}

export function captureStates(values) {
  const configured = listOpt(values, 'states', [...DEFAULT_STATES]);
  const unique = [...new Set(configured)];
  const fixed = new Set(DEFAULT_STATES);
  if (unique.length !== MAX_AUTHORITATIVE_STATES || unique.some((name) => !fixed.has(name))) {
    throw new PreconditionError(
      `The authoritative matrix is fixed to exactly ${DEFAULT_STATES.join(', ')}. `
      + 'Use targeted smoke checks for component-specific states.',
    );
  }
  const unknown = unique.filter((name) => !stateByName(name));
  if (unknown.length) throw new PreconditionError(`Unknown interaction state(s): ${unknown.join(', ')}`);
  return unique;
}

export { readJson };
