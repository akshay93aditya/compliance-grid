import { afterAll, describe, expect, it } from 'vitest';
import { closePool, getPool } from './pool';
import { loadObligationContext, loadObligations } from './obligations';

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)('loadObligations (integration)', () => {
  afterAll(async () => {
    await closePool();
  });

  it('loads obligations filtered by jurisdiction (joins instruments)', async () => {
    const result = await loadObligations(getPool(), {
      jurisdiction: 'IN-KA',
      limit: 5,
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThanOrEqual(5);
    for (const o of result) {
      expect(o.canonical_id).toContain('IN-KA');
    }
  });

  it('filters by a specific instrument id', async () => {
    const result = await loadObligations(getPool(), {
      instrumentIds: [
        'IN-KA/the-occupational-safety-health-working-condition-code-2020-karnataka-rules-2021',
      ],
      limit: 100,
    });
    for (const o of result) {
      expect(o.instrument_ref.instrument_id).toBe(
        'IN-KA/the-occupational-safety-health-working-condition-code-2020-karnataka-rules-2021'
      );
    }
  });

  it('returns an empty array for an unknown instrument id', async () => {
    const result = await loadObligations(getPool(), {
      instrumentIds: ['IN-KA/this-instrument-does-not-exist'],
    });
    expect(result).toEqual([]);
  });
});

describe.skipIf(!hasDb)('loadObligationContext (integration)', () => {
  it('returns obligation + instrument + a freshness timestamp for an existing canonical id', async () => {
    // Pick an arbitrary KA obligation that exists in the bulk-run data.
    const some = await loadObligations(getPool(), {
      jurisdiction: 'IN-KA',
      limit: 1,
    });
    if (some.length === 0) {
      throw new Error(
        'no KA obligations in DB; run the bulk-karmika test first.'
      );
    }
    const context = await loadObligationContext(
      getPool(),
      some[0]!.canonical_id
    );
    expect(context).toBeDefined();
    expect(context!.obligation.canonical_id).toBe(some[0]!.canonical_id);
    expect(context!.instrument.id).toBe(some[0]!.instrument_ref.instrument_id);
    expect(context!.source_verified_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
    );
  });

  it('returns undefined for an unknown canonical id', async () => {
    const result = await loadObligationContext(
      getPool(),
      'IN-KA/this-obligation-does-not-exist|none|filing'
    );
    expect(result).toBeUndefined();
  });
});
