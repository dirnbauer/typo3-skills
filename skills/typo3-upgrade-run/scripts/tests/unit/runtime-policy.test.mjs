import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { runtimeWindow, runtimeProfileIssues, assertPhaseRuntime, RUNTIME_PROFILES } from '../../lib/run/runtime.mjs';
import { emptyState } from '../../lib/run/state.mjs';
import { stateSchemaErrors } from '../../lib/run/schema.mjs';

const started = '2026-09-05T00:00:00.000Z';
function sealed(size, policy = 'site-size-v2') {
  const w = runtimeWindow(started, size, policy);
  return { started_at: started, size_profile: size, budget_policy: policy,
    max_hours: w.maxHours, closure_reserve_hours: w.closureReserveHours,
    deadline_at: w.deadlineAt, migration_cutoff_at: w.migrationCutoffAt };
}
test('legacy seals without a policy marker keep their original deadlines', () => {
  for (const [size, hours, reserve] of [['small', 8, 2], ['large', 12, 3], ['huge', 14, 4]]) {
    const r = sealed(size, 'overnight-v1'); delete r.budget_policy;
    assert.equal(r.max_hours, hours); assert.equal(r.closure_reserve_hours, reserve);
    assert.deepEqual(runtimeProfileIssues(r), []);
    assert.throws(() => assertPhaseRuntime(r, 'P11', Date.parse(r.deadline_at)), /incomplete/);
  }
});
test('a new huge run can continue after fourteen hours but stops at the 48-hour boundary', () => {
  const r = sealed('huge'); assert.deepEqual(runtimeProfileIssues(r), []);
  assert.equal(assertPhaseRuntime(r, 'P09', Date.parse(started) + 15 * 3600000), true);
  assert.throws(() => assertPhaseRuntime(r, 'P09', Date.parse(started) + 36 * 3600000), /cutoff/);
  assert.equal(assertPhaseRuntime(r, 'P11', Date.parse(started) + 48 * 3600000 - 1), true);
  assert.throws(() => assertPhaseRuntime(r, 'P11', Date.parse(started) + 48 * 3600000), /incomplete/);
});
test('deleting, inventing or changing a budget policy cannot silently widen its seal', () => {
  const r = sealed('huge'); delete r.budget_policy;
  assert.ok(runtimeProfileIssues(r).length);
  r.budget_policy = 'unbounded'; assert.ok(runtimeProfileIssues(r).length);
  const old = sealed('huge', 'overnight-v1'); old.budget_policy = 'site-size-v2';
  assert.ok(runtimeProfileIssues(old).length);
});
test('the state schema accepts 48 hours and rejects an extended 49-hour ceiling', () => {
  const state = emptyState({ runId: '2026-09-05-sizing', now: started });
  Object.assign(state.runtime, sealed('huge'));
  assert.deepEqual(stateSchemaErrors(state), []);
  state.runtime.max_hours = 49; assert.ok(stateSchemaErrors(state).length);
});
test('both distributed configuration examples agree with the executable runtime policy', async () => {
  const expected = Object.fromEntries(Object.entries(RUNTIME_PROFILES).map(([name, p]) => [name, {
    max_hours: p.maxHours, migration_cutoff_hours: p.maxHours - p.closureReserveHours,
    closure_reserve_hours: p.closureReserveHours,
  }]));
  const run = parseYaml(await readFile(new URL('../../../templates/run-directory/config/run.yml', import.meta.url), 'utf8'));
  const thresholds = parseYaml(await readFile(new URL('../../../templates/run-directory/config/thresholds.yml', import.meta.url), 'utf8'));
  assert.deepEqual(run.runtime.profiles, expected);
  assert.deepEqual(thresholds.budgets.runtime_profiles, expected);
});
