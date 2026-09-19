/**
 * Capture: HTTP records, DOM snapshots, and screenshots for the manifest set.
 *
 * Every URL is re-validated by the guard IMMEDIATELY before page.goto, re-read from the
 * manifest. The manifest is a file on disk and can be edited between discovery and capture;
 * validating once at discovery would be trusting it.
 */

import { mkdir, writeFile, readFile, access, rm } from 'node:fs/promises';
import path from 'node:path';
import { sample } from '../util/rng.mjs';
import { EXIT, HarnessError, PreconditionError } from '../cli/exit-codes.mjs';
import { UrlGuard } from '../net/url-guard.mjs';
import { safeFetch } from '../net/safe-fetch.mjs';
import { extractRecord } from '../compare/http-meta.mjs';
import { domHash, templateSignature } from '../compare/dom-normalize.mjs';
import { launchBrowser, newContext, stabilizePage, VIEWPORTS } from '../browser/launch.mjs';
import { createRoutePolicy, createQuietDetector, attachNavigationGuard } from '../browser/route-policy.mjs';
import { applyState } from '../browser/states.mjs';
import { verifyManifest, urlById } from '../run/manifest.mjs';
import { captureId } from '../run/paths.mjs';
import { intOpt, listOpt } from '../cli/args.mjs';
import { readJson } from './core.mjs';
import { consentStateFor } from '../browser/stabilize.mjs';
import { mapPool } from '../util/pool.mjs';
import { acquireMachineLock, releaseMachineLock } from '../util/machine-lock.mjs';
import { acquireMachineResources, withMachineResources, machineCapacity } from '../util/machine-resources.mjs';
import { assertCleanFrontendSession } from '../browser/session.mjs';

export async function capture({ values, paths, log, journal }) {
  const label = values.label;
  if (!label) throw new HarnessError('--label is required (before | after | selftest-a | selftest-b)');

  const manifest = await readJson(paths.urlManifest);
  if (!manifest) throw new PreconditionError('No URL manifest. Run "t3u discover-urls" first.');

  const check = verifyManifest(manifest);
  if (!check.valid) {
    const { InvalidRunError } = await import('../cli/exit-codes.mjs');
    throw new InvalidRunError('The URL manifest hash does not match its content — it has been edited.', check);
  }

  // `--out` is a PATH, not a capture name. A bare name like `--out after-final` would
  // otherwise resolve against the process cwd and write a full capture set outside the
  // run directory — silently bypassing the guard that keeps run data together, and
  // leaving `captures/` empty while the command reports success. Treat a bare name as
  // what the caller plainly meant: a sibling of the other capture sets.
  const outRoot = values.out
    ? (path.isAbsolute(values.out) || values.out.includes(path.sep)
        ? path.resolve(values.out)
        : path.join(paths.root, 'captures', values.out))
    : path.join(paths.root, 'captures', label);
  const stages = new Set(listOpt(values, 'stages', ['http', 'dom', 'visual']));
  const guard = await UrlGuard.create({ allowedOrigins: manifest.allowedOrigins });
  const scope = values.scope === 'intermediate' ? 'intermediate' : 'final';
  const affected = await affectedTargets(values);

  // A worker count above 1 for final evidence is licensed only by the sealed self-test
  // lock: the exhaustive double-shoot proved zero at exactly that count on this machine.
  let provenWorkers = null;
  if (scope === 'final') {
    const lock = await readJson(paths.selftestLock);
    if (lock?.verdict === 'pass' && Number.isInteger(lock.visualWorkers)) provenWorkers = lock.visualWorkers;
  }

  const result = await captureAll({
    manifest, guard, outRoot, stages, log, journal,
    deadlineAt: (await readJson(paths.statePath))?.runtime?.deadline_at,
    resume: values.resume, warmup: values.warmup !== false,
    scope,
    affected,
    allowAll: values['all-urls'] === true,
    visualWorkers: intOpt(
      values,
      'visual-workers',
      scope === 'intermediate' ? DIAGNOSTIC_VISUAL_WORKERS : (provenWorkers ?? DEFAULT_VISUAL_WORKERS),
    ),
    provenWorkers,
    httpWorkers: intOpt(values, 'http-workers', DEFAULT_HTTP_WORKERS),
  });

  await writeFile(
    path.join(outRoot, 'capture-index.json'),
    `${JSON.stringify({ label, manifestHash: manifest.manifestHash, ...result.index }, null, 2)}\n`,
    'utf8',
  );

  const failed = result.index.errors.length;
  log.success(
    `${label}: http ${result.index.http} · dom ${result.index.dom} · shots ${result.index.shots}`
    + (failed ? ` · ${failed} error(s)` : ''),
  );

  return {
    exitCode: failed ? EXIT.FINDINGS : EXIT.PASS,
    verdict: failed ? 'findings' : 'pass',
    ...result.index,
    outRoot,
    message: failed ? `${failed} capture error(s)` : `${label} captured`,
  };
}

