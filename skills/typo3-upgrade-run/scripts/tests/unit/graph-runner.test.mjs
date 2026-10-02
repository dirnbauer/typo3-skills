import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { graphForecast, graphInit, graphNext, nodeClose, nodeOpen, validateGraphDefinition } from '../../lib/actions/graph.mjs';
import { buildGraphReport, buildNodeBrief, nodeBrief, renderNodeBrief } from '../../lib/actions/runner.mjs';
import { snapshotCreate } from '../../lib/actions/lifecycle.mjs';
import { forbiddenMeasurementChanges, parseReview } from '../../lib/run/guards.mjs';
import { RunPaths, sha256 } from '../../lib/run/paths.mjs';
import { runtimeWindow } from '../../lib/run/runtime.mjs';
import { emptyState, StateStore } from '../../lib/run/state.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_GRAPH = path.resolve(HERE, '../../../templates/run-directory/config/upgrade-graph.yml');
const quietLog = { success() {}, info() {}, debug() {}, error() {}, finding() {} };
const quietJournal = { async append() {} };

async function runFixture(definitionText, { git = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 't3u-runner-'));
  if (git) {
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'base'], { cwd: root });
  }
  const paths = new RunPaths('.typo3-update', root);
  await mkdir(paths.configDir, { recursive: true });
  await writeFile(paths.graphDefinition, definitionText, 'utf8');
  const state = emptyState({ runId: '2026-09-27-runner', now: '2026-09-27T08:00:00.000Z' });
  state.project.trusted_origin = 'https://fixture.ddev.site';
  await new StateStore(paths).write(state);
  await graphInit({ values: {}, paths, log: quietLog, journal: quietJournal });
  const head = git ? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() : null;
  return { root, paths, head };
}

async function evidence(paths, id, name, body) {
  await mkdir(paths.node(id), { recursive: true });
  await writeFile(path.join(paths.node(id), name), body, 'utf8');
  return `nodes/${id}/${name}`;
}

const GUARDED = stringifyYaml({
  schema: 'typo3-upgrade-run/graph@1',
  policy: { require_artifacts: true, require_independent_review: true, guard_change_scope: true,
    recovery_change_budget: { files: 2, lines: 20 } },
  resources: [],
  start: ['css-recovery', 'judge', 'harness-recovery'],
  terminal: ['done', 'stopped'],
  nodes: {
    'css-recovery': { skill: 'typo3-vite', phase: 'P00', mutation: 'code', outcomes: ['pass', 'blocked'] },
    'harness-recovery': { skill: 'typo3-upgrade-baseline', phase: 'P00', mutation: 'code', measurement: true, outcomes: ['pass', 'blocked'] },
    judge: { skill: 'typo3-upgrade-closure', phase: 'P00', review: 'required', outcomes: ['pass', 'not-applicable', 'blocked'] },
    done: { phase: 'P15', outcomes: ['pass'] },
    stopped: { phase: 'P15', outcomes: ['pass'] },
  },
  edges: [
    { id: 'css-pass', from: 'css-recovery', outcome: 'pass', to: 'done' },
    { id: 'css-blocked', from: 'css-recovery', outcome: 'blocked', to: 'stopped' },
    { id: 'harness-pass', from: 'harness-recovery', outcome: 'pass', to: 'done' },
    { id: 'harness-blocked', from: 'harness-recovery', outcome: 'blocked', to: 'stopped' },
    { id: 'judge-pass', from: 'judge', outcome: 'pass', to: 'done' },
    { id: 'judge-na', from: 'judge', outcome: 'not-applicable', to: 'done' },
    { id: 'judge-blocked', from: 'judge', outcome: 'blocked', to: 'stopped' },
  ],
});

test('every node of the shipped graph carries a contract and the new controls are enabled', async () => {
  const definition = parseYaml(await readFile(DEFAULT_GRAPH, 'utf8'));
  assert.deepEqual(validateGraphDefinition(definition), []);
  for (const flag of ['require_node_contracts', 'require_independent_review', 'guard_change_scope']) {
    assert.equal(definition.policy[flag], true, flag);
  }
  for (const [id, node] of Object.entries(definition.nodes)) {
    assert.ok(node.objective && node.done && node.evidence, `${id} has objective, done and evidence`);
  }
  assert.equal(definition.nodes['intake-join'].evidence, 'manifests/feature-contracts.json');
  const measurement = Object.entries(definition.nodes).filter(([, n]) => n.measurement).map(([id]) => id).sort();
  assert.deepEqual(measurement, ['closure-harness-recovery', 'determinism-recovery', 'harness-recovery', 'session-recovery']);
  assert.equal(definition.nodes['visual-classify'].review, 'required');
});

