import { describe, expect, it } from 'vitest';
import { mapSettled, mapWithConcurrency } from './concurrency';

describe('mapWithConcurrency', () => {
  it('returns [] for empty input', async () => {
    const out = await mapWithConcurrency([], 4, async () => 1);
    expect(out).toEqual([]);
  });

  it('throws on concurrency < 1', async () => {
    await expect(mapWithConcurrency([1], 0, async (x) => x)).rejects.toThrow();
  });

  it('preserves order and returns all results', async () => {
    const out = await mapWithConcurrency(
      [1, 2, 3, 4, 5],
      2,
      async (x) => x * 10
    );
    expect(out).toEqual([10, 20, 30, 40, 50]);
  });

  it('respects the concurrency cap', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 3, async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight -= 1;
      return 0;
    });
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it('rejects on first error', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (x) => {
        if (x === 2) throw new Error('boom');
        return x;
      })
    ).rejects.toThrow('boom');
  });
});

describe('mapSettled', () => {
  it('returns per-item settled results in order', async () => {
    const out = await mapSettled([1, 2, 3], 2, async (x) => {
      if (x === 2) throw new Error('boom');
      return x * 10;
    });
    expect(out).toEqual([
      { status: 'fulfilled', value: 10 },
      { status: 'rejected', reason: expect.any(Error) },
      { status: 'fulfilled', value: 30 },
    ]);
  });

  it('continues past per-item errors', async () => {
    const out = await mapSettled([1, 2, 3, 4], 2, async (x) => {
      if (x % 2 === 0) throw new Error(`item ${x}`);
      return x;
    });
    const fulfilled = out
      .filter((r) => r.status === 'fulfilled')
      .map((r) => (r as { value: number }).value);
    expect(fulfilled).toEqual([1, 3]);
  });
});
