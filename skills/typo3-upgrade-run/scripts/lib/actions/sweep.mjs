/**
 * Backend module sweep, deterministic smoke test, and Lighthouse.
 *
 * Three v1 defects are closed here:
 *  - Module identifiers went straight into a CSS selector. Now escaped, and located by
 *    attribute value rather than string interpolation.
 *  - Non-clickable entries were marked "skipped" while the run failed only on failed>0, so
 *    "12 ok, 3 skipped" exited 0 with three modules unchecked. Groups are now distinguished
 *    from real modules, and an UNEXPECTED skip fails the run.
 *  - Credentials were sent to whatever --base-url produced, following redirects. Now the
 *    origin is asserted before they are typed and again after the login POST settles.
 */

import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { parse as parseYaml } from 'yaml';
import { EXIT, HarnessError, PreconditionError, PolicyError } from '../cli/exit-codes.mjs';
import { UrlGuard } from '../net/url-guard.mjs';
import { launchBrowser, newContext, stabilizePage, VIEWPORTS } from '../browser/launch.mjs';
import { createRoutePolicy } from '../browser/route-policy.mjs';
import { envelope, writeReport } from '../report/write.mjs';
import { untrusted } from '../util/redact.mjs';
import { intOpt, listOpt } from '../cli/args.mjs';
import { readJson } from './core.mjs';
import { readEvidenceContext } from '../run/evidence.mjs';
import { sample as seededSample } from '../util/rng.mjs';
import { applyState, stateByName } from '../browser/states.mjs';
import { assertCleanFrontendSession } from '../browser/session.mjs';
import { consentStateFor } from '../browser/stabilize.mjs';
import { axeJobs, collectAxeJobs } from '../browser/axe-jobs.mjs';
import { acquireMachineResources } from '../util/machine-resources.mjs';

const require_ = createRequire(import.meta.url);

export const ERROR_MARKERS = Object.freeze([
  'Oops, an error occurred', 'Uncaught TYPO3 Exception', 'Fatal error:', 'Parse error:',
  'Call to undefined', 'An exception occurred', 'Whoops, looks like something went wrong',
]);

/** Entries that legitimately do not open a module. Anything else skipping is a failure. */
export const EXPECTED_SKIP_KINDS = Object.freeze(['group']);

