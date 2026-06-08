// End-to-end patrol smoke: pulls a portal listing, picks the first N
// children, runs each through the full pipeline (acquire -> segment ->
// extract -> route -> commit/queue). Requires DATABASE_URL + ANTHROPIC_API_KEY.
//
// Cost: maxChildren * maxSegmentsPerChild Sonnet calls. Default 2 x 3 = 6
// calls (~$0.06 at v1 rates).
//
// Usage:
//   DATABASE_URL=... ANTHROPIC_API_KEY=... \
//     npx tsx scripts/smoke-patrol.ts <portal-url> [max-children]

// Minimal .env loader (dotenv isn't a direct dep here).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const envPath = join(process.cwd(), '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2];
  }
}

import { crawlAndPipeline } from '../src/pipeline/crawl-and-pipeline';
import { closePool, getPool } from '../src/db/pool';

const portalUrl = process.argv[2];
const maxChildren = Number.parseInt(process.argv[3] ?? '2', 10);

if (!portalUrl) {
  console.error('Usage: tsx scripts/smoke-patrol.ts <portal-url> [max-children]');
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(2);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY not set');
  process.exit(2);
}

async function main(): Promise<number> {
  const t0 = Date.now();
  const pool = getPool();
  try {
    const result = await crawlAndPipeline(pool, {
      portalUrl,
      jurisdiction: 'IN',
      trustTier: 'govt-portal',
      fetchRecipeKind: 'listing-page',
      maxChildren,
      maxSegmentsPerChild: 3,
    });
    const elapsedMs = Date.now() - t0;
    console.log(JSON.stringify({
      portalUrl,
      recipe: result.recipeName,
      childrenFound: result.childrenFound,
      childrenProcessed: result.childrenProcessed,
      elapsedMs,
      totalCommitted: result.totalCommitted,
      totalQueued: result.totalQueued,
      totalExtractionErrors: result.totalExtractionErrors,
      perChild: result.perChild.map((p) => ({
        url: p.childUrl,
        title: p.childTitle.length > 100 ? p.childTitle.slice(0, 100) + '…' : p.childTitle,
        ...(p.error ? { error: p.error } : {}),
        ...(p.result ? {
          processedSegments: p.result.processed_segments,
          totalSegments: p.result.total_segments,
          committed: p.result.committed.length,
          queued: p.result.queued.length,
          extractionErrors: p.result.extraction_errors.length,
        } : {}),
      })),
    }, null, 2));
    return result.totalExtractionErrors > 0 ? 1 : 0;
  } finally {
    await closePool();
  }
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error(err);
  process.exit(1);
});
