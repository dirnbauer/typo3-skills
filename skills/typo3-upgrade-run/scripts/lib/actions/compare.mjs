/**
 * The three comparison actions, plus the determinism self-test and baseline sealing.
 *
 * All of them refuse to run without a valid self-test lock (enforced in the command
 * wrapper), because a harness that has not proven zero against itself cannot distinguish a
 * regression from its own noise.
 */

import { readdir, readFile, writeFile, mkdir, rm, cp, rename, access } from 'node:fs/promises';
import path from 'node:path';
import { EXIT, HarnessError, PreconditionError, InvalidRunError } from '../cli/exit-codes.mjs';

// Pixel comparisons are independent read-only jobs (odiff subprocess or pixelmatch);
// a bounded pool only changes wall-clock, never a verdict. Order-sensitive assembly
// stays serial — see compareVisual.
export const DEFAULT_COMPARE_WORKERS = 8;
export const MAX_COMPARE_WORKERS = 16;
import { compareRecords } from '../compare/http-meta.mjs';
import { compareDom } from '../compare/dom-normalize.mjs';
import {
  pairFiles, listShots, statusFor, quickIdentical,
  comparePairPixelmatch, runOdiff, resolveOdiffBin, STATUS,
} from '../compare/image.mjs';
import { classify, severityFor, countByClass, loopVerdict, Unclassifiable } from '../compare/classify.mjs';
import { envelope, writeReport } from '../report/write.mjs';
import { sealBaseline, verifyBaseline, renderSeal } from '../run/lockfile.mjs';
import { StateStore } from '../run/state.mjs';
import { intOpt } from '../cli/args.mjs';
import { sha256 } from '../run/paths.mjs';
import { readJson } from './core.mjs';
import { mapPool } from '../util/pool.mjs';
import { acquireMachineLock, releaseMachineLock } from '../util/machine-lock.mjs';
import { WorkerPool } from '../util/worker-pool.mjs';
import { withMachineResources, machineCapacity } from '../util/machine-resources.mjs';
import { readEvidenceContext } from '../run/evidence.mjs';

const nextId = (loopId, n) => `F-${String(loopId ?? '000').padStart(3, '0')}-${String(n).padStart(3, '0')}`;

/* ------------------------------------------------------------- stage 1 */

/** Strict-zero comparison: one changed channel value is evidence, never tolerated. */
export const PIXEL_COLOR_TOLERANCE = 0;

/** Strict-zero comparison: one changed pixel blocks determinism and comparison gates. */
export const PIXEL_DUST_FLOOR = 0;

export async function compareHttp(ctx) {
  const deadlineAt = (await readJson(ctx.paths.statePath))?.runtime?.deadline_at;
  return withMachineResources({ cpu: 1, owner: 'http-comparison', log: ctx.log, deadlineAt }, () => compareHttpRecords(ctx));
}

async function compareHttpRecords({ values, paths, log }) {
  const before = values.before ?? path.join(paths.root, 'captures', 'before', 'http');
  const after = values.after ?? path.join(paths.root, 'captures', 'after', 'http');
  const reportPath = values.report ?? await stageReportPath(paths, values.loop, 'http');

  const { pairsChecked, findings, missing } = await compareRecordDirs(before, after, values.loop, log);

  // On an intermediate loop the after-set is a deliberate sample, so a baseline record with no
  // counterpart is missing COVERAGE, not a difference. Declared, never silently dropped — and it
  // only counts as coverage when something actually was compared.
  const sampled = pairsChecked > 0 && missing.length > 0;
  const notCaptured = sampled ? missing : [];
  const realMissing = sampled ? [] : missing;

  const counts = { urls: pairsChecked, identical: pairsChecked - findings.length,
    different: findings.length, missing: realMissing.length, notCaptured: notCaptured.length };
  const verdict = findings.length || realMissing.length ? 'findings' : 'pass';

  const evidence = await reportEvidence(paths, values);
  const report = envelope({
    kind: 'http', ...evidence, verdict, counts, findings,
    extra: { comparedFields: 'see lib/compare/http-meta.mjs COMPARED_FIELDS', missing: realMissing, notCaptured },
  });
  const written = await writeReport(reportPath, report, { profile: values['redaction-profile'], dryRun: values['dry-run'] });

  log[verdict === 'pass' ? 'success' : 'finding'](
    `HTTP/metadata: ${counts.identical}/${counts.urls} identical, ${counts.different} different, ${counts.missing} missing${counts.notCaptured ? `, ${counts.notCaptured} not captured (sampled scope)` : ''}`,
  );
  return {
    exitCode: verdict === 'pass' ? EXIT.PASS : EXIT.FINDINGS,
    verdict, counts, reports: [written.path],
    message: verdict === 'pass' ? 'HTTP and metadata identical' : `${counts.different + counts.missing} HTTP finding(s)`,
  };
}

