/**
 * Capture: HTTP records, DOM snapshots, and screenshots for the manifest set.
 *
 * Every URL is re-validated by the guard IMMEDIATELY before page.goto, re-read from the
 * manifest. The manifest is a file on disk and can be edited between discovery and capture;
 * validating once at discovery would be trusting it.
 */

import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
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
import { listOpt } from '../cli/args.mjs';
import { readJson } from './core.mjs';

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

  const outRoot = values.out ?? path.join(paths.root, 'captures', label);
  const stages = new Set(listOpt(values, 'stages', ['http', 'dom', 'visual']));
  const guard = await UrlGuard.create({ allowedOrigins: manifest.allowedOrigins });

  const result = await captureAll({
    manifest, guard, outRoot, stages, log, journal,
    resume: values.resume, warmup: values.warmup !== false,
    scope: values.scope === 'intermediate' ? 'intermediate' : 'final',
    allowAll: values['all-urls'] === true,
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

export async function captureAll({ manifest, guard, outRoot, stages, log, journal, resume = false, warmup = true, scope = 'final', allowAll = false }) {
  await mkdir(outRoot, { recursive: true });
  for (const kind of ['http', 'dom', 'shots']) await mkdir(path.join(outRoot, kind), { recursive: true });

  const index = { http: 0, dom: 0, shots: 0, errors: [], signatures: {}, states: {} };
  const selection = selectUrls(manifest.allUrls, { scope, seed: manifest.seed ?? 'sample', allowAll });
  const urls = selection.urls.map((u) => u.url);
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
        const res = await safeFetch(guard, url, { purpose: 'capture-http', accept: 'html' });

        if (stages.has('http')) {
          const record = extractRecord({
            url: res.url, status: res.status, headers: res.headers,
            body: res.body, redirects: res.redirects,
          });
          await writeFile(path.join(outRoot, 'http', `${keyOf(url)}.json`), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
          index.http += 1;
        }
        if (stages.has('dom')) {
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
    log.step(`stage 1/2 complete: ${index.http} http, ${index.dom} dom, ${index.errors.length} error(s)`);
  }

  /* ---- stage 3: screenshots for the manifest capture set only ---- */
  // Restrict to the sampled URLs too. Sampling stage 1+2 while stage 3 shot everything meant an
  // "intermediate" run still paid the full screenshot cost — which is the only expensive part.
  // Captures reference the manifest by urlId, not by url.
  const sampledIds = new Set(selection.urls.map((u) => u.id));
  const captureSet = selection.omitted
    ? manifest.captures.filter((c) => sampledIds.has(c.urlId))
    : manifest.captures;
  if (stages.has('visual') && captureSet.length) {
    const { browser } = await launchBrowser({ log });
    try {
      const byViewport = groupBy(captureSet, (c) => c.viewport);
      for (const [viewport, caps] of byViewport) {
        if (!VIEWPORTS[viewport]) { log.warn(`unknown viewport ${viewport}, skipped`); continue; }
        const context = await newContext(browser, { viewport });
        const policy = createRoutePolicy({ allowedOrigins: manifest.allowedOrigins });
        await policy.attach(context);

        for (const cap of caps) {
          const url = urlById(manifest, cap.urlId);
          if (!url) continue;
          const file = path.join(outRoot, 'shots', `${cap.captureId}.png`);
          if (resume && await exists(file)) { index.shots += 1; continue; }

          const page = await context.newPage();
          try {
            await guard.assertUrl(url, { purpose: 'capture-goto' });   // again, right before goto
            attachNavigationGuard(page, guard, new URL(url).origin);
            const quiet = createQuietDetector(page);

            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
            guard.assertSameOrigin(page.url(), new URL(url).origin, { purpose: 'post-goto' });

            if (warmup) { await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {}); }
            await quiet.wait();
            quiet.dispose();

            const stateResult = await applyState(page, cap.state ?? 'default');
            index.states[cap.captureId] = stateResult;

            const settle = await stabilizePage(page);
            await page.screenshot({ path: file, fullPage: true });
            await writeFile(
              path.join(outRoot, 'shots', `${cap.captureId}.meta.json`),
              `${JSON.stringify({
                captureId: cap.captureId, viewport, state: cap.state,
                documentHeight: settle.height, settle, state_result: stateResult,
              }, null, 2)}\n`, 'utf8',
            );
            index.shots += 1;
          } catch (err) {
            index.errors.push({ captureId: cap.captureId, stage: 'visual', error: err.message });
          } finally {
            await page.close().catch(() => {});
          }
        }
        index.routePolicy = policy.report();
        await context.close();
      }
    } finally {
      await browser.close().catch(() => {});
    }
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

export { readFile };
