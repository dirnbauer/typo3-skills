/**
 * The three comparison actions, plus the determinism self-test and baseline sealing.
 *
 * All of them refuse to run without a valid self-test lock (enforced in the command
 * wrapper), because a harness that has not proven zero against itself cannot distinguish a
 * regression from its own noise.
 */

import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { EXIT, PreconditionError, InvalidRunError } from '../cli/exit-codes.mjs';
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
import { readEvidenceContext } from '../run/evidence.mjs';

const nextId = (loopId, n) => `F-${String(loopId ?? '000').padStart(3, '0')}-${String(n).padStart(3, '0')}`;

/* ------------------------------------------------------------- stage 1 */

/** Strict-zero comparison: one changed channel value is evidence, never tolerated. */
export const PIXEL_COLOR_TOLERANCE = 0;

/** Strict-zero comparison: one changed pixel blocks determinism and comparison gates. */
export const PIXEL_DUST_FLOOR = 0;

export async function compareHttp({ values, paths, log }) {
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

export async function compareDomAction({ values, paths, log }) {
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

  for (const p of pairs) {
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

    const bPath = path.join(beforeDir, p.file);
    const aPath = path.join(afterDir, p.file);

    if (await quickIdentical(bPath, aPath)) { match += 1; results.push({ file: p.file, status: STATUS.MATCH, diffPixels: 0 }); continue; }

    const cmp = await compareOne(bPath, aPath, path.join(diffDir, `diff_${p.file}`), log);
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

async function compareOne(bPath, aPath, diffPath, log) {
  // odiff requires an output path and reports layout mismatches through a distinct exit
  // code. The self-test deliberately has no diff output path, so use the in-process engine
  // there; passing null to odiff can turn a layout mismatch into an apparent one-pixel diff.
  if (!diffPath) {
    try { return await comparePairPixelmatch(bPath, aPath, null, { threshold: PIXEL_COLOR_TOLERANCE }); }
    catch (err) { return { ok: false, error: err.message }; }
  }
  const bin = resolveOdiffBin();
  const odiff = await runOdiff(bin, bPath, aPath, diffPath, { threshold: PIXEL_COLOR_TOLERANCE });
  if (odiff.ok) return odiff;
  log.debug(`odiff unavailable (${odiff.error}); falling back to pixelmatch`);
  try { return await comparePairPixelmatch(bPath, aPath, diffPath, { threshold: PIXEL_COLOR_TOLERANCE }); }
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

  log.step('self-test pass A');
  const captureA = await captureAll({
    manifest, guard, outRoot: rootA, stages, log, journal,
    warmup: true, visualWorkers, scope,
  });
  log.step('self-test pass B (fresh browser)');
  // Both sides must enter capture from the same client-side lifecycle. A warm pass versus a
  // cold pass compares different consent/focus/carousel states even on identical code.
  const captureB = await captureAll({
    manifest, guard, outRoot: rootB, stages, log, journal,
    warmup: true, visualWorkers, scope,
  });

  const unstable = [];
  const captureErrors = [
    ...captureA.index.errors.map((error) => ({ ...error, pass: 'A' })),
    ...captureB.index.errors.map((error) => ({ ...error, pass: 'B' })),
  ];
  const captureRetries = captureA.index.retries.length + captureB.index.retries.length;

  const [aShots, bShots] = await Promise.all([listShots(path.join(rootA, 'shots')), listShots(path.join(rootB, 'shots'))]);
  const { pairs } = pairFiles(aShots, bShots);
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
    harnessVersion: '2.0.0',
  };
  await writeFile(paths.selftestLock, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  await new StateStore(paths).update((s) => {
    s.selftest = { status: 'green', at: lock.passedAt, lock_hash: selftestHash, coverage: lock.coverage, quarantined_captures: [] };
    s.loops['000'] = 'green';
  });

  log.success(`Determinism proven over ${pairs.length} captures. Comparisons are now permitted.`);
  return { exitCode: EXIT.PASS, verdict: 'pass', captures: pairs.length, reports: [reportPath], message: 'determinism proven' };
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
  if (values['idempotence-diff'] === undefined) {
    throw new PreconditionError('--idempotence-diff is required; a missing rerun is not zero.');
  }
  const loopDirName = await resolveLoopDir(paths, values.loop);
  const loopId = loopDirName.slice(0, 3);
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
  if (new Set(inputSets).size !== 1 || Object.values(reports[0].inputs ?? {}).some((value) => !value)) {
    throw new InvalidRunError('Stage reports do not share one complete set of evidence input hashes.');
  }

  const findings = reports.flatMap((r) => r.findings ?? []);
  const idempotenceDiff = intOpt(values, 'idempotence-diff', null);
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
      idempotence: { ran: true, diffCount: idempotenceDiff },
    },
  });
  const written = await writeReport(reportPath, report, { profile: values['redaction-profile'], dryRun: values['dry-run'] });
  if (!values['dry-run']) {
    await new StateStore(paths).update((state) => {
      state.loops[loopId] = verdict.verdict === 'green' ? 'green' : 'open';
      state.open_findings = findings.filter((finding) => finding.status !== 'closed').length;
    });
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
