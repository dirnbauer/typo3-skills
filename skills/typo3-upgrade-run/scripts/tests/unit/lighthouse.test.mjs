import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import {
  finalLighthouseSample,
  lighthouseBudgetFindings,
  stratifyByTemplate,
  withDeadline,
  completeLighthouseAudit,
  readLighthouseBudget,
} from '../../lib/actions/sweep.mjs';
import { HarnessError, PreconditionError } from '../../lib/cli/exit-codes.mjs';

const BASE = 'https://site.ddev.site/';
const u = (p) => `https://site.ddev.site${p}`;

// A sitemap shaped like a real one: mostly leaves, one section, and NO root —
// sitemap generators skip a shortcut home page, which is how it goes missing.
const SITEMAP = [
  u('/news/'), u('/news/a/'), u('/news/b/'), u('/news/c/'),
  u('/news/d/'), u('/news/e/'), u('/about/'), u('/contact/'),
];

describe('lighthouse sampling', () => {
  test('final reporting always uses the homepage plus two seeded random pages', () => {
    const picked = finalLighthouseSample(SITEMAP, BASE, 'run-seed');
    assert.equal(picked.length, 3);
    assert.equal(new URL(picked[0]).pathname, '/');
    assert.deepEqual(picked, finalLighthouseSample([...SITEMAP].reverse(), BASE, 'run-seed'));
    assert.equal(new Set(picked).size, 3);
  });

  test('audits all available pages on a one- or two-page site without inventing URLs', () => {
    assert.deepEqual(finalLighthouseSample([u('/only/')], BASE, 'run-seed'), [BASE, u('/only/')]);
    assert.deepEqual(finalLighthouseSample([], BASE, 'run-seed'), [BASE]);
  });

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

describe('lighthouse quality budgets', () => {
  test('runtime errors, missing categories and null scores cannot pass', () => {
    const lhr = { categories: Object.fromEntries(['performance', 'accessibility', 'best-practices', 'seo'].map(k => [k, { score: 0.9 }])) };
    assert.equal(completeLighthouseAudit(lhr), true);
    for (const bad of [null, {}, { ...lhr, runtimeError: {} }, { categories: {} },
      { categories: { ...lhr.categories, seo: { score: null } } }]) assert.equal(completeLighthouseAudit(bad), false);
  });
  test('an empty, null or wrong-contract budget is a precondition failure', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 't3u-lh-budget-'));
    const file = path.join(root, 'budget.json');
    const valid = { performance: { lighthouse_performance_mobile: 80, lighthouse_best_practices: 95 },
      accessibility: { lighthouse_accessibility: 95 }, seo: { lighthouse_seo: 95 } };
    try {
      for (const bad of [null, {}, { contract_b: valid }, { contract_a: { performance: { lighthouse_performance_mobile: 0 } } }]) {
        await writeFile(file, JSON.stringify(bad));
        await assert.rejects(readLighthouseBudget(file, 'verify'), PreconditionError);
      }
      await writeFile(file, JSON.stringify({ contract_a: valid }));
      assert.deepEqual(await readLighthouseBudget(file, 'verify'), valid);
      await assert.rejects(readLighthouseBudget(file, 'elevation'), PreconditionError);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  test('turns measured misses into actionable quality-gap findings', () => {
    const results = [{
      url: u('/news/a/'),
      scores: {
        performance: { median: 82 },
        accessibility: { median: 100 },
        bestPractices: { median: 96 },
        seo: { median: 98 },
      },
      metrics: {
        lcp: { median: 3100 },
        cls: { median: 0.02 },
        tbt: { median: 90 },
        fcp: { median: 1200 },
        si: { median: 2600 },
      },
    }];
    const budget = {
      performance: {
        lighthouse_performance_mobile: 95,
        lighthouse_best_practices: 100,
        lcp_mobile_ms: 2500,
        cls: 0.05,
        tbt_ms: 200,
        fcp_ms: 1800,
        speed_index_ms: 3400,
      },
      accessibility: { lighthouse_accessibility: 100 },
      seo: { lighthouse_seo: 100 },
    };
    const findings = lighthouseBudgetFindings(results, budget, '500', 'mobile');
    assert.deepEqual(findings.map((finding) => finding.metric), [
      'scores.performance.median',
      'scores.bestPractices.median',
      'scores.seo.median',
      'metrics.lcp.median',
    ]);
    assert.ok(findings.every((finding) => finding.class === 'improvement'));
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
