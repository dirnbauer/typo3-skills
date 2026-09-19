import test from 'node:test';
import assert from 'node:assert/strict';
import { axeJobs, collectAxeJobs } from '../../lib/browser/axe-jobs.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const jobs = axeJobs(['one', 'two', 'three'], ['desktop', 'mobile'], ['default', 'nav-open']);
test('parallel axe genuinely overlaps jobs while preserving serial results and complete coverage', async () => {
  let active = 0, peak = 0;
  const run = async job => {
    active++; peak = Math.max(peak, active);
    await pause(job.url === 'one' ? 10 : 2);
    active--;
    return { skipped: false, violations: [{ id: 'fixture-rule', nodes: 1, targets: [job.url] }], incomplete: [] };
  };
  const serial = await collectAxeJobs(jobs, 1, run);
  peak = 0;
  const parallel = await collectAxeJobs(jobs, 4, run);
  assert.equal(peak, 4);
  assert.deepEqual(parallel.observations, serial.observations);
  assert.equal(parallel.execution.expected, 12);
  assert.equal(parallel.execution.completed, 12);
  assert.equal(parallel.execution.failed, 0);
});
test('failed workers and empty results cannot disappear from coverage or become a pass', async () => {
  const result = await collectAxeJobs(jobs, 4, async job => {
    if (job.url === 'one') throw new Error('browser crashed');
    if (job.url === 'two') return undefined;
    return { skipped: true, reason: 'no navigation widget on this route' };
  });
  assert.equal(result.execution.expected, 12);
  assert.equal(result.execution.failed, 8);
  assert.equal(result.execution.completed, 4);
  assert.equal(result.execution.skipped, 4);
  assert.equal(result.coverageFailures.length + result.observations.length, jobs.length);
});
test('policy failures retain their security classification', async () => {
  const error = Object.assign(new Error('foreign origin'), { exitCode: 5 });
  await assert.rejects(collectAxeJobs(jobs, 4, () => { throw error; }), e => e === error);
});
test('empty or duplicate matrices and invalid worker counts are refused', async () => {
  assert.throws(() => axeJobs([], ['desktop'], ['default']));
  assert.throws(() => axeJobs(['one', 'one'], ['desktop'], ['default']));
  for (const workers of [0, -1, 13, 1.5, NaN]) await assert.rejects(collectAxeJobs(jobs, workers, () => {}));
});