/** Exported so selftest can run two passes without shelling out. */
/**
 * Sampling policy: cheap in the loops, exhaustive at the end.
 *
 * An intermediate loop runs many times and exists to catch a fault fast, so it takes a seeded
 * 10% slice. The closing comparison runs once and is what the invariance claim rests on, so it
 * takes everything — a claim proven on a sample is a claim about the sample.
 *
 * The floor matters more than the percentage: 10% of 40 URLs is 4, which proves nothing, so the
 * slice never drops below 20 (or the whole set, if smaller). The ceiling keeps a loop iteration
 * inside its time budget on a large site.
 *
 * Final HTTP and DOM are cheap, parallel, and exhaustive. The manifest already limits the
 * expensive visual URL set through its declared tiered capture budget, so a second URL cap here
 * would only make the equality claim weaker without saving meaningful renderer time.
 */
export const SAMPLING = Object.freeze({
  INTERMEDIATE_PERCENT: 0.10,
  INTERMEDIATE_MIN: 20,
  INTERMEDIATE_MAX: 100,
});

// Authoritative full captures default to twelve isolated Chromium processes. That count is
// LICENSED: only a count that an exhaustive determinism double-shoot has proven to
// zero (and sealed into selftest.lock.json as `visualWorkers`) may produce final evidence,
// and every later authoritative capture and comparison must use that same count. The
// self-test itself passes its own count as `provenWorkers` — it is the proof instrument.
// Intermediate diagnostics deliberately trade authority for fast feedback.
// Proven on the exhaustive Saferinternet 1,357-URL / 360-capture matrix on 2026-08-10.
// Final evidence still requires the exact count recorded by selftest.lock.json.
export const DEFAULT_VISUAL_WORKERS = 12;
export const DIAGNOSTIC_VISUAL_WORKERS = 12;
export const MAX_VISUAL_WORKERS = 12;

/** Intermediate checks reserve room for unrelated pages that detect an underestimated blast radius. */
export const INTERMEDIATE_SENTINEL_MIN = 5;

// Stage 1/2 runs over plain HTTP with no renderer involved, so parallel fetches cannot
// change pixel evidence; they only load the application server. The pool is still
// recorded in the capture index (`httpWorkers`) so every report names its instrument.
export const DEFAULT_HTTP_WORKERS = 6;
export const MAX_HTTP_WORKERS = 16;

/**
 * Derive plain-text needles from consent modal trigger selectors so stage 1's already
 * fetched HTML can decide `consent-modal-open` applicability without a navigation.
 * Supported forms: `#id` and `[attr="value"]`. Any other selector form returns null,
 * which disables skipping entirely — never guess against an expression we cannot match.
 */
