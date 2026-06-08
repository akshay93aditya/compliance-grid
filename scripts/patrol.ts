// Standalone runner for the Phase 1.7 patrol loop (D47). Reads config from
// environment variables, invokes runPatrol, prints a JSON summary, and
// exits with a non-zero code if any source hit a fetch or pipeline error.
//
// Intended to be invoked by an external scheduler (cron, systemd timer,
// GitHub Actions cron, Vercel cron via a thin wrapper, etc.). The cadence
// itself is the scheduler's concern; this script just runs the patrol
// once per invocation. The patrol is idempotent — stable sources cost
// only bandwidth and produce no ChangeEvents.
//
// Usage:
//   DATABASE_URL=... npm run patrol
//   DATABASE_URL=... PATROL_JURISDICTION=IN-KA PATROL_DOMAIN=labour \
//     PATROL_MAX_SOURCES=20 PATROL_OLDER_THAN_DAYS=7 npm run patrol

import { closePool, getPool } from '../src/db/pool';
import { runPatrol } from '../src/pipeline/patrol';
import type { TrustTier } from '../src/schemas/source';

function envInt(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer; got ${JSON.stringify(raw)}`);
  }
  return n;
}

const trustTierRaw = process.env.PATROL_TRUST_TIER ?? 'govt-portal';
const ALLOWED: TrustTier[] = ['gazette', 'govt-portal', 'secondary', 'unverified'];
if (!ALLOWED.includes(trustTierRaw as TrustTier)) {
  console.error(
    `PATROL_TRUST_TIER must be one of ${ALLOWED.join(', ')}; got ${trustTierRaw}`
  );
  process.exit(2);
}

const fetchRecipeKind =
  (process.env.PATROL_FETCH_RECIPE_KIND as 'static-url' | 'listing-page') ??
  'static-url';
if (fetchRecipeKind !== 'static-url' && fetchRecipeKind !== 'listing-page') {
  console.error(
    `PATROL_FETCH_RECIPE_KIND must be 'static-url' or 'listing-page'; got ${fetchRecipeKind}`
  );
  process.exit(2);
}

async function main(): Promise<number> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const input = {
    trustTier: trustTierRaw as TrustTier,
    fetchRecipeKind,
    ...(process.env.PATROL_JURISDICTION
      ? { jurisdiction: process.env.PATROL_JURISDICTION }
      : {}),
    ...(process.env.PATROL_DOMAIN ? { domain: process.env.PATROL_DOMAIN } : {}),
    ...(envInt('PATROL_OLDER_THAN_DAYS') !== undefined
      ? { olderThanDays: envInt('PATROL_OLDER_THAN_DAYS')! }
      : {}),
    ...(envInt('PATROL_MAX_SOURCES') !== undefined
      ? { maxSources: envInt('PATROL_MAX_SOURCES')! }
      : {}),
    ...(envInt('PATROL_MAX_SEGMENTS_PER_SOURCE') !== undefined
      ? { maxSegmentsPerSource: envInt('PATROL_MAX_SEGMENTS_PER_SOURCE')! }
      : {}),
  };

  const result = await runPatrol(getPool(), input);
  const elapsedMs = Date.now() - t0;

  console.log(
    JSON.stringify(
      {
        started_at: startedAt,
        elapsed_ms: elapsedMs,
        input,
        summary: {
          sources_scanned: result.sourcesScanned,
          sources_unchanged: result.sourcesUnchanged,
          sources_changed: result.sourcesChanged,
          sources_skipped_no_instrument: result.sourcesSkippedNoInstrument,
          sources_fetch_errors: result.sourcesFetchErrors,
          sources_pipeline_errors: result.sourcesPipelineErrors,
        },
        per_source: result.perSource.map((p) => ({
          status: p.status,
          url: p.url,
          ...(p.old_hash !== undefined ? { old_hash: p.old_hash } : {}),
          ...(p.new_hash !== undefined ? { new_hash: p.new_hash } : {}),
          ...(p.error !== undefined ? { error: p.error } : {}),
          ...(p.pipeline !== undefined
            ? {
                pipeline: {
                  committed: p.pipeline.committed.length,
                  queued: p.pipeline.queued.length,
                  extraction_errors: p.pipeline.extraction_errors.length,
                },
              }
            : {}),
        })),
      },
      null,
      2
    )
  );

  // Non-zero exit when any source threw, so external schedulers (CI cron,
  // monitoring) can alert on the failure.
  return result.sourcesFetchErrors + result.sourcesPipelineErrors > 0 ? 1 : 0;
}

main()
  .then(async (code) => {
    await closePool();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    await closePool().catch(() => undefined);
    process.exit(1);
  });
