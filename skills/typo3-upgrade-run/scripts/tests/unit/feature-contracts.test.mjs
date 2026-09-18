import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FEATURE_CHECKS, featurePlanIssues, featureCoverageIssues } from '../../lib/run/feature-contracts.mjs';
import { readFeaturePlan, sealedFeaturePlan } from '../../lib/actions/closure.mjs';
import { graphInit, nodeOpen, nodeClose, validateGraphDefinition } from '../../lib/actions/graph.mjs';
import { RunPaths, sha256 } from '../../lib/run/paths.mjs';
import { emptyState, StateStore } from '../../lib/run/state.mjs';

const digest = value => `sha256:${sha256(value)}`;
const inventory = 'Inspected installed features and representative local fixtures.';
function fixture() {
  const plan = { schema: 'typo3-upgrade-run/feature-contracts@1', runId: 'fleet-test',
    features: Object.entries(FEATURE_CHECKS).map(([id, checks]) => ({ id,
      applicable: ['mail', 'backend', 'routes'].includes(id),
      evidence: { path: 'inventory.md', sha256: digest(inventory) },
      journeys: ['mail', 'backend', 'routes'].includes(id) ? [{ id: `${id}-roundtrip`, check: checks[0],
        targets: ['local-fixture'], assertions: ['success', 'failure'] }] : [],
    })) };
  const journeys = plan.features.flatMap(f => f.journeys);
  const manifest = { runId: plan.runId, checks: [...new Set(journeys.map(j => j.check))].map(id => ({ id,
    epoch: 'proof-epoch', status: 'pass', exitCode: 0,
    artifacts: [{ path: `${id}.json`, sha256: digest(id) }],
  })) };
  const coverage = { featureResults: journeys.map(j => ({ id: j.id, check: j.check, epoch: 'proof-epoch',
    assertions: j.assertions.map(id => ({ id, status: 'pass' })),
    artifacts: manifest.checks.find(c => c.id === j.check).artifacts,
  })) };
  return { plan, manifest, coverage };
}

test('only present features produce journeys; absent features do not multiply browser work', () => {
  const f = fixture();
  assert.deepEqual(featurePlanIssues(f.plan, 'fleet-test'), []);
  assert.equal(f.coverage.featureResults.length, 3);
  assert.deepEqual(featureCoverageIssues(f.plan, f.coverage, f.manifest), []);
});
test('unknown applicability, missing features and wrong run refuse intake', () => {
  for (const change of [p => p.features.pop(), p => p.features[0].applicable = null,
    p => p.runId = 'other', p => p.features[0].evidence.sha256 = 'unverified',
    p => p.features[0].journeys = [], p => p.features.push(p.features[0]),
    p => p.features.find(f => f.id === 'backend').applicable = false]) {
    const { plan } = fixture(); change(plan); assert.ok(featurePlanIssues(plan, 'fleet-test').length);
  }
});
test('plan cannot hide mandatory assertions in an empty, duplicate or misrouted journey', () => {
  for (const change of [j => j.assertions = [], j => j.assertions = ['same', 'same'],
    j => j.check = 'lighthouse', j => j.targets = [], j => j.id = '']) {
    const { plan } = fixture(); change(plan.features[0].journeys[0]);
    assert.ok(featurePlanIssues(plan, 'fleet-test').length);
  }
});
test('a green top-level interactions total cannot hide missing customer-mail assertions', () => {
  const f = fixture(); f.coverage.featureResults[0].assertions.pop();
  assert.ok(featureCoverageIssues(f.plan, f.coverage, f.manifest).some(x => /assertion/.test(x)));
});
for (const status of ['failed', 'skipped', 'pending', 'mocked']) test(`${status} is not a passed journey assertion`, () => {
  const f = fixture(); f.coverage.featureResults[0].assertions[0].status = status;
  assert.ok(featureCoverageIssues(f.plan, f.coverage, f.manifest).length);
});
test('duplicate, stale, unplanned and unbound evidence cannot satisfy feature coverage', () => {
  for (const change of [c => c.featureResults.pop(), c => c.featureResults.push(c.featureResults[0]),
    c => c.featureResults[0].epoch = 'old', c => c.featureResults[0].id = 'not-planned',
    c => c.featureResults[0].artifacts = [],
    c => c.featureResults[0].artifacts = [{ path: 'made-up.json', sha256: digest('fake') }]]) {
    const f = fixture(); change(f.coverage);
    assert.ok(featureCoverageIssues(f.plan, f.coverage, f.manifest).length);
  }
});
test('malformed feature evidence produces issues instead of crashing', () => {
  for (const value of [null, [], 7, { features: [null] }]) assert.ok(featurePlanIssues(value, 'fleet-test').length);
  for (const value of [null, {}, { featureResults: [null] }, { featureResults: 'pass' }]) {
    const f = fixture(); assert.ok(featureCoverageIssues(f.plan, value, f.manifest).length);
  }
  for (const change of [m => m.checks = {}, m => m.checks = [null], m => m.checks[0].artifacts = 'pass']) {
    const f = fixture(); change(f.manifest);
    assert.ok(featureCoverageIssues(f.plan, f.coverage, f.manifest).length);
  }
});

