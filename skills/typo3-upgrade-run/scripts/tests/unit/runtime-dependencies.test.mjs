import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import uri from 'fast-uri';
import { supportsNodeVersion } from '../../lib/actions/core.mjs';

test('doctor enforces the Lighthouse Node runtime floor including its minor version', async () => {
  const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(await readFile(new URL('../../package-lock.json', import.meta.url), 'utf8'));
  assert.equal(manifest.engines.node, '>=22.19');
  assert.deepEqual(lock.packages[''].engines, manifest.engines);
  for (const version of ['20.20.2', '21.7.3', '22.0.0', '22.18.99', '24.0.0-rc.1', 'invalid']) {
    assert.equal(supportsNodeVersion(version), false, version);
  }
  for (const version of ['22.19.0', '22.23.4', '24.0.0', '24.22.1', '26.12.1']) {
    assert.equal(supportsNodeVersion(version), true, version);
  }
});

// GHSA-hrr3-gc8f-f4qj: scheme-relative hosts must be canonicalized after percent decoding.
test('fast-uri canonicalizes encoded host case consistently', () => {
  assert.equal(uri.parse('//%41.com').host, 'a.com');
  assert.equal(uri.equal('//%41.com', '//a.com'), true);
});
