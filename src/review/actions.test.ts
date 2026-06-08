import { afterAll, describe, expect, it } from 'vitest';
import { closePool, getPool } from '../db/pool';
import {
  enqueueReview,
  loadPendingReviews,
} from '../db/review-queue';
import type { ObligationCandidate } from '../schemas/obligation';
import { approveReview, modifyReview, rejectReview } from './actions';

const hasDb = !!process.env.DATABASE_URL;

function makeCandidate(
  instrumentId: string,
  sourceId: string,
  overrides: Partial<ObligationCandidate> = {}
): ObligationCandidate {
  return {
    instrument_ref: { instrument_id: instrumentId, section: 'r.review' },
    type: 'filing',
    summary: 'queued candidate',
    applicability_conditions: [],
    frequency: 'annual',
    deadline_rule: { kind: 'fixed-date', month: 4, day: 30 },
    proof_types: [],
    penalty: { has_imprisonment: false },
    source_refs: [{ source_id: sourceId, citation_span: 'r.1' }],
    confidence: 0.8,
    ...overrides,
  };
}

async function setupFixture(instrumentId: string, sourceId: string): Promise<void> {
  await getPool().query(
    `INSERT INTO instruments (id, type, title, jurisdiction, citation)
     VALUES ($1, 'Act', 'Review fixture', 'IN-KA', 'test')
     ON CONFLICT (id) DO NOTHING`,
    [instrumentId]
  );
  await getPool().query(
    `INSERT INTO sources
       (id, jurisdiction, domain, url, fetch_recipe, trust_tier, last_seen, content_hash)
     VALUES ($1, 'IN-KA', 'labour', 'https://test.example/review', '{"kind":"static-url","config":{}}'::jsonb,
             'unverified', NOW(), 'hash')
     ON CONFLICT (id) DO NOTHING`,
    [sourceId]
  );
}

async function cleanupFixture(instrumentId: string, sourceId: string): Promise<void> {
  await getPool().query(
    'DELETE FROM change_events WHERE obligation_canonical_id IN (SELECT canonical_id FROM obligations WHERE instrument_id = $1)',
    [instrumentId]
  );
  await getPool().query(
    'DELETE FROM review_queue WHERE candidate->\'instrument_ref\'->>\'instrument_id\' = $1',
    [instrumentId]
  );
  await getPool().query(
    'DELETE FROM obligations WHERE instrument_id = $1',
    [instrumentId]
  );
  await getPool().query('DELETE FROM instruments WHERE id = $1', [instrumentId]);
  await getPool().query('DELETE FROM sources WHERE id = $1', [sourceId]);
}

describe.skipIf(!hasDb)('approveReview (integration)', () => {
  afterAll(async () => {
    await closePool();
  });

  it('commits the queued candidate, emits a ChangeEvent, and marks reviewed', async () => {
    const ts = Date.now();
    const instId = `IN-KA/review-approve-${ts}`;
    const sourceId = `src-review-approve-${ts}`;
    try {
      await setupFixture(instId, sourceId);

      const enq = await enqueueReview(getPool(), {
        candidate: makeCandidate(instId, sourceId),
        reason: 'low confidence',
      });

      const result = await approveReview(getPool(), {
        review_queue_id: enq.id,
        reviewed_by: 'human-1',
      });

      expect(result.commit.action).toBe('inserted');
      expect(result.commit.change_event_id).not.toBeNull();

      // Queue row should be marked.
      const { rows } = await getPool().query<{
        reviewed_by: string;
        decision: string;
      }>(
        'SELECT reviewed_by, decision FROM review_queue WHERE id = $1',
        [enq.id]
      );
      expect(rows[0]!.reviewed_by).toBe('human-1');
      expect(rows[0]!.decision).toBe('approved');

      // Obligation should exist.
      const { rows: obligRows } = await getPool().query(
        'SELECT canonical_id FROM obligations WHERE canonical_id = $1',
        [result.commit.canonical_id]
      );
      expect(obligRows).toHaveLength(1);
    } finally {
      await cleanupFixture(instId, sourceId);
    }
  });

  it('throws when the review item is already reviewed', async () => {
    const ts = Date.now();
    const instId = `IN-KA/review-double-${ts}`;
    const sourceId = `src-review-double-${ts}`;
    try {
      await setupFixture(instId, sourceId);
      const enq = await enqueueReview(getPool(), {
        candidate: makeCandidate(instId, sourceId),
        reason: 'low confidence',
      });
      await approveReview(getPool(), {
        review_queue_id: enq.id,
        reviewed_by: 'human-1',
      });
      await expect(
        approveReview(getPool(), {
          review_queue_id: enq.id,
          reviewed_by: 'human-2',
        })
      ).rejects.toThrow();
    } finally {
      await cleanupFixture(instId, sourceId);
    }
  });

  it('throws when reviewed_by is empty', async () => {
    const ts = Date.now();
    const instId = `IN-KA/review-noby-${ts}`;
    const sourceId = `src-review-noby-${ts}`;
    try {
      await setupFixture(instId, sourceId);
      const enq = await enqueueReview(getPool(), {
        candidate: makeCandidate(instId, sourceId),
        reason: 'r',
      });
      await expect(
        approveReview(getPool(), {
          review_queue_id: enq.id,
          reviewed_by: '',
        })
      ).rejects.toThrow();
    } finally {
      await cleanupFixture(instId, sourceId);
    }
  });
});

