import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { fileURLToPath } from 'node:url';
import {
  graphInit, graphNext, nodeClose, nodeOpen, validateGraphDefinition, validateGraphState,
  validClosureAcceptance,
} from '../../lib/actions/graph.mjs';
import { RunPaths } from '../../lib/run/paths.mjs';
import { emptyState, StateStore } from '../../lib/run/state.mjs';
import { forecastGraph } from '../../lib/run/forecast.mjs';
import { runtimeWindow } from '../../lib/run/runtime.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_GRAPH = path.resolve(HERE, '../../../templates/run-directory/config/upgrade-graph.yml');
const quietLog = { success() {}, info() {}, debug() {} };
const quietJournal = { async append() {} };

test('closure acceptance belongs to the exact observed result and follows its measurement', () => {
  const expected = { runId: 'run', approvalId: 'APR-399', evidence: 'report.json', manifestHash: 'sha256:abc', proofCompletedAt: 1000 };
  const record = { id: 'APR-399', stage: 'acceptance', granted_by: 'user', run_id: 'run',
    evidence_ref: 'report.json#sha256:abc', granted_at: new Date(1500).toISOString() };
  assert.equal(validClosureAcceptance(record, expected, 2000), true);
  for (const patch of [{ stage: 'intent' }, { granted_by: 'assistant' }, { run_id: 'other' },
    { evidence_ref: 'report.json#sha256:old' }, { granted_at: new Date(500).toISOString() },
    { granted_at: new Date(3000).toISOString() }]) {
    assert.equal(validClosureAcceptance({ ...record, ...patch }, expected, 2000), false);
  }
});

test('the shipped upgrade graph has only bounded cycles and valid routes', async () => {
  const definition = parseYaml(await readFile(DEFAULT_GRAPH, 'utf8'));
  assert.deepEqual(validateGraphDefinition(definition), []);
  assert.ok(Object.keys(definition.nodes).length >= 40);
  assert.ok(definition.edges.some((edge) => edge.retry === true));
});

test('both optional-branch extremes of the shipped graph reach forecastable final proof', async () => {
  const definition = parseYaml(await readFile(DEFAULT_GRAPH, 'utf8'));
  const now = Date.now(), window = runtimeWindow(new Date(now).toISOString(), 'huge');
  const state = { run_id: 'synthetic-routing-only', approvals: [], runtime: {
    deadline_at: window.deadlineAt, migration_cutoff_at: window.migrationCutoffAt,
    closure_reserve_hours: window.closureReserveHours }, graph: { definition_hash: 'fixture',
    nodes: Object.fromEntries(Object.keys(definition.nodes).map(id => [id, { status: 'pending' }])) } };
  for (const mode of ['pass', 'not-applicable']) {
    const plan = { schema: 'typo3-upgrade-run/runtime-plan@1', run_id: state.run_id,
      graph_hash: 'fixture', max_workers: 1, final_passes: 2, lighthouse_runs_per_url: 3, buffer_minutes: 30,
      nodes: Object.fromEntries(Object.entries(definition.nodes).map(([id, n]) => [id, {
        minutes: 1, source: 'synthetic-not-a-performance-benchmark', outcome: n.outcomes?.includes(mode) ? mode : 'pass',
      }])) };
    const result = forecastGraph(definition, state, plan, now);
    assert.ok(result.schedule.some(n => n.id === 'closure-join'));
    assert.ok(result.schedule.some(n => n.id === 'lighthouse-axe'));
    assert.ok(!result.schedule.some(n => n.id === 'contract-a-gate'));
  }
});

test('backend group topology is decided at intake and selects one guarded rights branch', async () => {
  const definition = parseYaml(await readFile(DEFAULT_GRAPH, 'utf8'));
  const decision = definition.nodes['backend-group-model-decision'];
  const single = definition.nodes['redirects-rights-single-group'];
  const preserved = definition.nodes['redirects-rights-preserved-groups'];
  const intakeJoin = definition.nodes['intake-join'];
  const migrationJoin = definition.nodes['migration-join'];

  assert.deepEqual(decision.outcomes, ['pass', 'not-applicable', 'blocked']);
  assert.ok(intakeJoin.requires.includes('backend-group-model-decision'));
  assert.ok(definition.edges.find((edge) => edge.id === 'intake-pass').to
    .includes('backend-group-model-decision'));
  assert.equal(single.approval, 'required');
  assert.equal(single.mutation, 'stateful');
  assert.deepEqual(single.requires, ['rung-14']);
  assert.equal(preserved.approval, undefined);
  assert.deepEqual(preserved.requires, ['rung-14']);
  assert.ok(definition.edges.some((edge) => edge.from === 'backend-group-model-decision'
    && edge.outcome === 'pass' && edge.to === 'redirects-rights-single-group'));
  assert.ok(definition.edges.some((edge) => edge.from === 'backend-group-model-decision'
    && edge.outcome === 'not-applicable' && edge.to === 'redirects-rights-preserved-groups'));
  assert.ok(migrationJoin.requires.includes('redirects-rights-merge'));
  assert.ok(!migrationJoin.requires.includes('redirects-rights'));
});

