import type { Pool, PoolClient } from 'pg';
import { commit, type CommitResult } from '../gates/commit';
import { markReviewed } from '../db/review-queue';
import { ObligationCandidate } from '../schemas/obligation';

type Executor = Pool | PoolClient;

// Per D43: review actions are the human override on the routing decision.
// approve = commit the queued candidate as-is. modify = commit a different
// candidate (the reviewer's edit). reject = no commit. All three mark the
// queue item reviewed_at + reviewed_by + decision so it leaves the pending
// list.
//
// approve and modify route through the commit gate, which emits a
// ChangeEvent per D39. reject does not emit a ChangeEvent because nothing
// entered the system of record.

export interface ApproveReviewInput {
  review_queue_id: string;
  reviewed_by: string;
}

export interface ApproveReviewResult {
  review_queue_id: string;
  commit: CommitResult;
}

// Approves a queued candidate. Re-validates the stored candidate via Zod,
// commits it (which emits a ChangeEvent), then marks the queue item
// reviewed with decision 'approved'. Per D53, the queued row's
// extracted_by (set when the item was enqueued from a federation pull)
// is preserved into the commit so the approval doesn't relabel a
// federation row as locally-extracted.
export async function approveReview(
  executor: Executor,
  input: ApproveReviewInput
): Promise<ApproveReviewResult> {
  if (input.reviewed_by.length === 0) {
    throw new Error('approveReview: reviewed_by must be a non-empty string');
  }
  const { rows } = await executor.query<{
    candidate: unknown;
    extracted_by: string | null;
  }>(
    `SELECT candidate, extracted_by FROM review_queue
     WHERE id = $1 AND reviewed_at IS NULL`,
    [input.review_queue_id]
  );
  if (rows.length === 0) {
    throw new Error(
      `approveReview: review item ${input.review_queue_id} not found or already reviewed`
    );
  }
  const candidate = ObligationCandidate.parse(rows[0]!.candidate);
  const extractedBy = rows[0]!.extracted_by;
  const commitResult = await commit(
    executor,
    candidate,
    extractedBy !== null ? { extractedBy } : {}
  );
  await markReviewed(executor, {
    review_queue_id: input.review_queue_id,
    reviewed_by: input.reviewed_by,
    decision: 'approved',
  });
  return { review_queue_id: input.review_queue_id, commit: commitResult };
}

export interface RejectReviewInput {
  review_queue_id: string;
  reviewed_by: string;
}

export interface RejectReviewResult {
  review_queue_id: string;
}

// Rejects a queued candidate. Nothing is committed; the queue item is
// marked reviewed with decision 'rejected' so it leaves the pending list.
export async function rejectReview(
  executor: Executor,
  input: RejectReviewInput
): Promise<RejectReviewResult> {
  await markReviewed(executor, {
    review_queue_id: input.review_queue_id,
    reviewed_by: input.reviewed_by,
    decision: 'rejected',
  });
  return { review_queue_id: input.review_queue_id };
}

export interface ModifyReviewInput {
  review_queue_id: string;
  reviewed_by: string;
  // The reviewer's edit of the original queued candidate. Could fix a bad
  // applicability value, raise confidence after manual verification, rewrite
  // the summary, etc.
  modified_candidate: ObligationCandidate;
}

export interface ModifyReviewResult {
  review_queue_id: string;
  commit: CommitResult;
}

// Commits a reviewer-modified candidate (re-validated via Zod) and marks
// the queue item reviewed with decision 'modified'. Per D53, the queued
// row's extracted_by is preserved into the commit (same reasoning as
// approveReview): a reviewer editing the wording of a federation-pulled
// candidate doesn't transfer authorship to themselves.
export async function modifyReview(
  executor: Executor,
  input: ModifyReviewInput
): Promise<ModifyReviewResult> {
  if (input.reviewed_by.length === 0) {
    throw new Error('modifyReview: reviewed_by must be a non-empty string');
  }
  const validated = ObligationCandidate.parse(input.modified_candidate);
  const { rows } = await executor.query<{ extracted_by: string | null }>(
    `SELECT extracted_by FROM review_queue WHERE id = $1`,
    [input.review_queue_id]
  );
  const extractedBy = rows[0]?.extracted_by ?? null;
  const commitResult = await commit(
    executor,
    validated,
    extractedBy !== null ? { extractedBy } : {}
  );
  await markReviewed(executor, {
    review_queue_id: input.review_queue_id,
    reviewed_by: input.reviewed_by,
    decision: 'modified',
  });
  return { review_queue_id: input.review_queue_id, commit: commitResult };
}