export function escapeAttrValue(value) {
  // Prefer CSS.escape in-page; this is the Node-side fallback for building the selector.
  return String(value).replace(/["\\]/g, '\\$&');
}

export async function backendSweep({ values, paths, log, journal }) {
  const state = await readJson(paths.statePath);
  const baseUrl = values['base-url'] ?? state?.project?.trusted_origin;
  if (!baseUrl) throw new HarnessError('--base-url is required');

  const { user, password } = readCredentials(values);
  if (!user || !password) {
    throw new PreconditionError(
      'Backend credentials missing. Provide BE_USER and BE_PASSWORD in the process environment '
      + 'or via --env-file. No .env is ever loaded implicitly.',
    );
  }

  const guard = await UrlGuard.create({ allowedOrigins: [baseUrl] });
  const trusted = (await guard.assertUrl(baseUrl, { purpose: 'backend-sweep' })).origin;
  const loginUrl = new URL('/typo3/', trusted).href;

  const { browser } = await launchBrowser({ log });
  const report = { baseUrl: trusted, modules: [], groups: 0, realModules: 0, opened: 0, failed: 0, skippedExpected: 0, skippedUnexpected: 0 };

  try {
    const context = await newContext(browser, { viewport: 'desktop' });
    const policy = createRoutePolicy({ allowedOrigins: [trusted] });
    await policy.attach(context);
    const page = await context.newPage();

    await guard.assertUrl(loginUrl, { purpose: 'backend-login' });
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

    // Assert BEFORE the credentials are typed.
    guard.assertSameOrigin(page.url(), trusted, { purpose: 'pre-credential' });

    await page.fill('input[name="username"]', user);
    await page.fill('input[type="password"]', password);
    await Promise.all([
      page.waitForLoadState('domcontentloaded').catch(() => {}),
      page.click('button[type="submit"]'),
    ]);
    await page.waitForTimeout(1500);

    // And again after the POST settles — a 302 to a foreign host is the classic leak.
    guard.assertSameOrigin(page.url(), trusted, { purpose: 'post-login' });

    const menu = await page.$('[data-modulemenu-identifier]');
    if (!menu) {
      throw new PreconditionError(
        'Login failed or the module menu was not found. Check the credentials and the selector '
        + 'assumptions for this TYPO3 version.',
      );
    }

    const entries = await page.$$eval('[data-modulemenu-identifier]', (els) => els.map((el) => ({
      identifier: el.getAttribute('data-modulemenu-identifier'),
      kind: el.tagName.toLowerCase() === 'a' || el.hasAttribute('href') ? 'module' : 'group',
      untrustedLabel: (el.textContent ?? '').trim().slice(0, 120),
    })).filter((e) => e.identifier));

    report.groups = entries.filter((e) => e.kind === 'group').length;
    report.realModules = entries.filter((e) => e.kind === 'module').length;
    const settle = intOpt(values, 'settle', 1500);

    // Record the status of each module's own document response. Sub-resources are
    // ignored: a missing icon is not a broken module, and counting it as one is how a
    // sweep ends up ignored.
    let currentModule = null;
    const moduleStatus = new Map();
    page.on('response', (res) => {
      if (!currentModule) return;
      const req = res.request();
      if (req.resourceType() !== 'document') return;
      moduleStatus.set(currentModule, res.status());
    });
    const statusFor = (id) => moduleStatus.get(id);

    for (const entry of entries) {
      currentModule = entry.identifier;
      const row = {
        identifier: entry.identifier, kind: entry.kind,
        untrustedLabel: untrusted(entry.untrustedLabel),
        status: 'skipped', reasons: [],
      };

      if (entry.kind === 'group') {
        row.status = 'skipped'; row.skipExpected = true;
        report.skippedExpected += 1; report.modules.push(row); continue;
      }

      try {
        // Located by attribute value, escaped in-page with CSS.escape.
        const handle = await page.evaluateHandle(
          (id) => document.querySelector(`[data-modulemenu-identifier="${CSS.escape(id)}"]`),
          entry.identifier,
        );
        const el = handle.asElement();
        if (!el) throw new Error('module entry not found after escaping');

        await el.click({ timeout: 5000 });
        await page.waitForTimeout(settle);
        guard.assertSameOrigin(page.url(), trusted, { purpose: `module ${entry.identifier}` });

        const frame = page.frames().find((f) => f.name() === 'list_frame') ?? page.mainFrame();
        const text = (await frame.evaluate(() => document.body?.innerText ?? '').catch(() => '')).slice(0, 5000);

        // A server error is the only unambiguous signal. Text markers alone are not:
        // the Log and Reports modules exist to DISPLAY log entries, so a historical
        // "Uncaught TYPO3 Exception" from an earlier failed upgrade is legitimate
        // content there, and matching it anywhere in the body fails a module that
        // rendered perfectly. That false positive is worse than a missed marker,
        // because it trains the reader to wave the sweep's findings through.
        //
        // TYPO3's exception page REPLACES the module with an error document, so when
        // the response status does not give it away the marker still has to appear at
        // the very top of the document rather than buried in a table of log rows.
        const status = statusFor(entry.identifier);
        const head = text.slice(0, 300);
        const hit = ERROR_MARKERS.find((m) => head.includes(m));
        const serverError = typeof status === 'number' && status >= 500;

        if (serverError || hit) {
          row.status = 'fail';
          if (serverError) row.reasons.push(`http ${status}`);
          if (hit) row.reasons.push(`error marker: ${hit}`);
          row.untrustedExcerpt = untrusted(head);
          report.failed += 1;
        } else {
          row.status = 'ok';
          if (typeof status === 'number') row.httpStatus = status;
          report.opened += 1;
        }
      } catch (err) {
        if (err instanceof PolicyError) throw err;
        row.status = 'fail';
        row.reasons.push(err.message.slice(0, 200));
        report.failed += 1;
      }
      report.modules.push(row);
    }

    report.skippedUnexpected = report.modules.filter(
      (m) => m.status === 'skipped' && !m.skipExpected,
    ).length;
    report.routePolicy = policy.report();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
  }

  const coverage = report.realModules === 0 ? 0 : Math.round((report.opened / report.realModules) * 100);
  const findings = [];
  let n = 0;
  for (const m of report.modules.filter((x) => x.status === 'fail')) {
    findings.push({
      id: `F-310-${String(++n).padStart(3, '0')}`, target: `module:${m.identifier}`,
      class: 'regression', severity: 'blocker', status: 'open',
      reasons: m.reasons, untrustedExcerpt: m.untrustedExcerpt ?? null,
    });
  }
  if (report.skippedUnexpected > 0) {
    findings.push({
      id: `F-310-${String(++n).padStart(3, '0')}`, target: 'module-coverage',
      class: 'regression', severity: 'blocker', status: 'open',
      reason: `${report.skippedUnexpected} module(s) were skipped unexpectedly — coverage ${coverage}% < 100%`,
    });
  }

  const verdict = findings.length ? 'findings' : 'pass';
  const reportPath = values.report ?? path.join(paths.root, 'report.backend-sweep.json');
  const evidence = await actionEvidence(paths, values, '310');
  const written = await writeReport(reportPath, envelope({
    kind: 'backend-sweep', ...evidence, verdict,
    counts: {
      groups: report.groups, realModules: report.realModules, opened: report.opened,
      failed: report.failed, skippedExpected: report.skippedExpected,
      skippedUnexpected: report.skippedUnexpected, coveragePercent: coverage,
    },
    findings,
    extra: { auth: { userIsDedicated: null, credentialSource: values['credentials-from'] ?? 'env', originAssertedBeforeCredentials: true, originAssertedAfterLogin: true }, modules: report.modules },
  }), { profile: values['redaction-profile'], dryRun: values['dry-run'] });

  await journal.append('note', { note: 'backend sweep', coverage, failed: report.failed, skippedUnexpected: report.skippedUnexpected });

  log[verdict === 'pass' ? 'success' : 'finding'](
    `Backend sweep: ${report.opened}/${report.realModules} modules opened (${coverage}%), `
    + `${report.failed} failed, ${report.skippedUnexpected} unexpectedly skipped`,
  );

  return {
    exitCode: verdict === 'pass' ? EXIT.PASS : EXIT.FINDINGS,
    verdict, coverage, reports: [written.path],
    message: verdict === 'pass' ? '100% module coverage, no failures' : `${findings.length} backend finding(s)`,
  };
}

function readCredentials(values) {
  // Process environment only, or an explicitly named file. Never an implicit .env.
  return { user: process.env.BE_USER ?? null, password: process.env.BE_PASSWORD ?? null };
}

/* ------------------------------------------------------------- smoke */

/**
 * Deterministic, read-only. v1 clicked RANDOM links, which can reach logout, cache
 * clearing, deletion, unsubscribe, scheduler actions and large downloads.
 */
export const DESTRUCTIVE = /logout|signout|abmelden|delete|remove|destroy|clear|flush|unsubscribe|abbestellen|export|download|\bcmd=|\baction=delete|tx_.*\[delete\]/i;

export function isSafeLink(href, trustedOrigin) {
  let u;
  try { u = new URL(href, trustedOrigin); } catch { return false; }
  if (u.origin !== new URL(trustedOrigin).origin) return false;
  if (/^\/typo3(\/|$)/.test(u.pathname)) return false;
  if (DESTRUCTIVE.test(u.href)) return false;
  if (/\.(zip|pdf|docx?|xlsx?|csv|tar|gz|dmg|exe)$/i.test(u.pathname)) return false;
  return true;
}

export async function smoke({ values, paths, log }) {
  const manifest = await readJson(paths.urlManifest);
  if (!manifest) throw new PreconditionError('No URL manifest. Run "t3u discover-urls" first.');

  const guard = await UrlGuard.create({ allowedOrigins: manifest.allowedOrigins });
  const trusted = manifest.allowedOrigins[0];
  const maxSteps = intOpt(values, 'max-steps', 25);

  // Deterministic order: tier-1 URLs from the manifest, not random clicks.
  const targets = manifest.allUrls.filter((u) => u.tier === 1).slice(0, maxSteps).map((u) => u.url);
  if (!targets.length) targets.push(...manifest.allUrls.slice(0, maxSteps).map((u) => u.url));

  const { browser } = await launchBrowser({ log });
  const visited = [];
  const findings = [];
  let n = 0;

  try {
    const context = await newContext(browser, { viewport: 'desktop' });
    const policy = createRoutePolicy({ allowedOrigins: manifest.allowedOrigins });
    await policy.attach(context);
    const page = await context.newPage();

    for (const url of targets) {
      try {
        await guard.assertUrl(url, { purpose: 'smoke' });
        const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        guard.assertSameOrigin(page.url(), trusted, { purpose: 'smoke-nav' });
        const status = res?.status() ?? 0;
        const text = (await page.evaluate(() => document.body?.innerText ?? '').catch(() => '')).slice(0, 5000);
        const marker = ERROR_MARKERS.find((m) => text.includes(m));
        visited.push({ url, status, ok: status < 400 && !marker });

        if (status >= 400 || marker) {
          findings.push({
            id: `F-310-${String(++n).padStart(3, '0')}`, target: url,
            class: 'regression', severity: status >= 500 ? 'blocker' : 'major', status: 'open',
            httpStatus: status, marker: marker ?? null,
            untrustedExcerpt: marker ? untrusted(text.slice(0, 300)) : null,
          });
        }
      } catch (err) {
        findings.push({
          id: `F-310-${String(++n).padStart(3, '0')}`, target: url,
          class: 'regression', severity: 'blocker', status: 'open', error: err.message.slice(0, 200),
        });
      }
    }
    await context.close();
  } finally {
    await browser.close().catch(() => {});
  }

  const verdict = findings.length ? 'findings' : 'pass';
  const reportPath = values.report ?? path.join(paths.root, 'report.smoke.json');
  const evidence = await actionEvidence(paths, values, '310');
  const written = await writeReport(reportPath, envelope({
    kind: 'smoke', ...evidence, verdict,
    counts: { visited: visited.length, ok: visited.filter((v) => v.ok).length, findings: findings.length },
    findings, extra: { deterministic: true, randomClicking: false, visited },
  }), { profile: values['redaction-profile'], dryRun: values['dry-run'] });

  log[verdict === 'pass' ? 'success' : 'finding'](`Smoke: ${visited.filter((v) => v.ok).length}/${visited.length} OK`);
  return {
    exitCode: verdict === 'pass' ? EXIT.PASS : EXIT.FINDINGS,
    verdict, reports: [written.path],
    message: verdict === 'pass' ? 'smoke clean' : `${findings.length} smoke finding(s)`,
  };
}

/* -------------------------------------------------------- lighthouse */

export async function lighthouse({ values, paths, log }) {
  const manifest = await readJson(paths.urlManifest);
  if (!manifest) throw new PreconditionError('No URL manifest. Run "t3u discover-urls" first.');
  const evidenceContext = await readEvidenceContext(paths);
  const loopName = await resolveQualityLoop(paths, values, evidenceContext.state);
  const loopId = loopName.slice(0, 3);
  const runs = intOpt(values, 'runs', 3);
  if (runs < 3) throw new PreconditionError('Lighthouse requires at least three measurements per URL.');
  const formFactor = values['form-factor'] ?? 'mobile';
  if (!['mobile', 'desktop'].includes(formFactor)) throw new PreconditionError('--form-factor must be mobile or desktop.');
  // Validate configuration before starting Chrome or spending minutes auditing pages.
  if (!values.budget) throw new PreconditionError('Lighthouse requires an explicit predeclared --budget; no budget is not a pass.');
  const budget = await readLighthouseBudget(values.budget, values.mode ?? 'verify', formFactor);

  let lighthouseMod;
  let chromeLauncher;
  try {
    lighthouseMod = (await import('lighthouse')).default;
    chromeLauncher = await import('chrome-launcher');
  } catch (err) {
    throw new HarnessError(`Lighthouse is not installed: ${err.message}. Run npm ci.`);
  }

  const allUrls = manifest.allUrls.map((entry) => entry.url);
  const urls = finalLighthouseSample(allUrls, manifest.baseUrl, manifest.seed ?? 'lighthouse-final');
  const guard = await UrlGuard.create({ allowedOrigins: manifest.allowedOrigins });

  // One Chrome for the whole run. v1 spawned and killed one PER URL — 100 cold starts.
  //
  // `--ignore-certificate-errors` is not optional here: DDEV serves the site over HTTPS
  // with a locally-generated certificate, and without this flag Lighthouse does not fail
  // — it waits, and the command hangs until something kills it.
  const lease = await acquireMachineResources({ exclusive: true, owner: 'lighthouse', log,
    deadlineAt: evidenceContext.state.runtime?.deadline_at });
  let chrome;
  const results = [];
  const rawRuns = [];
  try {
  chrome = await chromeLauncher.launch({
    chromeFlags: [
      '--headless=new', '--disable-dev-shm-usage', '--disable-gpu',
      '--ignore-certificate-errors',
      ...(process.env.T3U_ALLOW_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
    ],
  });

    for (const url of urls) {
      await guard.assertUrl(url, { purpose: 'lighthouse' });
      const perUrl = [];
      for (let i = 0; i < runs; i += 1) {
        // A per-audit deadline. Lighthouse can sit indefinitely on a page that never
        // reaches a quiet network, and a gate that hangs is worse than one that fails:
        // nobody can tell it apart from slow progress.
        const lhr = (await withDeadline(
          lighthouseMod(url, {
            port: chrome.port, output: 'json', logLevel: 'error', formFactor,
            screenEmulation: formFactor === 'mobile'
              ? { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false }
              : { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false },
          }),
          intOpt(values, 'timeout', 120) * 1000,
          `lighthouse timed out on ${url}`,
        )).lhr;
        if (!completeLighthouseAudit(lhr)) {
          throw new HarnessError('Lighthouse returned an incomplete audit or runtime error; this is not a measured pass.');
        }
        await guard.assertUrl(lhr.finalDisplayedUrl ?? url, { purpose: 'lighthouse-final' });
        perUrl.push(lhr);
        rawRuns.push(lhr);
      }
      results.push(summarise(url, perUrl, formFactor));
      log.debug(`lighthouse ${url}: perf ${results.at(-1).scores.performance.median}`);
    }
  } finally {
    // chrome-launcher's kill() returns void, not a Promise. Calling .catch() on it threw
    // "Cannot read properties of undefined (reading 'catch')" from the finally block,
    // which masked whatever the real error had been.
    try { await chrome?.kill(); } finally { await lease.release(); }
  }

  // Only a budget produces findings. A local absolute score is indicative, not a verdict.
  const findings = lighthouseBudgetFindings(results, budget, loopId, formFactor);
  const verdict = findings.length ? 'findings' : 'pass';
  const optimizationCandidates = results
    .flatMap((result) => result.opportunities.map((opportunity) => ({
      url: result.url,
      ...opportunity,
    })))
    .sort((a, b) => (b.savingsMs ?? 0) - (a.savingsMs ?? 0));

  const label = String(values.label ?? 'final');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(label)) {
    throw new HarnessError('--label must use lowercase letters, numbers and hyphens.');
  }
  const reportPath = values.report
    ?? path.join(paths.loopArtifacts(loopName), `report.lighthouse.${label}.json`);
  const written = await writeReport(reportPath, envelope({
    kind: 'lighthouse',
    run: {
      ...evidenceContext.run,
      loopId,
      track: values.mode === 'elevation' ? 'elevation' : 'invariance',
    },
    inputs: evidenceContext.inputs,
    verdict,
    counts: { urls: results.length, runsPerUrl: runs },
    findings,
    extra: {
      lighthouse: { formFactor, runsPerUrl: runs, aggregate: 'median', machineWaitMs: lease.waitMs, exclusive: true },
      toolVersion: rawRuns[0]?.lighthouseVersion,
      browser: rawRuns[0]?.environment?.hostUserAgent,
      rawRuns,
      caveats: [
        'Measured locally in DDEV. Absolute scores are indicative; the delta between runs is the evidence.',
        'TBT is reported as an INP PROXY. INP is a field metric and cannot be measured in the lab.',
        'Local TTFB can be faster or slower than hosting and is not transferable.',
      ],
      results,
      optimizationCandidates,
      agentBrief: {
        moment: values.mode === 'elevation' ? 'approved Contract B performance work' : 'Contract A verification only; do not implement unrelated opportunities',
        workflow: values.mode === 'elevation' ? [
          'Select the highest measured opportunity by expected savings.',
          'Add or update regression tests before changing the site.',
          'Change one cause only.',
          'Run the project tests and the same three-page Lighthouse sample.',
          'Keep the change only when tests pass, the measured target improves, and Contract A checks remain green.',
        ] : ['Inspect failed budgets and preserve raw reports.', 'Route actual upgrade regressions to the affected graph node; unrelated optimization needs separately approved scope.'],
      },
      budgetApplied: Boolean(budget),
    },
  }), { profile: values['redaction-profile'], dryRun: values['dry-run'] });

  log[findings.length ? 'finding' : 'success'](
    `Lighthouse: ${results.length} URL(s) × ${runs} run(s), medians recorded, ${findings.length} quality gap(s)`,
  );
  log.warn('Local scores are indicative. Never quote them as field results, and never write "INP passing".');

  return {
    exitCode: findings.length ? EXIT.FINDINGS : EXIT.PASS,
    verdict,
    reports: [written.path],
    message: findings.length
      ? `lighthouse recorded with ${findings.length} quality-gap finding(s)`
      : 'lighthouse recorded',
  };
}

/* --------------------------------------------------------------- axe */

export async function axeAudit({ values, paths, log }) {
  const manifest = await readJson(paths.urlManifest);
  if (!manifest) throw new PreconditionError('No URL manifest. Run "t3u discover-urls" first.');
  const evidenceContext = await readEvidenceContext(paths);
  const loopName = await resolveQualityLoop(paths, values, evidenceContext.state);
  const loopId = loopName.slice(0, 3);
  const urls = finalAxeSample(manifest, intOpt(values, 'sample', 12));
  const viewports = listOpt(values, 'viewports', ['desktop', 'tablet', 'mobile']);
  const states = listOpt(values, 'states', ['default', 'keyboard-focus', 'nav-open']);
  const workers = intOpt(values, 'workers', 4);
  if (!Number.isInteger(workers) || workers < 1 || workers > 12) throw new HarnessError('axe workers must be 1..12.');
  if (viewports.some(viewport => !VIEWPORTS[viewport])) throw new HarnessError('Unknown axe viewport.');
  const jobs = axeJobs(urls, viewports, states);
  if (states.length > 3) throw new PreconditionError('Use at most three global states; test extra widgets in targeted journeys.');
  const unknown = states.filter((state) => !stateByName(state));
  if (unknown.length) throw new HarnessError(`Unknown axe interaction state(s): ${unknown.join(', ')}`);
  const tags = listOpt(values, 'tags', ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']);
  const failImpacts = new Set(listOpt(values, 'fail-impacts', ['critical', 'serious']));
  const guard = await UrlGuard.create({ allowedOrigins: manifest.allowedOrigins });
  const stabilization = manifest.stabilization ?? {};
  const consent = stabilization.consent
    ? consentStateFor({
        ...stabilization.consent,
        origin: stabilization.consent.origin ?? manifest.allowedOrigins[0],
      })
    : undefined;
  const axeSource = await readFile(require_.resolve('axe-core/axe.min.js'), 'utf8');
  const lease = await acquireMachineResources({ browsers: Math.min(workers, jobs.length), owner: 'axe', log,
    deadlineAt: evidenceContext.state.runtime?.deadline_at });
  let browser, collected;
  try {
    ({ browser } = await launchBrowser({ log }));
    collected = await collectAxeJobs(jobs, workers, async ({ url, viewport, state }) => {
      // A fresh context per job isolates cookies, storage and stateful navigation.
      const context = await newContext(browser, { viewport, storageState: consent, stabilize: stabilization });
      try {
        const policy = createRoutePolicy({ allowedOrigins: manifest.allowedOrigins });
        await policy.attach(context);
        const page = await context.newPage();
        await guard.assertUrl(url, { purpose: 'axe-goto' });
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        guard.assertSameOrigin(page.url(), new URL(url).origin, { purpose: 'axe-post-goto' });
        await page.waitForLoadState('load', { timeout: 45_000 });
        await assertCleanFrontendSession(page);
        await stabilizePage(page, stabilization);
        const stateResult = await applyState(page, state, stabilization);
        if (stateResult.skipped) return { skipped: true, reason: stateResult.reason };
        if (!stateResult.applied) throw new HarnessError(stateResult.reason ?? 'Interaction state was not applied');
        await page.addScriptTag({ content: axeSource });
        const result = await withDeadline(page.evaluate(async (runTags) => {
          const report = await globalThis.axe.run(document, {
            runOnly: { type: 'tag', values: runTags },
            resultTypes: ['violations', 'incomplete'],
          });
          const slim = (item) => ({
            id: item.id, impact: item.impact, nodes: item.nodes.length,
            targets: item.nodes.slice(0, 5).map((node) => node.target.join(' ')),
          });
          return { violations: report.violations.map(slim), incomplete: report.incomplete.map(slim) };
        }, tags), 60_000, 'axe evaluation timed out');
        return { skipped: false, ...result };
      } finally {
        await context.close();
      }
    });
  } finally {
    try { await browser?.close(); } finally { await lease.release(); }
  }
  const { observations, coverageFailures, execution } = collected;
  execution.machineWaitMs = lease.waitMs;

  const clusters = aggregateAxeViolations(observations);
  const blocking = clusters.filter((cluster) => failImpacts.has(cluster.impact));
  const reportClusters = clusters.map(({ targets, ...cluster }) => ({
    ...cluster,
    untrustedTargets: targets.map(untrusted),
  }));
  const reportCoverageFailures = coverageFailures.map(({ reason, ...failure }) => ({
    ...failure,
    untrustedReason: untrusted(reason),
  }));
  const findings = blocking.map((cluster, index) => ({
    id: `F-${loopId}-${String(index + 1).padStart(3, '0')}`,
    target: `${cluster.rule}:${cluster.state}:${cluster.viewport}`,
    class: 'improvement',
    severity: ['critical', 'serious'].includes(cluster.impact) ? 'major' : 'minor',
    status: 'open',
    impact: cluster.impact,
    affectedPages: cluster.pages,
    affectedNodes: cluster.nodes,
    untrustedTargets: cluster.targets.map(untrusted),
  }));
  for (const failure of coverageFailures) {
    findings.push({
      id: `F-${loopId}-${String(findings.length + 1).padStart(3, '0')}`,
      target: `${failure.viewport}:${failure.state}`,
      class: 'improvement', severity: 'major', status: 'open',
      coverageFailure: true, untrustedReason: untrusted(failure.reason),
    });
  }
  const verdict = findings.length ? 'findings' : 'pass';
  const label = String(values.label ?? 'final');
  const reportPath = values.report
    ?? path.join(paths.loopArtifacts(loopName), `report.axe.${label}.json`);
  const written = await writeReport(reportPath, envelope({
    kind: 'axe',
    run: { ...evidenceContext.run, loopId, track: values.mode === 'elevation' ? 'elevation' : 'invariance' },
    inputs: evidenceContext.inputs,
    verdict,
    counts: {
      urls: urls.length, viewports: viewports.length, states: states.length,
      observations: observations.length, violationClusters: clusters.length,
      blockingClusters: blocking.length,
      incomplete: observations.reduce((n, item) => n + (item.incomplete?.length ?? 0), 0),
      coverageFailures: coverageFailures.length,
      expected: execution.expected, completed: execution.completed, skipped: execution.skipped,
    },
    findings,
    extra: {
      axe: { tags, failImpacts: [...failImpacts], sample: urls, viewports, states },
      execution,
      clusters: reportClusters,
      coverageFailures: reportCoverageFailures,
      caveat: 'No automated violations is not WCAG conformance; incomplete results and manual criteria remain.',
    },
  }), { profile: values['redaction-profile'], dryRun: values['dry-run'] });

  log[findings.length ? 'finding' : 'success'](
    `axe: ${urls.length} URL(s) × ${viewports.length} viewport(s) × ${states.length} state(s), `
    + `${blocking.length} blocking cluster(s), ${coverageFailures.length} coverage failure(s)`,
  );
  return {
    exitCode: findings.length ? EXIT.FINDINGS : EXIT.PASS,
    verdict, reports: [written.path],
    message: findings.length ? `${findings.length} axe quality finding(s)` : 'axe automated checks green',
  };
}

export function finalAxeSample(manifest, limit = 12) {
  if (!Number.isInteger(limit) || limit < 3) throw new PreconditionError('axe --sample must be at least 3.');
  const all = manifest.allUrls?.map((entry) => entry.url) ?? [];
  const sample = stratifyByTemplate(all, Math.min(limit, Math.max(3, all.length)), manifest.baseUrl);
  if (new Set(sample).size < 3) {
    throw new PreconditionError('axe requires at least three distinct frontend URLs.');
  }
  return sample;
}

export function aggregateAxeViolations(observations) {
  const grouped = new Map();
  for (const observation of observations) {
    for (const violation of observation.violations ?? []) {
      const key = `${violation.id}\0${violation.impact}\0${observation.viewport}\0${observation.state}`;
      const current = grouped.get(key) ?? {
        rule: violation.id, impact: violation.impact, viewport: observation.viewport,
        state: observation.state, pages: 0, nodes: 0, targets: [],
      };
      current.pages += 1;
      current.nodes += violation.nodes;
      current.targets.push(...violation.targets);
      current.targets = [...new Set(current.targets)].slice(0, 8);
      grouped.set(key, current);
    }
  }
  return [...grouped.values()].sort((a, b) => (
    `${a.rule}:${a.viewport}:${a.state}`.localeCompare(`${b.rule}:${b.viewport}:${b.state}`)
  ));
}

/** Reject rather than hang. A gate that never returns cannot be distinguished from a slow one. */
export function withDeadline(promise, ms, message) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new HarnessError(message)), ms); }),
  ]);
}