test('contracts are required only where the definition opts in', () => {
  const base = { schema: 'typo3-upgrade-run/graph@1', resources: [], start: ['a'], terminal: ['a'],
    nodes: { a: { phase: 'P00', outcomes: ['pass'] } }, edges: [] };
  assert.deepEqual(validateGraphDefinition(base), []);
  const strict = { ...base, policy: { require_node_contracts: true } };
  assert.ok(validateGraphDefinition(strict).some((issue) => issue.includes('objective')));
  const good = { ...strict, nodes: { a: { phase: 'P00', outcomes: ['pass'], objective: 'Prove the fixture works as intended.',
    done: 'The fixture evidence file exists and is read.', evidence: 'nodes/a/evidence.md' } } };
  assert.deepEqual(validateGraphDefinition(good), []);
  assert.ok(validateGraphDefinition({ ...good, nodes: { a: { ...good.nodes.a, evidence: '../escape.md' } } })
    .some((issue) => issue.includes('evidence path')));
  assert.ok(validateGraphDefinition({ ...base, policy: { recovery_change_budget: { files: 0, lines: 10 } } })
    .some((issue) => issue.includes('recovery_change_budget')));
  assert.ok(validateGraphDefinition({ ...base, nodes: { a: { ...base.nodes.a, review: 'maybe' } } })
    .some((issue) => issue.includes('review')));
});

