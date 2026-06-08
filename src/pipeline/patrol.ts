import type { Pool, PoolClient } from 'pg';
import { sha256Hex } from '../acquire/acquire';
import { fetchSource, type FetchOptions } from '../acquire/fetcher';
import type { AgentRunnerClient } from '../agents/contract';
import {
  applyContentHashUpdate,
  findInstrumentForSource,
  loadPatrolSources,
  type PatrolSourceRow,
} from '../db/sources';
import { runPipeline, type PipelineResult } from './run-pipeline';
import type { TrustTier } from '../schemas/source';

type Executor = Pool | PoolClient;

export type PatrolPerSourceStatus =
  // Source was re-fetched; content_hash matches the stored value. Only
  // last_seen was bumped.
  | 'unchanged'
  // Content_hash changed; the full pipeline ran successfully and the
  // commit gate emitted any ChangeEvents per D39.
  | 'changed-reprocessed'
  // Content changed but the per-source pipeline threw. last_seen was
  // bumped but obligation state is whatever the commit gate had time to
  // write before the throw.
  | 'changed-pipeline-error'
  // Source has no obligations referencing it (e.g. a previous pipeline
  // run persisted the source row but extraction yielded nothing). Patrol
  // cannot infer the instrument needed for re-extraction. Surfaced for
  // operator attention; no action taken.
  | 'skipped-no-instrument'
  // Re-fetch failed entirely (network, 4xx, 5xx). Source row untouched.
  | 'skipped-fetch-error';

export interface PatrolPerSource {
  source_id: string;
  url: string;
  status: PatrolPerSourceStatus;
  // Populated when status is 'changed-reprocessed' or
  // 'changed-pipeline-error'. The previous content_hash from before the
  // change so operators can correlate with downstream ChangeEvents.
  old_hash?: string;
  new_hash?: string;
  // Set when status is 'changed-reprocessed'.
  pipeline?: PipelineResult;
  // Set when status is 'changed-pipeline-error' or 'skipped-fetch-error'.
  error?: string;
}

export interface PatrolInput {
  // Source-row filters forwarded to loadPatrolSources. All optional.
  jurisdiction?: string;
  domain?: string;
  olderThanDays?: number;
  // Hard cap on number of sources to patrol in this run. Defaults to 50
  // so a patrol invocation cannot accidentally OCR/Sonnet the entire CKG.
  maxSources?: number;
  // Trust tier carried through to runPipeline for any re-processing of
  // changed sources. The patrol does not change a source's trust tier;
  // the pipeline's persistSource preserves what's already on the row.
  // Required so callers explicitly opt into the spend on changed sources.
  trustTier: TrustTier;
  fetchRecipeKind: 'static-url' | 'listing-page';
  // Cap on segments processed per changed source. Forwarded to runPipeline.
  maxSegmentsPerSource?: number;
  // Injected clients for tests.
  client?: AgentRunnerClient;
  fetchOptions?: FetchOptions;
}

export interface PatrolResult {
  sourcesScanned: number;
  sourcesUnchanged: number;
  sourcesChanged: number;
  sourcesSkippedNoInstrument: number;
  sourcesFetchErrors: number;
  sourcesPipelineErrors: number;
  perSource: PatrolPerSource[];
}

const DEFAULT_MAX_SOURCES = 50;

// Phase 1.7 patrol loop (D47). Re-fetches known sources, diffs by
// content_hash, and re-runs the pipeline only on sources whose content has
// changed since the last successful processing. Per the prime directive,
// no ChangeEvents are emitted from this function directly — the commit
// gate (D39) does that automatically when the pipeline reaches its
// commit step.
//
// Cadence is the caller's concern (cron / scheduled task). This function
// is idempotent: running it twice in a row with no content changes
// produces zero ChangeEvents and zero AI cost.
export async function runPatrol(
  executor: Executor,
  input: PatrolInput
): Promise<PatrolResult> {
  const limit = input.maxSources ?? DEFAULT_MAX_SOURCES;
  const sources = await loadPatrolSources(executor, {
    ...(input.jurisdiction !== undefined ? { jurisdiction: input.jurisdiction } : {}),
    ...(input.domain !== undefined ? { domain: input.domain } : {}),
    ...(input.olderThanDays !== undefined ? { olderThanDays: input.olderThanDays } : {}),
    limit,
  });

  const perSource: PatrolPerSource[] = [];
  let unchanged = 0;
  let changed = 0;
  let skippedNoInstrument = 0;
  let fetchErrors = 0;
  let pipelineErrors = 0;

  for (const row of sources) {
    const result = await patrolOneSource(executor, row, input);
    perSource.push(result);
    switch (result.status) {
      case 'unchanged':
        unchanged += 1;
        break;
      case 'changed-reprocessed':
        changed += 1;
        break;
      case 'changed-pipeline-error':
        changed += 1;
        pipelineErrors += 1;
        break;
      case 'skipped-no-instrument':
        skippedNoInstrument += 1;
        break;
      case 'skipped-fetch-error':
        fetchErrors += 1;
        break;
    }
  }

  return {
    sourcesScanned: sources.length,
    sourcesUnchanged: unchanged,
    sourcesChanged: changed,
    sourcesSkippedNoInstrument: skippedNoInstrument,
    sourcesFetchErrors: fetchErrors,
    sourcesPipelineErrors: pipelineErrors,
    perSource,
  };
}

