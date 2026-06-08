import type { Pool, PoolClient } from 'pg';
import { acquire, type AcquireResult } from '../acquire/acquire';
import type { FetchOptions } from '../acquire/fetcher';
import type { AgentRunnerClient } from '../agents/contract';
import { runExtraction } from '../agents/extraction';
import { markSourceProcessed, persistSource } from '../db/sources';
import { routeCandidate, type RouteResult } from '../gates/route-candidate';
import { segment, type Segment } from '../segment/segment';
import type { Jurisdiction } from '../schemas/jurisdiction';
import type { InstrumentType } from '../schemas/instrument';
import type { TrustTier } from '../schemas/source';
import { mapSettled } from '../util/concurrency';

type Executor = Pool | PoolClient;

export interface PipelineInstrument {
  id: string;
  title: string;
  type: InstrumentType;
  jurisdiction: Jurisdiction;
  citation: string;
}

export interface PipelineInput {
  url: string;
  instrument: PipelineInstrument;
  trustTier: TrustTier;
  fetchRecipeKind: 'static-url' | 'listing-page';
  // The Source Index domain this regulator falls under (labour, tax,
  // environment, etc.). The Source row records it so downstream queries
  // (calendar, alerts, coverage) can scope by domain without resolving
  // back to the yaml. Caller (Source Index lookup, CLI flow, or test)
  // is the authority — never hardcoded here. Defaults to 'unknown'
  // so old call sites don't break before they've been updated.
  domain?: string;
  // Cap on how many segments to process. Useful for budget control on large
  // documents. undefined = process all.
  maxSegments?: number;
  // Parallelism for the per-segment extract+route step. Default 4 —
  // enough to amortise wall-clock cost across typical multi-segment
  // documents without overrunning Anthropic per-key rate limits. Set
  // to 1 to force the legacy sequential behaviour.
  segmentConcurrency?: number;
  client?: AgentRunnerClient;
  fetchOptions?: FetchOptions;
}

export interface PipelineCommitted {
  canonical_id: string;
  version: string;
  action: 'inserted' | 'versioned';
  segment_anchor: string;
}

export interface PipelineQueued {
  queue_id: string;
  reasons: string[];
  segment_anchor: string;
}

export interface PipelineExtractionError {
  segment_anchor: string;
  error: string;
}

export interface PipelineResult {
  source_id: string;
  acquired_kind: AcquireResult['kind'];
  total_segments: number;
  processed_segments: number;
  raw_candidates_count: number;
  committed: PipelineCommitted[];
  queued: PipelineQueued[];
  extraction_errors: PipelineExtractionError[];
}

// The end-to-end pipeline. Takes a URL + instrument metadata, runs through
// the full Acquire -> persistSource -> Segment -> Extract -> routeCandidate
// chain, and returns a summary of what ended up where.
//
// Extraction errors on a single segment do not abort the run; they are
// collected and surfaced in the result so a human can inspect them. Per-call
// failures are common in real-world extraction (rate limits, occasional
// off-schema model output for unusual segments).
export async function runPipeline(
  executor: Executor,
  input: PipelineInput
): Promise<PipelineResult> {
  // 1. Ensure the parent Instrument exists. UPSERT semantics so re-runs
  //    don't fail on existing rows; we don't update title/citation here
  //    because that's a curation concern, not an automation concern.
  await executor.query(
    `INSERT INTO instruments (id, type, title, jurisdiction, citation)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO NOTHING`,
    [
      input.instrument.id,
      input.instrument.type,
      input.instrument.title,
      input.instrument.jurisdiction,
      input.instrument.citation,
    ]
  );

  // 2. Acquire the URL (fetch + content-type + normalize + content_hash).
  const acquired = await acquire(input.url, input.fetchOptions ?? {});

  // 3. Persist the Source row (real content_hash, real last_seen).
  const persisted = await persistSource(executor, {
    acquired,
    jurisdiction: input.instrument.jurisdiction,
    // Caller's domain (from the Source Index entry) or 'unknown' if the
    // call site hasn't been wired yet. The hardcoded 'labour' from the
    // Phase 1.4.5 pilot is gone.
    domain: input.domain ?? 'unknown',
    trustTier: input.trustTier,
    fetchRecipe: { kind: input.fetchRecipeKind },
  });

  // 4. Segment.
  const allSegments = segment(acquired);
  const segments: Segment[] =
    input.maxSegments !== undefined
      ? allSegments.slice(0, input.maxSegments)
      : allSegments;

  // 5. Extract + route per segment. Bounded-concurrency (audit
  //    finding #5a): each segment is its own Sonnet call (~$0.02) +
  //    a few DB writes. Sequential was simple but left obvious
  //    parallelism on the table — for an 8-segment doc that's ~8x
  //    wall-clock cost. mapSettled keeps per-segment errors isolated
  //    so one bad segment doesn't abort the whole document.
  //
  //    Cap chosen as 4: matches typical Anthropic API rate-limit
  //    headroom + most segmented docs are O(10s), so 4-way parallel
  //    cuts most runs by ~75% without thundering-herd risk. Caller
  //    can override via PipelineInput.segmentConcurrency.
  const segConcurrency = Math.max(1, input.segmentConcurrency ?? 4);
  type PerSegmentResult = {
    rawCount: number;
    committed: PipelineCommitted[];
    queued: PipelineQueued[];
  };

  const perSeg = await mapSettled(
    segments,
    segConcurrency,
    async (seg): Promise<PerSegmentResult> => {
      const extraction = await runExtraction(
        {
          source_id: persisted.id,
          instrument: input.instrument,
          segment: { anchor: seg.anchor, text: seg.text },
        },
        input.client ? { client: input.client } : undefined
      );
      const localCommitted: PipelineCommitted[] = [];
      const localQueued: PipelineQueued[] = [];
      for (const candidate of extraction.candidates) {
        const routed: RouteResult = await routeCandidate(executor, candidate);
        if (routed.action === 'committed') {
          localCommitted.push({
            canonical_id: routed.commit.canonical_id,
            version: routed.commit.version,
            action: routed.commit.action,
            segment_anchor: seg.anchor,
          });
        } else {
          localQueued.push({
            queue_id: routed.queue_id,
            reasons: routed.reasons,
            segment_anchor: seg.anchor,
          });
        }
      }
      return {
        rawCount: extraction.raw_count,
        committed: localCommitted,
        queued: localQueued,
      };
    }
  );

  const committed: PipelineCommitted[] = [];
  const queued: PipelineQueued[] = [];
  const extraction_errors: PipelineExtractionError[] = [];
  let rawCount = 0;
  for (let i = 0; i < perSeg.length; i++) {
    const r = perSeg[i]!;
    if (r.status === 'fulfilled') {
      rawCount += r.value.rawCount;
      committed.push(...r.value.committed);
      queued.push(...r.value.queued);
    } else {
      extraction_errors.push({
        segment_anchor: segments[i]!.anchor,
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      });
    }
  }

  // 6. Mark the source as processed against its current content_hash.
  //    Used by `crawlAndPipeline.skipExisting` (D36 tightening) and by the
  //    patrol loop (D47) to distinguish "row exists" from "extraction done."
  //    A pipeline that throws before reaching here intentionally leaves
  //    processed_at as NULL so the source gets retried.
  await markSourceProcessed(executor, persisted.id);

  return {
    source_id: persisted.id,
    acquired_kind: acquired.kind,
    total_segments: allSegments.length,
    processed_segments: segments.length,
    raw_candidates_count: rawCount,
    committed,
    queued,
    extraction_errors,
  };
}
