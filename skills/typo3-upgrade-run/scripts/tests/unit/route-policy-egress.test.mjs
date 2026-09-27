import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';

import { bypassRules, startEgressProxy, tunnelTargets } from '../../lib/browser/egress-proxy.mjs';
import { createRoutePolicy } from '../../lib/browser/route-policy.mjs';

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const proxyPort = (proxy) => Number(new URL(proxy.server).port);

/** Absolute-form request through the proxy, as Chromium sends plain HTTP to a proxy. */
function viaProxy(port, target) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, method: 'GET', path: target, headers: { host: new URL(target).host } }, (response) => {
      response.resume();
      response.on('end', () => resolve({ status: response.statusCode, egress: response.headers['x-t3u-egress'] }));
    });
    request.on('error', reject);
    request.end();
  });
}

/** CONNECT through the proxy; on success, speak HTTP/1.1 inside the tunnel. */
function connect(port, authority, { get = null } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, method: 'CONNECT', path: authority });
    request.on('connect', (response, socket) => {
      if (response.statusCode !== 200 || !get) { socket.destroy(); resolve({ status: response.statusCode }); return; }
      let body = '';
      socket.on('data', (chunk) => { body += chunk; });
      socket.on('end', () => resolve({ status: response.statusCode, inner: body }));
      socket.write(`GET ${get} HTTP/1.1\r\nHost: ${authority}\r\nConnection: close\r\n\r\n`);
    });
    request.on('error', reject);
    request.end();
  });
}

describe('egress rules', () => {
  test('one exact scheme://host:port bypass rule per allowed origin, default ports explicit', () => {
    assert.equal(
      bypassRules(['https://acme.ddev.site', 'http://127.0.0.1:8080', 'https://ACME.ddev.site:443', 'http://[::1]:3000']),
      'http://127.0.0.1:8080,http://[::1]:3000,https://acme.ddev.site:443',
    );
    assert.deepEqual([...tunnelTargets(['https://acme.ddev.site', 'http://acme.ddev.site'])].sort(), ['acme.ddev.site:443', 'acme.ddev.site:80']);
    assert.throws(() => bypassRules(['ftp://files.example']), /Unsupported allowed origin/);
  });
});

