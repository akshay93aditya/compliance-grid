import type { Pool, PoolClient } from 'pg';
import { crawlPortal, type CrawlPortalResult } from '../acquire/crawl-portal';
import type { FetchOptions } from '../acquire/fetcher';
import type { ListingChild } from '../acquire/listing-handler';
import type { AgentRunnerClient } from '../agents/contract';
import type { Jurisdiction } from '../schemas/jurisdiction';
import type { InstrumentType } from '../schemas/instrument';
import type { TrustTier } from '../schemas/source';
import {
  runPipeline,
  type PipelineInstrument,
  type PipelineResult,
} from './run-pipeline';

type Executor = Pool | PoolClient;

// Default mapper from a ListingChild to PipelineInstrument metadata. Uses
// the child's title (cleaned to a URL-safe slug) as the instrument id and
// title; defaults type to 'Rule' (the most common shape on the pilot's
// karmika source) and citation to the title. Callers can override with a
// custom mapper to fit other portals.
function defaultInstrumentMapper(
  child: ListingChild,
  jurisdiction: Jurisdiction
): PipelineInstrument {
  const slug =
    child.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'untitled';
  return {
    id: `${jurisdiction}/${slug}`,
    title: child.title,
    type: 'Rule' as InstrumentType,
    jurisdiction,
    citation: child.title,
  };
}

export interface CrawlAndPipelineInput {
  portalUrl: string;
  jurisdiction: Jurisdiction;
  // The Source Index domain this portal belongs to (labour, tax,
  // environment, etc.). Forwarded to runPipeline so each child Source
  // row carries the right domain. Drop-in for the prior hardcoded
  // 'labour' default in run-pipeline.
  domain?: string;
  // Default trust_tier for each child Source row.
  trustTier: TrustTier;
  // Default fetch_recipe.kind for each child Source row.
  fetchRecipeKind: 'static-url' | 'listing-page';
  // Override the default ListingChild -> PipelineInstrument mapper.
  instrumentMapper?: (child: ListingChild) => PipelineInstrument;
  // Optional filter: return false to skip a child entirely.
  childFilter?: (child: ListingChild) => boolean;
  // Cap on how many children to process. Undefined = process all. Caller
  // is responsible for setting this when running against a real portal,
  // since unbounded runs can be expensive (each child can spawn many
  // Sonnet calls during extraction).
  maxChildren?: number;
  // Forwarded to runPipeline for each child.
  maxSegmentsPerChild?: number;
  // When true, query the `sources` table for each child URL and skip those
  // already persisted. Cheap idempotent resume for partial runs (e.g. when
  // a previous bulk invocation hit a wall-clock timeout). Skipping happens
  // BEFORE maxChildren is applied so the cap counts only NEW children.
  skipExisting?: boolean;
  // Injected clients (for tests).
  client?: AgentRunnerClient;
  fetchOptions?: FetchOptions;
}

export interface CrawlAndPipelinePerChild {
  childUrl: string;
  childTitle: string;
  // PipelineResult when the per-child run succeeded.
  result?: PipelineResult;
  // Error message when the per-child run threw. The orchestrator catches and
  // continues so one bad PDF does not abort the whole crawl.
  error?: string;
}

export interface CrawlAndPipelineResult {
  portalUrl: string;
  recipeName: string;
  childrenFound: number;
  childrenProcessed: number;
  childrenSkippedByFilter: number;
  childrenSkippedAsExisting: number;
  perChild: CrawlAndPipelinePerChild[];
  totalCommitted: number;
  totalQueued: number;
  totalExtractionErrors: number;
}

// Crawl a portal listing page, then run the pipeline against each child
// document up to maxChildren. Per-child failures are caught and surfaced
// rather than aborting the whole run.
//
// Cost: bounded by `maxChildren * maxSegmentsPerChild` Sonnet calls
// (extraction is the only AI step). For example, maxChildren=2 +
// maxSegmentsPerChild=5 = ~10 calls = ~$0.20 at v1 Sonnet rates.
export async function crawlAndPipeline(
  executor: Executor,
  input: CrawlAndPipelineInput
): Promise<CrawlAndPipelineResult> {
  const crawl: CrawlPortalResult = await crawlPortal(
    input.portalUrl,
    input.fetchOptions ?? {}
  );

  const filter = input.childFilter ?? (() => true);
  let kept = crawl.children.filter(filter);
  const childrenSkippedByFilter = crawl.children.length - kept.length;

  // Idempotent-resume filter: skip children whose pipeline has already
  // completed end-to-end. Per D47's tightening of D36, "completed" means
  // sources.processed_at IS NOT NULL — not just "row exists." A source
  // whose row was persisted but whose extraction failed mid-way has a
  // NULL processed_at and is retried here.
  let childrenSkippedAsExisting = 0;
  if (input.skipExisting && kept.length > 0) {
    const urls = kept.map((c) => c.url);
    const { rows } = await executor.query<{ url: string }>(
      `SELECT url FROM sources
       WHERE url = ANY($1::text[]) AND processed_at IS NOT NULL`,
      [urls]
    );
    const existing = new Set(rows.map((r) => r.url));
    const before = kept.length;
    kept = kept.filter((c) => !existing.has(c.url));
    childrenSkippedAsExisting = before - kept.length;
  }

  if (input.maxChildren !== undefined) {
    kept = kept.slice(0, input.maxChildren);
  }

  const mapper =
    input.instrumentMapper ??
    ((c: ListingChild) => defaultInstrumentMapper(c, input.jurisdiction));

  const perChild: CrawlAndPipelinePerChild[] = [];
  let totalCommitted = 0;
  let totalQueued = 0;
  let totalExtractionErrors = 0;

  for (const child of kept) {
    try {
      const result = await runPipeline(executor, {
        url: child.url,
        instrument: mapper(child),
        trustTier: input.trustTier,
        fetchRecipeKind: input.fetchRecipeKind,
        ...(input.domain !== undefined ? { domain: input.domain } : {}),
        ...(input.maxSegmentsPerChild !== undefined
          ? { maxSegments: input.maxSegmentsPerChild }
          : {}),
        ...(input.client ? { client: input.client } : {}),
        ...(input.fetchOptions ? { fetchOptions: input.fetchOptions } : {}),
      });
      perChild.push({
        childUrl: child.url,
        childTitle: child.title,
        result,
      });
      totalCommitted += result.committed.length;
      totalQueued += result.queued.length;
      totalExtractionErrors += result.extraction_errors.length;
    } catch (err) {
      perChild.push({
        childUrl: child.url,
        childTitle: child.title,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    portalUrl: crawl.parentUrl,
    recipeName: crawl.recipeName,
    childrenFound: crawl.children.length,
    childrenProcessed: perChild.filter((c) => c.result !== undefined).length,
    childrenSkippedByFilter,
    childrenSkippedAsExisting,
    perChild,
    totalCommitted,
    totalQueued,
    totalExtractionErrors,
  };
}

// Exported for tests.
export { defaultInstrumentMapper };