/**
 * Sample by template class, not uniformly.
 *
 * A random draw from a sitemap that is mostly leaf pages measures the leaf template over
 * and over and never touches the listing template — which is normally the slower one,
 * because it renders many records and many images. Performance problems live in
 * templates, so the sample has to cover them.
 *
 * Classified from the URL alone, so this needs no database access:
 *   home     the site root
 *   listing  a path that is the prefix of other sampled paths (a section index)
 *   detail   a leaf
 *
 * One of each is guaranteed before the remainder is filled in manifest order, which is
 * already seeded — so the selection stays reproducible across runs.
 */
export function stratifyByTemplate(urls, limit, baseUrl) {
  // The site root is frequently absent from the sitemap sample — it is often a shortcut
  // page, and sitemap generators skip it. That silently drops the single URL every
  // visitor loads, so add it back before classifying.
  if (baseUrl) {
    const root = new URL('/', baseUrl).href;
    if (!urls.some((u) => { try { return new URL(u).pathname === '/'; } catch { return false; } })) {
      urls = [root, ...urls];
    }
  }
  if (urls.length <= limit) return urls;
  const pathOf = (u) => { try { return new URL(u).pathname.replace(/\/+$/, '') || '/'; } catch { return u; } };
  const paths = urls.map(pathOf);
  const classify = (u, i) => {
    const p = paths[i];
    if (p === '/') return 'home';
    return paths.some((q, j) => j !== i && q.startsWith(`${p}/`)) ? 'listing' : 'detail';
  };
  const buckets = { home: [], listing: [], detail: [] };
  urls.forEach((u, i) => buckets[classify(u, i)].push(u));

  const picked = [];
  const seen = new Set();
  const take = (u) => { if (u && !seen.has(u) && picked.length < limit) { seen.add(u); picked.push(u); } };
  for (const k of ['home', 'listing', 'detail']) take(buckets[k][0]);
  for (const u of urls) take(u);
  return picked;
}

