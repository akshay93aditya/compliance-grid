import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { AcquireResult } from '../acquire/acquire';
import type { Jurisdiction } from '../schemas/jurisdiction';
import { Source, type TrustTier } from '../schemas/source';

type Executor = Pool | PoolClient;

export interface PersistSourceInput {
  acquired: AcquireResult;
  jurisdiction: Jurisdiction;
  domain: string;
  trustTier: TrustTier;
  fetchRecipe: { kind: string; config?: Record<string, unknown> };
}

export interface PersistSourceResult {
  id: string;
  action: 'inserted' | 'updated';
}

// Stable id derived from the final URL. Same URL -> same id, so re-fetching
// a source updates the existing row (and refreshes last_seen / content_hash)
// rather than creating duplicates.
export function computeSourceId(url: string): string {
  return 'src_' + createHash('sha256').update(url).digest('hex').slice(0, 24);
}

// Persists an acquired source to the `sources` table. Re-validates the row
// shape via the Zod schema (belt-and-braces against the application
// boundary). On conflict by id (i.e. same URL re-fetched), updates the
// existing row's content_hash, last_seen, trust_tier, and fetch_recipe.
// `processed_at` is intentionally untouched on conflict: it tracks pipeline
// completion (set by markSourceProcessed at end of runPipeline) and is
// cleared by the patrol loop when content_hash changes.
export async function persistSource(
  executor: Executor,
  input: PersistSourceInput
): Promise<PersistSourceResult> {
  const id = computeSourceId(input.acquired.url);
  const row = Source.parse({
    id,
    jurisdiction: input.jurisdiction,
    domain: input.domain,
    url: input.acquired.url,
    fetch_recipe: {
      kind: input.fetchRecipe.kind,
      config: input.fetchRecipe.config ?? {},
    },
    trust_tier: input.trustTier,
    last_seen: new Date().toISOString(),
    content_hash: input.acquired.contentHash,
  });

  // The (xmax = 0) trick: returns true on an INSERT, false on an UPDATE.
  // xmax is the deleting-transaction id; zero for live rows, so on a fresh
  // INSERT it's 0 and on an UPDATE it's the txid that just superseded the row.
  const result = await executor.query<{ inserted: boolean }>(
    `INSERT INTO sources
       (id, jurisdiction, domain, url, fetch_recipe, trust_tier, last_seen, content_hash)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
     ON CONFLICT (id) DO UPDATE SET
       jurisdiction = EXCLUDED.jurisdiction,
       domain       = EXCLUDED.domain,
       url          = EXCLUDED.url,
       fetch_recipe = EXCLUDED.fetch_recipe,
       trust_tier   = EXCLUDED.trust_tier,
       last_seen    = EXCLUDED.last_seen,
       content_hash = EXCLUDED.content_hash
     RETURNING (xmax = 0) AS inserted`,
    [
      row.id,
      row.jurisdiction,
      row.domain,
      row.url,
      JSON.stringify(row.fetch_recipe),
      row.trust_tier,
      row.last_seen,
      row.content_hash,
    ]
  );

  return {
    id: row.id,
    action: result.rows[0]!.inserted ? 'inserted' : 'updated',
  };
}

// Marks a source as having completed the end-to-end pipeline against its
// current content_hash. Called at the end of a successful runPipeline. Used
// by `crawlAndPipeline.skipExisting` (D36 tightening) and by the patrol
// loop (D47) to decide which sources need (re-)processing.
export async function markSourceProcessed(
  executor: Executor,
  sourceId: string
): Promise<void> {
  await executor.query(
    `UPDATE sources SET processed_at = NOW() WHERE id = $1`,
    [sourceId]
  );
}

export interface SourceInstrument {
  id: string;
  type: 'Act' | 'Rule' | 'Notification';
  title: string;
  jurisdiction: string;
  citation: string;
}

