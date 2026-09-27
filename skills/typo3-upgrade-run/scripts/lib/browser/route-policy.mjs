/**
 * Request policy for one browser context: an explicit allow-list of origins, for two reasons.
 *
 *  - Determinism: a Google Font or an analytics beacon that answers slowly on one run and
 *    fast on the next is a difference nobody caused.
 *  - Exfiltration: the page under test is untrusted customer content, and it is trivially
 *    able to phone home.
 *
 * Enforced for a context created with `egressProxy()` and then `attach()`ed:
 *
 *  1. The first URL of every page request (document, subresource, fetch/XHR): the route handler
 *     continues allow-listed origins and aborts everything else (`blockedbyclient`).
 *  2. Everything the route handler never sees — redirect hops after route.continue(),
 *     service-worker fetches, WebSockets, Playwright's Node-side route.fetch(): Chromium sends
 *     whatever is outside the exact allowed origins (scheme, host AND port) to a local proxy that
 *     refuses it (egress-proxy.mjs). Allow-listed traffic bypasses that proxy untouched, so allowed
 *     pages render exactly as before.
 *  3. A redirect hop from an allowed URL to another origin is also recorded against its page
 *     (takeRedirectViolations); a capture turns it into an error, like a navigation-guard
 *     violation. (1) and (2) prevent the request; (3) makes the attempt visible.
 *
 * Every refusal from (1) and (2) is COUNTED in blockedOrigins/blockedRequests. Silent blocking
 * would trade one invisible problem for another.
 *
 * NOT enforced here:
 *  - A context created without egressProxy() gets (1) and (3) only; report().egress says so.
 *  - Name resolution: the allow-list governs connections, not DNS lookups.
 *  - Traffic an HTTP proxy cannot carry, such as WebRTC UDP.
 *  - Other processes: Lighthouse's own Chrome, ddev and composer. (Every harness path that loads
 *    pages uses this policy; the remaining Chromium launches only read the browser version.)
 *
 * Sealed media adapters (stabilization.media) see only requests this policy already allowed;
 * they never widen what may load. See media-adapters.mjs.
 */

import { normalizeOrigin } from '../net/url-guard.mjs';
import { createMediaAdapters } from './media-adapters.mjs';
import { startEgressProxy } from './egress-proxy.mjs';

export function createRoutePolicy({
  allowedOrigins = [],
  blockThirdParty = true,
  media = null,
  imageMagick = null,
  gifConverter = null,
} = {}) {
  const allowed = new Set(allowedOrigins.map(normalizeOrigin));
  const blocked = new Map();
  const permitted = new Map();
  const adapters = media ? createMediaAdapters(media, { imageMagick, gifConverter }) : null;
  const redirects = new WeakMap();   // page -> [{ from, to }]
  let redirectViolations = 0;
  let egressStart = null;
  const countBlocked = (origin) => blocked.set(origin, (blocked.get(origin) ?? 0) + 1);

  const decide = (rawUrl) => {
    let origin;
    try { origin = normalizeOrigin(new URL(rawUrl).origin); }
    catch { return { allow: false, origin: '(unparseable)' }; }
    if (!blockThirdParty) return { allow: true, origin };
    return { allow: allowed.has(origin), origin };
  };

  let closing = null;
  const close = () => {
    closing ??= (async () => {
      const proxy = await egressStart?.catch(() => null);
      await proxy?.close();
    })();
    return closing;
  };

  return {
    decide,
    allowedOrigins: [...allowed],

    /**
     * Proxy settings for browser.newContext(), requested BEFORE the context exists: they are what
     * makes Chromium's own network stack obey the allow-list for everything route() cannot see.
     */
    async egressProxy() {
      if (!blockThirdParty) return undefined;
      egressStart ??= startEgressProxy(allowedOrigins, { onRefused: countBlocked });
      return (await egressStart).proxy;
    },

    /** Attach to a Playwright BrowserContext; its close also stops the egress proxy. */
    async attach(context) {
      await context.route('**/*', async (route) => {
        const url = route.request().url();
        const { allow, origin } = decide(url);
        if (allow) {
          permitted.set(origin, (permitted.get(origin) ?? 0) + 1);
          if (adapters?.enabled && await adapters.handle(route)) return;
          return route.continue();
        }
        countBlocked(origin);
        return route.abort('blockedbyclient');
      });
      // Detection for (3). The hop itself was refused by the egress proxy and counted there.
      context.on('request', (request) => {
        const from = request.redirectedFrom();
        if (!from) return;
        const hop = decide(request.url());
        if (hop.allow) return;
        redirectViolations += 1;
        let page = null;
        try { page = request.frame()?.page() ?? null; } catch { page = null; }   // service workers have no frame
        if (!page) return;
        const list = redirects.get(page) ?? [];
        list.push({ from: decide(from.url()).origin, to: hop.origin });
        redirects.set(page, list);
      });
      context.once('close', () => { close().catch(() => {}); });
    },

    /** Redirect hops to non-allowed origins recorded for one page since the last call. */
    takeRedirectViolations(page) {
      const list = redirects.get(page) ?? [];
      redirects.delete(page);
      return list;
    },

    /** Transformed-media evidence and adapter failures for one page since the last call. */
    takePageMedia(page) {
      return adapters ? adapters.takePage(page) : { resources: [], failures: [] };
    },

    report() {
      return {
        blockThirdParty,
        egress: !blockThirdParty ? 'open' : (egressStart ? 'proxy' : 'route-only'),
        allowedOrigins: [...allowed],
        blockedOrigins: Object.fromEntries([...blocked.entries()].sort()),
        blockedRequests: [...blocked.values()].reduce((a, b) => a + b, 0),
        permittedRequests: [...permitted.values()].reduce((a, b) => a + b, 0),
        redirectViolations,
        ...(adapters?.enabled ? { media: adapters.report() } : {}),
      };
    },

    /** Stop the egress proxy. Idempotent; attach() also calls it when the context closes. */
    close,
  };
}

