import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, getPool } from './pool';
import {
  countUnpublishedObligations,
  loadInstrumentsForObligations,
  loadSourcesForObligations,
  loadUnpublishedObligations,
  markObligationsPublished,
} from './publish';

const hasDb = !!process.env.DATABASE_URL;

// Lifecycle integration test. Sets up a small CKG fixture (one source,
// one instrument, one obligation), exercises the publish helpers, then
// cleans up. Designed to be safe in the presence of the real
// IN-KA labour CKG: uses a dedicated jurisdiction `IN-XX` so it never
// collides with production data.

const FIXTURE = {
  instrumentId: 'IN-XX/publish-test-instrument',
  sourceId: 'src_publish_test_fixture0001',
  canonicalId: 'IN-XX/publish-test-instrument|publish-test|filing',
  url: 'https://publish-test.fixture.example/doc.pdf',
};

describe.skipIf(!hasDb)('publish helpers (integration)', () => {
  beforeAll(async () => {
    // Cleanup leftovers from a prior failed run.
    await getPool().query(
      `DELETE FROM change_events WHERE obligation_canonical_id = $1`,
      [FIXTURE.canonicalId]
    );
    await getPool().query(`DELETE FROM obligations WHERE canonical_id = $1`, [
      FIXTURE.canonicalId,
    ]);
    await getPool().query(`DELETE FROM sources WHERE id = $1`, [FIXTURE.sourceId]);
    await getPool().query(`DELETE FROM instruments WHERE id = $1`, [
      FIXTURE.instrumentId,
    ]);

    await getPool().query(
      `INSERT INTO instruments (id, type, title, jurisdiction, citation)
       VALUES ($1, 'Rule', 'Publish Test Instrument', 'IN-XX', 'Publish Test')`,
      [FIXTURE.instrumentId]
    );
    await getPool().query(
      `INSERT INTO sources (id, jurisdiction, domain, url, fetch_recipe,
                            trust_tier, last_seen, content_hash)
       VALUES ($1, 'IN-XX', 'publish-test', $2, '{"kind":"static-url"}'::jsonb,
               'unverified', NOW(), 'fixture-hash')`,
      [FIXTURE.sourceId, 'https://publish-test.fixture.example/doc.pdf']
    );
    await getPool().query(
      `INSERT INTO obligations
         (canonical_id, instrument_id, section, type, summary,
          applicability_conditions, frequency, deadline_rule,
          proof_types, penalty, source_refs, version, confidence)
       VALUES ($1, $2, 'publish-test', 'filing', 'Fixture summary',
               '[]'::jsonb, 'annual',
               '{"kind":"fixed-date","month":3,"day":31}'::jsonb,
               '[]'::jsonb, '{"has_imprisonment":false}'::jsonb,
               $3::jsonb, '1', 0.95)`,
      [
        FIXTURE.canonicalId,
        FIXTURE.instrumentId,
        JSON.stringify([
          { source_id: FIXTURE.sourceId, citation_span: 'publish-test span' },
        ]),
      ]
    );
  });

  afterAll(async () => {
    await getPool().query(
      `DELETE FROM change_events WHERE obligation_canonical_id = $1`,
      [FIXTURE.canonicalId]
    );
    await getPool().query(`DELETE FROM obligations WHERE canonical_id = $1`, [
      FIXTURE.canonicalId,
    ]);
    await getPool().query(`DELETE FROM sources WHERE id = $1`, [FIXTURE.sourceId]);
    await getPool().query(`DELETE FROM instruments WHERE id = $1`, [
      FIXTURE.instrumentId,
    ]);
    await closePool();
  });

  it('loadUnpublishedObligations surfaces the fixture row with its bucket coordinates', async () => {
    const rows = await loadUnpublishedObligations(getPool());
    const mine = rows.find((r) => r.canonical_id === FIXTURE.canonicalId);
    expect(mine).toBeDefined();
    expect(mine!.bucket_jurisdiction).toBe('IN-XX');
    expect(mine!.bucket_domain).toBe('publish-test');
    expect(mine!.source_refs[0]?.source_id).toBe(FIXTURE.sourceId);
    expect(typeof mine!.extracted_at).toBe('string');
  });

  it('loadInstrumentsForObligations returns the linked instrument deduped', async () => {
    const rows = await loadInstrumentsForObligations(getPool(), [
      FIXTURE.canonicalId,
    ]);
    const mine = rows.find((r) => r.id === FIXTURE.instrumentId);
    expect(mine).toBeDefined();
    expect(mine!.title).toBe('Publish Test Instrument');
  });

  it('loadSourcesForObligations returns the linked source', async () => {
    const rows = await loadSourcesForObligations(getPool(), [
      FIXTURE.canonicalId,
    ]);
    const mine = rows.find((r) => r.id === FIXTURE.sourceId);
    expect(mine).toBeDefined();
    expect(mine!.jurisdiction).toBe('IN-XX');
    expect(mine!.url).toBe('https://publish-test.fixture.example/doc.pdf');
  });

  it('markObligationsPublished sets published_at and is idempotent', async () => {
    const first = await markObligationsPublished(getPool(), [
      FIXTURE.canonicalId,
    ]);
    expect(first.updated).toBe(1);
    const again = await markObligationsPublished(getPool(), [
      FIXTURE.canonicalId,
    ]);
    expect(again.updated).toBe(0);

    const { rows } = await getPool().query<{ published_at: Date | null }>(
      `SELECT published_at FROM obligations WHERE canonical_id = $1`,
      [FIXTURE.canonicalId]
    );
    expect(rows[0]!.published_at).toBeInstanceOf(Date);
  });

  it('countUnpublishedObligations excludes already-published rows', async () => {
    // After the previous test marked the fixture published, it should
    // not appear in the count. We add a temporary unpublished row to
    // verify the count is positive when it should be, then clean it up.
    const altCanonicalId = `${FIXTURE.canonicalId}|alt`;
    await getPool().query(
      `INSERT INTO obligations
         (canonical_id, instrument_id, section, type, summary,
          applicability_conditions, frequency, deadline_rule,
          proof_types, penalty, source_refs, version, confidence)
       VALUES ($1, $2, 'alt', 'filing', 'Alt fixture',
               '[]'::jsonb, 'annual',
               '{"kind":"fixed-date","month":3,"day":31}'::jsonb,
               '[]'::jsonb, '{"has_imprisonment":false}'::jsonb,
               $3::jsonb, '1', 0.95)`,
      [
        altCanonicalId,
        FIXTURE.instrumentId,
        JSON.stringify([
          { source_id: FIXTURE.sourceId, citation_span: 'alt span' },
        ]),
      ]
    );
    try {
      const c = await countUnpublishedObligations(getPool());
      expect(c).toBeGreaterThanOrEqual(1);
    } finally {
      await getPool().query(`DELETE FROM obligations WHERE canonical_id = $1`, [
        altCanonicalId,
      ]);
    }
  });
});

describe('publish helpers (module shape)', () => {
  it('exports the expected functions', () => {
    expect(typeof loadUnpublishedObligations).toBe('function');
    expect(typeof loadInstrumentsForObligations).toBe('function');
    expect(typeof loadSourcesForObligations).toBe('function');
    expect(typeof markObligationsPublished).toBe('function');
    expect(typeof countUnpublishedObligations).toBe('function');
  });
});