export function triggerNeedles(selectors) {
  if (!Array.isArray(selectors) || selectors.length === 0) return null;
  const needles = [];
  for (const raw of selectors) {
    const sel = String(raw).trim();
    const id = /^#([A-Za-z_][\w-]*)$/.exec(sel);
    const attr = /^\[([\w-]+)=["']?([^"'\]]+)["']?\]$/.exec(sel);
    if (id) needles.push(`id="${id[1]}"`);
    else if (attr) needles.push(`${attr[1]}="${attr[2]}"`);
    else return null;
  }
  return needles;
}

/** Returns the URL entries to capture, plus a declaration of what was left out. */
export function selectUrls(allUrls, {
  scope = 'final', seed = 'sample', affected = [],
} = {}) {
  const total = allUrls.length;
  if (scope === 'intermediate') {
    const affectedSet = new Set(affected.map(String));
    const affectedMatches = allUrls.filter((entry) => affectedSet.has(entry.id) || affectedSet.has(entry.url));
    const affectedMatchedKeys = new Set(affectedMatches.flatMap((entry) => [entry.id, entry.url]));
    const affectedUnmatched = [...affectedSet].filter((target) => !affectedMatchedKeys.has(target));
    const want = Math.min(
      SAMPLING.INTERMEDIATE_MAX,
      Math.max(SAMPLING.INTERMEDIATE_MIN, Math.ceil(total * SAMPLING.INTERMEDIATE_PERCENT)),
    );
    if (want >= total) {
      return {
        urls: allUrls, scope, total, captured: total, omitted: 0, reason: null,
        strategy: 'all-small-site', affectedRequested: affected.length,
        affectedMatched: affectedMatches.length, affectedUnmatched, sentinels: 0,
      };
    }

    const critical = allUrls.filter((entry) => entry.tier === 1);
    const picked = [];
    const pickedIds = new Set();

    // Reserve five unrelated sentinels. Impact pages get most of the remaining budget, while
    // critical and template representatives keep the check from becoming blind outside the
    // named component. Every pool is capped, so an unusually large tier 1 cannot break the
    // intermediate ceiling.
    const sentinelReserve = Math.min(
      INTERMEDIATE_SENTINEL_MIN,
      Math.max(0, want - (affectedMatches.length ? 1 : 0)),
    );
    const affectedQuota = affectedMatches.length
      ? Math.max(1, want - sentinelReserve - Math.min(5, critical.length))
      : 0;
    const chosenAffected = sample(
      affectedMatches,
      Math.min(affectedMatches.length, affectedQuota),
      `${seed}:affected`,
    );
    for (const entry of chosenAffected) {
      if (!pickedIds.has(entry.id)) { picked.push(entry); pickedIds.add(entry.id); }
    }
    const criticalPool = critical.filter((entry) => !pickedIds.has(entry.id));
    const criticalQuota = Math.min(
      criticalPool.length,
      Math.max(0, Math.min(10, want - picked.length - sentinelReserve)),
    );
    for (const entry of sample(criticalPool, criticalQuota, `${seed}:critical`)) {
      picked.push(entry); pickedIds.add(entry.id);
    }

    // Preserve template diversity before filling the remainder randomly. Tier 2 entries are
    // already seed-selected representatives of DOM-signature clusters.
    const representativePool = allUrls.filter((entry) => entry.tier === 2 && !pickedIds.has(entry.id));
    const representativeQuota = Math.min(
      representativePool.length,
      Math.max(0, Math.min(5, want - picked.length - sentinelReserve)),
    );
    for (const entry of sample(representativePool, representativeQuota, `${seed}:representatives`)) {
      picked.push(entry); pickedIds.add(entry.id);
    }

    const remainder = allUrls.filter((entry) => (
      !pickedIds.has(entry.id) && !affectedSet.has(entry.id) && !affectedSet.has(entry.url)
    ));
    const remainderQuota = Math.max(0, want - picked.length);
    const chosenRemainder = sample(remainder, remainderQuota, `${seed}:sentinels`);
    picked.push(...chosenRemainder);
    const fallbackQuota = Math.max(0, want - picked.length);
    if (fallbackQuota) {
      const fallback = allUrls.filter((entry) => !pickedIds.has(entry.id)
        && !chosenRemainder.some((sentinel) => sentinel.id === entry.id));
      picked.push(...sample(fallback, fallbackQuota, `${seed}:fill`));
    }
    picked.sort((a, b) => a.id.localeCompare(b.id));

    return {
      urls: picked,
      scope,
      total,
      captured: picked.length,
      omitted: total - picked.length,
      reason: affectedMatches.length
        ? 'intermediate-affected-plus-seeded-sentinels'
        : 'intermediate-stratified-seeded-sample',
      strategy: affectedMatches.length ? 'affected+critical+representatives+sentinels' : 'critical+representatives+seeded',
      affectedRequested: affected.length,
      affectedMatched: affectedMatches.length,
      affectedUnmatched,
      sentinels: chosenRemainder.length,
    };
  }
  // Final HTTP/DOM cover every discovered URL. Visual work is independently bounded by the
  // manifest's tiered capture set and therefore does not scale with this full list.
  return { urls: allUrls, scope, total, captured: total, omitted: 0, reason: null,
    strategy: 'all-http-dom+tiered-visual' };
}

