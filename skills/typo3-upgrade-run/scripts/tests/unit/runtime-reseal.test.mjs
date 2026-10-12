/**
 * Harness hotfix: measurement commands wait for machine capacity up to the EFFECTIVE deadline (the
 * latest verified extension, none under a waiver), and an approval-bound environment re-seal lets a
 * run continue on the fixed harness. Each measurement command runs in a child process with its own
 * TMPDIR, so the capacity ledger and capture lock of a live run on this host are never touched.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { capacityDeadline, capacityDeadlineAt, runtimeWindow } from '../../lib/run/runtime.mjs';
import { emptyState, StateStore } from '../../lib/run/state.mjs';
import { stateSchemaErrors } from '../../lib/run/schema.mjs';
import { RunPaths, sha256 } from '../../lib/run/paths.mjs';
import { Journal } from '../../lib/run/journal.mjs';
import { buildManifest } from '../../lib/run/manifest.mjs';
import { envFingerprint, runtimeExtend } from '../../lib/actions/core.mjs';
import { approvalRecord } from '../../lib/actions/lifecycle.mjs';
import { assertSelftestValid, runCommand } from '../../lib/cli/command.mjs';
import { environmentResealIssues, readResealApprovals } from '../../lib/run/reseal.mjs';
import { HASH_RELEVANT, RECORDED_ONLY, hashComponents } from '../../lib/fingerprint/environment.mjs';
import { EXIT } from '../../lib/cli/exit-codes.mjs';

const exec = promisify(execFile);
const HOUR = 60 * 60 * 1000;
const RUN_ID = '2026-10-11-hotfix';
const ORIGIN = 'http://127.0.0.1:9';
const hash = (c) => `sha256:${c.repeat(64)}`;
const quiet = { success() {}, info() {}, warn() {}, debug() {}, error() {}, step() {}, finding() {}, json() {} };
const CAPACITY_REFUSAL = /exceeded its limit or the sealed (run )?deadline/;

/** A sealed small (8h) runtime that started two days ago: its sealed deadline passed 40 hours ago. */
function expiredRuntime() {
  const started = new Date(Math.floor((Date.now() - 48 * HOUR) / 1000) * 1000).toISOString();
  const w = runtimeWindow(started, 'small');
  return {
    started_at: started, sealed_at: started, budget_policy: 'site-size-v2', size_profile: 'small',
    size_evidence_ref: 'nodes/intake/runtime-size.json',
    migration_cutoff_at: w.migrationCutoffAt, deadline_at: w.deadlineAt,
    max_hours: w.maxHours, closure_reserve_hours: w.closureReserveHours,
  };
}

/**
 * A run whose sealed evidence verifies (environment, content, manifest, self-test lock, an open
 * Contract A loop against a sealed A-original), past its sealed deadline.
 */
