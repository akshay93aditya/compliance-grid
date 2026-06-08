import type { Pool, PoolClient } from 'pg';
import { enqueueReview } from '../db/review-queue';
import type { ObligationCandidate } from '../schemas/obligation';
import { commit, type CommitResult } from './commit';
import {
  validateApplicabilityConditions,
  type ValidationIssue,
} from './validate-applicability';

type Executor = Pool | PoolClient;

// Per D9: auto-commit at confidence >= 0.9. Sub-threshold goes to review.
export const CONFIDENCE_THRESHOLD = 0.9;

export type RouteResult =
  | { action: 'committed'; commit: CommitResult }
  | { action: 'queued'; queue_id: string; reasons: string[] };

export interface RouteOptions {
  // Per D52/D53: passed through to commit (sets extracted_by on insert)
  // AND to enqueueReview (preserved on the queue row so an approving
  // reviewer's commit lands with the correct attribution). NULL = local
  // extraction; non-NULL = federation extractor identity.
  extractedBy?: string;
  // Passed through to commit. Federation pulls suppress ChangeEvent
  // emission per D52; local pipeline runs leave it at default true.
  emitChangeEvent?: boolean;
}

// The orchestration point that Phase 1.4.5 (end-to-end pipeline) will use
// to take each ObligationCandidate from extraction and decide what to do:
//
//   commit  : confidence >= threshold AND semantic validation passes
//   queue   : either gate fails. Reason(s) recorded for the human reviewer.
//
// The deterministic commit gate (Phase 1.3) re-validates via Zod and writes
// transactionally. The review_queue table holds the raw candidate JSONB
// plus the reason(s) it was queued.
//
// Per D53, this same gate now applies to federation pulls: a federation row
// arriving with confidence below 0.9 (or with applicability conditions that
// reference unknown EntityProfile fields) lands in the local review queue
// rather than auto-committing. The maintainer-merged Commons remains
// trusted at the publisher layer, but the receiver still gets to pre-flight
// the data against the same anti-hallucination posture as local
// extractions.
export async function routeCandidate(
  executor: Executor,
  candidate: ObligationCandidate,
  options: RouteOptions = {}
): Promise<RouteResult> {
  const reasons: string[] = [];

  if (candidate.confidence < CONFIDENCE_THRESHOLD) {
    reasons.push(
      `confidence ${candidate.confidence} below threshold ${CONFIDENCE_THRESHOLD}`
    );
  }

  const semantic = validateApplicabilityConditions(
    candidate.applicability_conditions
  );
  if (!semantic.ok) {
    for (const issue of semantic.issues) {
      reasons.push(formatIssue(issue));
    }
  }

  if (reasons.length > 0) {
    const queued = await enqueueReview(executor, {
      candidate,
      reason: options.extractedBy
        ? `federation incoming from ${options.extractedBy}; ${reasons.join('; ')}`
        : reasons.join('; '),
      ...(options.extractedBy !== undefined
        ? { extracted_by: options.extractedBy }
        : {}),
    });
    return { action: 'queued', queue_id: queued.id, reasons };
  }

  const committed = await commit(executor, candidate, {
    ...(options.extractedBy !== undefined
      ? { extractedBy: options.extractedBy }
      : {}),
    ...(options.emitChangeEvent !== undefined
      ? { emitChangeEvent: options.emitChangeEvent }
      : {}),
  });
  return { action: 'committed', commit: committed };
}

function formatIssue(issue: ValidationIssue): string {
  return `applicability[${issue.index}] field=${issue.field} op=${issue.op}: ${issue.reason}`;
}