describe('deny-by-default egress proxy', () => {
  test('refuses and reports everything outside the allowed origins; tunnels only to them', async () => {
    const target = http.createServer((request, response) => { response.end(`inner ${request.url}`); });
    const targetPort = await listen(target);
    const refused = [];
    const egress = await startEgressProxy([`http://127.0.0.1:${targetPort}`], { onRefused: (origin) => refused.push(origin) });
    const port = proxyPort(egress.proxy);
    try {
      assert.equal(egress.proxy.bypass, `http://127.0.0.1:${targetPort}`);

      // Plain HTTP only reaches the proxy when Chromium did NOT bypass it: always refused.
      assert.deepEqual(await viaProxy(port, 'http://evil.test:81/beacon?data=secret'), { status: 403, egress: 'refused' });

      // Tunnels: the allowed server, whatever runs inside (route.fetch, WebSockets).
      const tunnel = await connect(port, `127.0.0.1:${targetPort}`, { get: '/ok' });
      assert.equal(tunnel.status, 200);
      assert.match(tunnel.inner, /^HTTP\/1\.1 200 OK[\s\S]*inner \/ok$/);

      // Same host, other port: refused. A CONNECT carries no scheme and is reported as https.
      assert.equal((await connect(port, '127.0.0.1:9')).status, 403);
      assert.equal((await connect(port, 'nonsense')).status, 403);
      assert.deepEqual(refused, ['http://evil.test:81', 'https://127.0.0.1:9', '(unparseable)']);
    } finally {
      await egress.close();
      target.close();
    }
    await assert.rejects(new Promise((resolve, reject) => {
      const socket = net.connect(port, '127.0.0.1', () => { socket.destroy(); resolve(); });
      socket.on('error', reject);
    }), /ECONNREFUSED/, 'close() stops the proxy');
  });

  test('clients that reset mid-refusal or mid-tunnel cannot crash the process', async () => {
    // Chromium resets refused CONNECTs (e.g. its own www.google.com preconnect). An unhandled
    // socket 'error' is an uncaught exception, which would end the whole capture.
    const target = http.createServer((request, response) => response.end('ok'));
    const targetPort = await listen(target);
    const egress = await startEgressProxy([`http://127.0.0.1:${targetPort}`]);
    const port = proxyPort(egress.proxy);
    const slam = (payload) => new Promise((resolve) => {
      const socket = net.connect(port, '127.0.0.1', () => {
        socket.write(payload);
        setImmediate(() => { socket.resetAndDestroy(); resolve(); });
      });
      socket.on('error', resolve);
    });
    try {
      for (let i = 0; i < 25; i += 1) {
        await Promise.all([
          slam('CONNECT evil.test:443 HTTP/1.1\r\nHost: evil.test:443\r\n\r\n'),
          slam(`CONNECT 127.0.0.1:${targetPort} HTTP/1.1\r\nHost: 127.0.0.1:${targetPort}\r\n\r\n`),
          slam('GET http://evil.test/socket HTTP/1.1\r\nHost: evil.test\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'),
        ]);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal((await connect(port, `127.0.0.1:${targetPort}`, { get: '/' })).status, 200, 'still serving');
    } finally {
      await egress.close();
      target.close();
    }
  });

  test('a default port is still a tunnel target, not an unparseable CONNECT', async () => {
    const refused = [];
    const egress = await startEgressProxy(['http://localhost'], { onRefused: (origin) => refused.push(origin) });
    try {
      // Tunnelled (200) or upstream failure (502) depending on what listens on :80 — never refused.
      const { status } = await connect(proxyPort(egress.proxy), 'localhost:80');
      assert.notEqual(status, 403);
      assert.deepEqual(refused, []);
    } finally {
      await egress.close();
    }
  });
});

describe('route policy egress and redirect detection', () => {
  const fakeContext = () => {
    const listeners = {};
    return {
      listeners,
      route: async () => {},
      on: (event, fn) => { listeners[event] = fn; },
      once: (event, fn) => { listeners[`once:${event}`] = fn; },
    };
  };
  const request = (url, from, page) => ({
    url: () => url,
    redirectedFrom: () => (from ? { url: () => from } : null),
    frame: () => (page ? { page: () => page } : (() => { throw new Error('service workers have no frame'); })()),
  });

  test('one proxy per policy; its refusals are counted as blocked', async () => {
    const policy = createRoutePolicy({ allowedOrigins: ['https://acme.ddev.site'] });
    assert.equal(policy.report().egress, 'route-only');
    const proxy = await policy.egressProxy();
    assert.equal(await policy.egressProxy(), proxy, 'repeated calls share one proxy');
    assert.equal(proxy.bypass, 'https://acme.ddev.site:443');
    try {
      await viaProxy(proxyPort(proxy), 'http://tracker.example/pixel?data=1');
      const report = policy.report();
      assert.equal(report.egress, 'proxy');
      assert.deepEqual(report.blockedOrigins, { 'http://tracker.example': 1 });
      assert.equal(report.blockedRequests, 1);
    } finally {
      await policy.close();
      await policy.close();   // idempotent
    }
    const open = createRoutePolicy({ allowedOrigins: [], blockThirdParty: false });
    assert.equal(await open.egressProxy(), undefined);
    assert.equal(open.report().egress, 'open');
  });

  test('redirect hops off the allow-list are recorded per page; allowed hops are not', async () => {
    const policy = createRoutePolicy({ allowedOrigins: ['https://acme.ddev.site'] });
    const context = fakeContext();
    await policy.attach(context);
    const page = { name: 'page' };
    context.listeners.request(request('http://evil.test/beacon?data=1', 'https://acme.ddev.site/pixel.png', page));
    context.listeners.request(request('https://acme.ddev.site/new.png', 'https://acme.ddev.site/old.png', page));
    context.listeners.request(request('http://evil.test/direct', null, page));   // first URL: route handler's job
    context.listeners.request(request('http://evil.test/sw', 'https://acme.ddev.site/sw.js', null));
    assert.deepEqual(policy.takeRedirectViolations(page), [{ from: 'https://acme.ddev.site', to: 'http://evil.test' }]);
    assert.deepEqual(policy.takeRedirectViolations(page), [], 'taking clears');
    assert.equal(policy.report().redirectViolations, 2, 'a service-worker hop counts without a page');
  });

  test('closing the context stops the egress proxy', async () => {
    const policy = createRoutePolicy({ allowedOrigins: ['https://acme.ddev.site'] });
    const port = proxyPort(await policy.egressProxy());
    const context = fakeContext();
    await policy.attach(context);
    context.listeners['once:close']();
    await policy.close();
    await assert.rejects(new Promise((resolve, reject) => {
      const socket = net.connect(port, '127.0.0.1', () => { socket.destroy(); resolve(); });
      socket.on('error', reject);
    }), /ECONNREFUSED/);
  });
});