test('intake seals real inventory and closure rejects an edited or missing plan; legacy graph stays legacy', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 't3u-features-'));
  try {
    const paths = new RunPaths('.typo3-update', root);
    await mkdir(paths.configDir, { recursive: true });
    const { plan } = fixture(); plan.runId = '2026-09-16-fleet-test';
    const bytes = JSON.stringify(plan);
    await writeFile(path.join(paths.root, 'inventory.md'), inventory);
    await writeFile(path.join(paths.root, 'plan.json'), bytes);
    const definition = { schema: 'typo3-upgrade-run/graph@1',
      policy: { require_artifacts: true, require_feature_contracts: true }, resources: [],
      start: ['intake-join'], terminal: ['intake-join'],
      nodes: { 'intake-join': { phase: 'P00', outcomes: ['pass', 'blocked'] } }, edges: [] };
    assert.deepEqual(validateGraphDefinition(definition), []);
    for (const value of ['true', 1, null]) {
      assert.ok(validateGraphDefinition({ ...definition, policy: { ...definition.policy, require_feature_contracts: value } }).length);
    }
    assert.ok(validateGraphDefinition({ ...definition, policy: { require_feature_contracts: true } }).length);
    await writeFile(paths.graphDefinition, JSON.stringify(definition));
    const store = new StateStore(paths);
    await store.write(emptyState({ runId: plan.runId, now: new Date().toISOString() }));
    const log = { success() {}, info() {}, debug() {} };
    await graphInit({ paths, values: {}, log });
    await nodeOpen({ paths, values: { node: 'intake-join' }, log });
    await assert.rejects(nodeClose({ paths, log,
      values: { node: 'intake-join', outcome: 'pass', evidence: 'inventory.md' } }));
    assert.equal((await store.read()).graph.nodes['intake-join'].status, 'running');
    await nodeClose({ paths, log, values: { node: 'intake-join', outcome: 'pass', evidence: 'plan.json' } });
    const state = await store.read();
    const sealed = await sealedFeaturePlan(paths, state);
    assert.equal(sealed.hash, digest(bytes));
    const recorded = state.graph.nodes['intake-join'];
    await assert.rejects(sealedFeaturePlan(paths, { ...state, graph: { ...state.graph,
      nodes: { 'intake-join': { ...recorded, evidence: 'missing.json' } } } }));
    await writeFile(path.join(paths.root, 'plan.json'), bytes + '\n');
    await assert.rejects(sealedFeaturePlan(paths, state), /changed/);
    await writeFile(path.join(paths.root, 'plan.json'), bytes);
    await writeFile(path.join(paths.root, 'inventory.md'), 'changed inventory');
    await assert.rejects(readFeaturePlan(paths, 'plan.json', digest(bytes), plan.runId), /inventory/);
    await writeFile(paths.graphDefinition, JSON.stringify({ ...definition, policy: { require_feature_contracts: false } }));
    await assert.rejects(sealedFeaturePlan(paths, state), /Graph definition changed/);
    delete definition.policy.require_feature_contracts;
    const legacy = JSON.stringify(definition);
    await writeFile(paths.graphDefinition, legacy); state.graph.definition_hash = digest(legacy);
    assert.equal(await sealedFeaturePlan(paths, state), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});