async function compareRecordDirs(beforeDir, afterDir, loopId, log) {
  const [b, a] = await Promise.all([safeList(beforeDir, '.json'), safeList(afterDir, '.json')]);
  if (!b.length && !a.length) {
    throw new PreconditionError(`No HTTP records in ${beforeDir} or ${afterDir}. Capture first.`);
  }
  const bs = new Set(b);
  const as = new Set(a);
  const findings = [];
  const missing = [];
  let n = 0;
  let pairsChecked = 0;

  for (const file of [...bs].sort()) {
    if (!as.has(file)) { missing.push({ file, side: 'after' }); continue; }
    pairsChecked += 1;
    const before = JSON.parse(await readFile(path.join(beforeDir, file), 'utf8'));
    const after = JSON.parse(await readFile(path.join(afterDir, file), 'utf8'));
    const cmp = compareRecords(before, after);
    if (cmp.identical) continue;

    n += 1;
    findings.push({
      id: nextId(loopId, n),
      target: before.url ?? file,
      class: 'regression',
      severity: cmp.differences.some((d) => d.field === 'status') ? 'blocker' : 'major',
      status: 'open',
      stage: 'http',
      differences: cmp.differences.slice(0, 12),
    });
  }
  for (const file of [...as].sort()) if (!bs.has(file)) missing.push({ file, side: 'before' });
  if (missing.length) log.warn(`${missing.length} URL(s) present on only one side`);

  return { pairsChecked, findings, missing };
}

/* ------------------------------------------------------------- stage 2 */

export async function compareDomAction(ctx) {
  const deadlineAt = (await readJson(ctx.paths.statePath))?.runtime?.deadline_at;
  return withMachineResources({ cpu: 1, owner: 'dom-comparison', log: ctx.log, deadlineAt }, () => compareDomRecords(ctx));
}

async function compareDomRecords({ values, paths, log }) {
  const before = values.before ?? path.join(paths.root, 'captures', 'before', 'dom');
  const after = values.after ?? path.join(paths.root, 'captures', 'after', 'dom');
  const reportPath = values.report ?? await stageReportPath(paths, values.loop, 'dom');

  const [b, a] = await Promise.all([safeList(before, '.html'), safeList(after, '.html')]);
  if (!b.length && !a.length) throw new PreconditionError(`No DOM snapshots in ${before} or ${after}.`);

  const bs = new Set(b);
  const as = new Set(a);
  const findings = [];
  const overreach = new Set();
  let n = 0;
  let checked = 0;

  for (const file of [...bs].sort()) {
    if (!as.has(file)) continue;
    checked += 1;
    const [bh, ah] = await Promise.all([
      readFile(path.join(before, file), 'utf8'),
      readFile(path.join(after, file), 'utf8'),
    ]);
    const cmp = compareDom(bh, ah);
    for (const o of cmp.overreach ?? []) overreach.add(o);
    if (cmp.identical) continue;

    n += 1;
    findings.push({
      id: nextId(values.loop, n),
      target: file,
      class: 'regression',
      severity: 'major',
      status: 'open',
      stage: 'dom',
      segments: cmp.segments,
    });
  }

  // An over-broad normaliser silently hides the regression it should expose. Report it.
  if (overreach.size) {
    findings.push({
      id: nextId(values.loop, ++n),
      target: 'dom-normalisation',
      class: 'harness-noise',
      severity: 'major',
      status: 'open',
      stage: 'dom',
      normalizationOverreach: [...overreach],
    });
    log.warn(`normalisation overreach: ${[...overreach].join(', ')} — a rule may be masking real differences`);
  }

  const counts = { urls: checked, identical: checked - findings.length, different: findings.length };
  const verdict = findings.length ? 'findings' : 'pass';
  const report = envelope({
    kind: 'dom',
    ...await reportEvidence(paths, values),
    verdict,
    counts,
    findings,
  });
  const written = await writeReport(reportPath, report, { profile: values['redaction-profile'], dryRun: values['dry-run'] });

  log[verdict === 'pass' ? 'success' : 'finding'](`DOM: ${counts.identical}/${counts.urls} identical`);
  return {
    exitCode: verdict === 'pass' ? EXIT.PASS : EXIT.FINDINGS,
    verdict, counts, reports: [written.path],
    message: verdict === 'pass' ? 'normalised DOM identical' : `${findings.length} DOM finding(s)`,
  };
}

/* ------------------------------------------------------------- stage 3 */

