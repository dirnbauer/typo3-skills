import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { graphForecast, graphInit, graphNext, graphStatus, nodeOpen, nodeClose, validateGraphDefinition, validateGraphState } from '../../lib/actions/graph.mjs';
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
