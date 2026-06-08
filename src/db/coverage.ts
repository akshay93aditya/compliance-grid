import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { Pool, PoolClient } from 'pg';
import type { EntityProfile } from '../schemas/entity-profile';

type Executor = Pool | PoolClient;

// One Source Index entry. The yaml schema is richer; this is just the
// fields the coverage computation actually reads.
export interface SourceIndexEntry {
  id: string;
  url: string;
  jurisdiction: string;
  domain: string;
}

// Cached on the module — Source Index files don't change per-request,
// and re-reading 436 yamls every render is wasteful. Cleared when
// SOURCES_DIR is replaced (test injection) via `_reset()`.
let cachedEntries: SourceIndexEntry[] | null = null;

const SOURCES_DIR = join(process.cwd(), 'sources');

export async function loadSourceIndex(
  dir = SOURCES_DIR
): Promise<SourceIndexEntry[]> {
  if (cachedEntries && dir === SOURCES_DIR) return cachedEntries;
  const entries: SourceIndexEntry[] = [];
  for await (const file of walkYaml(dir)) {
    const text = await readFile(file, 'utf-8');
    let parsed: Record<string, unknown>;
    try {
      parsed = parseYaml(text) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (
      typeof parsed.id === 'string' &&
      typeof parsed.url === 'string' &&
      typeof parsed.jurisdiction === 'string' &&
      typeof parsed.domain === 'string'
    ) {
      entries.push({
        id: parsed.id,
        url: parsed.url,
        jurisdiction: parsed.jurisdiction,
        domain: parsed.domain,
      });
    }
  }
  if (dir === SOURCES_DIR) cachedEntries = entries;
  return entries;
}

async function* walkYaml(dir: string): AsyncGenerator<string> {
  let dirents;
  try {
    dirents = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const d of dirents) {
    const full = join(dir, d.name);
    if (d.isDirectory()) {
      yield* walkYaml(full);
    } else if (d.isFile() && d.name.endsWith('.yaml')) {
      yield full;
    }
  }
}

// Test-only reset of the cache.
export function _resetSourceIndexCache(): void {
  cachedEntries = null;
}

export interface CoverageReport {
  // Applicable regulators in the Source Index for this entity's
  // primary jurisdiction + central (IN).
  applicable_regulators: number;
  covered_regulators: number;
  uncovered_regulators: number;
  // Coverage by jurisdiction so the UI can render a per-bucket summary.
  by_jurisdiction: Array<{
    jurisdiction: string;
    applicable: number;
    covered: number;
  }>;
  // Cost-of-honesty signal: regulators we know apply but haven't
  // extracted anything from. The UI surfaces these as the discovery gap.
  uncovered_sample: Array<{ id: string; url: string; domain: string }>;
}

// Compute the coverage report for one entity. Pure function of:
//   1) the Source Index files on disk
//   2) the obligations + sources tables in the DB
// No AI cost. Cheap enough to call on every page render — the
// Source Index walk is cached and the DB hit is one query.
export async function computeCoverageReport(
  executor: Executor,
  entity: EntityProfile,
  sourceIndexDir?: string
): Promise<CoverageReport> {
  const sourceIndex = await loadSourceIndex(sourceIndexDir);

  // Applicability v1: jurisdiction-only. An IN-KA pvt-ltd is covered by
  // (a) every regulator whose jurisdiction matches one of theirs, and
  // (b) every central (`IN`) regulator. Sector-based filtering is a
  // future refinement; for now we err toward over-inclusion so the
  // gap-signal stays honest.
  const userJurisdictions = new Set<string>([
    ...entity.jurisdictions,
    'IN',
  ]);
  const applicable = sourceIndex.filter((s) =>
    userJurisdictions.has(s.jurisdiction)
  );

  // Pull every distinct host the DB has obligations against. One query;
  // postgres-side regex extracts the host from each source URL referenced
  // by any obligation. Empty array if the CKG is empty.
  const { rows } = await executor.query<{ host: string }>(
    `SELECT DISTINCT regexp_replace(s.url, '^https?://([^/]+)/.*$', '\\1') AS host
       FROM obligations o,
            jsonb_array_elements(o.source_refs) sr
       JOIN sources s ON s.id = (sr->>'source_id')
      WHERE s.url ~ '^https?://'`
  );
  const coveredHosts = new Set<string>(rows.map((r) => r.host));

  // For each applicable yaml entry, check if its host has any obligation.
  const yamlEntryHost = (url: string): string => {
    const m = url.match(/^https?:\/\/([^/]+)/);
    return m ? m[1]! : url;
  };
  const enriched = applicable.map((s) => ({
    ...s,
    covered: coveredHosts.has(yamlEntryHost(s.url)),
  }));

  const covered = enriched.filter((e) => e.covered).length;
  const uncovered = enriched.length - covered;

  // Per-jurisdiction breakdown.
  const buckets = new Map<string, { applicable: number; covered: number }>();
  for (const e of enriched) {
    const b = buckets.get(e.jurisdiction) ?? { applicable: 0, covered: 0 };
    b.applicable += 1;
    if (e.covered) b.covered += 1;
    buckets.set(e.jurisdiction, b);
  }
  const by_jurisdiction = [...buckets.entries()]
    .map(([jurisdiction, b]) => ({ jurisdiction, ...b }))
    .sort((a, b) => a.jurisdiction.localeCompare(b.jurisdiction));

  // Up to 5 uncovered samples for "what would you like to extract next?".
  const uncovered_sample = enriched
    .filter((e) => !e.covered)
    .slice(0, 5)
    .map(({ id, url, domain }) => ({ id, url, domain }));

  return {
    applicable_regulators: applicable.length,
    covered_regulators: covered,
    uncovered_regulators: uncovered,
    by_jurisdiction,
    uncovered_sample,
  };
}
