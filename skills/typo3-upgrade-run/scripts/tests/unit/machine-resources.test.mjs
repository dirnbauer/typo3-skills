import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { acquireMachineResources, withMachineResources } from '../../lib/util/machine-resources.mjs';

const exec = promisify(execFile), pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 't3u-capacity-'));
  try { await run({ root, capacity: { browsers: 4, cpu: 2 }, pollMs: 5, waitMs: 1500 }); }
  finally { await rm(root, { recursive: true, force: true }); }
}
test('browser slots are shared, overbooking waits, and CPU work can overlap', () => fixture(async options => {
  const a = await acquireMachineResources({ ...options, browsers: 2 });
  const b = await acquireMachineResources({ ...options, browsers: 2 });
  const cpu = await acquireMachineResources({ ...options, cpu: 2 });
  let started = false;
  const pending = acquireMachineResources({ ...options, browsers: 1 }).then(lease => { started = true; return lease; });
  await pause(30); assert.equal(started, false);
  await a.release(); const c = await pending;
  await Promise.all([b.release(), cpu.release(), c.release()]);
  assert.deepEqual(JSON.parse(await readFile(path.join(options.root, 'leases.json'))).leases, []);
}));
test('queued Lighthouse gets an exclusive quiet window before later arrivals', () => fixture(async options => {
  const a = await acquireMachineResources({ ...options, browsers: 1 });
  const quietPending = acquireMachineResources({ ...options, exclusive: true });
  // Wait for registration, not an assumption about timer/IO ordering.
  for (;;) {
    if (JSON.parse(await readFile(path.join(options.root, 'leases.json'))).leases.some(l => l.exclusive)) break;
    await pause(5);
  }
  let lateStarted = false;
  const late = acquireMachineResources({ ...options, cpu: 1 }).then(lease => { lateStarted = true; return lease; });
  await a.release(); const quiet = await quietPending;
  await pause(20); assert.equal(lateStarted, false);
  await quiet.release(); await (await late).release();
}));
test('failed work, timeouts and dead holders release or reclaim capacity', () => fixture(async options => {
  await assert.rejects(withMachineResources(options, async () => { throw new Error('fixture failure'); }), /fixture failure/);
  const quiet = await acquireMachineResources({ ...options, exclusive: true });
  await assert.rejects(acquireMachineResources({ ...options, browsers: 1, waitMs: 25 }), /wait exceeded/);
  await quiet.release();
  const { stdout } = await exec(process.execPath, ['-e', 'console.log(process.pid)']);
  await writeFile(path.join(options.root, 'leases.json'), JSON.stringify({ capacity: options.capacity,
    leases: [{ id: 'crashed', pid: Number(stdout), status: 'active', exclusive: true, browsers: 4, cpu: 2 }] }));
  const next = await acquireMachineResources({ ...options, browsers: 4 });
  await next.release();
}));
test('the capacity budget also constrains a different process', () => fixture(async options => {
  const lease = await acquireMachineResources({ ...options, browsers: 4 });
  const module = new URL('../../lib/util/machine-resources.mjs', import.meta.url).href;
  const source = `import { acquireMachineResources } from ${JSON.stringify(module)};
    try { const lease = await acquireMachineResources(${JSON.stringify({ ...options, browsers: 1, waitMs: 30 })});
      await lease.release(); process.exitCode = 1;
    } catch (error) { if (!error.message.includes('wait exceeded')) throw error; }`;
  try { await exec(process.execPath, ['--input-type=module', '-e', source]); }
  finally { await lease.release(); }
}));
test('oversized and mid-run capacity changes fail before work starts', () => fixture(async options => {
  await assert.rejects(acquireMachineResources({ ...options, browsers: 5 }), /exceeds/);
  const lease = await acquireMachineResources(options);
  try { await assert.rejects(acquireMachineResources({ ...options, capacity: { browsers: 8, cpu: 2 } }), /different machine capacity/); }
  finally { await lease.release(); }
}));

test('nested reservations refuse instead of deadlocking a wrapped command', () => fixture(async options => {
  const module = new URL('../../lib/util/machine-resources.mjs', import.meta.url).href;
  const source = `import { acquireMachineResources } from ${JSON.stringify(module)};
    try { await acquireMachineResources(${JSON.stringify(options)}); process.exitCode = 1; }
    catch (error) { if (!error.message.includes('Nested harness capacity')) throw error; }`;
  await exec(process.execPath, ['--input-type=module', '-e', source], {
    env: { ...process.env, T3U_RESOURCE_RUN_ACTIVE: '1' },
  });
}));

test('malformed leases fail closed and expired deadlines never grant capacity', () => fixture(async options => {
  await assert.rejects(acquireMachineResources({ ...options, deadlineAt: new Date(0).toISOString() }), /deadline/);
  await writeFile(path.join(options.root, 'leases.json'), JSON.stringify({ capacity: options.capacity,
    leases: [{ id: 'broken', pid: process.pid, status: 'active', exclusive: false, browsers: -4, cpu: 0 }] }));
  await assert.rejects(acquireMachineResources(options), /Invalid machine resource lease/);
}));
