// The external-scheme guard cancels mailto:/tel:/… activations before any page handler and
// touches nothing else. Run in a vm with a fake window, so no browser (and no mail client) is involved.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { EXTERNAL_HANDLER_GUARD, IN_BROWSER_SCHEMES, installExternalHandlerGuard } from '../../lib/browser/external-guard.mjs';
import { newContext } from '../../lib/browser/launch.mjs';

function sandbox(href = 'https://acme.ddev.site/kontakt/') {
  const listeners = [];
  const window = {
    addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture }),
  };
  const ctx = vm.createContext({ window, location: { href }, URL, Object, String, JSON });
  vm.runInContext(EXTERNAL_HANDLER_GUARD, ctx);
  return { window, listeners, ctx };
}

function el(localName, attrs = {}) {
  return {
    localName,
    getAttribute: (n) => (Object.hasOwn(attrs, n) ? attrs[n] : null),
    hasAttribute: (n) => Object.hasOwn(attrs, n),
  };
}

function fire(box, type, path, extra = {}) {
  const ev = {
    type, target: path[0], composedPath: () => path, defaultPrevented: false, stopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopImmediatePropagation() { this.stopped = true; },
    ...extra,
  };
  for (const l of box.listeners.filter((x) => x.type === type)) l.fn(ev);
  return ev;
}

describe('external handler guard', () => {
  test('registers capture-phase listeners on window only', () => {
    const box = sandbox();
    assert.deepEqual(box.listeners.map((l) => [l.type, l.capture]), [['click', true], ['auxclick', true], ['submit', true]]);
    assert.equal(box.window.__t3uBlockedExternal, 0);
    assert.equal(Object.keys(box.window).includes('__t3uBlockedExternal'), false, 'counter is not enumerable');
  });

  test('cancels TYPO3 spam-protected links and every OS-handled scheme', () => {
    const box = sandbox();
    const cases = [
      el('a', { href: '#', 'data-mailto-token': 'kygjrm8', 'data-mailto-vector': '2' }),
      el('a', { href: 'mailto:office@example.org' }),
      el('a', { href: '  MAILTO:office@example.org' }),
      el('a', { href: 'tel:+431234567' }),
      el('a', { href: 'sms:+431234567' }),
      el('a', { href: 'callto:someone' }),
      el('a', { href: 'facetime:someone' }),
      el('a', { href: 'webcal://example.org/cal.ics' }),
      el('area', { href: 'mailto:map@example.org' }),
      el('a', { 'xlink:href': 'tel:+43123' }),
    ];
    for (const [i, link] of cases.entries()) {
      const ev = fire(box, i % 2 ? 'auxclick' : 'click', [el('span'), link, el('body')]);
      assert.ok(ev.defaultPrevented && ev.stopped, JSON.stringify(link.getAttribute('href')));
    }
    assert.equal(box.window.__t3uBlockedExternal, cases.length);
  });

  test('leaves ordinary links, buttons and in-browser schemes alone', () => {
    const box = sandbox();
    const cases = [
      [el('a', { href: '/kontakt/' })],
      [el('a', { href: 'https://example.org/' })],
      [el('a', { href: '#main' })],
      [el('a', { href: 'javascript:void(0)' })],
      [el('a')],
      [el('button', { type: 'button' }), el('nav')],
      [el('span'), el('div')],
    ];
    for (const path of cases) {
      const ev = fire(box, 'click', path);
      assert.equal(ev.defaultPrevented || ev.stopped, false);
    }
    assert.equal(box.window.__t3uBlockedExternal, 0);
  });

  test('cancels a submit to a mailto: action, keeps a local one', () => {
    const box = sandbox();
    assert.ok(fire(box, 'submit', [el('form', { action: 'mailto:x@example.org' })]).defaultPrevented);
    assert.ok(fire(box, 'submit', [el('form', { action: '/send' })], { submitter: el('button', { formaction: 'mailto:y@example.org' }) }).defaultPrevented);
    assert.equal(fire(box, 'submit', [el('form', { action: '/send' })]).defaultPrevented, false);
    assert.equal(fire(box, 'submit', [el('form')]).defaultPrevented, false);
    assert.equal(box.window.__t3uBlockedExternal, 2);
  });

  test('a second run re-arms the listeners and still counts a cancel once', () => {
    const box = sandbox();
    vm.runInContext(EXTERNAL_HANDLER_GUARD, box.ctx);
    assert.equal(box.listeners.length, 6);
    const link = el('a', { href: 'mailto:x@example.org' });
    const ev = { type: 'click', target: link, composedPath: () => [link], stopped: false, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
    for (const l of box.listeners.filter((x) => x.type === 'click')) { if (ev.stopped) break; l.fn(ev); }
    assert.ok(ev.defaultPrevented);
    assert.equal(box.window.__t3uBlockedExternal, 1);
  });

  test('the script touches no DOM, style or timer API', () => {
    for (const forbidden of ['document', 'setTimeout', 'setInterval', 'requestAnimationFrame', 'style', 'appendChild', 'setAttribute', 'MutationObserver']) {
      assert.equal(EXTERNAL_HANDLER_GUARD.includes(forbidden), false, forbidden);
    }
    assert.ok(IN_BROWSER_SCHEMES.includes('https:') && !IN_BROWSER_SCHEMES.includes('mailto:'));
  });

  test('every harness context gets the guard before its first page', async () => {
    const scripts = [];
    const context = { addInitScript: async (s) => { scripts.push(s); } };
    const browser = { newContext: async () => context };
    assert.equal(await newContext(browser, { viewport: 'desktop' }), context);
    assert.equal(scripts[0], EXTERNAL_HANDLER_GUARD);
    assert.equal(scripts.length, 2, 'guard plus the unchanged stabilisation script');
    const other = [];
    await installExternalHandlerGuard({ addInitScript: async (s) => { other.push(s); } });
    assert.deepEqual(other, [EXTERNAL_HANDLER_GUARD]);
  });

  test('standalone browser scripts install the guard on their own contexts', async () => {
    for (const file of ['a11y-audit.mjs', 'backend-write-roundtrip.mjs']) {
      const source = await readFile(new URL(`../../${file}`, import.meta.url), 'utf8');
      assert.match(source, /await installExternalHandlerGuard\(ctx\);/, file);
    }
  });
});
