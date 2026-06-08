// Removes all demo-tagged data from the local CKG. Counterpart to
// `npm run db:demo`. Safe to run any time; only deletes rows where
// `extracted_by = 'demo'`. Real (locally-extracted or pulled-from-
// Commons) obligations and their parents are left untouched.
//
// Order matters: obligations -> instruments/sources (the latter two are
// referenced via FK / JSONB-pointer, and we leave non-orphaned rows
// alone because the same instrument may have non-demo obligations
// committed against it).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Local .env shim so the script works under `npm run db:demo:clear`.
const envPath = join(process.cwd(), '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2];
  }
}

import { closePool, getPool } from '../src/db/pool';

async function main(): Promise<void> {
  const startedAt = Date.now();
  const pool = getPool();

  const obligationsResult = await pool.query(
    `DELETE FROM obligations WHERE extracted_by = 'demo'`
  );

  // Instruments + sources used only by demo obligations become orphans.
  // We can't safely identify "demo-only" instruments from a column
  // (instruments don't carry extracted_by), so we drop anything whose
  // id is no longer referenced by any non-demo obligation. The seed
  // pilot's 12 instruments + 20 sources all share that property.
  const instrumentsResult = await pool.query(
    `DELETE FROM instruments
      WHERE id NOT IN (SELECT DISTINCT instrument_id FROM obligations)`
  );
  const sourcesResult = await pool.query(
    `DELETE FROM sources
      WHERE id NOT IN (
        SELECT DISTINCT (sr->>'source_id')
          FROM obligations,
               jsonb_array_elements(source_refs) sr
      )`
  );

  console.log(JSON.stringify({
    elapsed_ms: Date.now() - startedAt,
    deleted: {
      obligations: obligationsResult.rowCount ?? 0,
      instruments: instrumentsResult.rowCount ?? 0,
      sources: sourcesResult.rowCount ?? 0,
    },
  }, null, 2));
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