async function expiredRun({ urls = [] } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 't3u-hotfix-'));
  await writeFile(path.join(root, 'composer.json'), '{}\n');
  const paths = new RunPaths('.typo3-update', root);
  await mkdir(paths.manifestsDir, { recursive: true });
  await mkdir(paths.approvalsDir, { recursive: true });
  const manifest = buildManifest({ baseUrl: `${ORIGIN}/`, allowedOrigins: [ORIGIN], seed: 's',
    urls, viewports: ['desktop'], states: ['default'], now: () => '2026-10-11T00:00:00.000Z' });
  const env = { kind: 'environment-fingerprint', fingerprintHash: hash('b'), components: {} };
  const content = { fingerprintHash: hash('c'), database: { tables: [] } };
  const selftestHash = sha256([env.fingerprintHash, content.fingerprintHash, manifest.manifestHash].join('|'));
  const state = emptyState({ runId: RUN_ID, now: new Date().toISOString() });
  state.project.name = 'hotfix-fixture';
  state.project.trusted_origin = ORIGIN;
  state.runtime = expiredRuntime();
  state.fingerprints.environment = env.fingerprintHash;
  state.fingerprints.content = content.fingerprintHash;
  state.manifest.hash = manifest.manifestHash;
  state.selftest = { status: 'green', at: new Date().toISOString(), lock_hash: selftestHash, coverage: 'all', quarantined_captures: [] };
  state.baselines['A-original'] = { sealed: true, sealed_at: new Date().toISOString(), manifest: manifest.manifestHash, urls: 0, captures: 0 };
  state.loops['010'] = 'open';
  await new StateStore(paths).write(state);
  await writeFile(paths.envFingerprint, JSON.stringify(env));
  await writeFile(paths.contentFingerprint, JSON.stringify(content));
  await writeFile(paths.urlManifest, JSON.stringify(manifest));
  await writeFile(paths.selftestLock, JSON.stringify({ schema: 'typo3-upgrade-run/selftest-lock@1', verdict: 'pass',
    passedAt: new Date().toISOString(), selftestHash, coverage: 'all', visualWorkers: 1, maxAgeMs: 24 * HOUR }));
  const loop = paths.loop('010-invariance-hotfix');
  await mkdir(loop, { recursive: true });
  await writeFile(path.join(loop, '00-charter.md'), '---\ncontract: A\ntrack: invariance\nbaseline_ref: A-original\n---\n');
  // Identical before/after evidence, so each comparison has something to compare.
  for (const side of ['before', 'after']) {
    const dir = path.join(paths.root, 'captures', side);
    for (const kind of ['http', 'dom', 'shots']) await mkdir(path.join(dir, kind), { recursive: true });
    await writeFile(path.join(dir, 'http', '0000000000000001.json'), JSON.stringify({ requestedUrl: `${ORIGIN}/`, url: `${ORIGIN}/`, status: 200 }));
    await writeFile(path.join(dir, 'dom', '0000000000000001.html'), '<html><body><p>same</p></body></html>');
    await writeFile(path.join(dir, 'shots', '0000000000000001.png'), 'identical bytes');
  }
  const budget = path.join(paths.configDir, 'lighthouse-budget.yml');
  await mkdir(paths.configDir, { recursive: true });
  await writeFile(budget, 'performance:\n  lighthouse_performance_mobile: 50\n  lighthouse_best_practices: 50\n'
    + 'accessibility:\n  lighthouse_accessibility: 50\nseo:\n  lighthouse_seo: 50\n');
  return { root, paths, budget, journal: new Journal(paths.journalPath) };
}

async function grant(run, id) {
  await approvalRecord({
    values: { id, stage: 'intent', granted: true, scope: `Owner decision ${id}`,
      question: 'May the run continue?', answer: 'Yes' },
    paths: run.paths, log: quiet, journal: run.journal,
  });
}

async function waive(run, id = 'APR-001') {
  await grant(run, id);
  await runtimeExtend({ values: { approval: id, waive: true, reason: 'Owner waives the window' }, paths: run.paths, log: quiet, journal: run.journal });
}

const lib = (rel) => JSON.stringify(pathToFileURL(fileURLToPath(new URL(`../../lib/${rel}`, import.meta.url))).href);

/**
 * The measurement commands. Lighthouse and axe stop at their browser launch: reaching it proves the
 * capacity wait granted the lease. Neither starts a browser here.
 */
const COMMANDS = {
  capture: { module: 'actions/capture.mjs', fn: 'capture', values: { label: 'hotfix', stages: 'http', warmup: false } },
  'selftest-determinism': { module: 'actions/compare.mjs', fn: 'selftestDeterminism', values: {} },
  'compare-http': { module: 'actions/compare.mjs', fn: 'compareHttp', values: { loop: '010' } },
  'compare-dom': { module: 'actions/compare.mjs', fn: 'compareDomAction', values: { loop: '010' } },
  'compare-visual': { module: 'actions/compare.mjs', fn: 'compareVisual', values: { loop: '010' } },
  lighthouse: { module: 'actions/sweep.mjs', fn: 'lighthouse', values: { loop: '010' }, budget: true },
  axe: { module: 'actions/sweep.mjs', fn: 'axeAudit', values: { loop: '010' }, urls: [`${ORIGIN}/`, `${ORIGIN}/a`, `${ORIGIN}/b`] },
};
const LAUNCH_SENTINEL = 'T3U_TEST: browser launch reached after the capacity lease';

