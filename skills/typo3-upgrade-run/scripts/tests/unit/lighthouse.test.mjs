import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { stratifyByTemplate, withDeadline } from '../../lib/actions/sweep.mjs';
import { HarnessError } from '../../lib/cli/exit-codes.mjs';

const BASE = 'https://site.ddev.site/';
const u = (p) => `https://site.ddev.site${p}`;

// A sitemap shaped like a real one: mostly leaves, one section, and NO root —
// sitemap generators skip a shortcut home page, which is how it goes missing.
const SITEMAP = [
  u('/news/'), u('/news/a/'), u('/news/b/'), u('/news/c/'),
  u('/news/d/'), u('/news/e/'), u('/about/'), u('/contact/'),
];

describe('lighthouse sampling', () => {
  test('adds the site root when the sitemap omits it', () => {
    const picked = stratifyByTemplate(SITEMAP, 4, BASE);
    assert.ok(
      picked.some((x) => new URL(x).pathname === '/'),
      'the one URL every visitor loads must be in the sample',
    );
  });

  test('covers listing and detail, not just leaves', () => {
    const picked = stratifyByTemplate(SITEMAP, 4, BASE);
    const paths = picked.map((x) => new URL(x).pathname.replace(/\/+$/, '') || '/');
    assert.ok(paths.includes('/'), 'home');
    assert.ok(paths.includes('/news'), 'a listing — the slow template a uniform draw misses');
    assert.ok(paths.some((p) => p.startsWith('/news/')), 'a detail page');
  });

  test('is deterministic — a rerun audits the same pages', () => {
    const a = stratifyByTemplate(SITEMAP, 5, BASE);
    const b = stratifyByTemplate(SITEMAP, 5, BASE);
    assert.deepEqual(a, b);
  });

  test('respects the limit and never duplicates', () => {
    const picked = stratifyByTemplate(SITEMAP, 3, BASE);
    assert.equal(picked.length, 3);
    assert.equal(new Set(picked).size, 3);
  });

  test('returns everything when the sample is smaller than the limit', () => {
    const few = [u('/a/'), u('/b/')];
    assert.equal(stratifyByTemplate(few, 10, BASE).length, 3); // + the root
  });
});

describe('lighthouse deadline', () => {
  // The command used to HANG on DDEV's self-signed certificate rather than fail.
  // A gate that never returns cannot be told apart from a slow one.
  test('rejects instead of hanging forever', async () => {
    const never = new Promise(() => {});
    await assert.rejects(
      () => withDeadline(never, 40, 'timed out'),
      (err) => err instanceof HarnessError && /timed out/.test(err.message),
    );
  });

  test('passes the value through when it resolves in time', async () => {
    assert.equal(await withDeadline(Promise.resolve('ok'), 1000, 'nope'), 'ok');
  });

  test('does not keep the process alive after resolving', async () => {
    // A leaked timer here would hang the whole test run — which is the failure mode
    // this deadline exists to prevent in the first place.
    await withDeadline(Promise.resolve(1), 60_000, 'nope');
  });
});
