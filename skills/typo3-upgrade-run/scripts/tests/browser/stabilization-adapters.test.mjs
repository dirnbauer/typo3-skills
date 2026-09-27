import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { captureAll } from '../../lib/actions/capture.mjs';
import { mediaSourcesDiffer } from '../../lib/actions/compare.mjs';
import { resolveImageMagick } from '../../lib/browser/media-adapters.mjs';
import { buildManifest } from '../../lib/run/manifest.mjs';
import { UrlGuard } from '../../lib/net/url-guard.mjs';

const tool = resolveImageMagick();

function solidPng(width, height, [r, g, b]) {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) png.data.set([r, g, b, 255], i);
  return PNG.sync.write(png);
}

function pixel(pngBytes, x, y) {
  const image = PNG.sync.read(pngBytes);
  const i = (image.width * y + x) * 4;
  return [...image.data.subarray(i, i + 3)];
}

test('sealed adapters make server-randomized regions and animated GIFs repeat exactly, with evidence', {
  timeout: 180_000,
  skip: !tool && 'ImageMagick not installed',
}, async () => {
  // Frame 1 red for 20 ms, frame 2 blue for 10 s: without the adapter the screenshot shows blue.
  const animation = spawnSync(tool.command, [
    '-dispose', 'none', '-delay', '2', '-size', '40x20', 'xc:red', '-delay', '1000', '-size', '40x20', 'xc:blue',
    '-loop', '0', 'gif:-',
  ]).stdout;
  const logos = { a: solidPng(30, 30, [200, 30, 30]), b: solidPng(30, 30, [30, 160, 30]), c: solidPng(30, 30, [30, 30, 200]) };
  let served = 0;
  const server = createServer((request, response) => {
    const { pathname } = new URL(request.url, 'http://fixture');
    if (pathname === '/anim.gif') { response.writeHead(200, { 'content-type': 'image/gif' }); response.end(animation); return; }
    const logo = /^\/logo-([abc])\.png$/.exec(pathname);
    if (logo) { response.writeHead(200, { 'content-type': 'image/png' }); response.end(logos[logo[1]]); return; }
    served += 1;
    // Server-side randomness the page cannot seed: a shuffled selection plus a visible counter.
    const order = Object.keys(logos).sort(() => Math.random() - 0.5);
    const broken = pathname === '/broken';
    const items = order.map((id, i) => (broken && i === 0
      ? `<a><img src="/logo-${id}.png"></a>`
      : `<a href="/partner/${id}"><img src="/logo-${id}.png" alt="Partner ${id}"></a>`)).join('');
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><html lang="en"><head><title>Adapter fixture</title><style>'
      + 'body{margin:0;font:16px sans-serif}#anim{position:absolute;left:0;top:0}main{padding-top:30px}'
      + '.partner-logos{display:flex;gap:4px}.partner-logos img{display:block;width:30px;height:30px}</style></head><body>'
      + '<img id="anim" src="/anim.gif" alt="Animation" width="40" height="20">'
      + `<main><h1>Randomized fixture</h1><div class="partner-logos">${items}<span>pick ${served}</span></div>`
      + '<p>Stable footer</p></main></body></html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const root = await mkdtemp(path.join(os.tmpdir(), 't3u-adapters-'));
  const log = Object.fromEntries(['debug', 'info', 'step', 'success', 'finding', 'warn'].map((key) => [key, () => {}]));
  const stabilization = {
    randomizedRegions: [{ selector: '.partner-logos', adr: 'ADR-004', placeholderHeight: 40, minLinks: 3, minImages: 3 }],
    media: { gifFirstFrame: { adr: 'ADR-005' } },
  };
  try {
    const guard = await UrlGuard.create({ allowedOrigins: [origin], resolver: async () => ['127.0.0.1'] });
    const manifest = buildManifest({
      baseUrl: origin, allowedOrigins: [origin], seed: 'fixture', urls: [`${origin}/`, `${origin}/broken`],
      viewports: ['desktop'], states: ['default'], stabilization,
    });
    const shotOf = (url) => manifest.captures.find((c) => c.urlId === manifest.allUrls.find((u) => u.url === url).id).captureId;
    const home = shotOf(`${origin}/`);
    const broken = shotOf(`${origin}/broken`);

    const passes = {};
    for (const label of ['a', 'b']) {
      const { index } = await captureAll({
        manifest, guard, outRoot: path.join(root, label), stages: new Set(['http', 'dom', 'visual']),
        log, visualWorkers: 1, provenWorkers: 1,
      });
      passes[label] = index;
      // Integrity failures are capture errors on the broken page only: once from the served
      // HTML, once from the rendered page.
      assert.deepEqual(index.errors.map((error) => error.stage), ['randomized-region-integrity', 'randomized-region-integrity']);
      for (const error of index.errors) {
        assert.match(error.error, /link-without-href×1/);
        assert.match(error.error, /image-without-alt×1/);
      }
      assert.ok(index.errors.some((error) => error.captureId === broken));
      assert.ok(!index.errors.some((error) => error.captureId === home));
      assert.equal(index.routePolicy.media.gifFirstFrame.transformed >= 1, true);
      assert.equal(index.routePolicy.media.gifFirstFrame.laterFramesUntested, 1);
      assert.equal(index.routePolicy.media.gifFirstFrame.failed, 0);
    }
    assert.ok(served >= 4, 'the server really produced a new selection per request');

    const read = (label, ...parts) => readFile(path.join(root, label, ...parts));
    assert.deepEqual(await read('a', 'shots', `${home}.png`), await read('b', 'shots', `${home}.png`),
      'identical pixels despite a different server-side selection');
    const domFiles = (await readdir(path.join(root, 'a', 'dom'))).filter((f) => f.endsWith('.html')).sort();
    assert.equal(domFiles.length, 2);
    for (const file of domFiles) {
      assert.deepEqual(await read('a', 'dom', file), await read('b', 'dom', file), `identical normalized DOM for ${file}`);
    }

    const meta = JSON.parse(await read('a', 'shots', `${home}.meta.json`));
    assert.equal(meta.settle.settleFailed, undefined, 'the settle script ran in the page');
    assert.deepEqual(
      meta.settle.randomizedRegions.map(({ links, images, valid, placeholderHeight }) => ({ links, images, valid, placeholderHeight })),
      [{ links: 3, images: 3, valid: true, placeholderHeight: 40 }],
    );
    assert.deepEqual(meta.mediaAdapters, [{
      kind: 'gif-first-frame', resource: '/anim.gif', frames: 2,
      sourceSha256: `sha256:${createHash('sha256').update(animation).digest('hex')}`, sourceBytes: animation.length,
    }]);
    assert.equal(await mediaSourcesDiffer(path.join(root, 'a', 'shots', `${home}.png`), path.join(root, 'b', 'shots', `${home}.png`)), null);
    assert.deepEqual(pixel(await read('a', 'shots', `${home}.png`), 10, 10), [255, 0, 0], 'frame 1 of the GIF');

    // Control: the same page without the GIF adapter has already moved on to frame 2.
    const control = buildManifest({
      baseUrl: origin, allowedOrigins: [origin], seed: 'fixture', urls: [`${origin}/`],
      viewports: ['desktop'], states: ['default'], stabilization: { randomizedRegions: stabilization.randomizedRegions },
    });
    await captureAll({ manifest: control, guard, outRoot: path.join(root, 'control'), stages: new Set(['visual']), log, visualWorkers: 1, provenWorkers: 1 });
    assert.deepEqual(pixel(await read('control', 'shots', `${control.captures[0].captureId}.png`), 10, 10), [0, 0, 255],
      'without the adapter Chromium shows a later frame');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
