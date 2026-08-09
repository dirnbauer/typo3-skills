import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { attachNavigationGuard } from '../../lib/browser/route-policy.mjs';

/** Minimal fake Playwright page: one main frame, capturable event handlers. */
function fakePage() {
  const handlers = {};
  const frame = { url: () => frame._url, _url: 'about:blank' };
  return {
    frame,
    emit: (ev) => handlers[ev]?.(frame),
    mainFrame: () => frame,
    on: (ev, fn) => { handlers[ev] = fn; },
    off: (ev) => { delete handlers[ev]; },
  };
}

const ORIGIN = 'https://acme.ddev.site';
const stubGuard = {
  assertSameOrigin(url, origin) {
    if (!String(url).startsWith(origin)) {
      const err = new Error(`Cross-origin navigation: ${url}`);
      err.exitCode = 5;
      throw err;
    }
  },
};

describe('navigation guard event path', () => {
  test('inert browser states are ignored: about:blank, about:srcdoc, empty, null-origin', () => {
    const page = fakePage();
    const guard = attachNavigationGuard(page, stubGuard, ORIGIN);
    for (const url of ['about:blank', 'about:srcdoc', '', 'data:text/html,x']) {
      page.frame._url = url;
      page.emit('framenavigated'); // must not throw
    }
    assert.equal(guard.violations.length, 0, 'inert states are not violations');
    guard.dispose();
  });

  test('a real cross-origin frame navigation records, notifies, and does NOT throw into the emitter', () => {
    const page = fakePage();
    const seen = [];
    const guard = attachNavigationGuard(page, stubGuard, ORIGIN, { onViolation: (e, u) => seen.push(u) });
    page.frame._url = 'https://evil.example/steal';
    page.emit('framenavigated'); // an unhandled throw here crashed a 10-worker run
    assert.equal(guard.violations.length, 1);
    assert.match(guard.violations[0].error, /Cross-origin/);
    assert.deepEqual(seen, ['https://evil.example/steal']);
    guard.dispose();
  });

  test('the synchronous check() path still throws for direct callers', () => {
    const page = fakePage();
    const guard = attachNavigationGuard(page, stubGuard, ORIGIN);
    assert.throws(() => guard.check('https://evil.example/'), /Cross-origin/);
    assert.doesNotThrow(() => guard.check(`${ORIGIN}/fine`));
    guard.dispose();
  });

  test('same-origin frame navigations pass silently', () => {
    const page = fakePage();
    const guard = attachNavigationGuard(page, stubGuard, ORIGIN);
    page.frame._url = `${ORIGIN}/page`;
    page.emit('framenavigated');
    assert.equal(guard.violations.length, 0);
    guard.dispose();
  });
});
