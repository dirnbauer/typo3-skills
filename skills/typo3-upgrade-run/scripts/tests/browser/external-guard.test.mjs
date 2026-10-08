// Real Chromium: the guard cancels a trusted click on mailto/tel and TYPO3-encoded links before the
// page's own handler, and a capture with the guard is byte-identical to one without it.
// Safety net: a bubble-phase window listener also cancels the click, so even a broken guard can
// never hand a URL to the operator's mail client while this test runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { installExternalHandlerGuard } from '../../lib/browser/external-guard.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const html = `<!doctype html><html><body style="margin:0;font:16px sans-serif">
<p><a id="enc" href="#" data-mailto-token="kygjrm8nnmqrYcvyknjc,mpe" data-mailto-vector="2">office(at)example.org</a></p>
<p><a id="mail" href="mailto:office@example.org">Write</a> <a id="tel" href="tel:+431234567">Call</a></p>
<p><a id="local" href="#here">Local</a></p>
<script>
  window.pageHandlerRan = 0; window.safetyNet = 0;
  // Stand-in for the TYPO3 core decoder: it would set location.href = 'mailto:…'. Here it only counts.
  document.addEventListener('click', (e) => { if (e.target.closest('a')) window.pageHandlerRan += 1; });
  window.addEventListener('click', (e) => { const a = e.target.closest('a'); if (a && a.id !== 'local') { e.preventDefault(); window.safetyNet += 1; } });
</script></body></html>`;

test('external-scheme clicks are cancelled before page handlers; captures stay byte-identical', { timeout: 60_000 }, async () => {
  const browser = await chromium.launch();
  try {
    const shots = []; const doms = [];
    for (const guarded of [false, true]) {
      const context = await browser.newContext({ viewport: { width: 400, height: 160 } });
      if (guarded) await installExternalHandlerGuard(context);
      const page = await context.newPage();
      // A real navigation, not setContent: document.open() would erase window listeners.
      await page.route('https://guard.test/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
      await page.goto('https://guard.test/');
      shots.push(await page.screenshot());
      doms.push(await page.evaluate(() => document.documentElement.outerHTML));
      if (guarded) {
        for (const id of ['enc', 'mail', 'tel']) await page.click(`#${id}`);
        await page.click('#local');
        const state = await page.evaluate(() => ({
          blocked: window.__t3uBlockedExternal, page: window.pageHandlerRan, net: window.safetyNet, hash: location.hash,
        }));
        assert.deepEqual(state, { blocked: 3, page: 1, net: 0, hash: '#here' }, 'only the local link reached the page');
      }
      await context.close();
    }
    assert.equal(doms[0], doms[1], 'DOM unchanged by the guard');
    assert.ok(Buffer.compare(shots[0], shots[1]) === 0, 'screenshots must be byte-identical');
  } finally {
    await browser.close();
  }
});
