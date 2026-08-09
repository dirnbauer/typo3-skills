/**
 * Bounded-concurrency map that preserves order.
 *
 * Results are returned (and can be applied) in ITEM order, never completion order —
 * evidence files and indexes must be byte-identical regardless of which worker finished
 * first, or parallelism itself would read as non-determinism. Errors do not abort the
 * pool: each slot resolves to { ok, value | error } so the caller decides, per item and
 * in order, what an error means.
 */
export async function mapPool(items, limit, fn) {
  const n = Math.max(1, Math.min(Number(limit) || 1, items.length || 1));
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      try {
        results[i] = { ok: true, value: await fn(items[i], i) };
      } catch (error) {
        results[i] = { ok: false, error };
      }
    }
  };
  await Promise.all(Array.from({ length: n }, worker));
  return results;
}
