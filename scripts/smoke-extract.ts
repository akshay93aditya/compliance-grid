import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const envPath = join(process.cwd(), '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2];
  }
}

import { runPipeline } from '../src/pipeline/run-pipeline';
import { getPool, closePool } from '../src/db/pool';

const url = process.argv[2];
const title = process.argv[3] ?? 'Untitled';
const citation = process.argv[4] ?? title;
if (!url) {
  console.error('Usage: tsx scripts/smoke-extract.ts <pdf-url> <title> [citation]');
  process.exit(2);
}

async function main(): Promise<number> {
  const pool = getPool();
  try {
    const r = await runPipeline(pool, {
      url,
      instrument: {
        id: `IN/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`,
        title,
        type: 'Notification' as any,
        jurisdiction: 'IN' as any,
        citation,
      },
      trustTier: 'govt-portal',
      fetchRecipeKind: 'static-url',
      maxSegments: 3,
    });
    console.log(JSON.stringify({
      totalSegments: r.total_segments,
      processedSegments: r.processed_segments,
      rawCandidatesCount: r.raw_candidates_count,
      committed: r.committed.length,
      queued: r.queued.length,
      extractionErrors: r.extraction_errors.length,
      committedSample: r.committed.slice(0, 3),
      queuedSample: r.queued.slice(0, 3).map((q: any) => ({ id: q.queue_id, reasons: q.reasons })),
    }, null, 2));
    return 0;
  } finally {
    await closePool();
  }
}

main().then(c => process.exit(c)).catch(e => { console.error(e); process.exit(1); });
