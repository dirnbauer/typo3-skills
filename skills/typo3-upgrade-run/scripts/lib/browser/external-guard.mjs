/**
 * Never hand a URL to the operating system.
 *
 * A click on a mailto:/tel:/sms:/callto: link (or any other scheme the browser does not render
 * itself) makes Chromium — headless too — pass the URL to the desktop's default handler: on the
 * operator's Mac every such click opens a real Apple Mail compose window, FaceTime or a chat app.
 * TYPO3's spam-protected addresses (`a[href="#"][data-mailto-token][data-mailto-vector]`) do the
 * same one step later: the core decoder sets `location.href = 'mailto:…'` in its click handler.
 * `page.route()` cannot intercept these: external schemes never become network requests.
 *
 * The guard is an init script for every harness context. In the capture phase on `window`, before
 * any page handler (the core decoder included), it cancels click/auxclick on such links and submit
 * of forms whose action is such a scheme, and counts each cancel in the non-enumerable
 * `window.__t3uBlockedExternal`. It registers listeners only: no DOM node, attribute, style or
 * timer is touched, so captures stay byte-identical. Proof journeys must still not click these
 * links at all; verify a decoder statically (typo3-playwright, "External-scheme links").
 */

/** Schemes the browser renders itself. Everything else on a link is handed to the OS. */
export const IN_BROWSER_SCHEMES = Object.freeze(['http:', 'https:', 'about:', 'blob:', 'data:', 'javascript:', 'file:']);

// No early return on a second run: document.open() erases window listeners but keeps window
// properties, and a doubled listener is harmless (the first one stops immediate propagation).
export const EXTERNAL_HANDLER_GUARD = `(() => {
  if (!Object.prototype.hasOwnProperty.call(window, '__t3uBlockedExternal')) {
    Object.defineProperty(window, '__t3uBlockedExternal', { value: 0, writable: true, enumerable: false, configurable: true });
  }
  const inBrowser = ${JSON.stringify(IN_BROWSER_SCHEMES)};
  const external = (raw) => {
    if (raw === null || raw === undefined) return false;
    let protocol = '';
    try { protocol = new URL(String(raw), location.href).protocol.toLowerCase(); } catch { return false; }
    return !inBrowser.includes(protocol);
  };
  const linkOf = (e) => {
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [e.target];
    for (const n of path) {
      const name = n && typeof n.localName === 'string' ? n.localName.toLowerCase() : '';
      if (name === 'a' || name === 'area') return n;
    }
    return null;
  };
  const block = (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    window.__t3uBlockedExternal += 1;
  };
  for (const type of ['click', 'auxclick']) {
    window.addEventListener(type, (e) => {
      const link = linkOf(e);
      if (!link || typeof link.getAttribute !== 'function') return;
      const href = link.getAttribute('href') ?? link.getAttribute('xlink:href');
      if (link.hasAttribute('data-mailto-token') || external(href)) block(e);
    }, true);
  }
  window.addEventListener('submit', (e) => {
    const form = e.target;
    if (!form || typeof form.getAttribute !== 'function') return;
    const by = e.submitter;
    const action = by && typeof by.hasAttribute === 'function' && by.hasAttribute('formaction')
      ? by.getAttribute('formaction') : form.getAttribute('action');
    if (action !== null && external(action)) block(e);
  }, true);
})();`;

/** Install the guard on a Playwright BrowserContext before its first page. */
export async function installExternalHandlerGuard(context) {
  await context.addInitScript(EXTERNAL_HANDLER_GUARD);
  return context;
}