test('a node brief is a complete work order: contract, owner, routes, retries, flags and blockers', async () => {
  const { root, paths } = await runFixture(await readFile(DEFAULT_GRAPH, 'utf8'));
  try {
    await nodeOpen({ values: { node: 'intake' }, paths, log: quietLog, journal: quietJournal });
    const ev = await evidence(paths, 'intake', 'evidence.md', 'identity recorded, exit=0\n');
    await nodeClose({ values: { node: 'intake', outcome: 'pass', evidence: ev }, paths, log: quietLog, journal: quietJournal });

    const state = await new StateStore(paths).read();
    const definition = parseYaml(await readFile(paths.graphDefinition, 'utf8'));
    const url = buildNodeBrief('url-discovery', definition, state);
    assert.equal(url.owner, 'typo3-upgrade-intake');
    assert.match(url.objective, /URL manifest/);
    assert.deepEqual(url.blockers, []);
    assert.deepEqual(url.routes.find((r) => r.outcome === 'findings').to[0].targets, ['sitemap-recovery']);
    assert.deepEqual(url.incoming_retries.map((r) => `${r.edge} ${r.used}/${r.max}`).sort(), ['degraded-pass 0/1', 'sitemap-fixed 0/2']);
    assert.equal(url.commands.open, 't3u node-open --node url-discovery');

    const classify = buildNodeBrief('visual-classify', definition, state);
    assert.ok(classify.commands.close.includes('--review nodes/visual-classify/review.md'));
    assert.ok(classify.review.required_for.includes('css') && !classify.review.required_for.includes('blocked'));
    assert.ok(classify.blockers.some((b) => b.startsWith('not activated')));

    const rung = buildNodeBrief('rung-13', definition, state);
    assert.deepEqual(rung.commands.prepare, ['t3u snapshot-create --node rung-13']);
    assert.ok(rung.commands.open.includes('--snapshot'));
    assert.ok(rung.commands.close.includes('--evidence-loop'));
    const css = buildNodeBrief('css-recovery', definition, state);
    assert.deepEqual(css.guard.change_budget, { files: 10, lines: 400 });
    assert.ok(css.rules.some((rule) => rule.includes('Never edit measurement inputs')));

    await nodeOpen({ values: { node: 'url-discovery' }, paths, log: quietLog, journal: quietJournal });
    const held = buildNodeBrief('structured-data-inventory', definition, await new StateStore(paths).read());
    assert.ok(held.blockers.includes('browser-proof held by url-discovery'));
    assert.match(renderNodeBrief(held), /## Outcomes → next/);
    const viaCommand = await nodeBrief({ values: { node: 'url-discovery', json: true }, paths, log: quietLog });
    assert.equal(viaCommand.brief.status, 'running');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('judgement outcomes need an agreeing review bound to the exact evidence bytes', async () => {
  const { root, paths } = await runFixture(GUARDED);
  try {
    await nodeOpen({ values: { node: 'judge' }, paths, log: quietLog, journal: quietJournal });
    const ev = await evidence(paths, 'judge', 'evidence.md', 'classified: css, first differing stage pixels\n');
    const close = (extra) => nodeClose({ values: { node: 'judge', outcome: 'pass', evidence: ev, ...extra }, paths, log: quietLog, journal: quietJournal });
    await assert.rejects(close({}), /needs --review/);
    await assert.rejects(close({ review: ev }), /separate artifact/);
    const hash = `sha256:${sha256(await readFile(path.join(paths.root, ev)))}`;
    const disagree = await evidence(paths, 'judge', 'review-1.md', `verdict: disagree\nevidence_sha256: ${hash}\n`);
    await assert.rejects(close({ review: disagree }), /does not agree/);
    const stale = await evidence(paths, 'judge', 'review-2.md', `verdict: agree\nevidence_sha256: sha256:${'0'.repeat(64)}\n`);
    await assert.rejects(close({ review: stale }), /different evidence bytes/);
    const agree = await evidence(paths, 'judge', 'review.md', `# Review\nverdict: agree\nevidence_sha256: ${hash}\nReason: pixel stage isolated.\n`);
    await close({ review: agree });
    const node = (await new StateStore(paths).read()).graph.nodes.judge;
    assert.equal(node.status, 'passed');
    assert.equal(node.review, agree);
    assert.match(node.review_sha256, /^sha256:[a-f0-9]{64}$/);
    assert.deepEqual(parseReview('verdict: AGREE\nevidence_sha256: nope'), { verdict: 'agree', evidenceSha256: null });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a project already on 14.3 skips the 13.4 rung and the v12/v13 migrations on a reviewed read-only check', async () => {
  const { root, paths } = await runFixture(await readFile(DEFAULT_GRAPH, 'utf8'));
  try {
    const store = new StateStore(paths);
    const now = new Date().toISOString(), window = runtimeWindow(now, 'small');
    await store.update((s) => {
      Object.assign(s.runtime, { started_at: now, sealed_at: now, size_profile: 'small', size_evidence_ref: 'nodes/intake/pilot.md',
        deadline_at: window.deadlineAt, migration_cutoff_at: window.migrationCutoffAt,
        max_hours: window.maxHours, closure_reserve_hours: window.closureReserveHours });
      // Intake, baseline and the dependency plan are not under test: the plan passed.
      Object.assign(s.graph.nodes['dependency-plan'], { status: 'passed', outcome: 'pass' });
      s.graph.edges['dependencies-pass'].traversals = 1;
    });
    const definition = parseYaml(await readFile(paths.graphDefinition, 'utf8'));
    await evidence(paths, 'intake', 'pilot.md', 'measured pilot minutes\n');
    const state = await store.read();
    const plan = { schema: 'typo3-upgrade-run/runtime-plan@1', run_id: state.run_id, graph_hash: state.graph.definition_hash,
      max_workers: 1, final_passes: 2, lighthouse_runs_per_url: 3, buffer_minutes: 30,
      nodes: Object.fromEntries(Object.keys(definition.nodes).map((id) => [id, { minutes: 1, source: 'nodes/intake/pilot.md',
        ...(id === 'rung-13' ? { outcome: 'not-applicable' } : {}) }])) };
    await mkdir(paths.reportDir, { recursive: true });
    await writeFile(path.join(paths.reportDir, 'runtime-plan.json'), JSON.stringify(plan));
    const forecast = await graphForecast({ values: { evidence: 'report/runtime-plan.json' }, paths, log: quietLog, journal: quietJournal });
    assert.equal(forecast.feasible, true);
    assert.ok(forecast.schedule.some((job) => job.id === 'rung-14'));
    assert.ok(!forecast.schedule.some((job) => ['mechanical-migration', 'manual-migration'].includes(job.id)));

    // Read-only: no snapshot, no rollback anchor, and never a pass.
    await nodeOpen({ values: { node: 'rung-13', 'applicability-only': true }, paths, log: quietLog, journal: quietJournal });
    const ev = await evidence(paths, 'rung-13', 'evidence.md',
      '$ ddev composer show typo3/cms-core\nversions : * v14.3.5\nexit=0\n^14.3 is already installed: patch path.\n');
    const close = (extra) => nodeClose({ values: { node: 'rung-13', evidence: ev, ...extra }, paths, log: quietLog, journal: quietJournal });
    await assert.rejects(close({ outcome: 'pass', 'evidence-loop': '100' }), /read-only applicability/);
    await assert.rejects(close({ outcome: 'not-applicable' }), /needs --review/);
    const hash = `sha256:${sha256(await readFile(path.join(paths.root, ev)))}`;
    const review = await evidence(paths, 'rung-13', 'review.md', `verdict: agree\nevidence_sha256: ${hash}\n`);
    const closed = await close({ outcome: 'not-applicable', review });
    assert.deepEqual(closed.routes, ['rung13-already-14']);

    const graph = (await store.read()).graph;
    assert.equal(graph.nodes['rung-13'].status, 'skipped');
    assert.equal(graph.nodes['rung-13'].review_sha256, `sha256:${sha256(await readFile(path.join(paths.root, review)))}`);
    assert.equal(graph.nodes['rung-14'].status, 'ready');
    assert.equal(graph.nodes['mechanical-migration'].status, 'pending');
    assert.equal(graph.nodes['manual-migration'].status, 'pending');
    const next = await graphNext({ paths, log: quietLog });
    assert.ok(next.ready.some((node) => node.id === 'rung-14'));
    assert.ok(!next.ready.some((node) => node.id === 'mechanical-migration'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a site fix cannot pass by changing what is measured, and recovery size is budgeted', async () => {
  const { root, paths, head } = await runFixture(GUARDED, { git: true });
  try {
    await writeFile(path.join(paths.configDir, 'thresholds.yml'), 'pixel: 0\n');
    await nodeOpen({ values: { node: 'css-recovery', 'rollback-ref': `git:${head}` }, paths, log: quietLog, journal: quietJournal });
    const ev = await evidence(paths, 'css-recovery', 'evidence.md', 'fixed one selector, exit=0\n');
    const close = (extra = {}) => nodeClose({ values: { node: 'css-recovery', outcome: 'pass', evidence: ev, ...extra }, paths, log: quietLog, journal: quietJournal });

    await writeFile(path.join(paths.configDir, 'thresholds.yml'), 'pixel: 25\n');
    await assert.rejects(close(), /changed measurement inputs.*config\/thresholds\.yml/);
    await writeFile(path.join(paths.configDir, 'thresholds.yml'), 'pixel: 0\n');

    for (const n of [1, 2, 3]) await writeFile(path.join(root, `site-${n}.css`), 'a { color: red; }\n');
    await assert.rejects(close(), /over its 2-file\/20-line budget/);
    const state = await new StateStore(paths).read();
    state.approvals.push('APR-007');
    await new StateStore(paths).write(state);
    await close({ approval: 'APR-007' });
    const node = (await new StateStore(paths).read()).graph.nodes['css-recovery'];
    assert.equal(node.status, 'passed');
    assert.deepEqual({ files: node.change.files, over: node.change.over_budget, approval: node.change.approval },
      { files: 3, over: true, approval: 'APR-007' });
    assert.equal(node.anchor.rollback_ref, `git:${head}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('pre-existing untracked user files are not counted as the recovery node\'s change', async () => {
  const { root, paths, head } = await runFixture(GUARDED, { git: true });
  try {
    await mkdir(path.join(root, 'relaunch'), { recursive: true });
    for (const n of [1, 2, 3, 4]) await writeFile(path.join(root, 'relaunch', `draft-${n}.html`), '<p>draft</p>\n');
    await nodeOpen({ values: { node: 'css-recovery', 'rollback-ref': `git:${head}` }, paths, log: quietLog, journal: quietJournal });
    const ev = await evidence(paths, 'css-recovery', 'evidence.md', 'fixed one selector, exit=0\n');
    await writeFile(path.join(root, 'site.css'), 'a { color: red; }\n');
    await nodeClose({ values: { node: 'css-recovery', outcome: 'pass', evidence: ev }, paths, log: quietLog, journal: quietJournal });
    const node = (await new StateStore(paths).read()).graph.nodes['css-recovery'];
    assert.equal(node.status, 'passed');
    assert.deepEqual({ files: node.change.files, over: node.change.over_budget }, { files: 1, over: false });
    assert.equal(Object.keys(node.anchor.untracked).length, 4);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a changed pre-existing untracked file still counts', async () => {
  const { root, paths, head } = await runFixture(GUARDED, { git: true });
  try {
    await writeFile(path.join(root, 'draft.html'), '<p>draft</p>\n');
    await nodeOpen({ values: { node: 'css-recovery', 'rollback-ref': `git:${head}` }, paths, log: quietLog, journal: quietJournal });
    const ev = await evidence(paths, 'css-recovery', 'evidence.md', 'edited the draft, exit=0\n');
    await writeFile(path.join(root, 'draft.html'), '<p>changed</p>\n');
    await nodeClose({ values: { node: 'css-recovery', outcome: 'pass', evidence: ev }, paths, log: quietLog, journal: quietJournal });
    const node = (await new StateStore(paths).read()).graph.nodes['css-recovery'];
    assert.equal(node.change.files, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('measurement nodes may recalibrate config but never touch sealed evidence', () => {
  const before = { 'config/thresholds.yml': `sha256:${'1'.repeat(64)}`, 'baseline/A-original/LOCK.json': `sha256:${'2'.repeat(64)}`,
    'manifests/url-manifest.json': `sha256:${'3'.repeat(64)}` };
  const after = { ...before, 'config/thresholds.yml': `sha256:${'4'.repeat(64)}` };
  assert.deepEqual(forbiddenMeasurementChanges(before, after, { measurementNode: true }), []);
  assert.deepEqual(forbiddenMeasurementChanges(before, after), ['config/thresholds.yml']);
  const sealed = { ...after, 'baseline/A-original/LOCK.json': 'absent', 'manifests/url-manifest.json': `sha256:${'5'.repeat(64)}` };
  assert.deepEqual(forbiddenMeasurementChanges(before, sealed, { measurementNode: true }),
    ['baseline/A-original/LOCK.json', 'manifests/url-manifest.json']);
});

test('a stateful node gets its own recorded snapshot immediately before opening', async () => {
  const { root, paths } = await runFixture(GUARDED);
  try {
    const taken = [];
    const runner = async (name) => { taken.push(name); };
    const result = await snapshotCreate({ values: { node: 'judge' }, paths, log: quietLog, journal: quietJournal, runner });
    // Run-unique: a project keeps snapshots across runs, and DDEV keeps an existing name while exiting 0.
    assert.equal(result.snapshot, '2026-09-27-runner-node-judge-a1');
    assert.deepEqual(taken, ['2026-09-27-runner-node-judge-a1']);
    assert.ok((await new StateStore(paths).read()).snapshots.includes('2026-09-27-runner-node-judge-a1'));
    await assert.rejects(snapshotCreate({ values: { node: 'done' }, paths, log: quietLog, journal: quietJournal, runner }), /Snapshot immediately before/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the graph report measures node minutes from the journal and proposes plan estimates', () => {
  const definition = parseYaml(GUARDED);
  const nodes = Object.fromEntries(Object.keys(definition.nodes).map((id) => [id, {
    status: 'pending', attempts: 0, active_since: null, completed_at: null, outcome: null, evidence: null, evidence_loop: null, history: [] }]));
  nodes.judge = { ...nodes.judge, status: 'passed', attempts: 2 };
  nodes['css-recovery'] = { ...nodes['css-recovery'], status: 'running', attempts: 1, active_since: '2026-09-27T09:00:00.000Z' };
  const state = { run_id: 'r', runtime: {}, graph: { definition_hash: 'sha256:x', nodes,
    edges: Object.fromEntries(definition.edges.map((e) => [e.id, { traversals: 0, last_at: null }])), locks: {} } };
  const events = [
    { ts: '2026-09-27T08:00:00.000Z', event: 'graph', action: 'init' },
    { ts: '2026-09-27T08:00:00.000Z', event: 'node', action: 'open', node_id: 'judge' },
    { ts: '2026-09-27T08:10:00.000Z', event: 'node', action: 'close', node_id: 'judge', outcome: 'pass' },
    { ts: '2026-09-27T08:20:00.000Z', event: 'node', action: 'open', node_id: 'judge' },
    { ts: '2026-09-27T08:50:00.000Z', event: 'node', action: 'close', node_id: 'judge', outcome: 'pass' },
    { ts: '2026-09-27T09:00:00.000Z', event: 'node', action: 'open', node_id: 'css-recovery' },
  ];
  const report = buildGraphReport(definition, state, events, { now: Date.parse('2026-09-27T09:15:00.000Z') });
  const judge = report.nodes.find((n) => n.id === 'judge');
  assert.equal(judge.minutes, 40);
  assert.deepEqual(judge.runs.map((r) => r.minutes), [10, 30]);
  assert.equal(report.nodes.find((n) => n.id === 'css-recovery').running_minutes, 15);
  assert.deepEqual(report.measured_plan_nodes.judge, { minutes: 20, source: 'graph-report r: mean of 2 measured attempt(s)' });
  assert.equal(report.graph.elapsed_minutes, 60);
});