export async function compareVisual({ values, paths, log }) {
  const beforeDir = values['before-dir'] ?? path.join(paths.root, 'captures', 'before', 'shots');
  const afterDir = values['after-dir'] ?? path.join(paths.root, 'captures', 'after', 'shots');
  const diffDir = values['diff-dir'] ?? path.join(paths.root, 'captures', 'diff');
  const reportPath = values.report ?? await stageReportPath(paths, values.loop, 'visual');

  // Environment equality includes the capture instrument. Both sides and the sealed
  // self-test lock must agree on the worker count; a comparison across differing counts
  // compares two different instruments and is INVALID, not evidence.
  const lockWorkers = (await readJson(paths.selftestLock))?.visualWorkers ?? null;
  const workersOf = async (shotsDir) => (await readJson(path.join(path.dirname(shotsDir), 'capture-index.json')))?.visualWorkers ?? null;
  const [beforeWorkers, afterWorkers] = await Promise.all([workersOf(beforeDir), workersOf(afterDir)]);
  const workerCounts = [['selftest lock', lockWorkers], ['before capture', beforeWorkers], ['after capture', afterWorkers]]
    .filter(([, workers]) => Number.isInteger(workers));
  if (new Set(workerCounts.map(([, workers]) => workers)).size > 1) {
    const { InvalidRunError } = await import('../cli/exit-codes.mjs');
    throw new InvalidRunError(
      `Visual worker counts differ between ${workerCounts.map(([who, workers]) => `${who}=${workers}`).join(', ')} — `
      + 'the captures were produced by different instruments and cannot be compared.',
    );
  }

  const [bFiles, aFiles] = await Promise.all([listShots(beforeDir), listShots(afterDir)]);
  if (!bFiles.length && !aFiles.length) {
    throw new PreconditionError(`No screenshots in ${beforeDir} or ${afterDir}.`);
  }
  await mkdir(diffDir, { recursive: true });

  const { pairs, onlyInBefore, onlyInAfter } = pairFiles(bFiles, aFiles);
  const findings = [];
  const results = [];
  let n = 0;
  let match = 0;

  // A capture present in the baseline but absent from the after-set is NOT a difference: on an
  // intermediate loop the after-set is a deliberate sample, and calling every un-sampled capture
  // a blocker manufactures hundreds of phantom regressions. It is missing coverage, and it is
  // declared as such. A capture that appears only in the AFTER set is still a finding — the site
  // grew something the baseline never saw.
  const sampledAfter = pairs.some((p) => p.status === 'pair');
  const notCaptured = [];

  // Pixel work (byte pre-check, then odiff/pixelmatch) runs in a bounded pool: each pair
  // is an independent read-only comparison writing only its own diff artifact, so
  // concurrency cannot change any single verdict. Everything ORDER-SENSITIVE — finding
  // ids, counters, report arrays — is assembled afterwards in one stable pass over
  // `pairs` in file order, so findings are identical to the serial ones. Timing metadata varies.
  const compareWorkers = intOpt(values, 'compare-workers', DEFAULT_COMPARE_WORKERS);
  if (!Number.isInteger(compareWorkers) || compareWorkers < 1 || compareWorkers > MAX_COMPARE_WORKERS) {
    throw new HarnessError(`compare-workers must be an integer from 1 to ${MAX_COMPARE_WORKERS}`);
  }
  const effectiveWorkers = Math.min(compareWorkers, machineCapacity().cpu);
  const fallbackWorkers = Math.min(4, effectiveWorkers);
  const pool = new WorkerPool(new URL('../compare/pixelmatch-worker.mjs', import.meta.url), { size: fallbackWorkers });
  let execution;
  const deadlineAt = (await readJson(paths.statePath))?.runtime?.deadline_at;
  const pixelOutcomes = await withMachineResources({ cpu: effectiveWorkers, owner: 'image-comparison', log, deadlineAt }, async lease => {
    const started = Date.now();
    try {
      return await mapPool(pairs, effectiveWorkers, async (p) => {
        if (p.status !== 'pair') return null;
        const bPath = path.join(beforeDir, p.file);
        const aPath = path.join(afterDir, p.file);
        if (await quickIdentical(bPath, aPath)) return { identical: true };
        const cmp = await compareOne(bPath, aPath, path.join(diffDir, `diff_${p.file}`), log, pool);
        return { identical: false, cmp };
      });
    } finally {
      await pool.close();
      execution = { requestedWorkers: compareWorkers, workers: effectiveWorkers, fallbackWorkers,
        durationMs: Date.now() - started, machineWaitMs: lease.waitMs };
    }
  });

  for (let i = 0; i < pairs.length; i += 1) {
    const p = pairs[i];
    if (p.status !== 'pair') {
      if (p.status === STATUS.MISSING_AFTER && sampledAfter) { notCaptured.push(p.file); continue; }
      n += 1;
      findings.push({
        id: nextId(values.loop, n), target: p.file,
        class: 'regression',
        severity: 'blocker',
        status: 'open', stage: 'visual', reason: p.status,
      });
      continue;
    }

    const outcome = pixelOutcomes[i];
    if (!outcome.ok) throw outcome.error;
    const { identical, cmp } = outcome.value;

    if (identical) { match += 1; results.push({ file: p.file, status: STATUS.MATCH, diffPixels: 0 }); continue; }

    const status = statusFor({ diffPixels: cmp.diffPixels ?? 1, error: !cmp.ok });
    results.push({ file: p.file, status, ...cmp });

    if (status === STATUS.MATCH) { match += 1; continue; }

    n += 1;
    findings.push({
      id: nextId(values.loop, n),
      target: p.file,
      class: cmp.ok ? 'regression' : 'harness-noise',
      severity: severityFor({ broken: !cmp.ok, primaryTemplate: true, visuallyApparent: true }),
      status: 'open',
      stage: 'visual',
      diff_pixels: cmp.diffPixels ?? null,
      diff_percent: cmp.diffPercent ?? null,
      documentHeightDelta: cmp.documentHeightDelta ?? null,
      artifact: path.join(diffDir, `diff_${p.file}`),
    });
  }

  const counts = {
    captures: pairs.length,
    match,
    different: findings.filter((f) => f.class === 'regression' && f.stage === 'visual').length,
    error: findings.filter((f) => f.class === 'harness-noise').length,
    onlyInBefore: onlyInBefore.length,
    notCaptured: notCaptured.length,
    onlyInAfter: onlyInAfter.length,
  };
  const verdict = findings.length ? 'findings' : 'pass';

  const report = envelope({
    kind: 'visual', ...await reportEvidence(paths, values), verdict, counts, findings,
    extra: {
      engine: { name: 'odiff|pixelmatch', threshold: PIXEL_COLOR_TOLERANCE },
      execution,
      policy: { zeroTolerance: true, minorBucket: false },
      unmatched: { onlyInBefore, onlyInAfter },
      results: results.slice(0, 500),
    },
  });
  const written = await writeReport(reportPath, report, { profile: values['redaction-profile'], dryRun: values['dry-run'] });

  if (onlyInAfter.length) {
    log.finding(`${onlyInAfter.length} capture(s) exist only AFTER — new content is a difference too`);
  }
  log[verdict === 'pass' ? 'success' : 'finding'](
    `Visual: ${match}/${pairs.length} identical, ${counts.different} different, ${counts.error} error(s)`,
  );

  return {
    exitCode: verdict === 'pass' ? EXIT.PASS : EXIT.FINDINGS,
    verdict, counts, reports: [written.path],
    message: verdict === 'pass' ? 'pixel-identical' : `${findings.length} visual finding(s)`,
  };
}

