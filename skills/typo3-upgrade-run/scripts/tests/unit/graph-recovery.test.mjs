import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { graphForecast, graphInit, graphNext, graphStatus, nodeOpen, nodeClose, refreshReady, validateGraphDefinition, validateGraphState } from '../../lib/actions/graph.mjs';
import { RunPaths } from '../../lib/run/paths.mjs';
import { emptyState, StateStore } from '../../lib/run/state.mjs';
import { runtimeWindow } from '../../lib/run/runtime.mjs';

const log = { success() {}, info() {}, debug() {} };
async function scenario(definition, run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 't3u-recovery-'));
  try {
    const paths = new RunPaths('.typo3-update', root);
    await mkdir(paths.configDir, { recursive: true });
    await writeFile(paths.graphDefinition, JSON.stringify({ schema: 'typo3-upgrade-run/graph@1', resources: [], ...definition }));
    await writeFile(path.join(paths.root, 'proof.txt'), 'actual command output\nexit=0\n');
    await new StateStore(paths).write(emptyState({ runId: '2026-09-05-regression', now: new Date().toISOString() }));
    await graphInit({ paths, values: {}, log });
    const open = node => nodeOpen({ paths, values: { node }, log });
    const close = (node, outcome) => nodeClose({ paths, values: { node, outcome, evidence: 'proof.txt' }, log });
    await run({ paths, open, close });
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('the second failed attempt can revisit its completed recovery node', async () => {
  await scenario({ start: ['check'], terminal: ['done'], nodes: {
    check: { outcomes: ['pass', 'findings'] }, repair: { outcomes: ['pass'] }, done: { outcomes: ['pass'] },
  }, edges: [
    { id: 'found', from: 'check', outcome: 'findings', to: 'repair' },
    { id: 'retry', from: 'repair', outcome: 'pass', to: 'check', retry: true, max_traversals: 2 },
    { id: 'done', from: 'check', outcome: 'pass', to: 'done' },
  ] }, async ({ paths, open, close }) => {
    for (let n = 0; n < 2; n++) {
      await open('check'); await close('check', 'findings');
      await open('repair'); await close('repair', 'pass');
    }
    await open('check'); await close('check', 'pass');
    const state = await new StateStore(paths).read();
    assert.equal(state.graph.nodes.repair.attempts, 2);
    assert.equal(state.graph.nodes.check.attempts, 3);
    assert.equal(state.graph.nodes.done.status, 'ready');
  });
});

test('next work excludes resources held by a running node', async () => {
  await scenario({ resources: ['browser'], start: ['a', 'b'], terminal: ['a', 'b'], nodes: {
    a: { resources: ['browser'], outcomes: ['pass'] }, b: { resources: ['browser'], outcomes: ['pass'] },
  }, edges: [] }, async ({ paths, open }) => {
    await open('a'); const next = await graphNext({ paths, log });
    assert.deepEqual(next.ready, []);
    assert.equal(next.waiting[0].id, 'b');
    assert.match(next.waiting[0].reason, /browser.*a/);
  });
});

test('a passed independent terminal cannot hide a blocked terminal', async () => {
  await scenario({ start: ['migration', 'inspection'], terminal: ['migration', 'inspection'], nodes: {
    migration: { outcomes: ['pass', 'blocked'] }, inspection: { outcomes: ['pass'] },
  }, edges: [] }, async ({ paths, open, close }) => {
    await open('migration'); await close('migration', 'blocked');
    await open('inspection'); await close('inspection', 'pass');
    assert.equal((await new StateStore(paths).read()).graph.status, 'blocked');
    assert.equal((await graphStatus({ paths, values: { json: true }, log })).status, 'blocked');
  });
});

test('completion waits for all activated jobs but not unselected terminal alternatives', async () => {
  await scenario({ start: ['a', 'b'], terminal: ['a', 'b', 'alternative'], nodes: {
    a: { outcomes: ['pass'] }, b: { outcomes: ['pass'] }, alternative: { outcomes: ['pass'] },
  }, edges: [] }, async ({ paths, open, close }) => {
    await open('a'); await close('a', 'pass');
    assert.equal((await new StateStore(paths).read()).graph.status, 'active');
    await open('b'); await close('b', 'pass');
    assert.equal((await new StateStore(paths).read()).graph.status, 'complete');
  });
});

test('a stored false-complete label is detected and graph-next reconciles its derived status', async () => {
  await scenario({ start: ['a'], terminal: ['a'], nodes: { a: { outcomes: ['pass', 'blocked'] } }, edges: [] },
    async ({ paths, open, close }) => {
      await open('a'); await close('a', 'blocked');
      const store = new StateStore(paths); await store.update(s => { s.graph.status = 'complete'; });
      const state = await store.read(); const definition = JSON.parse(await readFile(paths.graphDefinition, 'utf8'));
      assert.ok(validateGraphState(state.graph, definition, state.graph.definition_hash, state).some(x => /complete/.test(x)));
      assert.equal((await graphStatus({ paths, values: { json: true }, log })).status, 'blocked');
      await graphNext({ paths, log }); assert.equal((await store.read()).graph.status, 'blocked');
    });
});

test('prerequisite deadlocks and impossible outcome edges are rejected', () => {
  const graph = { schema: 'typo3-upgrade-run/graph@1', resources: [], start: ['a'], terminal: ['b'],
    nodes: { a: { requires: ['b'], outcomes: ['pass'] }, b: { requires: ['a'], outcomes: ['pass'] } },
    edges: [{ id: 'a-b', from: 'a', outcome: 'invented', to: 'b' }] };
  const issues = validateGraphDefinition(graph).join('\n');
  assert.match(issues, /prerequisite.*cycle/);
  assert.match(issues, /undeclared outcome/);
});

test('running nodes must own all their declared locks', () => {
  const definition = { schema: 'typo3-upgrade-run/graph@1', resources: ['composer'], start: ['a'], terminal: ['a'],
    nodes: { a: { resources: ['composer'], outcomes: ['pass'] } }, edges: [] };
  const graph = { definition_hash: 'hash', nodes: { a: { status: 'running', attempts: 1 } }, edges: {}, locks: {} };
  assert.match(validateGraphState(graph, definition, 'hash').join('\n'), /running node.*lock/);
});

test('an artifact-required graph refuses a nonexistent evidence path', async () => {
  await scenario({ policy: { require_artifacts: true }, start: ['a'], terminal: ['a'], nodes: { a: { outcomes: ['pass'] } }, edges: [] },
    async ({ paths, open }) => {
      await open('a');
      await assert.rejects(nodeClose({ paths, values: { node: 'a', outcome: 'pass', evidence: 'missing.txt' }, log }), /Missing/);
      assert.equal((await new StateStore(paths).read()).graph.nodes.a.status, 'running');
    });
});

const retryGraph = { start: ['check'], terminal: ['done'], nodes: {
  check: { outcomes: ['pass', 'findings'] }, repair: { outcomes: ['pass'] }, done: { outcomes: ['pass'] },
}, edges: [
  { id: 'found', from: 'check', outcome: 'findings', to: 'repair' },
  { id: 'retry', from: 'repair', outcome: 'pass', to: 'check', retry: true, max_traversals: 3 },
  { id: 'done', from: 'check', outcome: 'pass', to: 'done' },
] };
test('shared retry limits stop recovery before the individual edge limit', async () => {
  await scenario({ ...retryGraph, policy: { max_total_retries: 1 } }, async ({ paths, open, close }) => {
    await open('check'); await close('check', 'findings'); await open('repair'); await close('repair', 'pass');
    await open('check'); await close('check', 'findings');
    await assert.rejects(open('repair'), /remaining recovery budget/);
    const next = await graphNext({ paths, log });
    assert.deepEqual(next.ready, []);
    assert.match(next.waiting[0].reason, /recovery budget/);
    assert.equal((await new StateStore(paths).read()).graph.edges.retry.traversals, 1);
    assert.equal((await new StateStore(paths).read()).graph.nodes.repair.attempts, 1);
    assert.equal((await new StateStore(paths).read()).graph.status, 'blocked');
  });
});
test('node attempts are capped independently of available recovery edges', async () => {
  await scenario({ ...retryGraph, policy: { max_node_attempts: 2 } }, async ({ open, close }) => {
    for (let n = 0; n < 2; n++) {
      await open('check'); await close('check', 'findings'); await open('repair'); await close('repair', 'pass');
    }
    await assert.rejects(open('check'), /shared attempt budget/);
  });
});

test('an exhausted recovery route does not block an available successful terminal outcome', async () => {
  await scenario({ start: ['check'], terminal: ['check'], policy: { max_total_retries: 1 },
    nodes: { check: { outcomes: ['pass', 'repair'] } },
    edges: [{ id: 'again', from: 'check', outcome: 'repair', to: 'check', retry: true, max_traversals: 1 }] },
    async ({ paths, open, close }) => {
      await open('check'); await close('check', 'repair');
      assert.deepEqual((await graphNext({ paths, log })).ready.map(n => n.id), ['check']);
      await open('check'); await close('check', 'pass');
      assert.equal((await new StateStore(paths).read()).graph.status, 'complete');
    });
});
test('final measurement locks out workspace mutations even on unrelated resources', async () => {
  await scenario({ resources: ['project-write'], policy: { serialize_mutations: true }, start: ['proof', 'change'], terminal: ['proof', 'change'],
    nodes: { proof: { freeze: true, outcomes: ['pass'] }, change: { mutation: 'code', outcomes: ['pass'] } }, edges: [] },
  async ({ paths, open }) => {
    await open('proof');
    const next = await graphNext({ paths, log });
    assert.deepEqual(next.ready, []);
    assert.match(next.waiting[0].reason, /project-write held by proof/);
    await assert.rejects(nodeOpen({ paths, values: { node: 'change', 'rollback-ref': 'saved-commit' }, log }), /locked by proof/);
  });
});
test('forecast admission binds the measured plan and source bytes, not just its green label', async () => {
  await scenario({ policy: { require_forecast: true }, start: ['baseline'], terminal: ['closure-join'], nodes: {
    baseline: { skill: 'baseline', phase: 'P02', outcomes: ['pass'] },
    'closure-join': { skill: 'closure', phase: 'P13', outcomes: ['pass'] },
  }, edges: [{ id: 'done', from: 'baseline', outcome: 'pass', to: 'closure-join' }] }, async ({ paths, open }) => {
    const store = new StateStore(paths), now = new Date().toISOString(), window = runtimeWindow(now, 'small');
    const state = await store.update(s => {
      Object.assign(s.runtime, { started_at: now, sealed_at: now, size_profile: 'small', size_evidence_ref: 'proof.txt',
        deadline_at: window.deadlineAt, migration_cutoff_at: window.migrationCutoffAt,
        max_hours: window.maxHours, closure_reserve_hours: window.closureReserveHours });
    });
    await assert.rejects(open('baseline'), /graph-forecast/);
    const plan = { schema: 'typo3-upgrade-run/runtime-plan@1', run_id: state.run_id, graph_hash: state.graph.definition_hash,
      max_workers: 1, final_passes: 2, lighthouse_runs_per_url: 3, buffer_minutes: 30,
      nodes: { baseline: { minutes: 10, source: 'missing.txt' }, 'closure-join': { minutes: 20, source: 'proof.txt' } } };
    const savePlan = () => writeFile(path.join(paths.root, 'plan.json'), JSON.stringify(plan));
    await savePlan();
    await assert.rejects(graphForecast({ paths, values: { evidence: 'plan.json' }, log }), /Missing/);
    plan.nodes.baseline.source = 'proof.txt'; await savePlan();
    const result = await graphForecast({ paths, values: { evidence: 'plan.json' }, log });
    assert.equal(result.feasible, true);
    assert.equal(JSON.parse(await readFile(path.join(paths.root, result.evidence))).source_hashes['proof.txt'].length, 71);
    await writeFile(path.join(paths.root, 'proof.txt'), 'pilot changed');
    await assert.rejects(open('baseline'), /forecast.*source|source.*forecast/i);
  });
});

test('shared frozen proofs really open together, release independently, and exclude writers and Lighthouse', async () => {
  const definition = { resources: ['project-write', 'machine-load'],
    policy: { serialize_mutations: true, shared_proof_reads: true },
    start: ['http', 'axe', 'change', 'lighthouse'], terminal: ['http', 'axe', 'change', 'lighthouse'],
    nodes: { http: { freeze: true, outcomes: ['pass'] }, axe: { freeze: true, outcomes: ['pass'] },
      change: { mutation: 'code', outcomes: ['pass'] }, lighthouse: { freeze: true, quiet: true, outcomes: ['pass'] } }, edges: [] };
  await scenario(definition, async ({ paths, open, close }) => {
    await open('http');
    assert.deepEqual((await graphNext({ paths, log })).ready.map(n => n.id), ['axe']);
    await open('axe');
    const store = new StateStore(paths);
    let state = await store.read();
    assert.deepEqual(state.graph.locks['project-write'], { readers: ['axe', 'http'] });
    assert.deepEqual(validateGraphState(state.graph, { schema: 'typo3-upgrade-run/graph@1', ...definition }, state.graph.definition_hash), []);
    await close('http', 'pass');
    assert.deepEqual((await store.read()).graph.locks['project-write'], { readers: ['axe'] });
    await assert.rejects(nodeOpen({ paths, values: { node: 'change', 'rollback-ref': 'commit' }, log }), /locked by axe/);
    await assert.rejects(open('lighthouse'), /locked by axe/);
    await close('axe', 'pass');
    await open('lighthouse');
    assert.deepEqual((await graphNext({ paths, log })).ready, []);
    await close('lighthouse', 'pass');
    await nodeOpen({ paths, values: { node: 'change', 'rollback-ref': 'commit' }, log });
  });
});

test('orphaned shared readers and shared locks falsely held by writers are invalid', () => {
  const definition = { schema: 'typo3-upgrade-run/graph@1', resources: ['project-write', 'machine-load'],
    policy: { serialize_mutations: true, shared_proof_reads: true }, start: ['a'], terminal: ['a'],
    nodes: { a: { mutation: 'code', outcomes: ['pass'] } }, edges: [] };
  const graph = { definition_hash: 'hash', nodes: { a: { status: 'running', attempts: 1 } }, edges: {},
    locks: { 'project-write': { readers: ['a', 'ghost'] }, 'machine-load': { readers: ['a'] } } };
  const issues = validateGraphState(graph, definition, 'hash').join('\n');
  assert.match(issues, /exclusive lock project-write/);
  assert.match(issues, /non-running node ghost/);
});

// The ombudsstelle deadlock: a re-run edge reaches lighthouse while axe is not passed yet.
const DEFERRED = { start: ['epoch'], terminal: ['join'], nodes: {
  epoch: { outcomes: ['pass'] }, axe: { outcomes: ['pass', 'findings'] },
  light: { requires: ['axe'], outcomes: ['pass', 'findings'] }, repair: { outcomes: ['pass'] },
  join: { requires: ['axe', 'light'], outcomes: ['pass'] },
}, edges: [
  { id: 'epoch-pass', from: 'epoch', outcome: 'pass', to: ['axe', 'light'] },
  { id: 'axe-pass', from: 'axe', outcome: 'pass', to: 'join' },
  { id: 'axe-findings', from: 'axe', outcome: 'findings', to: 'repair' },
  { id: 'light-pass', from: 'light', outcome: 'pass', to: 'join' },
  { id: 'light-findings', from: 'light', outcome: 'findings', to: 'repair' },
  { id: 'retry', from: 'repair', outcome: 'pass', to: ['axe', 'light'], retry: true, max_traversals: 2 },
] };
const tick = () => new Promise(resolve => setTimeout(resolve, 5));

test('an arrival that came while requirements were unmet makes the failed node ready once they pass', async () => {
  await scenario(DEFERRED, async ({ paths, open, close }) => {
    await open('epoch'); await close('epoch', 'pass');
    await open('axe'); await close('axe', 'pass');
    await open('light'); await close('light', 'findings');
    await tick();
    await open('repair'); await close('repair', 'pass'); // reaches light while axe is ready again
    let state = await new StateStore(paths).read();
    assert.equal(state.graph.nodes.light.status, 'pending');
    assert.equal(state.graph.nodes.light.outcome, null);
    assert.equal(state.graph.nodes.light.history.at(-1).outcome, 'findings');
    assert.deepEqual((await graphNext({ paths, log })).ready.map(n => n.id), ['axe']);
    await open('axe'); await close('axe', 'pass');
    const next = await graphNext({ paths, log });
    assert.deepEqual(next.ready.map(n => n.id), ['light']);
    state = await new StateStore(paths).read();
    assert.equal(state.graph.edges.retry.traversals, 1, 'reactivation spends no traversal');
    assert.equal(state.graph.nodes.light.attempts, 1);
    assert.deepEqual(validateGraphState(state.graph, JSON.parse(await readFile(paths.graphDefinition, 'utf8')), state.graph.definition_hash), []);
    await open('light'); await close('light', 'pass');
    await open('join'); await close('join', 'pass');
    assert.equal((await new StateStore(paths).read()).graph.status, 'complete');
  });
});

function deferredGraph({ light, lightCompleted, lastAt }) {
  const edges = Object.fromEntries(DEFERRED.edges.map(e => [e.id, { traversals: 0, last_at: null }]));
  edges['epoch-pass'] = { traversals: 1, last_at: '2026-10-11T19:00:00.000Z' };
  edges.retry = { traversals: 1, last_at: lastAt };
  const node = (status, completed_at = null) => ({ status, attempts: 1, active_since: null, completed_at,
    outcome: status === 'pending' ? null : 'x', evidence: null, evidence_loop: null, history: [] });
  return { nodes: { epoch: node('passed', '2026-10-11T19:00:00.000Z'), axe: node('passed', '2026-10-11T19:30:00.000Z'),
    light: node(light, lightCompleted), repair: node('passed', lastAt), join: node('pending') }, edges, locks: {} };
}

test('a finished node without a later arrival is not reactivated', () => {
  for (const status of ['failed', 'blocked', 'invalid']) {
    const graph = deferredGraph({ light: status, lightCompleted: '2026-10-11T20:00:00.000Z', lastAt: '2026-10-11T19:50:00.000Z' });
    refreshReady(graph, DEFERRED);
    assert.equal(graph.nodes.light.status, status);
    assert.equal(graph.nodes.light.completed_at, '2026-10-11T20:00:00.000Z');
  }
  const later = deferredGraph({ light: 'failed', lightCompleted: '2026-10-11T19:48:41.684Z', lastAt: '2026-10-11T20:42:18.796Z' });
  refreshReady(later, DEFERRED);
  assert.equal(later.nodes.light.status, 'ready');
});

test('history never reactivates passed or skipped work', () => {
  for (const status of ['passed', 'skipped']) {
    const graph = deferredGraph({ light: status, lightCompleted: '2026-10-11T19:48:41.684Z', lastAt: '2026-10-11T20:42:18.796Z' });
    refreshReady(graph, DEFERRED);
    assert.equal(graph.nodes.light.status, status);
    assert.equal(graph.nodes.light.outcome, 'x');
  }
});