/** Final reporting: fixed homepage plus two reproducibly random non-home pages. */
export function finalLighthouseSample(urls, baseUrl, seed = 'lighthouse-final') {
  const root = new URL('/', baseUrl).href;
  const candidates = [...new Set(urls)]
    .filter((url) => {
      try { return new URL(url).pathname !== '/'; } catch { return false; }
    })
    .sort();
  return [root, ...seededSample(candidates, Math.min(2, candidates.length), seed)];
}

export function completeLighthouseAudit(lhr) {
  return Boolean(lhr && !lhr.runtimeError && ['performance', 'accessibility', 'best-practices', 'seo']
    .every(id => Number.isFinite(lhr.categories?.[id]?.score)
      && lhr.categories[id].score >= 0 && lhr.categories[id].score <= 1));
}

export function lighthouseBudgetFindings(results, budget, loopId = '500', formFactor = 'mobile') {
  if (!budget) return [];
  const checks = [
    ['scores.performance.median', `performance.lighthouse_performance_${formFactor}`, 'min'],
    ['scores.accessibility.median', 'accessibility.lighthouse_accessibility', 'min'],
    ['scores.bestPractices.median', 'performance.lighthouse_best_practices', 'min'],
    ['scores.seo.median', 'seo.lighthouse_seo', 'min'],
    ['metrics.lcp.median', `performance.lcp_${formFactor}_ms`, 'max'],
    ['metrics.cls.median', 'performance.cls', 'max'],
    ['metrics.tbt.median', 'performance.tbt_ms', 'max'],
    ['metrics.fcp.median', 'performance.fcp_ms', 'max'],
    ['metrics.si.median', 'performance.speed_index_ms', 'max'],
  ];
  const findings = [];
  for (const result of results) {
    for (const [resultPath, budgetKey, direction] of checks) {
      const expected = readPath(budget, budgetKey);
      const actual = readPath(result, resultPath);
      if (typeof expected !== 'number' || typeof actual !== 'number') continue;
      const misses = direction === 'min' ? actual < expected : actual > expected;
      if (!misses) continue;
      findings.push({
        id: `F-${String(loopId).padStart(3, '0')}-${String(findings.length + 1).padStart(3, '0')}`,
        target: result.url,
        class: 'improvement',
        severity: 'minor',
        status: 'open',
        metric: resultPath,
        expected,
        actual,
        direction,
      });
    }
  }
  return findings;
}

