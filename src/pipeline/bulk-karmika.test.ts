import { afterAll, describe, expect, it } from 'vitest';
import { closePool, getPool } from '../db/pool';
import { crawlAndPipeline } from './crawl-and-pipeline';

// Phase 1.5.5: bulk-process the karmika labour-rules portal at reasonable
// depth, now that crawlAndPipeline (Phase 1.5.2) provides budget controls.
//
// Heavily gated: requires ANTHROPIC_API_KEY, DATABASE_URL, AND
// RUN_BULK_KARMIKA=1. Expected cost ~$3-6 in Sonnet 4.6 calls.
// Expected wall clock: 15-30 minutes.
//
// Configuration:
//   maxChildren           = 20   (process every PDF on the listing)
//   maxSegmentsPerChild   = 15   (substantive coverage of each PDF without
//                                  blowing the budget on long ones)
//
// Does NOT clean up. The whole point is to populate the CKG with real
// KA labour data for inspection.

const hasKey = !!process.env.ANTHROPIC_API_KEY;
const hasDb = !!process.env.DATABASE_URL;
const runBulk = process.env.RUN_BULK_KARMIKA === '1';

const KARMIKA_LISTING_URL =
  'https://karmikaspandana.karnataka.gov.in/16/new-labour-rules-and-bills/en';

const MAX_CHILDREN = 20;
const MAX_SEGMENTS_PER_CHILD = 15;
// One hour for the whole batch. Each child can take 30s-2m; safety margin.
const SUITE_TIMEOUT_MS = 60 * 60 * 1000;

describe.skipIf(!runBulk || !hasKey || !hasDb)(
  'crawlAndPipeline (bulk karmika labour-rules listing)',
  () => {
    afterAll(async () => {
      await closePool();
    });

    it(
      'processes all karmika children with bounded segments per child',
      async () => {
        const result = await crawlAndPipeline(getPool(), {
          portalUrl: KARMIKA_LISTING_URL,
          jurisdiction: 'IN-KA',
          trustTier: 'govt-portal',
          fetchRecipeKind: 'static-url',
          maxChildren: MAX_CHILDREN,
          maxSegmentsPerChild: MAX_SEGMENTS_PER_CHILD,
          fetchOptions: { timeoutMs: 120_000 },
          // Phase 1.5.5: enable idempotent resume so re-runs after a
          // wall-clock timeout only process new children. The DB has
          // already absorbed the previously-completed work.
          skipExisting: true,
        });

        // eslint-disable-next-line no-console
        console.log('\n=== bulk karmika result ===');
        // eslint-disable-next-line no-console
        console.log(
          JSON.stringify(
            {
              recipeName: result.recipeName,
              childrenFound: result.childrenFound,
              childrenProcessed: result.childrenProcessed,
              childrenSkippedByFilter: result.childrenSkippedByFilter,
              totalCommitted: result.totalCommitted,
              totalQueued: result.totalQueued,
              totalExtractionErrors: result.totalExtractionErrors,
            },
            null,
            2
          )
        );
        // eslint-disable-next-line no-console
        console.log('per-child:');
        for (const c of result.perChild) {
          // eslint-disable-next-line no-console
          console.log(
            JSON.stringify({
              title: c.childTitle,
              committed: c.result?.committed.length ?? null,
              queued: c.result?.queued.length ?? null,
              extraction_errors: c.result?.extraction_errors.length ?? null,
              error: c.error ?? null,
            })
          );
        }

        expect(result.recipeName).toBe('karmika-spandana-ka');
        expect(result.childrenFound).toBeGreaterThanOrEqual(MAX_CHILDREN);
        expect(result.childrenProcessed).toBeGreaterThan(0);
      },
      SUITE_TIMEOUT_MS
    );
  }
);
