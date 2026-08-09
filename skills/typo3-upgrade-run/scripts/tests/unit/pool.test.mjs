import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mapPool } from '../../lib/util/pool.mjs';

describe('bounded-concurrency pool', () => {
  test('results come back in ITEM order regardless of completion order', async () => {
    // Reverse-sorted delays: the last item finishes first if order were completion-driven.
    const items = [30, 20, 10, 0];
    const out = await mapPool(items, 4, async (ms, i) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return `item-${i}`;
    });
    assert.deepEqual(out.map((o) => o.value), ['item-0', 'item-1', 'item-2', 'item-3']);
    assert.ok(out.every((o) => o.ok));
  });

  test('concurrency never exceeds the limit', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapPool(Array.from({ length: 20 }, (_, i) => i), 3, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
    });
    assert.ok(peak <= 3, `peak concurrency ${peak} exceeded limit 3`);
    assert.ok(peak >= 2, 'pool never actually ran concurrently');
  });

  test('an error occupies its own ordered slot and aborts nothing else', async () => {
    const out = await mapPool([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('boom');
      return n * 10;
    });
    assert.equal(out[0].ok, true);
    assert.equal(out[0].value, 10);
    assert.equal(out[1].ok, false);
    assert.equal(out[1].error.message, 'boom');
    assert.equal(out[2].ok, true);
    assert.equal(out[2].value, 30);
  });

  test('empty input resolves to an empty result without invoking the worker', async () => {
    let called = 0;
    const out = await mapPool([], 4, async () => { called += 1; });
    assert.deepEqual(out, []);
    assert.equal(called, 0);
  });
});