// Looks up the instrument metadata for a source by walking source_refs on
// obligations: returns the instrument of the first obligation that
// referenced this source. Used by the patrol loop (D47) to feed runPipeline
// with the right instrument when re-extracting after a content_hash change.
//
// Returns undefined when no obligation references this source — meaning a
// previous pipeline run persisted the source but never produced an
// obligation. Such sources cannot be patrolled and are skipped with a
// reason.
export async function findInstrumentForSource(
  executor: Executor,
  sourceId: string
): Promise<SourceInstrument | undefined> {
  const { rows } = await executor.query<{
    id: string;
    type: 'Act' | 'Rule' | 'Notification';
    title: string;
    jurisdiction: string;
    citation: string;
  }>(
    `SELECT i.id, i.type, i.title, i.jurisdiction, i.citation
     FROM obligations o
     JOIN instruments i ON o.instrument_id = i.id
     WHERE o.source_refs @> $1::jsonb
     LIMIT 1`,
    [JSON.stringify([{ source_id: sourceId }])]
  );
  return rows[0];
}

export interface PatrolSourceRow {
  id: string;
  url: string;
  jurisdiction: string;
  domain: string;
  content_hash: string;
  last_seen: string;
  processed_at: string | null;
}

export interface LoadPatrolSourcesOptions {
  jurisdiction?: string;
  domain?: string;
  // Only return sources whose last_seen is older than this many days.
  // Useful for cadenced patrols ("re-check anything not seen in 7 days").
  olderThanDays?: number;
  limit?: number;
}

// Loads source rows for the patrol loop, oldest last_seen first. Filters
// are optional and additive.
export async function loadPatrolSources(
  executor: Executor,
  options: LoadPatrolSourcesOptions = {}
): Promise<PatrolSourceRow[]> {
  const params: unknown[] = [];
  const wheres: string[] = [];

  if (options.jurisdiction !== undefined) {
    params.push(options.jurisdiction);
    wheres.push(`jurisdiction = $${params.length}`);
  }
  if (options.domain !== undefined) {
    params.push(options.domain);
    wheres.push(`domain = $${params.length}`);
  }
  if (options.olderThanDays !== undefined) {
    params.push(options.olderThanDays);
    wheres.push(`last_seen < NOW() - ($${params.length} || ' days')::interval`);
  }

  let sql = `SELECT id, url, jurisdiction, domain, content_hash,
                    to_char(last_seen, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_seen,
                    CASE WHEN processed_at IS NULL THEN NULL
                         ELSE to_char(processed_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                    END AS processed_at
             FROM sources`;
  if (wheres.length > 0) sql += ` WHERE ${wheres.join(' AND ')}`;
  sql += ` ORDER BY last_seen ASC`;
  if (options.limit !== undefined) {
    params.push(options.limit);
    sql += ` LIMIT $${params.length}`;
  }

  const { rows } = await executor.query<PatrolSourceRow>(sql, params);
  return rows;
}

export interface ApplyContentHashResult {
  changed: boolean;
  oldHash: string;
  newHash: string;
}

// Atomic update used by the patrol loop. If the new content_hash differs
// from what's stored, updates content_hash + last_seen and clears
// processed_at so a re-extraction can be triggered. If unchanged, only
// last_seen is bumped. Returns whether the content actually changed.
export async function applyContentHashUpdate(
  executor: Executor,
  sourceId: string,
  newHash: string
): Promise<ApplyContentHashResult | undefined> {
  // CTE captures the pre-UPDATE hash so the diff is evaluated against the
  // old value rather than the row we are about to write.
  const { rows } = await executor.query<{
    old_hash: string;
    changed: boolean;
  }>(
    `WITH old AS (
       SELECT content_hash FROM sources WHERE id = $1
     )
     UPDATE sources
     SET content_hash = $2,
         last_seen = NOW(),
         processed_at = CASE
           WHEN (SELECT content_hash FROM old) <> $2 THEN NULL
           ELSE processed_at
         END
     FROM old
     WHERE sources.id = $1
     RETURNING old.content_hash AS old_hash,
              (old.content_hash <> $2) AS changed`,
    [sourceId, newHash]
  );
  const row = rows[0];
  if (!row) return undefined;
  return { changed: row.changed, oldHash: row.old_hash, newHash };
}
