/** Real Chromium on synthetic loopback pages; not a customer-site throughput claim. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { axeAudit } from '../../lib/actions/sweep.mjs';
import { RunPaths } from '../../lib/run/paths.mjs';
import { StateStore, emptyState } from '../../lib/run/state.mjs';

test('real serial/parallel axe produces the same findings with fresh sessions and complete failure accounting', { timeout: 120_000 }, async t => {
  let dirtySessions = 0, active = 0, peak = 0, breakPage = false;
  const server = createServer((request, response) => {
    if (request.url === '/favicon.ico') { response.writeHead(204).end(); return; }
    if (request.headers.cookie?.includes('seen=')) dirtySessions++;
    if (breakPage && request.url === '/two') { request.socket.destroy(); return; }
    active++; peak = Math.max(peak, active);
    setTimeout(() => {
      response.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'seen=1; Path=/' });
      response.end('<!doctype html><html lang="en"><head><title>Local fixture</title></head><body>'
        + '<main><h1>Fixture</h1><button>Continue</button><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></main></body></html>');
      active--;
    }, 50);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const root = await mkdtemp(path.join(os.tmpdir(), 't3u-browser-axe-'));
  const paths = new RunPaths('.typo3-update', root), loop = '301-invariance-fixture';
  const log = Object.fromEntries(['debug', 'info', 'step', 'success', 'finding', 'warn'].map(key => [key, () => {}]));
  try {
    await mkdir(paths.manifestsDir, { recursive: true });
    await mkdir(paths.loop(loop), { recursive: true });
    const state = emptyState({ runId: '2026-09-19-browser-fixture', now: new Date().toISOString() });
    state.baselines['A-original'].sealed = true; state.loops['301'] = 'open';
    await new StateStore(paths).write(state);
    await writeFile(paths.loopDoc(loop, '00-charter.md'), '---\ncontract: A\ntrack: invariance\nbaseline_ref: A-original\n---\n');
    await writeFile(paths.envFingerprint, JSON.stringify({ fingerprintHash: 'sha256:fixture-env' }));
    await writeFile(paths.contentFingerprint, JSON.stringify({ fingerprintHash: 'sha256:fixture-content' }));
    await writeFile(paths.selftestLock, JSON.stringify({ selftestHash: 'sha256:fixture-lock' }));
    await writeFile(paths.urlManifest, JSON.stringify({ manifestHash: 'sha256:fixture-manifest',
      baseUrl: origin, allowedOrigins: [origin], seed: 'fixture',
      allUrls: ['/', '/one', '/two'].map(route => ({ url: origin + route })) }));
    const run = async (workers, label) => {
      const result = await axeAudit({ paths, log, values: { loop, workers: String(workers), label,
        sample: '3', viewports: 'desktop,mobile', states: 'default,keyboard-focus' } });
      return { result, report: JSON.parse(await readFile(result.reports[0])) };
    };
    const serial = await run(1, 'serial'); peak = 0;
    const parallel = await run(4, 'parallel');
    assert.equal(serial.result.exitCode, 1, 'the seeded missing image alternative must be found');
    assert.equal(parallel.result.exitCode, 1);
    for (const key of ['counts', 'clusters', 'findings', 'coverageFailures']) assert.deepEqual(parallel.report[key], serial.report[key]);
    assert.equal(parallel.report.execution.expected, 12);
    assert.equal(parallel.report.execution.completed, 12);
    assert.equal(parallel.report.execution.workers, 4);
    assert.ok(peak > 1, 'HTTP requests from independent browser jobs must actually overlap');
    assert.equal(dirtySessions, 0, 'no cookies may leak from one audit to another');
    t.diagnostic(`Synthetic fixture only: serial=${serial.report.execution.durationMs}ms, four workers=${parallel.report.execution.durationMs}ms; 12/12 audited in each.`);
    breakPage = true;
    const failed = await run(4, 'failure');
    assert.equal(failed.result.exitCode, 1);
    assert.equal(failed.report.counts.coverageFailures, 4);
    assert.equal(failed.report.execution.completed + failed.report.execution.failed, 12);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
