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

  const result = await captureAll({
    manifest, guard, outRoot, stages, log, journal,
    resume: values.resume, warmup: values.warmup !== false,
    scope,
    allowAll: values['all-urls'] === true,
    visualWorkers: intOpt(
      values,
      'visual-workers',
      scope === 'intermediate' ? DIAGNOSTIC_VISUAL_WORKERS : DEFAULT_VISUAL_WORKERS,
    ),
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
 * FINAL_HARD_CAP is a stop, not a target. Above it the final comparison still samples — seeded,
 * so it is reproducible — and the report must say so. Capturing every URL beyond that point is
 * possible but has to be asked for explicitly, and confirmed twice, because it can turn a
 * ten-minute close into an overnight one.
 */
export const SAMPLING = Object.freeze({
  INTERMEDIATE_PERCENT: 0.10,
  INTERMEDIATE_MIN: 20,
  INTERMEDIATE_MAX: 100,
  FINAL_HARD_CAP: 1000,
});

// Authoritative full captures are serial: sustained parallel renderer load proved
// non-deterministic on the same unchanged site. Intermediate diagnostics deliberately
// trade authority for fast feedback and use a small process-isolated pool.
export const DEFAULT_VISUAL_WORKERS = 1;
export const DIAGNOSTIC_VISUAL_WORKERS = 3;
export const MAX_VISUAL_WORKERS = 6;

/** Returns the URL entries to capture, plus a declaration of what was left out. */
export function selectUrls(allUrls, { scope = 'final', seed = 'sample', allowAll = false } = {}) {
  const total = allUrls.length;
  if (scope === 'intermediate') {
    const want = Math.min(
      SAMPLING.INTERMEDIATE_MAX,
      Math.max(SAMPLING.INTERMEDIATE_MIN, Math.ceil(total * SAMPLING.INTERMEDIATE_PERCENT)),
    );
    if (want >= total) return { urls: allUrls, scope, total, captured: total, omitted: 0, reason: null };
    const picked = sample(allUrls, want, seed);
    return { urls: picked, scope, total, captured: picked.length, omitted: total - picked.length,
      reason: 'intermediate-loop-sample' };
  }
  // final
  if (total <= SAMPLING.FINAL_HARD_CAP || allowAll) {
    return { urls: allUrls, scope, total, captured: total, omitted: 0, reason: null };
  }
  const picked = sample(allUrls, SAMPLING.FINAL_HARD_CAP, seed);
  return { urls: picked, scope, total, captured: picked.length, omitted: total - picked.length,
    reason: 'above-final-hard-cap' };
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
  allowAll = false,
  visualWorkers = DEFAULT_VISUAL_WORKERS,
}) {
  if (!Number.isInteger(visualWorkers) || visualWorkers < 1 || visualWorkers > MAX_VISUAL_WORKERS) {
    throw new HarnessError(`visualWorkers must be an integer from 1 to ${MAX_VISUAL_WORKERS}`);
  }
  if (scope === 'final' && visualWorkers !== DEFAULT_VISUAL_WORKERS) {
    throw new PreconditionError(
      `Final visual evidence requires exactly ${DEFAULT_VISUAL_WORKERS} worker; `
      + 'parallel workers are diagnostic-only.',
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
  const selection = selectUrls(manifest.allUrls, { scope, seed: manifest.seed ?? 'sample', allowAll });
  const urls = selection.urls.map((u) => u.url);
  const nonHtmlUrls = new Set();
  index.selection = selection && { scope: selection.scope, total: selection.total,
    captured: selection.captured, omitted: selection.omitted, reason: selection.reason };
  if (selection.omitted) {
    log.info(`scope ${selection.scope}: ${selection.captured} of ${selection.total} URLs (${selection.omitted} not captured — ${selection.reason})`);
  }

  /* ---- stage 1 + 2: every URL, over plain HTTP. No browser needed, so it scales. ---- */
  if (stages.has('http') || stages.has('dom')) {
    for (const url of urls) {
      try {
        await guard.assertUrl(url, { purpose: 'capture-http' });
        // TYPO3 can emit session cookies while populating a cold page cache and omit them
        // once that same response is cached. Recording the first request therefore makes an
        // unchanged second run look different. Match the browser lifecycle: warm once, then
        // record a fresh guarded response.
        if (warmup) {
          await safeFetch(guard, url, { purpose: 'capture-http-warmup', accept: 'any' });
          index.httpWarmup += 1;
        }
        const res = await safeFetch(guard, url, { purpose: 'capture-http', accept: 'any' });
        const html = ['text/html', 'application/xhtml+xml'].includes(res.contentType);
        if (!html) nonHtmlUrls.add(url);

        if (stages.has('http')) {
          const record = extractRecord({
            requestedUrl: url, url: res.url, status: res.status, headers: res.headers,
            body: res.body, redirects: res.redirects,
          });
          await writeFile(path.join(outRoot, 'http', `${keyOf(url)}.json`), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
          index.http += 1;
        }
        if (stages.has('dom')) {
          if (!html) {
            index.domSkipped += 1;
            continue;
          }
          const { normalized, hits, overreach } = domHash(res.body);
          await writeFile(path.join(outRoot, 'dom', `${keyOf(url)}.html`), normalized, 'utf8');
          const sig = templateSignature(res.body);
          index.signatures[url] = sig.hash;
          if (overreach.length) {
            log.warn(`normalisation overreach on ${url}: ${overreach.join(', ')}`);
          }
          await writeFile(
            path.join(outRoot, 'dom', `${keyOf(url)}.meta.json`),
            `${JSON.stringify({ hits, overreach, signature: sig.hash, tagCount: sig.tagCount }, null, 2)}\n`, 'utf8',
          );
          index.dom += 1;
        }
      } catch (err) {
        index.errors.push({ url: '(redacted)', stage: 'http/dom', error: err.message });
        if (err.exitCode === 5) await journal?.policyBlock({ reason: err.message, target: url, purpose: 'capture' });
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
  const sampledIds = new Set(selection.urls.map((u) => u.id));
  const selectedCaptures = selection.omitted
    ? manifest.captures.filter((c) => sampledIds.has(c.urlId))
    : manifest.captures;
  const captureSet = selectedCaptures.filter((capture) => {
    const url = urlById(manifest, capture.urlId);
    return url && !nonHtmlUrls.has(url);
  });
  if (stages.has('visual') && captureSet.length) {
    const byViewport = groupBy(captureSet, (c) => c.viewport);
    const routeReports = [];
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
        for (let workerIndex = 0; workerIndex < workerCount; workerIndex += 1) {
          const { browser } = await launchBrowser({ log });
          browsers.push(browser);
        }
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
    index.routePolicy = mergeRoutePolicyReports(routeReports);
    index.errors.sort(byCaptureId);
    index.retries.sort(byCaptureId);
    index.states = Object.fromEntries(Object.entries(index.states).sort(([a], [b]) => a.localeCompare(b)));
    log.step(`stage 3 complete: ${index.shots} screenshot(s)`);
  }

  return { index };
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
