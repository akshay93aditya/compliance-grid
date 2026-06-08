import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { closePool, getPool } from './pool';
import { loadChangeEvents } from './change-events';

const hasDb = !!process.env.DATABASE_URL;

async function seedChangeEvent(opts: {
  instrumentId: string;
  sourceId: string;
  canonicalId: string;
  changeType: 'new' | 'amended';
  detectedAt?: Date;
}): Promise<string> {
  await getPool().query(
    `INSERT INTO instruments (id, type, title, jurisdiction, citation)
     VALUES ($1, 'Act', 'Test', 'IN-KA', 'test')
     ON CONFLICT (id) DO NOTHING`,
    [opts.instrumentId]
  );
  await getPool().query(
    `INSERT INTO sources
       (id, jurisdiction, domain, url, fetch_recipe, trust_tier, last_seen, content_hash)
     VALUES ($1, 'IN-KA', 'labour', 'https://test.example/', '{"kind":"static-url","config":{}}'::jsonb,
             'unverified', NOW(), 'hash')
     ON CONFLICT (id) DO NOTHING`,
    [opts.sourceId]
  );
  await getPool().query(
    `INSERT INTO obligations
       (canonical_id, instrument_id, section, type, summary,
        applicability_conditions, frequency, deadline_rule,
        proof_types, penalty, source_refs, version, confidence)
     VALUES ($1, $2, 'r.1', 'filing', 'test',
             '[]'::jsonb, 'annual',
             '{"kind":"fixed-date","month":4,"day":30}'::jsonb,
             '[]'::jsonb,
             '{"has_imprisonment":false}'::jsonb,
             '[{"source_id":"any","citation_span":"r.1"}]'::jsonb,
             '1', 0.95)
     ON CONFLICT (canonical_id) DO NOTHING`,
    [opts.canonicalId, opts.instrumentId]
  );
  const ceId = `ce_${randomUUID()}`;
  await getPool().query(
    `INSERT INTO change_events
       (id, obligation_canonical_id, change_type, effective_date,
        source_ref, detected_at, status)
     VALUES ($1, $2, $3, CURRENT_DATE, $4, $5, 'detected')`,
    [
      ceId,
      opts.canonicalId,
      opts.changeType,
      opts.sourceId,
      opts.detectedAt?.toISOString() ?? new Date().toISOString(),
    ]
  );
  return ceId;
}

async function cleanupChangeEventFixtures(
  instrumentId: string,
  sourceId: string,
  canonicalId: string
): Promise<void> {
  await getPool().query(
    'DELETE FROM change_events WHERE obligation_canonical_id = $1',
    [canonicalId]
  );
  await getPool().query(
    'DELETE FROM obligations WHERE canonical_id = $1',
    [canonicalId]
  );
  await getPool().query('DELETE FROM instruments WHERE id = $1', [instrumentId]);
  await getPool().query('DELETE FROM sources WHERE id = $1', [sourceId]);
}

describe.skipIf(!hasDb)('loadChangeEvents (integration)', () => {
  afterAll(async () => {
    await closePool();
  });

  it('loads recent change events sorted by detected_at DESC', async () => {
    const ts = Date.now();
    const instId = `IN-KA/ce-test-${ts}`;
    const sourceId = `src-ce-test-${ts}`;
    const canonicalId = `${instId}|r.1|filing`;
    try {
      // Seed two events with distinguishable detected_at values.
      const earlier = new Date(Date.now() - 60_000);
      const later = new Date();
      await seedChangeEvent({
        instrumentId: instId,
        sourceId,
        canonicalId,
        changeType: 'new',
        detectedAt: earlier,
      });
      await seedChangeEvent({
        instrumentId: instId,
        sourceId,
        canonicalId,
        changeType: 'amended',
        detectedAt: later,
      });

      const events = await loadChangeEvents(getPool(), { limit: 10 });
      const forThisObligation = events.filter(
        (e) => e.obligation_ref === canonicalId
      );
      expect(forThisObligation).toHaveLength(2);
      // First entry (most recent) should be the 'amended' one.
      expect(forThisObligation[0]!.change_type).toBe('amended');
      expect(forThisObligation[1]!.change_type).toBe('new');
    } finally {
      await cleanupChangeEventFixtures(instId, sourceId, canonicalId);
    }
  });

  it('respects the "since" filter', async () => {
    const ts = Date.now();
    const instId = `IN-KA/ce-since-test-${ts}`;
    const sourceId = `src-ce-since-${ts}`;
    const canonicalId = `${instId}|r.1|filing`;
    try {
      const earlier = new Date(Date.now() - 60_000);
      await seedChangeEvent({
        instrumentId: instId,
        sourceId,
        canonicalId,
        changeType: 'new',
        detectedAt: earlier,
      });

      const future = new Date(Date.now() + 60_000);
      const result = await loadChangeEvents(getPool(), {
        since: future,
        limit: 10,
      });
      const found = result.find((e) => e.obligation_ref === canonicalId);
      expect(found).toBeUndefined();
    } finally {
      await cleanupChangeEventFixtures(instId, sourceId, canonicalId);
    }
  });

  it('respects the changeTypes filter', async () => {
    const ts = Date.now();
    const instId = `IN-KA/ce-type-test-${ts}`;
    const sourceId = `src-ce-type-${ts}`;
    const canonicalId = `${instId}|r.1|filing`;
    try {
      await seedChangeEvent({
        instrumentId: instId,
        sourceId,
        canonicalId,
        changeType: 'new',
      });

      const onlyAmended = await loadChangeEvents(getPool(), {
        changeTypes: ['amended'],
        limit: 10,
      });
      const found = onlyAmended.find(
        (e) => e.obligation_ref === canonicalId
      );
      expect(found).toBeUndefined();

      const onlyNew = await loadChangeEvents(getPool(), {
        changeTypes: ['new'],
        limit: 10,
      });
      const foundNew = onlyNew.find((e) => e.obligation_ref === canonicalId);
      expect(foundNew).toBeDefined();
    } finally {
      await cleanupChangeEventFixtures(instId, sourceId, canonicalId);
    }
  });
});
