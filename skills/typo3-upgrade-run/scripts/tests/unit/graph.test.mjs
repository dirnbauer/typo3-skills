import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { fileURLToPath } from 'node:url';
import {
  graphInit, graphNext, nodeClose, nodeOpen, validateGraphDefinition, validateGraphState,
} from '../../lib/actions/graph.mjs';
import { RunPaths } from '../../lib/run/paths.mjs';
import { emptyState, StateStore } from '../../lib/run/state.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_GRAPH = path.resolve(HERE, '../../../templates/run-directory/config/upgrade-graph.yml');
const quietLog = { success() {}, info() {}, debug() {} };
const quietJournal = { async append() {} };

test('the shipped upgrade graph has only bounded cycles and valid routes', async () => {
  const definition = parseYaml(await readFile(DEFAULT_GRAPH, 'utf8'));
  assert.deepEqual(validateGraphDefinition(definition), []);
  assert.ok(Object.keys(definition.nodes).length >= 40);
  assert.ok(definition.edges.some((edge) => edge.retry === true));
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