async function runMeasurement(t, run, command) {
  const spec = COMMANDS[command];
  const isolated = await mkdtemp(path.join(tmpdir(), 't3u-hotfix-tmp-'));
  t.after(() => rm(isolated, { recursive: true, force: true }));
  const values = { ...spec.values, ...(spec.budget ? { budget: run.budget } : {}) };
  const stub = `data:text/javascript,${encodeURIComponent(
    `const fail = async () => { throw new Error(${JSON.stringify(LAUNCH_SENTINEL)}); }; export const launch = fail; export default fail;`)}`;
  const script = `
    import * as nodeModule from 'node:module';
    const stub = ${JSON.stringify(stub)};
    const stubbed = new Set(['chrome-launcher', 'lighthouse']);
    if (nodeModule.registerHooks) {
      nodeModule.registerHooks({ resolve: (s, c, next) => (stubbed.has(s) ? { url: stub, shortCircuit: true } : next(s, c)) });
    } else {
      nodeModule.register('data:text/javascript,' + encodeURIComponent(
        'const stubbed = new Set(["chrome-launcher", "lighthouse"]); export async function resolve(s, c, next) { '
        + 'return stubbed.has(s) ? { url: ' + JSON.stringify(stub) + ', shortCircuit: true } : next(s, c); }'));
    }
    const playwright = await import(${JSON.stringify(import.meta.resolve('playwright'))});
    playwright.chromium.launch = async () => { throw new Error(${JSON.stringify(LAUNCH_SENTINEL)}); };
    const action = (await import(${lib(spec.module)})).${spec.fn};
    const { RunPaths } = await import(${lib('run/paths.mjs')});
    const log = new Proxy({}, { get: () => () => {} });
    const paths = new RunPaths('.typo3-update', ${JSON.stringify(run.root)});
    let out;
    try {
      const result = await action({ values: ${JSON.stringify(values)}, paths, log, journal: null });
      out = { exitCode: result.exitCode, message: result.message };
    } catch (error) { out = { error: error.message }; }
    process.stdout.write(JSON.stringify(out));
  `;
  const env = { ...process.env, TMPDIR: isolated };
  for (const key of ['T3U_BROWSER_SLOTS', 'T3U_CPU_SLOTS', 'T3U_RESOURCE_RUN_ACTIVE']) delete env[key];
  const { stdout } = await exec(process.execPath, ['--input-type=module', '-e', script], { env, cwd: run.root, timeout: 120_000 });
  return JSON.parse(stdout);
}

describe('measurement commands past the sealed deadline', () => {
  for (const command of Object.keys(COMMANDS)) {
    test(`${command}: refused without an extension, runs under an owner-approved waiver`, async (t) => {
      const refused = await expiredRun({ urls: COMMANDS[command].urls });
      const waived = await expiredRun({ urls: COMMANDS[command].urls });
      t.after(() => Promise.all([refused, waived].map((run) => rm(run.root, { recursive: true, force: true }))));

      const without = await runMeasurement(t, refused, command);
      assert.match(without.error ?? '', CAPACITY_REFUSAL, `${command} must refuse at the sealed deadline: ${JSON.stringify(without)}`);

      await waive(waived);
      const withWaiver = await runMeasurement(t, waived, command);
      assert.doesNotMatch(withWaiver.error ?? '', CAPACITY_REFUSAL, `${command} must run under the waiver: ${JSON.stringify(withWaiver)}`);
      if (['lighthouse', 'axe'].includes(command)) assert.equal(withWaiver.error, LAUNCH_SENTINEL);
      else assert.equal(withWaiver.exitCode, EXIT.PASS, `${command}: ${JSON.stringify(withWaiver)}`);
    });
  }

  test('a later verified deadline extends the wait; an extension whose approval changed does not', async (t) => {
    const extended = await expiredRun();
    const tampered = await expiredRun();
    t.after(() => Promise.all([extended, tampered].map((run) => rm(run.root, { recursive: true, force: true }))));
    const until = new Date(Math.ceil((Date.now() + 6 * HOUR) / 1000) * 1000).toISOString();
    for (const run of [extended, tampered]) {
      await grant(run, 'APR-001');
      await runtimeExtend({ values: { approval: 'APR-001', until, reason: 'Owner extends the run' }, paths: run.paths, log: quiet, journal: run.journal });
    }
    const file = (await readdir(tampered.paths.approvalsDir)).find((name) => name.startsWith('APR-001-intent-'));
    await writeFile(path.join(tampered.paths.approvalsDir, file), `${await readFile(path.join(tampered.paths.approvalsDir, file), 'utf8')}\nedited later\n`);

    assert.equal(await capacityDeadlineAt(extended.paths, await new StateStore(extended.paths).read()), until);
    assert.equal(await capacityDeadlineAt(tampered.paths, await new StateStore(tampered.paths).read()),
      (await new StateStore(tampered.paths).read()).runtime.deadline_at, 'an unverified extension never widens the wait');
    assert.equal((await runMeasurement(t, extended, 'compare-http')).exitCode, EXIT.PASS);
    assert.match((await runMeasurement(t, tampered, 'compare-http')).error ?? '', CAPACITY_REFUSAL);
  });

  test('capacityDeadline: sealed without a ledger, null under a waiver', () => {
    assert.equal(capacityDeadline({ waived: false, deadlineAt: '2026-10-11T06:15:48.589Z' }), '2026-10-11T06:15:48.589Z');
    assert.equal(capacityDeadline({ waived: true, deadlineAt: null }), null);
    assert.equal(capacityDeadline(null), null);
  });
});