describe.skipIf(!hasDb)('rejectReview (integration)', () => {
  it('marks the queue item rejected without committing anything', async () => {
    const ts = Date.now();
    const instId = `IN-KA/review-reject-${ts}`;
    const sourceId = `src-review-reject-${ts}`;
    try {
      await setupFixture(instId, sourceId);
      const enq = await enqueueReview(getPool(), {
        candidate: makeCandidate(instId, sourceId),
        reason: 'bad',
      });

      await rejectReview(getPool(), {
        review_queue_id: enq.id,
        reviewed_by: 'human-r',
      });

      const { rows } = await getPool().query<{
        reviewed_by: string;
        decision: string;
      }>(
        'SELECT reviewed_by, decision FROM review_queue WHERE id = $1',
        [enq.id]
      );
      expect(rows[0]!.decision).toBe('rejected');

      // No obligation should have been created.
      const { rows: obligs } = await getPool().query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM obligations WHERE instrument_id = $1',
        [instId]
      );
      expect(obligs[0]!.count).toBe('0');
    } finally {
      await cleanupFixture(instId, sourceId);
    }
  });
});

describe.skipIf(!hasDb)('modifyReview (integration)', () => {
  it('commits the modified candidate and marks reviewed', async () => {
    const ts = Date.now();
    const instId = `IN-KA/review-modify-${ts}`;
    const sourceId = `src-review-modify-${ts}`;
    try {
      await setupFixture(instId, sourceId);
      const original = makeCandidate(instId, sourceId, {
        summary: 'original summary',
        confidence: 0.7,
      });
      const enq = await enqueueReview(getPool(), {
        candidate: original,
        reason: 'low confidence',
      });

      const modified = makeCandidate(instId, sourceId, {
        summary: 'reviewer-corrected summary',
        confidence: 0.95,
      });
      const result = await modifyReview(getPool(), {
        review_queue_id: enq.id,
        reviewed_by: 'human-m',
        modified_candidate: modified,
      });

      expect(result.commit.action).toBe('inserted');
      const { rows } = await getPool().query<{
        decision: string;
      }>('SELECT decision FROM review_queue WHERE id = $1', [enq.id]);
      expect(rows[0]!.decision).toBe('modified');

      const { rows: obligs } = await getPool().query<{ summary: string }>(
        'SELECT summary FROM obligations WHERE canonical_id = $1',
        [result.commit.canonical_id]
      );
      expect(obligs[0]!.summary).toBe('reviewer-corrected summary');
    } finally {
      await cleanupFixture(instId, sourceId);
    }
  });
});