/**
 * Run the complete proof comparison behind one command-wrapper preflight. Calling the three
 * stage commands and `gate` separately recollects the live environment/content fingerprints
 * four times even though no mutation is allowed between them. This action validates once in
 * the wrapper, writes the same independent stage reports, and then applies the unchanged gate.
 */
export async function compareAll(ctx) {
  const { values, paths } = ctx;
  if (!values.loop) throw new PreconditionError('--loop is required for compare-all.');
  const beforeRoot = values.before ?? paths.baseline('A-original');
  const afterRoot = values.after ?? path.join(paths.root, 'captures', 'after');

  const http = await compareHttp({
    ...ctx,
    values: { ...values, before: path.join(beforeRoot, 'http'), after: path.join(afterRoot, 'http') },
  });
  const dom = await compareDomAction({
    ...ctx,
    values: { ...values, before: path.join(beforeRoot, 'dom'), after: path.join(afterRoot, 'dom') },
  });
  const visual = await compareVisual({
    ...ctx,
    values: {
      ...values,
      'before-dir': path.join(beforeRoot, 'shots'),
      'after-dir': path.join(afterRoot, 'shots'),
    },
  });
  const gated = await gate(ctx);

  return {
    ...gated,
    stages: { http: http.verdict, dom: dom.verdict, visual: visual.verdict },
    reports: [...http.reports, ...dom.reports, ...visual.reports, ...gated.reports],
    message: gated.verdict === 'pass'
      ? 'HTTP, DOM and visual proof identical; loop gate green'
      : gated.message,
  };
}

async function compareOne(bPath, aPath, diffPath, log, pool = null) {
  const pixelmatch = () => pool
    ? pool.run({ before: bPath, after: aPath, diff: diffPath, options: { threshold: PIXEL_COLOR_TOLERANCE } })
    : comparePairPixelmatch(bPath, aPath, diffPath, { threshold: PIXEL_COLOR_TOLERANCE });
  // odiff requires an output path and reports layout mismatches through a distinct exit
  // code. The self-test deliberately has no diff output path, so use the in-process engine
  // there; passing null to odiff can turn a layout mismatch into an apparent one-pixel diff.
  if (!diffPath) {
    try { return await pixelmatch(); }
    catch (err) { return { ok: false, error: err.message }; }
  }
  const bin = resolveOdiffBin();
  const odiff = await runOdiff(bin, bPath, aPath, diffPath, { threshold: PIXEL_COLOR_TOLERANCE });
  if (odiff.ok) return odiff;
  log.debug(`odiff unavailable (${odiff.error}); falling back to pixelmatch`);
  try { return await pixelmatch(); }
  catch (err) { return { ok: false, error: err.message }; }
}

/* ------------------------------------------------- determinism self-test */

