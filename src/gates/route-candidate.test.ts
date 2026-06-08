import { afterAll, describe, expect, it } from 'vitest';
import { getPool, closePool } from '../db/pool';
import type { ObligationCandidate } from '../schemas/obligation';
import { routeCandidate } from './route-candidate';

const hasDb = !!process.env.DATABASE_URL;

function makeCandidate(
  overrides: Partial<ObligationCandidate> = {}
): ObligationCandidate {
  return {
    instrument_ref: { instrument_id: 'IN-KA/route-test-inst', section: 'r.1' },
    type: 'filing',
    summary: 'test obligation',
    applicability_conditions: [
      { field: 'sector', op: 'eq', value: 'manufacturing' },
    ],
    frequency: 'annual',
    deadline_rule: { kind: 'fixed-date', month: 4, day: 30 },
    proof_types: ['filed-form-x'],
    penalty: { has_imprisonment: false, fine_inr: { min: 0, max: 50_000 } },
    source_refs: [{ source_id: 's1', citation_span: 'r.1' }],
    confidence: 0.95,
    ...overrides,
  };
}

describe.skipIf(!hasDb)('routeCandidate (integration)', () => {
  afterAll(async () => {
    await closePool();
  });

  // Ensure the FK target instrument exists once for the suite.
  async function ensureInstrument(id: string): Promise<void> {
    await getPool().query(
      `INSERT INTO instruments (id, type, title, jurisdiction, citation)
       VALUES ($1, 'Rule', 'Route test instrument', 'IN-KA', 'test')
       ON CONFLICT (id) DO NOTHING`,
      [id]
    );
  }

  it('commits a candidate that clears confidence and semantic validation', async () => {
    const ts = Date.now();
    const instId = `IN-KA/route-commit-${ts}`;
    const sourceId = `src-route-commit-${ts}`;
    await ensureInstrument(instId);
    await getPool().query(
      `INSERT INTO sources
         (id, jurisdiction, domain, url, fetch_recipe, trust_tier, last_seen, content_hash)
       VALUES ($1, 'IN-KA', 'labour', 'https://test.example/route',
               '{"kind":"static-url","config":{}}'::jsonb,
               'unverified', NOW(), 'hash')
       ON CONFLICT (id) DO NOTHING`,
      [sourceId]
    );
    try {
      const candidate = makeCandidate({
        instrument_ref: { instrument_id: instId, section: 'r.1' },
        source_refs: [{ source_id: sourceId, citation_span: 'r.1' }],
      });
      const result = await routeCandidate(getPool(), candidate);
      expect(result.action).toBe('committed');
      if (result.action !== 'committed') return;
      expect(result.commit.action).toBe('inserted');
      expect(result.commit.version).toBe('1');

      // cleanup: change_events first, then obligations, then instruments, then source.
      await getPool().query(
        'DELETE FROM change_events WHERE obligation_canonical_id = $1',
        [result.commit.canonical_id]
      );
      await getPool().query(
        'DELETE FROM obligations WHERE canonical_id = $1',
        [result.commit.canonical_id]
      );
    } finally {
      await getPool().query('DELETE FROM instruments WHERE id = $1', [instId]);
      await getPool().query('DELETE FROM sources WHERE id = $1', [sourceId]);
    }
  });

  it('queues a candidate with confidence below 0.9', async () => {
    const instId = `IN-KA/route-low-conf-${Date.now()}`;
    await ensureInstrument(instId);
    try {
      const candidate = makeCandidate({
        instrument_ref: { instrument_id: instId, section: 'r.2' },
        confidence: 0.7,
      });
      const result = await routeCandidate(getPool(), candidate);
      expect(result.action).toBe('queued');
      if (result.action !== 'queued') return;
      expect(result.reasons.join(' ')).toContain('confidence');

      // cleanup
      await getPool().query(
        'DELETE FROM review_queue WHERE id = $1',
        [result.queue_id]
      );
    } finally {
      await getPool().query('DELETE FROM instruments WHERE id = $1', [instId]);
    }
  });

  it('queues a candidate with bad semantic value (the "factory-occupier" case)', async () => {
    const instId = `IN-KA/route-bad-sem-${Date.now()}`;
    await ensureInstrument(instId);
    try {
      const candidate = makeCandidate({
        instrument_ref: { instrument_id: instId, section: 'r.3' },
        confidence: 0.97,
        applicability_conditions: [
          { field: 'entity_type', op: 'eq', value: 'factory-occupier' },
        ],
      });
      const result = await routeCandidate(getPool(), candidate);
      expect(result.action).toBe('queued');
      if (result.action !== 'queued') return;
      expect(result.reasons.join(' ')).toContain('entity_type');

      await getPool().query(
        'DELETE FROM review_queue WHERE id = $1',
        [result.queue_id]
      );
    } finally {
      await getPool().query('DELETE FROM instruments WHERE id = $1', [instId]);
    }
  });

  it('queues with combined reasons when multiple gates fail', async () => {
    const instId = `IN-KA/route-multi-${Date.now()}`;
    await ensureInstrument(instId);
    try {
      const candidate = makeCandidate({
        instrument_ref: { instrument_id: instId, section: 'r.4' },
        confidence: 0.5,
        applicability_conditions: [
          { field: 'made_up_field', op: 'eq', value: 'x' },
        ],
      });
      const result = await routeCandidate(getPool(), candidate);
      expect(result.action).toBe('queued');
      if (result.action !== 'queued') return;
      expect(result.reasons.length).toBeGreaterThanOrEqual(2);

      await getPool().query(
        'DELETE FROM review_queue WHERE id = $1',
        [result.queue_id]
      );
    } finally {
      await getPool().query('DELETE FROM instruments WHERE id = $1', [instId]);
    }
  });

  it('routes a federation candidate above threshold to commit with extractedBy set (D53)', async () => {
    const ts = Date.now();
    const instId = `IN-KA/route-fed-commit-${ts}`;
    const sourceId = `src-route-fed-commit-${ts}`;
    await ensureInstrument(instId);
    await getPool().query(
      `INSERT INTO sources
         (id, jurisdiction, domain, url, fetch_recipe, trust_tier, last_seen, content_hash)
       VALUES ($1, 'IN-KA', 'labour', 'https://test.example/${'$1'}',
               '{"kind":"static-url","config":{}}'::jsonb,
               'unverified', NOW(), 'test-hash')
       ON CONFLICT (id) DO NOTHING`,
      [sourceId]
    );
    try {
      const candidate = makeCandidate({
        instrument_ref: { instrument_id: instId, section: 'r.fed.commit' },
        source_refs: [{ source_id: sourceId, citation_span: 'r.fed' }],
        confidence: 0.95,
      });
      const result = await routeCandidate(getPool(), candidate, {
        extractedBy: 'alice',
        emitChangeEvent: false,
      });
      expect(result.action).toBe('committed');
      if (result.action !== 'committed') return;

      const { rows } = await getPool().query<{
        extracted_by: string | null;
      }>(
        `SELECT extracted_by FROM obligations WHERE canonical_id = $1`,
        [result.commit.canonical_id]
      );
      expect(rows[0]!.extracted_by).toBe('alice');

      await getPool().query(
        'DELETE FROM obligations WHERE canonical_id = $1',
        [result.commit.canonical_id]
      );
    } finally {
      await getPool().query('DELETE FROM sources WHERE id = $1', [sourceId]);
      await getPool().query('DELETE FROM instruments WHERE id = $1', [instId]);
    }
  });

  it('routes a federation candidate below threshold to review_queue with extracted_by recorded and reason prefixed (D53)', async () => {
    const ts = Date.now();
    const instId = `IN-KA/route-fed-queue-${ts}`;
    await ensureInstrument(instId);
    try {
      const candidate = makeCandidate({
        instrument_ref: { instrument_id: instId, section: 'r.fed.queue' },
        confidence: 0.7,
      });
      const result = await routeCandidate(getPool(), candidate, {
        extractedBy: 'alice',
      });
      expect(result.action).toBe('queued');
      if (result.action !== 'queued') return;
      expect(result.reasons.length).toBeGreaterThanOrEqual(1);

      const { rows } = await getPool().query<{
        reason: string;
        extracted_by: string | null;
      }>(
        `SELECT reason, extracted_by FROM review_queue WHERE id = $1`,
        [result.queue_id]
      );
      expect(rows[0]!.extracted_by).toBe('alice');
      expect(rows[0]!.reason).toContain('federation incoming from alice');
      expect(rows[0]!.reason).toContain('confidence 0.7 below threshold 0.9');

      await getPool().query(
        'DELETE FROM review_queue WHERE id = $1',
        [result.queue_id]
      );
    } finally {
      await getPool().query('DELETE FROM instruments WHERE id = $1', [instId]);
    }
  });
});