/** Select the expensive browser matrix. Intermediate work uses default state only. */
export function selectCaptures(manifest, selection, { scope = 'final' } = {}) {
  const selectedIds = new Set(selection.urls.map((entry) => entry.id));
  return manifest.captures.filter((capture) => (
    selectedIds.has(capture.urlId)
    && (scope !== 'intermediate' || capture.state === 'default')
  ));
}

export async function captureAll({
  manifest,
  guard,
  outRoot,
  stages,
  log,
  journal,
  resume = false,
  warmup = true,
  scope = 'final',
  affected = [],
  allowAll = false,
  visualWorkers = DEFAULT_VISUAL_WORKERS,
  provenWorkers = null,
  httpWorkers = DEFAULT_HTTP_WORKERS,
  deadlineAt,
}) {
  if (!Number.isInteger(httpWorkers) || httpWorkers < 1 || httpWorkers > MAX_HTTP_WORKERS) {
    throw new HarnessError(`httpWorkers must be an integer from 1 to ${MAX_HTTP_WORKERS}`);
  }
  if (!Number.isInteger(visualWorkers) || visualWorkers < 1 || visualWorkers > MAX_VISUAL_WORKERS) {
    throw new HarnessError(`visualWorkers must be an integer from 1 to ${MAX_VISUAL_WORKERS}`);
  }
  if (scope === 'final' && visualWorkers > 1 && visualWorkers !== provenWorkers) {
    throw new PreconditionError(
      `Final visual evidence at ${visualWorkers} workers requires that exact count proven by an `
      + 'exhaustive determinism self-test (selftest.lock.json visualWorkers); serial (1) is always permitted.',
    );
  }
  await mkdir(outRoot, { recursive: true });
  for (const kind of ['http', 'dom', 'shots']) await mkdir(path.join(outRoot, kind), { recursive: true });

  const index = {
    http: 0,
    httpWarmup: 0,
    dom: 0,
    domSkipped: 0,
    shots: 0,
    visualWorkers,
    httpWorkers,
    errors: [],
    retries: [],
    signatures: {},
    states: {},
  };
  const stabilization = manifest.stabilization ?? {};
  const consent = stabilization.consent
    ? consentStateFor({
        ...stabilization.consent,
        origin: stabilization.consent.origin ?? manifest.allowedOrigins[0],
      })
    : undefined;
  const selection = selectUrls(manifest.allUrls, {
    scope, seed: manifest.seed ?? 'sample', allowAll, affected,
  });
  const urls = selection.urls.map((u) => u.url);
  const nonHtmlUrls = new Set();
  // Stage 1 fetches every page body anyway; use it to decide `consent-modal-open`
  // applicability per URL so trigger-less pages never pay a duplicate navigation and
  // screenshot for a state that cannot render. Deterministic across passes: identical
  // HTML yields identical skips, and a wobbling body is caught by the DOM stage.
  const modalNeedles = triggerNeedles(stabilization.consent?.modalTriggerSelectors);
  const modalTriggerByUrl = new Map();
  const { urls: _selectedUrls, ...selectionEvidence } = selection;
  index.selection = selectionEvidence;
  if (selection.omitted) {
    log.info(`scope ${selection.scope}: ${selection.captured} of ${selection.total} URLs (${selection.omitted} not captured — ${selection.reason})`);
  }

  /* ---- stage 1 + 2: selected URLs during iterations; every URL at final closure. ---- */
  // Fetches run in a bounded pool: no renderer is involved, so concurrency cannot touch
  // pixel evidence — it only parallelises application-server renders. Everything ORDER-
  // SENSITIVE (counters, signatures, errors, journal entries, warnings) is applied in a
  // single stable pass in `urls` order afterwards, so the capture index and journal are
  // byte-identical whatever order the pool finished in.
  if (stages.has('http') || stages.has('dom')) {
    index.httpWorkers = httpWorkers;
    const fetchOne = async (url) => {
      await guard.assertUrl(url, { purpose: 'capture-http' });
      // TYPO3 can emit session cookies while populating a cold page cache and omit them
      // once that same response is cached. Recording the first request therefore makes an
      // unchanged second run look different. Match the browser lifecycle: warm once, then
      // record a fresh guarded response.
      let warmed = false;
      if (warmup) {
        await safeFetch(guard, url, { purpose: 'capture-http-warmup', accept: 'any' });
        warmed = true;
      }
      const res = await safeFetch(guard, url, { purpose: 'capture-http', accept: 'any' });
      const html = ['text/html', 'application/xhtml+xml'].includes(res.contentType);
      const modalTrigger = html && modalNeedles
        ? modalNeedles.some((needle) => res.body.includes(needle))
        : null;

      let wroteHttp = false;
      if (stages.has('http')) {
        const record = extractRecord({
          requestedUrl: url, url: res.url, status: res.status, headers: res.headers,
          body: res.body, redirects: res.redirects,
        });
        await writeFile(path.join(outRoot, 'http', `${keyOf(url)}.json`), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
        wroteHttp = true;
      }
      let dom = null;
      if (stages.has('dom') && html) {
        const { normalized, hits, overreach } = domHash(res.body);
        await writeFile(path.join(outRoot, 'dom', `${keyOf(url)}.html`), normalized, 'utf8');
        const sig = templateSignature(res.body);
        await writeFile(
          path.join(outRoot, 'dom', `${keyOf(url)}.meta.json`),
          `${JSON.stringify({ hits, overreach, signature: sig.hash, tagCount: sig.tagCount }, null, 2)}\n`, 'utf8',
        );
        dom = { signature: sig.hash, overreach };
      }
      return { warmed, html, modalTrigger, wroteHttp, dom };
    };

    const outcomes = await withMachineResources({ owner: 'http-dom', log, deadlineAt }, async lease => {
      const started = Date.now();
      const result = await mapPool(urls, httpWorkers, fetchOne);
      index.httpTiming = { durationMs: Date.now() - started, machineWaitMs: lease.waitMs };
      return result;
    });

    // Stable application pass — the ONLY writer of order-sensitive state.
    for (let i = 0; i < urls.length; i += 1) {
      const url = urls[i];
      const outcome = outcomes[i];
      if (!outcome.ok) {
        const err = outcome.error;
        index.errors.push({ url: '(redacted)', stage: 'http/dom', error: err.message });
        if (err.exitCode === 5) await journal?.policyBlock({ reason: err.message, target: url, purpose: 'capture' });
        continue;
      }
      const { warmed, html, modalTrigger, wroteHttp, dom } = outcome.value;
      if (warmed) index.httpWarmup += 1;
      if (!html) nonHtmlUrls.add(url);
      if (modalTrigger !== null) modalTriggerByUrl.set(url, modalTrigger);
      if (wroteHttp) index.http += 1;
      if (stages.has('dom')) {
        if (!html) {
          index.domSkipped += 1;
        } else {
          index.signatures[url] = dom.signature;
          if (dom.overreach.length) {
            log.warn(`normalisation overreach on ${url}: ${dom.overreach.join(', ')}`);
          }
          index.dom += 1;
        }
      }
    }
    log.step(
      `stage 1/2 complete: ${index.http} http, ${index.dom} dom`
      + (index.domSkipped ? `, ${index.domSkipped} non-HTML DOM not-applicable` : '')
      + `, ${index.errors.length} error(s)`,
    );
  }

  /* ---- stage 3: screenshots for the manifest capture set only ---- */
  // Restrict to the sampled URLs too. Sampling stage 1+2 while stage 3 shot everything meant an
  // "intermediate" run still paid the full screenshot cost — which is the only expensive part.
  // Captures reference the manifest by urlId, not by url.
  const selectedCaptures = selectCaptures(manifest, selection, { scope });
  const notApplicable = [];
  const captureSet = selectedCaptures.filter((capture) => {
    const url = urlById(manifest, capture.urlId);
    if (!url || nonHtmlUrls.has(url)) return false;
    // Declarative skip, never silent: the capture id lands in index.notApplicable with its
    // reason. Skips only happen when stage 1 saw this URL's HTML and none of the derivable
    // trigger needles appear — no body seen or underivable selector means capture anyway.
    if (capture.state === 'consent-modal-open' && modalNeedles && modalTriggerByUrl.get(url) === false) {
      notApplicable.push({ captureId: capture.captureId, state: capture.state, reason: 'modal-trigger-absent' });
      return false;
    }
    return true;
  });
  notApplicable.sort(byCaptureId);
  index.notApplicable = notApplicable;
  if (notApplicable.length) {
    log.info(`${notApplicable.length} planned capture(s) not applicable (modal trigger absent) — declared in capture-index`);
  }
  if (stages.has('visual') && captureSet.length) {
    const byViewport = groupBy(captureSet, (c) => c.viewport);
    const routeReports = [];
    // Screenshots from concurrent runs on one machine contend for cores and can flake
    // each other's zero-pixel proofs. The machine-wide lock queues visual stages across
    // runs (re-entrant in-process; a dead holder is stolen). Other managed jobs
    // still obey the shared capacity budget and Lighthouse's quiet window.
    await acquireMachineLock({ runId: outRoot, log, deadlineAt });
    let machineLease;
    try {
    const capacity = machineCapacity();
    if (visualWorkers > capacity.browsers) throw new PreconditionError('Visual workers exceed T3U_BROWSER_SLOTS; calibrate and seal the worker count before proof.');
    // Authoritative pixels retain a dedicated browser lane. Do not silently alter
    // the licensed renderer count, assignment or viewport order to fit other jobs.
    machineLease = await acquireMachineResources({ browsers: capacity.browsers, owner: 'visual-capture', log, deadlineAt });
    index.machineWaitMs = machineLease.waitMs;
    index.browserStartup = [];
    for (const [viewport, caps] of byViewport) {
      if (!VIEWPORTS[viewport]) { log.warn(`unknown viewport ${viewport}, skipped`); continue; }
      const workerCount = Math.min(visualWorkers, caps.length);
      const browsers = [];
      try {
        // Context isolation is insufficient for strict pixels: Blink renderer state and
        // fractional layout allocation can vary between concurrently loaded contexts in the
        // same process. Each worker therefore owns a distinct Chromium process. Restart the
        // process at every viewport so a final proof never accumulates target allocation
        // across the complete matrix.
        const startupAt = Date.now();
        const startups = await mapPool(Array.from({ length: workerCount }, (_, i) => i), Math.min(4, workerCount), async workerIndex => {
          const { browser } = await launchBrowser({ log });
          browsers[workerIndex] = browser;
        });
        for (const result of startups) if (!result.ok) throw result.error;
        index.browserStartup.push({ viewport, workers: workerCount, durationMs: Date.now() - startupAt });
        const workerReports = await Promise.all(
          Array.from({ length: workerCount }, async (_, workerIndex) => {
            const context = await newContext(browsers[workerIndex], {
              viewport,
              storageState: consent,
              stabilize: stabilization,
            });
            const policy = createRoutePolicy({ allowedOrigins: manifest.allowedOrigins });
            await policy.attach(context);
            const reusePage = scope === 'intermediate';
            let reusablePage = null;
            try {
              // Round-robin assignment is stable across runs and balances pages whose settle
              // times vary. Each worker owns a separate browser process and one context for
              // the entire viewport. Fast diagnostics reuse a page; authoritative final
              // evidence uses a fresh page for every screenshot to prevent renderer history
              // from affecting strict pixels.
              for (let capIndex = workerIndex; capIndex < caps.length; capIndex += workerCount) {
                const cap = caps[capIndex];
                const url = urlById(manifest, cap.urlId);
                if (!url) continue;
                const file = path.join(outRoot, 'shots', `${cap.captureId}.png`);
                const metaFile = path.join(outRoot, 'shots', `${cap.captureId}.meta.json`);
                if (resume && await exists(file)) { index.shots += 1; continue; }

                const maxAttempts = 2;
                let firstError = null;
                for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
                  let navigationGuard = null;
                  let page = null;
                  try {
                    if (reusePage) {
                      if (!reusablePage || reusablePage.isClosed()) {
                        reusablePage = await context.newPage();
                      }
                      page = reusablePage;
                    } else {
                      page = await context.newPage();
                    }
                    await guard.assertUrl(url, { purpose: 'capture-goto' });   // again, right before goto
                    navigationGuard = attachNavigationGuard(page, guard, new URL(url).origin);

                    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
                    guard.assertSameOrigin(page.url(), new URL(url).origin, { purpose: 'post-goto' });

                    if (warmup) { await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {}); }
                    // A number of legacy TYPO3 themes initialise sliders and layout helpers from
                    // window.load rather than DOMContentLoaded. Stabilising before that event races
                    // the site's own initialisation and can produce two internally consistent layouts.
                    await page.waitForLoadState('load', { timeout: 45000 });
                    // A backend-authenticated interactive browser can inject the TYPO3 Admin Panel
                    // into every production page. That is neither a site regression nor valid
                    // anonymous evidence, so refuse it before it reaches DOM/pixel comparison.
                    await assertCleanFrontendSession(page);
                    // Start tracking after the optional warm-up navigation. Requests abandoned by
                    // the reload do not always emit a terminal event and would otherwise poison the
                    // quiet detector with a stale request.
                    const quiet = createQuietDetector(page);
                    // Promote and settle lazy assets before requiring network quiet. Waiting first
                    // deadlocks on a lazy image that has started but cannot finish until it is
                    // scrolled into view.
                    let settle;
                    let network;
                    try {
                      settle = await stabilizePage(page, stabilization);
                      network = await quiet.wait();
                    } finally {
                      quiet.dispose();
                    }

                    const stateResult = await applyState(page, cap.state ?? 'default', stabilization);
                    index.states[cap.captureId] = stateResult;

                    await page.screenshot({ path: file, fullPage: true });
                    await writeFile(
                      metaFile,
                      `${JSON.stringify({
                        captureId: cap.captureId, viewport, state: cap.state, captureAttempt: attempt,
                        visualWorker: workerIndex + 1,
                        documentHeight: settle.height, settle, network, state_result: stateResult,
                      }, null, 2)}\n`, 'utf8',
                    );
                    index.shots += 1;
                    if (attempt > 1) {
                      index.retries.push({ captureId: cap.captureId, attempt, firstError });
                    }
                    break;
                  } catch (err) {
                    // page.screenshot may leave a partial or complete-looking PNG before
                    // throwing. A failed attempt must never leak that file into pairing.
                    await Promise.all([
                      rm(file, { force: true }),
                      rm(metaFile, { force: true }),
                    ]);
                    await page?.close().catch(() => {});
                    if (page === reusablePage) reusablePage = null;
                    if (attempt < maxAttempts) {
                      firstError = err.message;
                      log.warn(
                        `capture ${cap.captureId} failed on attempt ${attempt}; retrying once: `
                        + err.message.split('\n', 1)[0],
                      );
                    } else {
                      index.errors.push({ captureId: cap.captureId, stage: 'visual', attempts: attempt, error: err.message });
                    }
                  } finally {
                    // A navigation-guard violation recorded during the capture is a real
                    // finding even though the event path never throws (throwing inside
                    // Playwright's emitter crashes the process). Surface it here so the
                    // accounting blocks loop 000 exactly like any other capture error.
                    if (navigationGuard?.violations?.length) {
                      index.errors.push({
                        captureId: cap.captureId, stage: 'visual',
                        error: `navigation-guard: ${navigationGuard.violations[0].error}`,
                        navigationViolations: navigationGuard.violations.length,
                      });
                    }
                    navigationGuard?.dispose();
                    if (!reusePage) await page?.close().catch(() => {});
                  }
                }
              }
              return policy.report();
            } finally {
              await reusablePage?.close().catch(() => {});
              await context.close();
            }
          }),
        );
        routeReports.push(...workerReports);
      } finally {
        await Promise.all(browsers.map((browser) => browser.close().catch(() => {})));
      }
    }
    } finally {
      try { await machineLease?.release(); } finally { await releaseMachineLock(); }
    }
    index.routePolicy = mergeRoutePolicyReports(routeReports);
    index.errors.sort(byCaptureId);
    index.retries.sort(byCaptureId);
    index.states = Object.fromEntries(Object.entries(index.states).sort(([a], [b]) => a.localeCompare(b)));
    log.step(`stage 3 complete: ${index.shots} screenshot(s)`);
  }

  return { index };
}

