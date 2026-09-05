import test from 'node:test';
import assert from 'node:assert/strict';
import { forecastGraph } from '../../lib/run/forecast.mjs';
import { runtimeWindow } from '../../lib/run/runtime.mjs';

const now = Date.parse('2026-09-05T00:00:00Z');
function fixture(profile = 'small') {
  const window = runtimeWindow(new Date(now).toISOString(), profile);
  const definition = { start: ['a'], nodes: { a: { skill: 'intake', phase: 'P00' },
    b: { skill: 'migration', phase: 'P08', mutation: 'code', resources: ['composer'] },
    c: { skill: 'migration', phase: 'P09', mutation: 'code', resources: ['composer'] },
    'closure-join': { phase: 'P13', requires: ['b', 'c'] } }, edges: [
    { from: 'a', outcome: 'pass', to: ['b', 'c'] },
    { from: 'b', outcome: 'pass', to: 'closure-join' }, { from: 'c', outcome: 'pass', to: 'closure-join' },
  ] };
  const state = { run_id: 'test', approvals: ['APR-001'], runtime: { size_profile: profile,
    deadline_at: window.deadlineAt, migration_cutoff_at: window.migrationCutoffAt, closure_reserve_hours: window.closureReserveHours },
    graph: { definition_hash: 'hash', nodes: Object.fromEntries(Object.keys(definition.nodes).map(id => [id, { status: 'pending' }])) } };
  const plan = { schema: 'typo3-upgrade-run/runtime-plan@1', run_id: 'test', graph_hash: 'hash', max_workers: 2,
    parallel_approval: 'APR-001', final_passes: 2, lighthouse_runs_per_url: 3, buffer_minutes: 30,
    nodes: { a: { minutes: 10, source: 'pilot.txt' }, b: { minutes: 60, source: 'pilot.txt' }, c: { minutes: 60, source: 'pilot.txt' } } };
  return { definition, state, plan };
}
const forecast = f => forecastGraph(f.definition, f.state, f.plan, now);
test('shared Composer and workspace writes are serialized even with parallel workers', () => {
  const result = forecast(fixture()); assert.equal(result.estimated_minutes, 130); assert.equal(result.feasible, true);
});
test('independent read-only jobs can share the worker pool', () => {
  const f = fixture(); for (const id of ['b', 'c']) { delete f.definition.nodes[id].mutation; f.definition.nodes[id].resources = []; }
  assert.equal(forecast(f).estimated_minutes, 70);
});
test('the same workload can fit a huge profile but not a small profile', () => {
  for (const profile of ['small', 'large', 'huge']) { const f = fixture(profile);
    f.plan.nodes.b.minutes = 200; f.plan.nodes.c.minutes = 200;
    assert.equal(forecast(f).feasible, profile !== 'small'); }
});
test('measured multi-day work fits only a sufficiently large profile, never more than two days', () => {
  for (const profile of ['small', 'large', 'huge']) {
    const f = fixture(profile); f.plan.nodes.b.minutes = 900; f.plan.nodes.c.minutes = 900;
    assert.equal(forecast(f).feasible, profile === 'huge');
  }
  const f = fixture('huge'); f.plan.nodes.b.minutes = 1500; f.plan.nodes.c.minutes = 1500;
  assert.equal(forecast(f).feasible, false);
});
test('missing pilot estimates, unapproved workers and shortened final proof fail admission', () => {
  for (const mutate of [f => delete f.plan.nodes.b, f => f.plan.final_passes = 1,
    f => f.plan.lighthouse_runs_per_url = 1, f => f.plan.parallel_approval = 'unknown',
    f => f.plan.buffer_minutes = 0, f => f.plan.graph_hash = 'different']) {
    const f = fixture(); mutate(f); assert.throws(() => forecast(f));
  }
});
test('completed nodes are not billed or repeated in a resumed forecast', () => {
  const f = fixture(); f.state.graph.nodes.b = { status: 'passed', outcome: 'pass' };
  delete f.plan.nodes.b; assert.equal(forecast(f).estimated_minutes, 70);
});

test('finished migration can use its remaining closure reserve after the migration cutoff', () => {
  const f = fixture();
  for (const id of ['a', 'b', 'c']) f.state.graph.nodes[id] = { status: 'passed', outcome: 'pass' };
  f.definition.nodes['closure-join'].skill = 'closure';
  f.plan.nodes['closure-join'] = { minutes: 30, source: 'pilot.txt' };
  const result = forecastGraph(f.definition, f.state, f.plan, now + 7 * 3600000);
  assert.equal(result.feasible, true);
  assert.equal(result.reserved_minutes, 60);
  assert.equal(result.migration_finish_at, null);
});
