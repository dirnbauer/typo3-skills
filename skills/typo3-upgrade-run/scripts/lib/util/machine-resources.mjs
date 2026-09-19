/** Cooperative, process-shared capacity budget. This is not an OS load isolator.
 * Lighthouse takes an exclusive lease; other harness work shares browser/CPU slots.
 * Dead lease holders are reaped under the metadata lock. A torn metadata lock fails
 * closed after a bounded wait; it is never stolen from a possibly active writer.
 */
import { mkdir, open, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { HarnessError, PreconditionError } from '../cli/exit-codes.mjs';

export const MACHINE_RESOURCE_DIR = path.join(os.tmpdir(), `t3u-resources-${process.getuid?.() ?? 'user'}`);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
};

export function machineCapacity(env = process.env) {
  const read = (name, fallback, max) => {
    const n = env[name] === undefined ? fallback : Number(env[name]);
    if (!Number.isInteger(n) || n < 1 || n > max) throw new PreconditionError(`${name} must be 1..${max}.`);
    return n;
  };
  return { browsers: read('T3U_BROWSER_SLOTS', 12, 12),
    cpu: read('T3U_CPU_SLOTS', Math.max(1, Math.min(8, os.availableParallelism() - 2)), 16) };
}

export async function acquireMachineResources({ browsers = 0, cpu = 0, exclusive = false,
  owner = 'harness', log, deadlineAt, waitMs = 600_000, pollMs = 100,
  root = MACHINE_RESOURCE_DIR, capacity = machineCapacity() } = {}) {
  if (process.env.T3U_RESOURCE_RUN_ACTIVE === '1') {
    throw new PreconditionError('Nested harness capacity reservation inside resource-run is refused. Run resource-managed commands as peers.');
  }
  for (const key of ['browsers', 'cpu']) {
    if (!Number.isInteger(capacity[key]) || capacity[key] < 1) throw new PreconditionError(`Invalid ${key} capacity.`);
    const amount = key === 'browsers' ? browsers : cpu;
    if (!Number.isInteger(amount) || amount < 0 || amount > capacity[key]) {
      throw new PreconditionError(`${key} request ${amount} exceeds machine capacity ${capacity[key]}; calibrate workers before sealing proof.`);
    }
  }
  const started = Date.now(), id = randomUUID();
  const deadline = Math.min(started + waitMs, Number.isFinite(Date.parse(deadlineAt)) ? Date.parse(deadlineAt) : Infinity);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const statePath = path.join(root, 'leases.json'), lockPath = path.join(root, 'metadata.lock');
  const transaction = async fn => {
    let handle;
    const until = Date.now() + 5000;
    while (!handle) {
      try { handle = await open(lockPath, 'wx', 0o600); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (Date.now() >= until) throw new HarnessError(`Machine resource metadata is locked: ${lockPath}. Inspect its owner before recovery.`);
        await pause(pollMs);
      }
    }
    const tmp = `${statePath}.${randomUUID()}.tmp`;
    try {
      await handle.writeFile(JSON.stringify({ pid: process.pid, owner, started: Date.now() }));
      let state;
      try { state = JSON.parse(await readFile(statePath, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; state = { leases: [], capacity }; }
      if (!Array.isArray(state.leases)) throw new HarnessError('Invalid machine resource ledger.');
      if (new Set(state.leases.map(lease => lease?.id)).size !== state.leases.length
        || state.leases.some(lease => !lease || typeof lease.id !== 'string'
          || !Number.isInteger(lease.pid) || lease.pid < 1 || !['waiting', 'active'].includes(lease.status)
          || typeof lease.exclusive !== 'boolean'
          || ['browsers', 'cpu'].some(key => !Number.isInteger(lease[key]) || lease[key] < 0))) {
        throw new HarnessError('Invalid machine resource lease; inspect the ledger before recovery.');
      }
      state.leases = state.leases.filter(lease => alive(lease.pid));
      if (state.leases.length && (state.capacity.browsers !== capacity.browsers || state.capacity.cpu !== capacity.cpu)) {
        throw new PreconditionError('Active harness jobs use a different machine capacity. Do not change capacity mid-run.');
      }
      state.capacity = capacity;
      const result = fn(state);
      await writeFile(tmp, JSON.stringify(state), { mode: 0o600 });
      await rename(tmp, statePath);
      return result;
    } finally {
      await unlink(tmp).catch(() => {});
      await handle.close();
      await unlink(lockPath);
    }
  };
  let registered = false;
  const release = async () => {
    if (!registered) return;
    await transaction(state => { state.leases = state.leases.filter(lease => lease.id !== id); });
    registered = false;
  };
  try {
    await transaction(state => {
      state.leases.push({ id, pid: process.pid, owner, browsers, cpu, exclusive, status: 'waiting' });
    });
    registered = true;
    let announced = false;
    for (;;) {
      if (Date.now() >= deadline) throw new PreconditionError('Machine capacity wait exceeded its limit or the sealed run deadline. No proof was collected.');
      const granted = await transaction(state => {
        const index = state.leases.findIndex(lease => lease.id === id);
        if (index < 0) throw new HarnessError('Machine resource request disappeared.');
        const active = state.leases.filter(lease => lease.status === 'active');
        // A queued exclusive measurement cannot starve behind newly arriving jobs.
        const earlierExclusive = state.leases.slice(0, index).some(lease => lease.exclusive);
        if (earlierExclusive || active.some(lease => lease.exclusive) || (exclusive && active.length)) return false;
        if (active.reduce((n, lease) => n + lease.browsers, browsers) > capacity.browsers
          || active.reduce((n, lease) => n + lease.cpu, cpu) > capacity.cpu) return false;
        state.leases[index].status = 'active';
        return true;
      });
      if (granted) return { release, waitMs: Date.now() - started, browsers, cpu, exclusive, capacity };
      if (!announced) { log?.info(`Waiting for shared machine capacity (${owner}).`); announced = true; }
      await pause(Math.min(pollMs, Math.max(1, deadline - Date.now())));
    }
  } catch (error) {
    await release();
    throw error;
  }
}

export async function withMachineResources(options, run) {
  const lease = await acquireMachineResources(options);
  try { return await run(lease); } finally { await lease.release(); }
}
