/**
 * Deny-by-default egress for a browser context.
 *
 * `context.route()` sees the FIRST URL of each request only. Redirect hops after
 * route.continue(), service-worker fetches and WebSockets never reach a route handler, so a
 * same-origin URL answering `302 Location: https://tracker.example/?data=…` used to leave the
 * machine unblocked and unreported (reproduced with Playwright 1.62 / Chromium 151).
 *
 * The context therefore gets a local proxy that refuses everything, and Chromium proxy-bypass
 * rules for the exact allowed origins. Chromium matches those rules on scheme, host AND effective
 * port (verified with Chromium 151: `https://h:443` matches `https://h/`, but not
 * `https://h:8443/`, `http://h/` or `wss://h/`). Allowed traffic never touches the proxy, so
 * pages render exactly as before. Everything that does reach it is outside the allow-list, except
 * tunnels to an allowed host:port:
 *
 *  - absolute-form HTTP request                → 403, counted
 *  - CONNECT to anything but an allowed host:port → 403, counted
 *  - CONNECT to an allowed host:port           → tunnelled. Playwright's Node-side route.fetch()
 *    (media adapters) arrives this way because Playwright's own bypass check compares host names
 *    only, and so do same-origin WebSockets (`wss:` never matches an `https:` rule).
 *
 * The server and its sockets are unref()'d: a proxy that is never closed cannot keep the process
 * alive.
 */

import { createServer } from 'node:http';
import net from 'node:net';
import { normalizeOrigin } from '../net/url-guard.mjs';

const DEFAULT_PORTS = Object.freeze({ 'http:': 80, 'https:': 443 });

function effectiveOrigin(origin) {
  const url = new URL(origin);
  const port = url.port ? Number(url.port) : DEFAULT_PORTS[url.protocol];
  if (!port) throw new Error(`Unsupported allowed origin for egress rules: ${origin}`);
  return { protocol: url.protocol, hostname: url.hostname.toLowerCase(), port };
}

/** Chromium proxy-bypass list: one exact `scheme://host:port` rule per allowed origin. */
export function bypassRules(allowedOrigins) {
  return [...new Set(allowedOrigins.map((origin) => {
    const { protocol, hostname, port } = effectiveOrigin(origin);
    return `${protocol}//${hostname}:${port}`;
  }))].sort().join(',');
}

/** host:port pairs a CONNECT may reach: the allowed origins' servers, whatever the inner protocol. */
export function tunnelTargets(allowedOrigins) {
  return new Set(allowedOrigins.map((origin) => {
    const { hostname, port } = effectiveOrigin(origin);
    return `${hostname}:${port}`;
  }));
}

/** CONNECT authority `host:port` / `[v6]:port`. Parsed by hand: URL() drops a default port. */
function authority(raw) {
  const m = /^(\[[0-9a-fA-F:.]+\]|[^:\s/[\]]+):(\d{1,5})$/.exec(String(raw ?? ''));
  const port = m ? Number(m[2]) : 0;
  if (!m || port < 1 || port > 65535) return null;
  const hostname = m[1].toLowerCase();
  return { key: `${hostname}:${port}`, host: hostname.replace(/^\[|\]$/g, ''), port };
}

/**
 * Start the proxy. `onRefused(origin)` receives the normalized origin of every refused request;
 * a CONNECT carries no scheme and is reported as https (TLS or WSS tunnel).
 */
export async function startEgressProxy(allowedOrigins, { onRefused = () => {} } = {}) {
  const tunnels = tunnelTargets(allowedOrigins);
  const sockets = new Set();
  const track = (socket) => {
    socket.unref();
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  };
  const refuse = (origin) => {
    try { onRefused(origin); } catch { /* counting must never break the refusal */ }
  };

  const server = createServer((request, response) => {
    let origin = '(unparseable)';
    try { origin = normalizeOrigin(new URL(request.url).origin); } catch { /* keep the marker */ }
    refuse(origin);
    response.writeHead(403, { 'content-type': 'text/plain', 'x-t3u-egress': 'refused' });
    response.end();
  });
  server.on('connection', track);
  // Sockets handed over by 'upgrade' and 'connect' are ours: Chromium resets refused CONNECTs, and
  // an 'error' without a listener would crash the whole harness process. Listen before writing.
  server.on('upgrade', (request, socket) => {
    socket.on('error', () => socket.destroy());
    refuse('(upgrade)');
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
  });
  server.on('connect', (request, client, head) => {
    let upstream = null;
    client.on('error', () => { client.destroy(); upstream?.destroy(); });
    const target = authority(request.url);
    if (!target || !tunnels.has(target.key)) {
      refuse(target ? normalizeOrigin(`https://${request.url}`) : '(unparseable)');
      client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    let established = false;
    upstream = net.connect(target.port, target.host, () => {
      established = true;
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    track(upstream);
    upstream.on('error', () => {
      // Before the tunnel exists the client still speaks HTTP; afterwards any status line
      // would corrupt the tunnelled stream, so the connection is simply dropped.
      if (!established && !client.destroyed) client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      else client.destroy();
    });
    client.on('close', () => upstream.destroy());
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  server.unref();

  return {
    proxy: { server: `http://127.0.0.1:${server.address().port}`, bypass: bypassRules(allowedOrigins) },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
