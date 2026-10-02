// The per-request TYPO3 content-exception code is normalised in pixels exactly like in the DOM stage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { settleScript } from '../../lib/browser/stabilize.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const page = (code) => `<!doctype html><html><body style="margin:0;font:16px sans-serif">
<main id="main">
	Oops, an error occurred! Code: ${code}
</main><p>Other text with Code: 12345 stays.</p></body></html>`;

test('two requests of a failing element render identical pixels once the exception code is normalised', { timeout: 60_000 }, async () => {
  const browser = await chromium.launch();
  try {
    const shots = [], reports = [], texts = [];
    for (const code of ['2026100205242378a1dbe4', '20261002052356eccafe5a']) {
      const context = await browser.newContext({ viewport: { width: 400, height: 120 } });
      const p = await context.newPage();
      await p.setContent(page(code));
      reports.push(await p.evaluate(settleScript({})));
      texts.push(await p.evaluate(() => document.body.innerText));
      shots.push(await p.screenshot());
      await context.close();
    }
    assert.equal(reports[0].normalizedTexts['typo3-exception-code'], 1);
    assert.equal(reports[1].normalizedTexts['typo3-exception-code'], 1);
    assert.match(texts[0], /Oops, an error occurred! Code: <CODE>/);
    assert.match(texts[0], /Other text with Code: 12345 stays\./);
    assert.equal(texts[0], texts[1]);
    assert.ok(Buffer.compare(shots[0], shots[1]) === 0, 'screenshots must be byte-identical');
  } finally {
    await browser.close();
  }
});