/**
 * Quiet-period detector.
 *
 * networkidle is explicitly NOT used: it is unreliable and, worse, it hides which requests
 * were in flight. Counting them ourselves means a page that never settles tells us what it
 * was waiting for.
 */
export function createQuietDetector(page, { quietMs = 500, hardCapMs = 15000 } = {}) {
  const pending = new Set();
  // Playwright can emit the same request object more than once around redirects. Counting
  // events therefore leaks an in-flight request even after the object has completed and
  // makes every page consume the hard timeout. Track request identities instead.
  const onRequest = (req) => { pending.add(req); };
  const onDone = (req) => { pending.delete(req); };

  page.on('request', onRequest);
  page.on('requestfinished', onDone);
  page.on('requestfailed', onDone);

  return {
    async wait() {
      const started = Date.now();
      let quietSince = null;
      while (Date.now() - started < hardCapMs) {
        if (pending.size === 0) {
          quietSince ??= Date.now();
          if (Date.now() - quietSince >= quietMs) break;
        } else {
          quietSince = null;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      const timedOut = Date.now() - started >= hardCapMs;
      return {
        timedOut,
        stillPending: timedOut ? [...pending].slice(0, 10).map((req) => req.url()) : [],
      };
    },
    dispose() {
      page.off('request', onRequest);
      page.off('requestfinished', onDone);
      page.off('requestfailed', onDone);
    },
  };
}

/**
 * Guard every navigation, including ones the page initiates itself. A redirect chain that
 * ends off-origin must abort the capture rather than quietly photograph a foreign site.
 */
export function attachNavigationGuard(page, guard, trustedOrigin, { onViolation } = {}) {
  const violations = [];
  const check = (url) => {
    try {
      guard.assertSameOrigin(url, trustedOrigin, { purpose: 'navigation' });
    } catch (err) {
      violations.push({ url: String(url).slice(0, 200), error: err.message });
      onViolation?.(err, url);
      throw err;
    }
  };
  const onNavigated = (frame) => {
    if (frame !== page.mainFrame()) return;
    const url = frame.url();
    // The browser's own inert states are not cross-origin escapes: about:blank fires
    // framenavigated during page.close() teardown (racing dispose() in the caller's
    // finally), and a blocked or aborted navigation ends with a null origin. Asserting
    // them — or throwing at all inside Playwright's emitter, where nothing catches —
    // crashed a 10-worker exhaustive run. Real escapes remain covered twice over: the
    // synchronous post-goto assertSameOrigin, and the route policy aborting the network
    // request itself. This event tripwire records and stays quiet.
    if (url === '' || url === 'about:blank' || url === 'about:srcdoc') return;
    try {
      if (new URL(url).origin === 'null') return;
    } catch { /* unparseable: fall through and record it as a violation */ }
    try { check(url); } catch { /* recorded in `violations` and via onViolation */ }
  };
  page.on('framenavigated', onNavigated);
  return {
    check,
    violations,
    dispose() {
      page.off('framenavigated', onNavigated);
    },
  };
}
