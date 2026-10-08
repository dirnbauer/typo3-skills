# External-scheme links: verify without clicking

A click on a `mailto:`, `tel:`, `sms:` or `callto:` link — or on any scheme the browser does not
render itself — makes Chromium, headless included, hand the URL to the operating system. On a
developer's Mac each click opens a real compose window in the default mail client (or FaceTime,
Messages, a chat app). TYPO3's spam-protected addresses (`config.spamProtectEmailAddresses`, rendered
as `a[href="#"][data-mailto-token][data-mailto-vector]`) do the same one step later: the core
decoder's click handler sets `location.href = 'mailto:…'`.

One journey that clicked 23 encoded links to check they decode opened 23 Apple Mail windows on the
developer's machine. `page.route('mailto:*')` did not help: external schemes never become network
requests, so routing, HAR replay and the egress proxy cannot intercept them.

## Rule

1. **Never click, press Enter on, `goto` or `window.open` an external-scheme link** in a journey.
   Assert its markup and decode it statically (below).
2. **Install the guard in every browser context** you create, before the first page, as a second line
   of defence for clicks you did not intend (state openers, crawlers, `getByRole('link')` picking the
   wrong match). Assert the guard's counter is `0` at the end of a journey that should not have
   touched such a link.
3. Use real navigation in tests of the guard itself: `page.setContent()` reopens the document, and
   `document.open()` erases `window` listeners.

## Guard

It only adds capture-phase listeners on `window`; no DOM node, attribute, style or timer changes, so
screenshots and serialized DOM stay byte-identical. The upgrade harness ships the same guard as
`skills/typo3-upgrade-run/scripts/lib/browser/external-guard.mjs` and installs it in every capture,
sweep, axe and backend context.

```js
const IN_BROWSER = ['http:', 'https:', 'about:', 'blob:', 'data:', 'javascript:', 'file:'];

export const EXTERNAL_HANDLER_GUARD = `(() => {
  if (!Object.prototype.hasOwnProperty.call(window, '__blockedExternal')) {
    Object.defineProperty(window, '__blockedExternal', { value: 0, writable: true, enumerable: false, configurable: true });
  }
  const inBrowser = ${JSON.stringify(IN_BROWSER)};
  const external = (raw) => {
    if (raw == null) return false;
    try { return !inBrowser.includes(new URL(String(raw), location.href).protocol.toLowerCase()); }
    catch { return false; }
  };
  const linkOf = (e) => (e.composedPath ? e.composedPath() : [e.target])
    .find((n) => n && (n.localName === 'a' || n.localName === 'area')) ?? null;
  const block = (e) => { e.preventDefault(); e.stopImmediatePropagation(); window.__blockedExternal += 1; };
  for (const type of ['click', 'auxclick']) {
    window.addEventListener(type, (e) => {
      const a = linkOf(e);
      if (!a || !a.getAttribute) return;
      if (a.hasAttribute('data-mailto-token') || external(a.getAttribute('href') ?? a.getAttribute('xlink:href'))) block(e);
    }, true);
  }
  window.addEventListener('submit', (e) => {
    const by = e.submitter;
    const action = by && by.hasAttribute && by.hasAttribute('formaction') ? by.getAttribute('formaction') : e.target.getAttribute?.('action');
    if (action != null && external(action)) block(e);
  }, true);
})();`;

// In a fixture or helper, before context.newPage():
await context.addInitScript(EXTERNAL_HANDLER_GUARD);
```

The capture-phase listener on `window` runs before any `document` handler, so the core decoder never
runs for a guarded click. Programmatic `location.href = 'mailto:…'` outside a click and
`form.submit()` are not covered: do not trigger them.

## Static decoder check

Prove that the encoded links still decode to the same addresses without navigating:

1. Compare each live `data-mailto-token`/`data-mailto-vector` pair with the reference render (as
   hashes; do not print addresses). `href` stays `#` and no plain `mailto:` link appears.
2. Find the one same-origin script the page actually serves that handles `data-mailto-token`.
3. Run **that served script** in the live page with a stand-in `document`/`window` whose
   `addEventListener` records the handler and whose `location.href` setter only records the value.
   Call the recorded click handler with a synthetic event for each live link.
4. Assert every link yields a `mailto:` URL, the handler cancelled the default, the decoded values
   equal the decode of the reference tokens (hashes), the page URL is unchanged and the guard
   counter is `0`.

```js
const result = await page.evaluate((code) => {
  const handlers = []; const captured = [];
  const stubDoc = {
    addEventListener: (type, fn) => handlers.push({ type, fn }),
    location: { set href(v) { captured.push(String(v)); }, get href() { return ''; } },
  };
  const stubWin = { open: () => null, document: stubDoc, location: stubDoc.location };
  // The served decoder sees only the stand-ins; the real location is never assigned.
  new Function('document', 'window', 'self', 'globalThis', code)(stubDoc, stubWin, stubWin, stubWin);
  return [...document.querySelectorAll('a[data-mailto-token]')].map((link) => {
    const before = captured.length; let prevented = false;
    const ev = { type: 'click', target: link, preventDefault() { prevented = true; } };
    for (const h of handlers.filter((x) => x.type === 'click')) h.fn(ev);
    return { decoded: captured.length > before ? captured.at(-1) : null, prevented };
  });
}, decoderSource);
```

For the reference side, decode the stored tokens in Node with the core algorithm (character ranges
43–58, 64–90 and 97–122, offset `-vector`, wrapping within each range) and compare hashes. When the
decoder reads `event.target.closest(...)` or other APIs, extend the stand-ins minimally; never fall
back to a real click.
