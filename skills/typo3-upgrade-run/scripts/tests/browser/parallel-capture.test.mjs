import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { captureAll } from '../../lib/actions/capture.mjs';
import { buildManifest } from '../../lib/run/manifest.mjs';
import { UrlGuard } from '../../lib/net/url-guard.mjs';

test('bounded concurrent Chromium startup preserves isolated assignment and zero-difference repeat captures', { timeout: 120_000 }, async () => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><html lang="en"><head><title>Pixel fixture</title></head><body>'
      + '<main><h1>Stable local fixture</h1><p>No external resources or clocks.</p></main></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const root = await mkdtemp(path.join(os.tmpdir(), 't3u-browser-capture-'));
  const log = Object.fromEntries(['debug', 'info', 'step', 'success', 'finding', 'warn'].map(key => [key, () => {}]));
  try {
    const manifest = buildManifest({ baseUrl: origin, allowedOrigins: [origin], seed: 'fixture',
      urls: [origin + '/', origin + '/two'], viewports: ['desktop'], states: ['default'] });
    const guard = await UrlGuard.create({ allowedOrigins: [origin] });
    for (const label of ['a', 'b']) {
      const result = await captureAll({ manifest, guard, outRoot: path.join(root, label), stages: new Set(['visual']),
        log, visualWorkers: 2, provenWorkers: 2 });
      assert.equal(result.index.shots, 2);
      assert.deepEqual(result.index.errors, []);
      assert.equal(result.index.browserStartup[0].workers, 2);
    }
    const workers = new Set();
    for (const capture of manifest.captures) {
      const file = capture.captureId;
      assert.deepEqual(await readFile(path.join(root, 'a', 'shots', `${file}.png`)),
        await readFile(path.join(root, 'b', 'shots', `${file}.png`)));
      workers.add(JSON.parse(await readFile(path.join(root, 'a', 'shots', `${file}.meta.json`))).visualWorker);
    }
    assert.deepEqual([...workers].sort(), [1, 2]);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
