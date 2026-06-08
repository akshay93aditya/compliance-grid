// Small bounded-concurrency primitive. No external dep.
//
// Usage:
//   await mapWithConcurrency(items, 4, async (item) => { ... });
//
// Preserves item order in the returned array. Errors are not swallowed;
// the first thrown rejection rejects the whole call. If you want
// per-item error isolation (common in pipelines that should continue
// past a single bad row), use `mapSettled` instead.

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (concurrency < 1) throw new Error('concurrency must be >= 1');
  if (items.length === 0) return [];

  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await fn(items[i] as T, i);
    }
  }

  // Spawn up to `concurrency` workers; they steal from the shared
  // index. Smaller than concurrency-many items just returns early
  // from extra workers.
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

// Variant that catches per-item errors and returns settled results.
// Matches Promise.allSettled shape so callers can mark per-item success
// vs failure without aborting the batch.
export type SettledResult<R> =
  | { status: 'fulfilled'; value: R }
  | { status: 'rejected'; reason: unknown };

export async function mapSettled<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<SettledResult<R>[]> {
  if (concurrency < 1) throw new Error('concurrency must be >= 1');
  if (items.length === 0) return [];

  const results: SettledResult<R>[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i] as T, i) };
      } catch (err) {
        results[i] = { status: 'rejected', reason: err };
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}
