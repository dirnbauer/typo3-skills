import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { captureAll } from '../../lib/actions/capture.mjs';
import { launchBrowser, newContext } from '../../lib/browser/launch.mjs';
import { createRoutePolicy } from '../../lib/browser/route-policy.mjs';
import { buildManifest } from '../../lib/run/manifest.mjs';
import { UrlGuard } from '../../lib/net/url-guard.mjs';

const log = Object.fromEntries(['debug', 'info', 'step', 'success', 'finding', 'warn'].map((key) => [key, () => {}]));
const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const png = (() => { const image = new PNG({ width: 4, height: 4 }); image.data.fill(200); return PNG.sync.write(image); })();

/** Minimal WebSocket handshake plus one unmasked text frame. */
function acceptWebSocket(request, socket, text) {
  // An upgraded socket arrives paused and half-open: read (and discard) frames so the browser's
  // FIN is seen, then end our side too — otherwise server.close() waits forever.
  socket.on('end', () => socket.end());
  socket.on('error', () => socket.destroy());
  socket.resume();
  const accept = createHash('sha1').update(`${request.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.write(Buffer.from([0x81, text.length, ...Buffer.from(text)]));
}

async function fixture() {
  const evilHits = [];
  const evil = createServer((request, response) => { evilHits.push(request.url); response.end('leaked'); });
  evil.on('upgrade', (request, socket) => { evilHits.push(`ws ${request.url}`); acceptWebSocket(request, socket, 'evil'); });
  const E = await listen(evil);
  let A;
  const site = createServer((request, response) => {
    const { pathname } = new URL(request.url, 'http://fixture');
    const redirect = (location) => { response.writeHead(302, { location }); response.end(); };
    if (pathname === '/pixel.png') return redirect(`http://127.0.0.1:${E}/beacon?data=secret`);
    if (pathname === '/r1') return redirect('/r2');
    if (pathname === '/r2') return redirect(`http://127.0.0.1:${E}/chain`);
    if (pathname === '/to-testnet') return redirect('http://192.0.2.1/beacon');
    if (pathname === '/old.png') return redirect('/new.png');
    if (pathname.endsWith('.png')) { response.writeHead(200, { 'content-type': 'image/png' }); response.end(png); return undefined; }
    response.writeHead(200, { 'content-type': 'text/html' });
    const leaky = pathname !== '/clean';
    response.end('<!doctype html><html lang="en"><head><title>Egress fixture</title></head><body><h1>Egress</h1>'
      + '<img id="ok" src="/ok.png" alt=""><img id="moved" src="/old.png" alt="">'
      + (leaky ? '<img id="pixel" src="/pixel.png" alt=""><img id="chain" src="/r1" alt=""><img id="testnet" src="/to-testnet" alt="">' : '')
      + '</body></html>');
    return undefined;
  });
  site.on('upgrade', (request, socket) => acceptWebSocket(request, socket, 'hello'));
  A = await listen(site);
  return {
    evilHits, E, A, origin: `http://127.0.0.1:${A}`,
    close: () => Promise.all([new Promise((r) => site.close(r)), new Promise((r) => evil.close(r))]),
  };
}

test('redirect hops, IP literals and WebSockets outside the allow-list are prevented, counted and attributed', { timeout: 120_000 }, async () => {
  const site = await fixture();
  const { browser } = await launchBrowser({ log });
  try {
    const policy = createRoutePolicy({ allowedOrigins: [site.origin] });
    const context = await newContext(browser, { viewport: 'desktop', proxy: await policy.egressProxy() });
    await policy.attach(context);
    // Node-side route.fetch() (the media adapters' path) must still reach the allowed origin.
    let fetched = null;
    await context.route('**/ok.png', async (route) => {
      const response = await route.fetch();
      fetched = response.status();
      return route.fulfill({ response });
    });
    const page = await context.newPage();
    await page.goto(`${site.origin}/`, { waitUntil: 'load' });
    const sockets = await page.evaluate(({ A, E }) => Promise.all([['same', A], ['cross', E]].map(([name, port]) => new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/socket`);
      ws.onmessage = (event) => resolve(`${name}:${event.data}`);
      ws.onerror = () => resolve(`${name}:error`);
      setTimeout(() => resolve(`${name}:timeout`), 5000);
    }))), { A: site.A, E: site.E });
    const loaded = await page.evaluate(() => Object.fromEntries([...document.images].map((img) => [img.id, img.naturalWidth > 0])));

    assert.deepEqual(site.evilHits, [], 'nothing reached the non-allowed origin');
    assert.deepEqual(loaded, { ok: true, moved: true, pixel: false, chain: false, testnet: false });
    assert.deepEqual(sockets, ['same:hello', 'cross:error']);
    assert.equal(fetched, 200);

    const report = policy.report();
    assert.equal(report.egress, 'proxy');
    assert.equal(report.blockedOrigins[`http://127.0.0.1:${site.E}`], 2, 'pixel and chain hops');
    assert.equal(report.blockedOrigins['http://192.0.2.1'], 1, 'IP literal refused without a connection attempt');
    assert.equal(report.blockedOrigins[`https://127.0.0.1:${site.E}`], 1, 'cross-origin WebSocket CONNECT');
    assert.deepEqual(
      policy.takeRedirectViolations(page).map((hop) => hop.to).sort(),
      [`http://127.0.0.1:${site.E}`, `http://127.0.0.1:${site.E}`, 'http://192.0.2.1'],
    );
    assert.equal(report.redirectViolations, 3);
    await context.close();
  } finally {
    await browser.close();
    await site.close();
  }
});

test('a capture whose page redirects off the allow-list fails like a navigation-guard violation', { timeout: 120_000 }, async () => {
  const site = await fixture();
  const root = await mkdtemp(path.join(os.tmpdir(), 't3u-egress-'));
  try {
    const manifest = buildManifest({
      baseUrl: site.origin, allowedOrigins: [site.origin], seed: 'fixture',
      urls: [`${site.origin}/clean`, `${site.origin}/leaky`], viewports: ['desktop'], states: ['default'],
    });
    const guard = await UrlGuard.create({ allowedOrigins: [site.origin] });
    const { index } = await captureAll({ manifest, guard, outRoot: root, stages: new Set(['visual']), log, visualWorkers: 1, provenWorkers: 1 });
    const leaky = manifest.captures.find((c) => c.urlId === manifest.allUrls.find((u) => u.url.endsWith('/leaky')).id).captureId;

    assert.deepEqual(site.evilHits, []);
    assert.equal(index.shots, 2);
    // One error, on the leaky page only. The capture's warm-up reload repeats some hops, so the
    // counts are lower bounds rather than exact.
    assert.deepEqual(index.errors.map(({ captureId, stage }) => ({ captureId, stage })), [{ captureId: leaky, stage: 'visual' }]);
    assert.ok(index.errors[0].redirectViolations >= 3);
    assert.match(index.errors[0].error, new RegExp(`^redirect-guard: ${site.origin.replace(/[.]/g, '\\.')} redirected to `));
    assert.equal(index.routePolicy.egress, 'proxy');
    assert.ok(index.routePolicy.redirectViolations >= 3);
    assert.ok(index.routePolicy.blockedOrigins[`http://127.0.0.1:${site.E}`] >= 2);
  } finally {
    await rm(root, { recursive: true, force: true });
    await site.close();
  }
});
