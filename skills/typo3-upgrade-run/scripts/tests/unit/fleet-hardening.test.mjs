import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { contaminationReasons } from '../../lib/browser/session.mjs';
import { aggregateAxeViolations, finalAxeSample } from '../../lib/actions/sweep.mjs';
import { inspectViteManifest } from '../../vite-production-check.mjs';

describe('clean frontend evidence', () => {
  test('rejects an injected TYPO3 Admin Panel or backend session', () => {
    assert.deepEqual(contaminationReasons({ markers: [], cookieNames: [] }), []);
    assert.match(
      contaminationReasons({ markers: ['#typo3-adminPanel'], cookieNames: ['be_typo_user'] }).join(' '),
      /Admin|admin UI|be_typo_user/i,
    );
  });
});

describe('representative axe evidence', () => {
  test('clusters repeated page failures by root rule, viewport, and visible state', () => {
    const observations = ['/a', '/b'].map((url) => ({
      url, viewport: 'mobile', state: 'nav-open',
      violations: [{ id: 'color-contrast', impact: 'serious', nodes: 2, targets: ['.nav a'] }],
    }));
    const clusters = aggregateAxeViolations(observations);
    assert.equal(clusters.length, 1);
    assert.equal(clusters[0].pages, 2);
    assert.equal(clusters[0].nodes, 4);
  });

  test('keeps the homepage and template diversity in a bounded sample', () => {
    const manifest = {
      baseUrl: 'https://site.ddev.site/',
      allUrls: ['/news/', '/news/a/', '/news/b/', '/contact/']
        .map((value) => ({ url: `https://site.ddev.site${value}` })),
    };
    const sample = finalAxeSample(manifest, 3);
    assert.equal(sample.length, 3);
    assert.ok(sample.some((url) => new URL(url).pathname === '/'));
    assert.ok(sample.some((url) => new URL(url).pathname === '/news/'));
  });

  test('rejects too-small samples that cannot prove representative states', () => {
    assert.throws(
      () => finalAxeSample({
        baseUrl: 'https://site.ddev.site/',
        allUrls: [{ url: 'https://site.ddev.site/contact/' }],
      }, 3),
      /at least three distinct frontend URLs/,
    );
  });
});

describe('Vite production artifact', () => {
  test('requires complete hashed outputs and resolvable manifest dependencies', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 't3u-vite-'));
    await mkdir(path.join(root, 'assets'), { recursive: true });
    await Promise.all([
      writeFile(path.join(root, 'assets/main-AbCdEf12.js'), ''),
      writeFile(path.join(root, 'assets/main-ZyXwVu98.css'), ''),
    ]);
    const manifestPath = path.join(root, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify({
      'src/main.js': {
        file: 'assets/main-AbCdEf12.js',
        css: ['assets/main-ZyXwVu98.css'],
        isEntry: true,
      },
    }));
    assert.equal((await inspectViteManifest({ manifestPath, publicRoot: root })).verdict, 'pass');

    await writeFile(manifestPath, JSON.stringify({
      'src/main.js': { file: 'assets/main.js', imports: ['missing.js'], isEntry: true },
    }));
    const broken = await inspectViteManifest({ manifestPath, publicRoot: root });
    assert.equal(broken.verdict, 'findings');
    assert.deepEqual(
      [...new Set(broken.findings.map((finding) => finding.code))].sort(),
      ['missing-manifest-dependency', 'missing-output', 'unhashed-output'],
    );
  });
});