async function resolveElevationLoop(paths, reference, state) {
  const value = String(reference ?? '');
  if (!value) throw new PreconditionError('--loop is required for Lighthouse evidence.');
  let loopName = value;
  if (!/^\d{3}-(?:harness|invariance|elevation|report)-/.test(value)) {
    const id = value.match(/^\d{3}/)?.[0];
    if (!id) throw new PreconditionError('--loop must be NNN or a complete loop directory name.');
    const matches = (await readdir(paths.loopsDir).catch(() => []))
      .filter((name) => name.startsWith(`${id}-`));
    if (matches.length !== 1) {
      throw new PreconditionError(`Expected one directory for loop ${id}, found ${matches.length}.`);
    }
    [loopName] = matches;
  }
  if (!loopName.includes('-elevation-')) {
    throw new PreconditionError(`Lighthouse optimization belongs to an elevation loop, not ${loopName}.`);
  }
  const id = loopName.slice(0, 3);
  if (state.loops?.[id] !== 'open') {
    throw new PreconditionError(`Loop ${id} must be open; current state is ${state.loops?.[id] ?? 'missing'}.`);
  }
  const charterBody = await readFile(paths.loopDoc(loopName, '00-charter.md'), 'utf8');
  const match = charterBody.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new PreconditionError(`Loop ${loopName} has no valid charter front matter.`);
  const charter = parseYaml(match[1]);
  if (charter.contract !== 'B' || charter.track !== 'elevation') {
    throw new PreconditionError(`Loop ${loopName} is not a Contract B elevation loop.`);
  }
  if (!state.baselines?.[charter.baseline_ref]?.sealed) {
    throw new PreconditionError(`Loop baseline ${charter.baseline_ref ?? '(missing)'} is not sealed.`);
  }
  if (!charter.approval_ref || !state.approvals?.includes(charter.approval_ref)) {
    throw new PreconditionError(`Loop ${loopName} has no recorded intent approval.`);
  }
  const approvalFiles = await readdir(paths.approvalsDir).catch(() => []);
  if (!approvalFiles.some((file) => file.startsWith(`${charter.approval_ref}-intent-`))) {
    throw new PreconditionError(`Intent approval file ${charter.approval_ref} is missing.`);
  }
  return loopName;
}

