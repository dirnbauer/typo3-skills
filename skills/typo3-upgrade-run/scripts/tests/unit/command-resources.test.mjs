import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { visualCaptureLease } from '../../lib/actions/capture.mjs';
import { commandResources, runCommand } from '../../lib/cli/command.mjs';

const LEASE_FREE = ['node-open', 'node-close', 'gate', 'env-fingerprint', 'discover-urls', 'closure-start', 'closure-check',
  'closure-verify', 'validate-run', 'doctor', 'graph-next', 'approval'];

test('state, verdict and fingerprint commands hold no browser slot; page work holds one', () => {
  for (const command of LEASE_FREE) assert.deepEqual(commandResources(command), { preflight: null, action: null }, command);
  assert.deepEqual(commandResources('content-fingerprint'), { preflight: null, action: { cpu: 1 } });
  for (const command of ['backend-sweep', 'smoke']) {
    assert.deepEqual(commandResources(command), { preflight: { browsers: 1 }, action: { browsers: 1 } }, command);
  }
  assert.deepEqual(commandResources('compare-http'), { preflight: { browsers: 1 }, action: null });
});

test('the command wrapper never reserves browser capacity for a state transition or verdict', async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), 't3u-command-'));
  const cwd = process.cwd();
  try {
    process.chdir(project);
    await mkdir('.typo3-update');
    await writeFile(path.join('.typo3-update', 'selftest.lock.json'), JSON.stringify({ verdict: 'pass', passedAt: new Date().toISOString() }));
    const reserved = [], probes = [];
    const reserve = async (options, work) => {
      reserved.push({ owner: options.owner, browsers: options.browsers ?? 0, cpu: options.cpu ?? 0 });
      return work();
    };
    const run = (command) => runCommand({ command, values: { 'run-dir': '.typo3-update', quiet: true }, positionals: [], argv: [command],
      actions: { [command]: async () => ({ exitCode: 0, message: 'done' }) }, reserve, liveInputs: async () => { probes.push(command); } });
    for (const command of ['node-close', 'gate', 'env-fingerprint', 'closure-check', 'closure-verify', 'validate-run', 'discover-urls', 'doctor']) {
      assert.equal(await run(command), 0, command);
    }
    assert.deepEqual(reserved, []);
    assert.deepEqual(probes, ['gate'], 'gate still proves its live inputs, without a lease');
    assert.equal(await run('content-fingerprint'), 0);
    assert.equal(await run('compare-http'), 0);
    assert.deepEqual(reserved, [{ owner: 'content-fingerprint', browsers: 0, cpu: 1 }, { owner: 'live-input-preflight', browsers: 1, cpu: 0 }]);
  } finally {
    process.chdir(cwd);
    await rm(project, { recursive: true, force: true });
  }
});

test('visual capture leases the workers it starts; authoritative pixels also own the browser lane', () => {
  assert.deepEqual(visualCaptureLease({ visualWorkers: 4, perViewport: [360, 360, 360], scope: 'final' }), { browsers: 4, exclusiveBrowsers: true });
  assert.deepEqual(visualCaptureLease({ visualWorkers: 12, perViewport: [3, 5], scope: 'intermediate' }), { browsers: 5, exclusiveBrowsers: false });
  assert.deepEqual(visualCaptureLease({ visualWorkers: 1, perViewport: [80], scope: 'final' }), { browsers: 1, exclusiveBrowsers: true });
});
