/**
 * Machine-wide visual-capture mutex.
 *
 * Several upgrade runs (different projects, same machine) can execute concurrently, but
 * their VISUAL captures must not: renderer determinism is proven per machine, and a second
 * run's Chromium fleet competing for cores during a double-shoot turns real determinism
 * into apparent flake. The lock serialises only the expensive, contention-sensitive part —
 * screenshots — while fetches, comparisons and application work still overlap freely.
 *
 * Implementation: an atomically-created lock DIRECTORY in the per-user tmpdir with a
 * meta.json naming pid, run id and start time. A holder that no longer runs (dead pid) is
 * stolen. Waiting is unbounded by design — an overnight queue is correct behaviour — but
 * every holder change is logged so a stuck run is visible, and acquisition is re-entrant
 * within one process so a self-test's nested captures cannot deadlock.
 */

import { mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export const LOCK_DIR = path.join(os.tmpdir(), 't3u-visual-capture.lock');
const POLL_MS = 5000;

let depth = 0; // process-level re-entrancy

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
}

export async function acquireMachineLock({ runId = 'unknown', log = null, lockDir = LOCK_DIR, pollMs = POLL_MS } = {}) {
  if (depth > 0) { depth += 1; return { reentrant: true }; }
  let announced = false;
  for (;;) {
    try {
      await mkdir(lockDir); // atomic: fails with EEXIST when held
      await writeFile(path.join(lockDir, 'meta.json'),
        `${JSON.stringify({ pid: process.pid, runId, started: new Date().toISOString() })}\n`, 'utf8');
      depth = 1;
      return { reentrant: false };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let meta = null;
      try { meta = JSON.parse(await readFile(path.join(lockDir, 'meta.json'), 'utf8')); } catch { /* racing or torn */ }
      if (meta && !pidAlive(meta.pid)) {
        log?.warn(`visual-capture lock holder pid ${meta.pid} (${meta.runId ?? '?'}) is gone — stealing stale lock`);
        await rm(lockDir, { recursive: true, force: true });
        continue;
      }
      if (!announced) {
        log?.step(`visual capture waiting for machine lock held by ${meta?.runId ?? 'unknown run'} (pid ${meta?.pid ?? '?'}) — captures on one machine run one at a time`);
        announced = true;
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }
}

export async function releaseMachineLock({ lockDir = LOCK_DIR } = {}) {
  if (depth > 1) { depth -= 1; return; }
  if (depth === 1) {
    depth = 0;
    await rm(lockDir, { recursive: true, force: true });
  }
}
