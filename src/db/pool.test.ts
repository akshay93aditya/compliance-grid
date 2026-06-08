import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, getPool } from './pool';
import { Instrument } from '../schemas/instrument';

// Integration tests for the DB layer. Skipped when DATABASE_URL is not set,
// so they don't fail in environments without a configured Postgres.
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)('db pool (integration)', () => {
  beforeAll(async () => {
    await getPool().query('SELECT 1');
  });

  afterAll(async () => {
    await closePool();
  });

  it('runs a simple SELECT', async () => {
    const { rows } = await getPool().query<{ v: number }>('SELECT 1 AS v');
    expect(rows[0]?.v).toBe(1);
  });

  it('round-trips an Instrument through the instruments table', async () => {
    const id = `test-companies-act-${Date.now()}`;
    try {
      const inserted = await getPool().query(
        `INSERT INTO instruments (id, type, title, jurisdiction, citation)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, type, title, jurisdiction, citation`,
        [id, 'Act', 'The Companies Act, 2013', 'IN', 'Act No. 18 of 2013']
      );
      const parsed = Instrument.parse(inserted.rows[0]);
      expect(parsed.type).toBe('Act');
      expect(parsed.jurisdiction).toBe('IN');
    } finally {
      await getPool().query('DELETE FROM instruments WHERE id = $1', [id]);
    }
  });

  it('rejects an obligation with empty source_refs at the DB layer (anti-hallucination invariant)', async () => {
    const instId = `test-inst-${Date.now()}`;
    const oblId = `test-obl-${Date.now()}`;
    await getPool().query(
      `INSERT INTO instruments (id, type, title, jurisdiction, citation)
       VALUES ($1, 'Act', 'Test Act', 'IN', 'test')`,
      [instId]
    );
    try {
      await expect(
        getPool().query(
          `INSERT INTO obligations
             (canonical_id, instrument_id, type, summary, applicability_conditions,
              frequency, deadline_rule, proof_types, penalty, source_refs, version, confidence)
           VALUES ($1, $2, 'filing', 'test', '[]'::jsonb, 'annual',
                   '{"kind":"fixed-date","month":1,"day":15}'::jsonb, '[]'::jsonb,
                   '{"has_imprisonment":false}'::jsonb,
                   '[]'::jsonb, '1', 0.95)`,
          [oblId, instId]
        )
      ).rejects.toThrow();
    } finally {
      await getPool().query('DELETE FROM obligations WHERE canonical_id = $1', [oblId]);
      await getPool().query('DELETE FROM instruments WHERE id = $1', [instId]);
    }
  });

  it('rejects an obligation row with unknown frequency value', async () => {
    const instId = `test-inst-freq-${Date.now()}`;
    const oblId = `test-obl-freq-${Date.now()}`;
    await getPool().query(
      `INSERT INTO instruments (id, type, title, jurisdiction, citation)
       VALUES ($1, 'Act', 'Test Act', 'IN', 'test')`,
      [instId]
    );
    try {
      await expect(
        getPool().query(
          `INSERT INTO obligations
             (canonical_id, instrument_id, type, summary, applicability_conditions,
              frequency, deadline_rule, proof_types, penalty, source_refs, version, confidence)
           VALUES ($1, $2, 'filing', 'test', '[]'::jsonb, 'weekly',
                   '{"kind":"fixed-date","month":1,"day":15}'::jsonb, '[]'::jsonb,
                   '{"has_imprisonment":false}'::jsonb,
                   '[{"source_id":"s","citation_span":"p1"}]'::jsonb, '1', 0.95)`,
          [oblId, instId]
        )
      ).rejects.toThrow();
    } finally {
      await getPool().query('DELETE FROM obligations WHERE canonical_id = $1', [oblId]);
      await getPool().query('DELETE FROM instruments WHERE id = $1', [instId]);
    }
  });
});