describe.skipIf(!hasDb)('loadPendingReviews (integration)', () => {
  it('returns oldest pending items first and respects limit', async () => {
    const ts = Date.now();
    const instId = `IN-KA/review-list-${ts}`;
    const sourceId = `src-review-list-${ts}`;
    try {
      await setupFixture(instId, sourceId);
      const first = await enqueueReview(getPool(), {
        candidate: makeCandidate(instId, sourceId, {
          summary: 'first',
        }),
        reason: 'r1',
      });
      // Small delay so created_at distinguishes the two.
      await new Promise((resolve) => setTimeout(resolve, 5));
      const second = await enqueueReview(getPool(), {
        candidate: makeCandidate(instId, sourceId, {
          summary: 'second',
        }),
        reason: 'r2',
      });

      // High limit because the dev DB has hundreds of pre-existing pending
      // items from the Phase 1.5.5 bulk run; these two new items land at the
      // end of the global oldest-first queue.
      const all = await loadPendingReviews(getPool(), { limit: 5000 });
      const ids = all.map((r) => r.id);
      const i1 = ids.indexOf(first.id);
      const i2 = ids.indexOf(second.id);
      expect(i1).toBeGreaterThanOrEqual(0);
      expect(i2).toBeGreaterThanOrEqual(0);
      // Oldest (first) appears before second.
      expect(i1).toBeLessThan(i2);
    } finally {
      await cleanupFixture(instId, sourceId);
    }
  });

  it('skips items that have already been reviewed', async () => {
    const ts = Date.now();
    const instId = `IN-KA/review-skip-${ts}`;
    const sourceId = `src-review-skip-${ts}`;
    try {
      await setupFixture(instId, sourceId);
      const enq = await enqueueReview(getPool(), {
        candidate: makeCandidate(instId, sourceId),
        reason: 'r',
      });
      await rejectReview(getPool(), {
        review_queue_id: enq.id,
        reviewed_by: 'human-r',
      });
      const pending = await loadPendingReviews(getPool(), { limit: 100 });
      expect(pending.find((p) => p.id === enq.id)).toBeUndefined();
    } finally {
      await cleanupFixture(instId, sourceId);
    }
  });

  it('approveReview preserves extracted_by from the queue row to the committed obligation (D53)', async () => {
    const ts = Date.now();
    const instId = `IN-KA/review-extracted-by-${ts}`;
    const sourceId = `src-review-extracted-by-${ts}`;
    try {
      await setupFixture(instId, sourceId);
      const enq = await enqueueReview(getPool(), {
        candidate: makeCandidate(instId, sourceId),
        reason: 'federation incoming from alice; confidence 0.8 below threshold 0.9',
        extracted_by: 'alice',
      });

      const result = await approveReview(getPool(), {
        review_queue_id: enq.id,
        reviewed_by: 'human-r',
      });

      const { rows } = await getPool().query<{
        extracted_by: string | null;
      }>(
        `SELECT extracted_by FROM obligations WHERE canonical_id = $1`,
        [result.commit.canonical_id]
      );
      expect(rows[0]!.extracted_by).toBe('alice');
    } finally {
      await cleanupFixture(instId, sourceId);
    }
  });

  it('modifyReview preserves extracted_by from the queue row even when the reviewer rewrites the candidate (D53)', async () => {
    const ts = Date.now();
    const instId = `IN-KA/review-modify-extracted-${ts}`;
    const sourceId = `src-review-modify-extracted-${ts}`;
    try {
      await setupFixture(instId, sourceId);
      const enq = await enqueueReview(getPool(), {
        candidate: makeCandidate(instId, sourceId, { confidence: 0.5 }),
        reason: 'federation incoming from alice; confidence 0.5 below threshold 0.9',
        extracted_by: 'alice',
      });

      const result = await modifyReview(getPool(), {
        review_queue_id: enq.id,
        reviewed_by: 'human-r',
        modified_candidate: makeCandidate(instId, sourceId, {
          summary: 'reviewer-edited summary',
          confidence: 0.99,
        }),
      });

      const { rows } = await getPool().query<{
        extracted_by: string | null;
        summary: string;
      }>(
        `SELECT extracted_by, summary FROM obligations WHERE canonical_id = $1`,
        [result.commit.canonical_id]
      );
      expect(rows[0]!.extracted_by).toBe('alice');
      expect(rows[0]!.summary).toBe('reviewer-edited summary');
    } finally {
      await cleanupFixture(instId, sourceId);
    }
  });
});
