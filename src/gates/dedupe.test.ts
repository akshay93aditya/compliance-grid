import { afterAll, describe, expect, it } from 'vitest';
import { closePool, getPool } from '../db/pool';
import { dedupe } from './dedupe';

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)('dedupe (integration)', () => {
  afterAll(async () => {
    await closePool();
  });

  it('returns kind: "new" when no obligation matches the canonical key', async () => {
    const result = await dedupe(getPool(), {
      instrument_id: `nonexistent-${Date.now()}`,
      type: 'filing',
    });
    expect(result.kind).toBe('new');
  });

  it('returns kind: "existing" with the parsed obligation when a match is found', async () => {
    const ts = Date.now();
    const instId = `test-inst-dedupe-${ts}`;
    const oblId = `obl|sec|filing-${ts}`;
    try {
      await getPool().query(
        `INSERT INTO instruments (id, type, title, jurisdiction, citation)
         VALUES ($1, 'Act', 'Test', 'IN-KA', 'test')`,
        [instId]
      );
      await getPool().query(
        `INSERT INTO obligations
           (canonical_id, instrument_id, section, type, summary,
            applicability_conditions, frequency, deadline_rule,
            proof_types, penalty, source_refs, version, confidence)
         VALUES ($1, $2, 's.5', 'filing', 'test summary',
                 '[]'::jsonb, 'annual',
                 '{"kind":"fixed-date","month":4,"day":30}'::jsonb,
                 '["form-x"]'::jsonb,
                 '{"has_imprisonment":false}'::jsonb,
                 '[{"source_id":"s1","citation_span":"p.1"}]'::jsonb,
                 '1', 0.95)`,
        [oblId, instId]
      );

      const result = await dedupe(getPool(), {
        instrument_id: instId,
        section: 's.5',
        type: 'filing',
      });
      expect(result.kind).toBe('existing');
      if (result.kind === 'existing') {
        expect(result.obligation.canonical_id).toBe(oblId);
        expect(result.obligation.instrument_ref.section).toBe('s.5');
        expect(result.obligation.type).toBe('filing');
      }
    } finally {
      await getPool().query('DELETE FROM obligations WHERE canonical_id = $1', [oblId]);
      await getPool().query('DELETE FROM instruments WHERE id = $1', [instId]);
    }
  });

  it('matches NULL section to no-section input', async () => {
    const ts = Date.now();
    const instId = `test-inst-null-sec-${ts}`;
    const oblId = `obl||filing-${ts}`;
    try {
      await getPool().query(
        `INSERT INTO instruments (id, type, title, jurisdiction, citation)
         VALUES ($1, 'Act', 'Test', 'IN', 'test')`,
        [instId]
      );
      await getPool().query(
        `INSERT INTO obligations
           (canonical_id, instrument_id, section, type, summary,
            applicability_conditions, frequency, deadline_rule,
            proof_types, penalty, source_refs, version, confidence)
         VALUES ($1, $2, NULL, 'filing', 'test',
                 '[]'::jsonb, 'annual',
                 '{"kind":"fixed-date","month":4,"day":30}'::jsonb,
                 '[]'::jsonb,
                 '{"has_imprisonment":false}'::jsonb,
                 '[{"source_id":"s1","citation_span":"p.1"}]'::jsonb,
                 '1', 0.95)`,
        [oblId, instId]
      );

      const result = await dedupe(getPool(), {
        instrument_id: instId,
        type: 'filing',
      });
      expect(result.kind).toBe('existing');
      if (result.kind === 'existing') {
        expect(result.obligation.instrument_ref.section).toBeUndefined();
      }
    } finally {
      await getPool().query('DELETE FROM obligations WHERE canonical_id = $1', [oblId]);
      await getPool().query('DELETE FROM instruments WHERE id = $1', [instId]);
    }
  });
});