test('structured data preserves Contract A before an approval-gated P14 enrichment', async () => {
  const definition = parseYaml(await readFile(DEFAULT_GRAPH, 'utf8'));
  const inventory = definition.nodes['structured-data-inventory'];
  const parity = definition.nodes['structured-data-parity'];
  const enrichment = definition.nodes['structured-data-enrichment'];
  const migrationJoin = definition.nodes['migration-join'];

  assert.equal(inventory.phase, 'P00');
  assert.equal(inventory.mutation, undefined);
  assert.deepEqual(parity.requires, ['structured-data-inventory', 'rung-14']);
  assert.equal(parity.phase, 'P10');
  assert.ok(migrationJoin.requires.includes('structured-data-parity'));
  assert.equal(enrichment.phase, 'P14');
  assert.equal(enrichment.approval, 'required');
  assert.equal(enrichment.evidence_loop, 'required');
  assert.deepEqual(enrichment.requires, ['contract-a-gate']);
  assert.deepEqual(definition.edges.find((edge) => edge.id === 'contract-pass').to,
    ['structured-data-enrichment', 'webmcp-readiness']);
  assert.equal(definition.edges.find((edge) => edge.id === 'structured-enrichment-pass').to,
    'elevation-join');
});

test('native WebMCP is inventoried, preserved, then optionally added after Contract A', async () => {
  const definition = parseYaml(await readFile(DEFAULT_GRAPH, 'utf8'));
  const inventory = definition.nodes['webmcp-inventory'];
  const parity = definition.nodes['webmcp-parity'];
  const readiness = definition.nodes['webmcp-readiness'];
  const intakeJoin = definition.nodes['intake-join'];
  const migrationJoin = definition.nodes['migration-join'];
  const elevationJoin = definition.nodes['elevation-join'];

  assert.equal(inventory.phase, 'P00');
  assert.equal(inventory.mutation, undefined);
  assert.ok(intakeJoin.requires.includes('webmcp-inventory'));
  assert.deepEqual(parity.requires, ['webmcp-inventory', 'rung-14']);
  assert.equal(parity.phase, 'P10');
  assert.ok(migrationJoin.requires.includes('webmcp-parity'));
  assert.equal(readiness.phase, 'P14');
  assert.equal(readiness.mutation, 'code');
  assert.deepEqual(readiness.resources, ['browser-proof']);
  assert.equal(readiness.approval, 'required');
  assert.equal(readiness.evidence_loop, 'required');
  assert.deepEqual(readiness.requires, ['contract-a-gate']);
  assert.ok(!readiness.resources.includes('composer'));
  assert.ok(!readiness.resources.includes('ddev-stateful'));
  assert.equal(definition.edges.find((edge) => edge.id === 'webmcp-readiness-pass').to,
    'elevation-join');
  assert.deepEqual(elevationJoin.requires,
    ['structured-data-enrichment', 'webmcp-readiness']);
  assert.equal(definition.edges.find((edge) => edge.id === 'elevation-joined').to,
    'handover');
});

test('an unbounded cycle is rejected', () => {
  const definition = {
    schema: 'typo3-upgrade-run/graph@1', resources: [], start: ['a'], terminal: ['b'],
    nodes: { a: { outcomes: ['pass'] }, b: { outcomes: ['pass'] } },
    edges: [
      { id: 'a-b', from: 'a', outcome: 'pass', to: 'b' },
      { id: 'b-a', from: 'b', outcome: 'pass', to: 'a' },
    ],
  };
  assert.match(validateGraphDefinition(definition).join('\n'), /unbounded cycle/);
});

test('retry edges require a small explicit traversal bound', () => {
  const definition = {
    schema: 'typo3-upgrade-run/graph@1', resources: [], start: ['a'], terminal: ['b'],
    nodes: { a: { outcomes: ['pass'] }, b: { outcomes: ['pass'] } },
    edges: [{ id: 'retry', from: 'a', outcome: 'pass', to: 'b', retry: true }],
  };
  assert.match(validateGraphDefinition(definition).join('\n'), /max_traversals/);
});

