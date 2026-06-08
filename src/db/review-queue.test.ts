import { afterAll, describe, expect, it } from 'vitest';
import type { ObligationCandidate } from '../schemas/obligation';
import { closePool, getPool } from './pool';
import { enqueueReview } from './review-queue';

const hasDb = !!process.env.DATABASE_URL;

function makeCandidate(
  confidence: number,
  overrides: Partial<ObligationCandidate> = {}
): ObligationCandidate {
  return {
    instrument_ref: { instrument_id: 'IN-KA/test-instrument' },
    type: 'filing',
    summary: 'test',
    applicability_conditions: [],
    frequency: 'annual',
    deadline_rule: { kind: 'fixed-date', month: 4, day: 30 },
    proof_types: [],
    penalty: { has_imprisonment: false },
    source_refs: [{ source_id: 's1', citation_span: 'p.1' }],
    confidence,
    ...overrides,
  };
}

describe.skipIf(!hasDb)('enqueueReview (integration)', () => {
  afterAll(async () => {
    await closePool();
  });

  it('inserts a row and returns its id as a string', async () => {
    const candidate = makeCandidate(0.75);
    const { id } = await enqueueReview(getPool(), {
      candidate,
      reason: 'confidence below threshold',
    });
    try {
      expect(typeof id).toBe('string');
      const { rows } = await getPool().query(
        'SELECT confidence, reason, decision FROM review_queue WHERE id = $1',
        [id]
      );
      expect(rows).toHaveLength(1);
      expect(Number(rows[0]!.confidence)).toBe(0.75);
      expect(rows[0]!.reason).toBe('confidence below threshold');
      expect(rows[0]!.decision).toBeNull();
    } finally {
      await getPool().query('DELETE FROM review_queue WHERE id = $1', [id]);
    }
  });

  it('rejects an empty reason at the DB layer', async () => {
    await expect(
      enqueueReview(getPool(), {
        candidate: makeCandidate(0.5),
        reason: '',
      })
    ).rejects.toThrow();
  });

  it('stores the full candidate as JSONB and returns it intact on read', async () => {
    const candidate = makeCandidate(0.4, {
      summary: 'maintain attendance register',
      type: 'record-keeping',
    });
    const { id } = await enqueueReview(getPool(), {
      candidate,
      reason: 'low confidence',
    });
    try {
      const { rows } = await getPool().query<{ candidate: ObligationCandidate }>(
        'SELECT candidate FROM review_queue WHERE id = $1',
        [id]
      );
      expect(rows[0]!.candidate.summary).toBe('maintain attendance register');
      expect(rows[0]!.candidate.type).toBe('record-keeping');
    } finally {
      await getPool().query('DELETE FROM review_queue WHERE id = $1', [id]);
    }
  });
});