export async function selftestDeterminism({ values, paths, log, journal }) {
  const manifest = await readJson(paths.urlManifest);
  if (!manifest) throw new PreconditionError('No URL manifest. Run "t3u discover-urls" first.');

  const env = await readJson(paths.envFingerprint);
  const content = await readJson(paths.contentFingerprint);
  if (!env) throw new PreconditionError('Seal the environment fingerprint first: t3u env-fingerprint --write-baseline');
  if (!content) throw new PreconditionError('Seal the content fingerprint first: t3u content-fingerprint --write-baseline');

  const { UrlGuard } = await import('../net/url-guard.mjs');
  const {
    captureAll,
    DEFAULT_VISUAL_WORKERS,
    DIAGNOSTIC_VISUAL_WORKERS,
    DEFAULT_HTTP_WORKERS,
  } = await import('./capture.mjs');
  const guard = await UrlGuard.create({ allowedOrigins: manifest.allowedOrigins });
  const stages = new Set(['http', 'dom', 'visual']);

  const rootA = path.join(paths.root, 'captures', 'selftest-a');
  const rootB = path.join(paths.root, 'captures', 'selftest-b');
  const sampleMode = values.sample ?? 'all';
  if (!['all', 'intermediate'].includes(sampleMode)) {
    throw new PreconditionError('--sample must be "all" or "intermediate"');
  }
  const scope = sampleMode === 'intermediate' ? 'intermediate' : 'final';
  const visualWorkers = intOpt(
    values,
    'visual-workers',
    sampleMode === 'intermediate' ? DIAGNOSTIC_VISUAL_WORKERS : DEFAULT_VISUAL_WORKERS,
  );

  // A different sample must never inherit files from a previous run. Stale screenshots
  // would silently turn an 81-capture diagnostic back into a 798-capture comparison.
  await Promise.all([
    rm(rootA, { recursive: true, force: true }),
    rm(rootB, { recursive: true, force: true }),
  ]);

  // The self-test is the proof instrument: it licenses its own worker count. A green
  // exhaustive double-shoot seals that count into the lock, and only that count may then
  // produce final evidence elsewhere.
  const httpWorkers = intOpt(values, 'http-workers', DEFAULT_HTTP_WORKERS);
  const deadlineAt = (await readJson(paths.statePath))?.runtime?.deadline_at;
  // Hold the machine lock across BOTH passes: another run's captures landing between
  // pass A and pass B would change machine load mid-proof, which is exactly the
  // condition the double-shoot exists to exclude. captureAll's own acquisition is
  // re-entrant under this hold.
  await acquireMachineLock({ runId: `selftest:${paths.root}`, log, deadlineAt });
  let captureA;
  let captureB;
  try {
    log.step('self-test pass A');
    captureA = await captureAll({
      manifest, guard, outRoot: rootA, stages, log, journal,
      warmup: true, visualWorkers, scope, provenWorkers: visualWorkers, httpWorkers,
      deadlineAt,
    });
    log.step('self-test pass B (fresh browser)');
    // Both sides must enter capture from the same client-side lifecycle. A warm pass versus a
    // cold pass compares different consent/focus/carousel states even on identical code.
    captureB = await captureAll({
      manifest, guard, outRoot: rootB, stages, log, journal,
      warmup: true, visualWorkers, scope, provenWorkers: visualWorkers, httpWorkers,
      deadlineAt,
    });
  } finally {
    await releaseMachineLock();
  }

  // Both passes are complete capture sets, not disposable screenshots. Persist their instrument
  // metadata so either side remains independently auditable and worker-count checks can compare it.
  await Promise.all([
    writeFile(path.join(rootA, 'capture-index.json'), `${JSON.stringify({
      label: 'selftest-a', manifestHash: manifest.manifestHash, ...captureA.index,
    }, null, 2)}\n`, 'utf8'),
    writeFile(path.join(rootB, 'capture-index.json'), `${JSON.stringify({
      label: 'selftest-b', manifestHash: manifest.manifestHash, ...captureB.index,
    }, null, 2)}\n`, 'utf8'),
  ]);

  const unstable = [];
  const captureErrors = [
    ...captureA.index.errors.map((error) => ({ ...error, pass: 'A' })),
    ...captureB.index.errors.map((error) => ({ ...error, pass: 'B' })),
  ];
  const captureRetries = captureA.index.retries.length + captureB.index.retries.length;

  const [aShots, bShots] = await Promise.all([listShots(path.join(rootA, 'shots')), listShots(path.join(rootB, 'shots'))]);
  const { pairs } = pairFiles(aShots, bShots);
  await withMachineResources({ cpu: 1, owner: 'selftest-comparison', log, deadlineAt }, async () => {
    for (const p of pairs) {
      if (p.status !== 'pair') { unstable.push({ capture: p.file, reason: 'capture-set-differs' }); continue; }
      const bp = path.join(rootA, 'shots', p.file);
      const ap = path.join(rootB, 'shots', p.file);
      if (await quickIdentical(bp, ap)) continue;
      const cmp = await compareOne(bp, ap, null, log);
      const px = cmp.diffPixels ?? 1;
      if (!cmp.ok || px > 0) {
        unstable.push({
          capture: p.file, reason: 'pixels-differ',
          diffPixels: cmp.diffPixels ?? null,
          suggestedStabilization: suggest(cmp),
        });
      }
    }
    // DOM must be identical too: a stable screenshot with an unstable DOM is luck, not determinism.
    const [aDom, bDom] = await Promise.all([safeList(path.join(rootA, 'dom'), '.html'), safeList(path.join(rootB, 'dom'), '.html')]);
    for (const f of aDom.filter((x) => bDom.includes(x))) {
      const [x, y] = await Promise.all([
        readFile(path.join(rootA, 'dom', f), 'utf8'),
        readFile(path.join(rootB, 'dom', f), 'utf8'),
      ]);
      if (sha256(x) !== sha256(y)) {
        unstable.push({ capture: f, reason: 'dom-differs', suggestedStabilization: ['clock', 'random', 'lazy-load'] });
      }
    }
  });

  const captureProblems = captureErrors.map((error) => ({
    capture: `${error.captureId}.png`,
    reason: 'capture-error',
    pass: error.pass,
    attempts: error.attempts,
    error: error.error,
    suggestedStabilization: ['network', 'resource-load', 'timeout'],
  }));
  const problems = [...unstable, ...captureProblems];
  const passed = problems.length === 0;
  const selftestHash = sha256([
    env?.fingerprintHash ?? '', content?.fingerprintHash ?? '', manifest.manifestHash ?? '',
  ].join('|'));
  const state = await new StateStore(paths).read();
  const reportPath = path.join(paths.root, 'selftest.json');
  const report = envelope({
    kind: 'selftest',
    run: { runId: state.run_id, loopId: values.loop ?? '000', track: 'harness' },
    inputs: {
      manifestHash: manifest.manifestHash,
      environmentFingerprintHash: env.fingerprintHash,
      contentFingerprintHash: content?.fingerprintHash,
      selftestLockHash: selftestHash,
    },
    verdict: passed ? 'pass' : 'findings',
    counts: {
      captures: pairs.length,
      unstable: problems.length,
      captureErrors: captureErrors.length,
      retries: captureRetries,
    },
    extra: {
      // Recorded because a green verdict depends on them: the settings a run was judged under
      // must be visible in the evidence, not only in the source.
      calibration: {
        pixelColorTolerance: PIXEL_COLOR_TOLERANCE,
        pixelDustFloor: PIXEL_DUST_FLOOR,
        visualWorkers,
      },
      diagnostic: { sample: sampleMode, canUnlockComparisons: sampleMode === 'all' },
    },
    findings: problems.map((u, i) => ({
      id: nextId('000', i + 1), target: u.capture,
      class: 'harness-noise', severity: 'major', status: 'open', ...u,
    })),
  });
  await writeReport(reportPath, report, { profile: values['redaction-profile'], dryRun: values['dry-run'] });

  if (!passed) {
    // A failed proof must revoke any earlier permission immediately. Keeping a previous
    // green state after the current exhaustive run found instability would let later
    // comparison commands proceed against evidence we now know is invalid.
    await rm(paths.selftestLock, { force: true });
    await new StateStore(paths).update((s) => {
      s.selftest = {
        status: 'open',
        at: new Date().toISOString(),
        lock_hash: null,
        coverage: sampleMode,
        quarantined_captures: [],
      };
      s.loops['000'] = 'open';
    });
    log.finding(`${problems.length} unstable capture(s). This is a HARNESS defect, never a site defect.`);
    for (const u of problems.slice(0, 10)) {
      log.finding(`  ${u.capture}: ${u.reason}${u.suggestedStabilization ? ` → try ${u.suggestedStabilization.join(', ')}` : ''}`);
    }
    log.error('Do NOT pass this by shrinking the sample or raising a threshold — see rules/20-baseline-integrity.md');
    return { exitCode: EXIT.FINDINGS, verdict: 'findings', unstable: problems.length, reports: [reportPath], message: 'determinism self-test failed' };
  }

  if (sampleMode === 'intermediate') {
    // A fast diagnostic is deliberately unable to unlock comparisons. It exists to catch
    // harness defects before paying for the exhaustive close, never to replace that close.
    await rm(paths.selftestLock, { force: true });
    await new StateStore(paths).update((s) => {
      s.selftest = {
        status: 'diagnostic-green',
        at: new Date().toISOString(),
        lock_hash: null,
        coverage: 'intermediate',
        quarantined_captures: [],
      };
      s.loops['000'] = 'open';
    });
    log.success(`Diagnostic determinism proven over ${pairs.length} captures. Full --sample all proof is still required.`);
    return {
      exitCode: EXIT.PASS,
      verdict: 'pass',
      captures: pairs.length,
      diagnostic: true,
      reports: [reportPath],
      message: 'diagnostic determinism proven; full proof required',
    };
  }

  const lock = {
    schema: 'typo3-upgrade-run/selftest-lock@1',
    verdict: 'pass',
    passedAt: new Date().toISOString(),
    selftestHash,
    coverage: 'all',
    repeats: intOpt(values, 'repeats', 2),
    captures: pairs.length,
    visualWorkers,
    maxAgeMs: 24 * 60 * 60 * 1000,
    harnessVersion: '2.1.0',
  };
  await writeFile(paths.selftestLock, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');

  // Pass B has just proven byte/pixel-identical to pass A with the same HTTP, DOM and full visual
  // matrix. Reuse it as the unsealed Baseline A capture instead of paying for a third exhaustive
  // browser pass. Copy through a temporary directory and never overwrite an existing baseline.
  const promotedToBaseline = await promoteSelftestBaseline(rootB, paths.baseline('A-original'));
  await new StateStore(paths).update((s) => {
    s.selftest = { status: 'green', at: lock.passedAt, lock_hash: selftestHash, coverage: lock.coverage, quarantined_captures: [] };
    s.loops['000'] = 'green';
  });

  log.success(
    `Determinism proven over ${pairs.length} captures. Comparisons are now permitted.`
    + (promotedToBaseline ? ' Pass B was promoted to the unsealed Baseline A capture.' : ''),
  );
  return {
    exitCode: EXIT.PASS, verdict: 'pass', captures: pairs.length,
    promotedToBaseline, reports: [reportPath], message: 'determinism proven',
  };
}

export async function promoteSelftestBaseline(source, target) {
  try {
    await access(target);
    return false;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const pending = `${target}.pending`;
  await rm(pending, { recursive: true, force: true });
  try {
    await cp(source, pending, { recursive: true, errorOnExist: true, force: false });
    await rename(pending, target);
    return true;
  } catch (error) {
    await rm(pending, { recursive: true, force: true });
    throw error;
  }
}

function suggest(cmp) {
  const s = [];
  if (cmp.layout || cmp.documentHeightDelta) s.push('lazy-load', 'fonts');
  if ((cmp.diffPercent ?? 0) > 20) s.push('consent', 'carousel');
  if (!s.length) s.push('clock', 'random', 'image-processing');
  return s;
}

/* ---------------------------------------------------------- baselines */

export async function sealBaselineAction({ values, paths, log }) {
  const id = values.id ?? 'A-original';
  const dir = values.dir ?? paths.baseline(id);
  const [manifest, env, content] = await Promise.all([
    readJson(paths.urlManifest), readJson(paths.envFingerprint), readJson(paths.contentFingerprint),
  ]);

  const { lock, files } = await sealBaseline(dir, {
    id,
    manifestHash: manifest?.manifestHash ?? null,
    environmentFingerprintHash: env?.fingerprintHash ?? null,
    contentFingerprintHash: content?.fingerprintHash ?? null,
  });

  let sampleHash = null;
  try { sampleHash = `sha256:${sha256(await readFile(paths.samplePath, 'utf8'))}`; } catch { /* optional */ }

  // SEAL.md belongs next to the LOCK.json it describes. Honouring --dir for one and not the
  // other wrote the lock into the capture directory and then failed opening a seal path that
  // was never created — a half-sealed baseline is worse than an unsealed one.
  const sealPath = values.dir ? path.join(values.dir, 'SEAL.md') : paths.baselineSeal(id);
  await writeFile(sealPath, renderSeal(lock, {
    sampleHash,
    urls: manifest?.coverage?.discovered ?? null,
    captures: manifest?.captures?.length ?? null,
    notes: content?.degraded ? ['Content fingerprint was DEGRADED at seal time (database unavailable).'] : [],
  }), 'utf8');

  await new StateStore(paths).update((s) => {
    s.baselines[id] = {
      sealed: true, sealed_at: lock.sealedAt, manifest: manifest?.manifestHash ?? null,
      urls: manifest?.coverage?.discovered ?? 0, captures: manifest?.captures?.length ?? 0,
    };
  });

  log.success(`Baseline ${id} sealed: ${files} files, SHA256SUMS ${lock.sha256sumsSha256.slice(0, 16)}…`);
  return { exitCode: EXIT.PASS, verdict: 'pass', id, files, message: `baseline ${id} sealed` };
}

export async function verifyBaselineAction({ values, paths, log }) {
  const id = values.id ?? 'A-original';
  const res = await verifyBaseline(paths.baseline(id), { id });
  log.success(`Baseline ${id} verified: ${res.fileCount} files unchanged since ${res.lock.sealedAt}`);
  return { exitCode: EXIT.PASS, verdict: 'pass', ...res, message: `baseline ${id} intact` };
}

/* ------------------------------------------------------------- gate */

export async function gate({ values, paths, log }) {
  if (!values.loop) throw new PreconditionError('--loop is required for gate.');
  const loopDirName = await resolveLoopDir(paths, values.loop);
  const loopId = loopDirName.slice(0, 3);
  const idempotenceRequired = loopId === '300' || values['require-idempotence'] === true;
  const idempotenceRan = values['idempotence-diff'] !== undefined;
  if (idempotenceRequired && !idempotenceRan) {
    throw new PreconditionError('--idempotence-diff is required for final closure; a missing rerun is not zero.');
  }
  const artifacts = paths.loopArtifacts(loopDirName);
  const reports = [];
  const missingStages = [];
  for (const kind of ['http', 'dom', 'visual']) {
    const r = await readJson(path.join(artifacts, `report.${kind}.json`));
    if (r) reports.push(r);
    else missingStages.push(kind);
  }
  if (missingStages.length) {
    throw new PreconditionError(
      `Loop ${loopDirName} is missing mandatory stage report(s): ${missingStages.join(', ')}.`,
    );
  }
  const inputSets = reports.map((report) => JSON.stringify(report.inputs ?? {}));
  const requiredInputKeys = [
    'manifestHash', 'environmentFingerprintHash', 'contentFingerprintHash', 'selftestLockHash',
  ];
  if (new Set(inputSets).size !== 1
    || requiredInputKeys.some((key) => !reports[0].inputs?.[key])) {
    throw new InvalidRunError('Stage reports do not share one complete set of evidence input hashes.');
  }

  const findings = reports.flatMap((r) => r.findings ?? []);
  const idempotenceDiff = idempotenceRan ? intOpt(values, 'idempotence-diff', null) : null;
  const verdict = loopVerdict(findings, { idempotenceDiff });
  const counts = countByClass(findings);

  const reportPath = paths.loopReport(loopDirName);
  const report = envelope({
    kind: 'loop',
    run: { ...reports[0].run, loopId },
    inputs: reports[0].inputs,
    verdict: verdict.verdict === 'green' ? 'pass' : 'findings',
    counts, findings,
    extra: {
      stages: reports.map((r) => ({ stage: r.kind, verdict: r.verdict, counts: r.counts })),
      findingsByClass: counts,
      blockingReasons: verdict.blockingReasons,
      residualFindings: verdict.residual,
      idempotence: { required: idempotenceRequired, ran: idempotenceRan, diffCount: idempotenceDiff },
    },
  });
  const written = await writeReport(reportPath, report, { profile: values['redaction-profile'], dryRun: values['dry-run'] });
  if (!values['dry-run']) {
    const store = new StateStore(paths);
    const state = await store.read();
    state.loops[loopId] = verdict.verdict === 'green' ? 'green' : 'open';
    state.open_findings = await countActiveOpenFindings(paths, state);
    await store.write(state);
  }

  if (verdict.verdict === 'green') {
    log.success('Loop gate: green');
    return { exitCode: EXIT.PASS, verdict: 'pass', counts, reports: [written.path], message: 'loop gate green' };
  }
  for (const r of verdict.blockingReasons) log.finding(r);
  return {
    exitCode: EXIT.FINDINGS, verdict: 'findings', counts,
    blockingReasons: verdict.blockingReasons, reports: [written.path],
    message: `loop blocked by ${verdict.blockingReasons.length} reason(s)`,
  };
}

/** Count current findings from authoritative loop reports, never from historical
 * stage/iteration artifacts. Superseded and aborted loops remain audit history. */
export async function countActiveOpenFindings(paths, state) {
  const loopDirs = await safeList(paths.loopsDir, '');
  let total = 0;
  for (const [id, status] of Object.entries(state.loops ?? {})) {
    // Loop 000 is the machine-managed self-test (`selftest.json` plus lock), not a
    // scaffolded work-loop directory. Its absence from loops/ is therefore correct.
    if (id === '000') continue;
    if (['planned', 'superseded', 'aborted'].includes(status)) continue;
    const matches = loopDirs.filter((name) => name.startsWith(`${id}-`));
    if (matches.length !== 1) {
      throw new PreconditionError(`Expected one loop directory for ${id}, found ${matches.length}.`);
    }
    const loop = await readJson(paths.loopReport(matches[0]));
    if (!loop?.kind) {
      throw new PreconditionError(`Active loop ${matches[0]} has no authoritative report.json.`);
    }
    total += (loop?.findings ?? []).filter((finding) => finding.status !== 'closed').length;
  }
  return total;
}

/* ----------------------------------------------------------- helpers */

async function safeList(dir, ext) {
  try { return (await readdir(dir)).filter((f) => f.endsWith(ext)).sort(); }
  catch (err) { if (err.code === 'ENOENT') return []; throw err; }
}

export { classify, Unclassifiable, InvalidRunError };

async function reportEvidence(paths, values) {
  const evidence = await readEvidenceContext(paths);
  const loopName = values.loop ? await resolveLoopDir(paths, values.loop) : '';
  return {
    run: {
      ...evidence.run,
      loopId: loopName.slice(0, 3) || null,
      track: loopTrack(loopName),
    },
    inputs: evidence.inputs,
  };
}

function loopTrack(loop) {
  const value = String(loop ?? '');
  return ['harness', 'invariance', 'elevation', 'report'].find((track) => value.includes(`-${track}-`)) ?? null;
}

async function resolveLoopDir(paths, value) {
  const wanted = String(value);
  if (/^\d{3}-(?:harness|invariance|elevation|report)-/.test(wanted)) return wanted;
  const id = wanted.match(/^\d{3}/)?.[0];
  if (!id) throw new PreconditionError(`Invalid loop reference: ${wanted}`);
  const names = await safeList(paths.loopsDir, '');
  const matches = names.filter((name) => name.startsWith(`${id}-`));
  if (matches.length !== 1) {
    throw new PreconditionError(
      matches.length
        ? `Loop ${id} is ambiguous: ${matches.join(', ')}`
        : `No loop directory found for ${id}. Run loop-start first.`,
    );
  }
  return matches[0];
}

async function stageReportPath(paths, loop, kind) {
  if (!loop) return path.join(paths.root, `report.${kind}.json`);
  return path.join(paths.loopArtifacts(await resolveLoopDir(paths, loop)), `report.${kind}.json`);
}
