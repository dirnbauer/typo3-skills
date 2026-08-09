import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { acquireMachineLock, releaseMachineLock } from '../../lib/util/machine-lock.mjs';

const execFileAsync = promisify(execFile);

async function tmpLockDir() {
  const base = await mkdtemp(path.join(os.tmpdir(), 't3u-lock-test-'));
  return path.join(base, 'capture.lock');
}

describe('machine-wide visual-capture lock', () => {
  test('acquire creates the lock dir, release removes it', async () => {
    const lockDir = await tmpLockDir();
    await acquireMachineLock({ runId: 'test-a', lockDir });
    await access(lockDir); // exists while held
    await releaseMachineLock({ lockDir });
    await assert.rejects(access(lockDir), 'lock dir must be gone after release');
  });

  test('re-entrant in-process: nested acquire does not deadlock and outer release frees it', async () => {
    const lockDir = await tmpLockDir();
    await acquireMachineLock({ runId: 'outer', lockDir });
    const inner = await acquireMachineLock({ runId: 'inner', lockDir });
    assert.equal(inner.reentrant, true);
    await releaseMachineLock({ lockDir }); // inner
    await access(lockDir); // still held by outer
    await releaseMachineLock({ lockDir }); // outer
    await assert.rejects(access(lockDir));
  });

  test('a lock whose holder pid is dead is stolen instead of waited on', async () => {
    const lockDir = await tmpLockDir();
    // A freshly exited child pid is guaranteed dead.
    const { stdout } = await execFileAsync(process.execPath, ['-e', 'console.log(process.pid)']);
    const deadPid = Number(stdout.trim());
    await mkdir(lockDir, { recursive: true });
    await writeFile(path.join(lockDir, 'meta.json'),
      `${JSON.stringify({ pid: deadPid, runId: 'dead-run', started: '2026-01-01T00:00:00Z' })}\n`, 'utf8');

    const warnings = [];
    const log = { warn: (m) => warnings.push(m), step: () => {} };
    const got = await acquireMachineLock({ runId: 'stealer', log, lockDir, pollMs: 10 });
    assert.equal(got.reentrant, false);
    assert.ok(warnings.some((w) => w.includes('stealing stale lock')), 'steal must be logged');
    await releaseMachineLock({ lockDir });
  });

  test('a live holder is waited on, then acquired after release', async () => {
    const lockDir = await tmpLockDir();
    // Simulate a LIVE foreign holder using our own pid, then release it shortly after.
    await mkdir(lockDir, { recursive: true });
    await writeFile(path.join(lockDir, 'meta.json'),
      `${JSON.stringify({ pid: process.pid, runId: 'other-run', started: '2026-01-01T00:00:00Z' })}\n`, 'utf8');
    setTimeout(() => { rm(lockDir, { recursive: true, force: true }); }, 60);

    const steps = [];
    const log = { warn: () => {}, step: (m) => steps.push(m) };
    const t0 = Date.now();
    await acquireMachineLock({ runId: 'waiter', log, lockDir, pollMs: 20 });
    assert.ok(Date.now() - t0 >= 40, 'must actually have waited for the holder');
    assert.ok(steps.some((s) => s.includes('waiting for machine lock')), 'wait must be announced');
    await releaseMachineLock({ lockDir });
  });
});
