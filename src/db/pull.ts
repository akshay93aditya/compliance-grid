import type { Pool, PoolClient } from 'pg';

type Executor = Pool | PoolClient;

// Phase 3.4 (D52) — federation pull primitives. Instruments and sources
// arrive alongside obligations in the Commons JSONL; we upsert them with
// ON CONFLICT (id) DO NOTHING so a locally-present row wins. The
// obligation itself goes through the standard commit gate (with the
// `extractedBy` provenance), not through this module.

export interface PulledInstrument {
  id: string;
  type: 'Act' | 'Rule' | 'Notification';
  title: string;
  jurisdiction: string;
  citation: string;
}

export interface PulledSource {
  id: string;
  jurisdiction: string;
  domain: string;
  url: string;
  fetch_recipe: unknown;
  trust_tier: 'gazette' | 'govt-portal' | 'secondary' | 'unverified';
  last_seen: string;
  content_hash: string;
}

// Inserts the instrument if its id is new locally. Returns true on
// insert, false when a local row already exists (we do not overwrite —
// local extraction wins).
export async function upsertPulledInstrument(
  executor: Executor,
  row: PulledInstrument
): Promise<{ inserted: boolean }> {
  const result = await executor.query(
    `INSERT INTO instruments (id, type, title, jurisdiction, citation)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO NOTHING`,
    [row.id, row.type, row.title, row.jurisdiction, row.citation]
  );
  return { inserted: (result.rowCount ?? 0) > 0 };
}

// Inserts the source if its id is new locally. Same "local wins" rule
// as upsertPulledInstrument. Federated sources arrive without a
// `processed_at` since they were processed by the publishing operator,
// not us; we set it to last_seen so this source is not retried by
// crawlAndPipeline's skipExisting filter (D36 + D47).
export async function upsertPulledSource(
  executor: Executor,
  row: PulledSource
): Promise<{ inserted: boolean }> {
  const result = await executor.query(
    `INSERT INTO sources
       (id, jurisdiction, domain, url, fetch_recipe, trust_tier,
        last_seen, content_hash, processed_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $7)
     ON CONFLICT (id) DO NOTHING`,
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
  return { inserted: (result.rowCount ?? 0) > 0 };
}