export async function resolveQualityLoop(paths, values, state) {
  const mode = values.mode ?? 'verify';
  if (!['verify', 'elevation'].includes(mode)) throw new PreconditionError('--mode must be verify or elevation.');
  if (mode === 'elevation') {
    if (state.contract_a?.status !== 'closed' || !state.contract_b?.unlocked) throw new PreconditionError('Contract B is locked. Close and countersign Contract A first.');
    return resolveElevationLoop(paths, values.loop, state);
  }
  const dirs = await readdir(paths.loopsDir);
  const matches = dirs.filter(name => values.loop && (name === values.loop || name.startsWith(`${values.loop}-`)));
  if (matches.length !== 1) throw new PreconditionError('Verification requires --loop naming one open Contract A invariance loop.');
  const loop = matches[0];
  const body = await readFile(paths.loopDoc(loop, '00-charter.md'), 'utf8');
  const charter = parseYaml(body.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '');
  if (charter?.contract !== 'A' || charter?.track !== 'invariance' || charter?.baseline_ref !== 'A-original'
    || !state.baselines?.['A-original']?.sealed || state.loops?.[loop.slice(0, 3)] !== 'open') {
    throw new PreconditionError('Verification requires open Contract A evidence against sealed A-original.');
  }
  return loop;
}