test('graph lifecycle activates parallel intake nodes and records evidence', async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 't3u-graph-'));
  try {
    const paths = new RunPaths('.typo3-update', fixture);
    await mkdir(paths.configDir, { recursive: true });
    await writeFile(paths.graphDefinition, await readFile(DEFAULT_GRAPH, 'utf8'), 'utf8');
    const state = emptyState({ runId: '2026-08-27-fixture', now: '2026-08-27T08:00:00.000Z' });
    state.project.trusted_origin = 'https://fixture.ddev.site';
    await new StateStore(paths).write(state);

    await graphInit({ values: {}, paths, log: quietLog, journal: quietJournal });
    await nodeOpen({ values: { node: 'intake' }, paths, log: quietLog, journal: quietJournal });
    await writeFile(path.join(paths.node('intake'), 'check.md'), 'Checked project identity, exit=0\n');
    await nodeClose({ values: { node: 'intake', outcome: 'pass', evidence: 'nodes/intake/check.md' }, paths, log: quietLog, journal: quietJournal });
    const next = await graphNext({ paths, log: quietLog });

    assert.deepEqual(next.ready.map((node) => node.id).sort(), [
      'backend-group-model-decision', 'dataset-freshness', 'extension-inventory',
      'project-identity', 'structured-data-inventory', 'url-discovery', 'webmcp-inventory',
    ]);
    const opens = await Promise.allSettled([
      nodeOpen({ values: { node: 'project-identity' }, paths, log: quietLog, journal: quietJournal }),
      nodeOpen({ values: { node: 'dataset-freshness' }, paths, log: quietLog, journal: quietJournal }),
    ]);
    const opened = opens.filter((result) => result.status === 'fulfilled').length;
    const persisted = await new StateStore(paths).read();
    assert.equal(persisted.graph.nodes.intake.status, 'passed');
    assert.equal(persisted.graph.nodes.intake.evidence, 'nodes/intake/check.md');
    assert.equal(persisted.graph.edges['intake-pass'].traversals, 1);
    assert.equal(Object.values(persisted.graph.nodes).filter((node) => node.status === 'running').length, opened);
    assert.ok(opened >= 1, 'at least one concurrent transition must commit');
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test('graph-state validation catches orphaned resource locks', async () => {
  const raw = await readFile(DEFAULT_GRAPH, 'utf8');
  const definition = parseYaml(raw);
  const nodes = Object.fromEntries(Object.keys(definition.nodes).map((id) => [id, {
    status: id === 'intake' ? 'ready' : 'pending', attempts: 0,
    active_since: null, completed_at: null, outcome: null, evidence: null, evidence_loop: null, history: [],
  }]));
  const graph = {
    definition_hash: `sha256:${(await import('node:crypto')).createHash('sha256').update(raw).digest('hex')}`,
    nodes,
    edges: Object.fromEntries(definition.edges.map((edge) => [edge.id, { traversals: 0, last_at: null }])),
    locks: { composer: 'intake' },
  };
  assert.match(validateGraphState(graph, definition, graph.definition_hash).join('\n'), /non-running node/);
});

test('optional applicability checks neither demand mutation approval nor permit a pass', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 't3u-applicability-'));
  try {
    const paths = new RunPaths('.typo3-update', root);
    await mkdir(paths.configDir, { recursive: true });
    const definition = { schema: 'typo3-upgrade-run/graph@1', resources: [], start: ['optional'], terminal: ['optional'],
      nodes: { optional: { phase: 'P00', mutation: 'stateful', approval: 'required', outcomes: ['pass', 'not-applicable', 'blocked'] } }, edges: [] };
    await writeFile(paths.graphDefinition, JSON.stringify(definition));
    await new StateStore(paths).write(emptyState({ runId: '2026-09-05-test', now: new Date().toISOString() }));
    await graphInit({ values: {}, paths, log: quietLog });
    await assert.rejects(nodeOpen({ values: { node: 'optional' }, paths, log: quietLog }), /snapshot/);
    await nodeOpen({ values: { node: 'optional', 'applicability-only': true }, paths, log: quietLog });
    await assert.rejects(nodeClose({ values: { node: 'optional', outcome: 'pass', evidence: 'reason.md' }, paths, log: quietLog }), /read-only applicability/);
    await nodeClose({ values: { node: 'optional', outcome: 'not-applicable', evidence: 'reason.md' }, paths, log: quietLog });
    const state = await new StateStore(paths).read();
    assert.equal(state.graph.nodes.optional.status, 'skipped');
    assert.equal(state.graph.nodes.optional.history[0].applicability_only, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a green label cannot close Contract A with missing evidence', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 't3u-missing-closure-'));
  try {
    const paths = new RunPaths('.typo3-update', root);
    await mkdir(paths.configDir, { recursive: true });
    await writeFile(paths.graphDefinition, JSON.stringify({ schema: 'typo3-upgrade-run/graph@1', resources: [], start: ['contract-a-gate'], terminal: ['contract-a-gate'],
      nodes: { 'contract-a-gate': { phase: 'P00', outcomes: ['pass', 'blocked'] } }, edges: [] }));
    await new StateStore(paths).write(emptyState({ runId: '2026-09-05-test', now: new Date().toISOString() }));
    await graphInit({ values: {}, paths, log: quietLog });
    await nodeOpen({ values: { node: 'contract-a-gate' }, paths, log: quietLog });
    await assert.rejects(nodeClose({ values: { node: 'contract-a-gate', outcome: 'pass', evidence: 'missing.json' }, paths, log: quietLog }), /Missing/);
    const state = await new StateStore(paths).read();
    assert.equal(state.contract_a.status, 'open');
    assert.equal(state.contract_b.unlocked, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