async function patrolOneSource(
  executor: Executor,
  row: PatrolSourceRow,
  input: PatrolInput
): Promise<PatrolPerSource> {
  // 1. Re-fetch the URL. We compute content_hash from the raw bytes — same
  //    hashing as acquire/persistSource — so any change in the fetched
  //    document trips the diff.
  let bytes: Uint8Array;
  try {
    const fetched = await fetchSource(row.url, input.fetchOptions ?? {});
    bytes = fetched.bytes;
  } catch (err) {
    return {
      source_id: row.id,
      url: row.url,
      status: 'skipped-fetch-error',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const newHash = sha256Hex(bytes);

  // 2. Apply the diff to the source row. If content matches the stored
  //    hash, only last_seen is bumped; otherwise content_hash + last_seen
  //    are updated and processed_at is cleared.
  const diff = await applyContentHashUpdate(executor, row.id, newHash);
  if (!diff) {
    // Source row vanished between loadPatrolSources and the update. This
    // is an edge case (concurrent delete); surface it like a fetch error.
    return {
      source_id: row.id,
      url: row.url,
      status: 'skipped-fetch-error',
      error: 'source row disappeared mid-patrol',
    };
  }

  if (!diff.changed) {
    return {
      source_id: row.id,
      url: row.url,
      status: 'unchanged',
      old_hash: diff.oldHash,
      new_hash: diff.newHash,
    };
  }

  // 3. Content changed. Look up the parent instrument so we can hand
  //    runPipeline the same metadata the initial crawl used.
  const instrument = await findInstrumentForSource(executor, row.id);
  if (!instrument) {
    return {
      source_id: row.id,
      url: row.url,
      status: 'skipped-no-instrument',
      old_hash: diff.oldHash,
      new_hash: diff.newHash,
    };
  }

  // 4. Re-run the pipeline. persistSource inside runPipeline will UPSERT
  //    the same row (id derives from URL) without disturbing processed_at
  //    further. markSourceProcessed at the tail sets processed_at = NOW().
  try {
    const pipeline = await runPipeline(executor, {
      url: row.url,
      instrument: {
        id: instrument.id,
        type: instrument.type,
        title: instrument.title,
        jurisdiction: instrument.jurisdiction as PatrolJurisdiction,
        citation: instrument.citation,
      },
      trustTier: input.trustTier,
      fetchRecipeKind: input.fetchRecipeKind,
      // Preserve the source row's domain on UPSERT — patrol carries
      // the existing metadata forward, never overrides with a
      // hardcoded default.
      domain: row.domain,
      ...(input.maxSegmentsPerSource !== undefined
        ? { maxSegments: input.maxSegmentsPerSource }
        : {}),
      ...(input.client ? { client: input.client } : {}),
      ...(input.fetchOptions ? { fetchOptions: input.fetchOptions } : {}),
    });
    return {
      source_id: row.id,
      url: row.url,
      status: 'changed-reprocessed',
      old_hash: diff.oldHash,
      new_hash: diff.newHash,
      pipeline,
    };
  } catch (err) {
    return {
      source_id: row.id,
      url: row.url,
      status: 'changed-pipeline-error',
      old_hash: diff.oldHash,
      new_hash: diff.newHash,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// The instrument.jurisdiction field on the DB row is a plain string; the
// runPipeline input demands the branded `Jurisdiction` type. Jurisdictions
// in the sources table are CHECK-constrained to `^IN(-[A-Z]{2})?$`, so the
// cast is safe at runtime. We narrow to the union here without importing
// the Zod schema for one cast.
type PatrolJurisdiction = `IN` | `IN-${string}`;