export async function readLighthouseBudget(file, mode, formFactor = 'mobile') {
  let parsed;
  try {
    const body = await readFile(file, 'utf8');
    parsed = file.endsWith('.json') ? JSON.parse(body) : parseYaml(body);
  } catch (error) {
    throw new HarnessError(`Cannot read Lighthouse budget ${file}: ${error.message}`);
  }
  const selected = mode === 'elevation' ? 'contract_b' : 'contract_a';
  const budget = parsed && ('contract_a' in parsed || 'contract_b' in parsed) ? parsed[selected] : parsed;
  for (const key of [`performance.lighthouse_performance_${formFactor}`, 'performance.lighthouse_best_practices',
    'accessibility.lighthouse_accessibility', 'seo.lighthouse_seo']) {
    const value = readPath(budget, key);
    if (!Number.isFinite(value) || value <= 0 || value > 100) {
      throw new PreconditionError(`${selected} budget must predeclare ${key} in (0, 100]; an empty or other-contract budget cannot pass.`);
    }
  }
  return budget;
}

function readPath(value, dotted) {
  return dotted.split('.').reduce((current, key) => current?.[key], value);
}

function summarise(url, lhrs, formFactor) {
  const pick = (fn) => {
    const vals = lhrs.map(fn).filter((v) => typeof v === 'number').sort((a, b) => a - b);
    if (!vals.length) return { median: null, min: null, max: null };
    return { median: vals[Math.floor(vals.length / 2)], min: vals[0], max: vals.at(-1) };
  };
  const cat = (id) => pick((l) => Math.round((l.categories?.[id]?.score ?? 0) * 100));
  const aud = (id) => pick((l) => l.audits?.[id]?.numericValue);

  return {
    url, formFactor,
    scores: {
      performance: cat('performance'), accessibility: cat('accessibility'),
      bestPractices: cat('best-practices'), seo: cat('seo'),
    },
    metrics: {
      fcp: aud('first-contentful-paint'), lcp: aud('largest-contentful-paint'),
      cls: aud('cumulative-layout-shift'), tbt: aud('total-blocking-time'),
      si: aud('speed-index'), ttfb: aud('server-response-time'),
    },
    // Every entry is measured. v1 padded reports with five hardcoded tips that reached the
    // KPI document indistinguishable from real findings.
    opportunities: (lhrs[0]?.audits ? Object.values(lhrs[0].audits) : [])
      .filter((a) => a.details?.type === 'opportunity' && (a.numericValue ?? 0) > 0)
      .slice(0, 5)
      .map((a) => ({ id: a.id, title: a.title, savingsMs: a.numericValue, measured: true })),
  };
}

async function actionEvidence(paths, values, fallbackLoop) {
  const evidence = await readEvidenceContext(paths);
  return {
    run: {
      ...evidence.run,
      loopId: String(values.loop ?? fallbackLoop).slice(0, 3),
    },
    inputs: evidence.inputs,
  };
}
