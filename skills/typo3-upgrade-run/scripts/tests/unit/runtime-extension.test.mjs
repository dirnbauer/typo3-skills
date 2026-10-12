import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  assertPhaseRuntime, describeRuntimeWindow, readRuntimeApprovals, resolveRuntime, runtimeExtensionLedger,
  runtimeProfileIssues, runtimeWindow, sealedRuntimeWindow,
} from '../../lib/run/runtime.mjs';
import { emptyState, StateStore } from '../../lib/run/state.mjs';
import { stateSchemaErrors } from '../../lib/run/schema.mjs';
import { RunPaths } from '../../lib/run/paths.mjs';
import { Journal } from '../../lib/run/journal.mjs';
import { runtimeExtend } from '../../lib/actions/core.mjs';
import { approvalRecord } from '../../lib/actions/lifecycle.mjs';
import { copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { assertWithinRuntimeBudget, lateAcceptanceCommand, runCommand } from '../../lib/cli/command.mjs';
import { parse } from '../../lib/cli/args.mjs';
import { CLOSURE_CHECKS, closureIssues, timelyVerification } from '../../lib/actions/closure.mjs';
import { renderStatus } from '../../lib/run/status.mjs';
import { buildGraphReport, buildNodeBrief, renderGraphReport, renderNodeBrief } from '../../lib/actions/runner.mjs';
import { graphContext, graphInit, graphValidate } from '../../lib/actions/graph.mjs';
import { validateRun } from '../../lib/actions/lifecycle.mjs';
import { sha256 } from '../../lib/run/paths.mjs';

const HOUR = 60 * 60 * 1000;
const DEFAULT_GRAPH = fileURLToPath(new URL('../../../templates/run-directory/config/upgrade-graph.yml', import.meta.url));
const RUN_ID = '2026-09-05-extend';
const STARTED = '2026-09-05T00:00:00.000Z';
const quiet = { success() {}, info() {}, warn() {}, debug() {}, error() {}, step() {}, finding() {}, json() {} };

function sealedRuntime(size = 'small', started = STARTED) {
  const w = runtimeWindow(started, size);
  return {
    started_at: started, sealed_at: started, budget_policy: 'site-size-v2', size_profile: size,
    size_evidence_ref: 'nodes/intake/runtime-size.json',
    migration_cutoff_at: w.migrationCutoffAt, deadline_at: w.deadlineAt,
    max_hours: w.maxHours, closure_reserve_hours: w.closureReserveHours,
  };
}

/** A sealed run directory whose small window (8h) began at `started`. */
async function sealedRun(started = STARTED) {
  const root = await mkdtemp(path.join(tmpdir(), 't3u-extend-'));
  await writeFile(path.join(root, 'composer.json'), '{}\n');
  const paths = new RunPaths('.typo3-update', root);
  await mkdir(paths.approvalsDir, { recursive: true });
  const state = emptyState({ runId: RUN_ID, now: started });
  state.project.name = 'extend-fixture';
  state.project.trusted_origin = 'https://extend.ddev.site';
  state.runtime = sealedRuntime('small', started);
  await new StateStore(paths).write(state);
  return { root, paths, journal: new Journal(paths.journalPath) };
}

async function grant(run, id, { stage = 'intent', granted = true } = {}) {
  await approvalRecord({
    values: { id, stage, granted, scope: 'Extend the runtime window of this run',
      question: 'May the run continue past its sealed deadline?', answer: granted ? 'Yes' : 'No',
      ...(stage === 'acceptance' ? { evidence: 'report/closure-evidence.json#sha256:x' } : {}) },
    paths: run.paths, log: quiet, journal: run.journal,
  });
}

const extend = (run, values) => runtimeExtend({ values, paths: run.paths, log: quiet, journal: run.journal });
const readState = (run) => new StateStore(run.paths).read();
const iso = (ms) => new Date(ms).toISOString();

describe('t3u runtime-extend', () => {
  test('the command is parsed with its approval, until, waive and reason options', () => {
    const parsed = parse(['runtime-extend', '--approval', 'APR-001', '--until', '2026-10-11T08:00:00Z', '--reason', 'owner decision']);
    assert.equal(parsed.command, 'runtime-extend');
    assert.equal(parsed.values.approval, 'APR-001');
    assert.equal(parse(['runtime-extend', '--approval', 'APR-001', '--waive', '--reason', 'r']).values.waive, true);
  });

  test('extends the cutoff and deadline by a granted intent approval without touching the sealed fields', async () => {
    const run = await sealedRun();
    try {
      await grant(run, 'APR-001');
      const before = await readState(run);
      const until = iso(Math.ceil((Date.now() + 10 * HOUR) / 1000) * 1000);
      const result = await extend(run, { approval: 'APR-001', until, reason: 'Owner extends the night: dataset import took longer' });
      assert.equal(result.exitCode, 0);
      const after = await readState(run);
      for (const key of ['started_at', 'sealed_at', 'migration_cutoff_at', 'deadline_at', 'size_profile', 'max_hours', 'closure_reserve_hours', 'budget_policy']) {
        assert.equal(after.runtime[key], before.runtime[key], key);
      }
      assert.equal(after.runtime.extensions.length, 1);
      const entry = after.runtime.extensions[0];
      const file = (await readdir(run.paths.approvalsDir)).find((name) => name.startsWith('APR-001-intent-'));
      assert.equal(entry.approval_sha256, `sha256:${sha256(await readFile(path.join(run.paths.approvalsDir, file)))}`);
      assert.deepEqual({ ...entry, approval_sha256: undefined, recorded_at: undefined }, {
        approval_id: 'APR-001', approval_sha256: undefined,
        previous_cutoff: before.runtime.migration_cutoff_at, previous_deadline: before.runtime.deadline_at,
        new_cutoff: iso(Date.parse(until) - 2 * HOUR), new_deadline: until, waived: false,
        reason: 'Owner extends the night: dataset import took longer', recorded_at: undefined,
      });
      assert.deepEqual(stateSchemaErrors(after), []);
      assert.deepEqual(runtimeProfileIssues(after.runtime, {
        approvals: await readRuntimeApprovals(run.paths.approvalsDir, after.runtime), runId: RUN_ID, granted: after.approvals,
      }), []);
      const journal = await run.journal.read();
      const event = journal.find((e) => e.event === 'runtime-extension');
      assert.equal(event.approval_id, 'APR-001');
      assert.equal(event.new_deadline, until);

      const { window } = await resolveRuntime(run.paths, after);
      assert.equal(window.deadlineAt, until);
      assert.match(describeRuntimeWindow(window), new RegExp(`^extended to ${until} .* by APR-001$`));
      // The sealed deadline has passed in real time; the effective one has not.
      assert.throws(() => assertPhaseRuntime(after.runtime, 'P11', Date.now()), /deadline .* has passed/);
      assert.equal(assertPhaseRuntime(after.runtime, 'P11', Date.now(), { window }), true);
      assert.equal(assertPhaseRuntime(after.runtime, 'P08', Date.now(), { window }), true);
      assert.throws(() => assertPhaseRuntime(after.runtime, 'P08', Date.parse(until) - 2 * HOUR, { window }), /cutoff .*extended by APR-001.* has passed/);
      assert.throws(() => assertPhaseRuntime(after.runtime, 'P12', Date.parse(until), { window }), /extended by APR-001/);
      assert.equal(assertWithinRuntimeBudget(after, Date.now(), window), true);
      assert.throws(() => assertWithinRuntimeBudget(after, Date.now()), /Contract A remains incomplete/);
    } finally { await rm(run.root, { recursive: true, force: true }); }
  });

  test('a waiver removes both limits and the brief, status and graph report name it', async () => {
    const run = await sealedRun();
    try {
      await grant(run, 'APR-001');
      await grant(run, 'APR-002');
      await extend(run, { approval: 'APR-001', until: iso(Date.now() + 5 * HOUR), reason: 'first extension' });
      await extend(run, { approval: 'APR-002', waive: true, reason: 'owner waives the cap for this run' });
      const state = await readState(run);
      const ledger = await resolveRuntime(run.paths, state);
      assert.deepEqual(ledger.issues, []);
      assert.equal(ledger.applied.length, 2);
      assert.equal(ledger.window.waived, true);
      assert.equal(state.runtime.extensions[1].previous_deadline, state.runtime.extensions[0].new_deadline);
      assert.match(describeRuntimeWindow(ledger.window), /^cutoff waived by APR-002/);
      assert.equal(assertPhaseRuntime(state.runtime, 'P09', Date.now() + 1000 * HOUR, { window: ledger.window }), true);
      assert.match(renderStatus(state, ledger.window), /Runtime extension \| cutoff waived by APR-002/);
      const definition = { nodes: {}, edges: [], policy: {} };
      const report = buildGraphReport(definition, { ...state, graph: { nodes: {}, edges: {}, definition_hash: 'h' } }, [],
        { window: ledger.window, extensions: ledger.applied });
      assert.equal(report.runtime.deadline_at, state.runtime.deadline_at);
      assert.equal(report.runtime.effective_deadline_at, null);
      assert.match(renderGraphReport(report), /Runtime extension: cutoff waived by APR-002/);
      assert.match(renderGraphReport(report), /APR-001 .*deadline/);
      await assert.rejects(extend(run, { approval: 'APR-003', waive: true, reason: 'again' }), /no intent approval file/);
    } finally { await rm(run.root, { recursive: true, force: true }); }
  });

  test('refuses a missing, declined, acceptance-stage or reused approval and a shortening or ambiguous request', async () => {
    const run = await sealedRun();
    try {
      const until = iso(Date.now() + 6 * HOUR);
      await assert.rejects(extend(run, { approval: 'APR-001', until, reason: 'r' }), /no intent approval file/);
      await grant(run, 'APR-001', { granted: false });
      await assert.rejects(extend(run, { approval: 'APR-001', until, reason: 'r' }), /not granted|state\.approvals/);
      await grant(run, 'APR-002', { stage: 'acceptance' });
      await assert.rejects(extend(run, { approval: 'APR-002', until, reason: 'r' }), /no intent approval file/);
      await grant(run, 'APR-003');
      await assert.rejects(extend(run, { approval: 'APR-003', reason: 'r' }), /exactly one of --until/);
      await assert.rejects(extend(run, { approval: 'APR-003', until, waive: true, reason: 'r' }), /exactly one of --until/);
      await assert.rejects(extend(run, { approval: 'APR-003', until }), /--reason is required/);
      await assert.rejects(extend(run, { approval: 'APR-003', until: 'tomorrow', reason: 'r' }), /ISO 8601/);
      await assert.rejects(extend(run, { approval: 'APR-003', until: iso(Date.now() - HOUR), reason: 'r' }), /already passed/);
      await assert.rejects(extend(run, { approval: 'APR-003', until, reason: 'r', 'dry-run': true }), /no --dry-run/);
      await extend(run, { approval: 'APR-003', until, reason: 'r' });
      await assert.rejects(extend(run, { approval: 'APR-003', waive: true, reason: 'r' }), /already authorised/);
      await grant(run, 'APR-004');
      await assert.rejects(extend(run, { approval: 'APR-004', until: iso(Date.parse(until) - HOUR), reason: 'r' }), /never shortens/);
      assert.equal((await readState(run)).runtime.extensions.length, 1);
    } finally { await rm(run.root, { recursive: true, force: true }); }
  });

  test('a tampered or deleted approval stops counting: the sealed window applies and validation fails', async () => {
    const run = await sealedRun();
    try {
      await grant(run, 'APR-001');
      await extend(run, { approval: 'APR-001', until: iso(Date.now() + 6 * HOUR), reason: 'owner decision' });
      const file = path.join(run.paths.approvalsDir, (await readdir(run.paths.approvalsDir)).find((n) => n.startsWith('APR-001-')));
      await writeFile(file, (await readFile(file, 'utf8')).replace('Extend the runtime window', 'Extend the runtime window forever'));
      const state = await readState(run);
      const ledger = await resolveRuntime(run.paths, state);
      assert.equal(ledger.window.extension, null);
      assert.equal(ledger.window.deadlineAt, state.runtime.deadline_at);
      assert.ok(ledger.issues.some((issue) => /sha256 mismatch/.test(issue)));
      assert.throws(() => assertPhaseRuntime(state.runtime, 'P11', Date.now(), { window: ledger.window }), /deadline .* has passed/);
      await grant(run, 'APR-002');
      await assert.rejects(extend(run, { approval: 'APR-002', waive: true, reason: 'r' }), /do not verify/);
      await rm(file);
      const gone = await resolveRuntime(run.paths, state);
      assert.equal(gone.window.extension, null);
      assert.ok(gone.issues.some((issue) => /APR-001 has no intent approval file/.test(issue)));
    } finally { await rm(run.root, { recursive: true, force: true }); }
  });

  test('graph-validate and validate-run accept a verified extension and refuse a tampered one; the brief names it', async () => {
    const run = await sealedRun();
    try {
      await mkdir(run.paths.configDir, { recursive: true });
      await copyFile(DEFAULT_GRAPH, run.paths.graphDefinition);
      await graphInit({ values: {}, paths: run.paths, log: quiet, journal: run.journal });
      await grant(run, 'APR-001');
      await extend(run, { approval: 'APR-001', until: iso(Date.now() + 6 * HOUR), reason: 'owner decision' });
      assert.equal((await graphValidate({ paths: run.paths, log: quiet })).exitCode, 0);
      assert.equal((await validateRun({ paths: run.paths, log: quiet })).exitCode, 0);
      const { state, definition } = await graphContext(run.paths);
      const { window } = await resolveRuntime(run.paths, state);
      const brief = buildNodeBrief('intake', definition, state, { window, now: Date.now() });
      assert.match(renderNodeBrief(brief), /runtime extended to .* by APR-001; sealed cutoff and deadline unchanged/);
      assert.ok(brief.budget.minutes_to_deadline > 300);
      const file = path.join(run.paths.approvalsDir, (await readdir(run.paths.approvalsDir)).find((n) => n.startsWith('APR-001-')));
      await writeFile(file, `${await readFile(file, 'utf8')}\nedited later\n`);
      await assert.rejects(graphValidate({ paths: run.paths, log: quiet }), /sha256 mismatch/);
      await assert.rejects(validateRun({ paths: run.paths, log: quiet }), /sha256 mismatch/);
    } finally { await rm(run.root, { recursive: true, force: true }); }
  });

  test('runs past the sealed deadline through the command wrapper, which still refuses other work', async () => {
    const run = await sealedRun();
    const cwd = process.cwd();
    try {
      await grant(run, 'APR-001');
      const until = iso(Date.now() + 6 * HOUR);
      const values = { 'run-dir': run.paths.root, approval: 'APR-001', until, reason: 'owner decision', quiet: true };
      const blocked = await runCommand({ command: 'graph-status', values: { 'run-dir': run.paths.root, quiet: true }, positionals: [],
        argv: ['graph-status'], actions: { 'graph-status': async () => ({ exitCode: 0 }) } });
      assert.equal(blocked, 4);
      const code = await runCommand({ command: 'runtime-extend', values, positionals: [], argv: ['runtime-extend'],
        actions: { 'runtime-extend': runtimeExtend } });
      assert.equal(code, 0);
      const allowed = await runCommand({ command: 'graph-status', values: { 'run-dir': run.paths.root, quiet: true }, positionals: [],
        argv: ['graph-status'], actions: { 'graph-status': async () => ({ exitCode: 0 }) } });
      assert.equal(allowed, 0);
    } finally {
      process.chdir(cwd);
      await rm(run.root, { recursive: true, force: true });
    }
  });
});

describe('runtimeProfileIssues and the extension ledger', () => {
  const runtime = sealedRuntime('small');
  const approvalSha = `sha256:${'c'.repeat(64)}`;
  const approvals = new Map([['APR-001', { id: 'APR-001', files: ['APR-001-intent-x.md'], file: 'APR-001-intent-x.md', sha256: approvalSha,
    meta: { id: 'APR-001', stage: 'intent', granted_by: 'user', granted_at: '2026-09-05T07:00:00.000Z', run_id: RUN_ID } }]]);
  const context = { approvals, runId: RUN_ID, granted: ['APR-001'] };
  const entry = (patch = {}) => ({
    approval_id: 'APR-001', approval_sha256: approvalSha,
    previous_cutoff: runtime.migration_cutoff_at, previous_deadline: runtime.deadline_at,
    new_cutoff: '2026-09-05T12:00:00.000Z', new_deadline: '2026-09-05T14:00:00.000Z', waived: false,
    reason: 'owner decision', recorded_at: '2026-09-05T07:30:00.000Z', ...patch,
  });

  test('accepts a verified extension and keeps validating the sealed values', () => {
    const extended = { ...runtime, extensions: [entry()] };
    assert.deepEqual(runtimeProfileIssues(extended, context), []);
    const { window } = runtimeExtensionLedger(extended, context);
    assert.equal(window.deadlineAt, '2026-09-05T14:00:00.000Z');
    assert.equal(assertPhaseRuntime(extended, 'P08', Date.parse('2026-09-05T11:59:59.000Z'), { window }), true);
    assert.throws(() => assertPhaseRuntime(extended, 'P08', Date.parse('2026-09-05T12:00:00.000Z'), { window }), /cutoff/);
    // Without the verified ledger the sealed window applies.
    assert.throws(() => assertPhaseRuntime(extended, 'P08', Date.parse('2026-09-05T07:00:00.000Z')), /cutoff/);
    assert.ok(runtimeProfileIssues({ ...extended, deadline_at: '2026-09-05T14:00:00.000Z' }, context)
      .some((issue) => /deadline_at must equal sealed/.test(issue)));
    const state = emptyState({ runId: RUN_ID, now: STARTED });
    state.runtime = extended;
    assert.deepEqual(stateSchemaErrors(state), []);
    state.runtime = { ...extended, extensions: [{ ...entry(), extra: true }] };
    assert.ok(stateSchemaErrors(state).length);
  });

  test('refuses unverifiable, tampered, hand-edited or out-of-order entries', () => {
    const issues = (entries, ctx = context) => runtimeProfileIssues({ ...runtime, extensions: entries }, ctx);
    assert.ok(issues([entry()], {}).some((x) => /cannot be verified/.test(x)));
    assert.ok(issues([entry({ approval_sha256: `sha256:${'d'.repeat(64)}` })]).some((x) => /sha256 mismatch/.test(x)));
    assert.ok(issues([entry()], { ...context, granted: [] }).some((x) => /state\.approvals/.test(x)));
    assert.ok(issues([entry()], { ...context, runId: 'other' }).some((x) => /another run/.test(x)));
    const acceptance = new Map([['APR-001', { ...approvals.get('APR-001'), meta: { ...approvals.get('APR-001').meta, stage: 'acceptance' } }]]);
    assert.ok(issues([entry()], { ...context, approvals: acceptance }).some((x) => /not an intent approval/.test(x)));
    assert.ok(issues([entry({ new_cutoff: '2026-09-05T13:30:00.000Z' })]).some((x) => /closure reserve/.test(x)));
    assert.ok(issues([entry({ new_deadline: '2026-09-05T07:00:00.000Z', new_cutoff: '2026-09-05T05:00:00.000Z' })]).some((x) => /never shortens/.test(x)));
    assert.ok(issues([entry({ previous_deadline: '2026-09-05T09:00:00.000Z' })]).some((x) => /window before it/.test(x)));
    assert.ok(issues([entry({ waived: true })]).some((x) => /waiver sets/.test(x)));
    assert.ok(issues([entry({ reason: ' ' })]).some((x) => /reason/.test(x)));
    assert.ok(issues([entry({ recorded_at: '2026-09-05T06:30:00.000Z' })]).some((x) => /granted after/.test(x)));
    const second = entry({ approval_id: 'APR-001', previous_cutoff: '2026-09-05T12:00:00.000Z', previous_deadline: '2026-09-05T14:00:00.000Z',
      new_cutoff: null, new_deadline: null, waived: true, recorded_at: '2026-09-05T07:10:00.000Z' });
    const ordered = issues([entry(), second]);
    assert.ok(ordered.some((x) => /ordered by recorded_at/.test(x)));
    assert.ok(ordered.some((x) => /already authorised/.test(x)));
    // A refused entry never widens the window, nor does anything chained onto it.
    const { window } = runtimeExtensionLedger({ ...runtime, extensions: [entry({ approval_sha256: `sha256:${'d'.repeat(64)}` })] }, context);
    assert.deepEqual(window, sealedRuntimeWindow(runtime));
    assert.ok(runtimeProfileIssues({ started_at: STARTED, extensions: [entry()] }).length);
  });
});

describe('deadline rules use the effective window', () => {
  const deadline = '2026-09-05T08:00:00.000Z';
  const extended = { cutoffAt: '2026-09-05T18:00:00.000Z', deadlineAt: '2026-09-05T20:00:00.000Z',
    cutoffMs: Date.parse('2026-09-05T18:00:00.000Z'), deadlineMs: Date.parse('2026-09-05T20:00:00.000Z'),
    waived: false, extension: { approval_id: 'APR-007' } };
  function closureFixture(verifiedAt) {
    const subject = { head: 'abc', sourceIndexHash: 's', worktreeHash: 'w', graphHash: 'g', inputs: {} };
    const epoch = { schema: 'typo3-upgrade-run/closure-epoch@1', runId: RUN_ID, createdAt: '2026-09-05T09:00:00Z', subject };
    epoch.hash = `sha256:${sha256(JSON.stringify(epoch))}`;
    const manifest = { schema: 'typo3-upgrade-run/closure@1', runId: RUN_ID, coverageRef: 'c', backupRef: 'b', restoreRef: 'r',
      ...Object.fromEntries(['coverage', 'backup', 'restore'].map((k) => [`${k}Sha256`, `sha256:${'b'.repeat(64)}`])),
      checks: CLOSURE_CHECKS.map((id) => ({ id, epoch: epoch.hash, command: 'check', status: 'pass', exitCode: 0, failed: 0, skipped: 0,
        expected: 1, executed: 1, startedAt: '2026-09-05T09:01:00Z', finishedAt: '2026-09-05T09:02:00Z',
        artifacts: [{ path: `${id}.json`, sha256: `sha256:${'a'.repeat(64)}` }],
        ...(id === 'visual' ? { pixelThreshold: 0, unapprovedDifferences: 0 } : {}),
        ...(id === 'lighthouse' ? { runsPerUrl: 3, budgetApplied: true, toolVersion: '13', chromeVersion: 'c' } : {}) })) };
    const state = { run_id: RUN_ID, open_findings: 0, runtime: { deadline_at: deadline },
      contract_a: { status: 'open', verification: { at: verifiedAt, evidence_ref: 'report/closure-evidence.json', epoch_hash: epoch.hash,
        manifest_hash: `sha256:${sha256(JSON.stringify(manifest))}` } },
      graph: { nodes: Object.fromEntries(['migration-join', 'target-content-epoch', 'http-dom-proof', 'visual-proof', 'component-sentinels',
        'backend-operations', 'lighthouse-axe', 'closure-join'].map((id) => [id, { status: 'passed' }])) } };
    return { manifest, epoch, subject, state };
  }

  test('closure proof after the sealed deadline counts only before the extended one', () => {
    const f = closureFixture('2026-09-05T10:00:00.000Z');
    const now = Date.parse('2026-09-05T11:00:00.000Z');
    assert.equal(timelyVerification(f.manifest, f.epoch, f.state, now), false);
    assert.equal(timelyVerification(f.manifest, f.epoch, f.state, now, extended), true);
    assert.ok(closureIssues(f.manifest, f.epoch, f.subject, f.state, now).some((x) => /deadline/.test(x)));
    assert.deepEqual(closureIssues(f.manifest, f.epoch, f.subject, f.state, now, extended), []);
    // Every other proof rule still applies inside an extended window.
    f.manifest.checks[0].skipped = 1;
    assert.ok(closureIssues(f.manifest, f.epoch, f.subject, f.state, now, extended).some((x) => /skipped/.test(x)));
    const late = closureFixture('2026-09-05T21:00:00.000Z');
    assert.equal(timelyVerification(late.manifest, late.epoch, late.state, Date.parse('2026-09-05T22:00:00.000Z'), extended), false);
    assert.equal(lateAcceptanceCommand('approval', { stage: 'acceptance' }, f.state), false);
    assert.equal(lateAcceptanceCommand('approval', { stage: 'acceptance' }, f.state, extended), true);
  });
});