async function affectedTargets(values) {
  const inline = listOpt(values, 'affected', []);
  if (!values['affected-file']) return inline;
  let raw;
  try {
    raw = await readFile(values['affected-file'], 'utf8');
  } catch (error) {
    throw new PreconditionError(`Cannot read --affected-file: ${error.message}`);
  }
  const fromFile = raw.split(/\r?\n/)
    .map((value) => value.trim())
    .filter((value) => value && !value.startsWith('#'));
  return [...new Set([...inline, ...fromFile])];
}

function keyOf(url) { return captureId({ url, viewport: 'http', state: 'record' }); }

async function exists(p) { try { await access(p); return true; } catch { return false; } }

function groupBy(items, fn) {
  const m = new Map();
  for (const i of items) {
    const k = fn(i);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(i);
  }
  return m;
}

function byCaptureId(a, b) {
  return String(a.captureId ?? a.url ?? '').localeCompare(String(b.captureId ?? b.url ?? ''));
}

function mergeRoutePolicyReports(reports) {
  const blockedOrigins = {};
  for (const report of reports) {
    for (const [origin, count] of Object.entries(report.blockedOrigins ?? {})) {
      blockedOrigins[origin] = (blockedOrigins[origin] ?? 0) + count;
    }
  }
  return {
    workers: reports.length,
    blockThirdParty: reports.every((report) => report.blockThirdParty),
    allowedOrigins: [...new Set(reports.flatMap((report) => report.allowedOrigins ?? []))].sort(),
    blockedOrigins: Object.fromEntries(Object.entries(blockedOrigins).sort()),
    blockedRequests: reports.reduce((sum, report) => sum + (report.blockedRequests ?? 0), 0),
    permittedRequests: reports.reduce((sum, report) => sum + (report.permittedRequests ?? 0), 0),
  };
}

export { readFile };
