import type { Pool, PoolClient } from 'pg';
import { ObligationCandidate } from '../schemas/obligation';

type Executor = Pool | PoolClient;

export interface EnqueueReviewInput {
  candidate: ObligationCandidate;
  reason: string;
  // Phase 3.5 (D53): the federation extractor that supplied this
  // candidate, if any. NULL = locally extracted. Preserved through the
  // review queue so an approving reviewer's commit lands with the
  // correct extracted_by attribution.
  extracted_by?: string;
}

export interface EnqueueReviewResult {
  id: string;
}

// Writes a sub-threshold or semantically-flagged ObligationCandidate to the
// review_queue table. The full candidate is stored as JSONB so a reviewer
// can see exactly what was extracted, why it was queued, and what to do.
//
// id is returned as text so callers don't have to worry about JS Number
// precision on a BIGSERIAL.
export async function enqueueReview(
  executor: Executor,
  input: EnqueueReviewInput
): Promise<EnqueueReviewResult> {
  if (input.reason.length === 0) {
    throw new Error('enqueueReview: reason must be a non-empty string');
  }
  const { rows } = await executor.query<{ id: string }>(
    `INSERT INTO review_queue (candidate, confidence, reason, extracted_by)
     VALUES ($1::jsonb, $2, $3, $4)
     RETURNING id::text`,
    [
      JSON.stringify(input.candidate),
      input.candidate.confidence,
      input.reason,
      input.extracted_by ?? null,
    ]
  );
  return { id: rows[0]!.id };
}

export interface PendingReview {
  id: string;
  candidate: ObligationCandidate;
  confidence: number;
  reason: string;
  created_at: string;
}

interface PendingReviewRow {
  id: string;
  candidate: unknown;
  confidence: number;
  reason: string;
  created_at: Date;
}

// Loads the queue of items that have not been reviewed yet, oldest first.
// Each candidate is parsed back through Zod for runtime safety.
//
// Two pagination modes:
//   1. `cursor` (preferred for >100s of items per audit finding #8):
//      keyset on (created_at, id). Pass cursor=undefined for the first
//      page; for the next page pass cursor=lastSeenCursor (returned
//      below as nextCursor when there's more).
//   2. `offset` (legacy): preserved so existing callers / tests don't
//      break. Deprecated for hot paths because it scans-then-skips,
//      which gets quadratic as the queue grows.
export interface CursorValue {
  created_at: string; // ISO
  id: string;
}

export async function loadPendingReviews(
  executor: Executor,
  options: {
    limit?: number;
    offset?: number;
    cursor?: CursorValue | null;
  } = {}
): Promise<PendingReview[]> {
  const params: unknown[] = [];
  let sql = `SELECT id::text, candidate, confidence, reason, created_at
               FROM review_queue
              WHERE reviewed_at IS NULL`;

  // Cursor pagination via keyset comparison. The composite (created_at, id)
  // is unique because id is a bigserial; using it as the tiebreaker
  // avoids the same-timestamp-skip pitfall.
  if (options.cursor) {
    params.push(options.cursor.created_at);
    params.push(options.cursor.id);
    sql += ` AND (created_at, id) > ($${params.length - 1}::timestamptz, $${params.length}::bigint)`;
  }

  sql += ` ORDER BY created_at ASC, id ASC`;

  if (options.limit !== undefined) {
    params.push(options.limit);
    sql += ` LIMIT $${params.length}`;
  }
  if (options.offset !== undefined) {
    params.push(options.offset);
    sql += ` OFFSET $${params.length}`;
  }
  const { rows } = await executor.query<PendingReviewRow>(sql, params);
  return rows.map((row) => ({
    id: row.id,
    candidate: ObligationCandidate.parse(row.candidate),
    confidence: row.confidence,
    reason: row.reason,
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
  }));
}

// Returns the cursor to feed loadPendingReviews({ cursor }) for the next
// page. Pure helper — callers can build this themselves; we expose it
// so the convention stays single-sourced.
export function cursorFromPendingReview(item: PendingReview): CursorValue {
  return { created_at: item.created_at, id: item.id };
}

// Counts how many items are currently pending review. Used by the UI to
// show progress and drive pagination.
export async function countPendingReviews(
  executor: Executor
): Promise<number> {
  const { rows } = await executor.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM review_queue WHERE reviewed_at IS NULL`
  );
  return Number(rows[0]?.count ?? '0');
}

// Loads a single review item by id, regardless of reviewed status. Returns
// undefined when no row matches.
export async function loadReviewItem(
  executor: Executor,
  id: string
): Promise<PendingReview | undefined> {
  const { rows } = await executor.query<PendingReviewRow>(
    `SELECT id::text, candidate, confidence, reason, created_at
     FROM review_queue
     WHERE id = $1`,
    [id]
  );
  const row = rows[0];
  if (!row) return undefined;
  return {
    id: row.id,
    candidate: ObligationCandidate.parse(row.candidate),
    confidence: row.confidence,
    reason: row.reason,
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
  };
}

export type ReviewDecision = 'approved' | 'rejected' | 'modified';

export interface MarkReviewedInput {
  review_queue_id: string;
  reviewed_by: string;
  decision: ReviewDecision;
}

// Marks a queue item as reviewed. Throws if the item is missing or already
// reviewed. Used by the review actions in src/review/actions.ts; not
// typically called directly by external code.
export async function markReviewed(
  executor: Executor,
  input: MarkReviewedInput
): Promise<void> {
  if (input.reviewed_by.length === 0) {
    throw new Error('markReviewed: reviewed_by must be a non-empty string');
  }
  const result = await executor.query(
    `UPDATE review_queue
     SET reviewed_at = NOW(), reviewed_by = $1, decision = $2
     WHERE id = $3 AND reviewed_at IS NULL`,
    [input.reviewed_by, input.decision, input.review_queue_id]
  );
  if (result.rowCount === 0) {
    throw new Error(
      `markReviewed: review item ${input.review_queue_id} not found or already reviewed`
    );
  }
}