/* ------------------------------------------------------------------ re-seal */

function components({ sourceHash = hash('5'), bookkeepingHash = hash('6'), version = '2.1.0', browserVersion = '140.0.0.0',
  depsLockHash = hash('4'), php = '8.2.29', uptime = 100 } = {}) {
  return {
    node: { version: 'v26.5.0' }, os: { type: 'Darwin', release: '25.6.0', arch: 'arm64', containerImage: null, cpus: 10, totalmem: 1, hostname: 'h', uptime },
    playwright: { version: '1.60.0' }, browser: { name: 'chromium', version: browserVersion, channel: null, launchArgsHash: 'x' },
    fonts: { listHash: 'f' },
    rendering: { deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce', forcedColors: 'none', locale: 'de-AT', timezone: 'Europe/Vienna' },
    imageProcessing: { processor: 'ImageMagick', version: '7', typo3Gfx: null, gfxHash: 'g' },
    php: { version: php, extensionsHash: 'e' }, typo3: { version: '14.3.0', context: 'Development' },
    ddev: { version: 'v1.24', projectType: 'typo3', dbEngine: 'mariadb:10.11' },
    harness: { version, depsLockHash, sourceHash, bookkeepingHash },
  };
}

function fingerprint(parts) {
  return { kind: 'environment-fingerprint', fingerprintHash: hashComponents(parts), hashRelevantKeys: [...HASH_RELEVANT],
    recordedOnly: [...RECORDED_ONLY], components: parts, capturedAt: '2026-10-09T14:34:36.286Z' };
}

/** A run sealed under the old harness, with a green self-test bound to that environment. */
async function sealedEnvRun() {
  const run = await expiredRun();
  const sealed = fingerprint(components());
  await writeFile(run.paths.envFingerprint, JSON.stringify(sealed, null, 2));
  const manifest = JSON.parse(await readFile(run.paths.urlManifest, 'utf8'));
  const selftestHash = sha256([sealed.fingerprintHash, hash('c'), manifest.manifestHash].join('|'));
  await writeFile(run.paths.selftestLock, JSON.stringify({ schema: 'typo3-upgrade-run/selftest-lock@1', verdict: 'pass',
    passedAt: new Date().toISOString(), selftestHash, coverage: 'all', visualWorkers: 1, maxAgeMs: 24 * HOUR }));
  await new StateStore(run.paths).update((s) => {
    s.fingerprints.environment = sealed.fingerprintHash;
    s.selftest.lock_hash = selftestHash;
  });
  await waive(run, 'APR-001');
  return { ...run, sealed };
}

const reseal = (run, current, values = {}) => envFingerprint({
  values: { reseal: true, approval: 'APR-002', reason: 'Harness hotfix: capacity waits honour the waiver', ...values },
  paths: run.paths, log: quiet, journal: run.journal, environmentCollector: async () => current,
});

describe('t3u env-fingerprint --reseal', () => {
  test('re-seals a harness fix: new hashes, approval bound, journaled, self-test stale until it runs again', async (t) => {
    const run = await sealedEnvRun();
    t.after(() => rm(run.root, { recursive: true, force: true }));
    await assertSelftestValid(run.paths);
    await grant(run, 'APR-002');
    const fixed = fingerprint(components({ sourceHash: hash('7'), bookkeepingHash: hash('8'), php: '8.4.1', uptime: 999 }));
    // Before the re-seal the fixed harness is drift: the plain assertion refuses it.
    await assert.rejects(envFingerprint({ values: {}, paths: run.paths, log: quiet, journal: run.journal,
      environmentCollector: async () => fixed }), (error) => error.exitCode === EXIT.INVALID && /drifted/.test(error.message));

    const result = await reseal(run, fixed);
    assert.equal(result.exitCode, EXIT.PASS);
    const file = JSON.parse(await readFile(run.paths.envFingerprint, 'utf8'));
    assert.equal(file.fingerprintHash, fixed.fingerprintHash);
    assert.deepEqual(file.components.harness, fixed.components.harness);
    assert.equal(file.components.php.version, '8.2.29', 'recorded-only provenance stays as sealed');
    assert.equal(file.capturedAt, run.sealed.capturedAt);
    assert.equal(file.reseal.approval_id, 'APR-002');

    const state = await new StateStore(run.paths).read();
    assert.deepEqual(stateSchemaErrors(state), []);
    assert.equal(state.fingerprints.environment, fixed.fingerprintHash);
    const [entry] = state.fingerprints.environment_reseals;
    const approvalFile = (await readdir(run.paths.approvalsDir)).find((name) => name.startsWith('APR-002-intent-'));
    assert.equal(entry.approval_sha256, `sha256:${sha256(await readFile(path.join(run.paths.approvalsDir, approvalFile)))}`);
    assert.deepEqual({ ...entry, approval_sha256: undefined, recorded_at: undefined }, {
      approval_id: 'APR-002', approval_sha256: undefined, recorded_at: undefined,
      reason: 'Harness hotfix: capacity waits honour the waiver',
      previous_fingerprint: run.sealed.fingerprintHash, new_fingerprint: fixed.fingerprintHash,
      previous_harness: { version: '2.1.0', sourceHash: hash('5'), bookkeepingHash: hash('6') },
      new_harness: { version: '2.1.0', sourceHash: hash('7'), bookkeepingHash: hash('8') },
    });
    const event = (await run.journal.read()).find((e) => e.event === 'environment-reseal');
    assert.equal(event.approval_id, 'APR-002');
    assert.equal(event.new_fingerprint, fixed.fingerprintHash);
    assert.deepEqual(environmentResealIssues(state, await readResealApprovals(run.paths.approvalsDir, state)), []);

    // The assertion now passes; the self-test is stale and gates capture, comparisons and closure-start.
    assert.equal((await envFingerprint({ values: {}, paths: run.paths, log: quiet, journal: run.journal,
      environmentCollector: async () => fixed })).exitCode, EXIT.PASS);
    assert.equal(state.selftest.status, 'stale');
    assert.match(state.selftest.stale_reason, /APR-002/);
    await assert.rejects(assertSelftestValid(run.paths), /self-test is stale .*APR-002/);
    const cwd = process.cwd();
    try {
      const captured = await runCommand({ command: 'capture', values: { 'run-dir': run.paths.root, label: 'after', quiet: true },
        positionals: [], argv: ['capture'], actions: { capture: async () => ({ exitCode: 0 }) } });
      assert.equal(captured, EXIT.PRECONDITION);
    } finally {
      process.chdir(cwd);
    }

    // The approval is used once, and editing it afterwards is caught.
    await assert.rejects(reseal(run, fingerprint(components({ sourceHash: hash('9') }))), /already authorised an environment re-seal/);
    await writeFile(path.join(run.paths.approvalsDir, approvalFile), `${await readFile(path.join(run.paths.approvalsDir, approvalFile), 'utf8')}\nedited\n`);
    assert.match(environmentResealIssues(state, await readResealApprovals(run.paths.approvalsDir, state)).join('\n'), /changed after the re-seal was recorded/);
  });

  test('refuses when any field besides the harness identity differs, and writes nothing', async (t) => {
    const run = await sealedEnvRun();
    t.after(() => rm(run.root, { recursive: true, force: true }));
    await grant(run, 'APR-002');
    const before = { file: await readFile(run.paths.envFingerprint, 'utf8'), state: await new StateStore(run.paths).read() };
    for (const changed of [
      components({ sourceHash: hash('7'), browserVersion: '141.0.0.0' }),
      components({ sourceHash: hash('7'), depsLockHash: hash('3') }),
    ]) {
      await assert.rejects(reseal(run, fingerprint(changed)),
        (error) => error.exitCode === EXIT.INVALID && /Re-seal refused: (browser\.version|harness\.depsLockHash)/.test(error.message));
    }
    await assert.rejects(reseal(run, run.sealed), /Nothing to re-seal/);
    assert.equal(await readFile(run.paths.envFingerprint, 'utf8'), before.file);
    const after = await new StateStore(run.paths).read();
    assert.equal(after.fingerprints.environment, before.state.fingerprints.environment);
    assert.equal(after.fingerprints.environment_reseals, undefined);
    assert.equal(after.selftest.status, 'green');
  });

  test('refuses a missing, declined or tampered approval', async (t) => {
    const run = await sealedEnvRun();
    t.after(() => rm(run.root, { recursive: true, force: true }));
    const fixed = fingerprint(components({ sourceHash: hash('7') }));
    await assert.rejects(reseal(run, fixed), /APR-002 cannot authorise an environment re-seal:[\s\S]*no intent approval file/);

    await approvalRecord({ values: { id: 'APR-002', stage: 'intent', granted: false, scope: 'Re-seal', question: 'Re-seal?', answer: 'No' },
      paths: run.paths, log: quiet, journal: run.journal });
    await assert.rejects(reseal(run, fixed), /APR-002 cannot authorise[\s\S]*not granted|not recorded as granted/);

    await grant(run, 'APR-003');
    const file = (await readdir(run.paths.approvalsDir)).find((name) => name.startsWith('APR-003-intent-'));
    const target = path.join(run.paths.approvalsDir, file);
    await writeFile(target, (await readFile(target, 'utf8')).replace(`run_id: "${RUN_ID}"`, 'run_id: "2026-01-01-other"'));
    await assert.rejects(reseal(run, fixed, { approval: 'APR-003' }), /APR-003 cannot authorise[\s\S]*belongs to another run/);
    await writeFile(target, (await readFile(target, 'utf8')).replace('run_id: "2026-01-01-other"', `run_id: "${RUN_ID}"`).replace('granted_by: "user"', 'granted_by: "agent"'));
    await assert.rejects(reseal(run, fixed, { approval: 'APR-003' }), /APR-003 cannot authorise[\s\S]*not granted by the user/);

    await assert.rejects(reseal(run, fixed, { approval: 'APR-3' }), /--approval must name/);
    await assert.rejects(reseal(run, fixed, { approval: 'APR-003', reason: ' ' }), /--reason is required/);
    assert.equal((await new StateStore(run.paths).read()).fingerprints.environment_reseals, undefined);
  });

  test('refuses when the sealed environment file was edited', async (t) => {
    const run = await sealedEnvRun();
    t.after(() => rm(run.root, { recursive: true, force: true }));
    await grant(run, 'APR-002');
    const edited = { ...run.sealed, components: { ...run.sealed.components, browser: { ...run.sealed.components.browser, version: '1.0' } } };
    await writeFile(run.paths.envFingerprint, JSON.stringify(edited));
    await assert.rejects(reseal(run, fingerprint(components({ sourceHash: hash('7') }))), /was edited/);
  });
});
