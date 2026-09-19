import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { WorkerPool } from '../../lib/util/worker-pool.mjs';
import { comparePairPixelmatch } from '../../lib/compare/image.mjs';

test('CPU jobs use separate persistent worker threads and retain ordered caller results', async () => {
  const pool = new WorkerPool(new URL('../fixtures/cpu-worker.mjs', import.meta.url), { size: 3 });
  try {
    const results = await Promise.all(Array.from({ length: 12 }, (_, value) => pool.run({ value })));
    assert.deepEqual(results.map(r => r.value), Array.from({ length: 12 }, (_, i) => i));
    assert.equal(new Set(results.map(r => r.threadId)).size, 3);
  } finally { await pool.close(); }
});
test('a CPU worker crash or timeout fails all outstanding jobs instead of losing coverage', async () => {
  for (const input of [{ crash: true }, { hang: true }]) {
    const pool = new WorkerPool(new URL('../fixtures/cpu-worker.mjs', import.meta.url), { size: 1, timeoutMs: 300 });
    try {
      const results = await Promise.allSettled([pool.run(input), pool.run({ value: 2 })]);
      assert.ok(results.every(result => result.status === 'rejected'));
      await assert.rejects(pool.run({ value: 3 }));
    } finally { await pool.close(); }
  }
});
test('parallel Pixelmatch preserves serial metrics and diff bytes, including layout differences', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 't3u-pixels-'));
  const pool = new WorkerPool(new URL('../../lib/compare/pixelmatch-worker.mjs', import.meta.url), { size: 3 });
  try {
    const png = (width, height, color) => {
      const image = new PNG({ width, height });
      for (let i = 0; i < image.data.length; i += 4) image.data.set(color, i);
      return PNG.sync.write(image);
    };
    const before = path.join(root, 'before.png');
    await writeFile(before, png(32, 32, [255, 0, 0, 255]));
    const cases = [[32, 32, [255, 0, 0, 255]], [32, 32, [0, 0, 255, 255]], [32, 40, [255, 0, 0, 255]]];
    await Promise.all(cases.map(async ([width, height, color], id) => {
      const after = path.join(root, `${id}.png`), serialDiff = path.join(root, `${id}-serial.png`), parallelDiff = path.join(root, `${id}-parallel.png`);
      await writeFile(after, png(width, height, color));
      const serial = await comparePairPixelmatch(before, after, serialDiff, { threshold: 0 });
      const parallel = await pool.run({ before, after, diff: parallelDiff, options: { threshold: 0 } });
      assert.deepEqual(parallel, serial);
      if (serial.diffPixels > 0) assert.deepEqual(await readFile(parallelDiff), await readFile(serialDiff));
    }));
    await assert.rejects(pool.run({ before, after: path.join(root, 'missing.png') }), /ENOENT/);
  } finally { await pool.close(); await rm(root, { recursive: true, force: true }); }
});
